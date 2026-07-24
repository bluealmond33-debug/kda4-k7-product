import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import live_stt
from app.main import app


def _register(client: TestClient, call_id: str) -> None:
    response = client.post("/api/live-stt/calls", json={"call_id": call_id})
    assert response.status_code == 201


def _clear(call_id: str) -> None:
    live_stt._demo_clients.pop(call_id, None)
    live_stt._demo_replay_states.pop(call_id, None)
    live_stt._demo_locks.pop(call_id, None)
    live_stt._sessions.pop(call_id, None)
    live_stt._ars_states.pop(call_id, None)
    live_stt._registered_call_ids.discard(call_id)


def _envelope(
    event_type: str,
    payload: dict,
    *,
    seq: int = 1,
    source: str = "counselor",
) -> dict:
    return {
        "v": 1,
        "type": event_type,
        "payload": payload,
        "ts": 1_720_000_000_123,
        "seq": seq,
        "source": source,
    }


def test_demo_relay_broadcasts_with_echo_and_isolates_registered_calls() -> None:
    first_call = f"demo-relay-{uuid4()}"
    second_call = f"demo-relay-{uuid4()}"
    try:
        with TestClient(app) as client:
            _register(client, first_call)
            _register(client, second_call)
            with (
                client.websocket_connect(
                    f"/ws/demo/{first_call}?role=employee"
                ) as employee,
                client.websocket_connect(
                    f"/ws/demo/{first_call}?role=admin"
                ) as first_admin,
                client.websocket_connect(
                    f"/ws/demo/{second_call}?role=admin"
                ) as second_admin,
            ):
                for socket, role in (
                    (employee, "employee"),
                    (first_admin, "admin"),
                    (second_admin, "admin"),
                ):
                    ready = socket.receive_json()
                    assert ready["type"] == "ready"
                    assert ready["channel"] == "demo"
                    assert ready["role"] == role
                    assert ready["protocol_version"] == 1
                    assert ready["max_event_bytes"] == live_stt._MAX_DEMO_EVENT_BYTES

                incoming = _envelope(
                    "call.incoming",
                    {"callId": first_call, "kind": "normal", "generation": 1},
                )
                employee.send_json(incoming)
                assert employee.receive_json() == incoming
                assert first_admin.receive_json() == incoming

                reset = _envelope(
                    "demo.reset", {}, source="admin"
                )
                second_admin.send_json(reset)
                assert second_admin.receive_json() == reset

                utterance = _envelope(
                    "stt.utterance",
                    {
                        "callId": first_call,
                        "text": "실제 고객 발화",
                        "isFinal": True,
                        "atMs": 500,
                        "speaker": "customer",
                        "generation": 1,
                        "audioSeq": 3,
                    },
                    seq=2,
                )
                employee.send_json(utterance)
                assert employee.receive_json() == utterance
                # If cross-call leakage occurred, reset would arrive here first.
                assert first_admin.receive_json() == utterance
    finally:
        _clear(first_call)
        _clear(second_call)


