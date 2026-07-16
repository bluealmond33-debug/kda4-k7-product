"""Reusable K7 data-integration boundary for an existing voice pipeline.

The operating backend may keep its own STT and model calls. It only needs to
pass their results to ``persist_pipeline_result``. This module owns the stable
model adapter, mvp-1.0 card assembly and PostgreSQL transaction boundary.
"""

from datetime import datetime, timezone
from typing import Any, Literal, Mapping
from uuid import uuid4

from app.config import Settings
from app.contracts import (
    CallStatus,
    ConsultationCard,
    EmotionResult,
    MvpCallResponse,
    TranscriptResult,
)
from app.database import save_call
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
    created_at: datetime | None = None,
) -> MvpCallResponse:
    """Normalize one pipeline result, persist it and return the stored contract.

    This function deliberately does not run STT or call a model server. The
    caller keeps ownership of those functions, so the operating backend can
    integrate K7 persistence without replacing or duplicating its pipeline.
    """

    if (
        emotion is not None
        and emotion.status.value == "completed"
        and emotion_source != "audio"
    ):
        raise ValueError(
            "completed emotion must be produced from customer audio"
        )

    normalized = normalize_model_result(raw_model_result)
    persisted_transcript = _normalize_transcript_storage_precision(transcript)
    response = MvpCallResponse(
        call_id=uuid4(),
        status=CallStatus.READY,
        audio_filename=audio_filename,
        transcript=persisted_transcript,
        consultation_card=ConsultationCard(
            **normalized.model_dump(),
            emotion=emotion
            or EmotionResult(
                status="unavailable",
                reason="감정 모델은 아직 MVP 통합 전입니다.",
            ),
        ),
        created_at=created_at or datetime.now(timezone.utc),
    )
    save_call(settings, response, dict(raw_model_result))
    return response
