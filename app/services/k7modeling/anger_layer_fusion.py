"""Compare frozen WavLM layer/statistics fusion candidates for anger detection."""

from __future__ import annotations

import argparse
import copy
import csv
import json
import random
from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch import nn

from .anger_baselines import _classification_metrics
from .anger_mlp import _best_balanced_threshold
from .io_utils import sha256_file, utc_now_iso, write_json


LAYERS = (3, 6, 9, 12)


def _read(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def _candidate_specs() -> list[dict[str, Any]]:
    specs = []
    for index, layer in enumerate(LAYERS):
        specs.append({"name": f"layer_{layer}_mean", "kind": "layer_mean", "layer_index": index})
        specs.append({"name": f"layer_{layer}_stats", "kind": "layer_stats", "layer_index": index})
    specs.extend([
        {"name": "mean_4_layers_stats", "kind": "mean_layers_stats"},
        {"name": "weighted_4_layers_stats", "kind": "weighted_layers_stats"},
    ])
    return specs


def _materialize(
    features: np.ndarray,
    row_indices: np.ndarray,
    spec: dict[str, Any],
) -> np.ndarray:
    """Copy one candidate into contiguous RAM once instead of random-reading the mmap every epoch."""
    kind = spec["kind"]
    if kind == "layer_mean":
        selected = features[row_indices, spec["layer_index"], :768]
    elif kind == "layer_stats":
        selected = features[row_indices, spec["layer_index"], :]
    elif kind == "mean_layers_stats":
        selected = features[row_indices].mean(axis=1)
    elif kind == "weighted_layers_stats":
        selected = features[row_indices]
    else:
        raise ValueError(f"unknown candidate kind: {kind}")
    return np.ascontiguousarray(selected, dtype=np.float32)


class StaticFusionMLP(nn.Module):
    def __init__(self, mean: np.ndarray, std: np.ndarray) -> None:
        super().__init__()
        self.register_buffer("mean", torch.from_numpy(mean))
        self.register_buffer("std", torch.from_numpy(std))
        input_dim = int(mean.size)
        self.network = nn.Sequential(
            nn.Linear(input_dim, 256), nn.GELU(), nn.Dropout(0.2),
            nn.Linear(256, 64), nn.GELU(), nn.Dropout(0.15), nn.Linear(64, 1),
        )

    def forward(self, values: torch.Tensor) -> torch.Tensor:
        normalized = (values - self.mean) / self.std
        return self.network(normalized).squeeze(-1)


class WeightedLayerMLP(nn.Module):
    def __init__(self, mean: np.ndarray, std: np.ndarray) -> None:
        super().__init__()
        self.register_buffer("mean", torch.from_numpy(mean))
        self.register_buffer("std", torch.from_numpy(std))
        self.layer_logits = nn.Parameter(torch.zeros(len(LAYERS)))
        self.network = nn.Sequential(
            nn.Linear(1536, 256), nn.GELU(), nn.Dropout(0.2),
            nn.Linear(256, 64), nn.GELU(), nn.Dropout(0.15), nn.Linear(64, 1),
        )

    def forward(self, values: torch.Tensor) -> torch.Tensor:
        normalized = (values - self.mean) / self.std
        weights = torch.softmax(self.layer_logits, dim=0)
        fused = (normalized * weights.view(1, -1, 1)).sum(dim=1)
        return self.network(fused).squeeze(-1)


def _probability(
    model: nn.Module,
    values: torch.Tensor,
    device: torch.device,
    batch_size: int,
) -> np.ndarray:
    model.eval()
    outputs = []
    with torch.inference_mode():
        for start in range(0, len(values), batch_size):
            batch = values[start:start + batch_size].to(device)
            outputs.append(torch.sigmoid(model(batch)).cpu().numpy())
    return np.concatenate(outputs)


def run_layer_fusion(
    manifest_path: Path,
    features_path: Path,
    index_path: Path,
    output_dir: Path,
    *,
    seed: int = 20260721,
    epochs: int = 30,
    batch_size: int = 256,
    patience: int = 5,
) -> dict[str, Any]:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    rows = _read(manifest_path)
    index_rows = _read(index_path)
    features = np.load(features_path, mmap_mode="r")
    if features.shape != (len(rows), len(LAYERS), 1536):
        raise ValueError(f"unexpected layerwise feature shape: {features.shape}")
    manifest_keys = [row["embedding_key"] for row in rows]
    index_keys = [row["embedding_key"] for row in index_rows]
    if manifest_keys != index_keys or any(row["status"] != "OK" for row in index_rows):
        raise ValueError("layerwise manifest/index integrity failed")
    if not np.isfinite(features).all():
        raise ValueError("layerwise features contain NaN or Inf")

    splits = np.asarray([row["split"] for row in rows])
    targets = np.asarray([int(row["anger_binary_target"]) for row in rows], dtype=np.float32)
    train_indices = np.flatnonzero(splits == "train")
    validation_indices = np.flatnonzero(splits == "validation")
    y_train = targets[train_indices]
    y_validation = targets[validation_indices].astype(np.int8)
    positive_weight = float((y_train == 0).sum() / (y_train == 1).sum())

    candidates = []
    saved: dict[str, dict[str, Any]] = {}
    for spec in _candidate_specs():
        train_features = _materialize(features, train_indices, spec)
        validation_features = _materialize(features, validation_indices, spec)
        mean = train_features.mean(axis=0, dtype=np.float64).astype(np.float32)
        std = train_features.std(axis=0, dtype=np.float64).astype(np.float32)
        std[std < 1e-6] = 1.0
        train_values = torch.from_numpy(train_features).to(device)
        validation_values = torch.from_numpy(validation_features).to(device)
        train_targets = torch.from_numpy(targets[train_indices]).to(device)
        for weighting in ("unweighted", "balanced"):
            torch.manual_seed(seed)
            generator = torch.Generator(device=device).manual_seed(seed)
            model: nn.Module
            if spec["kind"] == "weighted_layers_stats":
                model = WeightedLayerMLP(mean, std).to(device)
            else:
                model = StaticFusionMLP(mean, std).to(device)
            optimizer = torch.optim.AdamW(model.parameters(), lr=3e-4, weight_decay=1e-4)
            criterion = nn.BCEWithLogitsLoss(
                pos_weight=torch.tensor(positive_weight, device=device) if weighting == "balanced" else None
            )
            best_state = None
            best_score = None
            best_epoch = 0
            stale = 0
            history = []
            for epoch in range(1, epochs + 1):
                model.train()
                loss_sum = 0.0
                order = torch.randperm(len(train_values), generator=generator, device=device)
                for start in range(0, len(order), batch_size):
                    indices = order[start:start + batch_size]
                    values = train_values[indices].to(device)
                    batch_targets = train_targets[indices].to(device)
                    optimizer.zero_grad(set_to_none=True)
                    loss = criterion(model(values), batch_targets)
                    loss.backward()
                    optimizer.step()
                    loss_sum += float(loss.detach().cpu()) * len(values)
                probability = _probability(model, validation_values, device, batch_size * 2)
                threshold, metrics = _best_balanced_threshold(y_validation, probability)
                score = (metrics["macro_f1"], metrics["uar"], metrics["f1"])
                history.append({"epoch": epoch, "train_loss": loss_sum / len(train_values), "validation": metrics})
                if best_score is None or score > best_score:
                    best_score = score
                    best_state = copy.deepcopy(model.state_dict())
                    best_epoch = epoch
                    stale = 0
                else:
                    stale += 1
                    if stale >= patience:
                        break
            assert best_state is not None
            model.load_state_dict(best_state)
            probability = _probability(model, validation_values, device, batch_size * 2)
            threshold, metrics = _best_balanced_threshold(y_validation, probability)
            candidate_id = f"{spec['name']}_{weighting}"
            layer_weights = None
            if isinstance(model, WeightedLayerMLP):
                layer_weights = torch.softmax(model.layer_logits, dim=0).detach().cpu().tolist()
            candidates.append({
                "candidate_id": candidate_id, "spec": spec, "weighting": weighting,
                "best_epoch": best_epoch, "validation": metrics, "layer_weights": layer_weights,
                "history": history,
            })
            saved[candidate_id] = {
                "state_dict": {name: value.cpu() for name, value in best_state.items()},
                "spec": spec, "weighting": weighting, "mean": mean, "std": std,
                "threshold": threshold, "layers": LAYERS,
            }

    selected = max(candidates, key=lambda item: (
        item["validation"]["macro_f1"], item["validation"]["uar"], item["validation"]["f1"]
    ))
    output_dir.mkdir(parents=True, exist_ok=True)
    torch.save(saved[selected["candidate_id"]], output_dir / "anger_layer_fusion_selected.pt")
    report = {
        "status": "ANGER_LAYER_FUSION_COMPLETE", "created_at": utc_now_iso(),
        "seed": seed, "device": str(device), "layers": list(LAYERS),
        "selection_policy": "validation Macro-F1, then UAR, then angry F1",
        "dataset": {"train": len(train_indices), "validation": len(validation_indices)},
        "candidates": candidates, "selected": selected,
        "test": None,
        "inputs": {
            "manifest": {"path": str(manifest_path.resolve()), "sha256": sha256_file(manifest_path)},
            "features": {"path": str(features_path.resolve()), "sha256": sha256_file(features_path)},
            "index": {"path": str(index_path.resolve()), "sha256": sha256_file(index_path)},
        },
    }
    write_json(output_dir / "anger_layer_fusion.json", report)
    (output_dir / "anger_layer_fusion.md").write_text(_markdown(report), encoding="utf-8")
    return report


def evaluate_saved_test(
    manifest_path: Path,
    features_path: Path,
    index_path: Path,
    checkpoint_path: Path,
    report_path: Path,
    *,
    batch_size: int = 512,
) -> dict[str, Any]:
    """Evaluate the selected checkpoint once with its validation-fixed threshold."""
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    rows = _read(manifest_path)
    index_rows = _read(index_path)
    features = np.load(features_path, mmap_mode="r")
    if features.shape != (len(rows), len(LAYERS), 1536):
        raise ValueError(f"unexpected layerwise feature shape: {features.shape}")
    if [row["embedding_key"] for row in rows] != [row["embedding_key"] for row in index_rows]:
        raise ValueError("layerwise manifest/index key integrity failed")
    if any(row["status"] != "OK" for row in index_rows):
        raise ValueError("layerwise index contains non-OK rows")

    artifact = torch.load(checkpoint_path, map_location=device, weights_only=False)
    spec = artifact["spec"]
    mean = np.asarray(artifact["mean"], dtype=np.float32)
    std = np.asarray(artifact["std"], dtype=np.float32)
    model: nn.Module
    if spec["kind"] == "weighted_layers_stats":
        model = WeightedLayerMLP(mean, std)
    else:
        model = StaticFusionMLP(mean, std)
    model.load_state_dict(artifact["state_dict"])
    model.to(device)

    splits = np.asarray([row["split"] for row in rows])
    test_indices = np.flatnonzero(splits == "test")
    test_features = _materialize(features, test_indices, spec)
    test_values = torch.from_numpy(test_features).to(device)
    probability = _probability(model, test_values, device, batch_size)
    targets = np.asarray(
        [int(rows[int(index)]["anger_binary_target"]) for index in test_indices], dtype=np.int8
    )
    threshold = float(artifact["threshold"])
    metrics = _classification_metrics(targets, probability, threshold)

    report = json.loads(report_path.read_text(encoding="utf-8"))
    if report["selected"]["candidate_id"] != f"{spec['name']}_{artifact['weighting']}":
        raise ValueError("checkpoint does not match selected report candidate")
    report["test"] = {
        **metrics,
        "rows": len(test_indices),
        "threshold_source": "selected validation threshold (fixed; not retuned on test)",
        "evaluated_at": utc_now_iso(),
    }
    write_json(report_path, report)
    report_path.with_suffix(".md").write_text(_markdown(report), encoding="utf-8")
    return report


def _markdown(report: dict[str, Any]) -> str:
    lines = [
        "# WavLM frozen layer fusion validation", "",
        "| candidate | epoch | threshold | precision | recall | angry F1 | Macro-F1 | UAR |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for candidate in report["candidates"]:
        metric = candidate["validation"]
        lines.append(
            f"| {candidate['candidate_id']} | {candidate['best_epoch']} | {metric['threshold']:.3f} | "
            f"{metric['precision']:.4f} | {metric['recall']:.4f} | {metric['f1']:.4f} | "
            f"{metric['macro_f1']:.4f} | {metric['uar']:.4f} |"
        )
    selected = report["selected"]
    lines += ["", f"Selected: `{selected['candidate_id']}`", ""]
    if report["test"] is None:
        lines += ["> Test is intentionally not evaluated in this validation comparison.", ""]
    else:
        test = report["test"]
        lines += [
            "## Fixed-threshold test", "",
            f"- threshold: {test['threshold']:.3f} (selected on validation; not retuned)",
            f"- precision / recall / angry F1: {test['precision']:.4f} / {test['recall']:.4f} / {test['f1']:.4f}",
            f"- Macro-F1 / UAR: {test['macro_f1']:.4f} / {test['uar']:.4f}",
            f"- confusion matrix: {test['confusion_matrix']}", "",
        ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("features", type=Path)
    parser.add_argument("index", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=20260721)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--patience", type=int, default=5)
    parser.add_argument("--evaluate-selected-test", action="store_true")
    args = parser.parse_args()
    if args.evaluate_selected_test:
        report = evaluate_saved_test(
            args.manifest, args.features, args.index,
            args.output_dir / "anger_layer_fusion_selected.pt",
            args.output_dir / "anger_layer_fusion.json",
            batch_size=args.batch_size * 2,
        )
        print(json.dumps({"status": "ANGER_LAYER_FUSION_TEST_COMPLETE", "test": report["test"]}, ensure_ascii=False, indent=2))
        return
    report = run_layer_fusion(
        args.manifest, args.features, args.index, args.output_dir,
        seed=args.seed, epochs=args.epochs, batch_size=args.batch_size, patience=args.patience,
    )
    print(json.dumps({"status": report["status"], "selected": report["selected"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
