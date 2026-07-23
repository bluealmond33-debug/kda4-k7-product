from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable

import numpy as np

from .io_utils import read_csv, sha256_file, utc_now_iso, write_csv, write_json
from .ordinal_runtime import select_ordinal_level
from .ordinal_v3 import (
    LEVEL_NAMES,
    ORDINAL_LEVELS,
    _fit_lgbm_cumulative,
    _predict_lgbm_cumulative,
)
from .prosody_fusion import _load_egemaps_aligned


def evaluate_high_policy(
    truth: np.ndarray,
    probabilities: np.ndarray,
    high_threshold: float | None,
) -> dict[str, Any]:
    from sklearn.metrics import (
        balanced_accuracy_score,
        cohen_kappa_score,
        confusion_matrix,
        f1_score,
        fbeta_score,
        precision_recall_fscore_support,
    )

    labels = np.asarray(truth, dtype=int)
    scores = np.asarray(probabilities, dtype=np.float64)
    if scores.ndim != 2 or scores.shape[1] != 3 or len(labels) != len(scores):
        raise ValueError("정답과 3-class 확률 shape가 맞지 않습니다.")
    predicted = np.asarray(
        [select_ordinal_level(row, high_threshold) for row in scores], dtype=int
    )
    precision, recall, f1, support = precision_recall_fscore_support(
        labels,
        predicted,
        labels=ORDINAL_LEVELS,
        zero_division=0,
    )
    high_truth = labels == 2
    high_predicted = predicted == 2
    return {
        "rows": int(len(labels)),
        "high_threshold": high_threshold,
        "balanced_accuracy": float(balanced_accuracy_score(labels, predicted)),
        "macro_f1": float(f1_score(labels, predicted, average="macro", zero_division=0)),
        "quadratic_weighted_kappa": float(
            cohen_kappa_score(labels, predicted, weights="quadratic")
        ),
        "high_f2": float(
            fbeta_score(high_truth, high_predicted, beta=2, zero_division=0)
        ),
        "per_class": {
            str(level): {
                "name": LEVEL_NAMES[level],
                "precision": float(precision[level]),
                "recall": float(recall[level]),
                "f1": float(f1[level]),
                "support": int(support[level]),
            }
            for level in ORDINAL_LEVELS
        },
        "confusion_matrix": confusion_matrix(
            labels, predicted, labels=ORDINAL_LEVELS
        ).tolist(),
        "predicted_high": int(high_predicted.sum()),
    }


def _candidate_tier(clean: dict[str, Any], telephone: dict[str, Any]) -> str:
    clean_high = clean["per_class"]["2"]
    telephone_high = telephone["per_class"]["2"]
    common = (
        clean_high["precision"] >= 0.35
        and telephone_high["precision"] >= 0.35
        and clean["macro_f1"] >= 0.52
        and telephone["macro_f1"] >= 0.52
        and abs(clean_high["recall"] - telephone_high["recall"]) <= 0.06
    )
    if (
        common
        and clean_high["recall"] >= 0.60
        and telephone_high["recall"] >= 0.60
    ):
        return "TARGET_60_RECALL"
    if (
        common
        and clean_high["recall"] >= 0.55
        and telephone_high["recall"] >= 0.55
    ):
        return "BALANCED_DEMO"
    return "REJECT"


def _selection_key(candidate: dict[str, Any]) -> tuple[float, float, float]:
    tier_score = {
        "TARGET_60_RECALL": 2.0,
        "BALANCED_DEMO": 1.0,
        "REJECT": 0.0,
    }[candidate["tier"]]
    clean = candidate["clean_metrics"]
    telephone = candidate["telephone_metrics"]
    return (
        tier_score,
        min(clean["high_f2"], telephone["high_f2"]),
        (clean["macro_f1"] + telephone["macro_f1"]) / 2.0,
    )


