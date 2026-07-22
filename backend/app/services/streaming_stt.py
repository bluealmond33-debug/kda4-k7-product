"""스트리밍 STT — 세그먼터가 잘라낸 발화 하나를 기존 whisper 싱글턴으로 전사한다.

whisper에는 파일 경로가 아니라 디코딩된 numpy 배열을 넘긴다(av 로드 우회, local_stt.py 참고).
모델은 local_stt._get_model 싱글턴을 재사용해 GPU 중복 로드를 막는다.
"""
from __future__ import annotations

import numpy as np

from app.config import Settings
from app.services.local_stt import _get_model


def utterance_to_float32(pcm_int16: bytes) -> np.ndarray:
    return np.frombuffer(pcm_int16, dtype=np.int16).astype(np.float32) / 32768.0


def transcribe_utterance(settings: Settings, pcm_int16: bytes) -> str:
    audio = utterance_to_float32(pcm_int16)
    model = _get_model(settings)
    segments, _info = model.transcribe(audio, language="ko")
    return "".join(seg.text for seg in segments).strip()