def test_new_admin_receives_exact_bounded_materialized_replay() -> None:
    call_id = f"demo-replay-{uuid4()}"
    incoming = _envelope(
        "call.incoming",
        {"callId": call_id, "kind": "urgent", "generation": 1},
        seq=1,
    )
    utterance = _envelope(
        "stt.utterance",
        {
            "callId": call_id,
            "text": "카드를 분실했습니다",
            "isFinal": True,
            "atMs": 100,
            "speaker": "customer",
            "generation": 1,
            "audioSeq": 1,
        },
        seq=2,
    )
    stage_start = _envelope(
        "pipeline.stage",
        {"callId": call_id, "stage": "classify", "status": "start"},
        seq=3,
    )
    stage_done = _envelope(
        "pipeline.stage",
        {"callId": call_id, "stage": "classify", "status": "done"},
        seq=4,
    )
    card = _envelope(
        "card.created",
        {
            "callId": call_id,
            "summary": "카드 분실 문의",
            "businessType": "카드 문의",
            "department": "카드·결제",
            "routingReason": "카드 분실 표현",
            "incidentRisk": "low",
            "riskReason": None,
            "confidence": 0.9,
            "emotionLevel": None,
            "source": "backend",
        },
        seq=5,
    )
    routing = _envelope(
        "routing.assigned",
        {
            "callId": call_id,
            "department": "카드·결제",
            "sge": "G",
            "confidence": 0.9,
            "risk": "low",
        },
        seq=6,
    )
    sent = [incoming, utterance, stage_start, stage_done, card, routing]
    expected_replay = [incoming, utterance, stage_done, card, routing]

    try:
        with TestClient(app) as client:
            _register(client, call_id)
            with client.websocket_connect(
                f"/ws/demo/{call_id}?role=employee"
            ) as employee:
                assert employee.receive_json()["replay_count"] == 0
                for envelope in sent:
                    employee.send_json(envelope)
                    assert employee.receive_json() == envelope

            # A new admin starts empty, then reconstructs state from original
            # envelopes. The obsolete stage=start is compacted to latest=done.
            with client.websocket_connect(
                f"/ws/demo/{call_id}?role=admin"
            ) as admin:
                ready = admin.receive_json()
                assert ready["replay_count"] == len(expected_replay)
                replayed = [
                    admin.receive_json() for _ in range(ready["replay_count"])
                ]
                assert replayed == expected_replay

            # Reconnect replay is byte-semantically identical, allowing the
            # frontend stable-envelope key to suppress duplicate reducer work.
            with client.websocket_connect(
                f"/ws/demo/{call_id}?role=admin"
            ) as reconnected:
                ready = reconnected.receive_json()
                replayed_again = [
                    reconnected.receive_json() for _ in range(ready["replay_count"])
                ]
                assert replayed_again == expected_replay
    finally:
        _clear(call_id)


def test_demo_replay_is_bounded_and_new_incoming_resets_previous_generation(
    monkeypatch,
) -> None:
    monkeypatch.setattr(live_stt, "_MAX_DEMO_REPLAY_UTTERANCES", 3)
    state = live_stt._DemoReplayState()
    call_id = "demo1"
    first_incoming = _envelope(
        "call.incoming",
        {"callId": call_id, "kind": "normal", "generation": 1},
    )
    assert state.record(first_incoming)
    for index in range(5):
        assert state.record(
            _envelope(
                "stt.utterance",
                {
                    "callId": call_id,
                    "text": f"발화 {index}",
                    "isFinal": True,
                    "atMs": index,
                    "generation": 1,
                    "audioSeq": index + 1,
                },
                seq=index + 2,
            )
        )
    replay = state.replay()
    assert replay[0] == first_incoming
    assert [item["payload"]["text"] for item in replay[1:]] == [
        "발화 2",
        "발화 3",
        "발화 4",
    ]

    duplicate_active_incoming = _envelope(
        "call.incoming",
        {"callId": call_id, "kind": "normal", "generation": 1},
        seq=9,
    )
    assert state.record(duplicate_active_incoming) is False
    assert [item["payload"].get("text") for item in state.replay()[1:]] == [
        "발화 2",
        "발화 3",
        "발화 4",
    ]

    second_incoming = _envelope(
        "call.incoming",
        {"callId": call_id, "kind": "normal", "generation": 2},
        seq=10,
    )
    assert state.record(second_incoming)
    assert state.replay() == [second_incoming]


