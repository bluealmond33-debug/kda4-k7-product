from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class CallStatus(str, Enum):
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class IncidentRisk(str, Enum):
    LOW = "low"
    HIGH = "high"


class EmotionStatus(str, Enum):
    UNAVAILABLE = "unavailable"
    DEMO = "demo"
    COMPLETED = "completed"


class ModelConsultationResult(BaseModel):
    """One normalized model boundary for summary, classification and routing."""

    summary: str = Field(min_length=1, max_length=2000)
    business_type: str = Field(min_length=1, max_length=200)
    department: str = Field(min_length=1, max_length=200)
    routing_reason: str = Field(min_length=1, max_length=2000)
    incident_risk: IncidentRisk = IncidentRisk.LOW
    risk_reason: str | None = Field(default=None, max_length=2000)
    routing_confidence: float | None = Field(default=None, ge=0, le=1)

    @model_validator(mode="after")
    def require_high_risk_reason(self) -> "ModelConsultationResult":
        if self.incident_risk == IncidentRisk.HIGH and not self.risk_reason:
            raise ValueError("risk_reason is required when incident_risk is high")
        return self


class TranscriptResult(BaseModel):
    text: str = Field(min_length=1)
    stt_model: str
    duration_sec: float = Field(default=0, ge=0)


class EmotionResult(BaseModel):
    """Emotion is optional for MVP and must never pretend a stub is a model."""

    status: EmotionStatus = EmotionStatus.UNAVAILABLE
    score: float | None = Field(default=None, ge=0, le=100)
    level: str | None = None
    reason: str | None = None

    @model_validator(mode="after")
    def keep_unavailable_empty(self) -> "EmotionResult":
        if self.status == EmotionStatus.UNAVAILABLE and (
            self.score is not None or self.level is not None
        ):
            raise ValueError("unavailable emotion cannot include a score or level")
        return self


class ConsultationCard(BaseModel):
    summary: str
    business_type: str
    department: str
    routing_reason: str
    incident_risk: IncidentRisk
    risk_reason: str | None = None
    routing_confidence: float | None = None
    emotion: EmotionResult = Field(default_factory=EmotionResult)


class MvpCallResponse(BaseModel):
    schema_version: str = "mvp-1.0"
    call_id: UUID
    status: CallStatus
    source_channel: str = "voice"
    audio_filename: str
    transcript: TranscriptResult
    consultation_card: ConsultationCard
    created_at: datetime


class HealthResponse(BaseModel):
    status: str
    database: str
    contract_version: str = "mvp-1.0"
