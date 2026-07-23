import re

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import live_stt
from app.main import app


def test_server_allocates_unique_url_safe_call_ids(monkeypatch) -> None:
    monkeypatch.setenv("K7_AUDIO_CAPTURE_MODE", "edge")
    created: list[str] = []
    try:
        with TestClient(app) as client:
            first = client.post("/api/live-stt/calls")
            second = client.post("/api/live-stt/calls")

        assert first.status_code == 201
        assert second.status_code == 201
        first_body = first.json()
        second_body = second.json()
        created = [first_body["call_id"], second_body["call_id"]]
        assert created[0] != created[1]
        assert all(re.fullmatch(r"[A-Za-z0-9_-]{12,32}", value) for value in created)
        assert first_body["generation"] == 0
        assert first_body["audio_capture_mode"] == "edge"
        assert all(call_id in live_stt._sessions for call_id in created)
        assert all(call_id in live_stt._ars_states for call_id in created)
    finally:
        for call_id in created:
            live_stt._sessions.pop(call_id, None)
            live_stt._ars_states.pop(call_id, None)
            live_stt._registered_call_ids.discard(call_id)


def test_requested_call_id_registration_is_idempotent_and_blocks_phantoms() -> None:
    call_id = "demo1"
    try:
        with TestClient(app) as client:
            with pytest.raises(WebSocketDisconnect) as rejected:
                with client.websocket_connect(
                    f"/ws/ars/{call_id}?role=mobile"
                ) as socket:
                    socket.receive_json()
            assert rejected.value.code == 1008
            assert call_id not in live_stt._sessions
            assert call_id not in live_stt._ars_states

            first = client.post("/api/live-stt/calls", json={"call_id": call_id})
            state = live_stt._ars_states[call_id]
            second = client.post("/api/live-stt/calls", json={"call_id": call_id})
            assert first.status_code == 201
            assert second.status_code == 201
            assert second.json()["call_id"] == call_id
            assert live_stt._ars_states[call_id] is state

            invalid = client.post(
                "/api/live-stt/calls", json={"call_id": "bad/id?query"}
            )
            assert invalid.status_code == 422
    finally:
        live_stt._sessions.pop(call_id, None)
        live_stt._ars_states.pop(call_id, None)
        live_stt._registered_call_ids.discard(call_id)


@pytest.mark.parametrize(
    "origin",
    [
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://[::1]:5174",
        "http://10.0.0.12:5173",
        "http://172.16.0.4:5173",
        "http://172.31.255.254:5173",
        "http://192.168.137.1:5173",
    ],
)
def test_rfc1918_lan_origins_pass_cors_preflight(origin: str) -> None:
    with TestClient(app) as client:
        response = client.options(
            "/api/live-stt/calls",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
