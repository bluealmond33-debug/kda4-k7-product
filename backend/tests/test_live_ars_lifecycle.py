import asyncio
import threading
import time
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app import live_stt
from app.live_dtmf_store import read_dtmf_events
from app.main import app


def _receive_type(socket, expected: str) -> dict:
    for _ in range(30):
        message = socket.receive_json()
        if message.get("type") == "error":
            raise AssertionError(message.get("message", "unexpected live STT error"))
        if message.get("type") == expected:
            return message
    raise AssertionError(f"did not receive websocket event {expected!r}")


def _clear_call(call_id: str) -> None:
    orphan_task = getattr(live_stt, "_orphan_end_tasks", {}).pop(call_id, None)
    if orphan_task is not None:
        orphan_task.cancel()
    live_stt._ars_clients.pop(call_id, None)
    live_stt._ars_states.pop(call_id, None)
    live_stt._sessions.pop(call_id, None)
    live_stt._native_tasks.pop(call_id, None)
    live_stt._native_stop_events.pop(call_id, None)
    live_stt._audio_clients.pop(call_id, None)
    live_stt._registered_call_ids.discard(call_id)
    live_stt._audio_raw_generations.clear()
    live_stt._audio_last_source_seq.clear()
    for owner_key in tuple(live_stt._audio_sender_owners):
        if owner_key[0] == call_id:
            live_stt._audio_sender_owners.pop(owner_key, None)
    for sequence_key in tuple(live_stt._audio_sender_sequences):
        if sequence_key[0] == call_id:
            live_stt._audio_sender_sequences.pop(sequence_key, None)
    for owner_key in tuple(live_stt._audio_owner_locks):
        if owner_key[0] == call_id:
            live_stt._audio_owner_locks.pop(owner_key, None)
    live_stt._audio_replaced_clients.clear()


def _register_call(call_id: str) -> None:
    live_stt._registered_call_ids.add(call_id)
    live_stt._ars_states.setdefault(call_id, live_stt._ArsState())
    live_stt._sessions.setdefault(call_id, live_stt._CallSession())


def test_tracked_stt_jobs_are_drained_before_lifecycle_continues(monkeypatch) -> None:
    call_id = f"drain-{uuid4()}"
    session = live_stt._CallSession()
    release = asyncio.Event()

    async def fake_process(_call_id, active_session, _pcm) -> None:
        await release.wait()
        active_session.seq += 1

    monkeypatch.setattr(live_stt, "_process_audio", fake_process)

    async def scenario() -> None:
        live_stt._schedule_audio_processing(call_id, session, b"first")
        live_stt._schedule_audio_processing(call_id, session, b"second")
        drain = asyncio.create_task(
            live_stt._drain_audio_processing(call_id, session)
        )
        await asyncio.sleep(0)
        assert not drain.done()
        release.set()
        assert await drain is True
        assert session.seq == 2
        assert not session.processing_tasks

    asyncio.run(scenario())


def test_stt_worker_is_serial_and_announces_backlog(monkeypatch) -> None:
    call_id = f"serial-stt-{uuid4()}"
    session = live_stt._CallSession()
    state = live_stt._ArsState(active=True, generation=1)
    live_stt._sessions[call_id] = session
    live_stt._ars_states[call_id] = state
    monkeypatch.setattr(live_stt, "_STT_BACKLOG_NOTICE_THRESHOLD", 2)
    active = 0
    maximum = 0
    counter_lock = threading.Lock()

    class Observer:
        def __init__(self) -> None:
            self.messages: list[dict] = []

        async def send_json(self, payload: dict) -> None:
            self.messages.append(payload)

    observer = Observer()
    session.agents.add(observer)  # type: ignore[arg-type]

    def transcribe(_pcm: bytes) -> str:
        nonlocal active, maximum
        with counter_lock:
            active += 1
            maximum = max(maximum, active)
        time.sleep(0.03)
        with counter_lock:
            active -= 1
        return "직렬 처리 발화"

    monkeypatch.setattr(live_stt, "_transcribe_pcm", transcribe)

    async def scenario() -> None:
        first = live_stt._schedule_audio_processing(
            call_id, session, b"\0\0", "customer", 1, 1_000
        )
        second = live_stt._schedule_audio_processing(
            call_id, session, b"\0\0", "customer", 2, 1_100
        )
        await asyncio.gather(first, second)
        await asyncio.sleep(0)

    try:
        asyncio.run(scenario())
        assert maximum == 1
        overload = next(
            item for item in observer.messages if item.get("type") == "stt_overload"
        )
        assert overload["serial_workers"] == 1
        assert overload["pending_tasks"] == 2
    finally:
        _clear_call(call_id)


