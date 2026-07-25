from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import numpy as np

from .evaluation import (
    AffineCalibrator,
    bootstrap_regression_metrics,
    fit_affine_calibrator,
    load_human_consensus_partitions,
    regression_metrics,
    robustness_metrics,
)
from .io_utils import read_csv, sha256_file, utc_now_iso, write_csv, write_json


CLEAN_VARIANT = "CLEAN_16K"
TELEPHONE_VARIANT = "TELEPHONY_8K_MULAW_UP16K"
NON_FEATURE_COLUMNS = {"wav_id", "emotion_class", "variant"}


@dataclass(frozen=True)
class StandardizedRidge:
    mean: np.ndarray
    scale: np.ndarray
    coefficient: np.ndarray
    intercept: float
    alpha: float
    feature_names: tuple[str, ...]

    def predict(self, features: np.ndarray) -> np.ndarray:
        array = np.asarray(features, dtype=np.float64)
        if array.ndim != 2 or array.shape[1] != len(self.feature_names):
            raise ValueError("학습 때와 동일한 2차원 feature 배열이 필요합니다.")
        standardized = (array - self.mean) / self.scale
        return standardized @ self.coefficient + self.intercept

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(
            path,
            mean=self.mean,
            scale=self.scale,
            coefficient=self.coefficient,
            intercept=np.asarray([self.intercept], dtype=np.float64),
            alpha=np.asarray([self.alpha], dtype=np.float64),
            feature_names=np.asarray(self.feature_names),
        )

    @classmethod
    def load(cls, path: Path) -> "StandardizedRidge":
        with np.load(path) as payload:
            return cls(
                mean=np.asarray(payload["mean"], dtype=np.float64),
                scale=np.asarray(payload["scale"], dtype=np.float64),
                coefficient=np.asarray(payload["coefficient"], dtype=np.float64),
                intercept=float(np.asarray(payload["intercept"]).reshape(-1)[0]),
                alpha=float(np.asarray(payload["alpha"]).reshape(-1)[0]),
                feature_names=tuple(str(value) for value in payload["feature_names"]),
            )


def fit_standardized_ridge(
    features: np.ndarray,
    targets: Iterable[float],
    alpha: float,
    feature_names: Iterable[str] | None = None,
) -> StandardizedRidge:
    x = np.asarray(features, dtype=np.float64)
    y = np.asarray(list(targets), dtype=np.float64)
    if x.ndim != 2 or y.ndim != 1 or len(x) != len(y):
        raise ValueError("features와 targets의 행 수가 일치해야 합니다.")
    if len(y) < 2 or not np.isfinite(x).all() or not np.isfinite(y).all():
        raise ValueError("ridge 학습에는 2개 이상의 유효한 행이 필요합니다.")
    if alpha <= 0:
        raise ValueError("alpha는 0보다 커야 합니다.")
    names = tuple(feature_names or (f"feature_{index}" for index in range(x.shape[1])))
    if len(names) != x.shape[1]:
        raise ValueError("feature_names 길이가 feature 열 수와 다릅니다.")

    mean = x.mean(axis=0)
    scale = x.std(axis=0)
    scale = np.where(scale < 1e-12, 1.0, scale)
    standardized = (x - mean) / scale
    intercept = float(y.mean())
    centered_target = y - intercept

    if standardized.shape[1] <= standardized.shape[0]:
        gram = standardized.T @ standardized
        coefficient = np.linalg.solve(
            gram + alpha * np.eye(gram.shape[0], dtype=np.float64),
            standardized.T @ centered_target,
        )
    else:
        gram = standardized @ standardized.T
        dual = np.linalg.solve(
            gram + alpha * np.eye(gram.shape[0], dtype=np.float64),
            centered_target,
        )
        coefficient = standardized.T @ dual

    return StandardizedRidge(
        mean=mean,
        scale=scale,
        coefficient=coefficient,
        intercept=intercept,
        alpha=float(alpha),
        feature_names=names,
    )


def _stable_order(value: str, seed: int) -> str:
    return hashlib.sha256(f"{seed}:{value}".encode("utf-8")).hexdigest()


def deterministic_clip_split(
    clip_ids: Iterable[str],
    validation_fraction: float = 0.2,
    seed: int = 20260716,
) -> tuple[list[str], list[str]]:
    ids = sorted(set(clip_ids), key=lambda value: _stable_order(value, seed))
    if len(ids) < 5 or not 0.0 < validation_fraction < 1.0:
        raise ValueError("분할에는 5개 이상의 clip과 0~1 사이 validation_fraction이 필요합니다.")
    validation_count = min(len(ids) - 1, max(1, round(len(ids) * validation_fraction)))
    validation = sorted(ids[:validation_count])
    training = sorted(ids[validation_count:])
    return training, validation


