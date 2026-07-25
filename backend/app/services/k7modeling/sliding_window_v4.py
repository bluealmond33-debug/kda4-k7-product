from __future__ import annotations

import json
import time
import wave
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any, Iterable

import numpy as np

from .audio import audio_quality, read_pcm_wav, resample_audio
from .demo_selection_v4 import (
    _candidate_tier,
    _selection_key,
    evaluate_high_policy,
)
from .io_utils import read_csv, sha256_file, utc_now_iso, write_csv, write_json
from .ordinal_runtime import select_ordinal_level
from .ordinal_v3 import LEVEL_NAMES, ORDINAL_LEVELS, _predict_lgbm_cumulative
from .prosody_fusion import EGEMAPS_FEATURE_COUNT, _load_egemaps_aligned


_WINDOW_SMILE: Any | None = None


def sliding_window_bounds(
    duration_seconds: float,
    window_seconds: float = 2.0,
    hop_seconds: float = 1.0,
) -> list[tuple[float, float]]:
    if duration_seconds <= 0:
        raise ValueError("duration_seconds는 0보다 커야 합니다.")
    if window_seconds <= 0 or hop_seconds <= 0:
        raise ValueError("window_seconds와 hop_seconds는 0보다 커야 합니다.")
    if duration_seconds <= window_seconds:
        return [(0.0, duration_seconds)]
    last_start = duration_seconds - window_seconds
    starts = list(np.arange(0.0, last_start + 1e-9, hop_seconds))
    if not starts or last_start - starts[-1] > 0.05:
        starts.append(last_start)
    return [
        (round(float(start), 6), round(float(min(duration_seconds, start + window_seconds)), 6))
        for start in starts
    ]


def prepare_sliding_window_manifest_v4(
    parent_manifest_path: Path,
    output_manifest_path: Path,
    report_path: Path,
    window_seconds: float = 2.0,
    hop_seconds: float = 1.0,
) -> dict[str, Any]:
    parents = read_csv(parent_manifest_path)
    if not parents:
        raise ValueError("sliding-window 대상 발화가 없습니다.")
    output_rows: list[dict[str, Any]] = []
    missing: list[str] = []
    for parent in parents:
        audio_path = Path(parent["audio_path"])
        if not audio_path.exists():
            missing.append(str(audio_path))
            continue
        with wave.open(str(audio_path), "rb") as source:
            duration = source.getnframes() / source.getframerate()
        for window_index, (start, end) in enumerate(
            sliding_window_bounds(duration, window_seconds, hop_seconds)
        ):
            output_rows.append(
                {
                    "embedding_key": f"{parent['segment_id']}__w{window_index:04d}",
                    "parent_segment_id": parent["segment_id"],
                    "speaker_pair": parent["speaker_pair"],
                    "cv_fold": parent["cv_fold"],
                    "target_level": parent["intensity_0_2"],
                    "window_index": window_index,
                    "window_start_sec": start,
                    "window_end_sec": end,
                    "window_duration_sec": round(end - start, 6),
                    "audio_path": str(audio_path.resolve()),
                }
            )
    if missing:
        raise ValueError(f"sliding-window 원본 WAV 누락 {len(missing)}개: {missing[:3]}")
    write_csv(output_manifest_path, output_rows, list(output_rows[0].keys()))
    counts = defaultdict(int)
    for row in output_rows:
        counts[row["parent_segment_id"]] += 1
    report = {
        "status": "SLIDING_WINDOW_MANIFEST_COMPLETE",
        "created_at": utc_now_iso(),
        "parent_rows": len(parents),
        "window_rows": len(output_rows),
        "window_seconds": window_seconds,
        "hop_seconds": hop_seconds,
        "parents_with_multiple_windows": sum(value > 1 for value in counts.values()),
        "maximum_windows_per_parent": max(counts.values()),
        "input": {
            "path": str(parent_manifest_path.resolve()),
            "sha256": sha256_file(parent_manifest_path),
        },
        "output": {
            "path": str(output_manifest_path.resolve()),
            "sha256": sha256_file(output_manifest_path),
        },
    }
    write_json(report_path, report)
    return report


