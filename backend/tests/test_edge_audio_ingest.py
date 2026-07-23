import asyncio
import time
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import live_stt
from app.main import app


def _receive_type(socket, expected: str) -> dict:
    for _ in range(100):
        message = socket.receive_json()
        if message.get("type") == "error":
            raise AssertionError(message.get("message", "unexpected live STT error"))
        if message.get("type") == expected:
            return message
    raise AssertionError(f"did not receive websocket event {expected!r}")


def _receive_types(socket, expected: set[str]) -> dict[str, dict]:
    found: dict[str, dict] = {}
    for _ in range(100):
        message = socket.receive_json()
        event_type = str(message.get("type", ""))
        if event_type == "error":
            raise AssertionError(message.get("message", "unexpected live STT error"))
        if event_type in expected:
            found[event_type] = message
            if found.keys() >= expected:
                return found
    raise AssertionError(f"did not receive websocket events {expected - found.keys()}")


def _wait_until(predicate, timeout: float = 1.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("condition was not reached before timeout")


def _register_call(client: TestClient, call_id: str) -> None:
    response = client.post("/api/live-stt/calls", json={"call_id": call_id})
    assert response.status_code == 201
    assert response.json()["call_id"] == call_id


def _clear_call(call_id: str) -> None:
    orphan = live_stt._orphan_end_tasks.pop(call_id, None)
    if orphan is not None:
        orphan.cancel()
    native = live_stt._native_tasks.pop(call_id, None)
    if native is not None:
        native.cancel()
    live_stt._native_stop_events.pop(call_id, None)
    live_stt._audio_clients.pop(call_id, None)
    live_stt._ars_clients.pop(call_id, None)
    live_stt._ars_states.pop(call_id, None)
    live_stt._sessions.pop(call_id, None)
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


def _pcm(sample: int, sample_count: int) -> bytes:
    return sample.to_bytes(2, "little", signed=True) * sample_count


def _frame(
    generation: int,
    audio_seq: int,
    captured_at_ms: int,
    pcm: bytes,
) -> bytes:
    return live_stt._EDGE_FRAME_HEADER.pack(
        live_stt._EDGE_FRAME_MAGIC,
        generation,
        audio_seq,
        captured_at_ms,
    ) + pcm


def test_k7a1_canonical_binary_vector() -> None:
    packet = _frame(1, 1, 1_720_000_000_123, _pcm(900, 1))
    assert packet.hex() == (
        "4b3741310000000100000000000000010000019077fd307b8403"
    )
    decoded = live_stt._parse_edge_audio_frame(packet)
    assert decoded.generation == 1
    assert decoded.audio_seq == 1
    assert decoded.captured_at_ms == 1_720_000_000_123
    assert decoded.pcm == _pcm(900, 1)


def test_edge_mode_gates_each_speaker_and_never_opens_native_capture(
    monkeypatch,
) -> None:
    call_id = f"edge-gate-{uuid4()}"
    native_calls: list[str] = []

    async def forbidden_native(active_call_id: str) -> None:
        native_calls.append(active_call_id)
        raise AssertionError("edge mode must not open native capture")

    async def forbidden_native_stop(active_call_id: str) -> bool:
        native_calls.append(active_call_id)
        raise AssertionError("edge mode must not stop native capture")

    monkeypatch.setenv("K7_AUDIO_CAPTURE_MODE", "edge")
    monkeypatch.setattr(live_stt, "start_native_wo_mic", forbidden_native)
    monkeypatch.setattr(live_stt, "stop_native_wo_mic", forbidden_native_stop)
    monkeypatch.setattr(
        live_stt,
        "_transcribe_pcm",
        lambda pcm: "고객 문의"
        if int.from_bytes(pcm[:2], "little", signed=True) == 900
        else "상담원 안내",
    )

    full_customer = _pcm(900, live_stt._MAX_UTTERANCE_BYTES // 2)
    full_agent = _pcm(1200, live_stt._MAX_UTTERANCE_BYTES // 2)

    try:
        with TestClient(app) as client:
            _register_call(client, call_id)
            with (
                client.websocket_connect(f"/ws/ars/{call_id}?role=desktop") as desktop,
                client.websocket_connect(f"/ws/ars/{call_id}?role=mobile") as mobile,
                client.websocket_connect(f"/ws/call/{call_id}?role=agent") as observer,
                client.websocket_connect(
                    f"/ws/audio/{call_id}?speaker=customer"
                ) as customer_audio,
                client.websocket_connect(
                    f"/ws/audio/{call_id}?speaker=agent"
                ) as agent_audio,
            ):
                _receive_type(desktop, "ready")
                _receive_type(mobile, "ready")
                _receive_type(observer, "ready")
                customer_ready = _receive_type(customer_audio, "ready")
                customer_gate = _receive_type(customer_audio, "audio_gate")
                agent_ready = _receive_type(agent_audio, "ready")
                agent_gate = _receive_type(agent_audio, "audio_gate")
                assert customer_ready["frame_format"]["header_bytes"] == 24
                assert customer_ready["legacy_raw_supported"] is True
                assert customer_gate["allowed"] is False
                assert agent_gate["allowed"] is False
                assert agent_ready["speaker"] == "agent"

                # Frames sent before call_start have no active generation and
                # cannot contaminate either speaker buffer.
                customer_audio.send_bytes(_frame(1, 1, 100, _pcm(900, 800)))
                agent_audio.send_bytes(_frame(1, 1, 101, _pcm(1200, 800)))
                assert _receive_type(customer_audio, "frame_rejected")["code"] == (
                    "stale_generation"
                )
                assert _receive_type(agent_audio, "frame_rejected")["code"] == (
                    "stale_generation"
                )
                session = live_stt._sessions[call_id]
                assert not session.speaker_buffers["customer"].audio
                assert not session.speaker_buffers["agent"].audio

                mobile.send_json({"type": "call_start"})
                started = _receive_type(desktop, "call_start")
                assert started["generation"] == 1
                assert _receive_type(customer_audio, "audio_gate")["allowed"] is True
                assert _receive_type(agent_audio, "audio_gate")["allowed"] is False

                # Agent sequence 1 is validly framed but lifecycle-gated. Its
                # next admitted frame must therefore advance to sequence 2.
                agent_audio.send_bytes(_frame(1, 1, 1_000, full_agent))
                time.sleep(0.05)
                assert session.seq == 0
                assert not session.speaker_buffers["agent"].audio

                customer_audio.send_bytes(_frame(1, 1, 1_100, full_customer))
                customer_events = _receive_types(
                    observer, {"capture_status", "level", "transcript"}
                )
                customer_transcript = customer_events["transcript"]
                assert customer_transcript["speaker"] == "customer"
                assert customer_transcript["text"] == "고객 문의"
                assert customer_transcript["generation"] == 1
                assert customer_transcript["seq"] == 1
                assert customer_transcript["audio_seq"] == 1
                assert customer_transcript["at"] == 1_100

                mobile.send_json(
                    {"type": "intake_complete", "generation": started["generation"]}
                )
                intake = _receive_type(desktop, "intake_complete")
                assert intake["drained"] is True
                assert _receive_type(customer_audio, "audio_gate")["allowed"] is False
                assert _receive_type(agent_audio, "audio_gate")["allowed"] is False

                desktop.send_json(
                    {"type": "agent_connected", "generation": started["generation"]}
                )
                connected = _receive_type(mobile, "agent_connected")
                assert connected["generation"] == 1
                assert _receive_type(customer_audio, "audio_gate")["allowed"] is True
                assert _receive_type(agent_audio, "audio_gate")["allowed"] is True

                agent_audio.send_bytes(_frame(1, 2, 1_200, full_agent))
                agent_transcript = _receive_type(observer, "transcript")
                assert agent_transcript["speaker"] == "agent"
                assert agent_transcript["text"] == "상담원 안내"
                assert agent_transcript["audio_seq"] == 2
                assert agent_transcript["at"] == 1_200

                desktop.send_json({"type": "call_end", "generation": 1})
                ended = _receive_type(mobile, "call_end")
                assert ended["drained"] is True
                assert ended["final_seq"] == 2
                assert native_calls == []
    finally:
        _clear_call(call_id)


def test_tail_drain_is_ordered_by_source_capture_time_and_redial_drops_stale_frame(
    monkeypatch,
) -> None:
    call_id = f"edge-tail-{uuid4()}"
    monkeypatch.setenv("K7_AUDIO_CAPTURE_MODE", "edge")
    monkeypatch.setattr(
        live_stt,
        "_transcribe_pcm",
        lambda pcm: "고객 마지막 발화"
        if int.from_bytes(pcm[:2], "little", signed=True) == 900
        else "상담원 마지막 안내",
    )

    try:
        with TestClient(app) as client:
            _register_call(client, call_id)
            with (
                client.websocket_connect(f"/ws/ars/{call_id}?role=desktop") as desktop,
                client.websocket_connect(f"/ws/ars/{call_id}?role=mobile") as mobile,
                client.websocket_connect(f"/ws/call/{call_id}?role=agent") as observer,
                client.websocket_connect(
                    f"/ws/audio/{call_id}?speaker=customer"
                ) as customer_audio,
                client.websocket_connect(
                    f"/ws/audio/{call_id}?speaker=agent"
                ) as agent_audio,
            ):
                for socket in (desktop, mobile, observer, customer_audio, agent_audio):
                    _receive_type(socket, "ready")
                _receive_type(customer_audio, "audio_gate")
                _receive_type(agent_audio, "audio_gate")

                mobile.send_json({"type": "call_start"})
                _receive_type(desktop, "call_start")
                _receive_type(customer_audio, "audio_gate")
                _receive_type(agent_audio, "audio_gate")
                session = live_stt._sessions[call_id]

                # Intake tail keeps the source packet identity.
                customer_audio.send_bytes(_frame(1, 1, 1_000, _pcm(900, 800)))
                _wait_until(lambda: session.speaker_buffers["customer"].speech_seen)
                mobile.send_json({"type": "intake_complete", "generation": 1})
                intake = _receive_type(desktop, "intake_complete")
                assert intake["final_seq"] == 1
                intake_transcript = _receive_type(observer, "transcript")
                assert intake_transcript["audio_seq"] == 1
                assert intake_transcript["at"] == 1_000

                desktop.send_json({"type": "agent_connected", "generation": 1})
                _receive_type(mobile, "agent_connected")
                _receive_type(customer_audio, "audio_gate")
                _receive_type(agent_audio, "audio_gate")

                # Although customer is sent first, the agent's source capture
                # timestamp is earlier; the final dialogue must reflect that.
                customer_audio.send_bytes(_frame(1, 2, 3_000, _pcm(900, 800)))
                agent_audio.send_bytes(_frame(1, 1, 2_000, _pcm(1200, 800)))
                _wait_until(
                    lambda: session.speaker_buffers["customer"].speech_seen
                    and session.speaker_buffers["agent"].speech_seen
                )
                mobile.send_json({"type": "call_end", "generation": 1})
                ended = _receive_type(desktop, "call_end")
                assert ended["final_seq"] == 3
                first = _receive_type(observer, "transcript")
                second = _receive_type(observer, "transcript")
                assert [(first["speaker"], first["audio_seq"], first["at"]), (
                    second["speaker"], second["audio_seq"], second["at"]
                )] == [("agent", 1, 2_000), ("customer", 2, 3_000)]

                mobile.send_json({"type": "call_start"})
                restarted = _receive_type(desktop, "call_start")
                assert restarted["generation"] == 2
                _receive_type(customer_audio, "audio_gate")
                _receive_type(agent_audio, "audio_gate")
                assert session.seq == 0
                assert session.history == []

                # A packet queued by call 1 is rejected after the immediate
                # redial; only a correctly framed generation-2 packet enters.
                customer_audio.send_bytes(_frame(1, 3, 3_100, _pcm(900, 800)))
                rejected = _receive_type(customer_audio, "frame_rejected")
                assert rejected["code"] == "stale_generation"
                assert not session.speaker_buffers["customer"].audio
                customer_audio.send_bytes(
                    _frame(
                        2,
                        1,
                        4_000,
                        _pcm(900, live_stt._MAX_UTTERANCE_BYTES // 2),
                    )
                )
                accepted = _receive_type(observer, "transcript")
                assert accepted["generation"] == 2
                assert accepted["audio_seq"] == 1
                assert accepted["at"] == 4_000
                mobile.send_json({"type": "call_end", "generation": 2})
                _receive_type(desktop, "call_end")
    finally:
        _clear_call(call_id)


def test_legacy_raw_sender_must_rebind_after_redial(monkeypatch) -> None:
    call_id = f"edge-legacy-{uuid4()}"
    monkeypatch.setenv("K7_AUDIO_CAPTURE_MODE", "edge")
    monkeypatch.setattr(live_stt, "_transcribe_pcm", lambda _pcm: "레거시 발화")
    full = _pcm(900, live_stt._MAX_UTTERANCE_BYTES // 2)

    try:
        with TestClient(app) as client:
            _register_call(client, call_id)
            with (
                client.websocket_connect(f"/ws/ars/{call_id}?role=mobile") as mobile,
                client.websocket_connect(f"/ws/call/{call_id}?role=agent") as observer,
                client.websocket_connect(
                    f"/ws/audio/{call_id}?speaker=customer"
                ) as audio,
            ):
                _receive_type(mobile, "ready")
                _receive_type(observer, "ready")
                _receive_type(audio, "ready")
                _receive_type(audio, "audio_gate")
                mobile.send_json({"type": "call_start"})
                _receive_type(audio, "audio_gate")
                audio.send_bytes(full)
                assert _receive_type(observer, "transcript")["generation"] == 1
                mobile.send_json({"type": "call_end", "generation": 1})
                _receive_type(mobile, "call_end")

                mobile.send_json({"type": "call_start"})
                _receive_type(audio, "audio_gate")
                audio.send_bytes(full)
                assert _receive_type(audio, "frame_rejected")["code"] == (
                    "stale_generation"
                )
                audio.send_json({"type": "bind", "generation": 2})
                assert _receive_type(audio, "bound")["generation"] == 2
                audio.send_bytes(full)
                transcript = _receive_type(observer, "transcript")
                assert transcript["generation"] == 2
                mobile.send_json({"type": "call_end", "generation": 2})
                _receive_type(mobile, "call_end")
    finally:
        _clear_call(call_id)


def test_duplicate_audio_sender_is_rejected_without_replacing_established_sender() -> None:
    call_id = f"edge-duplicate-{uuid4()}"
    try:
        with TestClient(app) as client:
            _register_call(client, call_id)
            with client.websocket_connect(
                f"/ws/audio/{call_id}?speaker=customer"
            ) as established:
                _receive_type(established, "ready")
                with pytest.raises(WebSocketDisconnect) as rejected:
                    with client.websocket_connect(
                        f"/ws/audio/{call_id}?speaker=customer"
                    ) as duplicate:
                        duplicate.receive_json()
                assert rejected.value.code == 1008
                # The original sender is still live and authoritative.
                assert _receive_type(established, "audio_gate")["speaker"] == "customer"
    finally:
        _clear_call(call_id)


def test_different_sender_identity_cannot_replace_established_sender() -> None:
    call_id = f"edge-duplicate-identity-{uuid4()}"
    try:
        with TestClient(app) as client:
            _register_call(client, call_id)
            with client.websocket_connect(
                f"/ws/audio/{call_id}?speaker=customer&sender_id=sender-a"
            ) as established:
                ready = _receive_type(established, "ready")
                assert ready["sender_id"] == "sender-a"
                assert ready["next_audio_seq"] == 1
                with pytest.raises(WebSocketDisconnect) as rejected:
                    with client.websocket_connect(
                        f"/ws/audio/{call_id}?speaker=customer&sender_id=sender-b"
                    ) as duplicate:
                        duplicate.receive_json()
                assert rejected.value.code == 1008
                assert _receive_type(established, "audio_gate")["speaker"] == "customer"
    finally:
        _clear_call(call_id)


def test_same_sender_identity_reconnects_and_resumes_audio_sequence() -> None:
    call_id = f"edge-reconnect-{uuid4()}"
    sender_id = "stable-sender-1"
    try:
        with TestClient(app) as client:
            _register_call(client, call_id)
            with (
                client.websocket_connect(f"/ws/ars/{call_id}?role=mobile") as mobile,
                client.websocket_connect(f"/ws/call/{call_id}?role=agent") as observer,
                client.websocket_connect(
                    f"/ws/audio/{call_id}?speaker=customer&sender_id={sender_id}"
                ) as established,
            ):
                _receive_type(mobile, "ready")
                _receive_type(observer, "ready")
                first_ready = _receive_type(established, "ready")
                assert first_ready["sender_id"] == sender_id
                assert first_ready["next_audio_seq"] == 1
                _receive_type(established, "audio_gate")

                mobile.send_json({"type": "call_start"})
                started = _receive_type(mobile, "call_start")
                assert started["generation"] == 1
                assert _receive_type(established, "audio_gate")["allowed"] is True

                established.send_bytes(_frame(1, 1, 1_000, _pcm(900, 800)))
                _receive_type(observer, "level")
                assert live_stt._audio_sender_sequences[
                    (call_id, "customer", sender_id)
                ] == (1, 1)

                with client.websocket_connect(
                    f"/ws/audio/{call_id}?speaker=customer&sender_id={sender_id}"
                ) as replacement:
                    replacement_ready = _receive_type(replacement, "ready")
                    assert replacement_ready["sender_id"] == sender_id
                    assert replacement_ready["generation"] == 1
                    assert replacement_ready["next_audio_seq"] == 2
                    assert _receive_type(replacement, "audio_gate")["allowed"] is True

                    with pytest.raises(WebSocketDisconnect) as replaced:
                        established.receive_json()
                    assert replaced.value.code == 1012

                    replacement.send_bytes(_frame(1, 2, 1_100, _pcm(900, 800)))
                    _receive_type(observer, "level")
                    assert live_stt._audio_sender_sequences[
                        (call_id, "customer", sender_id)
                    ] == (1, 2)
                    assert live_stt._sessions[call_id].edge_capture_devices[
                        "customer"
                    ] == "edge:customer"
    finally:
        _clear_call(call_id)


def test_malformed_sender_identity_is_rejected() -> None:
    call_id = f"edge-bad-identity-{uuid4()}"
    try:
        with TestClient(app) as client:
            _register_call(client, call_id)
            with pytest.raises(WebSocketDisconnect) as rejected:
                with client.websocket_connect(
                    f"/ws/audio/{call_id}?speaker=customer&sender_id=not%20safe"
                ) as audio:
                    audio.receive_json()
            assert rejected.value.code == 1008
    finally:
        _clear_call(call_id)


def test_old_generation_stt_task_cannot_append_to_reused_call(monkeypatch) -> None:
    call_id = f"edge-stale-task-{uuid4()}"
    session = live_stt._CallSession()
    state = live_stt._ArsState(active=True, generation=1)
    live_stt._sessions[call_id] = session
    live_stt._ars_states[call_id] = state
    monkeypatch.setattr(live_stt, "_transcribe_pcm", lambda _pcm: "이전 통화 발화")

    async def scenario() -> None:
        task = live_stt._schedule_audio_processing(
            call_id, session, _pcm(900, 800), "customer"
        )
        state.generation = 2
        live_stt._reset_call_session(session)
        await task

    try:
        asyncio.run(scenario())
        assert session.seq == 0
        assert session.history == []
    finally:
        _clear_call(call_id)
