import argparse
import base64
import csv
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import requests


URL = "https://api.inworld.ai/stt/v1/transcribe"

EMOTION_LABELS = [
    "tender",
    "sad",
    "calm",
    "neutral",
    "happy",
    "angry",
    "fearful",
    "surprised",
    "disgusted",
    "unclear",
]
PITCH_LABELS = ["low", "medium", "high"]
VOCAL_STYLE_LABELS = [
    "whispering",
    "normal",
    "singing",
    "mumbling",
    "crying",
    "laughing",
    "shouting",
    "monotone",
    "unclear",
]
AGE_LABELS = ["young", "adult", "kid", "old", "unclear"]


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def get_api_key() -> str:
    load_env_file(Path(".env"))
    api_key = os.getenv("INWORLD_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError(
            "INWORLD_API_KEY가 없습니다. PowerShell에서 "
            'setx INWORLD_API_KEY "발급받은_API_KEY" 실행 후 터미널을 다시 열어주세요.'
        )
    return api_key


def read_audio_as_base64(audio_path: Path) -> str:
    return base64.b64encode(audio_path.read_bytes()).decode("utf-8")


def normalize_profile_key(profile: dict[str, Any], camel: str, snake: str) -> list[dict[str, Any]]:
    value = profile.get(camel)
    if value is None:
        value = profile.get(snake)
    if isinstance(value, dict):
        return [value]
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    return []


def confidence_map(items: list[dict[str, Any]]) -> dict[str, float]:
    result: dict[str, float] = {}
    for item in items:
        label = str(item.get("label", "")).strip()
        if not label:
            continue
        try:
            result[label] = float(item.get("confidence", 0.0))
        except (TypeError, ValueError):
            result[label] = 0.0
    return result


