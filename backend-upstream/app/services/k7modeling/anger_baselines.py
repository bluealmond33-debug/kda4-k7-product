"""Minimal reproducible anger detection and intensity baselines."""

from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from scipy.stats import spearmanr
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (
    balanced_accuracy_score,
    confusion_matrix,
    f1_score,
    fbeta_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    recall_score,
)
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from .io_utils import sha256_file, utc_now_iso, write_json


FEATURE_SETS = {
    "native_9": slice(768, 777),
    "embedding_768": slice(0, 768),
    "combined_777": slice(0, 777),
}


def _read(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def _classification_metrics(y_true: np.ndarray, probabilities: np.ndarray, threshold: float) -> dict[str, Any]:
    predicted = (probabilities >= threshold).astype(np.int8)
    return {
        "threshold": round(float(threshold), 6),
        "precision": float(precision_score(y_true, predicted, zero_division=0)),
        "recall": float(recall_score(y_true, predicted, zero_division=0)),
        "f1": float(f1_score(y_true, predicted, zero_division=0)),
        "f2": float(fbeta_score(y_true, predicted, beta=2, zero_division=0)),
        "macro_f1": float(f1_score(y_true, predicted, average="macro", zero_division=0)),
        "uar": float(balanced_accuracy_score(y_true, predicted)),
        "confusion_matrix": confusion_matrix(y_true, predicted, labels=[0, 1]).tolist(),
        "predicted_positive_rate": float(predicted.mean()),
    }


def _select_f2_threshold(y_true: np.ndarray, probabilities: np.ndarray) -> tuple[float, list[dict[str, Any]]]:
    table = []
    for threshold in np.linspace(0.05, 0.95, 181):
        metrics = _classification_metrics(y_true, probabilities, float(threshold))
        table.append({key: metrics[key] for key in ("threshold", "precision", "recall", "f1", "f2")})
    winner = max(table, key=lambda row: (row["f2"], row["f1"], row["precision"], row["threshold"]))
    return float(winner["threshold"]), table


def _regression_metrics(y_true: np.ndarray, predicted: np.ndarray) -> dict[str, float | None]:
    correlation = spearmanr(y_true, predicted).statistic
    return {
        "mae": float(mean_absolute_error(y_true, predicted)),
        "rmse": float(math.sqrt(mean_squared_error(y_true, predicted))),
        "spearman": float(correlation) if np.isfinite(correlation) else None,
    }


def run_anger_baselines(
    manifest_path: Path,
    features_path: Path,
    output_dir: Path,
    *,
    seed: int = 20260721,
) -> dict[str, Any]:
    rows = _read(manifest_path)
    features = np.load(features_path, mmap_mode="r")
    if features.shape[0] != len(rows) or features.shape[1] not in (768, 777):
        raise ValueError(f"feature/manifest mismatch: {features.shape} vs {len(rows)} rows")
    feature_sets = (
        {"embedding_768": slice(0, 768)}
        if features.shape[1] == 768
        else FEATURE_SETS
    )
    splits = np.asarray([row["split"] for row in rows])
    binary_target = np.asarray([int(row["anger_binary_target"]) for row in rows], dtype=np.int8)
    intensity_target = np.asarray([float(row["anger_intensity_score"]) for row in rows], dtype=np.float64)
    train = splits == "train"
    validation = splits == "validation"
    test = splits == "test"

    output_dir.mkdir(parents=True, exist_ok=True)
    classification: list[dict[str, Any]] = []
    trained_classifiers: dict[str, Any] = {}
    for feature_name, feature_slice in feature_sets.items():
        for weighting in ("unweighted", "balanced"):
            candidate_id = f"logreg_{feature_name}_{weighting}"
            model = make_pipeline(
                StandardScaler(),
                LogisticRegression(
                    class_weight=None if weighting == "unweighted" else "balanced",
                    max_iter=1000,
                    random_state=seed,
                    solver="liblinear",
                ),
            )
            model.fit(features[train, feature_slice], binary_target[train])
            val_probability = model.predict_proba(features[validation, feature_slice])[:, 1]
            threshold, threshold_table = _select_f2_threshold(binary_target[validation], val_probability)
            classification.append({
                "candidate_id": candidate_id,
                "feature_set": feature_name,
                "weighting": weighting,
                "validation_at_0_5": _classification_metrics(binary_target[validation], val_probability, 0.5),
                "validation_selected": _classification_metrics(binary_target[validation], val_probability, threshold),
                "threshold_table": threshold_table,
            })
            trained_classifiers[candidate_id] = (model, feature_slice)

    selected_classification = max(
        classification,
        key=lambda row: (
            row["validation_selected"]["f2"],
            row["validation_selected"]["f1"],
            row["validation_selected"]["precision"],
        ),
    )
    selected_id = selected_classification["candidate_id"]
    selected_model, selected_slice = trained_classifiers[selected_id]
    selected_threshold = selected_classification["validation_selected"]["threshold"]
    test_probability = selected_model.predict_proba(features[test, selected_slice])[:, 1]
    selected_classification["test_selected"] = _classification_metrics(
        binary_target[test], test_probability, selected_threshold
    )
    joblib.dump(
        {"model": selected_model, "feature_set": selected_classification["feature_set"], "threshold": selected_threshold},
        output_dir / "anger_binary_baseline.joblib",
    )

    intensity: list[dict[str, Any]] = []
    trained_regressors: dict[str, Any] = {}
    angry_train = train & (binary_target == 1)
    angry_validation = validation & (binary_target == 1)
    angry_test = test & (binary_target == 1)
    for feature_name, feature_slice in feature_sets.items():
        candidate_id = f"ridge_angry_only_{feature_name}"
        model = make_pipeline(StandardScaler(), Ridge(alpha=1.0))
        model.fit(features[angry_train, feature_slice], intensity_target[angry_train])
        prediction = np.clip(model.predict(features[angry_validation, feature_slice]), 0.0, 100.0)
        intensity.append({
            "candidate_id": candidate_id,
            "feature_set": feature_name,
            "training_scope": "angry_only",
            "validation": _regression_metrics(intensity_target[angry_validation], prediction),
        })
        trained_regressors[candidate_id] = (model, feature_slice)
    selected_intensity = max(
        intensity,
        key=lambda row: (
            row["validation"]["spearman"] if row["validation"]["spearman"] is not None else -1.0,
            -row["validation"]["mae"],
        ),
    )
    selected_intensity_id = selected_intensity["candidate_id"]
    intensity_model, intensity_slice = trained_regressors[selected_intensity_id]
    intensity_test_prediction = np.clip(intensity_model.predict(features[angry_test, intensity_slice]), 0.0, 100.0)
    selected_intensity["test"] = _regression_metrics(intensity_target[angry_test], intensity_test_prediction)
    joblib.dump(
        {"model": intensity_model, "feature_set": selected_intensity["feature_set"], "training_scope": "angry_only"},
        output_dir / "anger_intensity_baseline.joblib",
    )

    report: dict[str, Any] = {
        "status": "ANGER_BASELINES_COMPLETE",
        "created_at": utc_now_iso(),
        "seed": seed,
        "dataset": {
            "rows": len(rows),
            "train": int(train.sum()),
            "validation": int(validation.sum()),
            "test": int(test.sum()),
            "train_angry": int(binary_target[train].sum()),
            "validation_angry": int(binary_target[validation].sum()),
            "test_angry": int(binary_target[test].sum()),
        },
        "classification_candidates": classification,
        "selected_classification": selected_classification,
        "intensity_candidates": intensity,
        "selected_intensity": selected_intensity,
        "evaluation_policy": {
            "selection": "validation F2, then F1, then precision",
            "test_access": "only selected candidate receives test metrics",
            "intensity_primary_scope": "high-consensus angry rows only",
        },
        "inputs": {
            "manifest": {"path": str(manifest_path.resolve()), "sha256": sha256_file(manifest_path)},
            "features": {"path": str(features_path.resolve()), "sha256": sha256_file(features_path)},
        },
    }
    write_json(output_dir / "anger_baselines.json", report)
    (output_dir / "anger_baselines.md").write_text(_markdown(report), encoding="utf-8")
    return report


def _markdown(report: dict[str, Any]) -> str:
    lines = [
        "# 분노 탐지·강도 baseline 결과", "",
        "## 분노 탐지 validation 비교", "",
        "| 후보 | threshold | precision | recall | F1 | F2 | Macro-F1 | UAR |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for candidate in report["classification_candidates"]:
        metric = candidate["validation_selected"]
        lines.append(
            f"| {candidate['candidate_id']} | {metric['threshold']:.3f} | {metric['precision']:.4f} | "
            f"{metric['recall']:.4f} | {metric['f1']:.4f} | {metric['f2']:.4f} | "
            f"{metric['macro_f1']:.4f} | {metric['uar']:.4f} |"
        )
    selected = report["selected_classification"]
    test = selected["test_selected"]
    lines += [
        "", "## 선택된 분노 탐지 모델의 test 결과", "",
        f"- 후보: `{selected['candidate_id']}`",
        f"- threshold: {test['threshold']:.3f}",
        f"- precision / recall / F1 / F2: {test['precision']:.4f} / {test['recall']:.4f} / {test['f1']:.4f} / {test['f2']:.4f}",
        f"- Macro-F1 / UAR: {test['macro_f1']:.4f} / {test['uar']:.4f}",
        f"- confusion matrix [[TN, FP], [FN, TP]]: {test['confusion_matrix']}",
        "", "## 분노 강도 validation 비교(angry-only)", "",
        "| 후보 | MAE | RMSE | Spearman |", "|---|---:|---:|---:|",
    ]
    for candidate in report["intensity_candidates"]:
        metric = candidate["validation"]
        lines.append(f"| {candidate['candidate_id']} | {metric['mae']:.4f} | {metric['rmse']:.4f} | {metric['spearman']:.4f} |")
    chosen = report["selected_intensity"]
    metric = chosen["test"]
    lines += [
        "", "## 선택된 강도 모델의 test 결과", "",
        f"- 후보: `{chosen['candidate_id']}`",
        f"- MAE / RMSE / Spearman: {metric['mae']:.4f} / {metric['rmse']:.4f} / {metric['spearman']:.4f}", "",
        "> 이 결과는 frozen linear baseline이다. 부분 fine-tuning 또는 제품 배포 성능을 의미하지 않는다.", "",
    ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("features", type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path("data/anger_baselines"))
    parser.add_argument("--seed", type=int, default=20260721)
    args = parser.parse_args()
    report = run_anger_baselines(args.manifest, args.features, args.output_dir, seed=args.seed)
    print(json.dumps({
        "status": report["status"],
        "selected_classification": report["selected_classification"]["candidate_id"],
        "selected_intensity": report["selected_intensity"]["candidate_id"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