def _initialise_window_smile() -> None:
    global _WINDOW_SMILE
    import opensmile

    _WINDOW_SMILE = opensmile.Smile(
        feature_set=opensmile.FeatureSet.eGeMAPSv02,
        feature_level=opensmile.FeatureLevel.Functionals,
    )


def _extract_window_group(
    task: tuple[str, list[tuple[int, float, float]], list[str]],
) -> list[tuple[int, np.ndarray | None, str]]:
    path, windows, feature_names = task
    try:
        if _WINDOW_SMILE is None:
            _initialise_window_smile()
        samples, sample_rate = read_pcm_wav(Path(path))
    except Exception as exc:
        return [(position, None, repr(exc)) for position, _, _ in windows]
    results: list[tuple[int, np.ndarray | None, str]] = []
    for position, start, end in windows:
        try:
            start_frame = max(0, int(round(start * sample_rate)))
            end_frame = min(len(samples), int(round(end * sample_rate)))
            segment = samples[start_frame:end_frame]
            if not len(segment):
                raise ValueError("빈 sliding window")
            frame = _WINDOW_SMILE.process_signal(segment, sample_rate).reset_index(drop=True)
            values = frame[feature_names].iloc[0].to_numpy(dtype=np.float32)
            if values.shape != (EGEMAPS_FEATURE_COUNT,) or not np.isfinite(values).all():
                raise ValueError("유효하지 않은 sliding-window eGeMAPS")
            results.append((position, values, ""))
        except Exception as exc:
            results.append((position, None, repr(exc)))
    return results


def extract_sliding_window_egemaps_v4(
    manifest_path: Path,
    features_path: Path,
    index_path: Path,
    progress_path: Path,
    report_path: Path,
    checkpoint_every_groups: int = 50,
    workers: int = 6,
) -> dict[str, Any]:
    import opensmile

    rows = read_csv(manifest_path)
    if not rows:
        raise ValueError("sliding-window eGeMAPS 대상이 없습니다.")
    manifest_hash = sha256_file(manifest_path)
    feature_names: list[str]
    if progress_path.exists() and features_path.exists():
        progress = json.loads(progress_path.read_text(encoding="utf-8"))
        if progress.get("manifest_sha256") != manifest_hash:
            raise ValueError("기존 sliding-window progress와 manifest hash가 다릅니다.")
        feature_names = list(progress["feature_names"])
        features = np.lib.format.open_memmap(features_path, mode="r+")
        if features.shape != (len(rows), EGEMAPS_FEATURE_COUNT):
            raise ValueError("기존 sliding-window 특징 shape가 다릅니다.")
        errors = list(progress.get("errors", []))
    else:
        first_samples, first_rate = read_pcm_wav(Path(rows[0]["audio_path"]))
        first_start = int(round(float(rows[0]["window_start_sec"]) * first_rate))
        first_end = int(round(float(rows[0]["window_end_sec"]) * first_rate))
        smile = opensmile.Smile(
            feature_set=opensmile.FeatureSet.eGeMAPSv02,
            feature_level=opensmile.FeatureLevel.Functionals,
        )
        first_frame = smile.process_signal(
            first_samples[first_start:first_end], first_rate
        ).reset_index(drop=True)
        feature_names = [str(column) for column in first_frame.columns]
        if len(feature_names) != EGEMAPS_FEATURE_COUNT:
            raise ValueError("sliding-window eGeMAPS 특징 수가 88이 아닙니다.")
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
        errors: list[dict[str, Any]] = []

    grouped: dict[str, list[tuple[int, float, float]]] = defaultdict(list)
    for position, row in enumerate(rows):
        if np.isfinite(features[position]).all():
            continue
        grouped[row["audio_path"]].append(
            (
                position,
                float(row["window_start_sec"]),
                float(row["window_end_sec"]),
            )
        )
    tasks = [
        (path, windows, feature_names)
        for path, windows in sorted(grouped.items(), key=lambda item: item[1][0][0])
    ]
    started = time.time()
    processed_groups = 0
    with ProcessPoolExecutor(
        max_workers=max(1, workers),
        initializer=_initialise_window_smile,
    ) as executor:
        results = executor.map(_extract_window_group, tasks, chunksize=2)
        for group_result in results:
            for position, values, error in group_result:
                if values is None:
                    errors.append(
                        {"embedding_key": rows[position]["embedding_key"], "error": error}
                    )
                else:
                    features[position] = values
            processed_groups += 1
            if (
                processed_groups % max(1, checkpoint_every_groups) == 0
                or processed_groups == len(tasks)
            ):
                features.flush()
                write_json(
                    progress_path,
                    {
                        "status": "RUNNING" if processed_groups < len(tasks) else "COMPLETE",
                        "manifest_sha256": manifest_hash,
                        "row_count": len(rows),
                        "completed_rows": int(np.isfinite(features).all(axis=1).sum()),
                        "feature_names": feature_names,
                        "errors": errors,
                        "workers": workers,
                        "updated_at": utc_now_iso(),
                    },
                )
    features.flush()
    valid_mask = np.isfinite(features).all(axis=1)
    index_rows = [
        {
            "embedding_key": row["embedding_key"],
            "feature_row": position,
            "status": "OK" if valid_mask[position] else "ERROR",
        }
        for position, row in enumerate(rows)
    ]
    write_csv(index_path, index_rows, list(index_rows[0].keys()))
    report = {
        "status": "SLIDING_WINDOW_EGEMAPS_COMPLETE"
        if valid_mask.all()
        else "SLIDING_WINDOW_EGEMAPS_ERRORS",
        "created_at": utc_now_iso(),
        "rows": len(rows),
        "valid_rows": int(valid_mask.sum()),
        "error_rows": int((~valid_mask).sum()),
        "elapsed_seconds_this_run": round(time.time() - started, 3),
        "workers": workers,
        "manifest": {
            "path": str(manifest_path.resolve()),
            "sha256": manifest_hash,
        },
        "features": {
            "path": str(features_path.resolve()),
            "shape": [len(rows), EGEMAPS_FEATURE_COUNT],
        },
        "index": {"path": str(index_path.resolve())},
    }
    write_json(report_path, report)
    return report


