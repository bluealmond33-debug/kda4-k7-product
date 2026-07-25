"""Aggregate repeated anger-model runs into a compact stability report."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np

from .io_utils import utc_now_iso, write_json


METRICS = ("precision", "recall", "f1", "macro_f1", "uar", "predicted_positive_rate")


def aggregate(report_paths: list[Path], output_dir: Path) -> dict[str, Any]:
    runs = []
    for path in report_paths:
        report = json.loads(path.read_text(encoding="utf-8"))
        selected = report["selected"]
        runs.append({
            "path": str(path.resolve()),
            "seed": report["seed"],
            "candidate": selected["candidate_id"],
            "threshold": selected["test"]["threshold"],
            **{name: selected["test"][name] for name in METRICS},
            "confusion_matrix": selected["test"]["confusion_matrix"],
        })

    summary = {}
    for name in ("threshold", *METRICS):
        values = np.asarray([run[name] for run in runs], dtype=np.float64)
        summary[name] = {
            "mean": float(values.mean()),
            "standard_deviation": float(values.std(ddof=0)),
            "minimum": float(values.min()),
            "maximum": float(values.max()),
        }
    result = {
        "status": "ANGER_STABILITY_REPORT_COMPLETE",
        "created_at": utc_now_iso(),
        "run_count": len(runs),
        "runs": runs,
        "summary": summary,
        "caveat": "Repeated access makes this a development test, not a locked final holdout.",
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    write_json(output_dir / "anger_stability.json", result)
    (output_dir / "anger_stability.md").write_text(_markdown(result), encoding="utf-8")
    return result


def _markdown(report: dict[str, Any]) -> str:
    lines = [
        "# WavLM anger MLP seed stability", "",
        "| seed | candidate | threshold | precision | recall | angry F1 | Macro-F1 | UAR | positive rate |",
        "|---:|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for run in report["runs"]:
        lines.append(
            f"| {run['seed']} | {run['candidate']} | {run['threshold']:.3f} | "
            f"{run['precision']:.4f} | {run['recall']:.4f} | {run['f1']:.4f} | "
            f"{run['macro_f1']:.4f} | {run['uar']:.4f} | {run['predicted_positive_rate']:.4f} |"
        )
    lines += ["", "## Mean ± population standard deviation", ""]
    for name in METRICS:
        value = report["summary"][name]
        lines.append(
            f"- {name}: {value['mean']:.4f} ± {value['standard_deviation']:.4f} "
            f"(range {value['minimum']:.4f}–{value['maximum']:.4f})"
        )
    lines += ["", f"> {report['caveat']}", ""]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", nargs="+", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    report = aggregate(args.reports, args.output_dir)
    print(json.dumps({"status": report["status"], "run_count": report["run_count"], "summary": report["summary"]}, indent=2))


if __name__ == "__main__":
    main()
