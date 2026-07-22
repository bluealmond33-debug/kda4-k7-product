"""Verify that a saved frozen WavLM MLP head reproduces through raw audio."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader
from transformers import AutoFeatureExtractor, AutoModel

from .anger_baselines import _classification_metrics
from .anger_mlp import AngerMLP, _read
from .io_utils import sha256_file, utc_now_iso, write_json
from .wavlm_alternative import MODEL_ID
from .wavlm_partial_finetune import (
    Collator,
    EvaluationWindows,
    LengthBucketBatchSampler,
    SAMPLE_RATE,
    _evaluate,
)


class FrozenWavLMWithMLP(nn.Module):
    def __init__(self, backbone: nn.Module, artifact: dict[str, Any]) -> None:
        super().__init__()
        self.backbone = backbone
        self.head = AngerMLP(768)
        self.head.load_state_dict(artifact["state_dict"])
        self.register_buffer("feature_mean", torch.as_tensor(artifact["mean"], dtype=torch.float32))
        self.register_buffer("feature_std", torch.as_tensor(artifact["std"], dtype=torch.float32))

    def forward(self, input_values: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
        hidden = self.backbone(input_values=input_values, attention_mask=attention_mask).last_hidden_state
        feature_mask = self.backbone._get_feature_vector_attention_mask(hidden.shape[1], attention_mask)
        pooled = (hidden * feature_mask.unsqueeze(-1)).sum(dim=1) / feature_mask.sum(dim=1, keepdim=True).clamp_min(1)
        with torch.autocast(device_type=pooled.device.type, enabled=False):
            normalized = (pooled.float() - self.feature_mean) / self.feature_std
            return self.head(normalized)


def run_sanity(
    manifest_path: Path,
    head_artifact_path: Path,
    cache_dir: Path,
    output_dir: Path,
    *,
    split: str = "validation",
    max_batch_size: int = 4,
    max_padded_seconds: float = 24.0,
    max_window_seconds: float = 60.0,
    evaluation_hop_seconds: float = 60.0,
) -> dict[str, Any]:
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type != "cuda":
        raise RuntimeError("raw WavLM sanity requires CUDA for this workflow")
    rows = [row for row in _read(manifest_path) if row["split"] == split]
    artifact = torch.load(head_artifact_path, map_location="cpu", weights_only=False)
    if artifact["feature_set"] != "embedding_768" or artifact["input_dim"] != 768:
        raise ValueError("expected a 768-dimensional frozen WavLM MLP artifact")
    extractor = AutoFeatureExtractor.from_pretrained(MODEL_ID, cache_dir=cache_dir, local_files_only=True)
    backbone = AutoModel.from_pretrained(
        MODEL_ID, cache_dir=cache_dir, local_files_only=True, dtype=torch.float16
    ).to(device).eval()
    for parameter in backbone.parameters():
        parameter.requires_grad = False
    model = FrozenWavLMWithMLP(backbone, artifact).to(device).eval()
    window_samples = round(max_window_seconds * SAMPLE_RATE)
    hop_samples = round(evaluation_hop_seconds * SAMPLE_RATE)
    dataset = EvaluationWindows(rows, window_samples, hop_samples)
    sampler = LengthBucketBatchSampler(
        dataset.lengths,
        max_batch_size=max_batch_size,
        max_padded_samples=round(max_padded_seconds * SAMPLE_RATE),
        seed=20260721,
    )
    sampler.set_epoch(1)
    loader = DataLoader(dataset, batch_sampler=sampler, collate_fn=Collator(extractor), num_workers=0)
    torch.cuda.reset_peak_memory_stats()
    targets, probabilities = _evaluate(model, loader, rows, device, "mean")
    metrics = _classification_metrics(targets, probabilities, float(artifact["threshold"]))
    report = {
        "status": "WAVLM_FROZEN_RAW_SANITY_COMPLETE",
        "created_at": utc_now_iso(),
        "model_id": MODEL_ID,
        "split": split,
        "clips": len(rows),
        "windows": len(dataset),
        "configuration": {
            "max_batch_size": max_batch_size,
            "max_padded_seconds": max_padded_seconds,
            "max_window_seconds": max_window_seconds,
            "evaluation_hop_seconds": evaluation_hop_seconds,
        },
        "metrics": metrics,
        "probability_summary": {
            "minimum": float(np.min(probabilities)),
            "mean": float(np.mean(probabilities)),
            "maximum": float(np.max(probabilities)),
        },
        "peak_gpu_memory_bytes": int(torch.cuda.max_memory_allocated()),
        "inputs": {
            "manifest": {"path": str(manifest_path.resolve()), "sha256": sha256_file(manifest_path)},
            "head_artifact": {"path": str(head_artifact_path.resolve()), "sha256": sha256_file(head_artifact_path)},
        },
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    write_json(output_dir / "wavlm_frozen_raw_sanity.json", report)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("head_artifact", type=Path)
    parser.add_argument("--cache-dir", type=Path, default=Path("data/model_cache"))
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--split", choices=("validation", "test"), default="validation")
    parser.add_argument("--max-batch-size", type=int, default=4)
    parser.add_argument("--max-padded-seconds", type=float, default=24.0)
    parser.add_argument("--max-window-seconds", type=float, default=60.0)
    parser.add_argument("--evaluation-hop-seconds", type=float, default=60.0)
    args = parser.parse_args()
    report = run_sanity(
        args.manifest,
        args.head_artifact,
        args.cache_dir,
        args.output_dir,
        split=args.split,
        max_batch_size=args.max_batch_size,
        max_padded_seconds=args.max_padded_seconds,
        max_window_seconds=args.max_window_seconds,
        evaluation_hop_seconds=args.evaluation_hop_seconds,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
