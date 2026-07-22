"""LightGBM comparison on frozen emotion2vec+ anger features."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any

import joblib
import lightgbm as lgb
import numpy as np

from .anger_baselines import _classification_metrics, _regression_metrics
from .io_utils import sha256_file, utc_now_iso, write_json


FEATURE_SETS = {"embedding_768": slice(0, 768), "combined_777": slice(0, 777)}


def _read(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def _threshold(y_true: np.ndarray, probability: np.ndarray) -> tuple[float, dict[str, Any]]:
    metrics = [_classification_metrics(y_true, probability, float(value)) for value in np.linspace(0.05, 0.95, 181)]
    winner = max(metrics, key=lambda row: (row["macro_f1"], row["uar"], row["f1"], row["f2"]))
    return float(winner["threshold"]), winner


def run_anger_lightgbm(manifest_path: Path, features_path: Path, output_dir: Path, seed: int = 20260721) -> dict[str, Any]:
    rows = _read(manifest_path)
    features = np.load(features_path, mmap_mode="r")
    splits = np.asarray([row["split"] for row in rows])
    target = np.asarray([int(row["anger_binary_target"]) for row in rows], dtype=np.int8)
    intensity = np.asarray([float(row["anger_intensity_score"]) for row in rows], dtype=np.float32)
    train, validation, test = splits == "train", splits == "validation", splits == "test"

    candidates = []
    models = {}
    for feature_name, feature_slice in FEATURE_SETS.items():
        x_train = np.asarray(features[train, feature_slice], dtype=np.float32)
        x_validation = np.asarray(features[validation, feature_slice], dtype=np.float32)
        for weighting in ("unweighted", "balanced"):
            model = lgb.LGBMClassifier(
                objective="binary", n_estimators=800, learning_rate=0.03, num_leaves=31,
                max_depth=-1, min_child_samples=30, subsample=0.85, colsample_bytree=0.8,
                reg_alpha=0.1, reg_lambda=1.0,
                class_weight=None if weighting == "unweighted" else "balanced",
                random_state=seed, n_jobs=-1, verbosity=-1,
            )
            model.fit(
                x_train, target[train], eval_set=[(x_validation, target[validation])],
                callbacks=[lgb.early_stopping(60, verbose=False), lgb.log_evaluation(0)],
            )
            probability = model.predict_proba(x_validation)[:, 1]
            selected_threshold, metric = _threshold(target[validation], probability)
            candidate_id = f"lightgbm_{feature_name}_{weighting}"
            candidates.append({
                "candidate_id": candidate_id, "feature_set": feature_name, "weighting": weighting,
                "best_iteration": model.best_iteration_, "validation": metric,
            })
            models[candidate_id] = (model, feature_slice, selected_threshold)

    selected = max(candidates, key=lambda row: (row["validation"]["macro_f1"], row["validation"]["uar"], row["validation"]["f1"]))
    model, feature_slice, selected_threshold = models[selected["candidate_id"]]
    probability = model.predict_proba(np.asarray(features[test, feature_slice], dtype=np.float32))[:, 1]
    selected["test"] = _classification_metrics(target[test], probability, selected_threshold)

    angry_train = train & (target == 1)
    angry_validation = validation & (target == 1)
    angry_test = test & (target == 1)
    intensity_candidates = []
    intensity_models = {}
    for feature_name, feature_slice in FEATURE_SETS.items():
        model = lgb.LGBMRegressor(
            objective="regression_l1", n_estimators=800, learning_rate=0.03, num_leaves=24,
            min_child_samples=25, subsample=0.85, colsample_bytree=0.8,
            reg_alpha=0.1, reg_lambda=2.0, random_state=seed, n_jobs=-1, verbosity=-1,
        )
        model.fit(
            np.asarray(features[angry_train, feature_slice], dtype=np.float32), intensity[angry_train],
            eval_set=[(np.asarray(features[angry_validation, feature_slice], dtype=np.float32), intensity[angry_validation])],
            callbacks=[lgb.early_stopping(60, verbose=False), lgb.log_evaluation(0)],
        )
        prediction = np.clip(model.predict(np.asarray(features[angry_validation, feature_slice], dtype=np.float32)), 0, 100)
        candidate_id = f"lightgbm_intensity_{feature_name}"
        intensity_candidates.append({
            "candidate_id": candidate_id, "feature_set": feature_name,
            "best_iteration": model.best_iteration_, "validation": _regression_metrics(intensity[angry_validation], prediction),
        })
        intensity_models[candidate_id] = (model, feature_slice)
    selected_intensity = max(intensity_candidates, key=lambda row: (row["validation"]["spearman"] or -1, -row["validation"]["mae"]))
    intensity_model, intensity_slice = intensity_models[selected_intensity["candidate_id"]]
    prediction = np.clip(intensity_model.predict(np.asarray(features[angry_test, intensity_slice], dtype=np.float32)), 0, 100)
    selected_intensity["test"] = _regression_metrics(intensity[angry_test], prediction)

    output_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "feature_set": selected["feature_set"], "threshold": selected_threshold}, output_dir / "anger_lightgbm_selected.joblib")
    joblib.dump({"model": intensity_model, "feature_set": selected_intensity["feature_set"]}, output_dir / "anger_lightgbm_intensity_selected.joblib")
    report = {
        "status": "ANGER_LIGHTGBM_COMPLETE", "created_at": utc_now_iso(), "seed": seed,
        "selection_policy": "validation Macro-F1, then UAR, then angry F1",
        "candidates": candidates, "selected": selected,
        "intensity_candidates": intensity_candidates, "selected_intensity": selected_intensity,
        "inputs": {
            "manifest": {"path": str(manifest_path.resolve()), "sha256": sha256_file(manifest_path)},
            "features": {"path": str(features_path.resolve()), "sha256": sha256_file(features_path)},
        },
    }
    write_json(output_dir / "anger_lightgbm.json", report)
    (output_dir / "anger_lightgbm.md").write_text(_markdown(report), encoding="utf-8")
    return report


def _markdown(report: dict[str, Any]) -> str:
    lines = ["# LightGBM 분노 모델 결과", "", "| 후보 | iteration | threshold | precision | recall | F1 | Macro-F1 | UAR |", "|---|---:|---:|---:|---:|---:|---:|---:|"]
    for candidate in report["candidates"]:
        m = candidate["validation"]
        lines.append(f"| {candidate['candidate_id']} | {candidate['best_iteration']} | {m['threshold']:.3f} | {m['precision']:.4f} | {m['recall']:.4f} | {m['f1']:.4f} | {m['macro_f1']:.4f} | {m['uar']:.4f} |")
    chosen, test = report["selected"], report["selected"]["test"]
    lines += ["", "## 선택 분류기 test", "", f"- `{chosen['candidate_id']}`", f"- precision / recall / F1: {test['precision']:.4f} / {test['recall']:.4f} / {test['f1']:.4f}", f"- Macro-F1 / UAR: {test['macro_f1']:.4f} / {test['uar']:.4f}", "", "## 강도", ""]
    for candidate in report["intensity_candidates"]:
        m = candidate["validation"]
        lines.append(f"- `{candidate['candidate_id']}`: MAE {m['mae']:.4f}, RMSE {m['rmse']:.4f}, Spearman {m['spearman']:.4f}")
    m = report["selected_intensity"]["test"]
    lines += [f"- 선택 모델 test: MAE {m['mae']:.4f}, RMSE {m['rmse']:.4f}, Spearman {m['spearman']:.4f}", ""]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("features", type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path("data/anger_lightgbm"))
    args = parser.parse_args()
    report = run_anger_lightgbm(args.manifest, args.features, args.output_dir)
    print(json.dumps({"status": report["status"], "selected": report["selected"]["candidate_id"], "test": report["selected"]["test"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
