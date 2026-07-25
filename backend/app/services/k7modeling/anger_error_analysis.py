"""Summarize false positives and false negatives from exported anger predictions."""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from .io_utils import utc_now_iso, write_csv, write_json


def _read(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def analyze(predictions_path: Path, output_dir: Path, split: str = "test") -> dict[str, Any]:
    rows = [row for row in _read(predictions_path) if row["split"] == split]
    errors = [row for row in rows if row["error_type"]]
    false_positives = [row for row in errors if row["error_type"] == "FP"]
    false_negatives = [row for row in errors if row["error_type"] == "FN"]

    fp_by_label = Counter(row["majority_label"] for row in false_positives)
    fn_intensity_bins = Counter()
    for row in false_negatives:
        score = float(row["anger_intensity_score"])
        if score < 50:
            fn_intensity_bins["under_50"] += 1
        elif score < 70:
            fn_intensity_bins["50_to_69_9"] += 1
        elif score < 90:
            fn_intensity_bins["70_to_89_9"] += 1
        else:
            fn_intensity_bins["90_to_100"] += 1

    by_agreement: dict[str, dict[str, int]] = defaultdict(lambda: {"rows": 0, "FP": 0, "FN": 0})
    for row in rows:
        key = f"{float(row['annotation_agreement']):.1f}"
        by_agreement[key]["rows"] += 1
        if row["error_type"]:
            by_agreement[key][row["error_type"]] += 1

    top_fp = sorted(false_positives, key=lambda row: float(row["predicted_probability"]), reverse=True)[:50]
    top_fn = sorted(false_negatives, key=lambda row: float(row["predicted_probability"]))[:50]
    report = {
        "status": "ANGER_ERROR_ANALYSIS_COMPLETE",
        "created_at": utc_now_iso(),
        "split": split,
        "counts": {
            "rows": len(rows),
            "errors": len(errors),
            "false_positives": len(false_positives),
            "false_negatives": len(false_negatives),
        },
        "false_positives_by_majority_label": dict(fp_by_label.most_common()),
        "false_negatives_by_intensity_bin": dict(fn_intensity_bins),
        "errors_by_annotation_agreement": dict(sorted(by_agreement.items())),
        "interpretation_limits": [
            "The manifest has no transcript, so semantic causes cannot be determined from this report.",
            "Audio review is required before assigning acoustic or annotation causes.",
            "This split is a repeatedly accessed development test, not a locked final holdout.",
        ],
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    write_json(output_dir / "anger_error_analysis.json", report)
    fields = list(rows[0]) if rows else []
    if fields:
        write_csv(output_dir / "top_50_false_positives.csv", top_fp, fields)
        write_csv(output_dir / "top_50_false_negatives.csv", top_fn, fields)
    (output_dir / "anger_error_analysis.md").write_text(_markdown(report), encoding="utf-8")
    return report


def _markdown(report: dict[str, Any]) -> str:
    counts = report["counts"]
    lines = [
        "# WavLM anger ensemble error analysis", "",
        f"- split: {report['split']}",
        f"- rows / errors: {counts['rows']:,} / {counts['errors']:,}",
        f"- false positives / false negatives: {counts['false_positives']:,} / {counts['false_negatives']:,}",
        "", "## False positives by non-angry majority label", "",
        "| label | count |", "|---|---:|",
    ]
    lines.extend(f"| {label} | {count} |" for label, count in report["false_positives_by_majority_label"].items())
    lines += ["", "## False negatives by annotated anger intensity", "", "| intensity bin | count |", "|---|---:|"]
    lines.extend(f"| {name} | {count} |" for name, count in report["false_negatives_by_intensity_bin"].items())
    lines += ["", "## Annotation agreement", "", "| agreement | rows | FP | FN |", "|---:|---:|---:|---:|"]
    for agreement, value in report["errors_by_annotation_agreement"].items():
        lines.append(f"| {agreement} | {value['rows']} | {value['FP']} | {value['FN']} |")
    lines += ["", "## Limits", ""]
    lines.extend(f"- {item}" for item in report["interpretation_limits"])
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("predictions", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--split", default="test", choices=("validation", "test"))
    args = parser.parse_args()
    report = analyze(args.predictions, args.output_dir, args.split)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
