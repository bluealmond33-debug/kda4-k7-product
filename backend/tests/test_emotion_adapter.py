from copy import deepcopy
from uuid import uuid4

import pytest

from app.emotion_adapter import (
    AudioEmotionAdapterError,
    normalize_audio_emotion_result,
)


def completed_result(call_id: str) -> dict:
    return {
        "schema_version": "1.0",
        "external_session_key": call_id,
        "result_key": "emotion-result-1",
        "model_name": "team-audio-emotion",
        "model_version": "0.1.0",
        "analysis_status": "completed",
        "emotion_temperature_score": 74.0,
        "emotion_temperature_level": "elevated",
        "voice_arousal_score": 70.0,
        "voice_dominance_score": 58.0,
        "voice_valence_score": 28.0,
        "negative_activation_score": 50.4,
        "audio_quality": "normal",
        "failure_code": None,
        "generated_at": "2026-07-16T08:00:00Z",
    }


def test_completed_audio_result_maps_to_mvp_emotion() -> None:
    call_id = str(uuid4())
    emotion = normalize_audio_emotion_result(
        completed_result(call_id),
        expected_call_id=call_id,
    )

    assert emotion.status.value == "completed"
    assert emotion.score == 74
    assert emotion.level.value == "elevated"
    assert "team-audio-emotion@0.1.0" in (emotion.reason or "")


def test_audio_result_must_match_precreated_call_id() -> None:
    result = completed_result(str(uuid4()))
    with pytest.raises(
        AudioEmotionAdapterError,
        match="does not match call_id",
    ):
        normalize_audio_emotion_result(
            result,
            expected_call_id=str(uuid4()),
        )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("external_session_key", "not-a-uuid"),
        ("generated_at", "2026-07-16T08:00:00"),
    ],
)
def test_audio_result_requires_uuid_and_timezone(field: str, value: str) -> None:
    call_id = str(uuid4())
    result = completed_result(call_id)
    result[field] = value

    with pytest.raises(AudioEmotionAdapterError):
        normalize_audio_emotion_result(result, expected_call_id=call_id)


@pytest.mark.parametrize(
    ("score", "level"),
    [
        (34, "stable"),
        (33, "caution"),
        (67, "caution"),
        (66, "elevated"),
        (True, "stable"),
    ],
)
def test_invalid_audio_temperature_boundaries_are_rejected(
    score,
    level,
) -> None:
    call_id = str(uuid4())
    result = completed_result(call_id)
    result["emotion_temperature_score"] = score
    result["emotion_temperature_level"] = level

    with pytest.raises(AudioEmotionAdapterError):
        normalize_audio_emotion_result(result, expected_call_id=call_id)


def test_failed_audio_analysis_becomes_unavailable_without_fake_score() -> None:
    call_id = str(uuid4())
    result = completed_result(call_id)
    result.update(
        {
            "analysis_status": "failed",
            "emotion_temperature_score": None,
            "emotion_temperature_level": None,
            "voice_arousal_score": None,
            "voice_dominance_score": None,
            "voice_valence_score": None,
            "negative_activation_score": None,
            "audio_quality": "too_short",
            "failure_code": "AUDIO_TOO_SHORT",
        }
    )

    emotion = normalize_audio_emotion_result(
        deepcopy(result),
        expected_call_id=call_id,
    )

    assert emotion.status.value == "unavailable"
    assert emotion.score is None
    assert emotion.level is None
    assert "AUDIO_TOO_SHORT" in (emotion.reason or "")
