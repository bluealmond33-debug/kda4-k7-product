"""정책 결합기 — 음향(격앙도)과 텍스트(내용·상황 심각도) 신호를 합쳐 judge 결과를 보정한다.

박정운(Jeongwoon Park)님 격양도 설계문서(2026-07-15) + 2026-07-20 심층 리뷰(P0-1)의 우선순위
캐스케이드를 그대로 구현한다:

    1. 명시적 고위험 룰 적중(risk_flags) → HIGH                    (judge.py가 이미 담당)
    2. situation_severity=high + 근거 있음                          → 최소 HIGH까지 에스컬레이션
    3. 강한 감정 표현 + urgency_score 높음                          → 최소 MEDIUM까지 에스컬레이션
    4. 음향 격양도만 높음                                           → 판정은 유지, 우선순위만 보조

judge.py(오디오+risk_flags 기반 순수 규칙, 유닛테스트 완비)는 시그니처를 바꾸지 않는다. 이
모듈은 그 결과를 텍스트 신호로 "최소 이 레벨까지는 확실히 올린다"는 방식으로만 감싼다 —
어디서 시작했든(NONE/MEDIUM) 텍스트가 더 높은 위험을 시사하면 그 레벨까지 올리고, 텍스트가
조용하다는 이유로 이미 나온 판정을 절대 내리지 않는다(에스컬레이션 전용).

"근거 있음" 체크는 텍스트 모델이 스스로 "근거 없음"이라 밝힌 경우를 걸러내기 위한 것 —
situation_severity=high인데 근거 문장이 없으면 승격하지 않는다(박정운님 리뷰의 "스키마·신뢰도
검증 통과" 요건 중 근거 유무 부분).
"""

from app.schemas import (
    AttentionLevel,
    AttentionReasonCode,
    JudgeResult,
    RecommendedAgentLevel,
    TextEmotionResult,
)

_STRONG_TEXT_EMOTIONS = {"분노", "불안", "당황", "불만"}
_URGENCY_HIGH_THRESHOLD = 70
_NO_EVIDENCE_MARKERS = {"", "근거 없음", "근거없음"}

_LEVEL_ORDER = {
    AttentionLevel.NONE: 0,
    AttentionLevel.MEDIUM: 1,
    AttentionLevel.HIGH: 2,
}


def _has_evidence(text_emotion: TextEmotionResult) -> bool:
    return text_emotion.evidence.strip() not in _NO_EVIDENCE_MARKERS


def _text_target_level(
    text_emotion: TextEmotionResult,
) -> tuple[AttentionLevel, AttentionReasonCode] | None:
    if text_emotion.situation_severity == "high" and _has_evidence(text_emotion):
        return AttentionLevel.HIGH, AttentionReasonCode.TEXT_HIGH_RISK_SIGNAL

    strong_emotion = text_emotion.content_emotion in _STRONG_TEXT_EMOTIONS
    if strong_emotion and text_emotion.urgency_score >= _URGENCY_HIGH_THRESHOLD:
        return AttentionLevel.MEDIUM, AttentionReasonCode.HIGH_EMOTIONAL_DISTRESS

    return None


def fuse_judgement(judgement: JudgeResult, text_emotion: TextEmotionResult) -> JudgeResult:
    target = _text_target_level(text_emotion)
    if target is None:
        return judgement  # 텍스트도 조용함 - 그대로 유지

    target_level, reason_code = target
    if _LEVEL_ORDER[judgement.attention_level] >= _LEVEL_ORDER[target_level]:
        return judgement  # 이미 그 이상 단계 - 텍스트로 내리지 않음(에스컬레이션 전용)

    reason_codes = list(judgement.reason_codes)
    if reason_code not in reason_codes:
        reason_codes.append(reason_code)

    recommended_agent_level = (
        RecommendedAgentLevel.EXPERIENCED
        if target_level == AttentionLevel.HIGH
        else RecommendedAgentLevel.SPECIALIST
    )

    return JudgeResult(
        needs_attention=True,
        attention_level=target_level,
        reason_codes=reason_codes,
        recommended_agent_level=recommended_agent_level,
    )
