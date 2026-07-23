"""Validate raw-WAV layer-fusion inference against cached features and benchmark runtime."""

from __future__ import annotations

import argparse
import csv
import json
import time
import wave
from pathlib import Path
from typing import Any

import numpy as np
import torch

from .anger_baselines import _classification_metrics
from .io_utils import sha256_file, utc_now_iso, write_json
from .wavlm_layer_fusion_runtime import WavLMLayerFusionRuntime


def _read(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def _duration(path: str) -> float:
    with wave.open(path, "rb") as handle:
        return handle.getnframes() / handle.getframerate()


def _synchronize(device: torch.device) -> None:
    if device.type == "cuda":
        torch.cuda.synchronize(device)


def run_validation(
    manifest_path: Path,
    artifact_path: Path,
    reference_features_path: Path,
    reference_index_path: Path,
    cache_dir: Path,
    output_dir: Path,
    *,
    split: str = "test",
    batch_size: int = 8,
    latency_clips: int = 32,
) -> dict[str, Any]:
    rows = _read(manifest_path)
    index_rows = _read(reference_index_path)
    features = np.load(reference_features_path, mmap_mode="r")
    if len(rows) != len(index_rows) or features.shape != (len(rows), 4, 1536):
        raise ValueError("manifest/index/reference feature shape mismatch")
    if [row["embedding_key"] for row in rows] != [row["embedding_key"] for row in index_rows]:
        raise ValueError("manifest/index key order mismatch")
    if any(row["status"] != "OK" for row in index_rows):
        raise ValueError("reference index contains non-OK rows")

    selected_indices = np.asarray([index for index, row in enumerate(rows) if row["split"] == split])
    if len(selected_indices) == 0:
        raise ValueError(f"split has no rows: {split}")
    durations = np.asarray([_duration(rows[int(index)]["audio_path"]) for index in selected_indices])
    order = np.argsort(durations, kind="stable")

    load_started = time.perf_counter()
    runtime = WavLMLayerFusionRuntime(artifact_path, cache_dir)
    _synchronize(runtime.device)
    model_load_seconds = time.perf_counter() - load_started
    if runtime.device.type == "cuda":
        torch.cuda.reset_peak_memory_stats(runtime.device)

    reference_values = torch.from_numpy(
        np.ascontiguousarray(features[selected_indices], dtype=np.float32)
    ).to(runtime.device)
    cached_outputs = []
    with torch.inference_mode():
        for start in range(0, len(reference_values), batch_size * 4):
            cached_outputs.append(
                torch.sigmoid(runtime.head(reference_values[start:start + batch_size * 4])).cpu().numpy()
            )
    cached_probability = np.concatenate(cached_outputs)
    del reference_values

    raw_probability = np.empty(len(selected_indices), dtype=np.float32)
    inference_started = time.perf_counter()
    for start in range(0, len(order), batch_size):
        positions = order[start:start + batch_size]
        paths = [rows[int(selected_indices[position])]["audio_path"] for position in positions]
        predictions = runtime.predict_paths(paths)
        for position, prediction in zip(positions, predictions):
            raw_probability[position] = prediction["anger_probability"]
    _synchronize(runtime.device)
    batch_inference_seconds = time.perf_counter() - inference_started

    targets = np.asarray(
        [int(rows[int(index)]["anger_binary_target"]) for index in selected_indices], dtype=np.int8
    )
    raw_metrics = _classification_metrics(targets, raw_probability, runtime.threshold)
    cached_metrics = _classification_metrics(targets, cached_probability, runtime.threshold)
    difference = np.abs(raw_probability - cached_probability)
    raw_label = raw_probability >= runtime.threshold
    cached_label = cached_probability >= runtime.threshold

    sample_count = min(latency_clips, len(order))
    latency_positions = order[
        np.linspace(0, len(order) - 1, num=sample_count, dtype=int)
    ]
    warmup_positions = latency_positions[: min(3, sample_count)]
    for position in warmup_positions:
        runtime.predict_path(rows[int(selected_indices[position])]["audio_path"])
    _synchronize(runtime.device)
    latencies = []
    for position in latency_positions:
        started = time.perf_counter()
        runtime.predict_path(rows[int(selected_indices[position])]["audio_path"])
        _synchronize(runtime.device)
        latencies.append(time.perf_counter() - started)
    latencies_array = np.asarray(latencies)

    peak_gpu_memory = (
        int(torch.cuda.max_memory_allocated(runtime.device)) if runtime.device.type == "cuda" else None
    )
    total_audio_seconds = float(durations.sum())
    report = {
        "status": "WAVLM_LAYER_FUSION_RUNTIME_VALIDATION_COMPLETE",
        "created_at": utc_now_iso(),
        "split": split,
        "clips": len(selected_indices),
        "threshold": runtime.threshold,
        "raw_wav_metrics": raw_metrics,
        "cached_feature_metrics": cached_metrics,
        "raw_cached_consistency": {
            "mean_absolute_probability_difference": float(difference.mean()),
            "p95_absolute_probability_difference": float(np.percentile(difference, 95)),
            "maximum_absolute_probability_difference": float(difference.max()),
            "threshold_label_agreement": float((raw_label == cached_label).mean()),
            "different_threshold_labels": int((raw_label != cached_label).sum()),
        },
        "benchmark": {
            "device": str(runtime.device),
            "gpu_name": torch.cuda.get_device_name(runtime.device) if runtime.device.type == "cuda" else None,
            "model_load_seconds": model_load_seconds,
            "batch_size": batch_size,
            "batch_inference_seconds": batch_inference_seconds,
            "clips_per_second": len(selected_indices) / batch_inference_seconds,
            "total_audio_seconds": total_audio_seconds,
            "real_time_factor": batch_inference_seconds / total_audio_seconds,
            "single_request_samples": sample_count,
            "single_request_latency_mean_seconds": float(latencies_array.mean()),
            "single_request_latency_p50_seconds": float(np.percentile(latencies_array, 50)),
            "single_request_latency_p95_seconds": float(np.percentile(latencies_array, 95)),
            "single_request_latency_max_seconds": float(latencies_array.max()),
            "peak_gpu_memory_bytes": peak_gpu_memory,
        },
        "external_holdout": {
            "status": "NOT_AVAILABLE",
            "required_before_product_replacement": True,
            "reason": "No independent speaker-labelled or real-call holdout was provided.",
        },
        "usage_restriction": "Emotion evidence only; excluded from S/G/E routing and counselor assignment.",
        "inputs": {
            "manifest": {"path": str(manifest_path.resolve()), "sha256": sha256_file(manifest_path)},
            "artifact": {"path": str(artifact_path.resolve()), "sha256": sha256_file(artifact_path)},
            "reference_features": {
                "path": str(reference_features_path.resolve()),
                "sha256": sha256_file(reference_features_path),
            },
            "reference_index": {
                "path": str(reference_index_path.resolve()),
                "sha256": sha256_file(reference_index_path),
            },
        },
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    write_json(output_dir / "wavlm_layer_fusion_runtime_validation.json", report)
    (output_dir / "wavlm_layer_fusion_runtime_validation.md").write_text(
        _markdown(report), encoding="utf-8"
    )
    return report


def _markdown(report: dict[str, Any]) -> str:
    raw = report["raw_wav_metrics"]
    cached = report["cached_feature_metrics"]
    consistency = report["raw_cached_consistency"]
    benchmark = report["benchmark"]
    return "\n".join([
        "# WavLM layer-fusion raw-WAV runtime validation",
        "",
        f"- split/clips: {report['split']} / {report['clips']}",
        f"- fixed threshold: {report['threshold']:.3f}",
        f"- raw WAV angry F1 / Macro-F1 / UAR: {raw['f1']:.4f} / {raw['macro_f1']:.4f} / {raw['uar']:.4f}",
        f"- cached angry F1 / Macro-F1 / UAR: {cached['f1']:.4f} / {cached['macro_f1']:.4f} / {cached['uar']:.4f}",
        f"- raw/cache label agreement: {consistency['threshold_label_agreement']:.4%}",
        f"- mean/max probability difference: {consistency['mean_absolute_probability_difference']:.6f} / {consistency['maximum_absolute_probability_difference']:.6f}",
        "",
        "## RTX benchmark",
        "",
        f"- model load: {benchmark['model_load_seconds']:.3f}s",
        f"- batch throughput: {benchmark['clips_per_second']:.2f} clips/s",
        f"- real-time factor: {benchmark['real_time_factor']:.4f}",
        f"- single request mean/p50/p95/max: {benchmark['single_request_latency_mean_seconds']:.3f}s / {benchmark['single_request_latency_p50_seconds']:.3f}s / {benchmark['single_request_latency_p95_seconds']:.3f}s / {benchmark['single_request_latency_max_seconds']:.3f}s",
        f"- peak GPU allocated: {benchmark['peak_gpu_memory_bytes'] / (1024 ** 3):.3f} GiB" if benchmark["peak_gpu_memory_bytes"] is not None else "- peak GPU allocated: N/A",
        "",
        "> External holdout remains unavailable. This validates implementation consistency and development-test behavior, not final product generalization.",
        "",
    ])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("artifact", type=Path)
    parser.add_argument("reference_features", type=Path)
    parser.add_argument("reference_index", type=Path)
    parser.add_argument("--cache-dir", type=Path, default=Path("data/model_cache"))
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--split", choices=("validation", "test"), default="test")
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--latency-clips", type=int, default=32)
    args = parser.parse_args()
    report = run_validation(
        args.manifest,
        args.artifact,
        args.reference_features,
        args.reference_index,
        args.cache_dir,
        args.output_dir,
        split=args.split,
        batch_size=args.batch_size,
        latency_clips=args.latency_clips,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
