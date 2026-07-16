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
