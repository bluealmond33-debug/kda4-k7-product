from app.schemas import AttentionLevel, EmotionResult
from app.services.legacy_adapter import emotion_label_and_score, routing_reason, urgency_score_for


def test_urgency_score_high_beats_medium_beats_none():
    assert urgency_score_for(AttentionLevel.HIGH) > urgency_score_for(AttentionLevel.MEDIUM)
    assert urgency_score_for(AttentionLevel.MEDIUM) > urgency_score_for(AttentionLevel.NONE)


def test_emotion_label_picks_highest_probability():
    emotion = EmotionResult(
        anger_probability=0.1, anxiety_probability=0.7, neutral_probability=0.2, uncertainty=0.1
    )
    label, score = emotion_label_and_score(emotion)
    assert label == "불안"
    assert score == 0.7


def test_routing_reason_falls_back_to_department_when_no_reasons():
    assert routing_reason([], "카드분실신고팀") == "카드분실신고팀 담당 업무로 분류"


def test_routing_reason_joins_labels_when_present():
    assert routing_reason(["인증정보 노출", "핵심 정보 누락"], "전자금융팀") == "인증정보 노출, 핵심 정보 누락"