def test_stt_backlog_is_bounded_and_drain_reports_rejected_audio(monkeypatch) -> None:
    call_id = f"bounded-stt-{uuid4()}"
    session = live_stt._CallSession()
    release = asyncio.Event()
    monkeypatch.setattr(live_stt, "_STT_MAX_PENDING_TASKS", 2)
    monkeypatch.setattr(live_stt, "_STT_BACKLOG_NOTICE_THRESHOLD", 2)

    class Observer:
        def __init__(self) -> None:
            self.messages: list[dict] = []

        async def send_json(self, payload: dict) -> None:
            self.messages.append(payload)

    observer = Observer()
    session.agents.add(observer)  # type: ignore[arg-type]

    async def fake_process(_call_id, _session, _pcm) -> None:
        await release.wait()

    monkeypatch.setattr(live_stt, "_process_audio", fake_process)

    async def scenario() -> None:
        first = live_stt._schedule_audio_processing(call_id, session, b"first")
        second = live_stt._schedule_audio_processing(call_id, session, b"second")
        rejected = live_stt._schedule_audio_processing(call_id, session, b"third")
        assert first is not None
        assert second is not None
        assert rejected is None
        assert len(session.processing_tasks) == 2
        await asyncio.sleep(0)

        overload = next(
            item
            for item in observer.messages
            if item.get("type") == "stt_overload"
            and item.get("status") == "rejected"
        )
        assert overload["pending_tasks"] == 2
        assert overload["max_pending_tasks"] == 2
        assert overload["dropped_utterances"] == 1
        assert overload["policy"] == "reject_newest_utterance"

        drain = asyncio.create_task(
            live_stt._drain_audio_processing(call_id, session)
        )
        await asyncio.sleep(0)
        assert not drain.done()
        release.set()
        assert await drain is False
        assert not session.processing_tasks
        assert session.overload_rejected_utterances == 0
        assert any(
            item.get("type") == "stt_overload"
            and item.get("status") == "drained_incomplete"
            and item.get("dropped_utterances") == 1
            for item in observer.messages
        )

    asyncio.run(scenario())


def test_state_request_returns_the_latest_ars_snapshot() -> None:
    call_id = f"state-request-{uuid4()}"
    _register_call(call_id)

    try:
        with TestClient(app) as client:
            with client.websocket_connect(
                f"/ws/ars/{call_id}?role=desktop"
            ) as desktop:
                _receive_type(desktop, "ready")
                _receive_type(desktop, "ars_state")

                state = live_stt._ars_states[call_id]
                state.active = True
                state.digits = "120"
                state.intake_complete = True
                state.agent_connected = True
                state.final_seq = 9
                state.drained = True

                desktop.send_json({"type": "state_request"})
                snapshot = _receive_type(desktop, "ars_state")
                assert snapshot == {
                    "type": "ars_state",
                    "generation": 0,
                    "dtmf_count": 0,
                    "active": True,
                    "digits": "120",
                    "intake_complete": True,
                    "agent_connected": True,
                    "final_seq": 9,
                    "drained": True,
                    "end_reason": None,
                    "ended_by": None,
                }
    finally:
        _clear_call(call_id)


def test_zero_dtmf_remains_numeric_input_until_explicit_completion(monkeypatch) -> None:
    call_id = f"zero-dtmf-{uuid4()}"
    _register_call(call_id)

    async def fake_start(_call_id: str) -> None:
        return None

    monkeypatch.setattr(live_stt, "start_native_wo_mic", fake_start)

    try:
        with TestClient(app) as client:
            with (
                client.websocket_connect(
                    f"/ws/ars/{call_id}?role=desktop"
                ) as desktop,
                client.websocket_connect(
                    f"/ws/ars/{call_id}?role=mobile"
                ) as mobile,
            ):
                _receive_type(desktop, "ready")
                _receive_type(mobile, "ready")
                mobile.send_json({"type": "call_start"})
                _receive_type(desktop, "call_start")

                mobile.send_json({"type": "dtmf", "digit": "0"})
                event = _receive_type(desktop, "dtmf")
                assert event["digit"] == "0"
                assert event["phase"] == "intake"
                assert event["dtmf_seq"] == 1
                assert event["persisted"] is True

                desktop.send_json({"type": "state_request"})
                snapshot = _receive_type(desktop, "ars_state")
                assert snapshot["active"] is True
                assert snapshot["digits"] == "0"
                assert snapshot["intake_complete"] is False
    finally:
        _clear_call(call_id)


def test_dtmf_is_persisted_and_hash_remains_input_during_active_call(monkeypatch) -> None:
    call_id = f"active-dtmf-{uuid4()}"
    _register_call(call_id)

    async def fake_start(_call_id: str) -> None:
        return None

    monkeypatch.setattr(live_stt, "start_native_wo_mic", fake_start)

    try:
        with TestClient(app) as client:
            with (
                client.websocket_connect(
                    f"/ws/ars/{call_id}?role=desktop"
                ) as desktop,
                client.websocket_connect(
                    f"/ws/ars/{call_id}?role=mobile"
                ) as mobile,
            ):
                _receive_type(desktop, "ready")
                _receive_type(mobile, "ready")
                mobile.send_json({"type": "call_start"})
                started = _receive_type(desktop, "call_start")

                state = live_stt._ars_states[call_id]
                state.intake_complete = True
                state.agent_connected = True

                for digit in ("5", "#"):
                    mobile.send_json(
                        {
                            "type": "dtmf",
                            "digit": digit,
                            "generation": started["generation"],
                        }
                    )
                    event = _receive_type(desktop, "dtmf")
                    assert event["digit"] == digit
                    assert event["phase"] == "active"
                    assert event["persisted"] is True

                desktop.send_json({"type": "state_request"})
                snapshot = _receive_type(desktop, "ars_state")
                assert snapshot["active"] is True
                assert snapshot["agent_connected"] is True
                assert snapshot["intake_complete"] is True
                assert snapshot["digits"] == "5#"
                assert snapshot["dtmf_count"] == 2

        stored = read_dtmf_events(call_id, started["generation"])
        assert [(item.seq, item.digit, item.phase) for item in stored] == [
            (1, "5", "active"),
            (2, "#", "active"),
        ]
    finally:
        _clear_call(call_id)


