"""Evaluate a probability-average ensemble of saved anger MLP heads."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
import torch

from .anger_mlp import AngerMLP, _best_balanced_threshold, _probability, _read
from .io_utils import sha256_file, utc_now_iso, write_csv, write_json


def evaluate_ensemble(
    manifest_path: Path,
    features_path: Path,
    artifact_paths: list[Path],
    output_dir: Path,
    *,
    batch_size: int = 512,
) -> dict[str, Any]:
    rows = _read(manifest_path)
    features = np.load(features_path, mmap_mode="r")
    if features.shape != (len(rows), 768):
        raise ValueError(f"expected {(len(rows), 768)}, got {features.shape}")
    splits = np.asarray([row["split"] for row in rows])
    targets = np.asarray([int(row["anger_binary_target"]) for row in rows], dtype=np.int8)
    validation = splits == "validation"
    test = splits == "test"
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    validation_probabilities = []
    test_probabilities = []
    artifacts = []
    for path in artifact_paths:
        # These checkpoints are generated locally by anger_mlp.py and include NumPy arrays.
        artifact = torch.load(path, map_location="cpu", weights_only=False)
        if artifact["input_dim"] != 768 or artifact["feature_set"] != "embedding_768":
            raise ValueError(f"unsupported artifact layout: {path}")
        model = AngerMLP(768).to(device)
        model.load_state_dict(artifact["state_dict"])
        mean = np.asarray(artifact["mean"], dtype=np.float32)
        std = np.asarray(artifact["std"], dtype=np.float32)
        x_validation = (np.asarray(features[validation], dtype=np.float32) - mean) / std
        x_test = (np.asarray(features[test], dtype=np.float32) - mean) / std
        validation_probabilities.append(_probability(model, x_validation, device, batch_size))
        test_probabilities.append(_probability(model, x_test, device, batch_size))
        artifacts.append({"path": str(path.resolve()), "sha256": sha256_file(path)})

    validation_probability = np.mean(validation_probabilities, axis=0)
    test_probability = np.mean(test_probabilities, axis=0)
    threshold, validation_metrics = _best_balanced_threshold(targets[validation], validation_probability)
    # Test threshold comes only from validation.
    from .anger_baselines import _classification_metrics
    test_metrics = _classification_metrics(targets[test], test_probability, threshold)

    report = {
        "status": "ANGER_MLP_ENSEMBLE_COMPLETE",
        "created_at": utc_now_iso(),
        "member_count": len(artifact_paths),
        "aggregation": "arithmetic mean of member sigmoid probabilities",
        "selection_policy": "validation Macro-F1, then UAR, then angry F1",
        "validation": validation_metrics,
        "test": test_metrics,
        "caveat": "Probabilities are not calibrated; test is a repeatedly accessed development test.",
        "inputs": {
            "manifest": {"path": str(manifest_path.resolve()), "sha256": sha256_file(manifest_path)},
            "features": {"path": str(features_path.resolve()), "sha256": sha256_file(features_path)},
            "artifacts": artifacts,
        },
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    write_json(output_dir / "anger_mlp_ensemble.json", report)
    (output_dir / "anger_mlp_ensemble.md").write_text(_markdown(report), encoding="utf-8")
    prediction_rows = []
    for split_name, mask, probabilities in (
        ("validation", validation, validation_probability),
        ("test", test, test_probability),
    ):
        for row_index, probability in zip(np.flatnonzero(mask), probabilities, strict=True):
            row = rows[int(row_index)]
            target = int(row["anger_binary_target"])
            predicted = int(probability >= threshold)
            error_type = ""
            if target == 1 and predicted == 0:
                error_type = "FN"
            elif target == 0 and predicted == 1:
                error_type = "FP"
            prediction_rows.append({
                "embedding_key": row["embedding_key"],
                "wav_id": row["wav_id"],
                "audio_path": row["audio_path"],
                "split": split_name,
                "majority_label": row["majority_label"],
                "annotation_agreement": row["annotation_agreement"],
                "anger_vote_ratio": row["anger_vote_ratio"],
                "anger_intensity_score": row["anger_intensity_score"],
                "target": target,
                "predicted_probability": float(probability),
                "threshold": threshold,
                "predicted": predicted,
                "error_type": error_type,
            })
    write_csv(
        output_dir / "anger_mlp_ensemble_predictions.csv",
        prediction_rows,
        list(prediction_rows[0]),
    )
    return report


def _markdown(report: dict[str, Any]) -> str:
    val, test = report["validation"], report["test"]
    return "\n".join([
        "# WavLM anger MLP ensemble", "",
        f"- members: {report['member_count']}",
        f"- validation threshold: {val['threshold']:.3f}",
        f"- validation angry F1 / Macro-F1 / UAR: {val['f1']:.4f} / {val['macro_f1']:.4f} / {val['uar']:.4f}",
        f"- test precision / recall / angry F1: {test['precision']:.4f} / {test['recall']:.4f} / {test['f1']:.4f}",
        f"- test Macro-F1 / UAR: {test['macro_f1']:.4f} / {test['uar']:.4f}",
        f"- test confusion matrix: {test['confusion_matrix']}", "",
        f"> {report['caveat']}", "",
    ])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("features", type=Path)
    parser.add_argument("artifacts", nargs="+", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    report = evaluate_ensemble(args.manifest, args.features, args.artifacts, args.output_dir)
    print(json.dumps({"status": report["status"], "validation": report["validation"], "test": report["test"]}, indent=2))


if __name__ == "__main__":
    main()
