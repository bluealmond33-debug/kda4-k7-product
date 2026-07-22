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

MEDIUM_JUDGEMENT = JudgeResult(
    needs_attention=True,
    attention_level=AttentionLevel.MEDIUM,
    reason_codes=[AttentionReasonCode.MULTIPLE_INTENTS],
    recommended_agent_level=RecommendedAgentLevel.SPECIALIST,
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

HIGH_SEVERITY_NO_EVIDENCE_TEXT = TextEmotionResult(
    content_emotion="불안",
    situation_severity="high",
    urgency_score=90,
    evidence="근거 없음",
)

# HIGH 승격만 막히는지 순수하게 보려고 MEDIUM 캐스케이드 조건(강한 감정+urgency>=70)도 피한 픽스처
HIGH_SEVERITY_NO_EVIDENCE_NO_FALLBACK_TEXT = TextEmotionResult(
    content_emotion="중립",
    situation_severity="high",
    urgency_score=90,
    evidence="근거 없음",
)

ANGRY_URGENT_TEXT = TextEmotionResult(
    content_emotion="분노", situation_severity="medium", urgency_score=85, evidence="반복 항의"
)


def test_calm_text_does_not_escalate_none_judgement():
    result = fuse_judgement(NONE_JUDGEMENT, CALM_TEXT)

    assert result.attention_level == AttentionLevel.NONE
    assert result.needs_attention is False


def test_high_severity_text_with_evidence_escalates_none_to_high():
    result = fuse_judgement(NONE_JUDGEMENT, DANGEROUS_BUT_CALM_TONE_TEXT)

    assert result.needs_attention is True
    assert result.attention_level == AttentionLevel.HIGH
    assert AttentionReasonCode.TEXT_HIGH_RISK_SIGNAL in result.reason_codes
    assert result.recommended_agent_level == RecommendedAgentLevel.EXPERIENCED


def test_high_severity_text_without_evidence_does_not_escalate_to_high():
    """근거 없으면 HIGH는 막히지만, 강한 감정+urgency 조건은 별개로 살아있어 MEDIUM으로는 캐스케이드된다."""
    result = fuse_judgement(NONE_JUDGEMENT, HIGH_SEVERITY_NO_EVIDENCE_TEXT)

    assert result.attention_level == AttentionLevel.MEDIUM
    assert AttentionReasonCode.TEXT_HIGH_RISK_SIGNAL not in result.reason_codes


def test_high_severity_text_without_evidence_or_fallback_signal_stays_none():
    result = fuse_judgement(NONE_JUDGEMENT, HIGH_SEVERITY_NO_EVIDENCE_NO_FALLBACK_TEXT)

    assert result.attention_level == AttentionLevel.NONE


def test_strong_emotion_with_high_urgency_escalates_none_to_medium():
    result = fuse_judgement(NONE_JUDGEMENT, ANGRY_URGENT_TEXT)

    assert result.attention_level == AttentionLevel.MEDIUM
    assert AttentionReasonCode.HIGH_EMOTIONAL_DISTRESS in result.reason_codes


def test_high_severity_text_escalates_medium_to_high():
    result = fuse_judgement(MEDIUM_JUDGEMENT, DANGEROUS_BUT_CALM_TONE_TEXT)

    assert result.attention_level == AttentionLevel.HIGH
    assert AttentionReasonCode.MULTIPLE_INTENTS in result.reason_codes
    assert AttentionReasonCode.TEXT_HIGH_RISK_SIGNAL in result.reason_codes


def test_never_downgrades_existing_high_judgement():
    result = fuse_judgement(HIGH_JUDGEMENT, CALM_TEXT)

    assert result.attention_level == AttentionLevel.HIGH
    assert result.reason_codes == [AttentionReasonCode.FINANCIAL_ACCIDENT]


def test_high_judgement_unaffected_even_by_text_high_signal():
    result = fuse_judgement(HIGH_JUDGEMENT, DANGEROUS_BUT_CALM_TONE_TEXT)

    assert result.attention_level == AttentionLevel.HIGH
    assert result.reason_codes == [AttentionReasonCode.FINANCIAL_ACCIDENT]
