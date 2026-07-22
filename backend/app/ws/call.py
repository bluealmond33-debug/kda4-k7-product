"""실시간 통화 WebSocket — 고객 오디오를 받아 스트리밍 STT 후 상담사에게 전사 팬아웃.

/ws/call/{call_id}?role=customer : 브라우저가 16k mono Int16 PCM 바이너리 프레임을 보냄
/ws/call/{call_id}?role=agent    : 상담사 대시보드. 같은 call_id의 전사 JSON을 수신
"""
from __future__ import annotations

import time

from fastapi import APIRouter, WebSocket
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.services.stream_segmenter import UtteranceSegmenter
from app.services.streaming_stt import transcribe_utterance
from app.services.pii_guard import mask_transcript

router = APIRouter()


class CallSession:
    def __init__(self, call_id: str) -> None:
        self.call_id = call_id
        self.agents: set[WebSocket] = set()
        self.customer: WebSocket | None = None
        self.segmenter = UtteranceSegmenter()
        self.seq = 0


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


async def _emit_transcript(session: CallSession, utterance: bytes) -> None:
    text = await run_in_threadpool(transcribe_utterance, settings, utterance)
    if not text:
        return
    # 개인정보 보호(주제 11·12): 상담사·AI에 나가는 전사는 마스킹본만.
    # 원본 음성(utterance)은 이 함수 안에서만 쓰이고 저장·반환하지 않는다(휘발).
    masked, hits = mask_transcript(text)
    session.seq += 1
    await _broadcast(
        session,
        {
            "type": "transcript",
            "seq": session.seq,
            "speaker": "customer",
            "text": masked,
            "pii_masked": len(hits),  # 이 발화에서 마스킹된 개인정보 건수(화면 배지용)
            "isFinal": True,
            "at": int(time.time() * 1000),
        },
    )


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
    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
            chunk = message.get("bytes")
            if chunk is None:
                continue  # 텍스트/기타 프레임은 무시
            for utterance in session.segmenter.accept_audio(chunk):
                await _emit_transcript(session, utterance)
        # 정상 종료 시 진행 중이던 발화 마무리
        for utterance in session.segmenter.flush():
            await _emit_transcript(session, utterance)
    finally:
        session.customer = None
        registry.maybe_drop(call_id)