def test_customer_role_is_receive_only_and_never_sees_internal_card_risk_routing() -> None:
    call_id = f"demo-role-filter-{uuid4()}"
    try:
        with TestClient(app) as client:
            _register(client, call_id)
            with (
                client.websocket_connect(
                    f"/ws/demo/{call_id}?role=employee"
                ) as employee,
                client.websocket_connect(
                    f"/ws/demo/{call_id}?role=admin"
                ) as admin,
                client.websocket_connect(
                    f"/ws/demo/{call_id}?role=customer"
                ) as customer,
            ):
                employee.receive_json()
                admin.receive_json()
                customer.receive_json()
                events = [
                    _envelope(
                        "call.incoming",
                        {"callId": call_id, "kind": "urgent", "generation": 1},
                        seq=1,
                    ),
                    _envelope(
                        "stt.utterance",
                        {
                            "callId": call_id,
                            "text": "모르는 결제가 있습니다",
                            "isFinal": True,
                            "atMs": 10,
                        },
                        seq=2,
                    ),
                    _envelope(
                        "pipeline.stage",
                        {"callId": call_id, "stage": "risk", "status": "done"},
                        seq=3,
                    ),
                    _envelope(
                        "card.created",
                        {
                            "callId": call_id,
                            "summary": "미승인 결제 신고",
                            "businessType": "금융사고",
                            "department": "사고·신고",
                            "routingReason": "긴급 게이트",
                            "incidentRisk": "high",
                            "riskReason": "미승인 결제",
                            "confidence": 0.99,
                            "emotionLevel": None,
                            "source": "backend",
                        },
                        seq=4,
                    ),
                    _envelope(
                        "routing.assigned",
                        {
                            "callId": call_id,
                            "department": "사고·신고",
                            "sge": "E",
                            "confidence": 0.99,
                            "risk": "high",
                        },
                        seq=5,
                    ),
                    _envelope(
                        "call.ended",
                        {"callId": call_id, "generation": 1},
                        seq=6,
                    ),
                ]
                for envelope in events:
                    employee.send_json(envelope)
                    assert employee.receive_json() == envelope
                    assert admin.receive_json() == envelope

                # Customer receives public lifecycle/STT only. If any internal
                # event leaked, it would appear before call.ended here.
                assert customer.receive_json() == events[0]
                assert customer.receive_json() == events[1]
                assert customer.receive_json() == events[5]

                customer.send_json(
                    _envelope(
                        "call.incoming",
                        {"callId": call_id, "kind": "normal"},
                    )
                )
                rejected = customer.receive_json()
                assert rejected["type"] == "demo_error"
                assert "receive-only" in rejected["message"]

            with client.websocket_connect(
                f"/ws/demo/{call_id}?role=customer"
            ) as reloaded_customer:
                ready = reloaded_customer.receive_json()
                assert ready["replay_count"] == 3
                assert [
                    reloaded_customer.receive_json()["type"]
                    for _ in range(ready["replay_count"])
                ] == ["call.incoming", "stt.utterance", "call.ended"]
    finally:
        _clear(call_id)


def test_demo_relay_rejects_invalid_messages_without_broadcasting_them() -> None:
    call_id = f"demo-validate-{uuid4()}"
    try:
        with TestClient(app) as client:
            _register(client, call_id)
            with (
                client.websocket_connect(
                    f"/ws/demo/{call_id}?role=employee"
                ) as employee,
                client.websocket_connect(
                    f"/ws/demo/{call_id}?role=admin"
                ) as admin,
            ):
                employee.receive_json()
                admin.receive_json()

                employee.send_json(
                    _envelope("unknown.event", {"callId": call_id})
                )
                assert employee.receive_json()["code"] == "invalid_envelope"

                employee.send_json(
                    _envelope(
                        "call.incoming",
                        {"callId": "different-call", "kind": "normal"},
                    )
                )
                mismatch = employee.receive_json()
                assert mismatch["code"] == "invalid_envelope"
                assert "must match" in mismatch["message"]

                employee.send_json(
                    _envelope(
                        "call.incoming",
                        {"callId": call_id, "kind": "normal", "extra": True},
                    )
                )
                assert employee.receive_json()["code"] == "invalid_envelope"

                employee.send_json(
                    _envelope(
                        "call.incoming",
                        {"callId": call_id, "kind": "normal"},
                        source="admin",
                    )
                )
                assert employee.receive_json()["code"] == "invalid_envelope"

                employee.send_json(
                    _envelope("demo.reset", {}, source="counselor")
                )
                assert employee.receive_json()["code"] == "invalid_envelope"

                # Invalid events do not consume seq and never reach the peer.
                valid = _envelope(
                    "call.incoming", {"callId": call_id, "kind": "urgent"}
                )
                employee.send_json(valid)
                assert employee.receive_json() == valid
                assert admin.receive_json() == valid

                employee.send_json(valid)
                duplicate = employee.receive_json()
                assert duplicate["code"] == "invalid_envelope"
                assert "seq must increase" in duplicate["message"]

                next_valid = _envelope(
                    "pipeline.stage",
                    {"callId": call_id, "stage": "stt", "status": "done"},
                    seq=2,
                )
                employee.send_json(next_valid)
                assert employee.receive_json() == next_valid
                # A rejected duplicate was not broadcast ahead of this event.
                assert admin.receive_json() == next_valid

                duplicate_json = (
                    '{"v":1,"v":1,"type":"demo.reset","payload":{},'
                    '"ts":1,"seq":3,"source":"counselor"}'
                )
                employee.send_text(duplicate_json)
                assert employee.receive_json()["code"] == "invalid_json"
    finally:
        _clear(call_id)


