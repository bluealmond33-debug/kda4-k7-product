from datetime import datetime
from enum import Enum
from typing import Literal
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
    """활성 계약은 unavailable·completed만 허용한다.

    실행 엔진(ADR-0012 이식원)에는 `DEMO = "demo"`가 선언돼 있었으나 코드
    어디에서도 쓰지 않는 죽은 값이었다. product는 "스텁을 진짜 모델인 척하지
    않는다"는 원칙으로 demo를 계약·DB 체크제약
    (`consultation_cards_available_emotion_chk`)에서 모두 거부하므로 가져오지
    않는다. 감정 미연동은 unavailable + [SOURCE=STUB] reason으로 표현한다.
    """

    UNAVAILABLE = "unavailable"
    COMPLETED = "completed"


class EmotionTemperatureLevel(str, Enum):
    STABLE = "stable"
    CAUTION = "caution"
    ELEVATED = "elevated"


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
    emotion: EmotionResult = Field(default_factory=EmotionResult)

    _validate_routing_confidence = field_validator(
        "routing_confidence", mode="before"
    )(_reject_boolean_number)

    @model_validator(mode="after")
    def require_high_risk_reason(self) -> "ConsultationCard":
        if self.incident_risk == IncidentRisk.HIGH and not self.risk_reason:
            raise ValueError("risk_reason is required when incident_risk is high")
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
    contract_version: str = "mvp-1.0"


# ── 실행 엔진 호환 별칭 (ADR-0012 이식) ──────────────────────────────────
# 실행 엔진 코드는 MvpEmotionResult·MvpHealthResponse라는 이름을 쓴다. 필드와
# 의미가 같으므로 이름만 재노출한다. level은 실행 엔진이 "stable"·"caution"·
# "elevated" 문자열을 넣는데 EmotionTemperatureLevel enum 값과 일치해 Pydantic이
# 그대로 변환한다.
MvpEmotionResult = EmotionResult
MvpHealthResponse = HealthResponse
