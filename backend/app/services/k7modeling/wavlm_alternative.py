"""Resumable WavLM Base+ mean-pooled embedding extraction."""

from __future__ import annotations

import argparse
import csv
import json
import math
import time
import wave
from pathlib import Path

import numpy as np
import torch
from scipy.signal import resample_poly
from transformers import AutoFeatureExtractor, AutoModel

from .io_utils import sha256_file, utc_now_iso, write_csv, write_json


MODEL_ID = "microsoft/wavlm-base-plus"
DIMENSION = 768


def _read(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def _load_16k(path: str) -> np.ndarray:
    """Load PCM WAV without TorchCodec and resample deterministically to 16 kHz."""
    with wave.open(path, "rb") as handle:
        channels = handle.getnchannels()
        sample_width = handle.getsampwidth()
        rate = handle.getframerate()
        frame_count = handle.getnframes()
        compression = handle.getcomptype()
        raw = handle.readframes(frame_count)

    if compression != "NONE":
        raise ValueError(f"compressed WAV is unsupported: {compression}")
    if channels < 1:
        raise ValueError(f"invalid channel count: {channels}")
    if sample_width != 2:
        raise ValueError(f"only 16-bit PCM WAV is supported, got {sample_width * 8}-bit")
    if rate <= 0:
        raise ValueError(f"invalid sample rate: {rate}")

    signal = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if signal.size % channels:
        raise ValueError("PCM sample count is not divisible by channel count")
    if channels > 1:
        signal = signal.reshape(-1, channels).mean(axis=1, dtype=np.float32)
    if rate != 16000:
        divisor = math.gcd(rate, 16000)
        signal = resample_poly(signal, 16000 // divisor, rate // divisor).astype(np.float32, copy=False)
    return np.ascontiguousarray(signal, dtype=np.float32)


def extract_wavlm(
    manifest_path: Path,
    output_dir: Path,
    cache_dir: Path,
    *,
    batch_size: int = 4,
    limit: int | None = None,
) -> dict:
    rows = _read(manifest_path)
    if limit is not None:
        rows = rows[:limit]
    output_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)
    features_path = output_dir / "wavlm_features.npy"
    progress_path = output_dir / "wavlm_progress.json"
    index_path = output_dir / "wavlm_index.csv"
    report_path = output_dir / "wavlm_report.json"
    manifest_hash = sha256_file(manifest_path)

    next_row = 0
    errors: list[dict[str, str]] = []
    if progress_path.exists() and features_path.exists():
        progress = json.loads(progress_path.read_text(encoding="utf-8"))
        if progress["manifest_sha256"] != manifest_hash or progress["row_count"] != len(rows):
            raise ValueError("existing WavLM progress does not match this manifest/limit")
        next_row = int(progress["next_row"])
        errors = list(progress["errors"])
        features = np.lib.format.open_memmap(features_path, mode="r+")
    else:
        features = np.lib.format.open_memmap(features_path, mode="w+", dtype=np.float32, shape=(len(rows), DIMENSION))
        features[:] = np.nan
        features.flush()
        write_json(progress_path, {"status": "RUNNING", "manifest_sha256": manifest_hash, "row_count": len(rows), "next_row": 0, "errors": []})

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    extractor = AutoFeatureExtractor.from_pretrained(
        MODEL_ID,
        cache_dir=cache_dir,
        local_files_only=True,
    )
    model = AutoModel.from_pretrained(
        MODEL_ID,
        cache_dir=cache_dir,
        dtype=torch.float16 if device.type == "cuda" else torch.float32,
        local_files_only=True,
    ).to(device).eval()
    started = time.time()
    for start in range(next_row, len(rows), batch_size):
        batch = rows[start:start + batch_size]
        try:
            signals = [_load_16k(row["audio_path"]) for row in batch]
            inputs = extractor(signals, sampling_rate=16000, padding=True, return_tensors="pt")
            input_values = inputs.input_values.to(device, dtype=torch.float16 if device.type == "cuda" else torch.float32)
            attention_mask = inputs.attention_mask.to(device) if "attention_mask" in inputs else torch.ones_like(input_values, dtype=torch.long)
            with torch.inference_mode():
                hidden = model(input_values=input_values, attention_mask=attention_mask).last_hidden_state
                feature_mask = model._get_feature_vector_attention_mask(hidden.shape[1], attention_mask)
                pooled = (hidden * feature_mask.unsqueeze(-1)).sum(dim=1) / feature_mask.sum(dim=1, keepdim=True).clamp_min(1)
            values = pooled.float().cpu().numpy()
            if values.shape != (len(batch), DIMENSION) or not np.isfinite(values).all():
                raise ValueError(f"invalid WavLM output: {values.shape}")
            features[start:start + len(batch)] = values
        except Exception as exc:
            errors.extend({"embedding_key": row["embedding_key"], "error": repr(exc)} for row in batch)
        features.flush()
        write_json(progress_path, {
            "status": "COMPLETE" if start + len(batch) >= len(rows) else "RUNNING",
            "manifest_sha256": manifest_hash, "row_count": len(rows),
            "next_row": start + len(batch), "errors": errors, "updated_at": utc_now_iso(),
        })

    elapsed = time.time() - started
    valid = np.isfinite(features).all(axis=1)
    index = [{
        "embedding_key": row["embedding_key"], "wav_id": row["wav_id"],
        "feature_row": idx, "status": "OK" if valid[idx] else "ERROR",
    } for idx, row in enumerate(rows)]
    write_csv(index_path, index, ["embedding_key", "wav_id", "feature_row", "status"])
    report = {
        "status": "WAVLM_EMBEDDINGS_COMPLETE", "created_at": utc_now_iso(),
        "model_id": MODEL_ID, "device": str(device),
        "gpu_name": torch.cuda.get_device_name(0) if device.type == "cuda" else None,
        "rows": len(rows), "valid_rows": int(valid.sum()), "error_rows": int((~valid).sum()),
        "dimension": DIMENSION, "elapsed_seconds": elapsed,
        "rows_per_second": len(rows) / elapsed if elapsed else None,
        "errors": errors,
        "inputs": {"manifest": str(manifest_path.resolve()), "manifest_sha256": manifest_hash},
        "outputs": {"features": str(features_path.resolve()), "index": str(index_path.resolve())},
    }
    write_json(report_path, report)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path("data/wavlm_embeddings"))
    parser.add_argument("--cache-dir", type=Path, default=Path("data/model_cache"))
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    report = extract_wavlm(args.manifest, args.output_dir, args.cache_dir, batch_size=args.batch_size, limit=args.limit)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
