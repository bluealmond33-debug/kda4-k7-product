"""실시간 통화 WebSocket — 고객 오디오를 받아 스트리밍 STT 후 상담사에게 전사 팬아웃.

/ws/call/{call_id}?role=customer : 브라우저가 16k mono Int16 PCM 바이너리 프레임을 보냄
/ws/call/{call_id}?role=agent    : 상담사 대시보드. 같은 call_id의 전사 JSON을 수신
"""
from __future__ import annotations

import io
import logging
import time
import wave
from datetime import datetime, timezone
from uuid import UUID, uuid4

import numpy as np
from fastapi import APIRouter, WebSocket
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.database import (
    append_live_transcript,
    create_live_call,
    finalize_live_call,
    mark_live_call_failed,
)
from app.services.stream_segmenter import UtteranceSegmenter
from app.services.streaming_stt import transcribe_utterance_masked
from app.services.voice_anger import analyze_voice_anger

router = APIRouter()
logger = logging.getLogger("karina.call")


def _stt_model_name() -> str:
    if settings.stub_models:
        return "stub"
    if settings.use_local_models:
        return f"faster-whisper:{settings.local_whisper_model}"
    return "whisper-1"


class CallSession:
    def __init__(self, call_id: str) -> None:
        self.call_id = call_id                       # WS 라우팅 키(프론트 값, 예: "demo1")
        self.db_call_id: UUID = uuid4()              # DB calls.call_id(uuid) — 세션마다 1건
        self.agents: set[WebSocket] = set()
        self.customer: WebSocket | None = None
        self.segmenter = UtteranceSegmenter(rms_threshold=settings.vad_rms_threshold)
        self.seq = 0
        self.frames_recv = 0        # 수신 오디오 청크 수(진단용)
        self.peak_rms = 0.0         # 통화 중 관측된 최대 RMS(마이크 레벨 진단용)
        # ── 실시간 DB 저장용 누적 상태 ──
        self.db_started = False     # calls 행 생성했는지
        self.masked_parts: list[str] = []   # 마스킹본 발화 누적(종료 시 분석 입력)
        self.max_anger = 0.0        # 통화 중 최대 음성분노 확률(judge 입력용)
        self.anger_hits = 0         # 분노 감지된 발화 수
        self.voice_model_calls = 0  # WavLM이 실제로 돈 발화 수(감지 여부와 무관, 모델 가동 확인용)


class CallRegistry:
    def __init__(self) -> None:
        self._sessions: dict[str, CallSession] = {}

    def get_or_create(self, call_id: str) -> CallSession:
        session = self._sessions.get(call_id)
        if session is None:
            session = CallSession(call_id)
            self._sessions[call_id] = session
        return session

    def maybe_drop(self, call_id: str) -> None:
        session = self._sessions.get(call_id)
        if session and not session.agents and session.customer is None:
            self._sessions.pop(call_id, None)


registry = CallRegistry()


async def _broadcast(session: CallSession, message: dict) -> None:
    dead = []
    for ws in list(session.agents):
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        session.agents.discard(ws)