def test_demo_relay_policy_and_size_closes_are_explicit() -> None:
    call_id = f"demo-policy-{uuid4()}"
    try:
        with TestClient(app) as client:
            with client.websocket_connect(
                f"/ws/demo/{call_id}?role=admin"
            ) as unregistered:
                with pytest.raises(WebSocketDisconnect) as rejected:
                    unregistered.receive_json()
                assert rejected.value.code == 1008

            _register(client, call_id)
            with client.websocket_connect(
                f"/ws/demo/{call_id}?role=unknown"
            ) as bad_role:
                with pytest.raises(WebSocketDisconnect) as rejected:
                    bad_role.receive_json()
                assert rejected.value.code == 1008

            with client.websocket_connect(
                f"/ws/demo/{call_id}?role=admin"
            ) as admin:
                admin.receive_json()
                admin.send_text("x" * (live_stt._MAX_DEMO_EVENT_BYTES + 1))
                with pytest.raises(WebSocketDisconnect) as too_large:
                    admin.receive_json()
                assert too_large.value.code == 1009
    finally:
        _clear(call_id)


@pytest.mark.parametrize(
    ("event_type", "payload"),
    [
        ("call.incoming", {"kind": "transfer", "generation": 2}),
        (
            "stt.utterance",
            {"text": "발화", "isFinal": True, "atMs": 1, "speaker": "agent"},
        ),
        ("pipeline.stage", {"stage": "rag", "status": "skip", "detail": "없음"}),
        (
            "card.created",
            {
                "summary": "요약",
                "businessType": "카드 문의",
                "department": "카드·결제",
                "routingReason": "카드 표현",
                "incidentRisk": "low",
                "riskReason": None,
                "confidence": 0.9,
                "emotionLevel": None,
                "source": "backend",
            },
        ),
        (
            "routing.assigned",
            {"department": "카드·결제", "sge": "G", "confidence": None, "risk": "low"},
        ),
        ("transfer.requested", {"toDept": "사고·신고", "mode": "reserve"}),
        ("transfer.completed", {"toDept": "사고·신고"}),
        ("call.ended", {"wrapType": "완료", "generation": 2}),
        ("queue.snapshot", {"queues": [{"dept": "카드·결제", "s": 1, "g": 2, "e": 0}]}),
        ("demo.reset", {}),
    ],
)
def test_all_demo_event_payload_contracts_accept_valid_shapes(
    event_type: str, payload: dict
) -> None:
    call_id = "demo1"
    if event_type not in {"queue.snapshot", "demo.reset"}:
        payload = {"callId": call_id, **payload}
    envelope = _envelope(event_type, payload, source="admin")
    assert live_stt._validate_demo_envelope(
        envelope, call_id, "admin", 0
    ) == envelope
