"""정책 결합기 — 음향(격앙도)·텍스트(내용·상황 심각도)·음성 분노 신호를 합쳐 judge 결과를 보정한다.

박정운(Jeongwoon Park)님 격양도 설계문서(2026-07-15) + 2026-07-20 심층 리뷰(P0-1)의 우선순위
캐스케이드를 그대로 구현한다:

    1. 명시적 고위험 룰 적중(risk_flags) → HIGH                    (judge.py가 이미 담당)
    2. situation_severity=high + 근거 있음                          → 최소 HIGH까지 에스컬레이션
    3. 강한 감정 표현 + urgency_score 높음                          → 최소 MEDIUM까지 에스컬레이션
    3b. 음성 분노 감지(WavLM)                                       → 최소 MEDIUM까지 에스컬레이션
    4. 음향 격양도만 높음                                           → 판정은 유지, 우선순위만 보조

judge.py(오디오+risk_flags 기반 순수 규칙, 유닛테스트 완비)는 시그니처를 바꾸지 않는다. 이
모듈은 그 결과를 텍스트/음성 분노 신호로 "최소 이 레벨까지는 확실히 올린다"는 방식으로만 감싼다 —
어디서 시작했든(NONE/MEDIUM) 더 높은 위험을 시사하면 그 레벨까지 올리고, 신호가 조용하다는
이유로 이미 나온 판정을 절대 내리지 않는다(에스컬레이션 전용).

"근거 있음" 체크는 텍스트 모델이 스스로 "근거 없음"이라 밝힌 경우를 걸러내기 위한 것 —
situation_severity=high인데 근거 문장이 없으면 승격하지 않는다(박정운님 리뷰의 "스키마·신뢰도
검증 통과" 요건 중 근거 유무 부분).

음성 분노 부스터(rule 3b)는 WavLM 분노 탐지를 격양도(EmotionResult)와 '별개 축'으로 받는다.
격양도 값을 절대 덮어쓰지 않고 주의등급만 올린다 — 격양도가 높지 않은데 분노만 잡히는
'냉정한 분노(cold anger)'는 격양도(judge)가 놓치는 케이스라, 이 부스터가 유일하게 잡아준다.
감정 신호는 HIGH를 강제하지 않는다(HIGH는 사고위험 rule 1·2 전용, 감정은 최대 MEDIUM).
voice_anger가 없으면(None) 아무 동작도 하지 않아 기존 텍스트 전용 동작과 완전히 동일하다(하위호환).
"""

from app.schemas import (
    AttentionLevel,
    AttentionReasonCode,
    EmotionResult,
    JudgeResult,
    RecommendedAgentLevel,
    TextEmotionResult,
    VoiceAngerResult,
)

_STRONG_TEXT_EMOTIONS = {"분노", "불안", "당황", "불만"}
_URGENCY_HIGH_THRESHOLD = 70
_NO_EVIDENCE_MARKERS = {"", "근거 없음", "근거없음"}
# 격양도(EmotionResult.anger_probability)를 '높음'으로 볼 기준 — judge.EMOTION_HIGH_THRESHOLD과 정합.
_AROUSAL_HIGH_THRESHOLD = 0.6

_LEVEL_ORDER = {
    AttentionLevel.NONE: 0,
    AttentionLevel.MEDIUM: 1,
    AttentionLevel.HIGH: 2,
}


def _has_evidence(text_emotion: TextEmotionResult) -> bool:
    return text_emotion.evidence.strip() not in _NO_EVIDENCE_MARKERS


def _text_target_level(
    text_emotion: TextEmotionResult | None,
) -> tuple[AttentionLevel, AttentionReasonCode] | None:
    if text_emotion is None:
        return None
    if text_emotion.situation_severity == "high" and _has_evidence(text_emotion):
        return AttentionLevel.HIGH, AttentionReasonCode.TEXT_HIGH_RISK_SIGNAL

    strong_emotion = text_emotion.content_emotion in _STRONG_TEXT_EMOTIONS
    if strong_emotion and text_emotion.urgency_score >= _URGENCY_HIGH_THRESHOLD:
        return AttentionLevel.MEDIUM, AttentionReasonCode.HIGH_EMOTIONAL_DISTRESS

    return None


def _voice_anger_target_level(
    voice_anger: VoiceAngerResult | None,
    audio_emotion: EmotionResult | None,
) -> tuple[AttentionLevel, AttentionReasonCode] | None:
    """WavLM 음성 분노 → 에스컬레이션 목표 레벨. 격양도는 덮어쓰지 않고 참고만 한다.

    분노가 감지되지 않으면(또는 신호 자체가 없으면) None. 감지되면 최소 MEDIUM으로 올리되,
    격양도(arousal)와의 조합에 따라 근거 코드를 나눠 4셀을 구분한다:

        격양 high + 분노 yes → 분노 격앙        (VOICE_ANGER_WITH_AROUSAL)
        격양 low  + 분노 yes → 냉정한 분노       (VOICE_ANGER_CALM)  ← 격양도만으론 놓침
        격양 high + 분노 no  → judge가 이미 처리 (여기선 관여 안 함, None)
        격양 low  + 분노 no  → 안정              (None)

    감정은 HIGH를 만들지 않는다(HIGH는 사고위험 전용). 그래서 두 셀 모두 MEDIUM이고,
    구분은 레벨이 아니라 근거 코드로 남겨 상담 화면 안내 문구를 다르게 할 수 있게 한다.
    audio_emotion이 없으면(None) 격양도를 알 수 없으므로 보수적으로 '냉정한 분노'로 본다.
    """
    if voice_anger is None or not voice_anger.detected:
        return None

    arousal_high = (
        audio_emotion is not None
        and audio_emotion.anger_probability >= _AROUSAL_HIGH_THRESHOLD
    )
    reason_code = (
        AttentionReasonCode.VOICE_ANGER_WITH_AROUSAL
        if arousal_high
        else AttentionReasonCode.VOICE_ANGER_CALM
    )
    return AttentionLevel.MEDIUM, reason_code


def fuse_judgement(
    judgement: JudgeResult,
    text_emotion: TextEmotionResult | None,
    voice_anger: VoiceAngerResult | None = None,
    audio_emotion: EmotionResult | None = None,
) -> JudgeResult:
    """judge 결과를 텍스트·음성 분노 신호로 에스컬레이션한다(전용 — 절대 내리지 않음).

    voice_anger/audio_emotion은 선택 입력이다. 셋 다 없으면(기본값 None) 기존 텍스트 전용
    동작과 완전히 동일하다 — WavLM 실연결 전까지 프로덕션 경로는 바뀌지 않는다. text_emotion이
    None이어도(텍스트 분석 실패) 음성 분노만으로 부스터가 동작할 수 있다.
    """
    current = _LEVEL_ORDER[judgement.attention_level]

    targets: list[tuple[AttentionLevel, AttentionReasonCode]] = []
    text_target = _text_target_level(text_emotion)
    if text_target is not None:
        targets.append(text_target)
    voice_target = _voice_anger_target_level(voice_anger, audio_emotion)
    if voice_target is not None:
        targets.append(voice_target)

    # 에스컬레이션 전용: 현재보다 '높은' 신호만 채택하고, 조용하다는 이유로 내리지 않는다.
    escalating = [target for target in targets if _LEVEL_ORDER[target[0]] > current]
    if not escalating:
        return judgement

    target_level = max(escalating, key=lambda target: _LEVEL_ORDER[target[0]])[0]

    reason_codes = list(judgement.reason_codes)
    for _, reason_code in escalating:
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
