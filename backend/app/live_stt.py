"""Experimental on-premises streaming STT for the local K7 demo.

This router is deliberately separate from the active ``/api/v1/calls`` batch
contract.  A browser streams mono 16 kHz PCM16 audio as the ``customer`` and a
second socket receives final transcript chunks as the ``agent``.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import re
import secrets
import sqlite3
import struct
import threading
import time
from array import array
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Literal

import httpx
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field, model_validator

from app.live_dtmf_store import LiveDtmfEvent, save_dtmf_event
from app.routing.auth_policy import requires_identity_verification
from app.routing.emergency_gate import check_emergency
from app.routing.taxonomy import DEPARTMENTS, ROUTING_LEVELS


router = APIRouter()

_SAMPLE_RATE = 16_000
_MAX_UTTERANCE_SECONDS = float(os.getenv("K7_LIVE_STT_MAX_UTTERANCE_SECONDS", "3.2"))
_MAX_UTTERANCE_BYTES = int(_SAMPLE_RATE * _MAX_UTTERANCE_SECONDS) * 2
_MIN_UTTERANCE_SECONDS = float(os.getenv("K7_LIVE_STT_MIN_UTTERANCE_SECONDS", "0.6"))
_MIN_UTTERANCE_BYTES = int(_SAMPLE_RATE * _MIN_UTTERANCE_SECONDS) * 2
_SILENCE_FLUSH_SECONDS = float(os.getenv("K7_LIVE_STT_SILENCE_SECONDS", "0.45"))
_SILENCE_BYTES_TO_FLUSH = int(_SAMPLE_RATE * _SILENCE_FLUSH_SECONDS) * 2
_LEADING_SILENCE_SECONDS = float(os.getenv("K7_LIVE_STT_LEADING_SILENCE_SECONDS", "0.25"))
_LEADING_SILENCE_BYTES = int(_SAMPLE_RATE * _LEADING_SILENCE_SECONDS) * 2
_SILENCE_RMS = int(os.getenv("K7_LIVE_STT_SILENCE_RMS", "350"))
_CAPTURE_STOP_TIMEOUT_SECONDS = float(
    os.getenv("K7_LIVE_STT_CAPTURE_STOP_TIMEOUT_SECONDS", "15")
)
_STT_DRAIN_TIMEOUT_SECONDS = float(
    os.getenv("K7_LIVE_STT_DRAIN_TIMEOUT_SECONDS", "120")
)
_STT_BACKLOG_NOTICE_THRESHOLD = max(
    2, int(os.getenv("K7_LIVE_STT_BACKLOG_NOTICE_THRESHOLD", "4"))
)
_STT_MAX_PENDING_TASKS = max(
    _STT_BACKLOG_NOTICE_THRESHOLD,
    int(os.getenv("K7_LIVE_STT_MAX_PENDING_TASKS", "8")),
)
_ORPHAN_END_GRACE_SECONDS = float(
    os.getenv("K7_ARS_ORPHAN_END_GRACE_SECONDS", "15")
)
_AUDIO_CAPTURE_MODES = {"native", "edge", "auto"}
_EDGE_FRAME_HEADER = struct.Struct(">4sIQQ")
_EDGE_FRAME_MAGIC = b"K7A1"
_EDGE_SENDER_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_MAX_DEMO_EVENT_BYTES = max(
    1_024, int(os.getenv("K7_DEMO_EVENT_MAX_BYTES", str(64 * 1_024)))
)
_MAX_DEMO_REPLAY_UTTERANCES = min(
    1_024,
    max(16, int(os.getenv("K7_DEMO_REPLAY_UTTERANCES", "256"))),
)
_MAX_DEMO_REPLAY_TRANSFERS = 32
_DEMO_ROLES = {"customer", "employee", "admin"}
_DEMO_EVENT_TYPES = {
    "call.incoming",
    "stt.utterance",
    "pipeline.stage",
    "card.created",
    "routing.assigned",
    "transfer.requested",
    "transfer.completed",
    "call.ended",
    "queue.snapshot",
    "demo.reset",
}
_DEMO_EMPLOYEE_PUBLISH_TYPES = {
    "call.incoming",
    "stt.utterance",
    "pipeline.stage",
    "card.created",
    "routing.assigned",
    "call.ended",
}
_DEMO_CUSTOMER_RECEIVE_TYPES = {
    "call.incoming",
    "stt.utterance",
    "call.ended",
    "demo.reset",
}


def _audio_capture_mode() -> str:
    mode = os.getenv("K7_AUDIO_CAPTURE_MODE", "auto").strip().casefold()
    return mode if mode in _AUDIO_CAPTURE_MODES else "auto"


@dataclass
class _SpeakerBuffer:
    audio: bytearray = field(default_factory=bytearray)
    speech_seen: bool = False
    trailing_silence_bytes: int = 0
    last_audio_seq: int | None = None
    last_captured_at_ms: int | None = None
    completed_audio_seq: int | None = None
    completed_at_ms: int | None = None


@dataclass(frozen=True)
class _EdgeAudioFrame:
    pcm: bytes
    generation: int | None
    audio_seq: int | None
    captured_at_ms: int | None
    framed: bool


@dataclass(frozen=True)
class _EdgeSenderOwner:
    sender_id: str | None
    websocket: WebSocket


def _parse_edge_audio_frame(data: bytes) -> _EdgeAudioFrame:
    """Decode K7A1 metadata while retaining legacy raw PCM compatibility."""

    if data.startswith(_EDGE_FRAME_MAGIC):
        if len(data) < _EDGE_FRAME_HEADER.size + 2:
            raise ValueError("K7A1 frame must contain a 24-byte header and PCM")
        magic, generation, audio_seq, captured_at_ms = (
            _EDGE_FRAME_HEADER.unpack_from(data)
        )
        pcm = data[_EDGE_FRAME_HEADER.size :]
        if magic != _EDGE_FRAME_MAGIC or len(pcm) % 2:
            raise ValueError("K7A1 PCM16 payload byte length must be even")
        if generation < 1 or audio_seq < 1 or captured_at_ms < 1:
            raise ValueError("K7A1 generation, audio_seq and captured_at_ms start at 1")
        return _EdgeAudioFrame(
            pcm=pcm,
            generation=generation,
            audio_seq=audio_seq,
            captured_at_ms=captured_at_ms,
            framed=True,
        )
    if len(data) % 2:
        raise ValueError("PCM16 frame byte length must be even")
    return _EdgeAudioFrame(
        pcm=data,
        generation=None,
        audio_seq=None,
        captured_at_ms=None,
        framed=False,
    )


def _new_speaker_buffers() -> dict[str, _SpeakerBuffer]:
    return {"customer": _SpeakerBuffer(), "agent": _SpeakerBuffer()}


@dataclass
class _CallSession:
    agents: set[WebSocket] = field(default_factory=set)
    speaker_buffers: dict[str, _SpeakerBuffer] = field(
        default_factory=_new_speaker_buffers
    )
    seq: int = 0
    history: list[dict] = field(default_factory=list)
    capture_device: str | None = None
    edge_capture_devices: dict[str, str] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    ingest_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    processing_tasks: set[asyncio.Task] = field(default_factory=set)
    paused_speakers: set[str] = field(default_factory=set)
    source_audio_seq: dict[str, int] = field(
        default_factory=lambda: {"customer": 0, "agent": 0}
    )
    overload_announced: bool = False
    overload_rejection_announced: bool = False
    overload_rejected_utterances: int = 0

    # Compatibility aliases for the original single-customer-buffer helpers and
    # tests. New code uses ``speaker_buffers`` explicitly.
    @property
    def audio(self) -> bytearray:
        return self.speaker_buffers["customer"].audio

    @property
    def speech_seen(self) -> bool:
        return self.speaker_buffers["customer"].speech_seen

    @speech_seen.setter
    def speech_seen(self, value: bool) -> None:
        self.speaker_buffers["customer"].speech_seen = value

    @property
    def trailing_silence_bytes(self) -> int:
        return self.speaker_buffers["customer"].trailing_silence_bytes

    @trailing_silence_bytes.setter
    def trailing_silence_bytes(self, value: int) -> None:
        self.speaker_buffers["customer"].trailing_silence_bytes = value


@dataclass
class _ArsState:
    active: bool = False
    digits: str = ""
    intake_complete: bool = False
    agent_connected: bool = False
    final_seq: int = 0
    drained: bool = True
    generation: int = 0
    dtmf_seq: int = 0
    end_reason: str | None = None
    ended_by: str | None = None
    lifecycle_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


@dataclass(frozen=True)
class _StoredDemoEvent:
    order: int
    envelope: dict


@dataclass
class _DemoReplayState:
    """Bounded materialized demo state whose replay uses original envelopes."""

    next_order: int = 0
    incoming: _StoredDemoEvent | None = None
    utterances: deque[_StoredDemoEvent] = field(
        default_factory=lambda: deque(maxlen=_MAX_DEMO_REPLAY_UTTERANCES)
    )
    stages: dict[str, _StoredDemoEvent] = field(default_factory=dict)
    card: _StoredDemoEvent | None = None
    routing: _StoredDemoEvent | None = None
    transfers: deque[_StoredDemoEvent] = field(
        default_factory=lambda: deque(maxlen=_MAX_DEMO_REPLAY_TRANSFERS)
    )
    ended: _StoredDemoEvent | None = None
    queue_snapshot: _StoredDemoEvent | None = None
    seen_keys: set[str] = field(default_factory=set, repr=False)
    seen_order: deque[str] = field(
        default_factory=lambda: deque(maxlen=2_048), repr=False
    )

    def _clear_materialized(self) -> None:
        self.incoming = None
        self.utterances.clear()
        self.stages.clear()
        self.card = None
        self.routing = None
        self.transfers.clear()
        self.ended = None
        self.queue_snapshot = None

    def _remember(self, key: str) -> bool:
        if key in self.seen_keys:
            return False
        if len(self.seen_order) == self.seen_order.maxlen:
            oldest = self.seen_order.popleft()
            self.seen_keys.discard(oldest)
        self.seen_order.append(key)
        self.seen_keys.add(key)
        return True

    def record(self, envelope: dict) -> bool:
        key = json.dumps(
            envelope,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        if not self._remember(key):
            return False
        event_type = str(envelope["type"])
        if event_type == "demo.reset":
            self._clear_materialized()
            return True
        if event_type == "call.incoming" and self.incoming is not None:
            current_generation = int(
                self.incoming.envelope.get("payload", {}).get("generation") or 0
            )
            incoming_generation = int(
                envelope.get("payload", {}).get("generation") or 0
            )
            is_new_generation = (
                incoming_generation > current_generation
                if incoming_generation > 0 or current_generation > 0
                else self.ended is not None
            )
            if not is_new_generation:
                # A second tab or retry can publish a semantically identical
                # active-call start with a different tab seq/timestamp. Keep
                # the already materialized state instead of erasing it.
                return False
            self._clear_materialized()

        self.next_order += 1
        stored = _StoredDemoEvent(self.next_order, envelope)
        if event_type == "call.incoming":
            self.incoming = stored
        elif event_type == "stt.utterance":
            self.utterances.append(stored)
        elif event_type == "pipeline.stage":
            stage = str(envelope["payload"]["stage"])
            self.stages[stage] = stored
        elif event_type == "card.created":
            self.card = stored
        elif event_type == "routing.assigned":
            self.routing = stored
        elif event_type in {"transfer.requested", "transfer.completed"}:
            self.transfers.append(stored)
        elif event_type == "call.ended":
            self.ended = stored
        elif event_type == "queue.snapshot":
            self.queue_snapshot = stored
        return True

    def replay(self) -> list[dict]:
        stored: list[_StoredDemoEvent] = []
        if self.incoming is not None:
            stored.append(self.incoming)
        stored.extend(self.utterances)
        stored.extend(self.stages.values())
        for item in (self.card, self.routing, self.ended, self.queue_snapshot):
            if item is not None:
                stored.append(item)
        stored.extend(self.transfers)
        return [item.envelope for item in sorted(stored, key=lambda item: item.order)]


_sessions: dict[str, _CallSession] = defaultdict(_CallSession)
_model = None
_model_lock = threading.RLock()
_call_id_lock = threading.Lock()
_native_tasks: dict[str, asyncio.Task] = {}
_native_stop_events: dict[str, asyncio.Event] = {}
_ars_clients: dict[str, dict[WebSocket, str]] = defaultdict(dict)
_ars_states: dict[str, _ArsState] = defaultdict(_ArsState)
_orphan_end_tasks: dict[str, asyncio.Task] = {}
_audio_clients: dict[str, dict[str, set[WebSocket]]] = defaultdict(
    lambda: {"customer": set(), "agent": set()}
)
_audio_raw_generations: dict[WebSocket, int | None] = {}
_audio_last_source_seq: dict[WebSocket, tuple[int, int]] = {}
_audio_sender_owners: dict[tuple[str, str], _EdgeSenderOwner] = {}
_audio_sender_sequences: dict[tuple[str, str, str], tuple[int, int]] = {}
_audio_replaced_clients: set[WebSocket] = set()
_audio_owner_locks: dict[tuple[str, str], asyncio.Lock] = defaultdict(asyncio.Lock)
_registered_call_ids: set[str] = set()
_demo_clients: dict[str, dict[WebSocket, str]] = defaultdict(dict)
_demo_replay_states: dict[str, _DemoReplayState] = defaultdict(_DemoReplayState)
_demo_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)


class LiveCallCreateRequest(BaseModel):
    """Optionally register a shared, human-readable LAN demo call id."""

    call_id: str | None = Field(
        default=None,
        min_length=1,
        max_length=64,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$",
    )


class LiveAnalysisTurn(BaseModel):
    speaker: Literal["customer", "agent"]
    text: str = Field(min_length=1, max_length=4_000)
    seq: int | None = Field(default=None, ge=0)
    at: int | None = Field(default=None, ge=0)


class LiveAnalysisRequest(BaseModel):
    text: str | None = Field(default=None, max_length=12_000)
    turns: list[LiveAnalysisTurn] = Field(default_factory=list, max_length=1_000)
    scope: Literal["intake", "full"] = "intake"

    @model_validator(mode="after")
    def require_text_or_turns(self) -> "LiveAnalysisRequest":
        if not (self.text or "").strip() and not any(
            turn.text.strip() for turn in self.turns
        ):
            raise ValueError("text or turns is required")
        if sum(len(turn.text) for turn in self.turns) > 24_000:
            raise ValueError("turn text exceeds 24000 characters")
        return self


class OllamaSummaryAnalysis(BaseModel):
    """The small local model only summarizes; reviewed code owns all actions."""

    summary: str = Field(min_length=5, max_length=220)


class OllamaFullCallAnalysis(OllamaSummaryAnalysis):
    """Evidence-bound post-call sections authored from the two-speaker STT."""

    customer_request: str | None = Field(default=None, max_length=220)
    agent_guidance: str | None = Field(default=None, max_length=220)
    confirmed_items: str | None = Field(default=None, max_length=220)
    unresolved_items: str | None = Field(default=None, max_length=220)
    follow_up_actions: str | None = Field(default=None, max_length=220)


_LOCAL_ROUTING_RULES = (
    {
        "keywords": ("보이스피싱", "명의도용", "해킹", "지급정지", "사기", "무단", "도용"),
        "business_type": "금융사기·지급정지",
        "department_code": "SG",
        "business_code": None,
        "routing_level": "E",
        "high_risk": True,
    },
    {
        "keywords": ("착오송금", "잘못 보냈", "잘못 송금", "송금 반환", "이체 취소"),
        "business_type": "착오송금 반환",
        "department_code": "SG",
        "business_code": "misremit",
        "routing_level": "G",
        "high_risk": False,
    },
    {
        "keywords": ("금리인하", "금리 인하"),
        "business_type": "금리인하요구",
        "department_code": "LON",
        "business_code": "ratecut",
        "routing_level": "G",
        "high_risk": False,
    },
    {
        "keywords": ("금리", "이자"),
        "business_type": "대출 금리·이자",
        "department_code": "LON",
        "business_code": "interest",
        "routing_level": "G",
        "high_risk": False,
    },
    {
        "keywords": ("대출", "담보", "만기", "연장", "중도상환"),
        "business_type": "대출 만기·연장·상환",
        "department_code": "LON",
        "business_code": "loan",
        "routing_level": "G",
        "high_risk": False,
    },
    {
        "keywords": ("해외송금", "외화", "환전", "달러", "엔화", "유로"),
        "business_type": "외화·해외송금",
        "department_code": "FX",
        "business_code": "fx",
        "routing_level": "G",
        "high_risk": False,
    },
    {
        "keywords": ("계좌 개설", "계좌를 만들", "통장 개설", "비대면 계좌", "등록금"),
        "business_type": "계좌 개설·이용",
        "department_code": "DEP",
        "business_code": "general",
        "routing_level": "G",
        "high_risk": False,
    },
    {
        "keywords": ("이체 한도", "이체한도", "송금 한도"),
        "business_type": "이체한도",
        "department_code": "DEP",
        "business_code": "limit",
        "routing_level": "G",
        "high_risk": False,
    },
    {
        "keywords": ("거래내역", "입출금 내역", "잔액"),
        "business_type": "거래내역",
        "department_code": "DEP",
        "business_code": "txn",
        "routing_level": "S",
        "high_risk": False,
    },
    {
        "keywords": ("OTP", "인증서", "비밀번호", "로그인", "이체", "계좌"),
        "business_type": "전자금융",
        "department_code": "EFN",
        "business_code": None,
        "routing_level": "G",
        "high_risk": False,
    },
    {
        "keywords": ("불만", "민원", "보상", "항의", "피해"),
        "business_type": "고객 민원",
        "department_code": "ETC",
        "business_code": None,
        "routing_level": "G",
        "high_risk": False,
    },
    {
        "keywords": ("카드", "결제", "분실"),
        "business_type": "카드 문의",
        "department_code": "CRD",
        "business_code": None,
        "routing_level": "G",
        "high_risk": False,
    },
    {
        "keywords": ("예금", "적금", "통장"),
        "business_type": "예적금 안내",
        "department_code": "DEP",
        "business_code": "deposit",
        "routing_level": "G",
        "high_risk": False,
    },
    {
        "keywords": ("연금", "IRP", "퇴직연금"),
        "business_type": "연금·IRP",
        "department_code": "INV",
        "business_code": "pension",
        "routing_level": "G",
        "high_risk": False,
    },
)

_FALLBACK_SUMMARIES = {
    "금융사기·지급정지": "본인이 승인하지 않은 금융거래 또는 명의도용 가능성을 신고하고 즉시 확인과 지급정지를 요청함.",
    "착오송금 반환": "잘못 송금한 자금의 반환 가능 여부와 필요한 신청 절차를 문의함.",
    "대출 만기·연장·상환": "대출의 만기 연장 또는 상환 조건과 필요한 처리 절차를 문의함.",
    "대출 금리·이자": "대출 금리와 이자 적용 조건 및 관련 처리 절차를 문의함.",
    "금리인하요구": "대출 금리인하요구권의 신청 가능 여부와 처리 절차를 문의함.",
    "외화·해외송금": "외화 또는 해외송금의 처리 가능 여부와 적용 절차를 문의함.",
    "계좌 개설·이용": "기존 금융계좌 보유 상태에서 추가 계좌 개설이 가능한지와 계좌 이용 조건을 문의함.",
    "전자금융": "계좌이체·인증 등 전자금융 서비스의 이용 또는 문제 해결 절차를 문의함.",
    "이체한도": "이체한도의 조회 또는 변경 가능 여부와 처리 절차를 문의함.",
    "거래내역": "계좌의 잔액 또는 거래내역 확인을 요청함.",
    "고객 민원": "금융서비스 이용 중 발생한 불편 또는 피해에 대한 확인과 조치를 요청함.",
    "카드 문의": "카드 결제·분실 등 카드 이용 문제의 확인과 처리 절차를 문의함.",
    "예적금 안내": "예금·적금 상품의 이용 조건과 관련 절차를 문의함.",
    "연금·IRP": "연금 또는 IRP 상품의 이용 조건과 처리 절차를 문의함.",
    "일반 상담": "고객 문의의 세부 내용을 상담사가 확인해야 하는 일반 상담 건임.",
}

_FALLBACK_ACTIONS = {
    "금융사기·지급정지": ["본인 거래 여부 확인", "지급정지 필요성 확인", "사고대응 절차 안내"],
    "착오송금 반환": ["송금 거래내역 확인", "반환지원 대상 여부 확인", "신청 절차 안내"],
    "대출 만기·연장·상환": ["대출 계약 상태 확인", "연장·상환 조건 확인", "필요 서류 안내"],
    "계좌 개설·이용": ["기존 계좌 및 개설 제한 확인", "추가 개설 가능 여부 확인", "계좌 이용 조건 안내"],
}


def _extractive_summary(text: str, keywords: list[str]) -> str:
    """Select the most relevant real sentences without inventing facts."""

    sentences = [
        sentence.strip(" ,")
        for sentence in re.split(r"(?<=[.!?。])\s+|\n+", text)
        if sentence.strip(" ,")
    ]
    if not sentences:
        return text[:220]
    if len(sentences) <= 2:
        selected = sentences
    else:
        urgency_terms = ("긴급", "급해", "불안", "피해", "정지", "도용", "사기", "분실")
        ranked = sorted(
            enumerate(sentences),
            key=lambda item: (
                sum(3 for keyword in keywords if keyword.casefold() in item[1].casefold())
                + sum(2 for term in urgency_terms if term in item[1])
                + min(len(item[1]), 100) / 100,
                -item[0],
            ),
            reverse=True,
        )[:2]
        selected = [sentence for _, sentence in sorted(ranked)]
    summary = " ".join(selected)
    return summary if len(summary) <= 260 else f"{summary[:257]}..."


def analyze_live_text(text: str) -> dict:
    """Create an offline consultation-card projection from the real STT text."""

    normalized = " ".join(text.split())
    emergency = check_emergency(normalized)
    matched_rule = None
    matched_keywords: list[str] = []
    if emergency.is_emergency:
        matched_rule = {
            "business_type": "금융사기·지급정지",
            "department_code": "SG",
            "business_code": None,
            "routing_level": "E",
            "high_risk": True,
        }
        matched_keywords = [
            signal.split(":", 1)[-1] for signal in emergency.signals
        ]
    else:
        folded = normalized.casefold()
        for rule in _LOCAL_ROUTING_RULES:
            hits = []
            for keyword in rule["keywords"]:
                keyword_folded = keyword.casefold()
                start = folded.find(keyword_folded)
                while start >= 0:
                    suffix = folded[
                        start + len(keyword_folded) : start + len(keyword_folded) + 9
                    ]
                    if not any(
                        marker in suffix
                        for marker in ("아니", "아닌", "아니고", "아닙니다", "아니라")
                    ):
                        hits.append(keyword)
                        break
                    start = folded.find(keyword_folded, start + 1)
            if hits:
                matched_rule = rule
                matched_keywords = hits
                break

    if matched_rule is None:
        matched_rule = {
            "business_type": "일반 상담",
            "department_code": "ETC",
            "business_code": None,
            "routing_level": "G",
            "high_risk": False,
        }

    high_risk = bool(matched_rule["high_risk"])
    business_type = str(matched_rule["business_type"])
    department_code = str(matched_rule["department_code"])
    department = DEPARTMENTS[department_code]
    business_code = matched_rule["business_code"]
    routing_level = str(matched_rule["routing_level"])
    if emergency.is_emergency:
        routing_reason = (
            f"긴급 게이트(규칙) 판정: {emergency.reason} — "
            "recall floor로 즉시 사고·신고 배정"
        )
    elif matched_keywords:
        routing_reason = (
            f"실제 고객 STT에서 {', '.join(matched_keywords)} 관련 표현을 감지해 "
            f"{department} 부서로 분류"
        )
    else:
        routing_reason = "명확한 전문업무 키워드가 없어 제도·민원·기타로 분류"

    return {
        "summary": _FALLBACK_SUMMARIES.get(
            business_type, _FALLBACK_SUMMARIES["일반 상담"]
        ),
        "summary_status": "fallback",
        "category": business_type,
        "business_type": business_type,
        "business_code": business_code,
        "department": department,
        "requires_auth": requires_identity_verification(business_type),
        "emotion": {
            "status": "unavailable",
            "score": None,
            "level": None,
            "reason": "실제 음성 감정 모델이 연결되지 않았습니다.",
        },
        "urgency_score": 85 if high_risk else 30,
        "incident_risk": "high" if high_risk else "low",
        "risk_reason": (
            f"긴급 게이트(규칙) 판정: {emergency.reason}"
            if emergency.is_emergency
            else (
                f"사고 가능 표현 감지: {', '.join(matched_keywords)}"
                if high_risk
                else None
            )
        ),
        "routing": {
            "level": routing_level,
            "label": ROUTING_LEVELS[routing_level],
            "department": department,
            "department_code": department_code,
            "reason": routing_reason,
        },
        "routing_confidence": (
            0.99 if emergency.is_emergency else (0.94 if matched_keywords else 0.55)
        ),
        "keywords": matched_keywords or [business_type],
        "action_items": _FALLBACK_ACTIONS.get(
            business_type,
            ["고객 발화 원문 확인", "정확한 문의사항 확인", "담당 업무 절차 안내"],
        ),
        "source": "local-rule-v2",
    }


def _select_ollama_model(client: httpx.Client) -> str:
    configured = os.getenv("K7_OLLAMA_MODEL", "").strip()
    if configured:
        return configured

    response = client.get("/api/tags")
    response.raise_for_status()
    names = [
        str(item.get("name") or item.get("model") or "").strip()
        for item in response.json().get("models", [])
    ]
    names = [name for name in names if name]
    if not names:
        raise RuntimeError("Ollama is running but no local model is installed")
    preferred = ("exaone", "qwen", "gemma", "llama", "phi")
    return min(
        names,
        key=lambda name: next(
            (index for index, prefix in enumerate(preferred) if prefix in name.casefold()),
            len(preferred),
        ),
    )


_GROUNDING_STOPWORDS = {
    "고객",
    "문의",
    "상담",
    "확인",
    "요청",
    "처리",
    "관련",
    "필요",
    "가능",
    "안내",
    "합니다",
    "주세요",
    "싶습니다",
}

# Small, reviewed synonym groups let a Korean summary paraphrase the STT while
# still making unsupported high-salience facts detectable. This is not the
# classifier: it is only a grounding guard around the model-authored sentence.
_GROUNDING_CONCEPTS: dict[str, tuple[str, ...]] = {
    "card": ("카드", "신용카드"),
    "loss": ("분실", "잃어버", "도난"),
    "unauthorized": (
        "모르는",
        "미승인",
        "승인하지",
        "본인 아닌",
        "본인 모르게",
        "사용하지 않은",
        "하지 않은",
    ),
    "payment": ("결제", "거래", "승인", "사용내역"),
    "stop": ("정지", "차단", "중단"),
    "fraud": ("사기", "피싱", "명의도용", "해킹"),
    "loan": ("대출", "여신", "융자"),
    "maturity": ("만기", "기한"),
    "extension": ("연장", "갱신"),
    "interest": ("금리", "이자"),
    "document": ("서류", "증빙", "문서"),
    "transfer": ("이체", "송금"),
    "limit": ("한도", "제한액"),
    "account": ("계좌", "통장"),
    "deposit": ("예금", "적금", "예적금"),
    "foreign": ("외화", "환전", "해외송금"),
    "authentication": ("인증", "otp", "비밀번호", "로그인"),
    "complaint": ("불만", "민원", "항의", "보상"),
    # Unsupported procedural claims must be present in the STT to survive.
    "email": ("이메일", "전자우편"),
    "sms": ("문자", "메시지", "sms"),
    "reissue": ("재발급", "다시 발급"),
    "refund": ("환불", "반환", "취소"),
}


def _is_korean_model_text(value: str) -> bool:
    compact = " ".join(value.split())
    hangul_count = len(re.findall(r"[가-힣]", compact))
    latin_count = len(re.findall(r"[A-Za-z]", compact))
    return bool(compact) and hangul_count >= 2 and hangul_count >= latin_count


def _is_summary_grounded(source_text: str, summary: str) -> bool:
    source = " ".join(source_text.split()).casefold()
    output = " ".join(summary.split()).casefold()
    source_terms = {
        token
        for token in re.findall(r"[가-힣A-Za-z0-9]{2,}", source)
        if token not in _GROUNDING_STOPWORDS
    }
    output_terms = {
        token
        for token in re.findall(r"[가-힣A-Za-z0-9]{2,}", output)
        if token not in _GROUNDING_STOPWORDS
    }
    direct_matches = {
        output_term
        for output_term in output_terms
        if any(
            source_term in output_term or output_term in source_term
            for source_term in source_terms
        )
    }

    def concepts(value: str) -> set[str]:
        folded = value.casefold()
        return {
            concept
            for concept, aliases in _GROUNDING_CONCEPTS.items()
            if any(alias.casefold() in folded for alias in aliases)
        }

    source_concepts = concepts(source)
    output_concepts = concepts(output)
    # Known banking/procedure facts in the output must be supported by the STT.
    if output_concepts - source_concepts:
        return False
    concept_matches = output_concepts & source_concepts
    if not direct_matches and not concept_matches:
        return False
    # A single shared generic noun (for example only "카드") is too weak for a
    # multi-fact summary. Two independent lexical/concept anchors are enough,
    # while truly short utterances can still be summarized with one.
    concept_aliases = {
        alias.casefold()
        for concept in concept_matches
        for alias in _GROUNDING_CONCEPTS[concept]
    }
    direct_only = {
        term
        for term in direct_matches
        if not any(alias in term for alias in concept_aliases)
    }
    grounded_anchors = len(concept_matches) + len(direct_only)
    required_anchors = 1 if len(source_terms) <= 2 else 2
    return grounded_anchors >= required_anchors


def _validate_ollama_summary(text: str, analysis: OllamaSummaryAnalysis) -> str:
    summary = " ".join(analysis.summary.split())
    if not _is_korean_model_text(summary):
        raise ValueError("Ollama summary is not predominantly Korean")
    if not _is_summary_grounded(text, summary):
        raise ValueError("Ollama summary is not grounded in the customer STT")
    return summary


_CONFIRMED_CUES = (
    "처리했습니다",
    "처리됐습니다",
    "처리되었습니다",
    "완료했습니다",
    "완료됐습니다",
    "완료되었습니다",
    "접수했습니다",
    "접수됐습니다",
    "등록했습니다",
    "확인되었습니다",
    "해결됐습니다",
    "해결되었습니다",
)
_UNRESOLVED_CUES = (
    "확인이 필요",
    "확인해 봐야",
    "추후",
    "아직",
    "미완료",
    "심사가 필요",
    "담당 부서 확인",
    "확정할 수 없",
)
_FOLLOW_UP_CUES = (
    "해 주세요",
    "하시기 바랍니다",
    "필요합니다",
    "연락드리겠습니다",
    "제출",
    "방문",
    "준비해",
    "다시 전화",
)


def _extract_cued_summary(text: str, cues: tuple[str, ...]) -> str | None:
    sentences = [
        sentence.strip(" ,")
        for sentence in re.split(r"(?<=[.!?。])\s+|\n+", text)
        if sentence.strip(" ,")
    ]
    selected = [sentence for sentence in sentences if any(cue in sentence for cue in cues)]
    if not selected:
        return None
    value = " ".join(selected[:2])
    return value if len(value) <= 220 else f"{value[:217]}..."


def _validated_optional_section(source_text: str, value: str | None) -> str | None:
    if not value:
        return None
    normalized = " ".join(value.split())
    if not _is_korean_model_text(normalized):
        return None
    if not _is_summary_grounded(source_text, normalized):
        return None
    return normalized


def _post_call_summary(
    customer_text: str,
    agent_text: str,
    analysis: OllamaFullCallAnalysis | None = None,
) -> dict:
    """Build five evidence-bound sections without inventing call outcomes."""

    dialogue_text = "\n".join(
        part
        for part in (
            f"고객: {customer_text}" if customer_text else "",
            f"상담원: {agent_text}" if agent_text else "",
        )
        if part
    )
    customer_request = _validated_optional_section(
        customer_text, analysis.customer_request if analysis else None
    )
    if customer_request is None and customer_text:
        customer_request = _extractive_summary(customer_text, [])[:220]

    agent_guidance = _validated_optional_section(
        agent_text, analysis.agent_guidance if analysis else None
    )
    if agent_guidance is None and agent_text:
        agent_guidance = _extractive_summary(agent_text, [])[:220]

    confirmed_items = None
    if any(cue in dialogue_text for cue in _CONFIRMED_CUES):
        confirmed_items = _validated_optional_section(
            dialogue_text, analysis.confirmed_items if analysis else None
        ) or _extract_cued_summary(dialogue_text, _CONFIRMED_CUES)

    unresolved_items = None
    if any(cue in dialogue_text for cue in _UNRESOLVED_CUES):
        unresolved_items = _validated_optional_section(
            dialogue_text, analysis.unresolved_items if analysis else None
        ) or _extract_cued_summary(dialogue_text, _UNRESOLVED_CUES)

    follow_up_actions = None
    if any(cue in agent_text for cue in _FOLLOW_UP_CUES):
        follow_up_actions = _validated_optional_section(
            agent_text, analysis.follow_up_actions if analysis else None
        ) or _extract_cued_summary(agent_text, _FOLLOW_UP_CUES)

    return {
        "customer_request": customer_request,
        "agent_guidance": agent_guidance,
        "confirmed_items": confirmed_items,
        "unresolved_items": unresolved_items,
        "follow_up_actions": follow_up_actions,
    }


def _analyze_with_ollama(
    customer_text: str,
    dialogue_text: str | None = None,
    *,
    scope: Literal["intake", "full"] = "intake",
) -> dict:
    rule_projection = analyze_live_text(customer_text)
    grounded_dialogue = dialogue_text or f"고객: {customer_text}"
    base_url = os.getenv("K7_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
    timeout = httpx.Timeout(
        connect=float(os.getenv("K7_OLLAMA_CONNECT_TIMEOUT", "2")),
        read=float(os.getenv("K7_OLLAMA_READ_TIMEOUT", "120")),
        write=10,
        pool=2,
    )
    with httpx.Client(base_url=base_url, timeout=timeout) as client:
        model = _select_ollama_model(client)
        analysis_model = (
            OllamaFullCallAnalysis if scope == "full" else OllamaSummaryAnalysis
        )
        schema = analysis_model.model_json_schema()
        system_prompt = (
            "한국 은행 고객센터 요약기다. 입력에 근거한 짧은 한국어 요약 "
            "한 문장만 작성한다. 고객의 문의와 상담원의 안내·확인을 "
            "역할별로 구분한다. 처리 절차, 후속 조치, 연락 방식, 재발급 등 "
            "입력에 명시되지 않은 행동이나 사실은 절대 추가하지 않는다. "
            "분류·위험 판단·action item은 별도 규칙 엔진의 책임이다."
        )
        if scope == "full":
            system_prompt += (
                " 전체 통화 종료 요약에서는 customer_request, agent_guidance, "
                "confirmed_items, unresolved_items, follow_up_actions를 화자별 발화에 "
                "근거해 분리한다. 근거가 없는 항목은 null로 둔다. 처리 완료나 후속 "
                "조치는 발화에서 명시적으로 확인된 경우에만 작성한다."
            )
        response = client.post(
            "/api/chat",
            json={
                "model": model,
                "stream": False,
                "keep_alive": os.getenv("K7_OLLAMA_KEEP_ALIVE", "5m"),
                "think": False,
                "format": schema,
                "options": {
                    "temperature": 0,
                    "num_ctx": max(2048, int(os.getenv("K7_OLLAMA_NUM_CTX", "4096"))),
                    "num_predict": max(
                        64,
                        min(
                            512 if scope == "full" else 256,
                            int(
                                os.getenv(
                                    "K7_OLLAMA_NUM_PREDICT",
                                    "384" if scope == "full" else "192",
                                )
                            ),
                        ),
                    ),
                },
                "messages": [
                    {
                        "role": "system",
                        "content": system_prompt,
                    },
                    {
                        "role": "user",
                        "content": f"화자 구분 상담 STT:\n{grounded_dialogue}",
                    },
                ],
            },
        )
        response.raise_for_status()
        content = response.json().get("message", {}).get("content", "")
        analysis = analysis_model.model_validate_json(content)

    summary = _validate_ollama_summary(grounded_dialogue, analysis)
    result = {
        **rule_projection,
        "summary": summary,
        "summary_status": "ready",
        # Proposed actions are reviewed deterministic rules. A small LLM must
        # never turn an unsupported email/SMS/reissue guess into UI guidance.
        "action_items": rule_projection["action_items"],
        "source": f"ollama:{model}",
    }
    if scope == "full":
        agent_text = " ".join(
            line.removeprefix("상담원: ").strip()
            for line in grounded_dialogue.splitlines()
            if line.startswith("상담원: ")
        )
        result["post_call_summary"] = _post_call_summary(
            customer_text,
            agent_text,
            analysis if isinstance(analysis, OllamaFullCallAnalysis) else None,
        )
    return result


def _analysis_texts(body: LiveAnalysisRequest) -> tuple[str, str]:
    if body.turns:
        customer_text = " ".join(
            turn.text.strip()
            for turn in body.turns
            if turn.speaker == "customer" and turn.text.strip()
        ).strip()
        dialogue_text = "\n".join(
            f"{'고객' if turn.speaker == 'customer' else '상담원'}: {turn.text.strip()}"
            for turn in body.turns
            if turn.text.strip()
        )
        return customer_text, dialogue_text
    customer_text = (body.text or "").strip()
    return customer_text, f"고객: {customer_text}"


def _dialogue_fallback_analysis(
    customer_text: str,
    body: LiveAnalysisRequest,
) -> dict:
    """Keep routing customer-only while retaining counselor guidance offline."""

    fallback = analyze_live_text(customer_text)
    agent_text = " ".join(
        turn.text.strip()
        for turn in body.turns
        if turn.speaker == "agent" and turn.text.strip()
    )
    if agent_text:
        guidance = _extractive_summary(agent_text, [])
        if len(guidance) > 120:
            guidance = f"{guidance[:117]}..."
        fallback["agent_guidance"] = guidance
        fallback["summary"] = f"{fallback['summary']} 상담원 안내: {guidance}"
        if len(fallback["summary"]) > 260:
            fallback["summary"] = f"{fallback['summary'][:257]}..."
    if body.scope == "full":
        fallback["post_call_summary"] = _post_call_summary(
            customer_text, agent_text
        )
    return fallback


@router.post("/api/live-stt/analyze")
def analyze_live_stt(body: LiveAnalysisRequest) -> dict:
    """Prefer a real Ollama summary and use an explicitly labelled fallback."""

    customer_text, dialogue_text = _analysis_texts(body)
    try:
        return _analyze_with_ollama(
            customer_text, dialogue_text, scope=body.scope
        )
    except ValueError:
        fallback = _dialogue_fallback_analysis(customer_text, body)
        fallback["fallback_reason"] = "ollama_output_rejected"
        return fallback
    except (httpx.HTTPError, RuntimeError):
        fallback = _dialogue_fallback_analysis(customer_text, body)
        fallback["fallback_reason"] = "ollama_unavailable"
        return fallback


@router.get("/api/live-stt/analysis-status")
def live_analysis_status() -> dict:
    try:
        base_url = os.getenv("K7_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
        with httpx.Client(base_url=base_url, timeout=2) as client:
            model = _select_ollama_model(client)
        return {"available": True, "provider": "ollama", "model": model}
    except (httpx.HTTPError, RuntimeError, ValueError):
        return {"available": False, "provider": "local-rule-v2", "model": None}


@router.post("/api/live-stt/calls", status_code=201)
def create_live_call(body: LiveCallCreateRequest | None = None) -> dict:
    """Allocate or idempotently register a URL-safe LAN demo call id.

    Every live websocket must use an id registered here.  This prevents a typo
    in a phone or edge-sender URL from silently creating a disconnected phantom
    session.  A requested id (for example ``demo1``) lets independently opened
    demo screens agree on a stable value without weakening that invariant.
    """

    requested_call_id = body.call_id if body is not None else None
    with _call_id_lock:
        if requested_call_id is not None:
            call_id = requested_call_id
        else:
            while True:
                call_id = secrets.token_urlsafe(12)
                if call_id not in _registered_call_ids:
                    break
        if call_id not in _registered_call_ids:
            _ars_states[call_id] = _ArsState()
            _sessions[call_id] = _CallSession()
            _registered_call_ids.add(call_id)
    return {
        "call_id": call_id,
        "generation": 0,
        "audio_capture_mode": _audio_capture_mode(),
    }


def _demo_exact_fields(
    value: object,
    required: set[str],
    optional: set[str] | None = None,
) -> dict:
    if not isinstance(value, dict):
        raise ValueError("payload must be a JSON object")
    optional = optional or set()
    keys = set(value)
    missing = required - keys
    extra = keys - required - optional
    if missing:
        raise ValueError(f"payload is missing fields: {', '.join(sorted(missing))}")
    if extra:
        raise ValueError(f"payload has unknown fields: {', '.join(sorted(extra))}")
    return value


def _demo_string(
    value: object,
    field_name: str,
    *,
    max_length: int = 512,
    allow_empty: bool = False,
) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be a string")
    if not allow_empty and not value.strip():
        raise ValueError(f"{field_name} must not be empty")
    if len(value) > max_length:
        raise ValueError(f"{field_name} exceeds {max_length} characters")
    return value


def _demo_integer(
    value: object,
    field_name: str,
    *,
    minimum: int = 0,
) -> int:
    if type(value) is not int or value < minimum:
        raise ValueError(f"{field_name} must be an integer >= {minimum}")
    return value


def _demo_enum(value: object, field_name: str, allowed: set[str]) -> str:
    text = _demo_string(value, field_name, max_length=64)
    if text not in allowed:
        raise ValueError(f"{field_name} is not an allowed value")
    return text


def _demo_nullable_string(
    value: object,
    field_name: str,
    *,
    max_length: int = 1_000,
) -> None:
    if value is not None:
        _demo_string(value, field_name, max_length=max_length)


def _demo_confidence(value: object, field_name: str = "confidence") -> None:
    if value is None:
        return
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field_name} must be null or a number")
    if not math.isfinite(float(value)) or not 0 <= float(value) <= 1:
        raise ValueError(f"{field_name} must be between 0 and 1")


def _validate_demo_payload(event_type: str, payload: object, call_id: str) -> dict:
    if event_type == "call.incoming":
        item = _demo_exact_fields(payload, {"callId", "kind"}, {"generation"})
        _demo_enum(item["kind"], "kind", {"normal", "urgent", "transfer"})
    elif event_type == "stt.utterance":
        item = _demo_exact_fields(
            payload,
            {"callId", "text", "isFinal", "atMs"},
            {"speaker", "generation", "audioSeq"},
        )
        _demo_string(item["text"], "text", max_length=12_000)
        if type(item["isFinal"]) is not bool:
            raise ValueError("isFinal must be a boolean")
        _demo_integer(item["atMs"], "atMs")
        if "speaker" in item:
            _demo_enum(item["speaker"], "speaker", {"customer", "agent"})
        if "audioSeq" in item:
            _demo_integer(item["audioSeq"], "audioSeq", minimum=1)
    elif event_type == "pipeline.stage":
        item = _demo_exact_fields(
            payload, {"callId", "stage", "status"}, {"detail"}
        )
        _demo_enum(
            item["stage"],
            "stage",
            {"utterance", "stt", "classify", "risk", "persist", "route", "rag", "wrap"},
        )
        _demo_enum(item["status"], "status", {"start", "done", "skip"})
        if "detail" in item:
            _demo_string(item["detail"], "detail", max_length=1_000)
    elif event_type == "card.created":
        item = _demo_exact_fields(
            payload,
            {
                "callId",
                "summary",
                "businessType",
                "department",
                "routingReason",
                "incidentRisk",
                "riskReason",
                "confidence",
                "emotionLevel",
                "source",
            },
        )
        _demo_string(item["summary"], "summary", max_length=4_000)
        _demo_string(item["businessType"], "businessType", max_length=256)
        _demo_string(item["department"], "department", max_length=256)
        _demo_string(item["routingReason"], "routingReason", max_length=2_000)
        _demo_enum(item["incidentRisk"], "incidentRisk", {"low", "high"})
        _demo_nullable_string(item["riskReason"], "riskReason", max_length=2_000)
        _demo_confidence(item["confidence"])
        if item["emotionLevel"] is not None:
            _demo_enum(
                item["emotionLevel"],
                "emotionLevel",
                {"stable", "caution", "elevated"},
            )
        _demo_enum(item["source"], "source", {"demo", "backend"})
    elif event_type == "routing.assigned":
        item = _demo_exact_fields(
            payload,
            {"callId", "department", "sge", "confidence", "risk"},
        )
        _demo_string(item["department"], "department", max_length=256)
        _demo_enum(item["sge"], "sge", {"S", "G", "E"})
        _demo_confidence(item["confidence"])
        _demo_enum(item["risk"], "risk", {"low", "high"})
    elif event_type in {"transfer.requested", "transfer.completed"}:
        required = {"callId", "toDept"}
        if event_type == "transfer.requested":
            required.add("mode")
        item = _demo_exact_fields(payload, required)
        _demo_nullable_string(item["callId"], "callId", max_length=64)
        _demo_string(item["toDept"], "toDept", max_length=256)
        if event_type == "transfer.requested":
            _demo_enum(item["mode"], "mode", {"reserve", "immediate"})
    elif event_type == "call.ended":
        item = _demo_exact_fields(
            payload,
            {"callId"},
            {"wrapType", "wrapResult", "generation", "endReason", "endedBy"},
        )
        for field_name, max_length in (
            ("wrapType", 256),
            ("wrapResult", 4_000),
            ("endReason", 128),
            ("endedBy", 128),
        ):
            if field_name in item:
                _demo_string(item[field_name], field_name, max_length=max_length)
    elif event_type == "queue.snapshot":
        item = _demo_exact_fields(payload, {"queues"})
        queues = item["queues"]
        if not isinstance(queues, list) or len(queues) > 64:
            raise ValueError("queues must be an array with at most 64 entries")
        for index, queue in enumerate(queues):
            queue_item = _demo_exact_fields(queue, {"dept", "s", "g", "e"})
            _demo_string(queue_item["dept"], f"queues[{index}].dept", max_length=256)
            for count in ("s", "g", "e"):
                _demo_integer(queue_item[count], f"queues[{index}].{count}")
        return item
    elif event_type == "demo.reset":
        return _demo_exact_fields(payload, set())
    else:  # pragma: no cover - guarded by envelope validation
        raise ValueError("unknown demo event type")

    if "generation" in item:
        _demo_integer(item["generation"], "generation")
    if "callId" in item:
        payload_call_id = item["callId"]
        if payload_call_id is not None:
            _demo_string(payload_call_id, "callId", max_length=64)
            if payload_call_id != call_id:
                raise ValueError("payload callId must match the websocket call_id")
    return item


def _validate_demo_envelope(
    value: object,
    call_id: str,
    role: str,
    last_seq: int,
) -> dict:
    envelope = _demo_exact_fields(
        value, {"v", "type", "payload", "ts", "seq", "source"}
    )
    if type(envelope["v"]) is not int or envelope["v"] != 1:
        raise ValueError("v must be protocol version 1")
    event_type = _demo_enum(envelope["type"], "type", _DEMO_EVENT_TYPES)
    _demo_integer(envelope["ts"], "ts")
    seq = _demo_integer(envelope["seq"], "seq", minimum=1)
    if seq <= last_seq:
        raise ValueError("seq must increase on each websocket connection")
    expected_source = "admin" if role == "admin" else "counselor"
    if envelope["source"] != expected_source:
        raise ValueError(f"source must be {expected_source} for role {role}")
    if role == "customer":
        raise ValueError("role customer is receive-only")
    if role == "employee" and event_type not in _DEMO_EMPLOYEE_PUBLISH_TYPES:
        raise ValueError(f"role employee cannot publish {event_type}")
    _validate_demo_payload(event_type, envelope["payload"], call_id)
    return envelope


def _get_model():
    global _model
    if _model is not None:
        return _model

    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:  # pragma: no cover - depends on optional runtime
        raise RuntimeError(
            "Local STT is not installed. Install backend/requirements-live-stt.txt."
        ) from exc

    model_name = os.getenv("K7_LIVE_STT_MODEL", "base")
    device = os.getenv("K7_LIVE_STT_DEVICE", "cpu")
    compute_type = os.getenv("K7_LIVE_STT_COMPUTE_TYPE", "int8")
    with _model_lock:
        if _model is None:
            _model = WhisperModel(
                model_name,
                device=device,
                compute_type=compute_type,
            )
    return _model


def _transcribe_pcm(pcm_bytes: bytes) -> str:
    import numpy as np

    audio = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
    with _model_lock:
        segments, _ = _get_model().transcribe(
            audio,
            language="ko",
            beam_size=1,
            best_of=1,
            condition_on_previous_text=False,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 350},
        )
        return " ".join(segment.text.strip() for segment in segments).strip()


async def _broadcast(session: _CallSession, payload: dict) -> None:
    stale: list[WebSocket] = []
    for agent in tuple(session.agents):
        try:
            await agent.send_json(payload)
        except Exception:
            stale.append(agent)
    for agent in stale:
        session.agents.discard(agent)


async def _process_speaker_audio(
    call_id: str,
    session: _CallSession,
    pcm: bytes,
    speaker: str,
    generation: int | None = None,
    audio_seq: int | None = None,
    captured_at_ms: int | None = None,
) -> None:
    async with session.lock:
        state = _ars_states.get(call_id)
        if generation is not None and (
            state is None or state.generation != generation
        ):
            return
        try:
            text = await asyncio.to_thread(_transcribe_pcm, pcm)
        except Exception as exc:
            state = _ars_states.get(call_id)
            if generation is not None and (
                state is None or state.generation != generation
            ):
                return
            await _broadcast(
                session,
                {
                    "type": "error",
                    "message": f"Local STT failed: {exc}",
                    "speaker": speaker,
                    "call_id": call_id,
                    "generation": generation,
                },
            )
            return

        if not text:
            return
        state = _ars_states.get(call_id)
        if generation is not None and (
            state is None or state.generation != generation
        ):
            return
        session.seq += 1
        payload = {
            "type": "transcript",
            "call_id": call_id,
            "seq": session.seq,
            # ``seq`` orders emitted transcript turns globally. ``audio_seq``
            # instead identifies the source packet that completed this
            # utterance, so retransmits and cross-speaker timing stay auditable.
            "audio_seq": audio_seq,
            "text": text,
            "at": captured_at_ms or int(time.time_ns() // 1_000_000),
            "is_final": True,
            "speaker": speaker,
            "generation": generation if generation is not None else 0,
        }
        session.history.append(payload)
        del session.history[:-1000]
        await _broadcast(session, payload)


async def _process_audio(call_id: str, session: _CallSession, pcm: bytes) -> None:
    """Compatibility wrapper for the original customer-only processing hook."""

    await _process_speaker_audio(call_id, session, pcm, "customer")


def _schedule_audio_processing(
    call_id: str,
    session: _CallSession,
    pcm: bytes,
    speaker: str = "customer",
    audio_seq: int | None = None,
    captured_at_ms: int | None = None,
) -> asyncio.Task | None:
    """Track every STT job so lifecycle ACKs can wait for a stable final seq.

    ``_process_speaker_audio`` holds ``session.lock`` across transcription, so
    this pipeline has exactly one STT worker per call. Pending PCM is bounded;
    once the cap is reached the newest completed utterance is explicitly
    rejected and the next lifecycle drain reports ``False``. This avoids both
    uncontrolled memory/latency and a false claim that every utterance drained.
    """

    state = _ars_states.get(call_id)
    generation = (
        state.generation
        if state is not None and state.generation > 0
        else None
    )
    buffer = _speaker_buffer(session, speaker)
    if audio_seq is None and buffer.completed_audio_seq is not None:
        audio_seq = buffer.completed_audio_seq
        if captured_at_ms is None:
            captured_at_ms = buffer.completed_at_ms
        buffer.completed_audio_seq = None
        buffer.completed_at_ms = None
    if audio_seq is None:
        session.source_audio_seq[speaker] = (
            session.source_audio_seq.get(speaker, 0) + 1
        )
        audio_seq = session.source_audio_seq[speaker]
    if captured_at_ms is None:
        captured_at_ms = int(time.time_ns() // 1_000_000)
    if len(session.processing_tasks) >= _STT_MAX_PENDING_TASKS:
        session.overload_rejected_utterances += 1
        if not session.overload_rejection_announced:
            session.overload_rejection_announced = True
            asyncio.create_task(
                _broadcast(
                    session,
                    {
                        "type": "stt_overload",
                        "status": "rejected",
                        "call_id": call_id,
                        "pending_tasks": len(session.processing_tasks),
                        "max_pending_tasks": _STT_MAX_PENDING_TASKS,
                        "dropped_utterances": session.overload_rejected_utterances,
                        "policy": "reject_newest_utterance",
                        "message": (
                            "STT backlog 상한에 도달해 새 발화 1건을 처리하지 "
                            "못했습니다. 마지막 녹취를 확인해 주세요."
                        ),
                    },
                )
            )
            asyncio.create_task(
                _broadcast(
                    session,
                    {
                        "type": "error",
                        "call_id": call_id,
                        "message": (
                            "STT 처리 지연으로 새 발화 1건을 녹취하지 못했습니다. "
                            "마지막 녹취를 확인해 주세요. 종료 확인은 미완료로 처리됩니다."
                        ),
                    },
                )
            )
        return None
    coroutine = (
        _process_audio(call_id, session, pcm)
        if speaker == "customer" and generation is None
        else _process_speaker_audio(
            call_id,
            session,
            pcm,
            speaker,
            generation,
            audio_seq,
            captured_at_ms,
        )
    )
    task = asyncio.create_task(coroutine)
    session.processing_tasks.add(task)
    if (
        len(session.processing_tasks) >= _STT_BACKLOG_NOTICE_THRESHOLD
        and not session.overload_announced
    ):
        session.overload_announced = True
        asyncio.create_task(
            _broadcast(
                session,
                {
                    "type": "stt_overload",
                    "status": "backlogged",
                    "call_id": call_id,
                    "pending_tasks": len(session.processing_tasks),
                    "notice_threshold": _STT_BACKLOG_NOTICE_THRESHOLD,
                    "serial_workers": 1,
                    "message": "STT 처리보다 음성 입력이 빨라 지연이 누적되고 있습니다.",
                },
            )
        )

    def completed(done: asyncio.Task) -> None:
        session.processing_tasks.discard(done)
        if len(session.processing_tasks) < _STT_BACKLOG_NOTICE_THRESHOLD:
            session.overload_announced = False
        if len(session.processing_tasks) < _STT_MAX_PENDING_TASKS:
            session.overload_rejection_announced = False

    task.add_done_callback(completed)
    return task


async def _drain_audio_processing(call_id: str, session: _CallSession) -> bool:
    """Wait for explicitly stopped capture to finish all queued STT work.

    This timeout is a post-stop safety valve, not a silence/call-duration cutoff.
    At normal completion the returned ``final_seq`` is therefore stable before
    the ARS lifecycle acknowledgement is emitted.
    """

    deadline = asyncio.get_running_loop().time() + _STT_DRAIN_TIMEOUT_SECONDS
    while session.processing_tasks:
        pending = set(session.processing_tasks)
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            await _broadcast(
                session,
                {
                    "type": "error",
                    "message": (
                        "Final STT drain timed out after explicit stop; "
                        "review the last transcript chunk."
                    ),
                },
            )
            return False
        done, still_pending = await asyncio.wait(pending, timeout=remaining)
        if still_pending:
            for task in still_pending:
                task.cancel()
            await asyncio.gather(*still_pending, return_exceptions=True)
            await _broadcast(
                session,
                {
                    "type": "error",
                    "message": (
                        "Final STT drain timed out after explicit stop; "
                        "review the last transcript chunk."
                    ),
                },
            )
            return False
        # Callbacks normally discard completed tasks immediately. Yield once so
        # that callback bookkeeping is observed before checking for late jobs.
        if done:
            await asyncio.sleep(0)
    rejected = session.overload_rejected_utterances
    session.overload_rejected_utterances = 0
    session.overload_rejection_announced = False
    if rejected:
        await _broadcast(
            session,
            {
                "type": "stt_overload",
                "status": "drained_incomplete",
                "call_id": call_id,
                "pending_tasks": 0,
                "max_pending_tasks": _STT_MAX_PENDING_TASKS,
                "dropped_utterances": rejected,
                "policy": "reject_newest_utterance",
                "message": (
                    f"STT backlog 상한으로 발화 {rejected}건이 누락되어 "
                    "drain을 완료로 표시하지 않습니다."
                ),
            },
        )
        return False
    return True


def _pcm_rms(pcm: bytes) -> float:
    samples = array("h")
    samples.frombytes(pcm)
    if not samples:
        return 0.0
    return math.sqrt(sum(sample * sample for sample in samples) / len(samples))


def _speaker_buffer(session: _CallSession, speaker: str) -> _SpeakerBuffer:
    if speaker not in {"customer", "agent"}:
        raise ValueError(f"unsupported speaker: {speaker}")
    return session.speaker_buffers.setdefault(speaker, _SpeakerBuffer())


def _take_completed_utterance(
    session: _CallSession,
    pcm: bytes,
    speaker: str = "customer",
    audio_seq: int | None = None,
    captured_at_ms: int | None = None,
) -> bytes | None:
    buffer = _speaker_buffer(session, speaker)
    if audio_seq is None:
        session.source_audio_seq[speaker] = (
            session.source_audio_seq.get(speaker, 0) + 1
        )
        audio_seq = session.source_audio_seq[speaker]
    else:
        session.source_audio_seq[speaker] = max(
            session.source_audio_seq.get(speaker, 0), audio_seq
        )
    if captured_at_ms is None:
        captured_at_ms = int(time.time_ns() // 1_000_000)
    buffer.last_audio_seq = audio_seq
    buffer.last_captured_at_ms = captured_at_ms
    buffer.audio.extend(pcm)
    if _pcm_rms(pcm) >= _SILENCE_RMS:
        buffer.speech_seen = True
        buffer.trailing_silence_bytes = 0
    elif buffer.speech_seen:
        buffer.trailing_silence_bytes += len(pcm)
    elif len(buffer.audio) > _LEADING_SILENCE_BYTES:
        del buffer.audio[:-_LEADING_SILENCE_BYTES]

    reached_pause = (
        buffer.speech_seen
        and buffer.trailing_silence_bytes >= _SILENCE_BYTES_TO_FLUSH
        and len(buffer.audio) >= _MIN_UTTERANCE_BYTES
    )
    reached_limit = len(buffer.audio) >= _MAX_UTTERANCE_BYTES
    if not reached_pause and not reached_limit:
        return None

    utterance = bytes(buffer.audio)
    buffer.completed_audio_seq = buffer.last_audio_seq
    buffer.completed_at_ms = buffer.last_captured_at_ms
    buffer.audio.clear()
    buffer.speech_seen = False
    buffer.trailing_silence_bytes = 0
    buffer.last_audio_seq = None
    buffer.last_captured_at_ms = None
    return utterance


def _take_final_utterance(
    session: _CallSession,
    speaker: str = "customer",
) -> bytes | None:
    """Return the last real speech tail, padding only for Whisper stability.

    Explicit ARS stop events can arrive less than one input block after the
    customer finishes a short final word.  Dropping sub-half-second tails loses
    that word, while sending them as-is is too short for reliable Whisper
    decoding.  Preserve a tail only when the RMS gate observed speech and pad it
    to the configured minimum with PCM silence.
    """

    buffer = _speaker_buffer(session, speaker)
    tail = bytes(buffer.audio)
    speech_seen = buffer.speech_seen
    completed_audio_seq = buffer.last_audio_seq
    completed_at_ms = buffer.last_captured_at_ms
    buffer.audio.clear()
    buffer.speech_seen = False
    buffer.trailing_silence_bytes = 0
    buffer.last_audio_seq = None
    buffer.last_captured_at_ms = None
    if not tail or not speech_seen:
        buffer.completed_audio_seq = None
        buffer.completed_at_ms = None
        return None
    buffer.completed_audio_seq = completed_audio_seq
    buffer.completed_at_ms = completed_at_ms
    if len(tail) < _MIN_UTTERANCE_BYTES:
        tail += b"\0" * (_MIN_UTTERANCE_BYTES - len(tail))
    return tail


def _schedule_buffered_audio(
    call_id: str,
    session: _CallSession,
    pcm: bytes,
    speaker: str = "customer",
) -> asyncio.Task | None:
    """Schedule a VAD-completed buffer with its source packet metadata."""

    # Keep the historical 3-argument customer scheduling hook monkeypatchable;
    # the real scheduler reads completed metadata from the speaker buffer.
    if speaker == "customer":
        return _schedule_audio_processing(call_id, session, pcm)
    return _schedule_audio_processing(call_id, session, pcm, speaker)


async def _drain_stopped_capture_queue(
    call_id: str,
    session: _CallSession,
    audio_queue: asyncio.Queue[bytes],
    speaker: str = "customer",
) -> None:
    """Process every callback block queued before an explicit capture stop."""

    # RawInputStream callbacks use call_soon_threadsafe.  Yield once after the
    # stream is stopped so its final scheduled put is visible to get_nowait().
    await asyncio.sleep(0)
    while True:
        try:
            pcm = audio_queue.get_nowait()
        except asyncio.QueueEmpty:
            break
        utterance = _take_completed_utterance(session, pcm, speaker)
        if utterance is not None:
            _schedule_buffered_audio(call_id, session, utterance, speaker)

    tail = _take_final_utterance(session, speaker)
    if tail is not None:
        _schedule_buffered_audio(call_id, session, tail, speaker)


def _find_wo_mic_device() -> tuple[int, dict]:
    try:
        import sounddevice as sd
    except ImportError as exc:  # pragma: no cover - optional local runtime
        raise RuntimeError(
            "WO Mic capture is not installed. Install backend/requirements-live-stt.txt."
        ) from exc

    matches = [
        (index, dict(device))
        for index, device in enumerate(sd.query_devices())
        if device["max_input_channels"] > 0
        and "wo mic" in device["name"].lower()
    ]
    if not matches:
        raise RuntimeError(
            "WO Mic input device was not found. Connect the phone and WO Mic Client first."
        )
    return matches[0]


async def _run_native_wo_mic(call_id: str, stop_event: asyncio.Event) -> None:
    import sounddevice as sd

    session = _sessions[call_id]
    device_index, device = _find_wo_mic_device()
    loop = asyncio.get_running_loop()
    audio_queue: asyncio.Queue[bytes] = asyncio.Queue()

    def callback(indata, frames, time_info, status) -> None:  # noqa: ANN001
        pcm = bytes(indata)
        loop.call_soon_threadsafe(audio_queue.put_nowait, pcm)

    stream = sd.RawInputStream(
        samplerate=_SAMPLE_RATE,
        blocksize=4096,
        device=device_index,
        channels=1,
        dtype="int16",
        callback=callback,
    )
    stream.start()
    session.capture_device = device["name"]
    await _broadcast(
        session,
        {
            "type": "capture_status",
            "status": "recording",
            "device": device["name"],
            "speaker": "customer",
            "call_id": call_id,
            "generation": _ars_states[call_id].generation,
        },
    )

    try:
        while not stop_event.is_set():
            try:
                pcm = await asyncio.wait_for(audio_queue.get(), timeout=0.25)
            except TimeoutError:
                continue
            await _broadcast(
                session,
                {
                    "type": "level",
                    "level": min(1.0, _pcm_rms(pcm) / 8000.0),
                    "speaker": "customer",
                    "call_id": call_id,
                    "generation": _ars_states[call_id].generation,
                },
            )
            utterance = _take_completed_utterance(session, pcm)
            if utterance is not None:
                _schedule_buffered_audio(call_id, session, utterance)
    finally:
        stream.stop()
        await _drain_stopped_capture_queue(call_id, session, audio_queue)
        stream.close()
        session.capture_device = None
        await _broadcast(
            session,
            {
                "type": "capture_status",
                "status": "stopped",
                "speaker": "customer",
                "call_id": call_id,
                "generation": _ars_states[call_id].generation,
            },
        )


async def start_native_wo_mic(call_id: str) -> None:
    current = _native_tasks.get(call_id)
    if current is not None and not current.done():
        return
    stop_event = asyncio.Event()
    _native_stop_events[call_id] = stop_event
    task = asyncio.create_task(_run_native_wo_mic(call_id, stop_event))
    _native_tasks[call_id] = task

    def cleanup(done: asyncio.Task) -> None:
        # A stopped capture can be restarted with the same demo call id before
        # this callback gets its event-loop turn.  Never let the old callback
        # remove the replacement task/event belonging to the next capture.
        if _native_tasks.get(call_id) is done:
            _native_tasks.pop(call_id, None)
            _native_stop_events.pop(call_id, None)
        if done.cancelled():
            return
        error = done.exception()
        if error is not None:
            session = _sessions.get(call_id)
            if session is None:
                return
            asyncio.create_task(
                _broadcast(
                    session,
                    {"type": "error", "message": f"WO Mic capture failed: {error}"},
                )
            )

    task.add_done_callback(cleanup)


async def stop_native_wo_mic(call_id: str) -> bool:
    session = _sessions[call_id]
    stop_event = _native_stop_events.get(call_id)
    task = _native_tasks.get(call_id)
    if stop_event is None or task is None:
        return await _drain_audio_processing(call_id, session)
    stop_event.set()
    capture_closed = True
    try:
        await asyncio.wait_for(
            asyncio.shield(task), timeout=_CAPTURE_STOP_TIMEOUT_SECONDS
        )
    except TimeoutError:
        capture_closed = False
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await _broadcast(
            session,
            {
                "type": "error",
                "message": "WO Mic capture did not close cleanly after explicit stop.",
            },
        )
    drained = await _drain_audio_processing(call_id, session)
    return capture_closed and drained


def _has_edge_customer(call_id: str) -> bool:
    clients = _audio_clients.get(call_id)
    return bool(clients and clients["customer"])


def _should_start_native_capture(call_id: str) -> bool:
    mode = _audio_capture_mode()
    if mode == "edge":
        return False
    if mode == "native":
        return True
    return not _has_edge_customer(call_id)


async def _start_lifecycle_capture(call_id: str) -> None:
    if _should_start_native_capture(call_id):
        await start_native_wo_mic(call_id)


def _schedule_final_tail(
    call_id: str,
    session: _CallSession,
    speaker: str,
) -> None:
    tail = _take_final_utterance(session, speaker)
    if tail is not None:
        _schedule_buffered_audio(call_id, session, tail, speaker)


async def _drain_lifecycle_audio(
    call_id: str,
    speakers: set[str],
) -> bool:
    """Flush selected edge buffers and wait for one stable global final_seq."""

    session = _sessions[call_id]
    native_closed = True
    mode = _audio_capture_mode()
    should_stop_native = (
        "customer" in speakers
        and mode != "edge"
        and (
            _native_tasks.get(call_id) is not None
            or mode == "native"
            or (mode == "auto" and not _has_edge_customer(call_id))
        )
    )
    if should_stop_native:
        native_closed = await stop_native_wo_mic(call_id)

    async with session.ingest_lock:
        # A set is intentionally accepted by callers, but never let its hash
        # order decide dialogue order. Source capture time wins, followed by a
        # stable customer/agent tie-break for equal or legacy timestamps.
        ordered_speakers = sorted(
            speakers,
            key=lambda speaker: (
                _speaker_buffer(session, speaker).last_captured_at_ms is None,
                _speaker_buffer(session, speaker).last_captured_at_ms or 0,
                0 if speaker == "customer" else 1,
            ),
        )
        for speaker in ordered_speakers:
            _schedule_final_tail(call_id, session, speaker)
    drained = await _drain_audio_processing(call_id, session)
    return native_closed and drained


def _reset_call_session(session: _CallSession) -> None:
    session.history.clear()
    for buffer in session.speaker_buffers.values():
        buffer.audio.clear()
        buffer.speech_seen = False
        buffer.trailing_silence_bytes = 0
        buffer.last_audio_seq = None
        buffer.last_captured_at_ms = None
        buffer.completed_audio_seq = None
        buffer.completed_at_ms = None
    session.paused_speakers.clear()
    session.edge_capture_devices.clear()
    session.source_audio_seq = {"customer": 0, "agent": 0}
    session.overload_announced = False
    session.overload_rejection_announced = False
    session.overload_rejected_utterances = 0
    session.seq = 0


def _speaker_ingest_allowed(state: _ArsState, speaker: str) -> bool:
    if not state.active:
        return False
    if speaker == "customer":
        return not state.intake_complete or state.agent_connected
    return state.agent_connected


def _audio_gate_payload(
    call_id: str,
    state: _ArsState,
    speaker: str,
    reason: str,
) -> dict:
    session = _sessions[call_id]
    customer_allowed = (
        _speaker_ingest_allowed(state, "customer")
        and "customer" not in session.paused_speakers
    )
    agent_allowed = (
        _speaker_ingest_allowed(state, "agent")
        and "agent" not in session.paused_speakers
    )
    return {
        "type": "audio_gate",
        "call_id": call_id,
        "speaker": speaker,
        "generation": state.generation,
        "active": state.active,
        "allowed": customer_allowed if speaker == "customer" else agent_allowed,
        "customer_allowed": customer_allowed,
        "agent_allowed": agent_allowed,
        "reason": reason,
    }


def _release_audio_owner(call_id: str, speaker: str, websocket: WebSocket) -> bool:
    """Release per-socket metadata and return whether it owned the role."""

    clients_by_speaker = _audio_clients.get(call_id)
    if clients_by_speaker:
        clients_by_speaker[speaker].discard(websocket)
    _audio_raw_generations.pop(websocket, None)
    _audio_last_source_seq.pop(websocket, None)
    owner_key = (call_id, speaker)
    owner = _audio_sender_owners.get(owner_key)
    if owner is None or owner.websocket is not websocket:
        return False
    _audio_sender_owners.pop(owner_key, None)
    return True


async def _cleanup_edge_audio_connection(
    call_id: str,
    speaker: str,
    websocket: WebSocket,
    session: _CallSession,
    state: _ArsState,
    recording_announced: bool,
) -> None:
    """Atomically retire one source without stopping its replacement."""

    owner_key = (call_id, speaker)
    restart_native = False
    async with _audio_owner_locks[owner_key]:
        was_replaced = websocket in _audio_replaced_clients
        _audio_replaced_clients.discard(websocket)
        released_owner = _release_audio_owner(call_id, speaker, websocket)
        if not was_replaced and released_owner and recording_announced:
            session.edge_capture_devices.pop(speaker, None)
            # Keep source ownership serialized until observers have seen the
            # stop. A new source can then announce recording after this event,
            # never before an old socket's delayed cleanup.
            await _broadcast(
                session,
                {
                    "type": "capture_status",
                    "status": "stopped",
                    "speaker": speaker,
                    "device": f"edge:{speaker}",
                    "call_id": call_id,
                    "generation": state.generation,
                },
            )
        restart_native = (
            not was_replaced
            and released_owner
            and speaker == "customer"
            and not _audio_clients[call_id][speaker]
            and state.active
            and _audio_capture_mode() == "auto"
        )
    if restart_native:
        # This helper rechecks for an edge customer, closing the small race in
        # which a replacement connects immediately after the owner lock opens.
        await _start_lifecycle_capture(call_id)


async def _broadcast_audio_gate(
    call_id: str,
    state: _ArsState,
    reason: str,
) -> None:
    clients_by_speaker = _audio_clients.get(call_id)
    if not clients_by_speaker:
        return
    for speaker in ("customer", "agent"):
        for client in tuple(clients_by_speaker[speaker]):
            try:
                await client.send_json(
                    _audio_gate_payload(call_id, state, speaker, reason)
                )
            except Exception:
                # Retain ownership until the endpoint's serialized cleanup (or
                # a same-ID reconnect) runs. Releasing it here would let a new
                # source connect before the old capture_status is retired.
                clients_by_speaker[speaker].discard(client)
                _audio_raw_generations.pop(client, None)
                _audio_last_source_seq.pop(client, None)
                try:
                    await client.close(code=1012, reason="audio gate delivery failed")
                except Exception:
                    pass


async def _reject_audio_frame(
    websocket: WebSocket,
    call_id: str,
    speaker: str,
    state: _ArsState,
    code: str,
    reason: str,
) -> None:
    await websocket.send_json(
        {
            "type": "frame_rejected",
            "call_id": call_id,
            "speaker": speaker,
            "generation": state.generation,
            "code": code,
            "reason": reason,
        }
    )


async def _close_websocket_policy(websocket: WebSocket, reason: str) -> None:
    """Accept before a policy close so real Uvicorn clients observe code 1008."""

    await websocket.accept()
    await websocket.close(code=1008, reason=reason)


def _demo_unique_object(pairs: list[tuple[str, object]]) -> dict:
    value: dict = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"duplicate JSON field: {key}")
        value[key] = item
    return value


def _demo_can_receive(role: str, envelope: dict) -> bool:
    if role != "customer":
        return True
    event_type = str(envelope.get("type", ""))
    # Customer relay contains only its own call lifecycle and dialogue. Card,
    # risk, routing, queue, transfer and raw pipeline internals remain on the
    # employee/admin surfaces.
    return event_type in _DEMO_CUSTOMER_RECEIVE_TYPES


async def _broadcast_demo_unlocked(call_id: str, envelope: dict) -> None:
    clients = _demo_clients.get(call_id)
    if not clients:
        return
    stale: list[WebSocket] = []
    for client, role in tuple(clients.items()):
        if not _demo_can_receive(role, envelope):
            continue
        try:
            await client.send_json(envelope)
        except Exception:
            stale.append(client)
    for client in stale:
        clients.pop(client, None)
    if not clients:
        _demo_clients.pop(call_id, None)


async def _publish_demo(call_id: str, envelope: dict) -> None:
    async with _demo_locks[call_id]:
        replay_state = _demo_replay_states[call_id]
        if not replay_state.record(envelope):
            return
        await _broadcast_demo_unlocked(call_id, envelope)


@router.websocket("/ws/demo/{call_id}")
async def demo_event_socket(websocket: WebSocket, call_id: str, role: str) -> None:
    """Registered-call-scoped, in-memory LAN relay for ``DemoEnvelope`` v1."""

    if role not in _DEMO_ROLES:
        await _close_websocket_policy(
            websocket, "role must be customer, employee or admin"
        )
        return
    if call_id not in _registered_call_ids:
        await _close_websocket_policy(websocket, "call_id is not registered")
        return

    clients = _demo_clients[call_id]
    last_seq = 0
    try:
        await websocket.accept()
        # Registration and publish both hold this call lock. A new admin sees a
        # complete point-in-time replay before joining live broadcasts, with no
        # gap where an event could be missed or arrive ahead of its history.
        async with _demo_locks[call_id]:
            replay = [
                envelope
                for envelope in _demo_replay_states[call_id].replay()
                if _demo_can_receive(role, envelope)
            ]
            await websocket.send_json(
                {
                    "type": "ready",
                    "channel": "demo",
                    "call_id": call_id,
                    "role": role,
                    "protocol_version": 1,
                    "max_event_bytes": _MAX_DEMO_EVENT_BYTES,
                    "replay_count": len(replay),
                    "replay_utterance_limit": _MAX_DEMO_REPLAY_UTTERANCES,
                }
            )
            for envelope in replay:
                await websocket.send_json(envelope)
            clients[websocket] = role
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                raise WebSocketDisconnect(message.get("code", 1000))
            text_message = message.get("text")
            if text_message is None:
                await websocket.send_json(
                    {
                        "type": "demo_error",
                        "code": "text_required",
                        "message": "demo events must be JSON text frames",
                    }
                )
                continue
            if len(text_message.encode("utf-8")) > _MAX_DEMO_EVENT_BYTES:
                await websocket.close(
                    code=1009,
                    reason=f"demo event exceeds {_MAX_DEMO_EVENT_BYTES} bytes",
                )
                return
            try:
                decoded = json.loads(
                    text_message, object_pairs_hook=_demo_unique_object
                )
            except (json.JSONDecodeError, ValueError) as exc:
                await websocket.send_json(
                    {
                        "type": "demo_error",
                        "code": "invalid_json",
                        "message": str(exc)[:512],
                    }
                )
                continue
            try:
                envelope = _validate_demo_envelope(
                    decoded, call_id, role, last_seq
                )
            except ValueError as exc:
                await websocket.send_json(
                    {
                        "type": "demo_error",
                        "code": "invalid_envelope",
                        "message": str(exc)[:512],
                    }
                )
                continue
            last_seq = envelope["seq"]
            await _publish_demo(call_id, envelope)
    except WebSocketDisconnect:
        pass
    finally:
        async with _demo_locks[call_id]:
            clients.pop(websocket, None)
            if not clients:
                _demo_clients.pop(call_id, None)


@router.websocket("/ws/audio/{call_id}")
async def edge_audio_socket(
    websocket: WebSocket,
    call_id: str,
    speaker: str,
    sender_id: str | None = None,
) -> None:
    """Ingest persistent mono 16 kHz signed PCM16 from an edge laptop."""

    if speaker not in {"customer", "agent"}:
        await _close_websocket_policy(
            websocket, "speaker must be customer or agent"
        )
        return
    if call_id not in _registered_call_ids:
        await _close_websocket_policy(websocket, "call_id is not registered")
        return
    if sender_id is not None:
        sender_id = sender_id.strip()
        if not _EDGE_SENDER_ID.fullmatch(sender_id):
            await _close_websocket_policy(
                websocket, "sender_id must be 1-64 URL-safe characters"
            )
            return

    clients = _audio_clients[call_id][speaker]
    owner_key = (call_id, speaker)
    replaced_websocket: WebSocket | None = None
    async with _audio_owner_locks[owner_key]:
        owner = _audio_sender_owners.get(owner_key)
        unowned_clients = {
            client
            for client in clients
            if owner is None or client is not owner.websocket
        }
        same_sender_reconnect = (
            owner is not None
            and sender_id is not None
            and owner.sender_id == sender_id
        )
        if unowned_clients or (owner is not None and not same_sender_reconnect):
            # Missing/different identities can never replace an established
            # source. Only a reconnect from the exact same sender process may
            # take over its stale half-open socket.
            await _close_websocket_policy(
                websocket, "audio sender already connected by another sender_id"
            )
            return
        await websocket.accept()
        if same_sender_reconnect and owner is not None:
            replaced_websocket = owner.websocket
            _audio_replaced_clients.add(replaced_websocket)
            clients.discard(replaced_websocket)
            _audio_raw_generations.pop(replaced_websocket, None)
            _audio_last_source_seq.pop(replaced_websocket, None)
        _audio_sender_owners[owner_key] = _EdgeSenderOwner(sender_id, websocket)
        clients.add(websocket)

    session = _sessions[call_id]
    state = _ars_states[call_id]
    recording_announced = False
    sequence_key = (
        (call_id, speaker, sender_id) if sender_id is not None else None
    )
    try:
        _audio_raw_generations[websocket] = None
        last_sender_sequence = (
            _audio_sender_sequences.get(sequence_key)
            if sequence_key is not None
            else None
        )
        next_audio_seq = (
            last_sender_sequence[1] + 1
            if last_sender_sequence is not None
            and last_sender_sequence[0] == state.generation
            else 1
        )

        if replaced_websocket is not None:
            try:
                await replaced_websocket.close(
                    code=1012, reason="replaced by reconnect from the same sender_id"
                )
            except Exception:
                pass

        # In auto mode, a real customer edge stream supersedes local WO Mic input.
        if (
            speaker == "customer"
            and _audio_capture_mode() == "auto"
            and _native_tasks.get(call_id) is not None
        ):
            await stop_native_wo_mic(call_id)

        await websocket.send_json(
            {
                "type": "ready",
                "call_id": call_id,
                "speaker": speaker,
                "sender_id": sender_id,
                "generation": state.generation,
                "next_audio_seq": next_audio_seq,
                "sample_rate": _SAMPLE_RATE,
                "format": "pcm_s16le",
                "frame_format": {
                    "magic": "K7A1",
                    "header_bytes": _EDGE_FRAME_HEADER.size,
                    "endianness": "big",
                    "generation": "uint32",
                    "audio_seq": "uint64",
                    "captured_at_ms": "uint64",
                },
                "legacy_raw_supported": True,
                "legacy_raw_requires_bind_after_generation_change": True,
            }
        )
        await websocket.send_json(
            _audio_gate_payload(call_id, state, speaker, "connected")
        )
        recording_announced = speaker in session.edge_capture_devices
    except Exception:
        await _cleanup_edge_audio_connection(
            call_id,
            speaker,
            websocket,
            session,
            state,
            recording_announced,
        )
        raise
    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                raise WebSocketDisconnect(message.get("code", 1000))
            owner = _audio_sender_owners.get(owner_key)
            if owner is None or owner.websocket is not websocket:
                # A same-ID reconnect installs the replacement atomically. A
                # queued stale-socket frame must not race the new connection.
                raise WebSocketDisconnect(1012)
            text_message = message.get("text")
            if text_message is not None:
                try:
                    control = json.loads(text_message)
                except (TypeError, json.JSONDecodeError):
                    await _reject_audio_frame(
                        websocket,
                        call_id,
                        speaker,
                        state,
                        "invalid_control",
                        "audio control message must be JSON",
                    )
                    continue
                if control.get("type") != "bind":
                    await _reject_audio_frame(
                        websocket,
                        call_id,
                        speaker,
                        state,
                        "unsupported_control",
                        "only the legacy raw bind control is supported",
                    )
                    continue
                requested_generation = control.get("generation")
                if isinstance(requested_generation, bool):
                    requested_generation = -1
                try:
                    requested_generation = int(requested_generation)
                except (TypeError, ValueError):
                    requested_generation = -1
                if not state.active or requested_generation != state.generation:
                    await _reject_audio_frame(
                        websocket,
                        call_id,
                        speaker,
                        state,
                        "stale_generation",
                        "legacy raw bind must match the active generation",
                    )
                    continue
                _audio_raw_generations[websocket] = requested_generation
                await websocket.send_json(
                    {
                        "type": "bound",
                        "call_id": call_id,
                        "speaker": speaker,
                        "generation": requested_generation,
                    }
                )
                continue

            data = message.get("bytes")
            if not data:
                continue
            try:
                frame = _parse_edge_audio_frame(data)
            except ValueError as exc:
                await _reject_audio_frame(
                    websocket,
                    call_id,
                    speaker,
                    state,
                    "invalid_frame",
                    str(exc),
                )
                continue

            if frame.framed:
                if frame.generation != state.generation:
                    await _reject_audio_frame(
                        websocket,
                        call_id,
                        speaker,
                        state,
                        "stale_generation",
                        "K7A1 frame generation does not match the active call",
                    )
                    continue
                previous = (
                    _audio_sender_sequences.get(sequence_key)
                    if sequence_key is not None
                    else _audio_last_source_seq.get(websocket)
                )
                if (
                    previous is not None
                    and previous[0] == frame.generation
                    and frame.audio_seq is not None
                    and frame.audio_seq <= previous[1]
                ):
                    await _reject_audio_frame(
                        websocket,
                        call_id,
                        speaker,
                        state,
                        "duplicate_or_out_of_order",
                        "K7A1 audio_seq must increase within a generation",
                    )
                    continue
                accepted_sequence = (
                    frame.generation or 0,
                    frame.audio_seq or 0,
                )
                if sequence_key is not None:
                    _audio_sender_sequences[sequence_key] = accepted_sequence
                else:
                    _audio_last_source_seq[websocket] = accepted_sequence
                source_audio_seq = frame.audio_seq
                captured_at_ms = frame.captured_at_ms
            else:
                bound_generation = _audio_raw_generations.get(websocket)
                if bound_generation is None and state.active:
                    # First-generation and reconnect compatibility. The binding
                    # deliberately survives redial until an explicit bind, so
                    # queued raw frames from call N cannot enter call N+1.
                    bound_generation = state.generation
                    _audio_raw_generations[websocket] = bound_generation
                if bound_generation != state.generation:
                    await _reject_audio_frame(
                        websocket,
                        call_id,
                        speaker,
                        state,
                        "stale_generation",
                        "legacy raw sender must bind to the active generation",
                    )
                    continue
                source_audio_seq = session.source_audio_seq.get(speaker, 0) + 1
                captured_at_ms = int(time.time_ns() // 1_000_000)

            async with session.ingest_lock:
                owner = _audio_sender_owners.get(owner_key)
                if owner is None or owner.websocket is not websocket:
                    raise WebSocketDisconnect(1012)
                allowed = (
                    _speaker_ingest_allowed(state, speaker)
                    and speaker not in session.paused_speakers
                )
                utterance = (
                    _take_completed_utterance(
                        session,
                        frame.pcm,
                        speaker,
                        source_audio_seq,
                        captured_at_ms,
                    )
                    if allowed
                    else None
                )
                if utterance is not None:
                    _schedule_buffered_audio(call_id, session, utterance, speaker)

            if not allowed:
                if recording_announced:
                    recording_announced = False
                    session.edge_capture_devices.pop(speaker, None)
                    await _broadcast(
                        session,
                        {
                            "type": "capture_status",
                            "status": "stopped",
                            "speaker": speaker,
                            "device": f"edge:{speaker}",
                            "call_id": call_id,
                            "generation": state.generation,
                        },
                    )
                continue
            if not recording_announced:
                recording_announced = True
                session.edge_capture_devices[speaker] = f"edge:{speaker}"
                await _broadcast(
                    session,
                    {
                        "type": "capture_status",
                        "status": "recording",
                        "speaker": speaker,
                        "device": f"edge:{speaker}",
                        "call_id": call_id,
                        "generation": state.generation,
                    },
                )
            await _broadcast(
                session,
                {
                    "type": "level",
                    "level": min(1.0, _pcm_rms(frame.pcm) / 8000.0),
                    "speaker": speaker,
                    "call_id": call_id,
                    "generation": state.generation,
                },
            )
    except WebSocketDisconnect:
        pass
    finally:
        await _cleanup_edge_audio_connection(
            call_id,
            speaker,
            websocket,
            session,
            state,
            recording_announced,
        )


@router.websocket("/ws/call/{call_id}")
async def live_call_socket(websocket: WebSocket, call_id: str, role: str) -> None:
    if role not in {"customer", "agent"}:
        await _close_websocket_policy(websocket, "role must be customer or agent")
        return
    if call_id not in _registered_call_ids:
        await _close_websocket_policy(websocket, "call_id is not registered")
        return
    if role == "customer" and _audio_clients[call_id]["customer"]:
        await _close_websocket_policy(
            websocket, "audio sender already connected"
        )
        return

    await websocket.accept()
    session = _sessions[call_id]

    if role == "agent":
        session.agents.add(websocket)
        generation = _ars_states.get(call_id, _ArsState()).generation
        await websocket.send_json(
            {
                "type": "ready",
                "call_id": call_id,
                "role": "observer",
                "generation": generation,
            }
        )
        if session.capture_device:
            await websocket.send_json(
                {
                    "type": "capture_status",
                    "status": "recording",
                    "device": session.capture_device,
                    "speaker": "customer",
                    "call_id": call_id,
                    "generation": generation,
                }
            )
        for speaker, device in session.edge_capture_devices.items():
            await websocket.send_json(
                {
                    "type": "capture_status",
                    "status": "recording",
                    "device": device,
                    "speaker": speaker,
                    "call_id": call_id,
                    "generation": generation,
                }
            )
        for item in session.history:
            await websocket.send_json(item)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            session.agents.discard(websocket)
        return

    sender_clients = _audio_clients[call_id]["customer"]
    sender_clients.add(websocket)
    try:
        generation = _ars_states.get(call_id, _ArsState()).generation
        await websocket.send_json(
            {
                "type": "ready",
                "call_id": call_id,
                "speaker": "customer",
                "generation": generation,
            }
        )
        while True:
            pcm = await websocket.receive_bytes()
            async with session.ingest_lock:
                utterance = _take_completed_utterance(session, pcm)
            if utterance is not None:
                _schedule_buffered_audio(call_id, session, utterance)
    except WebSocketDisconnect:
        async with session.ingest_lock:
            tail = _take_final_utterance(session)
        if tail is not None:
            _schedule_buffered_audio(call_id, session, tail)
        await _drain_audio_processing(call_id, session)
    finally:
        sender_clients.discard(websocket)


async def _broadcast_ars(call_id: str, payload: dict) -> None:
    stale: list[WebSocket] = []
    clients = _ars_clients.get(call_id)
    if not clients:
        return
    for client in tuple(clients):
        try:
            await client.send_json(payload)
        except Exception:
            stale.append(client)
    for client in stale:
        clients.pop(client, None)


def _message_generation(message: dict) -> int | None:
    """Return an optional lifecycle generation, rejecting malformed values.

    Missing generations remain supported for the original demo clients.  New
    clients echo the generation received from ``call_start``/``ars_state`` so a
    delayed event from call N cannot mutate call N+1 when the fixed demo call id
    is reused.
    """

    if "generation" not in message:
        return None
    value = message.get("generation")
    if isinstance(value, bool):
        return -1
    try:
        generation = int(value)
    except (TypeError, ValueError):
        return -1
    return generation if generation >= 0 else -1


def _generation_matches(state: _ArsState, generation: int | None) -> bool:
    return generation is None or generation == state.generation


def _ars_completion_payload(
    event_type: str, call_id: str, state: _ArsState
) -> dict:
    """Keep old lifecycle events compatible while exposing a drain barrier."""

    payload = {
        "type": event_type,
        "call_id": call_id,
        "final_seq": state.final_seq,
        "drained": state.drained,
        "generation": state.generation,
    }
    if event_type == "call_end":
        payload["end_reason"] = state.end_reason
        payload["ended_by"] = state.ended_by
    return payload


def _ars_state_payload(state: _ArsState) -> dict:
    return {
        "type": "ars_state",
        "active": state.active,
        "digits": state.digits,
        "intake_complete": state.intake_complete,
        "agent_connected": state.agent_connected,
        "final_seq": state.final_seq,
        "drained": state.drained,
        "generation": state.generation,
        "dtmf_count": state.dtmf_seq,
        "end_reason": state.end_reason,
        "ended_by": state.ended_by,
    }


def _dtmf_phase(state: _ArsState) -> str:
    if state.agent_connected:
        return "active"
    if state.intake_complete:
        return "waiting_for_agent"
    return "intake"


def _lifecycle_error_payload(
    call_id: str,
    state: _ArsState,
    event_type: str,
    code: str,
    message: str,
    requested_generation: int | None,
) -> dict:
    return {
        "type": "lifecycle_error",
        "event": event_type,
        "code": code,
        "message": message,
        "call_id": call_id,
        "generation": state.generation,
        "requested_generation": requested_generation,
        "active": state.active,
        "intake_complete": state.intake_complete,
        "drained": state.drained,
        "agent_connected": state.agent_connected,
    }


async def _complete_ars_intake(
    call_id: str,
    state: _ArsState,
    expected_generation: int | None = None,
) -> bool:
    async with state.lifecycle_lock:
        if not state.active or not _generation_matches(state, expected_generation):
            return False
        if not state.intake_complete:
            state.intake_complete = True
            state.drained = False
            session = _sessions[call_id]
            session.paused_speakers.add("customer")
            await _broadcast_audio_gate(call_id, state, "intake_complete")
            try:
                state.drained = await _drain_lifecycle_audio(
                    call_id, {"customer"}
                )
            finally:
                session.paused_speakers.discard("customer")
            state.final_seq = _sessions[call_id].seq
        await _broadcast_ars(
            call_id, _ars_completion_payload("intake_complete", call_id, state)
        )
        return True


async def _complete_ars_call(
    call_id: str,
    state: _ArsState,
    expected_generation: int | None = None,
    *,
    end_reason: str = "customer_hangup",
    ended_by: str = "customer",
) -> bool:
    async with state.lifecycle_lock:
        if not _generation_matches(state, expected_generation):
            return False
        _cancel_orphan_end(call_id)
        if not state.active:
            # An ACK may have been lost while the sender reconnected.  Re-emit
            # the stable completion without stopping/draining a second time.
            await _broadcast_ars(
                call_id, _ars_completion_payload("call_end", call_id, state)
            )
            return True
        state.active = False
        state.intake_complete = False
        state.agent_connected = False
        state.end_reason = end_reason
        state.ended_by = ended_by
        state.drained = False
        await _broadcast_audio_gate(call_id, state, "call_end")
        state.drained = await _drain_lifecycle_audio(
            call_id, {"customer", "agent"}
        )
        state.final_seq = _sessions[call_id].seq
        await _broadcast_ars(
            call_id, _ars_completion_payload("call_end", call_id, state)
        )
        return True


def _cancel_orphan_end(call_id: str) -> None:
    task = _orphan_end_tasks.pop(call_id, None)
    try:
        current = asyncio.current_task()
    except RuntimeError:
        current = None
    if (
        task is not None
        and task is not current
        and not task.done()
    ):
        task.cancel()


def _schedule_orphan_end(call_id: str, state: _ArsState) -> None:
    """End only a control-channel orphan, never a quiet/long-running call."""

    _cancel_orphan_end(call_id)
    generation = state.generation

    async def expire() -> None:
        try:
            await asyncio.sleep(max(0.0, _ORPHAN_END_GRACE_SECONDS))
        except asyncio.CancelledError:
            return
        if any(role == "mobile" for role in _ars_clients.get(call_id, {}).values()):
            return
        await _complete_ars_call(
            call_id,
            state,
            generation,
            end_reason="customer_disconnect",
            ended_by="system",
        )

    task = asyncio.create_task(expire())
    _orphan_end_tasks[call_id] = task

    def cleanup(done: asyncio.Task) -> None:
        if _orphan_end_tasks.get(call_id) is done:
            _orphan_end_tasks.pop(call_id, None)

    task.add_done_callback(cleanup)


@router.websocket("/ws/ars/{call_id}")
async def ars_control_socket(websocket: WebSocket, call_id: str, role: str) -> None:
    if role not in {"mobile", "desktop"}:
        await _close_websocket_policy(websocket, "role must be mobile or desktop")
        return
    if call_id not in _registered_call_ids:
        await _close_websocket_policy(websocket, "call_id is not registered")
        return

    await websocket.accept()
    _ars_clients[call_id][websocket] = role
    state = _ars_states[call_id]
    if role == "mobile":
        _cancel_orphan_end(call_id)
    await websocket.send_json(
        {
            "type": "ready",
            "call_id": call_id,
            "role": role,
            "generation": state.generation,
        }
    )
    for peer_role in set(_ars_clients[call_id].values()):
        if peer_role != role:
            await websocket.send_json(
                {"type": "peer_status", "role": peer_role, "connected": True}
            )
    await websocket.send_json(_ars_state_payload(state))
    await _broadcast_ars(
        call_id,
        {"type": "peer_status", "role": role, "connected": True},
    )

    try:
        while True:
            message = await websocket.receive_json()
            event_type = message.get("type")
            if event_type == "state_request":
                await websocket.send_json(_ars_state_payload(state))
                continue
            generation = _message_generation(message)
            if role == "desktop":
                if event_type == "agent_connected":
                    async with state.lifecycle_lock:
                        error: dict | None = None
                        if generation is None:
                            error = _lifecycle_error_payload(
                                call_id,
                                state,
                                event_type,
                                "generation_required",
                                "agent_connected requires the current generation",
                                generation,
                            )
                        elif generation != state.generation:
                            error = _lifecycle_error_payload(
                                call_id,
                                state,
                                event_type,
                                "stale_generation",
                                "agent_connected generation does not match the active call",
                                generation,
                            )
                        elif not state.active:
                            error = _lifecycle_error_payload(
                                call_id,
                                state,
                                event_type,
                                "call_not_active",
                                "agent_connected requires an active call",
                                generation,
                            )
                        elif not state.intake_complete:
                            error = _lifecycle_error_payload(
                                call_id,
                                state,
                                event_type,
                                "intake_not_complete",
                                "agent_connected requires completed customer intake",
                                generation,
                            )
                        elif not state.drained:
                            error = _lifecycle_error_payload(
                                call_id,
                                state,
                                event_type,
                                "intake_drain_pending",
                                "agent_connected requires a completed intake STT drain",
                                generation,
                            )
                        if error is not None:
                            await websocket.send_json(error)
                        else:
                            state.agent_connected = True
                            await _broadcast_audio_gate(
                                call_id, state, "agent_connected"
                            )
                            await _start_lifecycle_capture(call_id)
                            await _broadcast_ars(
                                call_id,
                                {
                                    "type": "agent_connected",
                                    "call_id": call_id,
                                    "generation": state.generation,
                                },
                            )
                elif event_type == "call_end":
                    completed = await _complete_ars_call(
                        call_id,
                        state,
                        generation,
                        end_reason="counselor_hangup",
                        ended_by="counselor",
                    )
                    if not completed:
                        await websocket.send_json(_ars_state_payload(state))
                continue
            if event_type == "call_start":
                async with state.lifecycle_lock:
                    fresh_call = not state.active
                    if fresh_call:
                        # A versioned call_start while inactive is a delayed
                        # reconnect from the completed generation, not a redial.
                        # Explicit redial intentionally omits generation.
                        if generation is not None:
                            await websocket.send_json(_ars_state_payload(state))
                            continue
                        state.generation += 1
                        state.digits = ""
                        state.dtmf_seq = 0
                        state.intake_complete = False
                        state.agent_connected = False
                        state.final_seq = 0
                        state.drained = True
                        state.end_reason = None
                        state.ended_by = None
                        session = _sessions[call_id]
                        _reset_call_session(session)
                        state.active = True
                    elif not _generation_matches(state, generation):
                        await websocket.send_json(_ars_state_payload(state))
                        continue
                    _cancel_orphan_end(call_id)
                    await _broadcast_audio_gate(call_id, state, "call_start")
                    await _start_lifecycle_capture(call_id)
                    await _broadcast_ars(
                        call_id,
                        {
                            "type": "call_start",
                            "call_id": call_id,
                            "generation": state.generation,
                        },
                    )
            elif event_type == "dtmf":
                digit = str(message.get("digit", ""))
                if digit in "0123456789*#":
                    async with state.lifecycle_lock:
                        if not state.active or not _generation_matches(
                            state, generation
                        ):
                            await websocket.send_json(_ars_state_payload(state))
                            continue
                        event_seq = state.dtmf_seq + 1
                        captured_at_ms = int(time.time_ns() // 1_000_000)
                        phase = _dtmf_phase(state)
                        persisted = True
                        try:
                            await asyncio.to_thread(
                                save_dtmf_event,
                                LiveDtmfEvent(
                                    call_id=call_id,
                                    generation=state.generation,
                                    seq=event_seq,
                                    digit=digit,
                                    phase=phase,
                                    captured_at_ms=captured_at_ms,
                                ),
                            )
                        except (OSError, ValueError, sqlite3.Error):
                            # The keypad must keep working during a call, but
                            # observers must never be told that an unsaved
                            # digit was persisted.
                            persisted = False
                        state.dtmf_seq = event_seq
                        state.digits = (state.digits + digit)[-24:]
                        await _broadcast_ars(
                            call_id,
                            {
                                "type": "dtmf",
                                "digit": digit,
                                "call_id": call_id,
                                "generation": state.generation,
                                "dtmf_seq": event_seq,
                                "phase": phase,
                                "captured_at_ms": captured_at_ms,
                                "persisted": persisted,
                            },
                        )
            elif event_type == "intake_complete":
                completed = await _complete_ars_intake(call_id, state, generation)
                if not completed:
                    await websocket.send_json(_ars_state_payload(state))
            elif event_type == "call_end":
                completed = await _complete_ars_call(
                    call_id,
                    state,
                    generation,
                    end_reason="customer_hangup",
                    ended_by="customer",
                )
                if not completed:
                    await websocket.send_json(_ars_state_payload(state))
    except WebSocketDisconnect:
        pass
    finally:
        _ars_clients[call_id].pop(websocket, None)
        role_still_connected = any(
            peer_role == role for peer_role in _ars_clients[call_id].values()
        )
        if not role_still_connected:
            await _broadcast_ars(
                call_id,
                {"type": "peer_status", "role": role, "connected": False},
            )
        mobile_still_connected = any(
            peer_role == "mobile" for peer_role in _ars_clients[call_id].values()
        )
        if role == "mobile" and not mobile_still_connected and state.active:
            # Keep capture alive only for the bounded reconnect grace.  This is
            # unrelated to silence/call duration: a healthy control socket can
            # remain quiet indefinitely.  Expiry performs the single stop/drain
            # barrier so the final spoken tail is still delivered before end.
            _schedule_orphan_end(call_id, state)
