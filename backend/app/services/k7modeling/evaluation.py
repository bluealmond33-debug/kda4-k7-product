from __future__ import annotations

import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from scipy.stats import spearmanr

from .io_utils import read_csv, sha256_file


class MissingGroupKeyError(ValueError):
    pass


class HoldoutLockedError(PermissionError):
    pass


def _finite_pair(y_true: Iterable[float], y_pred: Iterable[float]) -> tuple[np.ndarray, np.ndarray]:
    truth = np.asarray(list(y_true), dtype=np.float64)
    pred = np.asarray(list(y_pred), dtype=np.float64)
    if truth.shape != pred.shape or truth.ndim != 1:
        raise ValueError("y_true와 y_pred는 길이가 같은 1차원이어야 합니다.")
    mask = np.isfinite(truth) & np.isfinite(pred)
    if not mask.any():
        raise ValueError("유효한 target/prediction 쌍이 없습니다.")
    return truth[mask], pred[mask]


def concordance_correlation_coefficient(y_true: Iterable[float], y_pred: Iterable[float]) -> float | None:
    truth, pred = _finite_pair(y_true, y_pred)
    if len(truth) < 2:
        return None
    mean_true = float(truth.mean())
    mean_pred = float(pred.mean())
    variance_true = float(np.mean(np.square(truth - mean_true)))
    variance_pred = float(np.mean(np.square(pred - mean_pred)))
    covariance = float(np.mean((truth - mean_true) * (pred - mean_pred)))
    denominator = variance_true + variance_pred + (mean_true - mean_pred) ** 2
    if denominator <= 1e-12:
        return 1.0 if np.allclose(truth, pred) else None
    return float(2.0 * covariance / denominator)


def regression_metrics(y_true: Iterable[float], y_pred: Iterable[float]) -> dict[str, float | int | None]:
    truth, pred = _finite_pair(y_true, y_pred)
    correlation = spearmanr(truth, pred).statistic if len(truth) >= 2 else np.nan
    return {
        "n": len(truth),
        "ccc": concordance_correlation_coefficient(truth, pred),
        "mae": float(np.mean(np.abs(truth - pred))),
        "spearman": float(correlation) if np.isfinite(correlation) else None,
    }


def bootstrap_regression_metrics(
    y_true: Iterable[float],
    y_pred: Iterable[float],
    iterations: int = 2000,
    seed: int = 20260716,
    confidence: float = 0.95,
) -> dict[str, Any]:
    truth, pred = _finite_pair(y_true, y_pred)
    if len(truth) < 2 or iterations < 1:
        raise ValueError("bootstrap에는 2개 이상의 쌍과 1회 이상의 반복이 필요합니다.")
    generator = np.random.default_rng(seed)
    samples: dict[str, list[float]] = {"ccc": [], "mae": [], "spearman": []}
    for _ in range(iterations):
        indices = generator.integers(0, len(truth), size=len(truth))
        values = regression_metrics(truth[indices], pred[indices])
        for name in samples:
            value = values[name]
            if value is not None and np.isfinite(value):
                samples[name].append(float(value))
    alpha = (1.0 - confidence) / 2.0
    intervals = {}
    for name, values in samples.items():
        array = np.asarray(values, dtype=np.float64)
        intervals[name] = {
            "estimate": regression_metrics(truth, pred)[name],
            "lower": float(np.quantile(array, alpha)) if len(array) else None,
            "upper": float(np.quantile(array, 1.0 - alpha)) if len(array) else None,
            "usable_bootstrap_samples": len(array),
        }
    return {
        "n": len(truth),
        "iterations": iterations,
        "seed": seed,
        "confidence": confidence,
        "metrics": intervals,
    }


def robustness_metrics(
    y_true: Iterable[float],
    clean_pred: Iterable[float],
    telephone_pred: Iterable[float],
) -> dict[str, Any]:
    truth, clean = _finite_pair(y_true, clean_pred)
    truth_telephone, telephone = _finite_pair(y_true, telephone_pred)
    if not np.array_equal(truth, truth_telephone) or clean.shape != telephone.shape:
        raise ValueError("clean/telephone 평가는 같은 target 순서와 길이를 사용해야 합니다.")
    clean_metrics = regression_metrics(truth, clean)
    telephone_metrics = regression_metrics(truth, telephone)
    return {
        "clean": clean_metrics,
        "telephone_8k": telephone_metrics,
        "mean_absolute_prediction_shift": float(np.mean(np.abs(clean - telephone))),
        "p95_absolute_prediction_shift": float(np.quantile(np.abs(clean - telephone), 0.95)),
        "ccc_drop": (
            float(clean_metrics["ccc"] - telephone_metrics["ccc"])
            if clean_metrics["ccc"] is not None and telephone_metrics["ccc"] is not None
            else None
        ),
        "mae_increase": float(telephone_metrics["mae"] - clean_metrics["mae"]),
    }


@dataclass(frozen=True)
class AffineCalibrator:
    slope: float
    intercept: float
    clip_min: float = 0.0
    clip_max: float = 100.0
    version: str = "validation-affine-v1"

    def predict(self, values: Iterable[float]) -> np.ndarray:
        array = np.asarray(list(values), dtype=np.float64)
        return np.clip(self.slope * array + self.intercept, self.clip_min, self.clip_max)

    def to_dict(self) -> dict[str, float | str]:
        return {
            "slope": self.slope,
            "intercept": self.intercept,
            "clip_min": self.clip_min,
            "clip_max": self.clip_max,
            "version": self.version,
        }


