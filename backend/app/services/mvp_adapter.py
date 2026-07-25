"""K7 mvp-1.0 계약 어댑터 — 우리 기존 파이프라인(STT/GPT분석/judge) 결과를
이찬희 파트(kda4-k7-product/lch)가 정의한 ConsultationCard/MvpCallResponse 계약으로 변환한다.

감정: app/services/emotion.py::analyze_emotion_mvp()가 실제 모델(박정운 emotion_temperature)이
있으면 EmotionStatus.COMPLETED를, 없으면 UNAVAILABLE을 준다 — 어느 쪽이든 그대로 통과시킨다.
"""

from app.contracts import (
    ConsultationCard,
    IncidentRisk,
    ModelConsultationResult,
    MvpEmotionResult,
)
from app.routers.pipeline import _REASON_LABELS
from app.schemas import AttentionLevel, GptAnalysis, JudgeResult
from app.services.legacy_adapter import routing_reason as _routing_reason_text


def to_model_consultation_result(
    gpt_result: GptAnalysis, judgement: JudgeResult
) -> ModelConsultationResult:
    is_high = judgement.attention_level == AttentionLevel.HIGH
    reason_labels = [_REASON_LABELS[code] for code in judgement.reason_codes]

    return ModelConsultationResult(
        summary=gpt_result.summary,
        business_type=gpt_result.keywords[0] if gpt_result.keywords else gpt_result.department,
        department=gpt_result.department,
        routing_reason=_routing_reason_text(reason_labels, gpt_result.department),
        incident_risk=IncidentRisk.HIGH if is_high else IncidentRisk.LOW,
        risk_reason=", ".join(reason_labels) if is_high and reason_labels else None,
        routing_confidence=None,
    )


def unavailable_emotion() -> MvpEmotionResult:
    return MvpEmotionResult(reason="감정 모델은 아직 MVP 통합 전입니다.")


def to_consultation_card(
    gpt_result: GptAnalysis,
    judgement: JudgeResult,
    emotion: MvpEmotionResult | None = None,
) -> ConsultationCard:
    analysis = to_model_consultation_result(gpt_result, judgement)
    return ConsultationCard(**analysis.model_dump(), emotion=emotion or unavailable_emotion())
