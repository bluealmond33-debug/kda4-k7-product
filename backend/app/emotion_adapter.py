"""Normalize the audio-only emotion model result into the active MVP card."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Mapping
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)
from typing_extensions import Literal

from app.contracts import EmotionResult


class AudioEmotionAdapterError(ValueError):
    pass


class AnalysisStatus(str, Enum):
    COMPLETED = "completed"
    UNAVAILABLE = "unavailable"
    FAILED = "failed"


class AudioQuality(str, Enum):
    NORMAL = "normal"
    LOW_VOLUME = "low_volume"
    NOISY = "noisy"
    TOO_SHORT = "too_short"
    UNAVAILABLE = "unavailable"


class TemperatureLevel(str, Enum):
    STABLE = "stable"
    CAUTION = "caution"
    ELEVATED = "elevated"


class AudioEmotionModelResult(BaseModel):
    """Python equivalent of emotion_temperature_result.schema.json."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    schema_version: Literal["1.0"]
    external_session_key: UUID
    result_key: str = Field(min_length=1, max_length=100)
    model_name: str = Field(min_length=1, max_length=100)
    model_version: str = Field(min_length=1, max_length=50)
    analysis_status: AnalysisStatus
    emotion_temperature_score: float | None = Field(default=None, ge=0, le=100)
    emotion_temperature_level: TemperatureLevel | None = None
    voice_arousal_score: float | None = Field(default=None, ge=0, le=100)
    voice_dominance_score: float | None = Field(default=None, ge=0, le=100)
    voice_valence_score: float | None = Field(default=None, ge=0, le=100)
    negative_activation_score: float | None = Field(default=None, ge=0, le=100)
    audio_quality: AudioQuality
    failure_code: str | None = Field(default=None, min_length=1, max_length=100)
    generated_at: datetime

    @field_validator(
        "emotion_temperature_score",
        "voice_arousal_score",
        "voice_dominance_score",
        "voice_valence_score",
        "negative_activation_score",
        mode="before",
    )
    @classmethod
    def reject_boolean_scores(cls, value: Any) -> Any:
        if isinstance(value, bool):
            raise ValueError("boolean is not a valid audio emotion score")
        return value

    @model_validator(mode="after")
    def enforce_status_and_temperature_band(self) -> "AudioEmotionModelResult":
        if self.generated_at.tzinfo is None:
            raise ValueError("audio emotion generated_at must include timezone")
        score = self.emotion_temperature_score
        level = self.emotion_temperature_level
        component_scores = (
            self.voice_arousal_score,
            self.voice_dominance_score,
            self.voice_valence_score,
            self.negative_activation_score,
        )

        if self.analysis_status == AnalysisStatus.COMPLETED:
            if score is None or level is None:
                raise ValueError("completed audio emotion requires score and level")
            if self.failure_code is not None:
                raise ValueError("completed audio emotion cannot include failure_code")
            if level == TemperatureLevel.STABLE and score > 33:
                raise ValueError("stable audio emotion score must be 0..33")
            if level == TemperatureLevel.CAUTION and not 33 < score <= 66:
                raise ValueError("caution audio emotion score must be >33..66")
            if level == TemperatureLevel.ELEVATED and score <= 66:
                raise ValueError("elevated audio emotion score must be >66..100")
        else:
            if score is not None or level is not None or any(
                value is not None for value in component_scores
            ):
                raise ValueError(
                    "unavailable or failed audio emotion cannot include scores"
                )
            if not self.failure_code:
                raise ValueError(
                    "unavailable or failed audio emotion requires failure_code"
                )
        return self


def normalize_audio_emotion_result(
    raw_result: Mapping[str, Any],
    *,
    expected_call_id: str,
) -> EmotionResult:
    """Validate an audio model response and map it to the consultation card."""

    try:
        parsed = AudioEmotionModelResult.model_validate(dict(raw_result))
    except ValidationError as exc:
        raise AudioEmotionAdapterError(
            f"invalid audio emotion model result: {exc}"
        ) from exc

    if str(parsed.external_session_key) != expected_call_id:
        raise AudioEmotionAdapterError(
            "audio emotion external_session_key does not match call_id"
        )

    model_ref = f"{parsed.model_name}@{parsed.model_version}"
    if parsed.analysis_status == AnalysisStatus.COMPLETED:
        return EmotionResult(
            status="completed",
            score=parsed.emotion_temperature_score,
            level=parsed.emotion_temperature_level,
            reason=f"{model_ref}; audio_quality={parsed.audio_quality.value}",
        )

    return EmotionResult(
        status="unavailable",
        reason=(
            f"{model_ref}; status={parsed.analysis_status.value}; "
            f"audio_quality={parsed.audio_quality.value}; "
            f"failure_code={parsed.failure_code}"
        ),
    )
