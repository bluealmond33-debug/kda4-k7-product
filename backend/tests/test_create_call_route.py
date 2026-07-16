import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.contracts import MvpCallResponse, TranscriptResult
from app.main import app


ROOT = Path(__file__).resolve().parents[2]


def test_post_route_passes_existing_pipeline_results_to_integration_service(
    monkeypatch,
) -> None:
    expected = MvpCallResponse.model_validate(
        json.loads(
            (ROOT / "database/contracts/examples/mvp_call_response.example.json").read_text(
                encoding="utf-8"
            )
        )
    )
    transcript = TranscriptResult(
        text="주택담보대출 만기 연장을 문의합니다.",
        stt_model="route-test-stt",
        duration_sec=2.1,
    )
    raw = {
        "summary": "대출 만기 연장 문의",
        "task_category": "대출",
        "consulting_situation": "만기 연장 문의",
        "qa_topic": "주택담보대출 만기 연장",
    }
    calls = {"stt": 0, "analysis": 0, "persist": 0}

    def fake_stt(_settings, filename, audio_bytes):
        calls["stt"] += 1
        assert filename == "customer.wav"
        assert audio_bytes == b"RIFF-test-audio"
        return transcript

    def fake_analysis(_settings, text):
        calls["analysis"] += 1
        assert text == transcript.text
        return raw

    def fake_persist(_settings, **kwargs):
        calls["persist"] += 1
        assert kwargs == {
            "audio_filename": "customer.wav",
            "transcript": transcript,
            "raw_model_result": raw,
        }
        return expected

    monkeypatch.setattr("app.main.transcribe_audio", fake_stt)
    monkeypatch.setattr("app.main.request_analysis_result", fake_analysis)
    monkeypatch.setattr("app.main.persist_pipeline_result", fake_persist)

    with TestClient(app) as client:
        response = client.post(
            "/api/v1/calls",
            files={"audio": ("customer.wav", b"RIFF-test-audio", "audio/wav")},
        )

    assert response.status_code == 201
    assert response.json()["call_id"] == str(expected.call_id)
    assert calls == {"stt": 1, "analysis": 1, "persist": 1}
