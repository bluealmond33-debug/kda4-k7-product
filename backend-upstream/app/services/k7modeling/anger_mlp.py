"""Small GPU MLP candidates on frozen emotion2vec+ features."""

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
from sklearn.metrics import f1_score
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

from .anger_baselines import _classification_metrics
from .io_utils import sha256_file, utc_now_iso, write_json


FEATURE_SETS = {"embedding_768": slice(0, 768), "combined_777": slice(0, 777)}


class AngerMLP(nn.Module):
    def __init__(self, input_dim: int) -> None:
        super().__init__()
        self.network = nn.Sequential(
            nn.Linear(input_dim, 256), nn.GELU(), nn.Dropout(0.2),
            nn.Linear(256, 64), nn.GELU(), nn.Dropout(0.15), nn.Linear(64, 1),
        )

    def forward(self, features: torch.Tensor) -> torch.Tensor:
        return self.network(features).squeeze(-1)


def _read(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def _best_balanced_threshold(y_true: np.ndarray, probability: np.ndarray) -> tuple[float, dict[str, Any]]:
    candidates = []
    for threshold in np.linspace(0.05, 0.95, 181):
        metric = _classification_metrics(y_true, probability, float(threshold))
        candidates.append(metric)
    winner = max(candidates, key=lambda row: (row["macro_f1"], row["uar"], row["f1"], row["f2"]))
    return float(winner["threshold"]), winner


def _probability(model: nn.Module, features: np.ndarray, device: torch.device, batch_size: int) -> np.ndarray:
    model.eval()
    outputs = []
    with torch.inference_mode():
        for start in range(0, len(features), batch_size):
            batch = torch.from_numpy(features[start:start + batch_size]).to(device)
            outputs.append(torch.sigmoid(model(batch)).cpu().numpy())
    return np.concatenate(outputs)


def run_anger_mlp(
    manifest_path: Path,
    features_path: Path,
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
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    rows = _read(manifest_path)
    raw_features = np.load(features_path, mmap_mode="r")
    if raw_features.shape[0] != len(rows) or raw_features.shape[1] not in (768, 777):
        raise ValueError(f"feature/manifest mismatch: {raw_features.shape} vs {len(rows)} rows")
    feature_sets = (
        {"embedding_768": slice(0, 768)}
        if raw_features.shape[1] == 768
        else FEATURE_SETS
    )
    splits = np.asarray([row["split"] for row in rows])
    targets = np.asarray([int(row["anger_binary_target"]) for row in rows], dtype=np.float32)
    train_mask, val_mask, test_mask = splits == "train", splits == "validation", splits == "test"
    y_train, y_val, y_test = targets[train_mask], targets[val_mask].astype(np.int8), targets[test_mask].astype(np.int8)

    candidates: list[dict[str, Any]] = []
    saved: dict[str, dict[str, Any]] = {}
    for feature_name, feature_slice in feature_sets.items():
        x_train = np.asarray(raw_features[train_mask, feature_slice], dtype=np.float32)
        x_val = np.asarray(raw_features[val_mask, feature_slice], dtype=np.float32)
        mean = x_train.mean(axis=0, keepdims=True)
        std = x_train.std(axis=0, keepdims=True)
        std[std < 1e-6] = 1.0
        x_train = (x_train - mean) / std
        x_val = (x_val - mean) / std
        loader = DataLoader(
            TensorDataset(torch.from_numpy(x_train), torch.from_numpy(y_train)),
            batch_size=batch_size, shuffle=True, generator=torch.Generator().manual_seed(seed),
        )
        for weighting in ("unweighted", "balanced"):
            torch.manual_seed(seed)
            model = AngerMLP(x_train.shape[1]).to(device)
            optimizer = torch.optim.AdamW(model.parameters(), lr=3e-4, weight_decay=1e-4)
            positive_weight = float((y_train == 0).sum() / (y_train == 1).sum()) if weighting == "balanced" else 1.0
            criterion = nn.BCEWithLogitsLoss(pos_weight=torch.tensor(positive_weight, device=device))
            best_state = None
            best_metric = None
            best_epoch = 0
            stale = 0
            history = []
            for epoch in range(1, epochs + 1):
                model.train()
                loss_sum = 0.0
                for batch_x, batch_y in loader:
                    batch_x, batch_y = batch_x.to(device), batch_y.to(device)
                    optimizer.zero_grad(set_to_none=True)
                    loss = criterion(model(batch_x), batch_y)
                    loss.backward()
                    optimizer.step()
                    loss_sum += float(loss.detach().cpu()) * len(batch_x)
                val_probability = _probability(model, x_val, device, batch_size * 2)
                threshold, metric = _best_balanced_threshold(y_val, val_probability)
                history.append({"epoch": epoch, "train_loss": loss_sum / len(x_train), "threshold": threshold, **metric})
                score = (metric["macro_f1"], metric["uar"], metric["f1"])
                if best_metric is None or score > best_metric:
                    best_metric = score
                    best_state = copy.deepcopy(model.state_dict())
                    best_epoch = epoch
                    stale = 0
                else:
                    stale += 1
                    if stale >= patience:
                        break
            assert best_state is not None
            model.load_state_dict(best_state)
            val_probability = _probability(model, x_val, device, batch_size * 2)
            threshold, metric = _best_balanced_threshold(y_val, val_probability)
            candidate_id = f"mlp_{feature_name}_{weighting}"
            candidates.append({
                "candidate_id": candidate_id, "feature_set": feature_name, "weighting": weighting,
                "best_epoch": best_epoch, "validation": metric, "history": history,
            })
            saved[candidate_id] = {
                "state_dict": {key: value.cpu() for key, value in best_state.items()},
                "input_dim": x_train.shape[1], "feature_set": feature_name,
                "mean": mean.squeeze(0), "std": std.squeeze(0), "threshold": threshold,
            }

    selected = max(candidates, key=lambda row: (
        row["validation"]["macro_f1"], row["validation"]["uar"], row["validation"]["f1"]
    ))
    artifact = saved[selected["candidate_id"]]
    feature_slice = feature_sets[artifact["feature_set"]]
    x_test = np.asarray(raw_features[test_mask, feature_slice], dtype=np.float32)
    x_test = (x_test - artifact["mean"]) / artifact["std"]
    selected_model = AngerMLP(artifact["input_dim"]).to(device)
    selected_model.load_state_dict(artifact["state_dict"])
    test_probability = _probability(selected_model, x_test, device, batch_size * 2)
    selected["test"] = _classification_metrics(y_test, test_probability, artifact["threshold"])

    output_dir.mkdir(parents=True, exist_ok=True)
    torch.save(artifact, output_dir / "anger_mlp_selected.pt")
    report: dict[str, Any] = {
        "status": "ANGER_MLP_COMPLETE", "created_at": utc_now_iso(), "seed": seed,
        "device": str(device), "gpu_name": torch.cuda.get_device_name(0) if device.type == "cuda" else None,
        "configuration": {"epochs": epochs, "batch_size": batch_size, "patience": patience},
        "selection_policy": "validation Macro-F1, then UAR, then angry F1",
        "candidates": candidates, "selected": selected,
        "inputs": {
            "manifest": {"path": str(manifest_path.resolve()), "sha256": sha256_file(manifest_path)},
            "features": {"path": str(features_path.resolve()), "sha256": sha256_file(features_path)},
        },
    }
    write_json(output_dir / "anger_mlp.json", report)
    (output_dir / "anger_mlp.md").write_text(_markdown(report), encoding="utf-8")
    return report


def _markdown(report: dict[str, Any]) -> str:
    lines = ["# 작은 MLP 분노 탐지 결과", "", "| 후보 | epoch | threshold | precision | recall | F1 | Macro-F1 | UAR |", "|---|---:|---:|---:|---:|---:|---:|---:|"]
    for candidate in report["candidates"]:
        m = candidate["validation"]
        lines.append(f"| {candidate['candidate_id']} | {candidate['best_epoch']} | {m['threshold']:.3f} | {m['precision']:.4f} | {m['recall']:.4f} | {m['f1']:.4f} | {m['macro_f1']:.4f} | {m['uar']:.4f} |")
    chosen, test = report["selected"], report["selected"]["test"]
    lines += ["", "## 선택 모델 test", "", f"- 후보: `{chosen['candidate_id']}`", f"- precision / recall / F1: {test['precision']:.4f} / {test['recall']:.4f} / {test['f1']:.4f}", f"- Macro-F1 / UAR: {test['macro_f1']:.4f} / {test['uar']:.4f}", f"- confusion matrix: {test['confusion_matrix']}", ""]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("features", type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path("data/anger_mlp"))
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--patience", type=int, default=5)
    parser.add_argument("--seed", type=int, default=20260721)
    args = parser.parse_args()
    report = run_anger_mlp(
        args.manifest,
        args.features,
        args.output_dir,
        seed=args.seed,
        epochs=args.epochs,
        batch_size=args.batch_size,
        patience=args.patience,
    )
    print(json.dumps({"status": report["status"], "selected": report["selected"]["candidate_id"], "test": report["selected"]["test"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