def fit_affine_calibrator(
    validation_predictions: Iterable[float],
    validation_targets: Iterable[float],
    ridge: float = 1e-6,
) -> AffineCalibrator:
    pred, target = _finite_pair(validation_predictions, validation_targets)
    design = np.column_stack([pred, np.ones_like(pred)])
    penalty = np.diag([ridge, 0.0])
    slope, intercept = np.linalg.solve(design.T @ design + penalty, design.T @ target)
    return AffineCalibrator(float(slope), float(intercept))


def grouped_train_validation_split(
    rows: list[dict[str, str]],
    group_field: str = "speaker_group",
    validation_fraction: float = 0.2,
    seed: int = 20260716,
) -> tuple[list[dict[str, str]], list[dict[str, str]], dict[str, Any]]:
    if not 0.0 < validation_fraction < 1.0:
        raise ValueError("validation_fraction은 0과 1 사이여야 합니다.")
    missing = [row.get("clip_id", "") for row in rows if not str(row.get(group_field, "")).strip()]
    if missing:
        raise MissingGroupKeyError(
            f"{group_field}가 없는 {len(missing)}개 행 때문에 leakage-safe split을 만들 수 없습니다."
        )
    groups = sorted({str(row[group_field]) for row in rows})
    if len(groups) < 2:
        raise MissingGroupKeyError("서로 다른 화자/세션 그룹이 2개 미만입니다.")
    random.Random(seed).shuffle(groups)
    validation_group_count = min(len(groups) - 1, max(1, round(len(groups) * validation_fraction)))
    validation_groups = set(groups[:validation_group_count])
    train = [row for row in rows if str(row[group_field]) not in validation_groups]
    validation = [row for row in rows if str(row[group_field]) in validation_groups]
    train_groups = {str(row[group_field]) for row in train}
    validation_groups_actual = {str(row[group_field]) for row in validation}
    if train_groups & validation_groups_actual:
        raise AssertionError("group split 누수가 발생했습니다.")
    report = {
        "status": "GROUP_SPLIT_READY",
        "group_field": group_field,
        "seed": seed,
        "train_rows": len(train),
        "validation_rows": len(validation),
        "train_groups": len(train_groups),
        "validation_groups": len(validation_groups_actual),
        "group_overlap": sorted(train_groups & validation_groups_actual),
    }
    return train, validation, report


def load_human_consensus_partitions(
    consensus_path: Path,
    expected_calibration: int = 30,
    expected_holdout: int = 20,
    unlock_holdout: bool = False,
    frozen_candidate_manifest: Path | None = None,
    allow_unlabelable_calibration_exclusion: bool = False,
) -> dict[str, Any]:
    rows = read_csv(consensus_path)
    calibration_all = [row for row in rows if row.get("hybrid_role") == "CALIBRATION"]
    holdout_all = [row for row in rows if row.get("hybrid_role") == "HUMAN_HOLDOUT"]
    if len(calibration_all) != expected_calibration or len(holdout_all) != expected_holdout:
        raise ValueError(
            f"human 역할 개수가 다릅니다: calibration={len(calibration_all)}, holdout={len(holdout_all)}"
        )
    holdout_not_ready = [row["clip_id"] for row in holdout_all if row.get("consensus_status") != "READY"]
    if holdout_not_ready:
        raise ValueError(f"잠금 holdout에 미합의 또는 판단 불가 clip이 {len(holdout_not_ready)}개 있습니다.")
    calibration_not_ready = [row for row in calibration_all if row.get("consensus_status") != "READY"]
    excluded_calibration: list[dict[str, str]] = []
    if calibration_not_ready:
        allowed = allow_unlabelable_calibration_exclusion and all(
            "UNLABELABLE_AUDIO" in row.get("adjudication_reason", "")
            for row in calibration_not_ready
        )
        if not allowed:
            raise ValueError(f"재심사가 끝나지 않은 calibration consensus가 {len(calibration_not_ready)}개 있습니다.")
        excluded_calibration = calibration_not_ready
    calibration = [row for row in calibration_all if row.get("consensus_status") == "READY"]
    candidate_evidence = None
    exposed_holdout: list[dict[str, str]] = []
    if unlock_holdout:
        if frozen_candidate_manifest is None or not frozen_candidate_manifest.exists():
            raise HoldoutLockedError("holdout 해제 전 frozen candidate manifest가 필요합니다.")
        payload = json.loads(frozen_candidate_manifest.read_text(encoding="utf-8"))
        required = {"candidate_id", "model_artifact_sha256", "selection_completed_at", "holdout_unlocked"}
        if not required.issubset(payload) or payload.get("holdout_unlocked") is not True:
            raise HoldoutLockedError("frozen candidate manifest의 잠금 해제 계약이 유효하지 않습니다.")
        candidate_evidence = {
            "path": str(frozen_candidate_manifest.resolve()),
            "sha256": sha256_file(frozen_candidate_manifest),
            "candidate_id": payload["candidate_id"],
            "model_artifact_sha256": payload["model_artifact_sha256"],
        }
        exposed_holdout = holdout_all
    return {
        "calibration": calibration,
        "holdout": exposed_holdout,
        "calibration_role_count": len(calibration_all),
        "calibration_usable_count": len(calibration),
        "calibration_excluded": excluded_calibration,
        "holdout_locked_count": len(holdout_all) if not unlock_holdout else 0,
        "candidate_evidence": candidate_evidence,
        "consensus_sha256": sha256_file(consensus_path),
    }
