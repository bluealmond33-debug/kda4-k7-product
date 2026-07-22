"""긴급 게이트 회귀 테스트.

케이스 출처(hippo):
- 00 Inbox/2026-07-21-분류기-긴급미탐-핫픽스: 실제 데모 제보 버그("경찰에서 전화왔어…")
- 00 Inbox/2026-07-21-routing-edge-cases-contrast-pairs: EM(긴급)/HN(하드네거티브) 대조쌍
"""

import pytest

from app.routing.emergency_gate import check_emergency


# ── 긴급으로 잡아야 하는 발화 (recall floor) ──────────────────────────────

EMERGENCY_CASES = [
    # 핫픽스 트리거 — 데모 제보 실버그 (사칭 주체 + 구어체 명령형 송금)
    "경찰에서 전화왔어 5000만원 보내래",
    # 핫픽스 — 안전계좌 + 사칭 주체 + 요구
    "검찰이라는데 안전계좌로 돈을 보내라고 해요",
    # EM-007 — 사칭 주체 + 안전계좌 + 명령형
    "검찰에서 지금 안전계좌로 돈 보내래요",
    # EM-006 — 사칭 주체 + 위협
    "경찰인데 계좌가 범죄에 연루돼서 체포된다고 겁줘요",
    # EM-001 — 명시적 피해 신고
    "저 방금 보이스피싱 당한 것 같아요",
    # EM-003 — 본인 미승인 출금(이상거래)
    "제가 하지도 않은 해외 결제가 카드에서 빠져나갔어요",
    # GR-0002 — 본인이 부인하는 출금: 정책 결정 = 긴급(안전 우선)
    "제가 사용하지 않은 출금 내역이 있는데 왜 빠져나갔는지 알려주세요",
    # 사칭 주체 '수사관' (핫픽스 추가 주체)
    "수사관님이 인증번호 알려달라고 하는데요",
    # 원격제어앱 설치 — 통제권 상실
    "아까 원격제어 앱을 깔았는데 이상해요",
]


@pytest.mark.parametrize("text", EMERGENCY_CASES)
def test_emergency_utterances_are_caught(text: str) -> None:
    result = check_emergency(text)
    assert result.is_emergency, f"긴급 미탐: {text}"
    assert result.reason


# ── 긴급으로 잡으면 안 되는 발화 (하드네거티브 — 과탐 가드) ────────────────

HARD_NEGATIVES = [
    # HN-005 — 기관 단순 언급 (요구·위협 없음)
    "경찰서에 분실물 신고하고 왔는데 카드 재발급 하려고요",
    # 핫픽스 과탐 가드 — 주체 단독
    "경찰서 근처 은행 몇 시까지 하나요",
    # HN-001 — 부정 표현이면 신호 무효
    "보이스피싱 아니고요 그냥 이체 한도 확인하려고요",
    # 핫픽스 과탐 가드 — 과거형 송금은 요구가 아님
    "은행 직원이 명세서를 보내줬어요",
    # HN-002 — 정상 맥락 주체(은행원)
    "은행 직원분이 이체 도와주셔서 잘 끝났고 거래내역만 확인하고 싶어요",
    # HN-003 — 민감어 단독 (인증번호)
    "인증번호 문자가 안 와서 재발송 받고 싶어요",
    # GR-0290 — 착오송금 '입금'은 일반 (원리 A3: 입금 vs 출금)
    "모르는 사람이 내 계좌로 돈을 보냈는데 중계요청 하려고요",
    # 일반 업무 — 신호 없음
    "전세자금대출 만기 연장하고 싶어서요",
    "계좌 잔액이 얼마예요",
]


@pytest.mark.parametrize("text", HARD_NEGATIVES)
def test_hard_negatives_pass_through(text: str) -> None:
    result = check_emergency(text)
    assert not result.is_emergency, f"긴급 과탐: {text}"


def test_empty_text_is_not_emergency() -> None:
    assert not check_emergency("").is_emergency
    assert not check_emergency("   ").is_emergency


def test_gate_reports_signals_for_audit() -> None:
    """게이트 판정은 브리핑카드에 '왜'를 보여줄 수 있어야 한다."""
    result = check_emergency("경찰에서 전화왔어 5000만원 보내래")
    assert result.is_emergency
    assert any("사칭주체" in s for s in result.signals)
    assert any("요구" in s for s in result.signals)
