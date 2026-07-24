from datetime import datetime
from enum import Enum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def _reject_boolean_number(value):
    if isinstance(value, bool):
        raise ValueError("boolean is not a valid numeric score")
    return value


class CallStatus(str, Enum):
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class IncidentRisk(str, Enum):
    LOW = "low"
    HIGH = "high"


class EmotionStatus(str, Enum):
    UNAVAILABLE = "unavailable"
    COMPLETED = "completed"


class EmotionTemperatureLevel(str, Enum):
    STABLE = "stable"
    CAUTION = "caution"
    ELEVATED = "elevated"


class AttentionLevel(str, Enum):
    NONE = "none"
    MEDIUM = "medium"
    HIGH = "high"


ReasonCode = Annotated[str, Field(min_length=1, max_length=100)]


class RoutingResult(BaseModel):
    """Three-stage task routing selected by the local routing classifier."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    task_code: str = Field(min_length=1, max_length=50)
    task_name: str = Field(min_length=1, max_length=200)
    classification: Literal["EMERGENCY", "SIMPLE", "GENERAL"]
    handler: Literal["HUMAN", "AI"]


class TextEmotionResult(BaseModel):
    """Text-only severity, kept separate from the audio emotion result."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    content_emotion: str = Field(min_length=1, max_length=100)
    situation_severity: Literal["low", "medium", "high"]
    urgency_score: float = Field(ge=0, le=100)

    _validate_urgency_score = field_validator("urgency_score", mode="before")(
        _reject_boolean_number
    )


class ChecklistItem(BaseModel):
    """One counselor action generated from the call and reviewed policy."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=200)
    detail: str = Field(min_length=1, max_length=1000)
    source: Literal["model", "policy", "rag"]


class KnowledgeReference(BaseModel):
    """A local knowledge-base passage used to ground the briefing."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    doc_id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=300)
    section: str = Field(min_length=1, max_length=300)
    excerpt: str = Field(min_length=1, max_length=2000)
    source: str = Field(min_length=1, max_length=500)
    score: float = Field(ge=0, le=1)

    _validate_score = field_validator("score", mode="before")(
        _reject_boolean_number
    )


class ModelConsultationResult(BaseModel):
    """One normalized model boundary for summary, classification and routing."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    summary: str = Field(min_length=1, max_length=2000)
    business_type: str = Field(min_length=1, max_length=200)
    department: str = Field(min_length=1, max_length=200)
    routing_reason: str = Field(min_length=1, max_length=2000)
    incident_risk: IncidentRisk = IncidentRisk.LOW
    risk_reason: str | None = Field(default=None, max_length=2000)
    routing_confidence: float | None = Field(default=None, ge=0, le=1)
    customer_requests: list[str] = Field(default_factory=list, max_length=8)
    missing_information: list[str] = Field(default_factory=list, max_length=8)
    required_actions: list[ChecklistItem] = Field(default_factory=list, max_length=8)

    _validate_routing_confidence = field_validator(
        "routing_confidence", mode="before"
    )(_reject_boolean_number)

    @model_validator(mode="after")
    def require_high_risk_reason(self) -> "ModelConsultationResult":
        if self.incident_risk == IncidentRisk.HIGH and not self.risk_reason:
            raise ValueError("risk_reason is required when incident_risk is high")
        return self


class TranscriptResult(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    text: str = Field(min_length=1)
    stt_model: str = Field(min_length=1, max_length=100)
    duration_sec: float = Field(default=0, ge=0)

    _validate_duration = field_validator("duration_sec", mode="before")(
        _reject_boolean_number
    )


class EmotionResult(BaseModel):
    """Emotion is optional for MVP and must never pretend a stub is a model."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    status: EmotionStatus = EmotionStatus.UNAVAILABLE
    score: float | None = Field(default=None, ge=0, le=100)
    level: EmotionTemperatureLevel | None = None
    reason: str | None = Field(default=None, max_length=2000)

    _validate_score = field_validator("score", mode="before")(_reject_boolean_number)

    @model_validator(mode="after")
    def keep_unavailable_empty(self) -> "EmotionResult":
        if self.status == EmotionStatus.UNAVAILABLE and (
            self.score is not None or self.level is not None
        ):
            raise ValueError("unavailable emotion cannot include a score or level")
        if self.status == EmotionStatus.COMPLETED and (
            self.score is None or not self.level
        ):
            raise ValueError("available emotion requires a score and level")
        if self.score is not None and self.level is not None:
            if (
                self.level == EmotionTemperatureLevel.STABLE
                and self.score > 33
            ):
                raise ValueError("stable emotion score must be 0..33")
            if (
                self.level == EmotionTemperatureLevel.CAUTION
                and not 33 < self.score <= 66
            ):
                raise ValueError("caution emotion score must be >33..66")
            if (
                self.level == EmotionTemperatureLevel.ELEVATED
                and self.score <= 66
            ):
                raise ValueError("elevated emotion score must be >66..100")
        return self


class ConsultationCard(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    summary: str = Field(min_length=1, max_length=2000)
    business_type: str = Field(min_length=1, max_length=200)
    department: str = Field(min_length=1, max_length=200)
    routing_reason: str = Field(min_length=1, max_length=2000)
    incident_risk: IncidentRisk
    risk_reason: str | None = Field(default=None, max_length=2000)
    routing_confidence: float | None = Field(default=None, ge=0, le=1)
    customer_requests: list[str] = Field(default_factory=list, max_length=8)
    missing_information: list[str] = Field(default_factory=list, max_length=8)
    required_actions: list[ChecklistItem] = Field(default_factory=list, max_length=8)
    knowledge_references: list[KnowledgeReference] = Field(default_factory=list, max_length=5)
    emotion: EmotionResult = Field(default_factory=EmotionResult)
    attention_level: AttentionLevel
    reason_codes: list[ReasonCode] | None = Field(max_length=16)
    routing: RoutingResult | None
    text_emotion: TextEmotionResult | None

    _validate_routing_confidence = field_validator(
        "routing_confidence", mode="before"
    )(_reject_boolean_number)

    @model_validator(mode="after")
    def require_high_risk_reason(self) -> "ConsultationCard":
        if self.incident_risk == IncidentRisk.HIGH and not self.risk_reason:
            raise ValueError("risk_reason is required when incident_risk is high")
        if self.incident_risk == IncidentRisk.HIGH and self.attention_level != AttentionLevel.HIGH:
            raise ValueError("high incident_risk requires high attention_level")
        if self.incident_risk == IncidentRisk.LOW and self.attention_level == AttentionLevel.HIGH:
            raise ValueError("high attention_level requires high incident_risk")
        return self


class MvpCallResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    schema_version: Literal["mvp-1.1"] = "mvp-1.1"
    call_id: UUID
    status: CallStatus
    source_channel: Literal["voice"] = "voice"
    audio_filename: str = Field(min_length=1, max_length=255)
    transcript: TranscriptResult
    consultation_card: ConsultationCard
    created_at: datetime


class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str
    database: str
    contract_version: str = "mvp-1.1"
    pipeline_mode: Literal["cloud", "local"]
    stt_provider: Literal["openai", "faster_whisper"]
    analysis_provider: Literal["openai", "ollama"]