def train_high_focus_demo_v4(
    clean_manifest_path: Path,
    clean_egemaps_path: Path,
    clean_egemaps_index_path: Path,
    telephone_manifest_path: Path,
    telephone_egemaps_path: Path,
    telephone_egemaps_index_path: Path,
    artifact_path: Path,
    predictions_path: Path,
    report_json_path: Path,
    report_md_path: Path,
    high_weights: Iterable[float] = (1.0, 1.25, 1.5, 2.0, 2.5),
    high_thresholds: Iterable[float] = (0.30, 0.25, 0.20),
    seed: int = 20260717,
) -> dict[str, Any]:
    import joblib

    clean_rows = read_csv(clean_manifest_path)
    telephone_rows = read_csv(telephone_manifest_path)
    if [row["segment_id"] for row in clean_rows] != [
        row["segment_id"] for row in telephone_rows
    ]:
        raise ValueError("clean/telephone manifest 행 정렬이 다릅니다.")
    clean_features = _load_egemaps_aligned(
        clean_rows, clean_egemaps_path, clean_egemaps_index_path
    )
    telephone_features = _load_egemaps_aligned(
        telephone_rows, telephone_egemaps_path, telephone_egemaps_index_path
    )
    labels = np.asarray([int(row["intensity_0_2"]) for row in clean_rows], dtype=int)
    fold_values = np.asarray([int(row["cv_fold"]) for row in clean_rows], dtype=int)
    folds = sorted(np.unique(fold_values).tolist())
    weights = sorted({float(value) for value in high_weights})
    thresholds: list[float | None] = [None]
    thresholds.extend(sorted({float(value) for value in high_thresholds}, reverse=True))
    if not weights or any(value < 1.0 for value in weights):
        raise ValueError("high_weights는 1.0 이상이어야 합니다.")
    if any(not 0.0 < value < 1.0 for value in thresholds if value is not None):
        raise ValueError("high_thresholds는 0과 1 사이여야 합니다.")

    candidates: list[dict[str, Any]] = []
    models_by_weight: dict[float, list[Any]] = {}
    probabilities_by_weight: dict[float, tuple[np.ndarray, np.ndarray]] = {}
    for high_weight in weights:
        clean_oof = np.full((len(clean_rows), 3), np.nan)
        telephone_oof = np.full((len(clean_rows), 3), np.nan)
        fold_models: list[Any] = []
        for fold in folds:
            train_indices = np.where(fold_values != fold)[0]
            validation_indices = np.where(fold_values == fold)[0]
            train_groups = {clean_rows[index]["speaker_pair"] for index in train_indices}
            validation_groups = {
                clean_rows[index]["speaker_pair"] for index in validation_indices
            }
            if train_groups & validation_groups:
                raise RuntimeError(f"fold {fold} high-focus 화자쌍 누수")
            training_features = np.concatenate(
                [clean_features[train_indices], telephone_features[train_indices]],
                axis=0,
            )
            training_labels = np.concatenate(
                [labels[train_indices], labels[train_indices]], axis=0
            )
            sample_weight = np.where(training_labels == 2, high_weight, 1.0)
            models = _fit_lgbm_cumulative(
                training_features,
                training_labels,
                seed + 100 * fold,
                sample_weight=sample_weight,
            )
            clean_oof[validation_indices] = _predict_lgbm_cumulative(
                models, clean_features[validation_indices]
            )
            telephone_oof[validation_indices] = _predict_lgbm_cumulative(
                models, telephone_features[validation_indices]
            )
            fold_models.append(models)
        if not np.isfinite(clean_oof).all() or not np.isfinite(telephone_oof).all():
            raise RuntimeError("high-focus OOF 확률에 결측이 있습니다.")
        models_by_weight[high_weight] = fold_models
        probabilities_by_weight[high_weight] = (clean_oof, telephone_oof)
        for high_threshold in thresholds:
            clean_metrics = evaluate_high_policy(labels, clean_oof, high_threshold)
            telephone_metrics = evaluate_high_policy(
                labels, telephone_oof, high_threshold
            )
            candidate = {
                "high_weight": high_weight,
                "high_threshold": high_threshold,
                "clean_metrics": clean_metrics,
                "telephone_metrics": telephone_metrics,
                "tier": _candidate_tier(clean_metrics, telephone_metrics),
            }
            candidates.append(candidate)

    selected = max(candidates, key=_selection_key)
    selected_weight = float(selected["high_weight"])
    selected_threshold = selected["high_threshold"]
    selected_clean, selected_telephone = probabilities_by_weight[selected_weight]
    clean_levels = np.asarray(
        [select_ordinal_level(row, selected_threshold) for row in selected_clean],
        dtype=int,
    )
    telephone_levels = np.asarray(
        [select_ordinal_level(row, selected_threshold) for row in selected_telephone],
        dtype=int,
    )
    output_rows: list[dict[str, Any]] = []
    for index, row in enumerate(clean_rows):
        output_rows.append(
            {
                "segment_id": row["segment_id"],
                "speaker_pair": row["speaker_pair"],
                "cv_fold": row["cv_fold"],
                "target_level": int(labels[index]),
                "clean_level": int(clean_levels[index]),
                "telephone_level": int(telephone_levels[index]),
                "clean_p0": round(float(selected_clean[index, 0]), 8),
                "clean_p1": round(float(selected_clean[index, 1]), 8),
                "clean_p2": round(float(selected_clean[index, 2]), 8),
                "telephone_p0": round(float(selected_telephone[index, 0]), 8),
                "telephone_p1": round(float(selected_telephone[index, 1]), 8),
                "telephone_p2": round(float(selected_telephone[index, 2]), 8),
            }
        )
    write_csv(predictions_path, output_rows, list(output_rows[0].keys()))

    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "candidate_id": "emotion_temperature_demo_high_focus_v4",
            "selected_head": "egemaps_cumulative_lgbm_high_focus",
            "levels": ORDINAL_LEVELS,
            "level_names": LEVEL_NAMES,
            "fold_models": models_by_weight[selected_weight],
            "feature_order": "EGEMAPS_88",
            "training_variants": ["CLEAN_16K", "TELEPHONY_8K_MULAW_UP16K"],
            "training_high_weight": selected_weight,
            "decision_policy": {"high_threshold": selected_threshold},
            "group_method": "REAL_SPEAKER_PAIR",
            "inference_status": "DEMO_RESEARCH_CANDIDATE",
        },
        artifact_path,
    )
    report = {
        "status": "DEMO_HIGH_FOCUS_V4_CV_COMPLETE",
        "created_at": utc_now_iso(),
        "candidate_id": "emotion_temperature_demo_high_focus_v4",
        "selection_rule": {
            "primary": "highest tier, then worst-domain high F2, then mean Macro F1",
            "target_tier": (
                "clean/telephone high recall >=0.60, precision >=0.35, "
                "Macro F1 >=0.52, recall gap <=0.06"
            ),
            "balanced_tier": (
                "clean/telephone high recall >=0.55, precision >=0.35, "
                "Macro F1 >=0.52, recall gap <=0.06"
            ),
        },
        "selected": selected,
        "candidates": candidates,
        "artifact": {
            "path": str(artifact_path.resolve()),
            "sha256": sha256_file(artifact_path),
        },
        "outputs": {"oof_predictions": str(predictions_path.resolve())},
        "limitations": [
            "Weights and thresholds were selected on development OOF results, not a new final holdout.",
            "Sliding-window peak analysis and cross-domain sanity evaluation remain pending.",
            "The artifact is for a project demo/research shadow, not live call-center automation.",
        ],
        "integration_allowed": False,
        "integration_block_reason": "SLIDING_WINDOW_AND_FINAL_CANDIDATE_COMPARISON_PENDING",
    }
    write_json(report_json_path, report)

    lines = [
        "# Emotion temperature demo high-focus v4",
        "",
        "## 결론",
        "",
        f"- 선택 High 가중치: {selected_weight:.2f}",
        f"- 선택 High 임계값: {selected_threshold}",
        f"- 선택 tier: `{selected['tier']}`",
        (
            "- clean High precision/recall/F2: "
            f"{selected['clean_metrics']['per_class']['2']['precision']:.4f} / "
            f"{selected['clean_metrics']['per_class']['2']['recall']:.4f} / "
            f"{selected['clean_metrics']['high_f2']:.4f}"
        ),
        (
            "- telephone High precision/recall/F2: "
            f"{selected['telephone_metrics']['per_class']['2']['precision']:.4f} / "
            f"{selected['telephone_metrics']['per_class']['2']['recall']:.4f} / "
            f"{selected['telephone_metrics']['high_f2']:.4f}"
        ),
        (
            "- clean/telephone Macro F1: "
            f"{selected['clean_metrics']['macro_f1']:.4f} / "
            f"{selected['telephone_metrics']['macro_f1']:.4f}"
        ),
        "",
        "## 전체 후보",
        "",
        "| High weight | p2 threshold | Tier | Clean P/R/F2 | Phone P/R/F2 | Clean/Phone Macro F1 |",
        "|---:|---:|---|---|---|---|",
    ]
    for candidate in sorted(candidates, key=_selection_key, reverse=True):
        threshold_label = (
            "argmax"
            if candidate["high_threshold"] is None
            else f"{candidate['high_threshold']:.2f}"
        )
        clean = candidate["clean_metrics"]
        phone = candidate["telephone_metrics"]
        lines.append(
            "| "
            f"{candidate['high_weight']:.2f} | {threshold_label} | {candidate['tier']} | "
            f"{clean['per_class']['2']['precision']:.3f}/"
            f"{clean['per_class']['2']['recall']:.3f}/{clean['high_f2']:.3f} | "
            f"{phone['per_class']['2']['precision']:.3f}/"
            f"{phone['per_class']['2']['recall']:.3f}/{phone['high_f2']:.3f} | "
            f"{clean['macro_f1']:.3f}/{phone['macro_f1']:.3f} |"
        )
    lines.extend(
        [
            "",
            "이 결과는 실제 화자쌍 5-fold 개발 비교다. 새 실제 콜센터 최종 holdout이 아니며,",
            "sliding-window 최고조 분석과 비교한 뒤에만 발표용 최종 모델을 동결한다.",
            "",
        ]
    )
    report_md_path.parent.mkdir(parents=True, exist_ok=True)
    report_md_path.write_text("\n".join(lines), encoding="utf-8")
    return report

