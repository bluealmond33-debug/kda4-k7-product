from __future__ import annotations

import json
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any

import numpy as np

from .emotion2vec_v2 import INTENSITY_VALUES, _load_aligned_features, _targets
from .evaluation import regression_metrics, robustness_metrics
from .io_utils import read_csv, sha256_file, utc_now_iso, write_csv, write_json


EGEMAPS_FEATURE_COUNT = 88
_WORKER_SMILE: Any | None = None


def _initialise_egemaps_worker() -> None:
    global _WORKER_SMILE
    import opensmile

    _WORKER_SMILE = opensmile.Smile(
        feature_set=opensmile.FeatureSet.eGeMAPSv02,
        feature_level=opensmile.FeatureLevel.Functionals,
    )


def _extract_egemaps_worker(task: tuple[str, list[str]]) -> tuple[np.ndarray | None, str]:
    path, feature_names = task
    try:
        if _WORKER_SMILE is None:
            _initialise_egemaps_worker()
        frame = _WORKER_SMILE.process_file(path).reset_index(drop=True)
        values = frame[feature_names].iloc[0].to_numpy(dtype=np.float32)
        if values.shape != (EGEMAPS_FEATURE_COUNT,) or not np.isfinite(values).all():
            raise ValueError("유효하지 않은 eGeMAPS 특징")
        return values, ""
    except Exception as exc:
        return None, repr(exc)


def extract_egemaps_resumable(
    manifest_path: Path,
    features_path: Path,
    index_path: Path,
    progress_path: Path,
    report_path: Path,
    checkpoint_every: int = 25,
    workers: int = 6,
) -> dict[str, Any]:
    import opensmile

    rows = read_csv(manifest_path)
    if not rows:
        raise ValueError("eGeMAPS 추출 대상이 없습니다.")
    missing = [row["audio_path"] for row in rows if not Path(row["audio_path"]).exists()]
    if missing:
        raise ValueError(f"오디오 파일이 없는 행 {len(missing)}개: {missing[:3]}")
    manifest_hash = sha256_file(manifest_path)
    smile = opensmile.Smile(
        feature_set=opensmile.FeatureSet.eGeMAPSv02,
        feature_level=opensmile.FeatureLevel.Functionals,
    )
    next_row = 0
    errors: list[dict[str, str]] = []
    feature_names: list[str]
    if progress_path.exists() and features_path.exists():
        progress = json.loads(progress_path.read_text(encoding="utf-8"))
        if progress.get("manifest_sha256") != manifest_hash:
            raise ValueError("기존 eGeMAPS progress와 manifest hash가 다릅니다.")
        if progress.get("row_count") != len(rows):
            raise ValueError("기존 eGeMAPS progress와 행 수가 다릅니다.")
        next_row = int(progress.get("next_row", 0))
        errors = list(progress.get("errors", []))
        feature_names = list(progress["feature_names"])
        features = np.lib.format.open_memmap(features_path, mode="r+")
        if features.shape != (len(rows), EGEMAPS_FEATURE_COUNT):
            raise ValueError("기존 eGeMAPS 배열 shape가 다릅니다.")
    else:
        first_frame = smile.process_file(rows[0]["audio_path"]).reset_index(drop=True)
        feature_names = [str(column) for column in first_frame.columns]
        if len(feature_names) != EGEMAPS_FEATURE_COUNT:
            raise ValueError(f"eGeMAPS 특징 수가 88이 아닙니다: {len(feature_names)}")
        features_path.parent.mkdir(parents=True, exist_ok=True)
        features = np.lib.format.open_memmap(
            features_path,
            mode="w+",
            dtype=np.float32,
            shape=(len(rows), EGEMAPS_FEATURE_COUNT),
        )
        features[:] = np.nan
        features[0] = first_frame.iloc[0].to_numpy(dtype=np.float32)
        features.flush()
        next_row = 1
        write_json(
            progress_path,
            {
                "status": "RUNNING",
                "manifest_sha256": manifest_hash,
                "row_count": len(rows),
                "next_row": next_row,
                "feature_names": feature_names,
                "errors": [],
            },
        )

    started = time.time()
    processed_this_run = 0
    remaining_positions = list(range(next_row, len(rows)))
    tasks = [(rows[position]["audio_path"], feature_names) for position in remaining_positions]
    with ProcessPoolExecutor(
        max_workers=max(1, workers),
        initializer=_initialise_egemaps_worker,
    ) as executor:
        results = executor.map(_extract_egemaps_worker, tasks, chunksize=4)
        for position, (values, error) in zip(remaining_positions, results, strict=True):
            row = rows[position]
            if values is not None:
                features[position] = values
            else:
                errors.append({"embedding_key": row["embedding_key"], "error": error})
            processed_this_run += 1
            if (
                processed_this_run % checkpoint_every == 0
                or position + 1 == len(rows)
            ):
                features.flush()
                write_json(
                    progress_path,
                    {
                        "status": "RUNNING" if position + 1 < len(rows) else "COMPLETE",
                        "manifest_sha256": manifest_hash,
                        "row_count": len(rows),
                        "next_row": position + 1,
                        "feature_names": feature_names,
                        "errors": errors,
                        "workers": workers,
                        "updated_at": utc_now_iso(),
                    },
                )

    index_rows = []
    for position, row in enumerate(rows):
        index_rows.append(
            {
                "embedding_key": row["embedding_key"],
                "feature_row": position,
                "status": "OK" if np.isfinite(features[position]).all() else "ERROR",
            }
        )
    write_csv(index_path, index_rows, ["embedding_key", "feature_row", "status"])
    elapsed = time.time() - started
    report = {
        "status": "EGEMAPS_V2_COMPLETE",
        "created_at": utc_now_iso(),
        "rows": len(rows),
        "valid_rows": int(np.isfinite(features).all(axis=1).sum()),
        "error_rows": len(errors),
        "feature_count": EGEMAPS_FEATURE_COUNT,
        "workers": workers,
        "feature_names": feature_names,
        "processed_this_run": processed_this_run,
        "elapsed_seconds_this_run": elapsed,
        "rows_per_second_this_run": processed_this_run / elapsed if elapsed else None,
        "manifest_sha256": manifest_hash,
        "features_sha256": sha256_file(features_path),
        "index_sha256": sha256_file(index_path),
        "errors": errors,
    }
    write_json(report_path, report)
    return report