def _probabilities_from_oof(
    parent_rows: list[dict[str, str]],
    oof_path: Path,
    prefix: str,
) -> np.ndarray:
    by_id = {row["segment_id"]: row for row in read_csv(oof_path)}
    columns = [f"{prefix}_p0", f"{prefix}_p1", f"{prefix}_p2"]
    return np.asarray(
        [
            [float(by_id[parent["segment_id"]][column]) for column in columns]
            for parent in parent_rows
        ],
        dtype=np.float64,
    )


def _window_probabilities(
    parent_rows: list[dict[str, str]],
    window_rows: list[dict[str, str]],
    window_features: np.ndarray,
    fold_models: list[Any],
) -> tuple[np.ndarray, list[int]]:
    folds = sorted({int(row["cv_fold"]) for row in parent_rows})
    if len(folds) != len(fold_models):
        raise ValueError("window fold 수와 artifact fold model 수가 다릅니다.")
    model_by_fold = dict(zip(folds, fold_models, strict=True))
    probabilities = np.full((len(window_rows), 3), np.nan)
    for fold in folds:
        positions = np.asarray(
            [
                index
                for index, row in enumerate(window_rows)
                if int(row["cv_fold"]) == fold
            ],
            dtype=int,
        )
        probabilities[positions] = _predict_lgbm_cumulative(
            model_by_fold[fold], window_features[positions]
        )
    if not np.isfinite(probabilities).all():
        raise RuntimeError("window 확률에 결측이 있습니다.")
    parent_position = {
        row["segment_id"]: index for index, row in enumerate(parent_rows)
    }
    grouped: dict[int, list[int]] = defaultdict(list)
    for window_index, row in enumerate(window_rows):
        grouped[parent_position[row["parent_segment_id"]]].append(window_index)
    peak_probabilities = np.full((len(parent_rows), 3), np.nan)
    peak_window_indices = [-1] * len(parent_rows)
    for parent_index, window_indices in grouped.items():
        selected = max(window_indices, key=lambda index: probabilities[index, 2])
        peak_probabilities[parent_index] = probabilities[selected]
        peak_window_indices[parent_index] = int(window_rows[selected]["window_index"])
    if not np.isfinite(peak_probabilities).all():
        raise RuntimeError("일부 parent에 peak window가 없습니다.")
    return peak_probabilities, peak_window_indices


