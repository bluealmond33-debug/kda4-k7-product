from app.schemas import AttentionLevel, AttentionReasonCode, EmotionResult, RecommendedAgentLevel, RiskFlags
from app.services.judge import judge

NEUTRAL_EMOTION = EmotionResult(
    anger_probability=0.1, anxiety_probability=0.1, neutral_probability=0.8, uncertainty=0.1
)


def test_no_flags_means_no_attention_needed():
    result = judge(RiskFlags(), NEUTRAL_EMOTION)

    assert result.needs_attention is False
    assert result.attention_level == AttentionLevel.NONE
    assert result.reason_codes == []
    assert result.recommended_agent_level == RecommendedAgentLevel.GENERAL


def test_single_financial_accident_flag_is_high():
    flags = RiskFlags(credential_exposed=True)

    result = judge(flags, NEUTRAL_EMOTION)

    assert result.needs_attention is True
    assert result.attention_level == AttentionLevel.HIGH
    assert AttentionReasonCode.CREDENTIAL_EXPOSED in result.reason_codes
    assert result.recommended_agent_level == RecommendedAgentLevel.ACCIDENT_SPECIALIST


def test_financial_accident_plus_info_gap_is_still_high():
    flags = RiskFlags(actual_damage_occurred=True, damage_amount_unknown=True)

    result = judge(flags, NEUTRAL_EMOTION)

    assert result.attention_level == AttentionLevel.HIGH
    assert AttentionReasonCode.FINANCIAL_ACCIDENT in result.reason_codes
    assert AttentionReasonCode.MISSING_CRITICAL_INFO in result.reason_codes


def test_two_info_gaps_without_accident_is_medium():
    flags = RiskFlags(damage_amount_unknown=True, transfer_time_unknown=True)

    result = judge(flags, NEUTRAL_EMOTION)

    assert result.needs_attention is True
    assert result.attention_level == AttentionLevel.MEDIUM
    assert result.reason_codes == [AttentionReasonCode.MISSING_CRITICAL_INFO]
    assert result.recommended_agent_level == RecommendedAgentLevel.SPECIALIST


def test_single_info_gap_alone_is_not_enough_for_attention():
    flags = RiskFlags(damage_amount_unknown=True)

    result = judge(flags, NEUTRAL_EMOTION)

    assert result.needs_attention is False
    assert result.attention_level == AttentionLevel.NONE


def test_complex_case_single_flag_is_medium():
    flags = RiskFlags(repeat_contact_same_case=True)

    result = judge(flags, NEUTRAL_EMOTION)

    assert result.attention_level == AttentionLevel.MEDIUM
    assert AttentionReasonCode.REPEAT_CONTACT in result.reason_codes


def test_customer_state_alone_is_medium():
    distressed = EmotionResult(
        anger_probability=0.75, anxiety_probability=0.2, neutral_probability=0.05, uncertainty=0.1
    )

    result = judge(RiskFlags(), distressed)

    assert result.attention_level == AttentionLevel.MEDIUM
    assert result.reason_codes == [AttentionReasonCode.HIGH_EMOTIONAL_DISTRESS]
    assert result.recommended_agent_level == RecommendedAgentLevel.SPECIALIST


def test_high_uncertainty_alone_triggers_customer_state_alert():
    uncertain = EmotionResult(
        anger_probability=0.1, anxiety_probability=0.1, neutral_probability=0.8, uncertainty=0.55
    )

    result = judge(RiskFlags(), uncertain)

    assert result.attention_level == AttentionLevel.MEDIUM
    assert AttentionReasonCode.HIGH_EMOTIONAL_DISTRESS in result.reason_codes


def test_protection_incomplete_only_high_but_not_accident_specialist():
    flags = RiskFlags(protection_measures_incomplete=True)

    result = judge(flags, NEUTRAL_EMOTION)

    assert result.attention_level == AttentionLevel.HIGH
    assert result.recommended_agent_level == RecommendedAgentLevel.EXPERIENCED


def test_multiple_reason_codes_can_coexist():
    flags = RiskFlags(
        remote_app_installed=True,
        damage_amount_unknown=True,
        repeat_contact_same_case=True,
    )
    distressed = EmotionResult(
        anger_probability=0.7, anxiety_probability=0.1, neutral_probability=0.2, uncertainty=0.1
    )

    result = judge(flags, distressed)

    assert result.attention_level == AttentionLevel.HIGH
    assert set(result.reason_codes) == {
        AttentionReasonCode.REMOTE_APP_INSTALLED,
        AttentionReasonCode.MISSING_CRITICAL_INFO,
        AttentionReasonCode.REPEAT_CONTACT,
        AttentionReasonCode.HIGH_EMOTIONAL_DISTRESS,
    }
    assert result.recommended_agent_level == RecommendedAgentLevel.ACCIDENT_SPECIALIST