def _load_egemaps_aligned(
    manifest_rows: list[dict[str, str]],
    features_path: Path,
    index_path: Path,
) -> np.ndarray:
    index_by_key = {
        row["embedding_key"]: row
        for row in read_csv(index_path)
        if row["status"] == "OK"
    }
    features = np.load(features_path, mmap_mode="r")
    aligned = np.empty((len(manifest_rows), features.shape[1]), dtype=np.float32)
    for position, row in enumerate(manifest_rows):
        key = row["embedding_key"]
        if key not in index_by_key:
            raise ValueError(f"eGeMAPS index에 없는 key: {key}")
        aligned[position] = features[int(index_by_key[key]["feature_row"])]
    if not np.isfinite(aligned).all():
        raise ValueError("정렬된 eGeMAPS에 비유한 값이 있습니다.")
    return aligned


def _load_variant_egemaps(
    variant_rows: list[dict[str, str]],
    variant_egemaps_csv: Path,
) -> np.ndarray:
    source_rows = read_csv(variant_egemaps_csv)
    feature_names = [
        column
        for column in source_rows[0]
        if column not in {"wav_id", "emotion_class", "variant"}
    ]
    if len(feature_names) != EGEMAPS_FEATURE_COUNT:
        raise ValueError("package eGeMAPS 특징 수가 88이 아닙니다.")
    source_by_key = {
        f"{row['wav_id']}|{row['variant']}": row for row in source_rows
    }
    aligned = np.asarray(
        [
            [float(source_by_key[row["embedding_key"]][name]) for name in feature_names]
            for row in variant_rows
        ],
        dtype=np.float32,
    )
    if not np.isfinite(aligned).all():
        raise ValueError("package eGeMAPS에 비유한 값이 있습니다.")
    return aligned


