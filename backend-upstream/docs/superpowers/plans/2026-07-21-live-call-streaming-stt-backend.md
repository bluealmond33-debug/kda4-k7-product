# 실시간 통화 스트리밍 STT (백엔드) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고객이 웹에서 보낸 마이크 오디오를 WebSocket으로 받아 문장 단위로 실시간 전사하고, 같은 통화의 상담사 대시보드로 전사를 팬아웃하는 백엔드 파이프라인을 만든다.

**Architecture:** 세 개의 작은 유닛으로 나눈다 — (1) 순수 파이썬 RMS 에너지 VAD 세그먼터(오디오 스트림→발화 경계, 모델·I/O 없음), (2) 발화 하나를 기존 whisper 싱글턴으로 전사하는 얇은 래퍼, (3) 이 둘을 묶어 고객↔상담사를 잇는 WebSocket 엔드포인트+인메모리 세션 레지스트리. 세그먼터는 모델 없이 단위테스트하고, WS는 가짜 전사기를 주입해 GPU 없이 테스트하며, 실제 모델 경로만 통합테스트로 게이트한다.

**Tech Stack:** Python 3.12, FastAPI 0.115 / Starlette WebSocket, numpy 2.1, faster-whisper 1.0.3(기존 싱글턴 재사용), pytest 8.3.

## Global Constraints

- **새 pip 의존성 추가 금지** — 세그먼터는 numpy만 쓴다(이미 `requirements.txt`에 있음). 네이티브 VAD(webrtcvad/silero, `.pyd`)는 이 랩탑 Windows Smart App Control 차단 위험이라 **비채택**.
- whisper에는 **파일 경로가 아니라 이미 디코딩된 numpy 배열**을 넘긴다 — av(PyAV) 로드를 타지 않게(Smart App Control 우회). 오디오는 항상 **16kHz mono Int16 PCM** 기준.
- 모델은 **기존 싱글턴 `app.services.local_stt._get_model(settings)`** 을 재사용한다. 새 `WhisperModel`을 또 만들지 않는다(GPU 메모리 중복 로드 금지).
- 전사 언어는 항상 `language="ko"`.
- 무거운 리소스(GPU/모델)가 필요한 테스트는 **`@pytest.mark.integration` + 환경변수 `K7_TEST_LOCAL_MODELS=1`** 로 게이트한다(기존 `tests/test_local_models_integration.py` 패턴). 기본 `pytest` 실행에서 도는 테스트는 모델 없이 통과해야 한다.
- 작업 디렉터리: `C:\Users\natur\Documents\금융콜센터AI\backend`. 모든 경로는 이 디렉터리 기준.
- WebSocket 메시지(server→agent) 스키마: `{"type":"transcript","seq":int,"speaker":"customer","text":str,"isFinal":bool,"at":int(ms)}`.

---

### Task 1: RMS 에너지 VAD 세그먼터

오디오 스트림(Int16 PCM 바이트)을 받아 완성된 발화(문장) 단위 바이트로 잘라내는 순수 파이썬 유닛. 모델·네트워크·파일 I/O 없음 → 합성 오디오로 완전 단위테스트.

**Files:**
- Create: `app/services/stream_segmenter.py`
- Test: `tests/test_stream_segmenter.py`

**Interfaces:**
- Consumes: 없음(numpy만).
- Produces:
  - `class UtteranceSegmenter(sample_rate=16000, frame_ms=20, rms_threshold=500.0, start_frames=3, end_silence_ms=700, min_utterance_ms=300, max_utterance_ms=15000)`
  - `UtteranceSegmenter.accept_audio(pcm: bytes) -> list[bytes]` — 임의 길이 Int16 PCM을 받아 완성된 발화들의 리스트 반환(없으면 빈 리스트).
  - `UtteranceSegmenter.flush() -> list[bytes]` — 스트림 종료 시 진행 중이던 발화를 마무리해 반환.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_stream_segmenter.py`:

```python
import numpy as np

from app.services.stream_segmenter import UtteranceSegmenter


def _tone(ms: int, sr: int = 16000, freq: int = 220, amp: int = 6000) -> bytes:
    n = sr * ms // 1000
    t = np.arange(n)
    return (amp * np.sin(2 * np.pi * freq * t / sr)).astype(np.int16).tobytes()


