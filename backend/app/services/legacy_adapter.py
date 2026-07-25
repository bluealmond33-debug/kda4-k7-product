"""팀 기존 docs/api_contract.md 스키마로 변환하는 어댑터.

demo_live.html(app/lib fetchBackendAnalysis)이 이미 그 스키마를 소비하도록 짜여 있어서,
새 파이프라인(BriefingCard) 응답을 그 형태로 다시 포장해준다.
"""

from app.schemas import AttentionLevel, EmotionResult, JudgeResult

_LEVEL_TO_URGENCY_SCORE: dict[AttentionLevel, int] = {
    AttentionLevel.HIGH: 85,
    AttentionLevel.MEDIUM: 55,
    AttentionLevel.NONE: 15,
}


def urgency_score_for(level: AttentionLevel) -> int:
    return _LEVEL_TO_URGENCY_SCORE[level]


def emotion_label_and_score(emotion: EmotionResult) -> tuple[str, float]:
    candidates = {
        "분노": emotion.anger_probability,
        "불안": emotion.anxiety_probability,
        "중립": emotion.neutral_probability,
    }
    label = max(candidates, key=candidates.get)
    return label, candidates[label]


def routing_reason(reason_labels: list[str], department: str) -> str:
    if reason_labels:
        return ", ".join(reason_labels)
    return f"{department} 담당 업무로 분류"
