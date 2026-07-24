"""Validate anger dataset splits and export a frozen-backbone training manifest."""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from .anger_preprocessing import EMOTIONS
from .io_utils import sha256_file, utc_now_iso, write_csv, write_json


TRAINING_FIELDS = (
    "embedding_key", "wav_id", "audio_path", "split", "proxy_group",
    "majority_label", "annotation_agreement", "anger_binary_target",
    "anger_vote_ratio", "anger_intensity_score", "soft_anger_target",
    "intensity_loss_mask", "sample_weight", "age", "sex", "source_csv",
)


def _read(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def _distribution(rows: list[dict[str, str]], key: str) -> dict[str, int]:
    return dict(sorted(Counter(row[key] or "unknown" for row in rows).items()))


def _rates(counts: dict[str, int], total: int) -> dict[str, float]:
    return {key: round(value / total, 6) for key, value in counts.items()} if total else {}


def validate_anger_splits(
    manifest_path: Path,
    output_dir: Path,
    *,
    max_label_rate_delta: float = 0.08,
) -> dict[str, Any]:
    rows = _read(manifest_path)
    usable = [row for row in rows if row["usable_for_training"] == "1"]
    expected_splits = ("train", "validation", "test")
    invalid_splits = sorted({row["split"] for row in usable} - set(expected_splits))

    groups_by_split: dict[str, set[str]] = {
        split: {row["proxy_group"] for row in usable if row["split"] == split}
        for split in expected_splits
    }
    overlaps: dict[str, list[str]] = {}
    for left_index, left in enumerate(expected_splits):
        for right in expected_splits[left_index + 1:]:
            shared = sorted(groups_by_split[left] & groups_by_split[right])
            if shared:
                overlaps[f"{left}__{right}"] = shared

    duplicate_wav_ids = sorted(
        wav_id for wav_id, count in Counter(row["wav_id"] for row in usable).items() if count > 1
    )
    missing_audio = [row["wav_id"] for row in usable if not Path(row["audio_path"]).is_file()]

    split_summaries: dict[str, Any] = {}
    label_rates: dict[str, dict[str, float]] = {}
    training_rows: list[dict[str, Any]] = []
    for split in expected_splits:
        selected = [row for row in usable if row["split"] == split]
        label_counts = _distribution(selected, "majority_label")
        label_rates[split] = _rates(label_counts, len(selected))
        split_summaries[split] = {
            "rows": len(selected),
            "proxy_groups": len(groups_by_split[split]),
            "majority_label_counts": label_counts,
            "majority_label_rates": label_rates[split],
            "sex_counts": _distribution(selected, "sex"),
            "source_csv_counts": _distribution(selected, "source_csv"),
            "age_counts": _distribution(selected, "age"),
            "anger_positive_rows": sum(int(row["angry_votes"]) >= 3 for row in selected),
        }
        for row in selected:
            agreement = float(row["annotation_agreement"])
            training_rows.append({
                "embedding_key": row["wav_id"],
                "wav_id": row["wav_id"],
                "audio_path": row["audio_path"],
                "split": split,
                "proxy_group": row["proxy_group"],
                "majority_label": row["majority_label"],
                "annotation_agreement": agreement,
                "anger_binary_target": int(int(row["angry_votes"]) >= 3),
                "anger_vote_ratio": row["anger_vote_ratio"],
                "anger_intensity_score": row["anger_intensity_score"],
                "soft_anger_target": row["soft_anger_target"],
                "intensity_loss_mask": int(int(row["angry_votes"]) >= 3),
                "sample_weight": agreement,
                "age": row["age"],
                "sex": row["sex"],
                "source_csv": row["source_csv"],
            })

    label_rate_deltas: dict[str, float] = {}
    for label in EMOTIONS:
        values = [label_rates[split].get(label, 0.0) for split in expected_splits]
        label_rate_deltas[label] = round(max(values) - min(values), 6)
    excessive_deltas = {
        label: delta for label, delta in label_rate_deltas.items() if delta > max_label_rate_delta
    }

    failures: list[str] = []
    if invalid_splits:
        failures.append("invalid_split_names")
    if overlaps:
        failures.append("proxy_group_overlap")
    if duplicate_wav_ids:
        failures.append("duplicate_wav_ids")
    if missing_audio:
        failures.append("missing_audio_files")
    if excessive_deltas:
        failures.append("label_rate_delta_exceeded")

    output_dir.mkdir(parents=True, exist_ok=True)
    training_manifest = output_dir / "anger_frozen_embedding_manifest.csv"
    report_path = output_dir / "anger_split_audit.json"
    write_csv(training_manifest, training_rows, TRAINING_FIELDS)
    report: dict[str, Any] = {
        "status": "PASS" if not failures else "FAIL",
        "created_at": utc_now_iso(),
        "manifest": {"path": str(manifest_path.resolve()), "sha256": sha256_file(manifest_path)},
        "configuration": {"max_label_rate_delta": max_label_rate_delta},
        "counts": {"manifest_rows": len(rows), "usable_rows": len(usable), "exported_rows": len(training_rows)},
        "checks": {
            "invalid_splits": invalid_splits,
            "proxy_group_overlaps": {key: value[:20] for key, value in overlaps.items()},
            "duplicate_wav_ids": duplicate_wav_ids[:20],
            "missing_audio_files": missing_audio[:20],
            "label_rate_deltas": label_rate_deltas,
            "excessive_label_rate_deltas": excessive_deltas,
        },
        "split_summaries": split_summaries,
        "failures": failures,
        "limitations": [
            "Proxy groups are contiguous age/sex runs, not verified speaker identities.",
            "A passing audit prevents proxy-group overlap but cannot prove speaker-disjoint evaluation.",
        ],
        "outputs": {"training_manifest": str(training_manifest.resolve()), "report": str(report_path.resolve())},
    }
    write_json(report_path, report)
    (output_dir / "anger_split_audit.md").write_text(_markdown(report), encoding="utf-8")
    return report


def _markdown(report: dict[str, Any]) -> str:
    lines = [
        "# 분노 모델 split 검증 리포트", "",
        f"- 결과: **{report['status']}**",
        f"- 학습 후보: {report['counts']['usable_rows']:,}",
        f"- proxy-group split 중복: {len(report['checks']['proxy_group_overlaps'])}",
        f"- 중복 WAV ID: {len(report['checks']['duplicate_wav_ids'])}",
        f"- 누락 오디오: {len(report['checks']['missing_audio_files'])}", "",
        "## Split별 규모", "",
        "| split | 행 | proxy groups | angry positive |", "|---|---:|---:|---:|",
    ]
    for split, summary in report["split_summaries"].items():
        lines.append(f"| {split} | {summary['rows']:,} | {summary['proxy_groups']:,} | {summary['anger_positive_rows']:,} |")
    lines += ["", "## 클래스 비율 최대 편차", ""]
    lines += [f"- {label}: {delta:.4f}" for label, delta in report["checks"]["label_rate_deltas"].items()]
    lines += ["", "## 주의", "", "실제 화자 ID가 없어 현재 proxy group 검증은 화자 독립 평가를 완전히 보장하지 않는다.", ""]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path("data/anger_preprocessing"))
    parser.add_argument("--max-label-rate-delta", type=float, default=0.08)
    args = parser.parse_args()
    report = validate_anger_splits(args.manifest, args.output_dir, max_label_rate_delta=args.max_label_rate_delta)
    print(json.dumps({"status": report["status"], "counts": report["counts"], "failures": report["failures"]}, ensure_ascii=False, indent=2))
    if report["status"] != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
