"""4단계: 주의 여부 판단 — 순수 규칙 기반 함수.

⚠️ 임시 구현 — 원래 Urgency Score/라우팅 산정은 전형진 팀 담당(팀 R&R 최종안 기준: 감정강도 점수
+ 보이스피싱 위험 신호 매칭 개수 합산). 이 파일의 규칙은 그 팀 기준이 나오기 전까지 쓰는 자체 설계
버전이며, 라벨링 기준(카테고리/감정분류/긴급도) 팀 합의 결과가 나오면 이 로직 전체를 재검토해야 함.

외부 I/O 없음 (GPT/API 호출 없음) → 유닛 테스트로 전량 검증 가능.

수준 산정 기준 (요구사항 원문):
- 중요 위험 1개 이상 → 높음
- 위험 1개 + 정보 부족 1개 이상 → 높음 (위 규칙에 포함되므로 별도 분기 불필요)
- 정보 부족 2개 이상 또는 복합 상담 1개 이상 → 보통
- 고객 상태 주의만 해당 → 보통
- 해당 없음 → 주의 불필요

권장 상담사 수준은 스펙에 매핑표가 없어 다음 기준으로 자체 설계함(assumption):
- 신용정보 노출/원격제어앱/통제권상실/실피해 중 하나라도 있는 '높음' → 사고전문
- 그 외 '높음'(예: 보호조치 미완료만 해당) → 숙련
- '보통' → 전문
- '주의 불필요' → 일반
"""

from app.schemas import (
    AttentionLevel,
    AttentionReasonCode,
    EmotionResult,
    JudgeResult,
    RecommendedAgentLevel,
    RiskFlags,
)

EMOTION_HIGH_THRESHOLD = 0.6
UNCERTAINTY_HIGH_THRESHOLD = 0.5

_SEVERE_ACCIDENT_CODES = {
    AttentionReasonCode.FINANCIAL_ACCIDENT,
    AttentionReasonCode.CREDENTIAL_EXPOSED,
    AttentionReasonCode.REMOTE_APP_INSTALLED,
    AttentionReasonCode.CONTROL_LOST,
}


def _financial_accident_codes(flags: RiskFlags) -> list[AttentionReasonCode]:
    codes = []
    if flags.actual_damage_occurred:
        codes.append(AttentionReasonCode.FINANCIAL_ACCIDENT)
    if flags.credential_exposed:
        codes.append(AttentionReasonCode.CREDENTIAL_EXPOSED)
    if flags.remote_app_installed:
        codes.append(AttentionReasonCode.REMOTE_APP_INSTALLED)
    if flags.control_lost:
        codes.append(AttentionReasonCode.CONTROL_LOST)
    if flags.protection_measures_incomplete:
        codes.append(AttentionReasonCode.PROTECTION_NOT_DONE)
    return codes


def _info_gap_count(flags: RiskFlags) -> int:
    return sum(
        [
            flags.damage_amount_unknown,
            flags.transfer_time_unknown,
            flags.payment_hold_status_unknown,
            flags.protection_status_unknown,
            flags.other_critical_info_missing,
        ]
    )


def _complex_codes(flags: RiskFlags) -> list[AttentionReasonCode]:
    codes = []
    if flags.multiple_issues_present or flags.multiple_procedures_applicable:
        codes.append(AttentionReasonCode.MULTIPLE_INTENTS)
    if flags.repeat_contact_same_case:
        codes.append(AttentionReasonCode.REPEAT_CONTACT)
    if flags.prior_resolution_failed:
        codes.append(AttentionReasonCode.PRIOR_RESOLUTION_FAILED)
    return codes


def _is_customer_state_alert(flags: RiskFlags, emotion: EmotionResult) -> bool:
    high_intensity = (
        emotion.anger_probability >= EMOTION_HIGH_THRESHOLD
        or emotion.anxiety_probability >= EMOTION_HIGH_THRESHOLD
    )
    high_uncertainty = emotion.uncertainty >= UNCERTAINTY_HIGH_THRESHOLD
    repeat_with_intensity = flags.repeat_contact_same_case and high_intensity
    return high_intensity or high_uncertainty or repeat_with_intensity


def _recommended_agent_level(
    level: AttentionLevel, accident_codes: list[AttentionReasonCode]
) -> RecommendedAgentLevel:
    if level == AttentionLevel.HIGH:
        if any(code in _SEVERE_ACCIDENT_CODES for code in accident_codes):
            return RecommendedAgentLevel.ACCIDENT_SPECIALIST
        return RecommendedAgentLevel.EXPERIENCED
    if level == AttentionLevel.MEDIUM:
        return RecommendedAgentLevel.SPECIALIST
    return RecommendedAgentLevel.GENERAL


def judge(flags: RiskFlags, emotion: EmotionResult) -> JudgeResult:
    accident_codes = _financial_accident_codes(flags)
    info_gap_count = _info_gap_count(flags)
    complex_codes = _complex_codes(flags)
    customer_state_alert = _is_customer_state_alert(flags, emotion)

    reason_codes = list(accident_codes)
    if info_gap_count > 0:
        reason_codes.append(AttentionReasonCode.MISSING_CRITICAL_INFO)
    reason_codes.extend(complex_codes)
    if customer_state_alert:
        reason_codes.append(AttentionReasonCode.HIGH_EMOTIONAL_DISTRESS)

    if len(accident_codes) >= 1:
        level = AttentionLevel.HIGH
    elif info_gap_count >= 2 or len(complex_codes) >= 1:
        level = AttentionLevel.MEDIUM
    elif customer_state_alert:
        level = AttentionLevel.MEDIUM
    else:
        level = AttentionLevel.NONE

    return JudgeResult(
        needs_attention=level != AttentionLevel.NONE,
        attention_level=level,
        reason_codes=reason_codes,
        recommended_agent_level=_recommended_agent_level(level, accident_codes),
    )
