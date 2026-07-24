"""kda4-k7-product(팀 React 데모) 연동 어댑터.

그 저장소의 src/services/types.ts가 기대하는 훨씬 단순한 계약(EmotionScore/CallSummary)으로
우리 파이프라인의 EmotionResult/JudgeResult를 재포장한다. 순수 함수라 외부 I/O 없이 테스트 가능.
"""

import re

from app.schemas import (
    AttentionLevel,
    EmotionResult,
    ReactCallSummary,
    RecommendedAgentLevel,
)

EMOTION_AGITATED_THRESHOLD = 0.6
EMOTION_ELEVATED_THRESHOLD = 0.3
UNCERTAINTY_ELEVATED_THRESHOLD = 0.5

_LEVEL_LABELS = ["안정", "보통", "상승", "격앙 주의"]

_INCIDENT_RISK_BY_LEVEL: dict[AttentionLevel, str] = {
    AttentionLevel.NONE: "none",
    AttentionLevel.MEDIUM: "watch",
    AttentionLevel.HIGH: "high",
}

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


def emotion_level_and_signals(emotion: EmotionResult) -> tuple[int, list[str]]:
    signals = []
    if emotion.anxiety_probability >= EMOTION_ELEVATED_THRESHOLD:
        signals.append("불안·다급 발화 감지")
    if emotion.anger_probability >= EMOTION_ELEVATED_THRESHOLD:
        signals.append("분노 발화 감지")

    if (
        emotion.anger_probability >= EMOTION_AGITATED_THRESHOLD
        or emotion.anxiety_probability >= EMOTION_AGITATED_THRESHOLD
    ):
        level = 3
    elif (
        emotion.anger_probability >= EMOTION_ELEVATED_THRESHOLD
        or emotion.anxiety_probability >= EMOTION_ELEVATED_THRESHOLD
        or emotion.uncertainty >= UNCERTAINTY_ELEVATED_THRESHOLD
    ):
        level = 2
    elif emotion.anger_probability > 0 or emotion.anxiety_probability > 0:
        level = 1
    else:
        level = 0

    return level, signals


def emotion_label(level: int) -> str:
    return _LEVEL_LABELS[level]


def incident_risk_from(level: AttentionLevel) -> str:
    return _INCIDENT_RISK_BY_LEVEL[level]


def recommended_agent_text(level: RecommendedAgentLevel) -> str:
    return f"{level.value} 상담사 우선"


def bullets_from_summary(summary: str) -> list[str]:
    sentences = [s.strip() for s in _SENTENCE_SPLIT.split(summary.strip()) if s.strip()]
    return sentences or [summary.strip()]


def build_call_summary(
    department: str,
    summary: str,
    emotion: EmotionResult,
    attention_level: AttentionLevel,
    recommended_agent_level: RecommendedAgentLevel,
) -> ReactCallSummary:
    bullets = bullets_from_summary(summary)
    level, signals = emotion_level_and_signals(emotion)

    return ReactCallSummary(
        type=department,
        headline=bullets[0],
        bullets=bullets,
        emotion={"level": level, "label": emotion_label(level), "signals": signals},
        incidentRisk=incident_risk_from(attention_level),
        recommendedAgent=recommended_agent_text(recommended_agent_level),
    )
