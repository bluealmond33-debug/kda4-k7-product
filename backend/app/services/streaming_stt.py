"""스트리밍 STT — 세그먼터가 잘라낸 발화 하나를 기존 whisper 싱글턴으로 전사한다.

whisper에는 파일 경로가 아니라 디코딩된 numpy 배열을 넘긴다(av 로드 우회, local_stt.py 참고).
모델은 local_stt._get_model 싱글턴을 재사용해 GPU 중복 로드를 막는다.

**개인정보(주제 11·12) — STT 수신 즉시 마스킹.** 스트리밍 경로는 원문(raw) 대신
transcribe_utterance_masked()를 써서, 전사되는 그 순간 PII를 마스킹한 MaskedUtterance만
받는다. 원본 전사문은 이 모듈의 함수 안에서만 존재하고 밖으로 반환·저장·로깅되지 않는다.
호출부가 마스킹을 잊어도 원문 PII가 새지 않도록 구조적으로 보장하는 것이 목적이다.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from app.config import Settings
from app.services.pii_guard import PiiHit, mask_transcript


def utterance_to_float32(pcm_int16: bytes) -> np.ndarray:
    return np.frombuffer(pcm_int16, dtype=np.int16).astype(np.float32) / 32768.0


def transcribe_utterance(settings: Settings, pcm_int16: bytes) -> str:
    """발화를 전사해 **원문 그대로** 반환한다(내부용).

    ⚠️ 반환값에 PII가 들어 있을 수 있다. 상담사·AI·DB로 나가는 스트리밍 경로에서는 이 함수를
    직접 쓰지 말고 transcribe_utterance_masked()를 써라(마스킹본만 반환). 이 함수는 그
    마스킹 함수의 내부 단계로만 남긴다.

    faster-whisper(ctranslate2) 대신 transformers Whisper로 전사한다 — 이 랩탑은 Smart App
    Control이 ctranslate2._ext 네이티브 DLL을 차단해 faster-whisper가 로드조차 안 된다.
    """
    audio = utterance_to_float32(pcm_int16)
    # STT 엔진: transformers Whisper(torch/GPU). 이 랩탑은 Smart App Control이 faster-whisper의
    # ctranslate2/av 네이티브 DLL을 차단하므로 torch 기반으로 대체했다(app/services/transformers_stt.py).
    from app.services.transformers_stt import transcribe_float32
    return transcribe_float32(settings, audio).strip()


@dataclass(frozen=True)
class MaskedUtterance:
    """스트리밍 발화 하나의 마스킹 결과 — 밖으로 나가는 유일한 형태.

    text는 PII가 마스킹된 전사문이고, pii_hits는 이 발화에서 가려진 항목들이다.
    원본 전사문은 이 객체에 담기지 않는다(transcribe_utterance_masked 안에서만 존재).
    """

    text: str
    pii_hits: list[PiiHit] = field(default_factory=list)

    @property
    def pii_count(self) -> int:
        """이 발화에서 마스킹된 PII 개수 — 화면 배지·로그용."""
        return len(self.pii_hits)

    @property
    def is_empty(self) -> bool:
        return not self.text


def transcribe_utterance_masked(
    settings: Settings,
    pcm_int16: bytes,
    known_names: list[str] | None = None,
) -> MaskedUtterance:
    """발화를 전사하고 **그 자리에서 PII를 마스킹**해 마스킹본만 돌려준다(주제 11·12).

    원본 전사문(raw)은 이 함수의 지역 변수로만 존재하고 반환·저장·로깅되지 않는다.
    스트리밍 STT가 받아오는 즉시 마스킹이 걸리므로, 상담사 화면·AI 분석·DB 어디에도
    원문 PII가 도달하지 않는다.

    known_names: 본인인증을 마친 상담사 클라이언트가 아는 고객명을 넘기면 정확 대조로 함께
    가린다(선택). pii_guard는 PII 저장소를 직접 참조하지 않으므로 호출부가 넘겨야 한다.
    """
    raw = transcribe_utterance(settings, pcm_int16)  # 원문 — 이 지역 변수 밖으로 안 나간다
    if not raw:
        return MaskedUtterance(text="")
    masked, hits = mask_transcript(raw, known_names=known_names)
    return MaskedUtterance(text=masked, pii_hits=hits)
