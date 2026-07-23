"""Reusable K7 data-integration boundary for an existing voice pipeline.

The operating backend may keep its own STT and model calls. It only needs to
pass their results to ``persist_pipeline_result``. This module owns the stable
model adapter, mvp-1.1 card assembly and PostgreSQL transaction boundary.
"""

from datetime import datetime, timezone
from typing import Any, Literal, Mapping
from uuid import UUID, uuid4

from app.config import Settings
from app.contracts import (
    AttentionLevel,
    CallStatus,
    ConsultationCard,
    EmotionResult,
    KnowledgeReference,
    MvpCallResponse,
    RoutingResult,
    TextEmotionResult,
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


def _nested_mapping(raw: Mapping[str, Any], key: str) -> Mapping[str, Any] | None:
    direct = raw.get(key)
    if isinstance(direct, Mapping):
        return direct
    judgement = raw.get("judgement")
    if isinstance(judgement, Mapping):
        nested = judgement.get(key)
        if isinstance(nested, Mapping):
            return nested
    return None


def _optional_routing(
    raw_model_result: Mapping[str, Any],
    routing_evidence: Mapping[str, Any] | None,
) -> RoutingResult | None:
    candidates: list[Mapping[str, Any] | None] = [
        _nested_mapping(raw_model_result, "routing"),
        _nested_mapping(routing_evidence or {}, "routing"),
        routing_evidence,
    ]
    required = {"task_code", "task_name", "classification", "handler"}
    for candidate in candidates:
        if not isinstance(candidate, Mapping) or not required <= set(candidate):
            continue
        try:
            return RoutingResult.model_validate(candidate)
        except ValueError:
            continue
    return None


def _optional_text_emotion(
    raw_model_result: Mapping[str, Any],
) -> TextEmotionResult | None:
    candidate = _nested_mapping(raw_model_result, "text_emotion")
    if candidate is None:
        return None
    try:
        return TextEmotionResult.model_validate(candidate)
    except ValueError:
        return None


def _attention_level(
    raw_model_result: Mapping[str, Any],
    normalized_incident_risk: str,
    text_emotion: TextEmotionResult | None,
) -> AttentionLevel:
    if normalized_incident_risk == "high":
        return AttentionLevel.HIGH

    explicit = raw_model_result.get("attention_level")
    judgement = raw_model_result.get("judgement")
    if explicit is None and isinstance(judgement, Mapping):
        explicit = judgement.get("attention_level")
    if explicit in {AttentionLevel.NONE.value, AttentionLevel.MEDIUM.value}:
        return AttentionLevel(str(explicit))

    if text_emotion and (
        text_emotion.situation_severity in {"medium", "high"}
        or text_emotion.urgency_score >= 50
    ):
        return AttentionLevel.MEDIUM
    return AttentionLevel.NONE


def _reason_codes(
    raw_model_result: Mapping[str, Any],
    attention_level: AttentionLevel,
    text_emotion: TextEmotionResult | None,
) -> list[str] | None:
    if "reason_codes" in raw_model_result and raw_model_result["reason_codes"] is None:
        return None
    explicit = raw_model_result.get("reason_codes")
    judgement = raw_model_result.get("judgement")
    if (
        explicit is None
        and isinstance(judgement, Mapping)
        and "reason_codes" in judgement
        and judgement["reason_codes"] is None
    ):
        return None
    if explicit is None and isinstance(judgement, Mapping):
        explicit = judgement.get("reason_codes")
    if isinstance(explicit, list):
        cleaned = [str(item).strip() for item in explicit if str(item).strip()]
        if cleaned:
            return cleaned[:16]

    reasons: list[str] = []
    if attention_level == AttentionLevel.HIGH:
        reasons.append("FINANCIAL_INCIDENT")
    if text_emotion and text_emotion.situation_severity == "high":
        reasons.append("TEXT_HIGH_RISK_SIGNAL")
    if attention_level == AttentionLevel.MEDIUM and not reasons:
        reasons.append("ATTENTION_REQUIRED")
    return reasons


def persist_pipeline_result(
    settings: Settings,
    *,
    audio_filename: str,
    transcript: TranscriptResult,
    raw_model_result: Mapping[str, Any],
    emotion: EmotionResult | None = None,
    emotion_source: Literal["audio"] | None = None,
    raw_emotion_result: Mapping[str, Any] | None = None,
    knowledge_references: list[KnowledgeReference] | None = None,
    routing_evidence: Mapping[str, Any] | None = None,
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
    resolved_emotion = resolved_emotion or EmotionResult(
        status="unavailable",
        reason="Emotion model result is unavailable.",
    )
    text_emotion = _optional_text_emotion(raw_model_result)
    attention_level = _attention_level(
        raw_model_result,
        normalized.incident_risk.value,
        text_emotion,
    )
    persisted_transcript = _normalize_transcript_storage_precision(transcript)
    response = MvpCallResponse(
        call_id=resolved_call_id,
        status=CallStatus.READY,
        audio_filename=audio_filename,
        transcript=persisted_transcript,
        consultation_card=ConsultationCard(
            **normalized.model_dump(),
            knowledge_references=knowledge_references or [],
            emotion=resolved_emotion
            or EmotionResult(
                status="unavailable",
                reason="감정 모델은 아직 MVP 통합 전입니다.",
            ),
            attention_level=attention_level,
            reason_codes=_reason_codes(
                raw_model_result,
                attention_level,
                text_emotion,
            ),
            routing=_optional_routing(raw_model_result, routing_evidence),
            text_emotion=text_emotion,
        ),
        created_at=created_at or datetime.now(timezone.utc),
    )
    if raw_emotion_result is None and routing_evidence is None:
        save_call(settings, response, dict(raw_model_result))
    elif routing_evidence is None:
        save_call(
            settings,
            response,
            dict(raw_model_result),
            dict(raw_emotion_result),
        )
    else:
        save_call(
            settings,
            response,
            dict(raw_model_result),
            dict(raw_emotion_result or {}),
            dict(routing_evidence),
        )
    return response