def test_stopped_capture_drains_queued_final_block(monkeypatch) -> None:
    call_id = f"queued-tail-{uuid4()}"
    session = live_stt._CallSession()
    audio_queue: asyncio.Queue[bytes] = asyncio.Queue()
    queued_speech = (1000).to_bytes(2, "little", signed=True) * 4096
    audio_queue.put_nowait(queued_speech)
    scheduled: list[bytes] = []

    def fake_schedule(_call_id, _session, pcm):
        scheduled.append(pcm)
        return None

    monkeypatch.setattr(live_stt, "_schedule_audio_processing", fake_schedule)

    asyncio.run(
        live_stt._drain_stopped_capture_queue(call_id, session, audio_queue)
    )

    assert audio_queue.empty()
    assert len(scheduled) == 1
    assert scheduled[0].startswith(queued_speech)
    assert len(scheduled[0]) == live_stt._MIN_UTTERANCE_BYTES
    assert not session.audio
    assert session.speech_seen is False


def test_short_spoken_tail_is_zero_padded_instead_of_dropped() -> None:
    session = live_stt._CallSession()
    short_speech = (900).to_bytes(2, "little", signed=True) * 800
    session.audio.extend(short_speech)
    session.speech_seen = True

    tail = live_stt._take_final_utterance(session)

    assert tail is not None
    assert tail[: len(short_speech)] == short_speech
    assert len(tail) == live_stt._MIN_UTTERANCE_BYTES
    assert tail[len(short_speech) :] == b"\0" * (
        live_stt._MIN_UTTERANCE_BYTES - len(short_speech)
    )
    assert not session.audio
    assert session.speech_seen is False


def test_browser_customer_disconnect_processes_short_spoken_tail(monkeypatch) -> None:
    call_id = f"browser-tail-{uuid4()}"
    _register_call(call_id)
    short_speech = (900).to_bytes(2, "little", signed=True) * 800
    processed: list[bytes] = []

    async def fake_process(_call_id, _session, pcm) -> None:
        processed.append(pcm)

    monkeypatch.setattr(live_stt, "_process_audio", fake_process)

    try:
        with TestClient(app) as client:
            with client.websocket_connect(
                f"/ws/call/{call_id}?role=customer"
            ) as customer:
                _receive_type(customer, "ready")
                customer.send_bytes(short_speech)

        assert len(processed) == 1
        assert processed[0].startswith(short_speech)
        assert len(processed[0]) == live_stt._MIN_UTTERANCE_BYTES
    finally:
        _clear_call(call_id)


def test_intake_ack_exposes_stable_final_seq_and_reconnect_snapshot(
    monkeypatch,
) -> None:
    call_id = f"intake-{uuid4()}"
    _register_call(call_id)
    events: list[str] = []
    stop_count = 0

    async def fake_start(_call_id: str) -> None:
        events.append("capture-start")

    async def fake_stop(active_call_id: str) -> bool:
        nonlocal stop_count
        stop_count += 1
        events.append("drain-start")
        await asyncio.sleep(0.02)
        live_stt._sessions[active_call_id].seq = 7
        events.append("drain-done")
        return True

    monkeypatch.setattr(live_stt, "start_native_wo_mic", fake_start)
    monkeypatch.setattr(live_stt, "stop_native_wo_mic", fake_stop)

    try:
        with TestClient(app) as client:
            with client.websocket_connect(
                f"/ws/ars/{call_id}?role=desktop"
            ) as desktop:
                _receive_type(desktop, "ready")
                with client.websocket_connect(
                    f"/ws/ars/{call_id}?role=mobile"
                ) as mobile:
                    _receive_type(mobile, "ready")
                    mobile.send_json({"type": "call_start"})
                    _receive_type(desktop, "call_start")
                    mobile.send_json({"type": "intake_complete"})
                    ack = _receive_type(desktop, "intake_complete")
                    assert events[-1] == "drain-done"
                    assert ack["final_seq"] == 7
                    assert ack["drained"] is True

                with client.websocket_connect(
                    f"/ws/ars/{call_id}?role=mobile"
                ) as reconnected:
                    _receive_type(reconnected, "ready")
                    state = _receive_type(reconnected, "ars_state")
                    assert state["active"] is True
                    assert state["intake_complete"] is True
                    assert state["final_seq"] == 7
                    assert state["drained"] is True

                    # Re-sending after an ACK loss is idempotent and does not
                    # stop a resumed counselor conversation a second time.
                    reconnected.send_json({"type": "intake_complete"})
                    repeated = _receive_type(desktop, "intake_complete")
                    assert repeated["final_seq"] == 7
                    assert stop_count == 1
    finally:
        _clear_call(call_id)


