"""정책 결합기 — 음향(격앙도)과 텍스트(내용·상황심각도) 신호를 합쳐 judge 결과를 보정한다.

박정운 격양도 모델 설계문서(2026-07-15) 원칙: "명시적 고위험 룰이 있으면 격양도가 낮아도
고위험 경로를 선택한다." judge.py는 이미 risk_flags(GPT가 뽑은 명시적 위험)와 오디오
감정(EmotionResult)만으로 순수 규칙 판정을 하는 유닛테스트 완비 함수라 시그니처를 바꾸지
않는다 — 대신 이 모듈이 그 결과를 텍스트 신호로 감싸서 필요할 때만 "올린다."

방향은 에스컬레이션 전용이다: 텍스트가 위험을 시사하면 판정을 올릴 수 있지만, 텍스트가
조용하다고 해서 이미 나온 HIGH/MEDIUM 판정을 내리지 않는다 — 차분한 목소리로 위험한 내용을
말하는 경우(risk_flags가 놓쳤을 때의 안전망)를 잡기 위한 것이지, 음향·규칙 판정을
텍스트로 무효화하기 위한 게 아니다.
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


def _text_signals_distress(text_emotion: TextEmotionResult) -> bool:
    return text_emotion.situation_severity == "high" or (
        text_emotion.content_emotion in _STRONG_TEXT_EMOTIONS
        and text_emotion.urgency_score >= _URGENCY_HIGH_THRESHOLD
    )


def fuse_judgement(judgement: JudgeResult, text_emotion: TextEmotionResult) -> JudgeResult:
    if judgement.attention_level != AttentionLevel.NONE:
        return judgement  # risk_flags·오디오 쪽에서 이미 잡음 - 텍스트로 내리지 않음
    if not _text_signals_distress(text_emotion):
        return judgement  # 텍스트도 조용함 - 그대로 유지

    reason_codes = list(judgement.reason_codes)
    if AttentionReasonCode.HIGH_EMOTIONAL_DISTRESS not in reason_codes:
        reason_codes.append(AttentionReasonCode.HIGH_EMOTIONAL_DISTRESS)

    return JudgeResult(
        needs_attention=True,
        attention_level=AttentionLevel.MEDIUM,
        reason_codes=reason_codes,
        recommended_agent_level=RecommendedAgentLevel.SPECIALIST,
    )
