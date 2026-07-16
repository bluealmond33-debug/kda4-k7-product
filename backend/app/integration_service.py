"""Reusable K7 data-integration boundary for an existing voice pipeline.

The operating backend may keep its own STT and model calls. It only needs to
pass their results to ``persist_pipeline_result``. This module owns the stable
model adapter, mvp-1.0 card assembly and PostgreSQL transaction boundary.
"""

from datetime import datetime, timezone
from typing import Any, Literal, Mapping
from uuid import UUID, uuid4

from app.config import Settings
from app.contracts import (
    CallStatus,
    ConsultationCard,
    EmotionResult,
    MvpCallResponse,
    TranscriptResult,
)
from app.database import save_call
from app.emotion_adapter import normalize_audio_emotion_result
from app.model_adapter import normalize_model_result


def _normalize_transcript_storage_precision(
    transcript: TranscriptResult,
) -> TranscriptResult:
    """Align the API response with PostgreSQL numeric(10, 3) storage.

    Some STT libraries return binary floating-point artifacts such as
    ``10.100000381469727``. PostgreSQL correctly stores that value as ``10.100``,
    so returning the unrounded value from POST would make the subsequent GET
    look different even though no business data was lost.
    """

    rounded_duration = round(transcript.duration_sec, 3)
    if rounded_duration == transcript.duration_sec:
        return transcript
    return transcript.model_copy(update={"duration_sec": rounded_duration})


def persist_pipeline_result(
    settings: Settings,
    *,
    audio_filename: str,
    transcript: TranscriptResult,
    raw_model_result: Mapping[str, Any],
    emotion: EmotionResult | None = None,
    emotion_source: Literal["audio"] | None = None,
    raw_emotion_result: Mapping[str, Any] | None = None,
    call_id: UUID | None = None,
    created_at: datetime | None = None,
) -> MvpCallResponse:
    """Normalize one pipeline result, persist it and return the stored contract.

    This function deliberately does not run STT or call a model server. The
    caller keeps ownership of those functions, so the operating backend can
    integrate K7 persistence without replacing or duplicating its pipeline.
    """

    if emotion is not None and raw_emotion_result is not None:
        raise ValueError(
            "provide either normalized emotion or raw_emotion_result, not both"
        )
    if raw_emotion_result is not None and call_id is None:
        raise ValueError(
            "call_id must be created before audio/STT branches when "
            "raw_emotion_result is provided"
        )
    if raw_emotion_result is not None and emotion_source != "audio":
        raise ValueError(
            "raw emotion result must be produced from the same customer audio"
        )
    if (
        emotion is not None
        and emotion.status.value == "completed"
        and emotion_source != "audio"
    ):
        raise ValueError(
            "completed emotion must be produced from customer audio"
        )

    normalized = normalize_model_result(raw_model_result)
    resolved_call_id = call_id or uuid4()
    resolved_emotion = emotion
    if raw_emotion_result is not None:
        resolved_emotion = normalize_audio_emotion_result(
            raw_emotion_result,
            expected_call_id=str(resolved_call_id),
        )
    persisted_transcript = _normalize_transcript_storage_precision(transcript)
    response = MvpCallResponse(
        call_id=resolved_call_id,
        status=CallStatus.READY,
        audio_filename=audio_filename,
        transcript=persisted_transcript,
        consultation_card=ConsultationCard(
            **normalized.model_dump(),
            emotion=resolved_emotion
            or EmotionResult(
                status="unavailable",
                reason="감정 모델은 아직 MVP 통합 전입니다.",
            ),
        ),
        created_at=created_at or datetime.now(timezone.utc),
    )
    if raw_emotion_result is None:
        save_call(settings, response, dict(raw_model_result))
    else:
        save_call(
            settings,
            response,
            dict(raw_model_result),
            dict(raw_emotion_result),
        )
    return response