def _select_alpha(
    train_x: np.ndarray,
    train_y: np.ndarray,
    validation_x: np.ndarray,
    validation_y: np.ndarray,
    feature_names: list[str],
    alphas: Iterable[float],
) -> tuple[float, list[dict[str, Any]]]:
    trials: list[dict[str, Any]] = []
    for alpha in alphas:
        model = fit_standardized_ridge(train_x, train_y, float(alpha), feature_names)
        metrics = regression_metrics(validation_y, model.predict(validation_x))
        trials.append({"alpha": float(alpha), **metrics})
    ranked = sorted(
        trials,
        key=lambda row: (
            -(float(row["ccc"]) if row["ccc"] is not None else -np.inf),
            float(row["mae"]),
            float(row["alpha"]),
        ),
    )
    return float(ranked[0]["alpha"]), trials


def _cross_validated_calibration(
    clip_ids: list[str],
    predictions: np.ndarray,
    targets: np.ndarray,
    folds: int,
    seed: int,
) -> tuple[np.ndarray, dict[str, Any]]:
    if len(clip_ids) != len(predictions) or len(predictions) != len(targets):
        raise ValueError("calibration 입력 길이가 일치하지 않습니다.")
    fold_count = min(folds, len(clip_ids))
    if fold_count < 2:
        raise ValueError("교차검증 보정에는 2개 이상의 행이 필요합니다.")
    ordered = sorted(range(len(clip_ids)), key=lambda index: _stable_order(clip_ids[index], seed))
    fold_by_index = {row_index: position % fold_count for position, row_index in enumerate(ordered)}
    output = np.full(len(clip_ids), np.nan, dtype=np.float64)
    fold_reports: list[dict[str, Any]] = []
    for fold in range(fold_count):
        validation_indices = np.asarray(
            [index for index in range(len(clip_ids)) if fold_by_index[index] == fold],
            dtype=int,
        )
        training_indices = np.asarray(
            [index for index in range(len(clip_ids)) if fold_by_index[index] != fold],
            dtype=int,
        )
        calibrator = fit_affine_calibrator(predictions[training_indices], targets[training_indices])
        output[validation_indices] = calibrator.predict(predictions[validation_indices])
        fold_reports.append(
            {
                "fold": fold,
                "training_rows": len(training_indices),
                "validation_rows": len(validation_indices),
                "validation_clip_ids": [clip_ids[index] for index in validation_indices],
                "calibrator": calibrator.to_dict(),
            }
        )
    return output, {
        "folds": fold_count,
        "seed": seed,
        "metrics": regression_metrics(targets, output),
        "fold_reports": fold_reports,
    }


def _load_egemaps(path: Path) -> tuple[dict[tuple[str, str], np.ndarray], list[str]]:
    rows = read_csv(path)
    if not rows:
        raise ValueError("eGeMAPS CSV가 비어 있습니다.")
    feature_names = [name for name in rows[0] if name not in NON_FEATURE_COLUMNS]
    features: dict[tuple[str, str], np.ndarray] = {}
    for row in rows:
        key = (row["wav_id"], row["variant"])
        if key in features:
            raise ValueError(f"중복 eGeMAPS 행: {key}")
        array = np.asarray([float(row[name]) for name in feature_names], dtype=np.float64)
        if not np.isfinite(array).all():
            raise ValueError(f"비유한 eGeMAPS 값: {key}")
        features[key] = array
    return features, feature_names


def _load_embedding(path_text: str) -> np.ndarray:
    path = Path(path_text)
    array = np.asarray(np.load(path), dtype=np.float64).reshape(-1)
    if not np.isfinite(array).all():
        raise ValueError(f"비유한 embedding 값: {path}")
    return array


def _matrix_from_lookup(
    clip_ids: list[str],
    variant: str,
    lookup: dict[tuple[str, str], np.ndarray],
) -> np.ndarray:
    missing = [clip_id for clip_id in clip_ids if (clip_id, variant) not in lookup]
    if missing:
        raise ValueError(f"{variant} feature가 없는 clip {len(missing)}개: {missing[:5]}")
    return np.stack([lookup[(clip_id, variant)] for clip_id in clip_ids])


