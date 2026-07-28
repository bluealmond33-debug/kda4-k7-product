from fastapi.testclient import TestClient

from app.main import app


def test_health_exposes_contract_and_database_state() -> None:
    with TestClient(app) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["contract_version"] == "mvp-1.1"
    assert response.json()["database"] in {"connected", "not_connected"}
    assert response.json()["pipeline_mode"] in {"cloud", "local"}
    assert response.json()["stt_provider"] in {"openai", "faster_whisper", "transformers"}
    assert response.json()["analysis_provider"] in {"openai", "ollama"}


def test_openapi_keeps_live_demo_paths_and_adds_mvp_paths() -> None:
    with TestClient(app) as client:
        paths = set(client.get("/openapi.json").json()["paths"])
    assert {
        "/stt",
        "/analyze",
        "/judge",
        "/rag",
        "/analyze-text",
        "/emotion",
        "/summarize",
        "/briefing",
        "/health",
    } <= paths
    assert "/api/v1/calls" in paths
    assert "/api/v1/calls/{call_id}/consultation-card" in paths
