"""Extract resumable multi-layer WavLM mean and standard-deviation embeddings."""

from __future__ import annotations

import argparse
import csv
import json
import time
from pathlib import Path

import numpy as np
import torch
from transformers import AutoFeatureExtractor, AutoModel

from .io_utils import sha256_file, utc_now_iso, write_csv, write_json
from .wavlm_alternative import MODEL_ID, _load_16k


HIDDEN_SIZE = 768
DEFAULT_LAYERS = (3, 6, 9, 12)


def _read(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def extract_layerwise(
    manifest_path: Path,
    output_dir: Path,
    cache_dir: Path,
    *,
    batch_size: int = 4,
    layers: tuple[int, ...] = DEFAULT_LAYERS,
    limit: int | None = None,
) -> dict:
    rows = _read(manifest_path)
    if limit is not None:
        rows = rows[:limit]
    if not layers or min(layers) < 1 or max(layers) > 12 or len(set(layers)) != len(layers):
        raise ValueError("layers must be unique WavLM encoder layer numbers in 1..12")
    output_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)
    features_path = output_dir / "wavlm_layerwise_mean_std.npy"
    progress_path = output_dir / "wavlm_layerwise_progress.json"
    index_path = output_dir / "wavlm_layerwise_index.csv"
    report_path = output_dir / "wavlm_layerwise_report.json"
    manifest_hash = sha256_file(manifest_path)
    shape = (len(rows), len(layers), HIDDEN_SIZE * 2)

    next_row = 0
    errors: list[dict[str, str]] = []
    if progress_path.exists() and features_path.exists():
        progress = json.loads(progress_path.read_text(encoding="utf-8"))
        expected = {
            "manifest_sha256": manifest_hash,
            "row_count": len(rows),
            "layers": list(layers),
        }
        if any(progress.get(key) != value for key, value in expected.items()):
            raise ValueError("existing layerwise progress does not match this run")
        next_row = int(progress["next_row"])
        errors = list(progress["errors"])
        features = np.lib.format.open_memmap(features_path, mode="r+")
    else:
        features = np.lib.format.open_memmap(features_path, mode="w+", dtype=np.float32, shape=shape)
        features[:] = np.nan
        features.flush()
        write_json(progress_path, {
            "status": "RUNNING", "manifest_sha256": manifest_hash,
            "row_count": len(rows), "layers": list(layers), "next_row": 0, "errors": [],
        })

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    extractor = AutoFeatureExtractor.from_pretrained(MODEL_ID, cache_dir=cache_dir, local_files_only=True)
    model = AutoModel.from_pretrained(
        MODEL_ID, cache_dir=cache_dir, local_files_only=True,
        dtype=torch.float16 if device.type == "cuda" else torch.float32,
    ).to(device).eval()
    started = time.time()
    for start in range(next_row, len(rows), batch_size):
        batch = rows[start:start + batch_size]
        try:
            signals = [_load_16k(row["audio_path"]) for row in batch]
            inputs = extractor(signals, sampling_rate=16000, padding=True, return_tensors="pt")
            input_values = inputs.input_values.to(device)
            attention_mask = inputs.get("attention_mask", torch.ones_like(inputs.input_values, dtype=torch.long)).to(device)
            with torch.inference_mode(), torch.autocast(
                device_type=device.type, dtype=torch.float16, enabled=device.type == "cuda"
            ):
                output = model(
                    input_values=input_values,
                    attention_mask=attention_mask,
                    output_hidden_states=True,
                )
                layer_values = []
                for layer_number in layers:
                    hidden = output.hidden_states[layer_number]
                    mask = model._get_feature_vector_attention_mask(hidden.shape[1], attention_mask).unsqueeze(-1)
                    denominator = mask.sum(dim=1).clamp_min(1)
                    mean = (hidden * mask).sum(dim=1) / denominator
                    variance = ((hidden - mean.unsqueeze(1)).square() * mask).sum(dim=1) / denominator
                    standard_deviation = variance.clamp_min(1e-6).sqrt()
                    layer_values.append(torch.cat([mean, standard_deviation], dim=-1))
                values = torch.stack(layer_values, dim=1).float().cpu().numpy()
            if values.shape != (len(batch), len(layers), HIDDEN_SIZE * 2) or not np.isfinite(values).all():
                raise ValueError(f"invalid layerwise WavLM output: {values.shape}")
            features[start:start + len(batch)] = values
        except Exception as exc:
            errors.extend({"embedding_key": row["embedding_key"], "error": repr(exc)} for row in batch)
        features.flush()
        write_json(progress_path, {
            "status": "COMPLETE" if start + len(batch) >= len(rows) else "RUNNING",
            "manifest_sha256": manifest_hash, "row_count": len(rows), "layers": list(layers),
            "next_row": start + len(batch), "errors": errors, "updated_at": utc_now_iso(),
        })

    elapsed = time.time() - started
    valid = np.isfinite(features).all(axis=(1, 2))
    index = [{
        "embedding_key": row["embedding_key"], "wav_id": row["wav_id"],
        "feature_row": index, "status": "OK" if valid[index] else "ERROR",
    } for index, row in enumerate(rows)]
    write_csv(index_path, index, ["embedding_key", "wav_id", "feature_row", "status"])
    report = {
        "status": "WAVLM_LAYERWISE_COMPLETE" if valid.all() else "WAVLM_LAYERWISE_HAS_ERRORS",
        "created_at": utc_now_iso(), "model_id": MODEL_ID, "layers": list(layers),
        "statistics_per_layer": ["mean", "standard_deviation"],
        "device": str(device), "gpu_name": torch.cuda.get_device_name(0) if device.type == "cuda" else None,
        "rows": len(rows), "valid_rows": int(valid.sum()), "error_rows": int((~valid).sum()),
        "shape": list(shape), "elapsed_seconds": elapsed,
        "rows_per_second": len(rows) / elapsed if elapsed else None, "errors": errors,
        "inputs": {"manifest": str(manifest_path.resolve()), "manifest_sha256": manifest_hash},
        "outputs": {"features": str(features_path.resolve()), "index": str(index_path.resolve())},
    }
    write_json(report_path, report)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path, default=Path("data/model_cache"))
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--layers", type=int, nargs="+", default=list(DEFAULT_LAYERS))
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    report = extract_layerwise(
        args.manifest, args.output_dir, args.cache_dir,
        batch_size=args.batch_size, layers=tuple(args.layers), limit=args.limit,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["error_rows"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
