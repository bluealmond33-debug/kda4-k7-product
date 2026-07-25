"""Train a small angry-only intensity regressor on frozen speech embeddings."""

from __future__ import annotations

import argparse
import copy
import json
import math
import random
from pathlib import Path
from typing import Any

import numpy as np
import torch
from scipy.stats import spearmanr
from sklearn.metrics import mean_absolute_error, mean_squared_error
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

from .anger_mlp import _read
from .io_utils import sha256_file, utc_now_iso, write_json


class IntensityMLP(nn.Module):
    def __init__(self, input_dim: int) -> None:
        super().__init__()
        self.network = nn.Sequential(
            nn.Linear(input_dim, 256), nn.GELU(), nn.Dropout(0.2),
            nn.Linear(256, 64), nn.GELU(), nn.Dropout(0.1),
            nn.Linear(64, 1),
        )

    def forward(self, features: torch.Tensor) -> torch.Tensor:
        return torch.sigmoid(self.network(features).squeeze(-1)) * 100.0


def _metrics(target: np.ndarray, prediction: np.ndarray) -> dict[str, float | None]:
    prediction = np.clip(prediction, 0.0, 100.0)
    correlation = spearmanr(target, prediction).statistic
    return {
        "mae": float(mean_absolute_error(target, prediction)),
        "rmse": float(math.sqrt(mean_squared_error(target, prediction))),
        "spearman": float(correlation) if np.isfinite(correlation) else None,
    }


def _predict(model: nn.Module, features: np.ndarray, device: torch.device, batch_size: int) -> np.ndarray:
    model.eval()
    output = []
    with torch.inference_mode():
        for start in range(0, len(features), batch_size):
            batch = torch.from_numpy(features[start:start + batch_size]).to(device)
            output.append(model(batch).cpu().numpy())
    return np.concatenate(output)


def train_intensity(
    manifest_path: Path,
    features_path: Path,
    output_dir: Path,
    *,
    seed: int = 20260721,
    epochs: int = 60,
    batch_size: int = 256,
    patience: int = 8,
) -> dict[str, Any]:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    rows = _read(manifest_path)
    features = np.load(features_path, mmap_mode="r")
    if features.shape[0] != len(rows) or features.shape[1] not in (768, 777):
        raise ValueError(f"feature/manifest mismatch: {features.shape} vs {len(rows)} rows")
    splits = np.asarray([row["split"] for row in rows])
    angry = np.asarray([int(row["anger_binary_target"]) == 1 for row in rows])
    target = np.asarray([float(row["anger_intensity_score"]) for row in rows], dtype=np.float32)
    train_mask = (splits == "train") & angry
    validation_mask = (splits == "validation") & angry
    test_mask = (splits == "test") & angry
    x_train = np.asarray(features[train_mask, :768], dtype=np.float32)
    x_validation = np.asarray(features[validation_mask, :768], dtype=np.float32)
    x_test = np.asarray(features[test_mask, :768], dtype=np.float32)
    y_train, y_validation, y_test = target[train_mask], target[validation_mask], target[test_mask]
    mean, std = x_train.mean(axis=0), x_train.std(axis=0)
    std[std < 1e-6] = 1.0
    x_train = (x_train - mean) / std
    x_validation = (x_validation - mean) / std
    x_test = (x_test - mean) / std
    loader = DataLoader(
        TensorDataset(torch.from_numpy(x_train), torch.from_numpy(y_train)),
        batch_size=batch_size,
        shuffle=True,
        generator=torch.Generator().manual_seed(seed),
    )

    candidates = []
    saved = {}
    for loss_name in ("smooth_l1", "mse"):
        torch.manual_seed(seed)
        model = IntensityMLP(768).to(device)
        optimizer = torch.optim.AdamW(model.parameters(), lr=2e-4, weight_decay=1e-4)
        criterion = nn.SmoothL1Loss(beta=10.0) if loss_name == "smooth_l1" else nn.MSELoss()
        best_state = None
        best_score = None
        best_epoch = 0
        stale = 0
        history = []
        for epoch in range(1, epochs + 1):
            model.train()
            total_loss = 0.0
            for batch_x, batch_y in loader:
                batch_x, batch_y = batch_x.to(device), batch_y.to(device)
                optimizer.zero_grad(set_to_none=True)
                loss = criterion(model(batch_x), batch_y)
                loss.backward()
                optimizer.step()
                total_loss += float(loss.detach().cpu()) * len(batch_x)
            prediction = _predict(model, x_validation, device, batch_size * 2)
            metric = _metrics(y_validation, prediction)
            history.append({"epoch": epoch, "train_loss": total_loss / len(x_train), **metric})
            score = (-metric["mae"], metric["spearman"] or -1.0, -metric["rmse"])
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
        metric = _metrics(y_validation, _predict(model, x_validation, device, batch_size * 2))
        candidates.append({"loss": loss_name, "best_epoch": best_epoch, "validation": metric, "history": history})
        saved[loss_name] = best_state

    selected = min(candidates, key=lambda item: (item["validation"]["mae"], -float(item["validation"]["spearman"] or -1)))
    model = IntensityMLP(768).to(device)
    model.load_state_dict(saved[selected["loss"]])
    selected["test"] = _metrics(y_test, _predict(model, x_test, device, batch_size * 2))
    output_dir.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": saved[selected["loss"]], "mean": mean, "std": std, "loss": selected["loss"]}, output_dir / "anger_intensity_mlp_selected.pt")
    report = {
        "status": "ANGER_INTENSITY_MLP_COMPLETE", "created_at": utc_now_iso(), "seed": seed,
        "device": str(device), "selection_policy": "validation MAE, then Spearman, then RMSE",
        "scope": "high-consensus angry rows only", "candidates": candidates, "selected": selected,
        "dataset": {"train": int(train_mask.sum()), "validation": int(validation_mask.sum()), "test": int(test_mask.sum())},
        "inputs": {
            "manifest": {"path": str(manifest_path.resolve()), "sha256": sha256_file(manifest_path)},
            "features": {"path": str(features_path.resolve()), "sha256": sha256_file(features_path)},
        },
    }
    write_json(output_dir / "anger_intensity_mlp.json", report)
    (output_dir / "anger_intensity_mlp.md").write_text(_markdown(report), encoding="utf-8")
    return report


def _markdown(report: dict[str, Any]) -> str:
    lines = ["# Frozen embedding anger intensity MLP", "", "| loss | epoch | validation MAE | RMSE | Spearman |", "|---|---:|---:|---:|---:|"]
    for candidate in report["candidates"]:
        metric = candidate["validation"]
        lines.append(f"| {candidate['loss']} | {candidate['best_epoch']} | {metric['mae']:.4f} | {metric['rmse']:.4f} | {metric['spearman']:.4f} |")
    metric = report["selected"]["test"]
    lines += ["", f"Selected: `{report['selected']['loss']}`", f"Test MAE / RMSE / Spearman: {metric['mae']:.4f} / {metric['rmse']:.4f} / {metric['spearman']:.4f}", "", "> Development baseline only; not calibrated for product output.", ""]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("features", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=20260721)
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--patience", type=int, default=8)
    args = parser.parse_args()
    report = train_intensity(args.manifest, args.features, args.output_dir, seed=args.seed, epochs=args.epochs, batch_size=args.batch_size, patience=args.patience)
    print(json.dumps({"status": report["status"], "selected": report["selected"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