def _candidate_result(
    candidate_id: str,
    feature_type: str,
    feature_names: list[str],
    development_ids: list[str],
    silver_targets: dict[str, float],
    clean_lookup: dict[str, np.ndarray],
    telephone_lookup: dict[str, np.ndarray],
    calibration_ids: list[str],
    calibration_targets: np.ndarray,
    artifact_dir: Path,
    alpha_grid: tuple[float, ...],
    validation_fraction: float,
    seed: int,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    training_ids, validation_ids = deterministic_clip_split(
        development_ids,
        validation_fraction=validation_fraction,
        seed=seed,
    )
    train_x = np.stack([clean_lookup[clip_id] for clip_id in training_ids])
    train_y = np.asarray([silver_targets[clip_id] for clip_id in training_ids], dtype=np.float64)
    validation_x = np.stack([clean_lookup[clip_id] for clip_id in validation_ids])
    validation_y = np.asarray([silver_targets[clip_id] for clip_id in validation_ids], dtype=np.float64)
    selected_alpha, alpha_trials = _select_alpha(
        train_x,
        train_y,
        validation_x,
        validation_y,
        feature_names,
        alpha_grid,
    )

    development_x = np.stack([clean_lookup[clip_id] for clip_id in development_ids])
    development_y = np.asarray([silver_targets[clip_id] for clip_id in development_ids], dtype=np.float64)
    model = fit_standardized_ridge(development_x, development_y, selected_alpha, feature_names)
    artifact_path = artifact_dir / f"{candidate_id}.npz"
    model.save(artifact_path)

    calibration_clean_x = np.stack([clean_lookup[clip_id] for clip_id in calibration_ids])
    calibration_telephone_x = np.stack([telephone_lookup[clip_id] for clip_id in calibration_ids])
    base_clean = model.predict(calibration_clean_x)
    base_telephone = model.predict(calibration_telephone_x)
    cross_validated, calibration_cv = _cross_validated_calibration(
        calibration_ids,
        base_clean,
        calibration_targets,
        folds=5,
        seed=seed,
    )
    calibrator = fit_affine_calibrator(base_clean, calibration_targets)
    calibrated_clean = calibrator.predict(base_clean)
    calibrated_telephone = calibrator.predict(base_telephone)
    calibrator_path = artifact_dir / f"{candidate_id}_calibrator.json"
    write_json(
        calibrator_path,
        {
            **calibrator.to_dict(),
            "candidate_id": candidate_id,
            "fitted_rows": len(calibration_ids),
            "calibration_clip_ids": calibration_ids,
            "created_at": utc_now_iso(),
        },
    )

    prediction_rows = []
    for index, clip_id in enumerate(calibration_ids):
        prediction_rows.append(
            {
                "candidate_id": candidate_id,
                "clip_id": clip_id,
                "human_target": round(float(calibration_targets[index]), 6),
                "base_clean_prediction": round(float(base_clean[index]), 6),
                "cv_calibrated_clean_prediction": round(float(cross_validated[index]), 6),
                "final_calibrated_clean_prediction": round(float(calibrated_clean[index]), 6),
                "final_calibrated_telephone_prediction": round(float(calibrated_telephone[index]), 6),
            }
        )

    result = {
        "candidate_id": candidate_id,
        "feature_type": feature_type,
        "feature_count": len(feature_names),
        "model_artifact": str(artifact_path.resolve()),
        "model_artifact_sha256": sha256_file(artifact_path),
        "calibrator_artifact": str(calibrator_path.resolve()),
        "calibrator_artifact_sha256": sha256_file(calibrator_path),
        "selected_alpha": selected_alpha,
        "silver_development": {
            "rows": len(development_ids),
            "split_status": "EXPLORATORY_CLIP_LEVEL_ONLY",
            "speaker_session_leakage_gate": "BLOCKED_MISSING_SPEAKER_OR_SESSION_ID",
            "training_rows": len(training_ids),
            "validation_rows": len(validation_ids),
            "validation_metrics": next(
                row for row in alpha_trials if float(row["alpha"]) == selected_alpha
            ),
            "alpha_trials": alpha_trials,
        },
        "human_calibration": {
            "rows": len(calibration_ids),
            "cross_validated": calibration_cv,
            "final_calibrator": calibrator.to_dict(),
            "in_sample_clean_metrics": regression_metrics(calibration_targets, calibrated_clean),
            "robustness": robustness_metrics(
                calibration_targets,
                calibrated_clean,
                calibrated_telephone,
            ),
        },
    }
    return result, prediction_rows


def train_tabular_candidates(
    silver_path: Path,
    egemaps_path: Path,
    consensus_path: Path,
    artifact_dir: Path,
    report_json_path: Path,
    report_md_path: Path,
    predictions_path: Path,
    alpha_grid: tuple[float, ...] = (0.1, 1.0, 10.0, 100.0, 1000.0),
    validation_fraction: float = 0.2,
    seed: int = 20260716,
) -> dict[str, Any]:
    silver_rows = read_csv(silver_path)
    development_rows = [
        row
        for row in silver_rows
        if row.get("training_eligible", "").lower() == "true"
        and row.get("silver_use") == "SILVER_TRAIN_VALIDATION"
    ]
    if not development_rows:
        raise ValueError("학습 가능한 silver development 행이 없습니다.")
    development_ids = sorted(row["clip_id"] for row in development_rows)
    silver_targets = {row["clip_id"]: float(row["silver_score_0_100"]) for row in development_rows}
    silver_by_id = {row["clip_id"]: row for row in silver_rows}

    partitions = load_human_consensus_partitions(
        consensus_path,
        unlock_holdout=False,
        allow_unlabelable_calibration_exclusion=True,
    )
    calibration_rows = sorted(partitions["calibration"], key=lambda row: row["clip_id"])
    calibration_ids = [row["clip_id"] for row in calibration_rows]
    calibration_targets = np.asarray(
        [float(row["emotion_temperature_score"]) for row in calibration_rows],
        dtype=np.float64,
    )

    all_required_ids = sorted(set(development_ids) | set(calibration_ids))
    missing_silver = [clip_id for clip_id in all_required_ids if clip_id not in silver_by_id]
    if missing_silver:
        raise ValueError(f"silver manifest에서 찾을 수 없는 clip {len(missing_silver)}개가 있습니다.")

    egemaps_features, egemaps_names = _load_egemaps(egemaps_path)
    egemaps_clean_matrix = _matrix_from_lookup(all_required_ids, CLEAN_VARIANT, egemaps_features)
    egemaps_telephone_matrix = _matrix_from_lookup(
        all_required_ids,
        TELEPHONE_VARIANT,
        egemaps_features,
    )
    egemaps_clean = dict(zip(all_required_ids, egemaps_clean_matrix, strict=True))
    egemaps_telephone = dict(zip(all_required_ids, egemaps_telephone_matrix, strict=True))

    embedding_clean: dict[str, np.ndarray] = {}
    embedding_telephone: dict[str, np.ndarray] = {}
    for clip_id in all_required_ids:
        row = silver_by_id[clip_id]
        embedding_clean[clip_id] = _load_embedding(row["clean_embedding_path"])
        embedding_telephone[clip_id] = _load_embedding(row["telephone_embedding_path"])
    dimensions = {len(value) for value in embedding_clean.values()} | {
        len(value) for value in embedding_telephone.values()
    }
    if len(dimensions) != 1:
        raise ValueError(f"embedding 차원이 일치하지 않습니다: {sorted(dimensions)}")
    embedding_names = [f"embedding_{index:04d}" for index in range(next(iter(dimensions)))]

    artifact_dir.mkdir(parents=True, exist_ok=True)
    candidate_specs = [
        (
            "egemaps_ridge_v1",
            "eGeMAPSv02_functionals",
            egemaps_names,
            egemaps_clean,
            egemaps_telephone,
        ),
        (
            "audeering_embedding_ridge_v1",
            "audEERING_pooled_embedding",
            embedding_names,
            embedding_clean,
            embedding_telephone,
        ),
    ]
    candidate_results: list[dict[str, Any]] = []
    prediction_rows: list[dict[str, Any]] = []
    for candidate_id, feature_type, feature_names, clean_lookup, telephone_lookup in candidate_specs:
        result, rows = _candidate_result(
            candidate_id,
            feature_type,
            feature_names,
            development_ids,
            silver_targets,
            clean_lookup,
            telephone_lookup,
            calibration_ids,
            calibration_targets,
            artifact_dir,
            alpha_grid,
            validation_fraction,
            seed,
        )
        candidate_results.append(result)
        prediction_rows.extend(rows)

    ranked = sorted(
        candidate_results,
        key=lambda row: (
            -(
                float(row["human_calibration"]["cross_validated"]["metrics"]["ccc"])
                if row["human_calibration"]["cross_validated"]["metrics"]["ccc"] is not None
                else -np.inf
            ),
            float(row["human_calibration"]["cross_validated"]["metrics"]["mae"]),
            row["candidate_id"],
        ),
    )
    provisional = ranked[0]["candidate_id"]
    report = {
        "status": "TABULAR_CANDIDATES_COMPLETE_HOLDOUT_LOCKED",
        "created_at": utc_now_iso(),
        "selection_status": "PROVISIONAL_PENDING_PARTIAL_FINETUNE",
        "provisional_candidate_id": provisional,
        "candidate_ranking": [row["candidate_id"] for row in ranked],
        "holdout_accessed": False,
        "holdout_locked_count": partitions["holdout_locked_count"],
        "calibration_role_count": partitions["calibration_role_count"],
        "calibration_usable_count": partitions["calibration_usable_count"],
        "calibration_excluded": [
            {
                "clip_id": row["clip_id"],
                "consensus_status": row.get("consensus_status", ""),
                "adjudication_reason": row.get("adjudication_reason", ""),
            }
            for row in partitions["calibration_excluded"]
        ],
        "label_interpretation": (
            "THREE_RATER_POST_ADJUDICATION_CONSENSUS; "
            "VALID_MODELING_TARGET; NOT_INDEPENDENT_IAA_EVIDENCE"
        ),
        "speaker_session_leakage_gate": "BLOCKED_MISSING_SPEAKER_OR_SESSION_ID",
        "inputs": {
            "silver": {"path": str(silver_path.resolve()), "sha256": sha256_file(silver_path)},
            "egemaps": {"path": str(egemaps_path.resolve()), "sha256": sha256_file(egemaps_path)},
            "consensus": {
                "path": str(consensus_path.resolve()),
                "sha256": partitions["consensus_sha256"],
            },
        },
        "candidates": candidate_results,
        "next_gate": "TRAIN_AND_COMPARE_PARTIAL_FINETUNE_BEFORE_FREEZING_CANDIDATE",
    }
    write_json(report_json_path, report)
    write_csv(
        predictions_path,
        prediction_rows,
        [
            "candidate_id",
            "clip_id",
            "human_target",
            "base_clean_prediction",
            "cv_calibrated_clean_prediction",
            "final_calibrated_clean_prediction",
            "final_calibrated_telephone_prediction",
        ],
    )
    report_md_path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Emotion Temperature Tabular Candidate Comparison",
        "",
        f"- 상태: `{report['status']}`",
        f"- 임시 1위: `{provisional}`",
        f"- 실버 개발 clip: {len(development_ids)}",
        f"- 사람 보정 role/사용 가능: {partitions['calibration_role_count']}/{partitions['calibration_usable_count']}",
        f"- 잠긴 holdout: {partitions['holdout_locked_count']} (접근하지 않음)",
        "- 라벨 해석: 3인 사후 조정 합의 타깃. 독립 평가자 합의도 증거로 해석하지 않음.",
        "- 분할 한계: 화자/세션 ID 부재로 실버 검증은 탐색적 clip-level 결과임.",
        "",
        "## 후보 결과",
        "",
        "| 후보 | 실버 validation CCC | 보정 5-fold CCC | 보정 5-fold MAE | 전화품질 CCC |",
        "|---|---:|---:|---:|---:|",
    ]
    for row in ranked:
        silver_metrics = row["silver_development"]["validation_metrics"]
        cv_metrics = row["human_calibration"]["cross_validated"]["metrics"]
        telephone_metrics = row["human_calibration"]["robustness"]["telephone_8k"]
        lines.append(
            f"| {row['candidate_id']} | {silver_metrics['ccc']:.4f} | "
            f"{cv_metrics['ccc']:.4f} | {cv_metrics['mae']:.4f} | "
            f"{telephone_metrics['ccc']:.4f} |"
        )
    lines.extend(
        [
            "",
            "## 해석 제한",
            "",
            "- 이 순위는 partial fine-tuning 후보가 합류하기 전 임시 순위다.",
            "- 최종 후보를 동결하기 전까지 20개 HUMAN_HOLDOUT 라벨은 로드하지 않는다.",
            "- 1개 calibration clip은 세 평가자 모두 청취 불가로 판정하여 점수를 임의 생성하지 않고 제외했다.",
            "",
        ]
    )
    report_md_path.write_text("\n".join(lines), encoding="utf-8")
    return report


