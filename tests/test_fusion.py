from app.schemas import (
    AttentionLevel,
    AttentionReasonCode,
    JudgeResult,
    RecommendedAgentLevel,
    TextEmotionResult,
)
from app.services.fusion import fuse_judgement

NONE_JUDGEMENT = JudgeResult(
    needs_attention=False,
    attention_level=AttentionLevel.NONE,
    reason_codes=[],
    recommended_agent_level=RecommendedAgentLevel.GENERAL,
)

HIGH_JUDGEMENT = JudgeResult(
    needs_attention=True,
    attention_level=AttentionLevel.HIGH,
    reason_codes=[AttentionReasonCode.FINANCIAL_ACCIDENT],
    recommended_agent_level=RecommendedAgentLevel.ACCIDENT_SPECIALIST,
)

CALM_TEXT = TextEmotionResult(
    content_emotion="중립", situation_severity="low", urgency_score=15, evidence="단순 문의"
)

DANGEROUS_BUT_CALM_TONE_TEXT = TextEmotionResult(
    content_emotion="불안",
    situation_severity="high",
    urgency_score=90,
    evidence="대포통장 개설, 지급정지 요청",
)

ANGRY_URGENT_TEXT = TextEmotionResult(
    content_emotion="분노", situation_severity="medium", urgency_score=85, evidence="반복 항의"
)


def test_calm_text_does_not_escalate_none_judgement():
    result = fuse_judgement(NONE_JUDGEMENT, CALM_TEXT)

    assert result.attention_level == AttentionLevel.NONE
    assert result.needs_attention is False


def test_high_severity_text_escalates_none_to_medium():
    result = fuse_judgement(NONE_JUDGEMENT, DANGEROUS_BUT_CALM_TONE_TEXT)

    assert result.needs_attention is True
    assert result.attention_level == AttentionLevel.MEDIUM
    assert AttentionReasonCode.HIGH_EMOTIONAL_DISTRESS in result.reason_codes
    assert result.recommended_agent_level == RecommendedAgentLevel.SPECIALIST


def test_strong_emotion_with_high_urgency_escalates_none_to_medium():
    result = fuse_judgement(NONE_JUDGEMENT, ANGRY_URGENT_TEXT)

    assert result.attention_level == AttentionLevel.MEDIUM


def test_never_downgrades_existing_high_judgement():
    result = fuse_judgement(HIGH_JUDGEMENT, CALM_TEXT)

    assert result.attention_level == AttentionLevel.HIGH
    assert result.reason_codes == [AttentionReasonCode.FINANCIAL_ACCIDENT]
