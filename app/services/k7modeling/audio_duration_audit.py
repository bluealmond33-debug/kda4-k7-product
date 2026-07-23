"""Audit WAV duration tails before memory-sensitive partial fine-tuning."""

from __future__ import annotations

import argparse
import json
import wave
from pathlib import Path
from typing import Any

import numpy as np

from .anger_mlp import _read
from .io_utils import sha256_file, utc_now_iso, write_json


def audit(manifest_path: Path, output_dir: Path) -> dict[str, Any]:
    rows = _read(manifest_path)
    durations = []
    errors = []
    longest = []
    for row in rows:
        try:
            with wave.open(row["audio_path"], "rb") as handle:
                duration = handle.getnframes() / handle.getframerate()
            durations.append(duration)
            longest.append({"embedding_key": row["embedding_key"], "audio_path": row["audio_path"], "split": row["split"], "duration_seconds": duration})
        except Exception as exc:
            errors.append({"embedding_key": row["embedding_key"], "audio_path": row["audio_path"], "error": repr(exc)})
    values = np.asarray(durations, dtype=np.float64)
    thresholds = (8, 10, 15, 20, 30, 45, 60)
    report = {
        "status": "PASS" if not errors and len(values) == len(rows) else "FAIL",
        "created_at": utc_now_iso(),
        "rows": len(rows), "valid": len(values), "errors": errors,
        "duration_seconds": {
            "minimum": float(values.min()), "mean": float(values.mean()), "maximum": float(values.max()),
            "percentiles": {str(q): float(np.percentile(values, q)) for q in (50, 75, 90, 95, 99, 99.5, 99.9)},
            "counts_above": {str(threshold): int((values > threshold).sum()) for threshold in thresholds},
        },
        "longest_20": sorted(longest, key=lambda item: item["duration_seconds"], reverse=True)[:20],
        "input": {"path": str(manifest_path.resolve()), "sha256": sha256_file(manifest_path)},
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    write_json(output_dir / "audio_duration_audit.json", report)
    (output_dir / "audio_duration_audit.md").write_text(_markdown(report), encoding="utf-8")
    return report


def _markdown(report: dict[str, Any]) -> str:
    duration = report["duration_seconds"]
    lines = [
        "# WAV duration tail audit", "",
        f"- status: **{report['status']}**",
        f"- rows / valid / errors: {report['rows']:,} / {report['valid']:,} / {len(report['errors']):,}",
        f"- min / mean / max seconds: {duration['minimum']:.3f} / {duration['mean']:.3f} / {duration['maximum']:.3f}",
        "", "## Percentiles", "", "| percentile | seconds |", "|---:|---:|",
    ]
    lines.extend(f"| {key} | {value:.3f} |" for key, value in duration["percentiles"].items())
    lines += ["", "## Tail counts", "", "| longer than seconds | count |", "|---:|---:|"]
    lines.extend(f"| {key} | {value} |" for key, value in duration["counts_above"].items())
    lines += ["", "## Longest 20", "", "| seconds | split | embedding key |", "|---:|---|---|"]
    lines.extend(f"| {row['duration_seconds']:.3f} | {row['split']} | {row['embedding_key']} |" for row in report["longest_20"])
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    report = audit(args.manifest, args.output_dir)
    print(json.dumps({"status": report["status"], "duration_seconds": report["duration_seconds"]}, ensure_ascii=False, indent=2))
    if report["status"] != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
