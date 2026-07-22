from app.schemas import (
    AttentionLevel,
    AttentionReasonCode,
    EmotionResult,
    JudgeResult,
    RecommendedAgentLevel,
    TextEmotionResult,
    VoiceAngerResult,
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

# ---------- WavLM 음성 분노 부스터 픽스처 ----------
# 격양도(EmotionResult.anger_probability) high/low — judge와 같은 0.6 임계 기준.
HIGH_AROUSAL_EMOTION = EmotionResult(
    anger_probability=0.8, anxiety_probability=0.1, neutral_probability=0.1, uncertainty=0.2
)
LOW_AROUSAL_EMOTION = EmotionResult(
    anger_probability=0.2, anxiety_probability=0.1, neutral_probability=0.7, uncertainty=0.2
)

ANGER_DETECTED = VoiceAngerResult(detected=True, probability=0.70, confidence=0.80)
ANGER_NOT_DETECTED = VoiceAngerResult(detected=False, probability=0.20, confidence=0.80)


def test_voice_anger_none_keeps_text_only_behavior_identical():
    """voice_anger 미제공(기본 None) → 기존 텍스트 전용 동작과 완전히 동일(하위호환)."""
    result = fuse_judgement(NONE_JUDGEMENT, CALM_TEXT, voice_anger=None, audio_emotion=None)

    assert result.attention_level == AttentionLevel.NONE
    assert result.needs_attention is False


def test_cold_anger_low_arousal_escalates_none_to_medium():
    """격양 low + 분노 yes = 냉정한 분노 — 격양도만으론 놓치는 케이스를 부스터가 잡는다."""
    result = fuse_judgement(
        NONE_JUDGEMENT, CALM_TEXT, voice_anger=ANGER_DETECTED, audio_emotion=LOW_AROUSAL_EMOTION
    )

    assert result.needs_attention is True
    assert result.attention_level == AttentionLevel.MEDIUM
    assert AttentionReasonCode.VOICE_ANGER_CALM in result.reason_codes
    assert result.recommended_agent_level == RecommendedAgentLevel.SPECIALIST


def test_anger_with_high_arousal_escalates_none_to_medium_distinct_reason():
    """격양 high + 분노 yes = 분노 격앙 — MEDIUM은 같지만 근거 코드로 4셀을 구분한다."""
    result = fuse_judgement(
        NONE_JUDGEMENT, CALM_TEXT, voice_anger=ANGER_DETECTED, audio_emotion=HIGH_AROUSAL_EMOTION
    )

    assert result.attention_level == AttentionLevel.MEDIUM
    assert AttentionReasonCode.VOICE_ANGER_WITH_AROUSAL in result.reason_codes
    assert AttentionReasonCode.VOICE_ANGER_CALM not in result.reason_codes


def test_no_anger_low_arousal_stays_none():
    """격양 low + 분노 no = 안정 — 부스터 무동작."""
    result = fuse_judgement(
        NONE_JUDGEMENT, CALM_TEXT, voice_anger=ANGER_NOT_DETECTED, audio_emotion=LOW_AROUSAL_EMOTION
    )

    assert result.attention_level == AttentionLevel.NONE


def test_no_anger_high_arousal_booster_stays_out():
    """격양 high + 분노 no = judge 몫 — 부스터는 관여하지 않는다(분노 근거 코드 안 붙음)."""
    result = fuse_judgement(
        NONE_JUDGEMENT, CALM_TEXT, voice_anger=ANGER_NOT_DETECTED, audio_emotion=HIGH_AROUSAL_EMOTION
    )

    assert result.attention_level == AttentionLevel.NONE
    assert AttentionReasonCode.VOICE_ANGER_WITH_AROUSAL not in result.reason_codes
    assert AttentionReasonCode.VOICE_ANGER_CALM not in result.reason_codes


def test_anger_without_audio_emotion_defaults_to_cold_anger():
    """audio_emotion 미제공 → 격양도 알 수 없어 보수적으로 냉정한 분노(MEDIUM)로 승격."""
    result = fuse_judgement(
        NONE_JUDGEMENT, CALM_TEXT, voice_anger=ANGER_DETECTED, audio_emotion=None
    )

    assert result.attention_level == AttentionLevel.MEDIUM
    assert AttentionReasonCode.VOICE_ANGER_CALM in result.reason_codes


def test_voice_anger_never_downgrades_existing_high():
    """이미 HIGH(사고위험)면 음성 분노(MEDIUM)로 내리지 않고 그대로 둔다."""
    result = fuse_judgement(
        HIGH_JUDGEMENT, CALM_TEXT, voice_anger=ANGER_DETECTED, audio_emotion=LOW_AROUSAL_EMOTION
    )

    assert result.attention_level == AttentionLevel.HIGH
    assert result.reason_codes == [AttentionReasonCode.FINANCIAL_ACCIDENT]


def test_voice_anger_does_not_re_escalate_existing_medium():
    """이미 MEDIUM이면 음성 분노(MEDIUM)는 레벨을 바꾸지 않는다(에스컬레이션 전용)."""
    result = fuse_judgement(
        MEDIUM_JUDGEMENT, CALM_TEXT, voice_anger=ANGER_DETECTED, audio_emotion=HIGH_AROUSAL_EMOTION
    )

    assert result.attention_level == AttentionLevel.MEDIUM
    assert result.reason_codes == [AttentionReasonCode.MULTIPLE_INTENTS]


def test_text_and_voice_both_medium_combine_reason_codes():
    """텍스트 감정 + 음성 분노가 함께 MEDIUM으로 밀면 두 근거가 모두 기록된다."""
    result = fuse_judgement(
        NONE_JUDGEMENT, ANGRY_URGENT_TEXT, voice_anger=ANGER_DETECTED, audio_emotion=LOW_AROUSAL_EMOTION
    )

    assert result.attention_level == AttentionLevel.MEDIUM
    assert AttentionReasonCode.HIGH_EMOTIONAL_DISTRESS in result.reason_codes
    assert AttentionReasonCode.VOICE_ANGER_CALM in result.reason_codes


def test_voice_anger_escalates_even_when_text_emotion_is_none():
    """텍스트 분석 실패(None)여도 음성 분노만으로 부스터가 MEDIUM으로 올린다."""
    result = fuse_judgement(
        NONE_JUDGEMENT, None, voice_anger=ANGER_DETECTED, audio_emotion=LOW_AROUSAL_EMOTION
    )

    assert result.attention_level == AttentionLevel.MEDIUM
    assert AttentionReasonCode.VOICE_ANGER_CALM in result.reason_codes


def test_all_signals_none_keeps_judgement_unchanged():
    """text=None + voice=None → 완전 무동작(하위호환)."""
    result = fuse_judgement(MEDIUM_JUDGEMENT, None)

    assert result.attention_level == AttentionLevel.MEDIUM
    assert result.reason_codes == [AttentionReasonCode.MULTIPLE_INTENTS]


def test_text_high_takes_priority_but_records_voice_anger_reason():
    """텍스트가 HIGH로 밀면 레벨은 HIGH, 음성 분노(MEDIUM) 근거도 함께 남는다."""
    result = fuse_judgement(
        NONE_JUDGEMENT,
        DANGEROUS_BUT_CALM_TONE_TEXT,
        voice_anger=ANGER_DETECTED,
        audio_emotion=HIGH_AROUSAL_EMOTION,
    )

    assert result.attention_level == AttentionLevel.HIGH
    assert AttentionReasonCode.TEXT_HIGH_RISK_SIGNAL in result.reason_codes
    assert AttentionReasonCode.VOICE_ANGER_WITH_AROUSAL in result.reason_codes
    assert result.recommended_agent_level == RecommendedAgentLevel.EXPERIENCED


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