def _human_adapter_cv(
    candidate_id: str,
    feature_type: str,
    feature_names: list[str],
    clip_ids: list[str],
    targets: np.ndarray,
    clean_lookup: dict[str, np.ndarray],
    telephone_lookup: dict[str, np.ndarray],
    alpha_grid: tuple[float, ...],
    folds: int,
    seed: int,
    artifact_dir: Path,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    ordered = sorted(range(len(clip_ids)), key=lambda index: _stable_order(clip_ids[index], seed))
    fold_count = min(folds, len(clip_ids))
    fold_by_index = {row_index: position % fold_count for position, row_index in enumerate(ordered)}
    trials = []
    trial_predictions: dict[float, tuple[np.ndarray, np.ndarray]] = {}
    for alpha in alpha_grid:
        clean_prediction = np.full(len(clip_ids), np.nan, dtype=np.float64)
        telephone_prediction = np.full(len(clip_ids), np.nan, dtype=np.float64)
        for fold in range(fold_count):
            train_indices = [index for index in range(len(clip_ids)) if fold_by_index[index] != fold]
            validation_indices = [index for index in range(len(clip_ids)) if fold_by_index[index] == fold]
            model = fit_standardized_ridge(
                np.stack([clean_lookup[clip_ids[index]] for index in train_indices]),
                targets[train_indices],
                alpha,
                feature_names,
            )
            clean_prediction[validation_indices] = model.predict(
                np.stack([clean_lookup[clip_ids[index]] for index in validation_indices])
            )
            telephone_prediction[validation_indices] = model.predict(
                np.stack([telephone_lookup[clip_ids[index]] for index in validation_indices])
            )
        metrics = regression_metrics(targets, clean_prediction)
        trials.append({"alpha": float(alpha), **metrics})
        trial_predictions[float(alpha)] = (clean_prediction, telephone_prediction)
    ranked = sorted(
        trials,
        key=lambda row: (
            -(float(row["ccc"]) if row["ccc"] is not None else -np.inf),
            float(row["mae"]),
            float(row["alpha"]),
        ),
    )
    selected_alpha = float(ranked[0]["alpha"])
    cv_clean, cv_telephone = trial_predictions[selected_alpha]
    final_model = fit_standardized_ridge(
        np.stack([clean_lookup[clip_id] for clip_id in clip_ids]),
        targets,
        selected_alpha,
        feature_names,
    )
    artifact_path = artifact_dir / f"{candidate_id}.npz"
    final_model.save(artifact_path)
    rows = [
        {
            "candidate_id": candidate_id,
            "clip_id": clip_id,
            "fold": fold_by_index[index],
            "human_target": round(float(targets[index]), 6),
            "cv_clean_prediction": round(float(np.clip(cv_clean[index], 0.0, 100.0)), 6),
            "cv_telephone_prediction": round(float(np.clip(cv_telephone[index], 0.0, 100.0)), 6),
        }
        for index, clip_id in enumerate(clip_ids)
    ]
    clipped_clean = np.clip(cv_clean, 0.0, 100.0)
    clipped_telephone = np.clip(cv_telephone, 0.0, 100.0)
    return {
        "candidate_id": candidate_id,
        "feature_type": feature_type,
        "feature_count": len(feature_names),
        "selected_alpha": selected_alpha,
        "alpha_selection_note": "SAME_CALIBRATION_CV_USED_FOR_MODEL_SELECTION; HOLDOUT_REQUIRED_FOR_UNBIASED_REPORTING",
        "alpha_trials": trials,
        "cross_validated": {
            "clean_metrics": regression_metrics(targets, clipped_clean),
            "robustness": robustness_metrics(targets, clipped_clean, clipped_telephone),
            "folds": fold_count,
            "seed": seed,
        },
        "artifact": {
            "path": str(artifact_path.resolve()),
            "sha256": sha256_file(artifact_path),
        },
    }, rows


def train_human_adapter_candidates(
    silver_path: Path,
    egemaps_path: Path,
    consensus_path: Path,
    artifact_dir: Path,
    report_json_path: Path,
    report_md_path: Path,
    predictions_path: Path,
    alpha_grid: tuple[float, ...] = (1.0, 10.0, 100.0, 1000.0, 10000.0, 100000.0),
    folds: int = 5,
    seed: int = 20260716,
) -> dict[str, Any]:
    partitions = load_human_consensus_partitions(
        consensus_path,
        unlock_holdout=False,
        allow_unlabelable_calibration_exclusion=True,
    )
    calibration_rows = sorted(partitions["calibration"], key=lambda row: row["clip_id"])
    clip_ids = [row["clip_id"] for row in calibration_rows]
    targets = np.asarray([float(row["emotion_temperature_score"]) for row in calibration_rows])
    silver_by_id = {row["clip_id"]: row for row in read_csv(silver_path)}
    missing = [clip_id for clip_id in clip_ids if clip_id not in silver_by_id]
    if missing:
        raise ValueError(f"silver manifest에 없는 calibration clip: {missing}")

    egemaps_features, egemaps_names = _load_egemaps(egemaps_path)
    egemaps_clean = {
        clip_id: egemaps_features[(clip_id, CLEAN_VARIANT)]
        for clip_id in clip_ids
    }
    egemaps_telephone = {
        clip_id: egemaps_features[(clip_id, TELEPHONE_VARIANT)]
        for clip_id in clip_ids
    }
    embedding_clean = {
        clip_id: _load_embedding(silver_by_id[clip_id]["clean_embedding_path"])
        for clip_id in clip_ids
    }
    embedding_telephone = {
        clip_id: _load_embedding(silver_by_id[clip_id]["telephone_embedding_path"])
        for clip_id in clip_ids
    }
    embedding_dimension = len(next(iter(embedding_clean.values())))
    embedding_names = [f"embedding_{index:04d}" for index in range(embedding_dimension)]

    artifact_dir.mkdir(parents=True, exist_ok=True)
    candidates = []
    prediction_rows = []
    for candidate_id, feature_type, feature_names, clean_lookup, telephone_lookup in (
        (
            "egemaps_human_ridge_v1",
            "eGeMAPSv02_direct_human_adapter",
            egemaps_names,
            egemaps_clean,
            egemaps_telephone,
        ),
        (
            "audeering_embedding_human_ridge_v1",
            "audEERING_embedding_direct_human_adapter",
            embedding_names,
            embedding_clean,
            embedding_telephone,
        ),
    ):
        result, rows = _human_adapter_cv(
            candidate_id,
            feature_type,
            feature_names,
            clip_ids,
            targets,
            clean_lookup,
            telephone_lookup,
            alpha_grid,
            folds,
            seed,
            artifact_dir,
        )
        candidates.append(result)
        prediction_rows.extend(rows)

    mean_prediction = np.full(len(targets), float(targets.mean()))
    baseline = {
        "candidate_id": "calibration_mean_baseline",
        "cross_validated": {
            "clean_metrics": regression_metrics(targets, mean_prediction),
        },
    }
    ranked = sorted(
        candidates,
        key=lambda row: (
            -(
                float(row["cross_validated"]["clean_metrics"]["ccc"])
                if row["cross_validated"]["clean_metrics"]["ccc"] is not None
                else -np.inf
            ),
            float(row["cross_validated"]["clean_metrics"]["mae"]),
        ),
    )
    best = ranked[0]
    best_metrics = best["cross_validated"]["clean_metrics"]
    baseline_metrics = baseline["cross_validated"]["clean_metrics"]
    ranking_signal_found = (
        best_metrics["ccc"] is not None
        and float(best_metrics["ccc"]) >= 0.2
        and best_metrics["spearman"] is not None
        and float(best_metrics["spearman"]) >= 0.2
    )
    readiness = (
        "CALIBRATION_RANKING_SIGNAL_FOUND_PENDING_HOLDOUT"
        if ranking_signal_found
        else "BLOCKED_NO_CROSS_VALIDATED_RANKING_SIGNAL"
    )
    report = {
        "status": "HUMAN_ADAPTER_CANDIDATES_COMPLETE_HOLDOUT_LOCKED",
        "created_at": utc_now_iso(),
        "readiness": readiness,
        "provisional_candidate_id": best["candidate_id"],
        "holdout_accessed": False,
        "holdout_locked_count": partitions["holdout_locked_count"],
        "calibration_usable_count": partitions["calibration_usable_count"],
        "label_interpretation": (
            "THREE_RATER_POST_ADJUDICATION_CONSENSUS; "
            "VALID_MODELING_TARGET; NOT_INDEPENDENT_IAA_EVIDENCE"
        ),
        "speaker_session_leakage_gate": "BLOCKED_MISSING_SPEAKER_OR_SESSION_ID",
        "baseline": baseline,
        "guardrails": {
            "primary_selection_metric": "CCC",
            "minimum_calibration_ccc": 0.2,
            "minimum_calibration_spearman": 0.2,
            "beats_mean_baseline_mae": float(best_metrics["mae"]) < float(baseline_metrics["mae"]),
            "mae_caveat": (
                "Selected model preserves ranking signal but does not beat the constant-mean MAE baseline."
                if float(best_metrics["mae"]) >= float(baseline_metrics["mae"])
                else ""
            ),
        },
        "candidates": candidates,
    }
    write_json(report_json_path, report)
    write_csv(
        predictions_path,
        prediction_rows,
        [
            "candidate_id",
            "clip_id",
            "fold",
            "human_target",
            "cv_clean_prediction",
            "cv_telephone_prediction",
        ],
    )
    lines = [
        "# Direct Human-label Adapter Candidates",
        "",
        f"- 상태: `{report['status']}`",
        f"- 준비 판정: `{readiness}`",
        f"- 임시 후보: `{best['candidate_id']}`",
        f"- 평균 baseline MAE: {baseline_metrics['mae']:.4f}",
        f"- 잠긴 holdout: {partitions['holdout_locked_count']} (접근하지 않음)",
        "",
        "| 후보 | CV CCC | CV MAE | Telephone CCC |",
        "|---|---:|---:|---:|",
    ]
    for row in ranked:
        metrics = row["cross_validated"]["clean_metrics"]
        telephone = row["cross_validated"]["robustness"]["telephone_8k"]
        lines.append(
            f"| {row['candidate_id']} | {metrics['ccc']:.4f} | "
            f"{metrics['mae']:.4f} | {telephone['ccc']:.4f} |"
        )
    lines.extend(
        [
            "",
            "동일 calibration 교차검증으로 alpha를 선택했으므로 이 수치는 후보 선택용이다.",
            "편향되지 않은 최종 수치는 후보 동결 후 20개 holdout에서 한 번만 산출해야 한다.",
            "",
        ]
    )
    report_md_path.parent.mkdir(parents=True, exist_ok=True)
    report_md_path.write_text("\n".join(lines), encoding="utf-8")
    return report


def freeze_and_evaluate_egemaps_holdout(
    candidate_report_path: Path,
    consensus_path: Path,
    egemaps_path: Path,
    candidate_artifact_path: Path,
    frozen_manifest_path: Path,
    predictions_path: Path,
    report_json_path: Path,
    report_md_path: Path,
    bootstrap_iterations: int = 2000,
    seed: int = 20260716,
) -> dict[str, Any]:
    candidate_report = json.loads(candidate_report_path.read_text(encoding="utf-8"))
    if candidate_report.get("readiness") != "CALIBRATION_RANKING_SIGNAL_FOUND_PENDING_HOLDOUT":
        raise ValueError("사전 정의한 calibration ranking signal gate를 통과하지 못했습니다.")
    candidate_id = candidate_report["provisional_candidate_id"]
    if candidate_id != "egemaps_human_ridge_v1":
        raise ValueError(f"이 평가기는 eGeMAPS 최종 후보만 지원합니다: {candidate_id}")
    artifact_sha256 = sha256_file(candidate_artifact_path)
    expected = next(
        row["artifact"]["sha256"]
        for row in candidate_report["candidates"]
        if row["candidate_id"] == candidate_id
    )
    if artifact_sha256 != expected:
        raise ValueError("동결 대상 artifact hash가 후보 보고서와 다릅니다.")

    frozen_manifest = {
        "candidate_id": candidate_id,
        "model_artifact_path": str(candidate_artifact_path.resolve()),
        "model_artifact_sha256": artifact_sha256,
        "selection_completed_at": utc_now_iso(),
        "holdout_unlocked": True,
        "selection_evidence": {
            "candidate_report_path": str(candidate_report_path.resolve()),
            "candidate_report_sha256": sha256_file(candidate_report_path),
            "primary_metric": "calibration_cross_validated_CCC",
            "calibration_ccc": next(
                row["cross_validated"]["clean_metrics"]["ccc"]
                for row in candidate_report["candidates"]
                if row["candidate_id"] == candidate_id
            ),
            "known_caveat": candidate_report["guardrails"]["mae_caveat"],
        },
    }
    write_json(frozen_manifest_path, frozen_manifest)

    partitions = load_human_consensus_partitions(
        consensus_path,
        unlock_holdout=True,
        frozen_candidate_manifest=frozen_manifest_path,
        allow_unlabelable_calibration_exclusion=True,
    )
    holdout_rows = sorted(partitions["holdout"], key=lambda row: row["clip_id"])
    clip_ids = [row["clip_id"] for row in holdout_rows]
    targets = np.asarray([float(row["emotion_temperature_score"]) for row in holdout_rows])
    features, feature_names = _load_egemaps(egemaps_path)
    model = StandardizedRidge.load(candidate_artifact_path)
    if tuple(feature_names) != model.feature_names:
        raise ValueError("eGeMAPS feature 순서가 동결 artifact와 다릅니다.")
    clean = model.predict(_matrix_from_lookup(clip_ids, CLEAN_VARIANT, features))
    telephone = model.predict(_matrix_from_lookup(clip_ids, TELEPHONE_VARIANT, features))
    clean = np.clip(clean, 0.0, 100.0)
    telephone = np.clip(telephone, 0.0, 100.0)
    metrics = robustness_metrics(targets, clean, telephone)
    bootstrap = bootstrap_regression_metrics(
        targets,
        clean,
        iterations=bootstrap_iterations,
        seed=seed,
    )
    rows = [
        {
            "clip_id": clip_id,
            "human_target": round(float(targets[index]), 6),
            "clean_prediction": round(float(clean[index]), 6),
            "telephone_prediction": round(float(telephone[index]), 6),
            "absolute_error_clean": round(float(abs(targets[index] - clean[index])), 6),
        }
        for index, clip_id in enumerate(clip_ids)
    ]
    write_csv(
        predictions_path,
        rows,
        [
            "clip_id",
            "human_target",
            "clean_prediction",
            "telephone_prediction",
            "absolute_error_clean",
        ],
    )
    clean_metrics = metrics["clean"]
    meaningful = (
        clean_metrics["ccc"] is not None
        and float(clean_metrics["ccc"]) >= 0.2
        and clean_metrics["spearman"] is not None
        and float(clean_metrics["spearman"]) >= 0.2
    )
    report = {
        "status": "FINAL_HOLDOUT_EVALUATION_COMPLETE",
        "deployment_readiness": (
            "LIMITED_SHADOW_MODE_ONLY" if meaningful else "NOT_READY_MORE_HUMAN_LABELS_REQUIRED"
        ),
        "created_at": utc_now_iso(),
        "candidate_id": candidate_id,
        "holdout_accessed_once": True,
        "holdout_rows": len(holdout_rows),
        "metrics": metrics,
        "bootstrap_clean": bootstrap,
        "speaker_session_leakage_gate": "BLOCKED_MISSING_SPEAKER_OR_SESSION_ID",
        "label_interpretation": (
            "THREE_RATER_POST_ADJUDICATION_CONSENSUS; "
            "VALID_MODELING_TARGET; NOT_INDEPENDENT_IAA_EVIDENCE"
        ),
        "frozen_candidate_evidence": partitions["candidate_evidence"],
        "inputs": {
            "consensus_sha256": partitions["consensus_sha256"],
            "egemaps_sha256": sha256_file(egemaps_path),
        },
    }
    write_json(report_json_path, report)
    ci = bootstrap["metrics"]["ccc"]
    lines = [
        "# Final Emotion Temperature Holdout Evaluation",
        "",
        f"- 상태: `{report['status']}`",
        f"- 배포 준비: `{report['deployment_readiness']}`",
        f"- 동결 후보: `{candidate_id}`",
        f"- holdout: {len(holdout_rows)}개, 후보 동결 후 1회 접근",
        f"- clean CCC: {clean_metrics['ccc']:.4f}",
        f"- clean CCC 95% bootstrap CI: [{ci['lower']:.4f}, {ci['upper']:.4f}]",
        f"- clean MAE: {clean_metrics['mae']:.4f}",
        f"- clean Spearman: {clean_metrics['spearman']:.4f}",
        f"- telephone CCC: {metrics['telephone_8k']['ccc']:.4f}",
        f"- telephone MAE: {metrics['telephone_8k']['mae']:.4f}",
        "",
        "화자/세션 ID가 없어 speaker-independent 성능으로 주장할 수 없다.",
        "라벨은 3인 사후 조정 합의 결과이며 독립 평가자 합의도 증거가 아니다.",
        "",
    ]
    report_md_path.parent.mkdir(parents=True, exist_ok=True)
    report_md_path.write_text("\n".join(lines), encoding="utf-8")
    return report