def select_and_freeze_demo_final_v4(
    clean_parent_manifest_path: Path,
    clean_window_manifest_path: Path,
    clean_window_features_path: Path,
    clean_window_index_path: Path,
    telephone_window_manifest_path: Path,
    telephone_window_features_path: Path,
    telephone_window_index_path: Path,
    base_artifact_path: Path,
    base_oof_path: Path,
    high_focus_artifact_path: Path,
    high_focus_oof_path: Path,
    final_artifact_path: Path,
    predictions_path: Path,
    report_json_path: Path,
    report_md_path: Path,
    peak_alphas: Iterable[float] = (0.20, 0.35, 0.50),
    high_thresholds: Iterable[float] = (0.30, 0.25),
) -> dict[str, Any]:
    import joblib

    parent_rows = read_csv(clean_parent_manifest_path)
    clean_window_rows = read_csv(clean_window_manifest_path)
    telephone_window_rows = read_csv(telephone_window_manifest_path)
    if [row["embedding_key"] for row in clean_window_rows] != [
        row["embedding_key"] for row in telephone_window_rows
    ]:
        raise ValueError("clean/telephone window 행 정렬이 다릅니다.")
    clean_window_features = _load_egemaps_aligned(
        clean_window_rows, clean_window_features_path, clean_window_index_path
    )
    telephone_window_features = _load_egemaps_aligned(
        telephone_window_rows,
        telephone_window_features_path,
        telephone_window_index_path,
    )
    labels = np.asarray([int(row["intensity_0_2"]) for row in parent_rows], dtype=int)
    base_clean = _probabilities_from_oof(parent_rows, base_oof_path, "clean")
    base_telephone = _probabilities_from_oof(parent_rows, base_oof_path, "telephone")
    high_clean = _probabilities_from_oof(parent_rows, high_focus_oof_path, "clean")
    high_telephone = _probabilities_from_oof(
        parent_rows, high_focus_oof_path, "telephone"
    )
    high_artifact = joblib.load(high_focus_artifact_path)
    peak_clean, clean_peak_indices = _window_probabilities(
        parent_rows,
        clean_window_rows,
        clean_window_features,
        high_artifact["fold_models"],
    )
    peak_telephone, telephone_peak_indices = _window_probabilities(
        parent_rows,
        telephone_window_rows,
        telephone_window_features,
        high_artifact["fold_models"],
    )

    candidates: list[dict[str, Any]] = []

    def append_candidate(
        name: str,
        source_artifact: str,
        clean_probabilities: np.ndarray,
        telephone_probabilities: np.ndarray,
        high_threshold: float | None,
        peak_alpha: float,
    ) -> None:
        clean_metrics = evaluate_high_policy(
            labels, clean_probabilities, high_threshold
        )
        telephone_metrics = evaluate_high_policy(
            labels, telephone_probabilities, high_threshold
        )
        candidates.append(
            {
                "name": name,
                "source_artifact": source_artifact,
                "high_threshold": high_threshold,
                "peak_alpha": peak_alpha,
                "clean_metrics": clean_metrics,
                "telephone_metrics": telephone_metrics,
                "tier": _candidate_tier(clean_metrics, telephone_metrics),
            }
        )

    append_candidate(
        "base_argmax", "base", base_clean, base_telephone, None, 0.0
    )
    append_candidate(
        "base_threshold_0_25", "base", base_clean, base_telephone, 0.25, 0.0
    )
    high_default_threshold = high_artifact.get("decision_policy", {}).get(
        "high_threshold", 0.30
    )
    append_candidate(
        "high_focus_whole",
        "high_focus",
        high_clean,
        high_telephone,
        float(high_default_threshold),
        0.0,
    )
    combined_by_key: dict[tuple[float, float], tuple[np.ndarray, np.ndarray]] = {}
    for alpha in sorted({float(value) for value in peak_alphas}):
        if not 0.0 < alpha <= 1.0:
            raise ValueError("peak_alphas는 0보다 크고 1 이하여야 합니다.")
        clean_combined = (1.0 - alpha) * high_clean + alpha * peak_clean
        telephone_combined = (
            (1.0 - alpha) * high_telephone + alpha * peak_telephone
        )
        clean_combined /= clean_combined.sum(axis=1, keepdims=True)
        telephone_combined /= telephone_combined.sum(axis=1, keepdims=True)
        for threshold in sorted({float(value) for value in high_thresholds}, reverse=True):
            combined_by_key[(alpha, threshold)] = (
                clean_combined,
                telephone_combined,
            )
            append_candidate(
                f"peak_alpha_{alpha:.2f}_threshold_{threshold:.2f}",
                "high_focus",
                clean_combined,
                telephone_combined,
                threshold,
                alpha,
            )

    selected = max(candidates, key=_selection_key)
    if selected["source_artifact"] == "base":
        source_artifact = joblib.load(base_artifact_path)
        selected_clean = base_clean
        selected_telephone = base_telephone
        source_path = base_artifact_path
    else:
        source_artifact = high_artifact
        source_path = high_focus_artifact_path
        if selected["peak_alpha"] > 0:
            selected_clean, selected_telephone = combined_by_key[
                (float(selected["peak_alpha"]), float(selected["high_threshold"]))
            ]
        else:
            selected_clean, selected_telephone = high_clean, high_telephone
    selected_threshold = selected["high_threshold"]
    clean_levels = np.asarray(
        [select_ordinal_level(row, selected_threshold) for row in selected_clean],
        dtype=int,
    )
    telephone_levels = np.asarray(
        [
            select_ordinal_level(row, selected_threshold)
            for row in selected_telephone
        ],
        dtype=int,
    )
    output_rows = [
        {
            "segment_id": parent["segment_id"],
            "speaker_pair": parent["speaker_pair"],
            "cv_fold": parent["cv_fold"],
            "target_level": int(labels[index]),
            "clean_level": int(clean_levels[index]),
            "telephone_level": int(telephone_levels[index]),
            "clean_peak_window_index": clean_peak_indices[index],
            "telephone_peak_window_index": telephone_peak_indices[index],
            "clean_p0": round(float(selected_clean[index, 0]), 8),
            "clean_p1": round(float(selected_clean[index, 1]), 8),
            "clean_p2": round(float(selected_clean[index, 2]), 8),
            "telephone_p0": round(float(selected_telephone[index, 0]), 8),
            "telephone_p1": round(float(selected_telephone[index, 1]), 8),
            "telephone_p2": round(float(selected_telephone[index, 2]), 8),
        }
        for index, parent in enumerate(parent_rows)
    ]
    write_csv(predictions_path, output_rows, list(output_rows[0].keys()))

    final_artifact = dict(source_artifact)
    final_artifact.update(
        {
            "candidate_id": "emotion_temperature_demo_final_v4",
            "source_candidate_id": source_artifact.get("candidate_id"),
            "decision_policy": {"high_threshold": selected_threshold},
            "window_policy": {
                "enabled": bool(selected["peak_alpha"] > 0),
                "window_seconds": 2.0,
                "hop_seconds": 1.0,
                "peak_alpha": float(selected["peak_alpha"]),
                "peak_selection": "MAX_HIGH_PROBABILITY",
            },
            "artifact_status": "DEMO_FINAL_FROZEN",
            "inference_status": "DEMO_RESEARCH_ONLY",
            "production_api_allowed": False,
        }
    )
    final_artifact_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(final_artifact, final_artifact_path)
    report = {
        "status": "DEMO_FINAL_V4_FROZEN",
        "created_at": utc_now_iso(),
        "selected": selected,
        "candidates": candidates,
        "artifact": {
            "path": str(final_artifact_path.resolve()),
            "sha256": sha256_file(final_artifact_path),
            "source_path": str(source_path.resolve()),
            "source_sha256": sha256_file(source_path),
        },
        "outputs": {"oof_predictions": str(predictions_path.resolve())},
        "demo_integration_allowed": True,
        "production_api_allowed": False,
        "production_block_reason": "NO_NEW_REAL_CALL_CENTER_SPEAKER_SESSION_HOLDOUT",
    }
    write_json(report_json_path, report)
    lines = [
        "# Emotion temperature demo final v4",
        "",
        "## 최종 선택",
        "",
        f"- 후보: `{selected['name']}`",
        f"- tier: `{selected['tier']}`",
        f"- High threshold: `{selected_threshold}`",
        f"- Peak alpha: `{selected['peak_alpha']}`",
        (
            "- Clean High precision/recall/F2: "
            f"{selected['clean_metrics']['per_class']['2']['precision']:.4f} / "
            f"{selected['clean_metrics']['per_class']['2']['recall']:.4f} / "
            f"{selected['clean_metrics']['high_f2']:.4f}"
        ),
        (
            "- Telephone High precision/recall/F2: "
            f"{selected['telephone_metrics']['per_class']['2']['precision']:.4f} / "
            f"{selected['telephone_metrics']['per_class']['2']['recall']:.4f} / "
            f"{selected['telephone_metrics']['high_f2']:.4f}"
        ),
        (
            "- Clean/telephone Macro F1: "
            f"{selected['clean_metrics']['macro_f1']:.4f} / "
            f"{selected['telephone_metrics']['macro_f1']:.4f}"
        ),
        f"- Artifact SHA-256: `{report['artifact']['sha256']}`",
        "",
        "## 비교",
        "",
        "| 후보 | Tier | Clean P/R/F2 | Phone P/R/F2 | Clean/Phone Macro F1 |",
        "|---|---|---|---|---|",
    ]
    for candidate in sorted(candidates, key=_selection_key, reverse=True):
        clean = candidate["clean_metrics"]
        phone = candidate["telephone_metrics"]
        lines.append(
            f"| {candidate['name']} | {candidate['tier']} | "
            f"{clean['per_class']['2']['precision']:.3f}/"
            f"{clean['per_class']['2']['recall']:.3f}/{clean['high_f2']:.3f} | "
            f"{phone['per_class']['2']['precision']:.3f}/"
            f"{phone['per_class']['2']['recall']:.3f}/{phone['high_f2']:.3f} | "
            f"{clean['macro_f1']:.3f}/{phone['macro_f1']:.3f} |"
        )
    lines.extend(
        [
            "",
            "이 모델은 프로젝트 데모와 연구용 shadow에만 사용한다.",
            "새 실제 콜센터 독립 holdout이 없어 운영 자동 판단에는 사용할 수 없다.",
            "",
        ]
    )
    report_md_path.parent.mkdir(parents=True, exist_ok=True)
    report_md_path.write_text("\n".join(lines), encoding="utf-8")
    return report