def train_prosody_fusion_intensity(
    auxiliary_manifest_path: Path,
    emotion_features_path: Path,
    emotion_index_path: Path,
    egemaps_features_path: Path,
    egemaps_index_path: Path,
    existing_oof_predictions_path: Path,
    variant_manifest_path: Path,
    variant_emotion_features_path: Path,
    variant_emotion_index_path: Path,
    variant_egemaps_csv: Path,
    existing_variant_predictions_path: Path,
    artifact_path: Path,
    oof_predictions_path: Path,
    variant_predictions_path: Path,
    report_json_path: Path,
    report_md_path: Path,
    seed: int = 20260716,
) -> dict[str, Any]:
    import joblib
    from lightgbm import LGBMRegressor

    auxiliary_rows, emotion_features = _load_aligned_features(
        auxiliary_manifest_path,
        emotion_features_path,
        emotion_index_path,
    )
    egemaps_features = _load_egemaps_aligned(
        auxiliary_rows,
        egemaps_features_path,
        egemaps_index_path,
    )
    variant_rows, variant_emotion_features = _load_aligned_features(
        variant_manifest_path,
        variant_emotion_features_path,
        variant_emotion_index_path,
    )
    variant_egemaps = _load_variant_egemaps(variant_rows, variant_egemaps_csv)
    intensity, _, _ = _targets(auxiliary_rows)
    variant_intensity, _, _ = _targets(variant_rows)
    train_indices = np.asarray(
        [
            index
            for index, row in enumerate(auxiliary_rows)
            if row["split"] == "AUX_TRAIN"
        ],
        dtype=int,
    )
    train_truth = intensity[train_indices] @ INTENSITY_VALUES
    folds = sorted({int(auxiliary_rows[index]["cv_fold"]) for index in train_indices})
    existing_oof_by_key = {
        row["embedding_key"]: row for row in read_csv(existing_oof_predictions_path)
    }
    existing_variant_by_key = {
        row["embedding_key"]: row for row in read_csv(existing_variant_predictions_path)
    }
    oof_by_candidate = {
        "emotion2vec_multitask_neural": np.asarray(
            [
                float(existing_oof_by_key[auxiliary_rows[index]["embedding_key"]][
                    "oof_mean_intensity"
                ])
                for index in train_indices
            ],
            dtype=np.float64,
        ),
        "egemaps_lightgbm": np.full(len(train_indices), np.nan),
        "emotion2vec_egemaps_fusion_lightgbm": np.full(len(train_indices), np.nan),
    }
    train_position = {row_index: position for position, row_index in enumerate(train_indices)}
    fold_models: dict[str, list[Any]] = {
        "egemaps_lightgbm": [],
        "emotion2vec_egemaps_fusion_lightgbm": [],
    }
    variant_fold_predictions: dict[str, list[np.ndarray]] = {
        "egemaps_lightgbm": [],
        "emotion2vec_egemaps_fusion_lightgbm": [],
    }
    candidate_features = {
        "egemaps_lightgbm": egemaps_features,
        "emotion2vec_egemaps_fusion_lightgbm": np.concatenate(
            [emotion_features, egemaps_features],
            axis=1,
        ),
    }
    candidate_variant_features = {
        "egemaps_lightgbm": variant_egemaps,
        "emotion2vec_egemaps_fusion_lightgbm": np.concatenate(
            [variant_emotion_features, variant_egemaps],
            axis=1,
        ),
    }
    for candidate in candidate_features:
        features = candidate_features[candidate]
        for fold in folds:
            fold_train = train_indices[
                np.asarray(
                    [
                        int(auxiliary_rows[index]["cv_fold"]) != fold
                        for index in train_indices
                    ]
                )
            ]
            fold_validation = train_indices[
                np.asarray(
                    [
                        int(auxiliary_rows[index]["cv_fold"]) == fold
                        for index in train_indices
                    ]
                )
            ]
            model = LGBMRegressor(
                objective="huber",
                n_estimators=450,
                learning_rate=0.03,
                num_leaves=31,
                max_depth=-1,
                min_child_samples=30,
                subsample=0.85,
                colsample_bytree=0.75,
                reg_alpha=1.0,
                reg_lambda=5.0,
                random_state=seed + fold,
                n_jobs=-1,
                verbosity=-1,
            )
            model.fit(
                features[fold_train],
                intensity[fold_train] @ INTENSITY_VALUES,
            )
            prediction = np.clip(model.predict(features[fold_validation]), 0.0, 2.0)
            for index, value in zip(fold_validation, prediction, strict=True):
                oof_by_candidate[candidate][train_position[index]] = value
            variant_fold_predictions[candidate].append(
                np.clip(model.predict(candidate_variant_features[candidate]), 0.0, 2.0)
            )
            fold_models[candidate].append(model)

    candidate_metrics = {
        candidate: regression_metrics(train_truth, prediction)
        for candidate, prediction in oof_by_candidate.items()
    }
    selected_candidate = max(
        candidate_metrics,
        key=lambda candidate: (
            candidate_metrics[candidate]["ccc"]
            if candidate_metrics[candidate]["ccc"] is not None
            else -np.inf,
            -candidate_metrics[candidate]["mae"],
        ),
    )
    if selected_candidate == "emotion2vec_multitask_neural":
        selected_variant = np.asarray(
            [
                float(existing_variant_by_key[row["embedding_key"]][
                    "predicted_mean_intensity"
                ])
                for row in variant_rows
            ]
        )
        selected_variant_std = np.asarray(
            [
                float(existing_variant_by_key[row["embedding_key"]]["ensemble_std"])
                for row in variant_rows
            ]
        )
        selected_models = None
    else:
        selected_variant_folds = np.stack(
            variant_fold_predictions[selected_candidate],
            axis=0,
        )
        selected_variant = np.median(selected_variant_folds, axis=0)
        selected_variant_std = np.std(selected_variant_folds, axis=0)
        selected_models = fold_models[selected_candidate]

    oof_rows = []
    for position, row_index in enumerate(train_indices):
        row = auxiliary_rows[row_index]
        oof_rows.append(
            {
                "embedding_key": row["embedding_key"],
                "wav_id": row["wav_id"],
                "cv_fold": row["cv_fold"],
                "target_mean_intensity": row["mean_intensity"],
                **{
                    f"{candidate}_prediction": round(float(values[position]), 8)
                    for candidate, values in oof_by_candidate.items()
                },
                "selected_candidate": selected_candidate,
                "selected_prediction": round(
                    float(oof_by_candidate[selected_candidate][position]),
                    8,
                ),
            }
        )
    write_csv(
        oof_predictions_path,
        oof_rows,
        [
            "embedding_key",
            "wav_id",
            "cv_fold",
            "target_mean_intensity",
            *[f"{candidate}_prediction" for candidate in oof_by_candidate],
            "selected_candidate",
            "selected_prediction",
        ],
    )

    variant_prediction_rows = []
    for index, row in enumerate(variant_rows):
        value = float(selected_variant[index])
        variant_prediction_rows.append(
            {
                "embedding_key": row["embedding_key"],
                "clip_id": row["clip_id"],
                "source_wav_id": row["wav_id"],
                "variant": row["variant"],
                "proxy_group": row["proxy_group"],
                "target_mean_intensity": row["mean_intensity"],
                "predicted_mean_intensity": round(value, 8),
                "ensemble_std": round(float(selected_variant_std[index]), 8),
                "predicted_p0": round(max(0.0, 1.0 - value) if value <= 1.0 else 0.0, 8),
                "predicted_p1": round(value if value <= 1.0 else 2.0 - value, 8),
                "predicted_p2": round(0.0 if value <= 1.0 else value - 1.0, 8),
            }
        )
    write_csv(
        variant_predictions_path,
        variant_prediction_rows,
        [
            "embedding_key",
            "clip_id",
            "source_wav_id",
            "variant",
            "proxy_group",
            "target_mean_intensity",
            "predicted_mean_intensity",
            "ensemble_std",
            "predicted_p0",
            "predicted_p1",
            "predicted_p2",
        ],
    )

    clean_indices = np.asarray(
        [i for i, row in enumerate(variant_rows) if row["variant"] == "CLEAN_16K"],
        dtype=int,
    )
    telephone_by_clip = {
        row["clip_id"]: i
        for i, row in enumerate(variant_rows)
        if row["variant"] == "TELEPHONY_8K_MULAW_UP16K"
    }
    telephone_indices = np.asarray(
        [telephone_by_clip[variant_rows[i]["clip_id"]] for i in clean_indices],
        dtype=int,
    )
    package_truth = variant_intensity[clean_indices] @ INTENSITY_VALUES
    package_robustness = robustness_metrics(
        package_truth,
        selected_variant[clean_indices],
        selected_variant[telephone_indices],
    )
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "candidate_id": "emotion2vec_egemaps_intensity_fusion_v2",
            "selected_head": selected_candidate,
            "fold_models": selected_models,
            "feature_order": (
                "EXISTING_EMOTION2VEC_ARTIFACT"
                if selected_models is None
                else selected_candidate
            ),
            "development_only": True,
        },
        artifact_path,
    )
    report = {
        "status": "PROSODY_FUSION_INTENSITY_COMPLETE",
        "created_at": utc_now_iso(),
        "candidate_id": "emotion2vec_egemaps_intensity_fusion_v2",
        "selected_head": selected_candidate,
        "selection_rule": "MAX_AUXILIARY_PROXY_GROUP_OOF_CCC_THEN_LOWER_MAE",
        "candidate_metrics": candidate_metrics,
        "package_existing_intensity": {
            "robustness": package_robustness,
            "temperature_labels_used": False,
            "package_is_development_evidence_after_prior_neural_inspection": True,
        },
        "artifact": {
            "path": str(artifact_path.resolve()),
            "sha256": sha256_file(artifact_path),
        },
        "caveats": [
            "Raw source eGeMAPS uses original 48 kHz files while package variants are 16 kHz.",
            "Proxy groups are heuristic, not verified speaker identities.",
            "Package labels were already inspected for the neural candidate and are no longer pristine model-selection evidence.",
        ],
    }
    write_json(report_json_path, report)
    selected_metrics = candidate_metrics[selected_candidate]
    clean_metrics = package_robustness["clean"]
    lines = [
        "# emotion2vec + eGeMAPS intensity fusion v2",
        "",
        f"- 선택 head: `{selected_candidate}`",
        f"- auxiliary OOF CCC: {selected_metrics['ccc']:.4f}",
        f"- auxiliary OOF MAE: {selected_metrics['mae']:.4f}",
        f"- package clean CCC: {clean_metrics['ccc']:.4f}",
        f"- package clean MAE: {clean_metrics['mae']:.4f}",
        f"- package telephone CCC: {package_robustness['telephone_8k']['ccc']:.4f}",
        f"- clean/telephone 평균 절대 예측 차이: {package_robustness['mean_absolute_prediction_shift']:.4f}",
        "",
        "후보 선택은 auxiliary proxy-group OOF만 사용했다. 다만 package 결과는 이전 neural "
        "후보에서 이미 확인했으므로 신규 독립 검증으로 해석하지 않는다.",
        "",
    ]
    report_md_path.write_text("\n".join(lines), encoding="utf-8")
    return report