def test_reconnect_snapshot_does_not_claim_an_inflight_drain_is_complete(
    monkeypatch,
) -> None:
    call_id = f"inflight-intake-{uuid4()}"
    _register_call(call_id)
    stop_started = threading.Event()
    release_stop = threading.Event()

    async def fake_start(_call_id: str) -> None:
        return None

    async def fake_stop(active_call_id: str) -> bool:
        stop_started.set()
        await asyncio.to_thread(release_stop.wait, 2)
        live_stt._sessions[active_call_id].seq = 5
        return True

    monkeypatch.setattr(live_stt, "start_native_wo_mic", fake_start)
    monkeypatch.setattr(live_stt, "stop_native_wo_mic", fake_stop)

    try:
        with TestClient(app) as client:
            with (
                client.websocket_connect(
                    f"/ws/ars/{call_id}?role=desktop"
                ) as desktop,
                client.websocket_connect(
                    f"/ws/ars/{call_id}?role=mobile"
                ) as mobile,
            ):
                _receive_type(desktop, "ready")
                _receive_type(mobile, "ready")
                mobile.send_json({"type": "call_start"})
                _receive_type(desktop, "call_start")
                mobile.send_json({"type": "intake_complete"})
                assert stop_started.wait(1)

                desktop.send_json({"type": "state_request"})
                polled = _receive_type(desktop, "ars_state")
                assert polled["active"] is True
                assert polled["intake_complete"] is True
                assert polled["drained"] is False

                with client.websocket_connect(
                    f"/ws/ars/{call_id}?role=mobile"
                ) as reconnected:
                    _receive_type(reconnected, "ready")
                    state = _receive_type(reconnected, "ars_state")
                    assert state["intake_complete"] is True
                    assert state["drained"] is False

                release_stop.set()
                ack = _receive_type(desktop, "intake_complete")
                assert ack["final_seq"] == 5
                assert ack["drained"] is True
    finally:
        release_stop.set()
        _clear_call(call_id)


def test_agent_connected_requires_generation_completed_intake_and_drain(
    monkeypatch,
) -> None:
    call_id = f"agent-gate-{uuid4()}"
    _register_call(call_id)
    starts: list[str] = []
    gates: list[str] = []

    async def fake_start(active_call_id: str) -> None:
        starts.append(active_call_id)

    async def fake_gate(_call_id, _state, reason: str) -> None:
        gates.append(reason)

    monkeypatch.setattr(live_stt, "_start_lifecycle_capture", fake_start)
    monkeypatch.setattr(live_stt, "_broadcast_audio_gate", fake_gate)

    try:
        with TestClient(app) as client:
            with (
                client.websocket_connect(
                    f"/ws/ars/{call_id}?role=desktop"
                ) as desktop,
                client.websocket_connect(
                    f"/ws/ars/{call_id}?role=mobile"
                ) as mobile,
            ):
                _receive_type(desktop, "ready")
                _receive_type(mobile, "ready")
                mobile.send_json({"type": "call_start"})
                _receive_type(desktop, "call_start")
                starts.clear()
                gates.clear()

                desktop.send_json({"type": "agent_connected"})
                missing = _receive_type(desktop, "lifecycle_error")
                assert missing["code"] == "generation_required"

                desktop.send_json({"type": "agent_connected", "generation": 1})
                early = _receive_type(desktop, "lifecycle_error")
                assert early["code"] == "intake_not_complete"

                state = live_stt._ars_states[call_id]
                state.intake_complete = True
                state.drained = False
                desktop.send_json({"type": "agent_connected", "generation": 1})
                pending = _receive_type(desktop, "lifecycle_error")
                assert pending["code"] == "intake_drain_pending"
                assert state.agent_connected is False
                assert starts == []
                assert gates == []

                state.drained = True
                desktop.send_json({"type": "agent_connected", "generation": 1})
                connected = _receive_type(mobile, "agent_connected")
                assert connected["generation"] == 1
                assert state.agent_connected is True
                assert starts == [call_id]
                assert gates == ["agent_connected"]
    finally:
        _clear_call(call_id)


