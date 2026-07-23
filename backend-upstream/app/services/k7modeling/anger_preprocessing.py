"""Build a reproducible, anger-focused manifest for AIHub dataset 263.

The source CSV files are CP949 encoded.  This module intentionally uses only the
standard library so manifest generation does not depend on the training stack.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import wave
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

from .io_utils import sha256_file, utc_now_iso, write_csv, write_json


EMOTIONS = ("angry", "disgust", "fear", "happiness", "neutral", "sadness", "surprise")
ALIASES = {
    "anger": "angry",
    "angry": "angry",
    "disgust": "disgust",
    "disgusted": "disgust",
    "fear": "fear",
    "fearful": "fear",
    "happy": "happiness",
    "happiness": "happiness",
    "neutral": "neutral",
    "sad": "sadness",
    "sadness": "sadness",
    "surprise": "surprise",
    "surprised": "surprise",
}
MANIFEST_FIELDS = (
    "wav_id", "audio_path", "audio_status", "source_csv", "source_row", "transcript",
    "situation_label", "majority_label", "majority_votes", "annotation_agreement",
    "high_consensus", "rater_emotions", "rater_intensities", "angry_votes",
    "anger_vote_ratio", "anger_intensity_score", "anger_level", "soft_anger_target",
    "age", "sex", "proxy_group", "proxy_group_method", "split", "usable_for_training",
)


def normalize_emotion(value: str) -> str:
    normalized = ALIASES.get(value.strip().lower())
    if normalized is None:
        raise ValueError(f"unknown emotion label: {value!r}")
    return normalized


def stable_split(group: str, seed: int) -> str:
    value = int(hashlib.sha256(f"{seed}:{group}".encode()).hexdigest()[:16], 16) % 100
    return "train" if value < 80 else "validation" if value < 90 else "test"


def anger_level(score: float) -> str:
    if score == 0:
        return "none"
    if score <= 33:
        return "low"
    if score <= 66:
        return "medium"
    return "high"


def _read_source(path: Path) -> tuple[list[str], list[list[str]]]:
    with path.open("r", encoding="cp949", newline="") as handle:
        reader = csv.reader(handle)
        header = next(reader)
        rows = list(reader)
    if len(header) != 15:
        raise ValueError(f"{path.name}: expected 15 columns, got {len(header)}")
    return header, rows


def _audio_index(dataset_root: Path) -> tuple[dict[str, Path], dict[str, list[str]]]:
    paths: dict[str, Path] = {}
    duplicates: dict[str, list[str]] = defaultdict(list)
    for path in sorted(dataset_root.rglob("*.wav")):
        wav_id = path.stem
        if wav_id in paths:
            duplicates[wav_id].extend((str(paths[wav_id]), str(path)))
        else:
            paths[wav_id] = path.resolve()
    return paths, {key: sorted(set(value)) for key, value in duplicates.items()}


def _audio_summary(paths: Iterable[Path], sample_size: int | None = 1000) -> dict[str, Any]:
    candidates = sorted(paths)
    total_paths = len(candidates)
    if sample_size is not None and sample_size < total_paths:
        # Evenly spaced selection is deterministic and covers the full sorted corpus.
        candidates = [candidates[round(i * (total_paths - 1) / (sample_size - 1))] for i in range(sample_size)]
    formats: Counter[str] = Counter()
    durations: list[float] = []
    unreadable: list[dict[str, str]] = []
    for path in candidates:
        try:
            with wave.open(str(path), "rb") as wav:
                rate = wav.getframerate()
                frames = wav.getnframes()
                formats[f"{rate}Hz/{wav.getnchannels()}ch/{wav.getsampwidth() * 8}bit"] += 1
                if rate:
                    durations.append(frames / rate)
        except (wave.Error, OSError) as exc:
            unreadable.append({"path": str(path), "error": str(exc)})
    durations.sort()
    def percentile(p: float) -> float | None:
        if not durations:
            return None
        return durations[round((len(durations) - 1) * p)]
    return {
        "inspection_method": "full" if len(candidates) == total_paths else "deterministic_even_sample",
        "corpus_file_count": total_paths,
        "inspected_file_count": len(candidates),
        "format_counts": dict(sorted(formats.items())),
        "duration_seconds": {
            "count": len(durations),
            "mean": round(sum(durations) / len(durations), 4) if durations else None,
            "min": round(durations[0], 4) if durations else None,
            "p50": round(percentile(0.5), 4) if durations else None,
            "p95": round(percentile(0.95), 4) if durations else None,
            "max": round(durations[-1], 4) if durations else None,
        },
        "unreadable_count": len(unreadable),
        "unreadable_examples": unreadable[:20],
    }


def build_anger_manifest(
    dataset_root: Path,
    output_dir: Path,
    *,
    consensus_threshold: int = 3,
    seed: int = 20260721,
    inspect_audio: bool = True,
    audio_sample_size: int | None = 1000,
) -> dict[str, Any]:
    dataset_root = dataset_root.resolve()
    csv_paths = sorted(dataset_root.glob("*.csv"))
    if not csv_paths:
        raise FileNotFoundError(f"no CSV files found in {dataset_root}")
    if not 3 <= consensus_threshold <= 5:
        raise ValueError("consensus_threshold must be between 3 and 5")

    audio_by_id, duplicate_audio = _audio_index(dataset_root)
    csv_ids: Counter[str] = Counter()
    manifest: list[dict[str, Any]] = []
    invalid_rows: list[dict[str, Any]] = []
    source_counts: dict[str, int] = {}
    previous_demographic: tuple[str, str] | None = None
    proxy_run = -1

    for csv_path in csv_paths:
        _, rows = _read_source(csv_path)
        source_counts[csv_path.name] = len(rows)
        previous_demographic = None
        for source_row, row in enumerate(rows, start=2):
            try:
                wav_id, transcript, situation = row[:3]
                emotions = [normalize_emotion(row[index]) for index in (3, 5, 7, 9, 11)]
                intensities = [int(row[index]) for index in (4, 6, 8, 10, 12)]
                if any(value not in (0, 1, 2) for value in intensities):
                    raise ValueError(f"intensity outside 0..2: {intensities}")
                situation = normalize_emotion(situation)
            except (ValueError, IndexError) as exc:
                invalid_rows.append({"source_csv": csv_path.name, "source_row": source_row, "error": str(exc)})
                continue

            csv_ids[wav_id] += 1
            age, sex = row[13].strip(), row[14].strip().lower()
            demographic = (age, sex)
            if demographic != previous_demographic:
                proxy_run += 1
                previous_demographic = demographic
            proxy_group = f"{csv_path.stem}:DEMOGRAPHIC_RUN_{proxy_run:05d}"

            counts = Counter(emotions)
            majority_label, majority_votes = sorted(counts.items(), key=lambda item: (-item[1], item[0]))[0]
            angry_votes = counts["angry"]
            soft_target = sum(i for e, i in zip(emotions, intensities) if e == "angry") / 10.0
            intensity_score = round(soft_target * 100.0, 1)
            audio_path = audio_by_id.get(wav_id)
            high_consensus = majority_votes >= consensus_threshold
            matched = audio_path is not None and wav_id not in duplicate_audio
            manifest.append({
                "wav_id": wav_id,
                "audio_path": str(audio_path) if audio_path else "",
                "audio_status": "duplicate" if wav_id in duplicate_audio else "matched" if audio_path else "missing",
                "source_csv": csv_path.name,
                "source_row": source_row,
                "transcript": transcript.strip(),
                "situation_label": situation,
                "majority_label": majority_label,
                "majority_votes": majority_votes,
                "annotation_agreement": round(majority_votes / 5.0, 1),
                "high_consensus": int(high_consensus),
                "rater_emotions": "|".join(emotions),
                "rater_intensities": "|".join(map(str, intensities)),
                "angry_votes": angry_votes,
                "anger_vote_ratio": round(angry_votes / 5.0, 1),
                "anger_intensity_score": intensity_score,
                "anger_level": anger_level(intensity_score),
                "soft_anger_target": round(soft_target, 1),
                "age": age,
                "sex": sex,
                "proxy_group": proxy_group,
                "proxy_group_method": "CONTIGUOUS_AGE_SEX_RUN_WITHIN_SOURCE",
                "split": stable_split(proxy_group, seed) if high_consensus and matched else "excluded",
                "usable_for_training": int(high_consensus and matched),
            })

    wav_ids = set(audio_by_id)
    csv_id_set = set(csv_ids)
    usable = [row for row in manifest if row["usable_for_training"]]
    split_label_counts = {
        split: dict(Counter(row["majority_label"] for row in usable if row["split"] == split))
        for split in ("train", "validation", "test")
    }
    angry_rating_intensities: Counter[str] = Counter()
    for row in manifest:
        for emotion, intensity in zip(row["rater_emotions"].split("|"), row["rater_intensities"].split("|")):
            if emotion == "angry":
                angry_rating_intensities[intensity] += 1
    report: dict[str, Any] = {
        "status": "ANGER_PREPROCESSING_COMPLETE",
        "created_at": utc_now_iso(),
        "dataset_root": str(dataset_root),
        "configuration": {"consensus_threshold": consensus_threshold, "seed": seed, "split": "80/10/10 stable proxy-group hash"},
        "source_csv_rows": source_counts,
        "counts": {
            "csv_rows": sum(source_counts.values()),
            "valid_manifest_rows": len(manifest),
            "invalid_rows": len(invalid_rows),
            "unique_csv_ids": len(csv_id_set),
            "duplicate_csv_ids": sum(count - 1 for count in csv_ids.values() if count > 1),
            "wav_files": len(audio_by_id) + sum(len(paths) - 1 for paths in duplicate_audio.values()),
            "unique_wav_ids": len(wav_ids),
            "duplicate_wav_ids": len(duplicate_audio),
            "matched_unique_ids": len(csv_id_set & wav_ids),
            "csv_only_ids": len(csv_id_set - wav_ids),
            "wav_only_ids": len(wav_ids - csv_id_set),
            "high_consensus_matched_rows": len(usable),
        },
        "distributions": {
            "situation_label": dict(Counter(row["situation_label"] for row in manifest)),
            "majority_label_all": dict(Counter(row["majority_label"] for row in manifest)),
            "majority_label_high_consensus_matched": dict(Counter(row["majority_label"] for row in usable)),
            "split": dict(Counter(row["split"] for row in manifest)),
            "split_usable": dict(Counter(row["split"] for row in usable)),
            "split_by_majority_label": split_label_counts,
            "angry_votes": dict(Counter(str(row["angry_votes"]) for row in manifest)),
            "anger_level": dict(Counter(row["anger_level"] for row in manifest)),
            "angry_rating_intensity": dict(sorted(angry_rating_intensities.items())),
        },
        "anger_statistics": {
            "situation_angry": sum(row["situation_label"] == "angry" for row in manifest),
            "at_least_one_angry_vote": sum(row["angry_votes"] >= 1 for row in manifest),
            "at_least_three_angry_votes": sum(row["angry_votes"] >= 3 for row in manifest),
            "at_least_three_angry_votes_matched": sum(row["angry_votes"] >= 3 and row["audio_status"] == "matched" for row in manifest),
            "unanimous_angry": sum(row["angry_votes"] == 5 for row in manifest),
        },
        "quality_issues": {
            "csv_only_ids": sorted(csv_id_set - wav_ids),
            "wav_only_ids": sorted(wav_ids - csv_id_set),
            "duplicate_audio": duplicate_audio,
            "invalid_row_examples": invalid_rows[:20],
        },
        "input_sha256": {path.name: sha256_file(path) for path in csv_paths},
        "audio": _audio_summary(audio_by_id.values(), audio_sample_size) if inspect_audio else {"inspection_skipped": True},
        "limitations": [
            "The dataset has no verified speaker or dialogue identifier.",
            "proxy_group is a leakage-reduction heuristic, not verified speaker identity.",
            "Emotion targets are annotations only and must not be used by S/G/E routing.",
        ],
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / "anger_manifest.csv"
    report_path = output_dir / "anger_data_quality.json"
    write_csv(manifest_path, manifest, MANIFEST_FIELDS)
    report["outputs"] = {"manifest": str(manifest_path.resolve()), "report": str(report_path.resolve())}
    write_json(report_path, report)
    (output_dir / "anger_data_quality.md").write_text(_report_markdown(report), encoding="utf-8")
    return report


def _report_markdown(report: dict[str, Any]) -> str:
    counts = report["counts"]
    distribution = report["distributions"]["majority_label_high_consensus_matched"]
    anger = report["anger_statistics"]
    lines = [
        "# 분노 중심 데이터 품질 리포트", "",
        f"- 생성 시각(UTC): {report['created_at']}",
        f"- CSV 행 / WAV 파일: {counts['csv_rows']:,} / {counts['wav_files']:,}",
        f"- 정확히 매칭된 고합의 학습 후보: {counts['high_consensus_matched_rows']:,}",
        f"- CSV only / WAV only: {counts['csv_only_ids']} / {counts['wav_only_ids']}", "",
        "## 고합의 학습 후보 분포", "",
        *[f"- {label}: {distribution.get(label, 0):,}" for label in EMOTIONS], "",
        "## 분노 통계", "",
        f"- 상황 라벨 angry: {anger['situation_angry']:,}",
        f"- 평가자 1명 이상 angry: {anger['at_least_one_angry_vote']:,}",
        f"- 평가자 3명 이상 angry: {anger['at_least_three_angry_votes']:,}",
        f"- 평가자 3명 이상 angry + WAV 매칭: {anger['at_least_three_angry_votes_matched']:,}",
        f"- 평가자 5명 모두 angry: {anger['unanimous_angry']:,}", "",
        "## 사용 원칙", "",
        "- 1차 학습은 `usable_for_training=1`만 사용한다.",
        "- `soft_anger_target = sum(angry 여부 × 강도) / 10`이다.",
        "- split은 proxy group 단위로 고정하며 S/G/E 라우팅에는 감정 특성을 넣지 않는다.",
        "- 실제 화자 ID가 확보되면 proxy split을 폐기하고 speaker-disjoint split을 다시 만든다.", "",
    ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset_root", type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path("data/anger_preprocessing"))
    parser.add_argument("--consensus-threshold", type=int, default=3)
    parser.add_argument("--seed", type=int, default=20260721)
    parser.add_argument("--skip-audio-inspection", action="store_true")
    parser.add_argument("--audio-sample-size", type=int, default=1000, help="0 inspects every WAV")
    args = parser.parse_args()
    sample_size = None if args.audio_sample_size == 0 else args.audio_sample_size
    if sample_size is not None and sample_size < 2:
        parser.error("--audio-sample-size must be 0 or at least 2")
    report = build_anger_manifest(args.dataset_root, args.output_dir, consensus_threshold=args.consensus_threshold, seed=args.seed, inspect_audio=not args.skip_audio_inspection, audio_sample_size=sample_size)
    print(json.dumps(report["counts"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
