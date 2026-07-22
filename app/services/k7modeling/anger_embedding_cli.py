"""CLI for resumable frozen emotion2vec+ extraction on the anger manifest."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .emotion2vec_v2 import extract_emotion2vec_embeddings


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path("data/anger_embeddings"))
    parser.add_argument("--cache-dir", type=Path, default=Path("data/model_cache"))
    parser.add_argument("--device", default="cuda", choices=("cuda", "cpu", "auto"))
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report = extract_emotion2vec_embeddings(
        args.manifest,
        args.output_dir / "emotion2vec_features.npy",
        args.output_dir / "emotion2vec_index.csv",
        args.output_dir / "emotion2vec_progress.json",
        args.output_dir / "emotion2vec_report.json",
        args.cache_dir,
        device=args.device,
        batch_size=args.batch_size,
        limit=args.limit,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