def test_reconnected_counselor_cannot_open_redial_with_stale_generation(
    monkeypatch,
) -> None:
    call_id = f"agent-stale-redial-{uuid4()}"
    _register_call(call_id)
    gates: list[str] = []

    async def fake_start(_call_id: str) -> None:
        return None

    async def fake_stop(_call_id: str) -> bool:
        return True

    async def fake_gate(_call_id, _state, reason: str) -> None:
        gates.append(reason)

    monkeypatch.setattr(live_stt, "_start_lifecycle_capture", fake_start)
    monkeypatch.setattr(live_stt, "stop_native_wo_mic", fake_stop)
    monkeypatch.setattr(live_stt, "_broadcast_audio_gate", fake_gate)

    try:
        with TestClient(app) as client:
            with client.websocket_connect(
                f"/ws/ars/{call_id}?role=mobile"
            ) as mobile:
                _receive_type(mobile, "ready")
                with client.websocket_connect(
                    f"/ws/ars/{call_id}?role=desktop"
                ) as first_desktop:
                    _receive_type(first_desktop, "ready")
                    mobile.send_json({"type": "call_start"})
                    _receive_type(first_desktop, "call_start")
                    first_state = live_stt._ars_states[call_id]
                    first_state.intake_complete = True
                    first_state.drained = True
                    first_desktop.send_json(
                        {"type": "agent_connected", "generation": 1}
                    )
                    _receive_type(mobile, "agent_connected")
                    first_desktop.send_json({"type": "call_end", "generation": 1})
                    _receive_type(mobile, "call_end")

                mobile.send_json({"type": "call_start"})
                _receive_type(mobile, "call_start")
                second_state = live_stt._ars_states[call_id]
                assert second_state.generation == 2
                second_state.intake_complete = True
                second_state.drained = True
                gates.clear()

                with client.websocket_connect(
                    f"/ws/ars/{call_id}?role=desktop"
                ) as reconnected:
                    _receive_type(reconnected, "ready")
                    _receive_type(reconnected, "ars_state")
                    reconnected.send_json(
                        {"type": "agent_connected", "generation": 1}
                    )
                    stale = _receive_type(reconnected, "lifecycle_error")
                    assert stale["code"] == "stale_generation"
                    assert stale["generation"] == 2
                    assert second_state.agent_connected is False
                    assert gates == []

                    reconnected.send_json(
                        {"type": "agent_connected", "generation": 2}
                    )
                    connected = _receive_type(mobile, "agent_connected")
                    assert connected["generation"] == 2
                    assert gates == ["agent_connected"]
    finally:
        _clear_call(call_id)


@pytest.mark.parametrize("sender_role", ["desktop", "mobile"])
def test_either_side_can_explicitly_end_active_call(monkeypatch, sender_role) -> None:
    call_id = f"hangup-{sender_role}-{uuid4()}"
    _register_call(call_id)
    stopped: list[str] = []

    async def fake_start(_call_id: str) -> None:
        return None

    async def fake_stop(active_call_id: str) -> bool:
        stopped.append(active_call_id)
        live_stt._sessions[active_call_id].seq = 11
        return True

    monkeypatch.setattr(live_stt, "start_native_wo_mic", fake_start)
    monkeypatch.setattr(live_stt, "stop_native_wo_mic", fake_stop)

    try:
        with TestClient(app) as client:
            with (
                client.websocket_connect(
                    f"/ws/ars/{call_id}?role=desktop"
                ) as desktop,
                client.websocket_connect(
                    f"/ws/ars/{call_id}?role=mobile"
                ) as mobile,
            ):
                _receive_type(desktop, "ready")
                _receive_type(mobile, "ready")
                mobile.send_json({"type": "call_start"})
                _receive_type(desktop, "call_start")
                mobile.send_json({"type": "intake_complete", "generation": 1})
                _receive_type(desktop, "intake_complete")
                stopped.clear()
                desktop.send_json({"type": "agent_connected", "generation": 1})
                _receive_type(mobile, "agent_connected")

                sender = desktop if sender_role == "desktop" else mobile
                receiver = mobile if sender_role == "desktop" else desktop
                sender.send_json({"type": "call_end"})
                ended = _receive_type(receiver, "call_end")
                assert ended["final_seq"] == 11
                assert ended["drained"] is True
                assert live_stt._ars_states[call_id].active is False
                assert stopped == [call_id]
    finally:
        _clear_call(call_id)


def test_mobile_control_reconnect_preserves_active_agent_capture(monkeypatch) -> None:
    call_id = f"active-reconnect-{uuid4()}"
    _register_call(call_id)
    starts: list[str] = []
    stops: list[str] = []

    async def fake_start(active_call_id: str) -> None:
        starts.append(active_call_id)

    async def fake_stop(active_call_id: str) -> bool:
        stops.append(active_call_id)
        return True

    monkeypatch.setattr(live_stt, "start_native_wo_mic", fake_start)
    monkeypatch.setattr(live_stt, "stop_native_wo_mic", fake_stop)

    try:
        with TestClient(app) as client:
            with client.websocket_connect(
                f"/ws/ars/{call_id}?role=desktop"
            ) as desktop:
                _receive_type(desktop, "ready")
                with client.websocket_connect(
                    f"/ws/ars/{call_id}?role=mobile"
                ) as mobile:
                    _receive_type(mobile, "ready")
                    mobile.send_json({"type": "call_start"})
                    _receive_type(desktop, "call_start")
                    mobile.send_json({"type": "intake_complete", "generation": 1})
                    _receive_type(desktop, "intake_complete")
                    desktop.send_json({"type": "agent_connected", "generation": 1})
                    _receive_type(mobile, "agent_connected")
                    stops.clear()

                time.sleep(0.05)
                assert stops == []

                with client.websocket_connect(
                    f"/ws/ars/{call_id}?role=mobile"
                ) as reconnected:
                    _receive_type(reconnected, "ready")
                    state = _receive_type(reconnected, "ars_state")
                    assert state["active"] is True
                    assert state["agent_connected"] is True
                    assert starts == [call_id, call_id]

                    desktop.send_json({"type": "call_end"})
                    _receive_type(reconnected, "call_end")
    finally:
        _clear_call(call_id)


