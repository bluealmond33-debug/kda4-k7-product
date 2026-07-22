"""voice_anger 어댑터 테스트 — torch/transformers 없이 폴백·매핑을 검증한다.

WavLM 런타임은 lazy import라 이 테스트들은 무거운 의존성 없이 돈다. 지금 워크트리에는
.pt 체크포인트가 없으므로, WAV 입력의 실경로가 곧 'graceful fallback → None'을 탄다.
"""

import io
import wave

from app.schemas import AnalysisSource, VoiceAngerResult
from app.services.voice_anger import (
    _is_wav,
    _voice_anger_result_from_prediction,
    analyze_voice_anger,
)


def _wav_bytes(sample_rate: int = 16_000, num_samples: int = 1_600) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(b"\x00\x00" * num_samples)  # 16-bit PCM 무음
    return buffer.getvalue()


RUNTIME_PREDICTION = {
    "status": "completed",
    "model_version": "wavlm-base-plus-layer-stats-fusion-v1",
    "model_id": "microsoft/wavlm-base-plus",
    "anger_probability": 0.61,
    "anger_score": 61.0,
    "anger_detected": True,
    "anger_level": "elevated",
    "threshold": 0.43,
    "probability_calibrated": False,
    "audio_duration_seconds": 2.0,
    "usage_restriction": "support signal only; excluded from S/G/E routing and counselor assignment",
}


def test_is_wav_detects_riff_wave_header():
    assert _is_wav(_wav_bytes()) is True
    assert _is_wav("고객이 화가 났습니다".encode("utf-8")) is False
    assert _is_wav(b"") is False


def test_non_wav_input_returns_none_without_loading_model():
    # 텍스트 바이트(오디오 아님) → 모델 로드 시도조차 없이 None
    assert analyze_voice_anger("이건 오디오가 아니라 텍스트입니다".encode("utf-8")) is None


def test_missing_model_or_deps_falls_back_to_none():
    # 기본 경로에 .pt 없음(또는 torch 미설치) → graceful fallback(None). 부스터는 무동작.
    assert analyze_voice_anger(_wav_bytes()) is None


def test_prediction_maps_to_voice_anger_result():
    result = _voice_anger_result_from_prediction(RUNTIME_PREDICTION)

    assert isinstance(result, VoiceAngerResult)
    assert result.detected is True
    assert result.probability == 0.61
    assert result.threshold == 0.43
    assert result.probability_calibrated is False
    assert result.confidence is None  # 런타임이 confidence를 안 냄
    assert result.analysis_source == AnalysisSource.REAL_MODEL
    assert result.model_version == "wavlm-base-plus-layer-stats-fusion-v1"


def test_prediction_maps_not_detected_case():
    prediction = {**RUNTIME_PREDICTION, "anger_detected": False, "anger_probability": 0.12}
    result = _voice_anger_result_from_prediction(prediction)

    assert result.detected is False
    assert result.probability == 0.12
