"""온프레미스 모델(로컬 STT/로컬 LLM) 통합 테스트.

무거운 리소스(GPU, Ollama 서버, 모델 다운로드)가 필요해서 기본적으로는 스킵되고,
K7_TEST_LOCAL_MODELS=1 환경변수가 있을 때만 실제로 돈다.
"""

import os

import pytest

from app.config import Settings
from app.services.local_llm import analyze_transcript_local


def _local_models_enabled() -> bool:
    return os.getenv("K7_TEST_LOCAL_MODELS") == "1"


@pytest.mark.integration
def test_local_llm_returns_valid_gpt_analysis() -> None:
    if not _local_models_enabled():
        pytest.skip("K7_TEST_LOCAL_MODELS=1 not set")

    settings = Settings(use_local_models=True)
    result = analyze_transcript_local(
        settings,
        "제 카드가 방금 해외에서 결제됐다는 문자가 왔는데 제가 한 게 아니에요. 빨리 정지시켜주세요.",
    )
    assert result.summary
    assert result.department
    assert isinstance(result.keywords, list)


@pytest.mark.integration
def test_local_stt_transcribes_sample_audio() -> None:
    if not _local_models_enabled():
        pytest.skip("K7_TEST_LOCAL_MODELS=1 not set")

    from app.services.local_stt import transcribe_audio_local

    settings = Settings(use_local_models=True)
    sample_path = "../stt/test_sample2.m4a"
    if not os.path.exists(sample_path):
        pytest.skip("sample audio not found")

    with open(sample_path, "rb") as f:
        audio_bytes = f.read()
    result = transcribe_audio_local(settings, "test_sample2.m4a", audio_bytes)
    assert result.text
    assert result.duration_sec > 0


@pytest.mark.integration
def test_text_emotion_separates_severity_from_tone() -> None:
    """v1은 "arousal_level"을 텍스트에 물어봤다가 단순 문의 과대해석 + 상황=톤 혼동으로
    틀렸다(2026-07-20 실측). v2는 voice_tone을 고정값으로 못박고 severity/urgency만
    내용 기반으로 판단하는지 확인한다."""
    if not _local_models_enabled():
        pytest.skip("K7_TEST_LOCAL_MODELS=1 not set")

    from app.services.text_emotion import classify_text_emotion

    settings = Settings(use_local_models=True)

    neutral = classify_text_emotion(settings, "영업점 몇 시까지 하나요? 주말에도 문 여는지 궁금해서요.")
    assert neutral.situation_severity == "low"
    assert neutral.voice_tone == "unknown_text_only"

    fraud = classify_text_emotion(
        settings, "통장에서 제가 하지도 않은 출금이 세 건 찍혀 있어서 전화드렸어요."
    )
    assert fraud.situation_severity == "high"
    assert fraud.urgency_score >= 80
    assert fraud.voice_tone == "unknown_text_only"
