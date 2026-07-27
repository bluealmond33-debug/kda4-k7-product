"""transformers Whisper 기반 STT — faster-whisper(ctranslate2) 대체.

이 랩탑(발표 서버)은 Windows Smart App Control이 `ctranslate2._ext` / `av` 네이티브 DLL을
차단해 faster-whisper STT가 아예 안 돈다(라이브 마이크 시연에서 발견). 대신 차단되지 않는
torch 위에서 transformers Whisper로 전사한다. 입력은 16kHz mono float32 ndarray(스트림/
ffmpeg에서 이미 디코딩됨)라 av 디코더를 쓰지 않는다 — GPU에서 발화당 ~1~2초.
"""
from __future__ import annotations

import os
import sys

# transformers가 av(영상 파이프라인용)를 로드하려다 차단 DLL에 걸리지 않도록, av를 '미설치'로
# 위장한다. ndarray 입력 STT에는 av가 필요 없다. (main.py에서도 설정하지만 직접 import 대비)
sys.modules.setdefault("av", None)

# 온프레미스(인터넷 차단) 시연 — from_pretrained가 HF Hub로 "새 버전 있나" 확인하러 나가지
# 않게 강제로 로컬 캐시만 쓰게 한다. 모델은 이미 캐시돼있어(~/.cache/huggingface/hub) 오프라인
# 로딩에 문제없다. 이거 없으면 인터넷 끊겼을 때 첫 로딩이 타임아웃 대기로 느려질 수 있다.
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import numpy as np

from app.config import Settings

_MODEL_ID_DEFAULT = "openai/whisper-large-v3-turbo"
_pipe = None

# Whisper 환각(hallucination) — 발화 끝 무음 구간을 자막학습 데이터에서 흔한 마무리 인사로
# 지어낸다(박정운 피드백: "끝 이후 '감사합니다'가 왜 뜨는지"). 실제 고객 발화가 이 문구 하나
# 뿐인 짧은 세그먼트로 통째로 나오는 경우는 거의 없으므로 정확히 일치하면 버린다.
_HALLUCINATION_BLOCKLIST = {
    "감사합니다", "감사합니다.", "시청해주셔서 감사합니다", "시청해 주셔서 감사합니다",
    "구독과 좋아요 부탁드립니다", "다음 영상에서 만나요", "구독 부탁드립니다",
    "이 영상은 여기까지입니다",
}


def _get_pipe(settings: Settings):
    """ASR 파이프라인 싱글턴. 첫 호출 때만 로드(캐시된 모델이면 수 초)."""
    global _pipe
    if _pipe is None:
        import torch
        from transformers import pipeline

        model_id = getattr(settings, "transformers_whisper_model", None) or _MODEL_ID_DEFAULT
        use_cuda = bool(torch.cuda.is_available())
        _pipe = pipeline(
            "automatic-speech-recognition",
            model=model_id,
            dtype=torch.float16 if use_cuda else torch.float32,
            device="cuda:0" if use_cuda else "cpu",
        )
    return _pipe


def transcribe_float32(settings: Settings, audio_f32: "np.ndarray") -> str:
    """16kHz mono float32 오디오 한 발화를 한국어로 전사한다(빈 입력이면 빈 문자열)."""
    if audio_f32 is None or len(audio_f32) == 0:
        return ""
    result = _get_pipe(settings)(
        {"raw": audio_f32, "sampling_rate": 16_000},
        generate_kwargs={"language": "korean", "task": "transcribe"},
    )
    text = (result.get("text") or "").strip()
    if text.replace(" ", "") in {p.replace(" ", "") for p in _HALLUCINATION_BLOCKLIST}:
        return ""
    return text
