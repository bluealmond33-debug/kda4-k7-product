import json
from pathlib import Path

from app.config import Settings
from app.pipeline import request_analysis_result, transcribe_audio


class _Segment:
    def __init__(self, text: str):
        self.text = text


class _Info:
    duration = 4.25


class _WhisperModel:
    def transcribe(self, path, **kwargs):
        assert Path(path).exists()
        assert kwargs == {"language": "ko", "vad_filter": True, "beam_size": 5}
        return iter([_Segment("제가 하지 않은"), _Segment("이체가 있어요")]), _Info()


def test_local_stt_uses_faster_whisper_adapter(monkeypatch, tmp_path) -> None:
    settings = Settings(
        pipeline_mode="local",
        local_stt_model="small",
        local_stt_model_dir=str(tmp_path),
        local_stt_device="cpu",
        local_stt_compute_type="int8",
    )
    monkeypatch.setattr(
        "app.pipeline._load_local_stt_model",
        lambda *args: _WhisperModel(),
    )

    result = transcribe_audio(settings, "customer.wav", b"RIFF-local-audio")

    assert result.text == "제가 하지 않은 이체가 있어요"
    assert result.stt_model == "faster-whisper:small"
    assert result.duration_sec == 4.25


def test_local_analysis_uses_ollama_structured_output(monkeypatch) -> None:
    expected = {
        "summary": "본인 미인지 이체 확인 요청",
        "business_type": "부정이체",
        "department": "금융사기",
        "routing_reason": "본인이 하지 않은 거래라고 진술함",
        "incident_risk": "high",
        "risk_reason": "본인 미인지 거래",
        "routing_confidence": 0.95,
    }
    captured = {}

    class _Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"message": {"content": json.dumps(expected, ensure_ascii=False)}}

    def fake_post(url, *, json, timeout):
        captured.update(url=url, body=json, timeout=timeout)
        return _Response()

    monkeypatch.setattr("app.pipeline.httpx.post", fake_post)
    settings = Settings(
        pipeline_mode="local",
        ollama_base_url="http://ollama:11434/",
        ollama_model="exaone3.5:7.8b",
        ollama_timeout_sec=45,
    )

    result = request_analysis_result(settings, "제가 하지 않은 이체가 있어요")

    assert result == expected
    assert captured["url"] == "http://ollama:11434/api/chat"
    assert captured["body"]["model"] == "exaone3.5:7.8b"
    assert captured["body"]["stream"] is False
    assert captured["body"]["format"]["additionalProperties"] is False
    assert "감정" in captured["body"]["messages"][0]["content"]
    assert captured["timeout"] == 45
