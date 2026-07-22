import io
import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.routers import mvp, pipeline
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


def test_mvp_calls_endpoint_returns_201_in_stub_mode(monkeypatch):
    monkeypatch.setattr(mvp.settings, "stub_models", True)
    # /api/v1/calls persists via save_call (needs a DB). Stub persistence so the
    # test exercises the stub analysis/card path without a database.
    monkeypatch.setattr(mvp, "save_call", lambda *a, **k: None)
    client = TestClient(app)
    files = {"audio": ("demo.wav", io.BytesIO(b"RIFFdummy"), "audio/wav")}
    r = client.post("/api/v1/calls", files=files)
    assert r.status_code == 201
    body = r.json()
    assert body["transcript"]["stt_model"] == "stub"
    assert body["consultation_card"]


def test_analyze_does_not_mask_missing_key_when_not_stub(monkeypatch):
    # 명시적 플래그 설계: stub_models=False인데 로컬모델도 키도 없으면
    # 조용히 스텁으로 가리지 말고 500을 내야 한다(오설정 은폐 방지).
    monkeypatch.setattr(pipeline.settings, "stub_models", False)
    monkeypatch.setattr(pipeline.settings, "use_local_models", False)
    monkeypatch.setattr(pipeline.settings, "openai_api_key", "")
    with pytest.raises(HTTPException) as exc:
        pipeline._analyze("고객 문의")
    assert exc.value.status_code == 500