def test_pre_intake_reconnect_cancels_orphan_end_and_reasserts_capture(
    monkeypatch,
) -> None:
    call_id = f"pre-reconnect-{uuid4()}"
    _register_call(call_id)
    starts: list[str] = []
    stops: list[str] = []

    async def fake_start(active_call_id: str) -> None:
        starts.append(active_call_id)

    async def fake_stop(active_call_id: str) -> bool:
        stops.append(active_call_id)
        return True

    monkeypatch.setattr(live_stt, "start_native_wo_mic", fake_start)
    monkeypatch.setattr(live_stt, "stop_native_wo_mic", fake_stop)

    try:
        with TestClient(app) as client:
            with client.websocket_connect(
                f"/ws/ars/{call_id}?role=desktop"
            ) as desktop:
                _receive_type(desktop, "ready")
                with client.websocket_connect(
                    f"/ws/ars/{call_id}?role=mobile"
                ) as mobile:
                    _receive_type(mobile, "ready")
                    mobile.send_json({"type": "call_start"})
                    _receive_type(desktop, "call_start")

                time.sleep(0.05)
                assert stops == []

                with client.websocket_connect(
                    f"/ws/ars/{call_id}?role=mobile"
                ) as reconnected:
                    _receive_type(reconnected, "ready")
                    state = _receive_type(reconnected, "ars_state")
                    assert state["active"] is True
                    assert state["intake_complete"] is False
                    reconnected.send_json({"type": "call_start"})
                    _receive_type(desktop, "call_start")
                    assert starts == [call_id, call_id]
                    assert stops == []
    finally:
        _clear_call(call_id)


def test_completed_call_id_can_be_reused_for_a_clean_second_call(monkeypatch) -> None:
    """A normal wrap-up/reset cycle must not leak call-one state into call two."""

    call_id = f"repeat-call-{uuid4()}"
    _register_call(call_id)
    starts: list[str] = []
    stops: list[str] = []

    async def fake_start(active_call_id: str) -> None:
        starts.append(active_call_id)

    async def fake_stop(active_call_id: str) -> bool:
        stops.append(active_call_id)
        return True

    monkeypatch.setattr(live_stt, "start_native_wo_mic", fake_start)
    monkeypatch.setattr(live_stt, "stop_native_wo_mic", fake_stop)

    try:
        with TestClient(app) as client:
            with (
                client.websocket_connect(
                    f"/ws/ars/{call_id}?role=desktop"
                ) as desktop,
                client.websocket_connect(
                    f"/ws/ars/{call_id}?role=mobile"
                ) as mobile,
            ):
                _receive_type(desktop, "ready")
                _receive_type(mobile, "ready")

                # First call: intake -> counselor -> explicit end.
                mobile.send_json({"type": "call_start"})
                _receive_type(desktop, "call_start")
                mobile.send_json({"type": "dtmf", "digit": "1"})
                _receive_type(desktop, "dtmf")
                first_session = live_stt._sessions[call_id]
                first_session.seq = 3
                first_session.history.append(
                    {"type": "transcript", "seq": 3, "text": "first call"}
                )
                mobile.send_json({"type": "intake_complete"})
                _receive_type(desktop, "intake_complete")
                desktop.send_json({"type": "agent_connected", "generation": 1})
                _receive_type(mobile, "agent_connected")
                first_session.seq = 5
                desktop.send_json({"type": "call_end"})
                first_end = _receive_type(mobile, "call_end")
                assert first_end["final_seq"] == 5
                assert first_end["drained"] is True

                # Second call reuses the demo call id only after the first end
                # barrier. Backend state and transcript history must be fresh.
                mobile.send_json({"type": "call_start"})
                _receive_type(desktop, "call_start")
                desktop.send_json({"type": "state_request"})
                second = _receive_type(desktop, "ars_state")
                assert second == {
                    "type": "ars_state",
                    "generation": 2,
                    "dtmf_count": 0,
                    "active": True,
                    "digits": "",
                    "intake_complete": False,
                    "agent_connected": False,
                    "final_seq": 0,
                    "drained": True,
                    "end_reason": None,
                    "ended_by": None,
                }
                second_session = live_stt._sessions[call_id]
                assert second_session.seq == 0
                assert second_session.history == []

                mobile.send_json({"type": "dtmf", "digit": "0"})
                _receive_type(desktop, "dtmf")
                mobile.send_json({"type": "intake_complete"})
                _receive_type(desktop, "intake_complete")
                desktop.send_json({"type": "agent_connected", "generation": 2})
                _receive_type(mobile, "agent_connected")
                desktop.send_json({"type": "call_end"})
                second_end = _receive_type(mobile, "call_end")
                assert second_end["drained"] is True
                assert live_stt._ars_states[call_id].active is False

                assert starts == [call_id, call_id, call_id, call_id]
                assert stops == [call_id, call_id, call_id, call_id]

    finally:
        _clear_call(call_id)


