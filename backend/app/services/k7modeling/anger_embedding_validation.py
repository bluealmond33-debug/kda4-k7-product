"""Integrity gate for frozen speech feature artifacts."""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np

from .io_utils import sha256_file, utc_now_iso, write_json


def _read(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def validate_anger_embeddings(
    manifest_path: Path,
    features_path: Path,
    index_path: Path,
    output_dir: Path,
    *,
    expected_dimension: int = 777,
    embedding_dimension: int = 768,
    artifact_label: str = "emotion2vec+",
) -> dict[str, Any]:
    manifest = _read(manifest_path)
    index = _read(index_path)
    features = np.load(features_path, mmap_mode="r")
    manifest_keys = [row["embedding_key"] for row in manifest]
    index_keys = [row["embedding_key"] for row in index]
    failures: list[str] = []

    if features.shape != (len(manifest), expected_dimension):
        failures.append("unexpected_feature_shape")
    duplicate_manifest = [key for key, count in Counter(manifest_keys).items() if count > 1]
    duplicate_index = [key for key, count in Counter(index_keys).items() if count > 1]
    if duplicate_manifest:
        failures.append("duplicate_manifest_keys")
    if duplicate_index:
        failures.append("duplicate_index_keys")
    if manifest_keys != index_keys:
        failures.append("manifest_index_order_mismatch")
    non_ok = [row["embedding_key"] for row in index if row["status"] != "OK"]
    if non_ok:
        failures.append("non_ok_index_rows")

    finite_by_row = np.isfinite(features).all(axis=1)
    invalid_rows = np.flatnonzero(~finite_by_row).tolist()
    if invalid_rows:
        failures.append("nan_or_inf_features")

    native_scores = features[:, embedding_dimension:]
    report: dict[str, Any] = {
        "status": "PASS" if not failures else "FAIL",
        "created_at": utc_now_iso(),
        "counts": {
            "manifest_rows": len(manifest),
            "index_rows": len(index),
            "feature_rows": int(features.shape[0]),
            "valid_feature_rows": int(finite_by_row.sum()),
            "invalid_feature_rows": len(invalid_rows),
        },
        "dimensions": {
            "total": int(features.shape[1]),
            "embedding": embedding_dimension,
            "native_scores": int(native_scores.shape[1]),
        },
        "checks": {
            "manifest_index_exact_order_match": manifest_keys == index_keys,
            "duplicate_manifest_keys": duplicate_manifest[:20],
            "duplicate_index_keys": duplicate_index[:20],
            "non_ok_index_rows": non_ok[:20],
            "invalid_feature_row_indices": invalid_rows[:20],
        },
        "feature_summary": {
            "minimum": float(np.min(features)),
            "maximum": float(np.max(features)),
            "mean": float(np.mean(features)),
            "standard_deviation": float(np.std(features)),
            "native_score_minimum": float(np.min(native_scores)) if native_scores.size else None,
            "native_score_maximum": float(np.max(native_scores)) if native_scores.size else None,
        },
        "failures": failures,
        "artifact_label": artifact_label,
        "inputs": {
            "manifest": {"path": str(manifest_path.resolve()), "sha256": sha256_file(manifest_path)},
            "features": {"path": str(features_path.resolve()), "sha256": sha256_file(features_path)},
            "index": {"path": str(index_path.resolve()), "sha256": sha256_file(index_path)},
        },
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    write_json(output_dir / "anger_embedding_integrity.json", report)
    (output_dir / "anger_embedding_integrity.md").write_text(_markdown(report), encoding="utf-8")
    return report


def _markdown(report: dict[str, Any]) -> str:
    counts = report["counts"]
    dims = report["dimensions"]
    return "\n".join([
        "# emotion2vec+ embedding 무결성 검사", "",
        f"- 결과: **{report['status']}**",
        f"- manifest / index / features: {counts['manifest_rows']:,} / {counts['index_rows']:,} / {counts['feature_rows']:,}",
        f"- 유효 / 무효 feature: {counts['valid_feature_rows']:,} / {counts['invalid_feature_rows']:,}",
        f"- 차원: {dims['total']} = {dims['embedding']} embedding + {dims['native_scores']} native scores",
        f"- manifest/index 순서 일치: {report['checks']['manifest_index_exact_order_match']}",
        f"- 실패 항목: {report['failures'] or '없음'}", "",
    ])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("features", type=Path)
    parser.add_argument("index", type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path("data/anger_embeddings"))
    parser.add_argument("--expected-dimension", type=int, default=777)
    parser.add_argument("--embedding-dimension", type=int, default=768)
    parser.add_argument("--artifact-label", default="emotion2vec+")
    args = parser.parse_args()
    report = validate_anger_embeddings(
        args.manifest,
        args.features,
        args.index,
        args.output_dir,
        expected_dimension=args.expected_dimension,
        embedding_dimension=args.embedding_dimension,
        artifact_label=args.artifact_label,
    )
    print(json.dumps({"status": report["status"], "counts": report["counts"], "failures": report["failures"]}, ensure_ascii=False, indent=2))
    if report["status"] != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
