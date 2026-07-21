import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.routers import pipeline
from app.schemas import GptAnalysis, RiskFlags, TranscribeResult
from app.services.stub_models import analyze_transcript_stub, transcribe_audio_stub


def test_analyze_transcript_stub_returns_valid_gptanalysis():
    result = analyze_transcript_stub("고객이 카드 분실 신고를 함")
    assert isinstance(result, GptAnalysis)
    assert result.summary
    assert result.department
    assert isinstance(result.keywords, list)
    assert isinstance(result.risk_flags, RiskFlags)


def test_transcribe_audio_stub_returns_valid_transcriberesult():
    result = transcribe_audio_stub("customer-audio.wav", b"\x00\x01")
    assert isinstance(result, TranscribeResult)
    assert result.text
    assert result.duration_sec == 0.0
    uuid.UUID(result.call_id)  # call_id는 유효한 uuid 문자열


def test_pipeline_analyze_uses_stub_and_does_not_need_openai(monkeypatch):
    monkeypatch.setattr(pipeline.settings, "stub_models", True)
    monkeypatch.setattr(pipeline.settings, "use_local_models", False)
    monkeypatch.setattr(pipeline.settings, "openai_api_key", "")
    result = pipeline._analyze("고객 문의")  # 키 없어도 예외 없이 스텁 반환
    assert isinstance(result, GptAnalysis)


def test_analyze_text_endpoint_returns_200_in_stub_mode(monkeypatch):
    monkeypatch.setattr(pipeline.settings, "stub_models", True)
    client = TestClient(app)
    r = client.post("/analyze-text", json={"text": "카드 분실 신고합니다", "average_volume": 0})
    assert r.status_code == 200
    body = r.json()
    assert body["summary"]
    assert body["category"]