def test_immediate_redial_is_ordered_after_the_previous_end_ack(monkeypatch) -> None:
    """Document the protocol ordering a phone UI must reconcile on redial.

    The backend serializes messages from one mobile socket, so an immediate
    redial emits the old ``call_end`` acknowledgement before the new
    ``call_start`` event. A client must not let that acknowledgement tear down
    the newer local call state.
    """

    call_id = f"immediate-redial-{uuid4()}"
    _register_call(call_id)

    async def fake_start(_active_call_id: str) -> None:
        return None

    async def fake_stop(_active_call_id: str) -> bool:
        await asyncio.sleep(0.01)
        return True

    monkeypatch.setattr(live_stt, "start_native_wo_mic", fake_start)
    monkeypatch.setattr(live_stt, "stop_native_wo_mic", fake_stop)

    try:
        with TestClient(app) as client:
            with (
                client.websocket_connect(
                    f"/ws/ars/{call_id}?role=desktop"
                ) as desktop,
                client.websocket_connect(
                    f"/ws/ars/{call_id}?role=mobile"
                ) as mobile,
            ):
                _receive_type(desktop, "ready")
                _receive_type(mobile, "ready")
                mobile.send_json({"type": "call_start"})
                _receive_type(desktop, "call_start")
                mobile.send_json({"type": "intake_complete", "generation": 1})
                _receive_type(desktop, "intake_complete")
                desktop.send_json({"type": "agent_connected", "generation": 1})
                _receive_type(mobile, "agent_connected")

                # This is what a double tap / very fast hang-up then redial
                # produces on the current phone page.
                mobile.send_json({"type": "call_end"})
                mobile.send_json({"type": "call_start"})

                _receive_type(mobile, "call_end")
                _receive_type(mobile, "call_start")
                desktop.send_json({"type": "state_request"})
                state = _receive_type(desktop, "ars_state")
                assert state["active"] is True
                assert state["generation"] == 2
                assert state["intake_complete"] is False
                assert state["agent_connected"] is False
                assert state["final_seq"] == 0
                assert state["drained"] is True

                mobile.send_json({"type": "call_end"})
                _receive_type(desktop, "call_end")
    finally:
        _clear_call(call_id)


def test_orphaned_mobile_call_ends_after_grace_then_reuses_clean_state(
    monkeypatch,
) -> None:
    """A vanished phone must end once, drain, and permit a clean next call."""

    call_id = f"orphan-repeat-{uuid4()}"
    _register_call(call_id)
    starts: list[str] = []
    stops: list[str] = []

    async def fake_start(active_call_id: str) -> None:
        starts.append(active_call_id)

    async def fake_stop(active_call_id: str) -> bool:
        stops.append(active_call_id)
        live_stt._sessions[active_call_id].seq = 3 if len(stops) == 1 else 5
        return True

    monkeypatch.setattr(live_stt, "_ORPHAN_END_GRACE_SECONDS", 0.03)
    monkeypatch.setattr(live_stt, "start_native_wo_mic", fake_start)
    monkeypatch.setattr(live_stt, "stop_native_wo_mic", fake_stop)

    try:
        with TestClient(app) as client:
            with client.websocket_connect(
                f"/ws/ars/{call_id}?role=desktop"
            ) as desktop:
                _receive_type(desktop, "ready")
                with client.websocket_connect(
                    f"/ws/ars/{call_id}?role=mobile"
                ) as first_mobile:
                    _receive_type(first_mobile, "ready")
                    first_mobile.send_json({"type": "call_start"})
                    first_start = _receive_type(desktop, "call_start")
                    assert first_start["generation"] == 1
                    first_mobile.send_json({"type": "intake_complete"})
                    first_intake = _receive_type(desktop, "intake_complete")
                    assert first_intake["generation"] == 1
                    desktop.send_json({"type": "agent_connected", "generation": 1})
                    _receive_type(first_mobile, "agent_connected")

                    first_session = live_stt._sessions[call_id]
                    first_session.seq = 4
                    first_session.history.append(
                        {"type": "transcript", "seq": 4, "text": "orphaned call"}
                    )

                # There is no explicit call_end. The backend owns the terminal
                # drain after the reconnect grace expires.
                orphan_end = _receive_type(desktop, "call_end")
                assert orphan_end["generation"] == 1
                assert orphan_end["final_seq"] == 5
                assert orphan_end["drained"] is True
                assert orphan_end["end_reason"] == "customer_disconnect"
                assert orphan_end["ended_by"] == "system"
                assert live_stt._ars_states[call_id].active is False

                # A subsequent phone call is a new generation with no digits,
                # transcript sequence, or history inherited from call one.
                with client.websocket_connect(
                    f"/ws/ars/{call_id}?role=mobile"
                ) as second_mobile:
                    _receive_type(second_mobile, "ready")
                    inactive = _receive_type(second_mobile, "ars_state")
                    assert inactive["active"] is False
                    assert inactive["generation"] == 1

                    second_mobile.send_json({"type": "call_start"})
                    second_start = _receive_type(desktop, "call_start")
                    assert second_start["generation"] == 2
                    desktop.send_json({"type": "state_request"})
                    second_state = _receive_type(desktop, "ars_state")
                    assert second_state["active"] is True
                    assert second_state["generation"] == 2
                    assert second_state["digits"] == ""
                    assert second_state["intake_complete"] is False
                    assert second_state["agent_connected"] is False
                    assert second_state["final_seq"] == 0
                    assert second_state["drained"] is True
                    assert live_stt._sessions[call_id].seq == 0
                    assert live_stt._sessions[call_id].history == []

                    second_mobile.send_json({"type": "call_end"})
                    second_end = _receive_type(desktop, "call_end")
                    assert second_end["generation"] == 2
                    assert second_end["end_reason"] == "customer_hangup"
                    assert second_end["ended_by"] == "customer"

                assert starts == [call_id, call_id, call_id]
                assert stops == [call_id, call_id, call_id]
    finally:
        _clear_call(call_id)