def _egemaps_for_signal(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    import opensmile

    smile = opensmile.Smile(
        feature_set=opensmile.FeatureSet.eGeMAPSv02,
        feature_level=opensmile.FeatureLevel.Functionals,
    )
    frame = smile.process_signal(samples, sample_rate).reset_index(drop=True)
    values = frame.iloc[0].to_numpy(dtype=np.float32)
    if values.shape != (EGEMAPS_FEATURE_COUNT,) or not np.isfinite(values).all():
        raise ValueError("단일 WAV eGeMAPS 특징이 유효하지 않습니다.")
    return values


def predict_demo_audio_v4(
    artifact_path: Path,
    audio_path: Path,
) -> dict[str, Any]:
    import joblib

    artifact = joblib.load(artifact_path)
    samples, source_rate = read_pcm_wav(audio_path)
    samples_16k, resample_method = resample_audio(samples, source_rate, 16000)
    quality = audio_quality(samples_16k, 16000)
    if not len(samples_16k):
        raise ValueError("빈 WAV는 추론할 수 없습니다.")
    whole_features = _egemaps_for_signal(samples_16k, 16000).reshape(1, -1)
    whole_probabilities = np.mean(
        np.stack(
            [
                _predict_lgbm_cumulative(models, whole_features)[0]
                for models in artifact["fold_models"]
            ],
            axis=0,
        ),
        axis=0,
    )
    policy = artifact.get("window_policy", {})
    peak_alpha = float(policy.get("peak_alpha", 0.0)) if policy.get("enabled") else 0.0
    peak_probabilities = whole_probabilities
    peak_bounds = (0.0, len(samples_16k) / 16000.0)
    if peak_alpha > 0:
        bounds = sliding_window_bounds(
            len(samples_16k) / 16000.0,
            float(policy.get("window_seconds", 2.0)),
            float(policy.get("hop_seconds", 1.0)),
        )
        window_features = np.stack(
            [
                _egemaps_for_signal(
                    samples_16k[
                        int(round(start * 16000)) : int(round(end * 16000))
                    ],
                    16000,
                )
                for start, end in bounds
            ],
            axis=0,
        )
        window_probabilities = np.mean(
            np.stack(
                [
                    _predict_lgbm_cumulative(models, window_features)
                    for models in artifact["fold_models"]
                ],
                axis=0,
            ),
            axis=0,
        )
        peak_index = int(np.argmax(window_probabilities[:, 2]))
        peak_probabilities = window_probabilities[peak_index]
        peak_bounds = bounds[peak_index]
    probabilities = (
        (1.0 - peak_alpha) * whole_probabilities
        + peak_alpha * peak_probabilities
    )
    probabilities = probabilities / probabilities.sum()
    high_threshold = artifact.get("decision_policy", {}).get("high_threshold")
    level = select_ordinal_level(probabilities, high_threshold)
    audio_status = "invalid" if quality["status"] == "FAILED" else "valid"
    return {
        "emotion_temperature_level": level,
        "label": LEVEL_NAMES[level],
        "confidence": round(float(probabilities[level]), 6),
        "high_alert": bool(level == 2),
        "audio_quality": audio_status,
        "audio_quality_flags": quality["flags"],
        "probabilities": {
            "low": round(float(probabilities[0]), 6),
            "medium": round(float(probabilities[1]), 6),
            "high": round(float(probabilities[2]), 6),
        },
        "peak_window": {
            "start_sec": round(float(peak_bounds[0]), 3),
            "end_sec": round(float(peak_bounds[1]), 3),
            "high_probability": round(float(peak_probabilities[2]), 6),
        },
        "decision_policy": {
            "high_threshold": high_threshold,
            "peak_alpha": peak_alpha,
        },
        "model_version": artifact.get(
            "candidate_id", "emotion_temperature_demo_final_v4"
        ),
        "model_status": "demo_research_only",
        "resample_method": resample_method,
    }


def consultation_card_emotion_block(
    prediction: dict[str, Any],
    trend: str = "single_utterance",
) -> dict[str, Any]:
    return {
        "emotion_temperature": {
            "level": prediction["emotion_temperature_level"],
            "label": prediction["label"],
            "confidence": prediction["confidence"],
            "high_alert": prediction["high_alert"],
            "trend": trend,
            "audio_quality": prediction["audio_quality"],
            "model_version": prediction["model_version"],
            "advisory": "음성 고조 참고 신호이며 분노·위험 확정 또는 자동 라우팅 근거가 아님",
        }
    }


def run_demo_audio_prediction_v4(
    artifact_path: Path,
    audio_path: Path,
    output_json_path: Path,
    card_json_path: Path,
) -> dict[str, Any]:
    prediction = predict_demo_audio_v4(artifact_path, audio_path)
    card = consultation_card_emotion_block(prediction)
    write_json(output_json_path, prediction)
    write_json(card_json_path, card)
    return {"prediction": prediction, "consultation_card": card}