def _pcm_to_wav(pcm: bytes, sample_rate: int = 16_000) -> bytes:
    """16k mono Int16 PCM(WS 프레임)을 WavLM이 받는 WAV 컨테이너로 감싼다(헤더만 추가)."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(pcm)
    return buffer.getvalue()


async def _emit_transcript(session: CallSession, utterance: bytes) -> None:
    # STT 수신 즉시 마스킹(주제 11·12): 원문 전사문은 streaming_stt 안에서만 존재하고
    # 여기로 나오지 않는다 — 상담사·AI·DB로 가는 것은 처음부터 마스킹본뿐이다.
    # 원본 음성(utterance)도 이 함수 안에서만 쓰이고 저장·반환하지 않는다(휘발).
    result = await run_in_threadpool(transcribe_utterance_masked, settings, utterance)
    if result.is_empty:
        return
    masked = result.text
    pii_count = result.pii_count
    # 음성 분노(WavLM) — 격양도가 놓치는 '냉정한 분노'를 잡는 주의도 보조 신호.
    # 모델/의존성 없으면 analyze_voice_anger가 None을 돌려줘 무해(하위호환).
    anger = await run_in_threadpool(analyze_voice_anger, _pcm_to_wav(utterance))
    logger.info(
        "[통화 %s] 고객 발화: %s | PII %d건 | 분노 %s",
        session.call_id, masked, pii_count,
        f"감지(p={anger.probability:.2f})" if (anger and anger.detected)
        else ("미감지" if anger else "폴백"),
    )
    session.seq += 1
    await _broadcast(
        session,
        {
            "type": "transcript",
            "seq": session.seq,
            "speaker": "customer",
            "text": masked,
            "pii_masked": pii_count,  # 이 발화에서 마스킹된 개인정보 건수(화면 배지용)
            "anger_detected": bool(anger.detected) if anger else False,
            "anger_probability": round(anger.probability, 3) if anger else None,
            "isFinal": True,
            "at": int(time.time() * 1000),
        },
    )

    # ── 상담 중 실시간 DB 저장(주제 11·12 준수: 마스킹본만) ──
    # 누적은 종료 시 카드 분석 입력으로, DB append는 통화 진행 중 전사 영속화로 쓴다.
    session.masked_parts.append(masked)
    if anger:
        session.voice_model_calls += 1
        session.max_anger = max(session.max_anger, anger.probability)
        if anger.detected:
            session.anger_hits += 1
    if settings.database_url and session.db_started:
        try:
            await run_in_threadpool(
                append_live_transcript, settings, session.db_call_id, masked, _stt_model_name()
            )
        except Exception:
            logger.warning("[통화 %s] 전사 DB 누적 실패(무시)", session.call_id, exc_info=True)


def _build_live_card(session: CallSession, full_masked: str):
    """종료 시 누적 마스킹 전사로 상담카드를 만든다(배치 mvp.py와 동일 분석 경로).

    - 분석: stub/local(Ollama exaone3.5). openai 전용 모드는 실시간 데모 경로가 아니라 생략.
    - judge 감정 입력: 통화 중 집계한 음성분노(max_anger)를 EmotionResult로 전달.
    - 카드 감정: 스트리밍은 통화 단위 감정온도 모델을 돌리지 않으므로 unavailable(정직).
      음성분노 신호는 raw_model_result에 남긴다.
    반환: (ConsultationCard, raw_model_result). 스레드풀에서 호출한다(블로킹 분석).
    """
    from app.schemas import AnalysisSource, EmotionResult
    from app.services.judge import judge as run_judge
    from app.services.mvp_adapter import to_consultation_card

    if settings.stub_models:
        from app.services.stub_models import analyze_transcript_stub
        gpt = analyze_transcript_stub(full_masked)
    else:
        from app.services.local_llm import analyze_transcript_local
        gpt = analyze_transcript_local(settings, full_masked)

    anger_p = min(1.0, max(0.0, session.max_anger))
    emotion_for_judge = EmotionResult(
        anger_probability=anger_p,
        anxiety_probability=0.0,
        neutral_probability=max(0.0, 1.0 - anger_p),
        uncertainty=0.0,
        analysis_source=AnalysisSource.REAL_MODEL if session.anger_hits else AnalysisSource.STUB,
    )
    judgement = run_judge(gpt.risk_flags, emotion_for_judge)
    card = to_consultation_card(gpt, judgement, emotion=None)  # 스트리밍 카드 감정 = unavailable

    raw = gpt.model_dump()
    raw["_stream"] = {
        "source": "live_call",
        "utterances": len(session.masked_parts),
        "max_anger": round(session.max_anger, 3),
        "anger_hits": session.anger_hits,
    }
    return card, raw


async def _finalize_call(session: CallSession) -> None:
    """통화 종료 처리 — 누적 전사로 카드 확정·저장하고 calls를 ready로.

    발화가 없었으면 failed로 표시. 전 과정 best-effort: 실패해도 로그만 남기고
    라이브 통화 종료 흐름을 막지 않는다.
    """
    if not settings.database_url or not session.db_started:
        return
    full = " ".join(p for p in session.masked_parts if p).strip()
    if not full:
        try:
            await run_in_threadpool(mark_live_call_failed, settings, session.db_call_id)
        except Exception:
            logger.warning("[통화 %s] 빈 통화 failed 표기 실패(무시)", session.call_id, exc_info=True)
        return
    try:
        card, raw = await run_in_threadpool(_build_live_card, session, full)
        await run_in_threadpool(finalize_live_call, settings, session.db_call_id, card, raw)
        logger.info(
            "[통화 %s] 상담카드 저장 완료 — db_call_id=%s · 발화 %d건 · 부서=%s · 위험=%s",
            session.call_id, session.db_call_id, len(session.masked_parts),
            card.department, card.incident_risk.value,
        )
    except Exception:
        logger.warning("[통화 %s] 상담카드 확정 실패(무시) — failed 표기 시도", session.call_id, exc_info=True)
        try:
            await run_in_threadpool(mark_live_call_failed, settings, session.db_call_id)
        except Exception:
            pass


@router.websocket("/ws/call/{call_id}")
async def call_ws(websocket: WebSocket, call_id: str, role: str = "customer") -> None:
    await websocket.accept()
    session = registry.get_or_create(call_id)

    if role == "agent":
        session.agents.add(websocket)
        try:
            while True:
                message = await websocket.receive()
                if message["type"] == "websocket.disconnect":
                    break
                # 상담사→서버 메시지는 현재 무시(keepalive 용)
        finally:
            session.agents.discard(websocket)
            registry.maybe_drop(call_id)
        return

    # customer — v1은 바이너리 PCM 프레임만 받는다(제어용 텍스트 프레임은 무시)
    session.customer = websocket
    # 통화 시작 — calls 행을 processing으로 생성(best-effort, 라이브 통화를 막지 않음).
    if settings.database_url and not session.db_started:
        session.db_started = True
        try:
            await run_in_threadpool(
                create_live_call, settings, session.db_call_id, datetime.now(timezone.utc)
            )
            logger.info("[통화 %s] DB 통화 시작 — db_call_id=%s", session.call_id, session.db_call_id)
        except Exception:
            session.db_started = False
            logger.warning("[통화 %s] DB 통화 생성 실패(무시)", session.call_id, exc_info=True)
    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
            chunk = message.get("bytes")
            if chunk is None:
                continue  # 텍스트/기타 프레임은 무시
            # 진단: 수신 오디오 레벨(RMS)을 주기적으로 로깅 — 마이크가 실제로 잡히는지/얼마나 큰지.
            arr = np.frombuffer(chunk, dtype=np.int16)
            if arr.size:
                rms = float(np.sqrt(np.mean(arr.astype(np.float32) ** 2)))
                session.frames_recv += 1
                session.peak_rms = max(session.peak_rms, rms)
                if session.frames_recv % 50 == 1:
                    logger.info(
                        "[통화 %s] 오디오 수신 %d청크 · RMS=%.0f · 피크=%.0f (VAD기준 %.0f — 넘어야 전사)",
                        session.call_id, session.frames_recv, rms, session.peak_rms,
                        session.segmenter.rms_threshold,
                    )
            for utterance in session.segmenter.accept_audio(chunk):
                await _emit_transcript(session, utterance)
        # 정상 종료 시 진행 중이던 발화 마무리
        for utterance in session.segmenter.flush():
            await _emit_transcript(session, utterance)
    finally:
        session.customer = None
        # 통화 종료 — 누적 전사로 상담카드 확정·저장(best-effort).
        await _finalize_call(session)
        registry.maybe_drop(call_id)