def top_label(items: list[dict[str, Any]]) -> tuple[str, float]:
    if not items:
        return "", 0.0
    first = items[0]
    label = str(first.get("label", "")).strip()
    try:
        confidence = float(first.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0
    return label, confidence


def inworld_temperature_proxy(row: dict[str, Any]) -> float:
    score = (
        row["inworld_emotion_angry"] * 45
        + row["inworld_emotion_fearful"] * 20
        + row["inworld_emotion_disgusted"] * 15
        + row["inworld_emotion_surprised"] * 8
        + row["inworld_vocal_shouting"] * 10
        + row["inworld_vocal_crying"] * 7
        + row["inworld_pitch_high"] * 5
        - row["inworld_emotion_calm"] * 15
        - row["inworld_emotion_neutral"] * 10
    )
    return round(max(0.0, min(100.0, score)), 4)


def flatten_response(audio_path: Path, response: dict[str, Any]) -> dict[str, Any]:
    transcription = response.get("transcription") or {}
    profile = (
        response.get("voiceProfile")
        or response.get("voice_profile")
        or transcription.get("voiceProfile")
        or transcription.get("voice_profile")
        or {}
    )
    usage = response.get("usage") or {}

    emotion = confidence_map(normalize_profile_key(profile, "emotion", "emotion"))
    pitch = confidence_map(normalize_profile_key(profile, "pitch", "pitch"))
    vocal = confidence_map(normalize_profile_key(profile, "vocalStyle", "vocal_style"))
    accent_items = normalize_profile_key(profile, "accent", "accent")
    age = confidence_map(normalize_profile_key(profile, "age", "age"))
    accent_label, accent_confidence = top_label(accent_items)

    row: dict[str, Any] = {
        "audio_id": audio_path.stem,
        "audio_path": str(audio_path),
        "transcript": transcription.get("transcript", ""),
        "is_final": transcription.get("isFinal", transcription.get("is_final", "")),
        "usage_transcribed_audio_ms": usage.get(
            "transcribedAudioMs", usage.get("transcribed_audio_ms", "")
        ),
        "usage_model_id": usage.get("modelId", usage.get("model_id", "")),
        "inworld_accent_top_label": accent_label,
        "inworld_accent_top_confidence": accent_confidence,
    }

    for label in EMOTION_LABELS:
        row[f"inworld_emotion_{label}"] = emotion.get(label, 0.0)
    for label in PITCH_LABELS:
        row[f"inworld_pitch_{label}"] = pitch.get(label, 0.0)
    for label in VOCAL_STYLE_LABELS:
        row[f"inworld_vocal_{label}"] = vocal.get(label, 0.0)
    for label in AGE_LABELS:
        row[f"inworld_age_{label}"] = age.get(label, 0.0)

    row["inworld_temperature_proxy"] = inworld_temperature_proxy(row)
    return row


def transcribe(api_key: str, audio_path: Path, language: str, top_n: int) -> dict[str, Any]:
    payload = {
        "transcribeConfig": {
            "modelId": "inworld/inworld-stt-1",
            "language": language,
            "audioEncoding": "AUTO_DETECT",
            "voiceProfileConfig": {
                "enableVoiceProfile": True,
                "topN": top_n,
            },
        },
        "audioData": {"content": read_audio_as_base64(audio_path)},
    }
    headers = {
        "Authorization": f"Basic {api_key}",
        "Content-Type": "application/json",
    }
    response = requests.post(URL, headers=headers, json=payload, timeout=120)
    if response.status_code >= 400:
        raise RuntimeError(f"HTTP {response.status_code}: {response.text[:1000]}")
    return response.json()


def collect_audio_files(paths: list[str]) -> list[Path]:
    audio_files: list[Path] = []
    suffixes = {".wav", ".mp3", ".flac", ".ogg", ".m4a"}
    for raw_path in paths:
        path = Path(raw_path)
        if path.is_dir():
            audio_files.extend(
                sorted(p for p in path.iterdir() if p.is_file() and p.suffix.lower() in suffixes)
            )
        elif path.is_file():
            audio_files.append(path)
        else:
            raise FileNotFoundError(f"파일/폴더를 찾을 수 없습니다: {path}")
    return audio_files


def write_feature_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    fieldnames = list(rows[0].keys())
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Inworld STT Voice Profile 결과를 raw JSONL과 v4 학습용 CSV 피처로 저장합니다."
    )
    parser.add_argument("inputs", nargs="+", help="분석할 음성 파일 또는 폴더")
    parser.add_argument("--out-dir", default="inworld_results", help="결과 저장 폴더")
    parser.add_argument("--language", default="ko", help="STT 언어 코드")
    parser.add_argument("--top-n", type=int, default=10, help="Voice Profile 카테고리별 반환 라벨 수")
    parser.add_argument("--sleep", type=float, default=0.2, help="요청 사이 대기 시간")
    args = parser.parse_args()

    api_key = get_api_key()
    audio_files = collect_audio_files(args.inputs)
    if not audio_files:
        print("분석할 음성 파일이 없습니다.")
        return 1

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    raw_path = out_dir / "inworld_voice_profile_raw.jsonl"
    feature_path = out_dir / "inworld_voice_profile_features.csv"

    rows: list[dict[str, Any]] = []
    with raw_path.open("w", encoding="utf-8") as raw_file:
        for index, audio_path in enumerate(audio_files, start=1):
            print(f"[{index}/{len(audio_files)}] 분석 중: {audio_path}")
            try:
                response = transcribe(api_key, audio_path, args.language, args.top_n)
                raw_file.write(
                    json.dumps(
                        {
                            "audio_id": audio_path.stem,
                            "audio_path": str(audio_path),
                            "response": response,
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )
                rows.append(flatten_response(audio_path, response))
            except Exception as exc:
                raw_file.write(
                    json.dumps(
                        {
                            "audio_id": audio_path.stem,
                            "audio_path": str(audio_path),
                            "error": str(exc),
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )
                print(f"  실패: {exc}", file=sys.stderr)
            time.sleep(args.sleep)

    write_feature_csv(feature_path, rows)
    print(f"원본 JSONL 저장: {raw_path}")
    print(f"학습용 CSV 저장: {feature_path}")
    print(f"성공 파일 수: {len(rows)} / {len(audio_files)}")
    return 0 if rows else 1


if __name__ == "__main__":
    raise SystemExit(main())
