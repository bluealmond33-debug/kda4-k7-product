from app.contracts import EmotionStatus, IncidentRisk
from app.schemas import (
    AttentionLevel,
    AttentionReasonCode,
    GptAnalysis,
    JudgeResult,
    RecommendedAgentLevel,
    RiskFlags,
)
from app.services.mvp_adapter import to_consultation_card, to_model_consultation_result


def _gpt(department="이체오류처리팀", keywords=None, summary="착오송금 신고 접수") -> GptAnalysis:
    return GptAnalysis(
        summary=summary,
        department=department,
        keywords=["착오송금"] if keywords is None else keywords,
        risk_flags=RiskFlags(),
    )


def _judgement(level: AttentionLevel, reason_codes=None) -> JudgeResult:
    return JudgeResult(
        needs_attention=level != AttentionLevel.NONE,
        attention_level=level,
        reason_codes=reason_codes or [],
        recommended_agent_level=RecommendedAgentLevel.GENERAL,
    )


def test_high_attention_maps_to_high_incident_risk_with_reason():
    result = to_model_consultation_result(
        _gpt(),
        _judgement(AttentionLevel.HIGH, [AttentionReasonCode.FINANCIAL_ACCIDENT]),
    )
    assert result.incident_risk == IncidentRisk.HIGH
    assert result.risk_reason == "금융사고 발생"


def test_medium_and_none_both_collapse_to_low_risk():
    for level in (AttentionLevel.MEDIUM, AttentionLevel.NONE):
        result = to_model_consultation_result(_gpt(), _judgement(level))
        assert result.incident_risk == IncidentRisk.LOW
        assert result.risk_reason is None


def test_business_type_uses_first_keyword_falls_back_to_department():
    result = to_model_consultation_result(_gpt(keywords=["이체 오류", "환불"]), _judgement(AttentionLevel.NONE))
    assert result.business_type == "이체 오류"

    result_no_keywords = to_model_consultation_result(_gpt(keywords=[]), _judgement(AttentionLevel.NONE))
    assert result_no_keywords.business_type == "이체오류처리팀"


def test_consultation_card_emotion_is_always_unavailable():
    card = to_consultation_card(_gpt(), _judgement(AttentionLevel.HIGH, [AttentionReasonCode.FINANCIAL_ACCIDENT]))
    assert card.emotion.status == EmotionStatus.UNAVAILABLE
    assert card.emotion.score is None
    assert card.emotion.level is None