def _silence(ms: int, sr: int = 16000) -> bytes:
    return np.zeros(sr * ms // 1000, dtype=np.int16).tobytes()


def test_pure_silence_yields_no_utterance():
    seg = UtteranceSegmenter()
    assert seg.accept_audio(_silence(2000)) == []
    assert seg.flush() == []


def test_single_utterance_bounded_by_silence():
    seg = UtteranceSegmenter()
    out = seg.accept_audio(_silence(100) + _tone(500) + _silence(800))
    assert len(out) == 1
    # 발화 바이트는 최소 톤 길이(500ms=16000 sample=32000 byte) 이상이어야 한다
    assert len(out[0]) >= 500 * 16 * 2


def test_two_utterances_separated_by_long_silence():
    seg = UtteranceSegmenter()
    stream = _tone(500) + _silence(800) + _tone(500) + _silence(800)
    out = seg.accept_audio(stream)
    assert len(out) == 2


def test_short_blip_is_discarded():
    seg = UtteranceSegmenter()
    # 100ms 톤은 min voiced 길이(300ms) 미만 → 버려짐
    out = seg.accept_audio(_silence(100) + _tone(100) + _silence(800))
    assert out == []


def test_flush_finalizes_in_progress_speech():
    seg = UtteranceSegmenter()
    # 톤으로 끝나고 trailing silence가 없어 accept 중엔 종료 안 됨
    assert seg.accept_audio(_silence(100) + _tone(600)) == []
    out = seg.flush()
    assert len(out) == 1


def test_max_duration_force_cuts():
    seg = UtteranceSegmenter(max_utterance_ms=1000)
    # 3초 연속 톤(무음 없음) → 최대 1초에서 강제 컷되며 최소 1개 방출
    out = seg.accept_audio(_tone(3000))
    assert len(out) >= 1


def test_accept_handles_odd_byte_chunks():
    seg = UtteranceSegmenter()
    data = _silence(100) + _tone(500) + _silence(800)
    # 홀수 바이트로 쪼개 넣어도 프레임 정렬이 깨지지 않아야 한다
    out = []
    out += seg.accept_audio(data[:511])
    out += seg.accept_audio(data[511:])
    out += seg.flush()
    assert len(out) == 1
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `python -m pytest tests/test_stream_segmenter.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.stream_segmenter'`

- [ ] **Step 3: 최소 구현 작성**

`app/services/stream_segmenter.py`:

```python
"""실시간 스트리밍 STT용 발화 세그먼터 (순수 파이썬 RMS 에너지 VAD).

webrtcvad/silero 같은 네이티브 VAD는 C 확장(.pyd/.dll)이라 이 랩탑 Windows Smart App
Control이 av(PyAV)처럼 로드 시점에 차단할 위험이 있다. 그래서 numpy만 쓰는 RMS 에너지
기반으로 발화(문장) 경계를 잡는다. 입력은 16kHz mono Int16 PCM 바이트 스트림.
"""
from __future__ import annotations

import numpy as np


class UtteranceSegmenter:
    def __init__(
        self,
        sample_rate: int = 16000,
        frame_ms: int = 20,
        rms_threshold: float = 500.0,
        start_frames: int = 3,
        end_silence_ms: int = 700,
        min_utterance_ms: int = 300,
        max_utterance_ms: int = 15000,
    ) -> None:
        self.frame_bytes = (sample_rate * frame_ms // 1000) * 2  # int16 = 2 byte
        self.rms_threshold = rms_threshold
        self.start_frames = start_frames
        self.end_silence_frames = max(1, end_silence_ms // frame_ms)
        self.min_voiced_frames = max(1, min_utterance_ms // frame_ms)
        self.max_utterance_frames = max(1, max_utterance_ms // frame_ms)

        self._buf = b""                 # 프레임 정렬용 잔여 바이트
        self._speaking = False
        self._voiced_run = 0            # IDLE에서 연속 voiced 프레임 수(시작 트리거용)
        self._silence_run = 0           # SPEAKING에서 연속 silence 프레임 수(종료용)
        self._voiced_in_cur = 0         # 현재 발화의 voiced 프레임 총수(blip 필터용)
        self._pre: list[bytes] = []     # 시작 트리거 전 최근 프레임(프리롤)
        self._cur: list[bytes] = []     # 현재 발화 프레임들

    @staticmethod
    def _is_voiced(frame: bytes, threshold: float) -> bool:
        samples = np.frombuffer(frame, dtype=np.int16).astype(np.float32)
        if samples.size == 0:
            return False
        rms = float(np.sqrt(np.mean(samples * samples)))
        return rms >= threshold

    def accept_audio(self, pcm: bytes) -> list[bytes]:
        self._buf += pcm
        finished: list[bytes] = []
        while len(self._buf) >= self.frame_bytes:
            frame = self._buf[: self.frame_bytes]
            self._buf = self._buf[self.frame_bytes :]
            utt = self._process_frame(frame)
            if utt is not None:
                finished.append(utt)
        return finished

    def _process_frame(self, frame: bytes) -> bytes | None:
        voiced = self._is_voiced(frame, self.rms_threshold)
        if not self._speaking:
            self._pre.append(frame)
            if len(self._pre) > self.start_frames:
                self._pre.pop(0)
            if voiced:
                self._voiced_run += 1
                if self._voiced_run >= self.start_frames:
                    self._speaking = True
                    self._cur = list(self._pre)
                    self._voiced_in_cur = self.start_frames
                    self._pre = []
                    self._voiced_run = 0
                    self._silence_run = 0
            else:
                self._voiced_run = 0
            return None

        # speaking
        self._cur.append(frame)
        if voiced:
            self._voiced_in_cur += 1
            self._silence_run = 0
        else:
            self._silence_run += 1
        if self._silence_run >= self.end_silence_frames or len(self._cur) >= self.max_utterance_frames:
            return self._finalize()
        return None

    def _finalize(self) -> bytes | None:
        frames = self._cur
        voiced = self._voiced_in_cur
        self._speaking = False
        self._cur = []
        self._pre = []
        self._voiced_run = 0
        self._silence_run = 0
        self._voiced_in_cur = 0
        if voiced < self.min_voiced_frames:
            return None
        return b"".join(frames)

    def flush(self) -> list[bytes]:
        if self._speaking:
            utt = self._finalize()
            return [utt] if utt is not None else []
        return []
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `python -m pytest tests/test_stream_segmenter.py -v`
Expected: PASS (7 passed)

- [ ] **Step 5: 커밋**

```bash
git add app/services/stream_segmenter.py tests/test_stream_segmenter.py
git commit -m "feat(stt): RMS 에너지 기반 발화 세그먼터 (순수 파이썬 VAD)"
```

---

### Task 2: 발화 전사 래퍼

세그먼터가 뱉은 발화 하나(Int16 PCM 바이트)를 기존 whisper 싱글턴으로 전사하는 얇은 래퍼. PCM→float32 변환은 순수함수라 단위테스트하고, 실제 모델 전사는 통합테스트로 게이트한다.

**Files:**
- Create: `app/services/streaming_stt.py`
- Test: `tests/test_streaming_stt.py`

**Interfaces:**
- Consumes: `app.services.local_stt._get_model(settings)` (기존 싱글턴), `app.config.Settings`.
- Produces:
  - `utterance_to_float32(pcm_int16: bytes) -> np.ndarray` — Int16 PCM 바이트를 `-1.0~1.0` float32 배열로 변환.
  - `transcribe_utterance(settings: Settings, pcm_int16: bytes) -> str` — 발화 바이트를 한국어 전사 텍스트로.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_streaming_stt.py`:

```python
import numpy as np

from app.services.streaming_stt import utterance_to_float32


def test_utterance_to_float32_scales_int16_to_unit_range():
    pcm = np.array([0, 32767, -32768], dtype=np.int16).tobytes()
    out = utterance_to_float32(pcm)
    assert out.dtype == np.float32
    assert abs(out[0] - 0.0) < 1e-6
    assert abs(out[1] - 1.0) < 1e-3
    assert abs(out[2] - (-1.0)) < 1e-3


def test_utterance_to_float32_empty():
    out = utterance_to_float32(b"")
    assert out.dtype == np.float32
    assert out.size == 0
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `python -m pytest tests/test_streaming_stt.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.streaming_stt'`

- [ ] **Step 3: 최소 구현 작성**

`app/services/streaming_stt.py`:

```python
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `python -m pytest tests/test_streaming_stt.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: 커밋**

```bash
git add app/services/streaming_stt.py tests/test_streaming_stt.py
git commit -m "feat(stt): 발화 단위 전사 래퍼 (기존 whisper 싱글턴 재사용)"
```

---

### Task 3: WebSocket 통화 엔드포인트 + 세션 레지스트리

고객 오디오를 받아 세그먼터→전사를 돌리고, 같은 `call_id`의 상담사 소켓들로 전사 JSON을 팬아웃하는 WebSocket 엔드포인트. GPU 없이 테스트하기 위해 전사기를 가짜로 주입(monkeypatch)한다.

**Files:**
- Create: `app/ws/__init__.py` (빈 파일, 패키지 표시)
- Create: `app/ws/call.py`
- Modify: `app/main.py` (WS 라우터 include)
- Test: `tests/test_ws_call.py`

**Interfaces:**
- Consumes: `UtteranceSegmenter` (Task 1), `transcribe_utterance(settings, pcm)` (Task 2), `app.config.settings`.
- Produces:
  - `router` (`fastapi.APIRouter`) with `WS /ws/call/{call_id}?role=customer|agent`.
  - `registry` (`CallRegistry`), `CallSession` — 인메모리 통화 상태.
  - server→agent JSON: `{"type":"transcript","seq":int,"speaker":"customer","text":str,"isFinal":True,"at":int}`.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_ws_call.py`:

```python
import numpy as np
from fastapi.testclient import TestClient

import app.ws.call as call_module
from app.main import app


def _tone(ms: int, sr: int = 16000, freq: int = 220, amp: int = 6000) -> bytes:
    n = sr * ms // 1000
    t = np.arange(n)
    return (amp * np.sin(2 * np.pi * freq * t / sr)).astype(np.int16).tobytes()


def _silence(ms: int, sr: int = 16000) -> bytes:
    return np.zeros(sr * ms // 1000, dtype=np.int16).tobytes()


def test_customer_audio_produces_transcript_for_agent(monkeypatch):
    # 실제 GPU 모델 대신 가짜 전사기 주입 — 발화 바이트를 받으면 고정 문자열 반환
    monkeypatch.setattr(
        call_module, "transcribe_utterance", lambda settings, pcm: "테스트 발화"
    )
    client = TestClient(app)
    call_id = "test-room-1"
    with client.websocket_connect(f"/ws/call/{call_id}?role=agent") as agent, \
         client.websocket_connect(f"/ws/call/{call_id}?role=customer") as customer:
        # 완성된 발화 1개: 무음 + 톤(500ms) + 무음(800ms, end_silence 초과)
        customer.send_bytes(_silence(100) + _tone(500) + _silence(800))
        msg = agent.receive_json()

    assert msg["type"] == "transcript"
    assert msg["isFinal"] is True
    assert msg["speaker"] == "customer"
    assert msg["text"] == "테스트 발화"
    assert msg["seq"] == 1


def test_empty_transcript_is_not_broadcast(monkeypatch):
    # 전사 결과가 빈 문자열이면 상담사에게 아무것도 안 보낸다
    monkeypatch.setattr(
        call_module, "transcribe_utterance", lambda settings, pcm: ""
    )
    client = TestClient(app)
    call_id = "test-room-2"
    with client.websocket_connect(f"/ws/call/{call_id}?role=agent") as agent, \
         client.websocket_connect(f"/ws/call/{call_id}?role=customer") as customer:
        customer.send_bytes(_silence(100) + _tone(500) + _silence(800))
        # 고객 소켓을 닫아 서버 루프가 정리되게 한 뒤, 상담사에 온 메시지가 없어야 함
        customer.close()
        # 에이전트 소켓에 대기 중 메시지가 없으면 정상. 짧게 텍스트를 보내 라운드트립만 확인.
        agent.send_text("ping")
    # 예외 없이 블록을 빠져나오면 통과(브로드캐스트가 없었음)
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `python -m pytest tests/test_ws_call.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.ws'`

- [ ] **Step 3: 최소 구현 작성**

`app/ws/__init__.py`:

```python
```

(빈 파일)

`app/ws/call.py`:

```python
"""실시간 통화 WebSocket — 고객 오디오를 받아 스트리밍 STT 후 상담사에게 전사 팬아웃.

/ws/call/{call_id}?role=customer : 브라우저가 16k mono Int16 PCM 바이너리 프레임을 보냄
/ws/call/{call_id}?role=agent    : 상담사 대시보드. 같은 call_id의 전사 JSON을 수신
"""
from __future__ import annotations

import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.services.stream_segmenter import UtteranceSegmenter
from app.services.streaming_stt import transcribe_utterance

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
    session.seq += 1
    await _broadcast(
        session,
        {
            "type": "transcript",
            "seq": session.seq,
            "speaker": "customer",
            "text": text,
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
                await websocket.receive_text()  # 상담사→서버 메시지는 현재 무시(keepalive)
        except WebSocketDisconnect:
            session.agents.discard(websocket)
            registry.maybe_drop(call_id)
        return

    # customer
    session.customer = websocket
    try:
        while True:
            chunk = await websocket.receive_bytes()
            for utterance in session.segmenter.accept_audio(chunk):
                await _emit_transcript(session, utterance)
    except WebSocketDisconnect:
        for utterance in session.segmenter.flush():
            await _emit_transcript(session, utterance)
        session.customer = None
        registry.maybe_drop(call_id)
```

`app/main.py` 수정 — import 블록에 WS 라우터를 추가하고 include 한다:

기존 (`app/main.py:14-16`):

```python
from app.database import initialize_database, ping_database
from app.routers.mvp import router as mvp_router
from app.routers.pipeline import router as pipeline_router
```

수정 후:

```python
from app.database import initialize_database, ping_database
from app.routers.mvp import router as mvp_router
from app.routers.pipeline import router as pipeline_router
from app.ws.call import router as ws_router
```

기존 (`app/main.py:35-36`):

```python
app.include_router(pipeline_router)
app.include_router(mvp_router)
```

수정 후:

```python
app.include_router(pipeline_router)
app.include_router(mvp_router)
app.include_router(ws_router)
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `python -m pytest tests/test_ws_call.py -v`
Expected: PASS (2 passed)

전체 회귀도 확인:

Run: `python -m pytest -v`
Expected: 기존 테스트 + 신규 테스트 모두 PASS(통합 마커는 skip).

- [ ] **Step 5: 커밋**

```bash
git add app/ws/__init__.py app/ws/call.py app/main.py tests/test_ws_call.py
git commit -m "feat(ws): 실시간 통화 WebSocket 엔드포인트 + 세션 레지스트리 팬아웃"
```

---

### Task 4: 실제 모델 end-to-end 통합 테스트 (게이트)

세그먼터→전사 체인을 **실제 한국어 오디오 + 실제 whisper 모델**로 검증한다. GPU/모델이 필요하므로 `K7_TEST_LOCAL_MODELS=1` 일 때만 돈다.

**Files:**
- Create: `tests/test_streaming_stt_integration.py`

**Interfaces:**
- Consumes: `app.services.local_stt._decode_audio_ffmpeg`, `app.services.streaming_stt.transcribe_utterance`, `app.services.stream_segmenter.UtteranceSegmenter`.
- Produces: 없음(검증만).

- [ ] **Step 1: 통합 테스트 작성**

`tests/test_streaming_stt_integration.py`:

```python
"""세그먼터→전사 체인의 실제 모델 end-to-end 검증.

GPU/모델 다운로드가 필요해 기본 스킵. K7_TEST_LOCAL_MODELS=1 일 때만 돈다.
이 랩탑(RTX 3070 Ti, faster-whisper large-v3-turbo)에서 도는 것을 전제로 한다.
"""
import os

import numpy as np
import pytest

from app.config import Settings


def _local_models_enabled() -> bool:
    return os.getenv("K7_TEST_LOCAL_MODELS") == "1"


@pytest.mark.integration
def test_segmented_utterance_transcribes_with_real_model():
    if not _local_models_enabled():
        pytest.skip("K7_TEST_LOCAL_MODELS=1 not set")

    sample_path = "../stt/test_sample2.m4a"
    if not os.path.exists(sample_path):
        pytest.skip("sample audio not found")

    from app.services.local_stt import _decode_audio_ffmpeg
    from app.services.stream_segmenter import UtteranceSegmenter
    from app.services.streaming_stt import transcribe_utterance

    settings = Settings(use_local_models=True)

    audio_f32 = _decode_audio_ffmpeg(sample_path)  # -1.0~1.0 float32
    pcm_i16 = (np.clip(audio_f32, -1.0, 1.0) * 32767).astype(np.int16).tobytes()

    seg = UtteranceSegmenter()
    utterances = seg.accept_audio(pcm_i16) + seg.flush()
    assert utterances, "세그먼터가 실제 음성에서 발화를 하나도 잡지 못함"

    text = transcribe_utterance(settings, utterances[0])
    assert text, "실제 모델이 빈 전사를 반환함"
```

- [ ] **Step 2: 게이트 동작 확인 (모델 없이)**

Run: `python -m pytest tests/test_streaming_stt_integration.py -v`
Expected: SKIP ("K7_TEST_LOCAL_MODELS=1 not set")

- [ ] **Step 3: (GPU 랩탑에서) 실제 모델로 검증**

Run (PowerShell): `$env:K7_TEST_LOCAL_MODELS=1; python -m pytest tests/test_streaming_stt_integration.py -v -s`
Expected: PASS — 세그먼터가 발화를 잡고 실제 전사 텍스트가 비어있지 않음.
(GPU/모델 미가용 환경이면 이 스텝은 SKIP 확인만 하고 넘어간다.)

- [ ] **Step 4: 커밋**

```bash
git add tests/test_streaming_stt_integration.py
git commit -m "test(stt): 세그먼터→전사 실제 모델 end-to-end 통합 테스트(게이트)"
```

---

## 이 계획서(A) 이후

- **계획서 B** — `live_signals.py`: 발화당 감정온도(오디오)·라우팅(텍스트)·위험(키워드) 빠른 신호를 `_emit_transcript` 직후 함께 push, exaone 요약은 debounce.
- **계획서 C** — 프론트: 고객 뷰(`?role=customer`, AudioWorklet→wss), 상담사 라이브 자막 패널 + 카드 배선, mkcert https/wss.
- **계획서 D (P1)** — `pii-service` 컨테이너 분리(본인인증/계좌), `pii` 스키마 + 전용 롤.

## Self-Review (작성자 체크)

**Spec coverage (§ 대비):**
- §4.1 WS 계층/레지스트리/팬아웃 → Task 3 ✅ (단, 메시지 타입 중 `signals`/`summary`/`status`는 계획서 B/C 소관 — A는 `transcript`만)
- §4.2 세그먼터(RMS VAD) + 전사(싱글턴 재사용, `language="ko"`, numpy 투입) → Task 1·2 ✅
- §6 긴 발화 max-duration 강제 컷 → Task 1 `test_max_duration_force_cuts` ✅
- §7 "저장된 한국어 wav 주입" 재현성 테스트 → Task 4 ✅ / 합성 오디오 단위테스트 → Task 1·3 ✅
- §4.1 `status`/재연결, §4.3 신호, §4.5 프론트, §4.4 pii → **계획서 B/C/D로 이월**(A 범위 밖, 위 "이후" 절에 명시).

**Placeholder scan:** TBD/TODO/"적절히 처리" 없음. 모든 코드 스텝에 실제 코드·실제 명령·기대 출력 포함. ✅

**Type consistency:** `UtteranceSegmenter.accept_audio/flush → list[bytes]`가 Task 3에서 `for utterance in ... accept_audio(chunk)`로 소비됨 일치. `transcribe_utterance(settings, pcm)->str` 시그니처가 Task 2 정의·Task 3 호출·Task 3 테스트 monkeypatch lambda(`settings, pcm`)에서 모두 일치. WS 메시지 키(`type/seq/speaker/text/isFinal/at`)가 구현·테스트 동일. ✅
