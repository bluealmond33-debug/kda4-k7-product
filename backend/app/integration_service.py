"""Reusable K7 data-integration boundary for an existing voice pipeline.

The operating backend may keep its own STT and model calls. It only needs to
pass their results to ``persist_pipeline_result``. This module owns the stable
model adapter, mvp-1.0 card assembly and PostgreSQL transaction boundary.
"""

from datetime import datetime, timezone
from typing import Any, Mapping
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


def persist_pipeline_result(
    settings: Settings,
    *,
    audio_filename: str,
    transcript: TranscriptResult,
    raw_model_result: Mapping[str, Any],
    emotion: EmotionResult | None = None,
    created_at: datetime | None = None,
) -> MvpCallResponse:
    """Normalize one pipeline result, persist it and return the stored contract.

    This function deliberately does not run STT or call a model server. The
    caller keeps ownership of those functions, so the operating backend can
    integrate K7 persistence without replacing or duplicating its pipeline.
    """

    normalized = normalize_model_result(raw_model_result)
    response = MvpCallResponse(
        call_id=uuid4(),
        status=CallStatus.READY,
        audio_filename=audio_filename,
        transcript=transcript,
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
