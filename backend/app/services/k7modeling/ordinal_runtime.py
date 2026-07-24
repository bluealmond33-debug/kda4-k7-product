from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable

import numpy as np

from .ordinal_v3 import LEVEL_NAMES, ORDINAL_LEVELS, _predict_lgbm_cumulative


def select_ordinal_level(
    probabilities: np.ndarray,
    high_threshold: float | None = None,
) -> int:
    vector = np.asarray(probabilities, dtype=np.float64)
    if vector.shape != (3,) or not np.isfinite(vector).all() or vector.sum() <= 0:
        raise ValueError("유효한 low/medium/high 확률 3개가 필요합니다.")
    vector = vector / vector.sum()
    if high_threshold is None:
        return int(np.argmax(vector))
    if not 0.0 < high_threshold < 1.0:
        raise ValueError("high_threshold는 0보다 크고 1보다 작아야 합니다.")
    if vector[2] >= high_threshold:
        return 2
    return int(np.argmax(vector[:2]))


def predict_ordinal_egemaps(
    artifact_path: Path,
    egemaps_features: np.ndarray,
    audio_quality: str = "valid",
    high_threshold: float | None = None,
) -> dict[str, Any]:
    import joblib

    features = np.asarray(egemaps_features, dtype=np.float32)
    if features.ndim == 1:
        features = features.reshape(1, -1)
    if features.shape != (1, 88) or not np.isfinite(features).all():
        raise ValueError("eGeMAPS 입력은 유효한 88차원 단일 벡터여야 합니다.")
    artifact = joblib.load(artifact_path)
    fold_models = artifact.get("fold_models")
    if not fold_models:
        raise ValueError("artifact에 ordinal fold model이 없습니다.")
    probabilities = np.mean(
        np.stack(
            [_predict_lgbm_cumulative(models, features)[0] for models in fold_models],
            axis=0,
        ),
        axis=0,
    )
    artifact_threshold = artifact.get("decision_policy", {}).get("high_threshold")
    applied_high_threshold = (
        high_threshold if high_threshold is not None else artifact_threshold
    )
    level = select_ordinal_level(probabilities, applied_high_threshold)
    return {
        "emotion_temperature_level": level,
        "label": LEVEL_NAMES[level],
        "confidence": round(float(probabilities[level]), 6),
        "audio_quality": audio_quality,
        "probabilities": {
            "low": round(float(probabilities[0]), 6),
            "medium": round(float(probabilities[1]), 6),
            "high": round(float(probabilities[2]), 6),
        },
        "model_status": "research_shadow_only",
        "decision_policy": {
            "type": "argmax" if applied_high_threshold is None else "high_threshold",
            "high_threshold": applied_high_threshold,
        },
    }


def summarize_emotion_trajectory(
    predictions: Iterable[dict[str, Any]],
    smoothing: float = 0.45,
    recent_window: int = 3,
    rise_threshold: float = 0.30,
    high_threshold: float | None = None,
) -> dict[str, Any]:
    rows = list(predictions)
    if not rows:
        raise ValueError("통화 추세를 계산할 발화 예측이 없습니다.")
    if not 0.0 < smoothing <= 1.0:
        raise ValueError("smoothing은 0보다 크고 1 이하여야 합니다.")
    probability_rows: list[np.ndarray] = []
    for row in rows:
        if row.get("audio_quality", "valid") != "valid":
            continue
        probabilities = row.get("probabilities")
        if probabilities is None:
            level = int(row["emotion_temperature_level"])
            confidence = float(row.get("confidence", 1.0))
            remaining = max(0.0, 1.0 - confidence) / 2.0
            vector = np.full(3, remaining, dtype=np.float64)
            vector[level] = confidence
        else:
            vector = np.asarray(
                [probabilities["low"], probabilities["medium"], probabilities["high"]],
                dtype=np.float64,
            )
        if vector.shape != (3,) or not np.isfinite(vector).all() or vector.sum() <= 0:
            raise ValueError("유효하지 않은 발화 확률입니다.")
        probability_rows.append(vector / vector.sum())
    if not probability_rows:
        return {
            "emotion_temperature_level": None,
            "label": "unknown",
            "confidence": 0.0,
            "audio_quality": "invalid",
            "trend": "unknown",
            "escalation_signal": False,
            "valid_segments": 0,
            "policy_status": "research_shadow_only",
        }

    smoothed: list[np.ndarray] = []
    state = probability_rows[0]
    smoothed.append(state.copy())
    for vector in probability_rows[1:]:
        state = smoothing * vector + (1.0 - smoothing) * state
        state = state / state.sum()
        smoothed.append(state.copy())
    expected = np.asarray(
        [vector @ np.asarray(ORDINAL_LEVELS, dtype=np.float64) for vector in smoothed]
    )
    current = smoothed[-1]
    current_level = select_ordinal_level(current, high_threshold)
    if len(expected) >= recent_window * 2:
        previous_mean = float(np.mean(expected[-2 * recent_window : -recent_window]))
        recent_mean = float(np.mean(expected[-recent_window:]))
    elif len(expected) >= 2:
        previous_mean = float(expected[0])
        recent_mean = float(np.mean(expected[-min(recent_window, len(expected)) :]))
    else:
        previous_mean = recent_mean = float(expected[-1])
    delta = recent_mean - previous_mean
    high_votes = sum(
        select_ordinal_level(vector, high_threshold) == 2
        for vector in probability_rows[-recent_window:]
    )
    escalation_signal = bool(
        delta >= rise_threshold
        or (current_level == 2 and high_votes >= min(2, len(probability_rows)))
    )
    if delta >= rise_threshold:
        trend = "rising"
    elif delta <= -rise_threshold:
        trend = "falling"
    else:
        trend = "stable"
    return {
        "emotion_temperature_level": current_level,
        "label": LEVEL_NAMES[current_level],
        "confidence": round(float(current[current_level]), 6),
        "audio_quality": "valid",
        "trend": trend,
        "escalation_signal": escalation_signal,
        "expected_level": round(float(expected[-1]), 6),
        "recent_expected_level_change": round(delta, 6),
        "valid_segments": len(probability_rows),
        "policy_status": "research_shadow_only",
        "decision_policy": {
            "type": "argmax" if high_threshold is None else "high_threshold",
            "high_threshold": high_threshold,
        },
    }