def test_mobile_reconnect_within_grace_cancels_orphan_end(monkeypatch) -> None:
    """A brief Wi-Fi/WebSocket drop must not hang up an active counselor call."""

    call_id = f"orphan-reconnect-{uuid4()}"
    _register_call(call_id)
    stops: list[str] = []

    async def fake_start(_active_call_id: str) -> None:
        return None

    async def fake_stop(active_call_id: str) -> bool:
        stops.append(active_call_id)
        return True

    monkeypatch.setattr(live_stt, "_ORPHAN_END_GRACE_SECONDS", 0.08)
    monkeypatch.setattr(live_stt, "start_native_wo_mic", fake_start)
    monkeypatch.setattr(live_stt, "stop_native_wo_mic", fake_stop)

    try:
        with TestClient(app) as client:
            with client.websocket_connect(
                f"/ws/ars/{call_id}?role=desktop"
            ) as desktop:
                _receive_type(desktop, "ready")
                with client.websocket_connect(
                    f"/ws/ars/{call_id}?role=mobile"
                ) as first_mobile:
                    _receive_type(first_mobile, "ready")
                    first_mobile.send_json({"type": "call_start"})
                    _receive_type(desktop, "call_start")
                    first_mobile.send_json(
                        {"type": "intake_complete", "generation": 1}
                    )
                    _receive_type(desktop, "intake_complete")
                    desktop.send_json({"type": "agent_connected", "generation": 1})
                    _receive_type(first_mobile, "agent_connected")
                    stops.clear()

                with client.websocket_connect(
                    f"/ws/ars/{call_id}?role=mobile"
                ) as reconnected:
                    _receive_type(reconnected, "ready")
                    restored = _receive_type(reconnected, "ars_state")
                    assert restored["active"] is True
                    assert restored["agent_connected"] is True
                    assert restored["generation"] == 1

                    time.sleep(0.12)
                    desktop.send_json({"type": "state_request"})
                    after_grace = _receive_type(desktop, "ars_state")
                    assert after_grace["active"] is True
                    assert after_grace["agent_connected"] is True
                    assert after_grace["generation"] == 1
                    assert stops == []

                    desktop.send_json({"type": "call_end"})
                    explicit_end = _receive_type(reconnected, "call_end")
                    assert explicit_end["generation"] == 1
                    assert explicit_end["drained"] is True
                    assert explicit_end["end_reason"] == "counselor_hangup"
                    assert explicit_end["ended_by"] == "counselor"
                    assert stops == [call_id]
    finally:
        _clear_call(call_id)


def test_stale_call_end_generation_cannot_terminate_the_next_call(
    monkeypatch,
) -> None:
    """A delayed generation-N hangup must not mutate generation N+1."""

    call_id = f"stale-end-{uuid4()}"
    _register_call(call_id)
    stops: list[str] = []

    async def fake_start(_active_call_id: str) -> None:
        return None

    async def fake_stop(active_call_id: str) -> bool:
        stops.append(active_call_id)
        return True

    monkeypatch.setattr(live_stt, "start_native_wo_mic", fake_start)
    monkeypatch.setattr(live_stt, "stop_native_wo_mic", fake_stop)

    try:
        with TestClient(app) as client:
            with (
                client.websocket_connect(
                    f"/ws/ars/{call_id}?role=desktop"
                ) as desktop,
                client.websocket_connect(
                    f"/ws/ars/{call_id}?role=mobile"
                ) as mobile,
            ):
                _receive_type(desktop, "ready")
                _receive_type(mobile, "ready")

                mobile.send_json({"type": "call_start"})
                first_start = _receive_type(desktop, "call_start")
                assert first_start["generation"] == 1
                mobile.send_json({"type": "call_end", "generation": 1})
                first_end = _receive_type(desktop, "call_end")
                assert first_end["generation"] == 1
                assert _receive_type(mobile, "call_end")["generation"] == 1

                mobile.send_json({"type": "call_start"})
                second_start = _receive_type(desktop, "call_start")
                assert second_start["generation"] == 2

                # Simulate a reconnect queue replaying the previous call's
                # counselor hangup after the next call has already started.
                desktop.send_json({"type": "call_end", "generation": 1})
                rejected = _receive_type(desktop, "ars_state")
                assert rejected["active"] is True
                assert rejected["generation"] == 2
                assert rejected["end_reason"] is None
                assert rejected["ended_by"] is None
                assert stops == [call_id]

                desktop.send_json({"type": "call_end", "generation": 2})
                current_end = _receive_type(mobile, "call_end")
                assert current_end["generation"] == 2
                assert current_end["end_reason"] == "counselor_hangup"
                assert current_end["ended_by"] == "counselor"
                assert stops == [call_id, call_id]
    finally:
        _clear_call(call_id)
