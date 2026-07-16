from app.schemas import AttentionLevel, EmotionResult, RecommendedAgentLevel
from app.services.react_adapter import (
    bullets_from_summary,
    build_call_summary,
    emotion_label,
    emotion_level_and_signals,
    incident_risk_from,
    recommended_agent_text,
)


def _emotion(anger=0.0, anxiety=0.0, neutral=1.0, uncertainty=0.1) -> EmotionResult:
    return EmotionResult(
        anger_probability=anger, anxiety_probability=anxiety,
        neutral_probability=neutral, uncertainty=uncertainty,
    )


def test_emotion_level_calm_when_no_signal():
    level, signals = emotion_level_and_signals(_emotion())
    assert level == 0
    assert signals == []


def test_emotion_level_agitated_on_high_anxiety():
    level, signals = emotion_level_and_signals(_emotion(anxiety=0.8))
    assert level == 3
    assert "불안·다급 발화 감지" in signals


def test_emotion_level_elevated_on_high_uncertainty_alone():
    level, _ = emotion_level_and_signals(_emotion(uncertainty=0.6))
    assert level == 2


def test_emotion_label_matches_level():
    assert emotion_label(0) == "안정"
    assert emotion_label(3) == "격앙 주의"


def test_incident_risk_mapping():
    assert incident_risk_from(AttentionLevel.NONE) == "none"
    assert incident_risk_from(AttentionLevel.MEDIUM) == "watch"
    assert incident_risk_from(AttentionLevel.HIGH) == "high"


def test_recommended_agent_text():
    assert recommended_agent_text(RecommendedAgentLevel.ACCIDENT_SPECIALIST) == "사고전문 상담사 우선"


def test_bullets_from_summary_splits_sentences():
    summary = "착오송금 신고 접수. 지급정지 여부 미확인. 고객 다급함."
    assert bullets_from_summary(summary) == [
        "착오송금 신고 접수.", "지급정지 여부 미확인.", "고객 다급함.",
    ]


def test_bullets_from_summary_falls_back_to_whole_string_when_no_terminator():
    assert bullets_from_summary("문장부호 없는 요약") == ["문장부호 없는 요약"]


def test_build_call_summary_uses_first_bullet_as_headline():
    result = build_call_summary(
        department="이체오류처리팀",
        summary="착오송금 신고 접수. 지급정지 여부 미확인.",
        emotion=_emotion(anxiety=0.7),
        attention_level=AttentionLevel.MEDIUM,
        recommended_agent_level=RecommendedAgentLevel.SPECIALIST,
    )
    assert result.type == "이체오류처리팀"
    assert result.headline == "착오송금 신고 접수."
    assert result.bullets == ["착오송금 신고 접수.", "지급정지 여부 미확인."]
    assert result.incidentRisk == "watch"
    assert result.recommendedAgent == "전문 상담사 우선"
    assert result.emotion.level == 3
