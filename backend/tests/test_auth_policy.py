"""본인인증 필요 여부 게이트 테스트.

기준: 계좌·거래·계약을 특정해 조회·변경·실행하는 업무는 본인확인 필요,
상품 조건 안내 등 일반 정보성 문의는 불필요. `app/routing/auth_policy.py` 참고.
"""

import pytest

from app.routing.auth_policy import requires_identity_verification


AUTH_REQUIRED_CASES = [
    "금융사기·지급정지",
    "착오송금 반환",
    "금리인하요구",
    "대출 금리·이자",
    "대출 만기·연장·상환",
    "외화·해외송금",
    "계좌 개설·이용",
    "이체한도",
    "거래내역",
    "전자금융",
    "카드 문의",
    "연금·IRP",
]


@pytest.mark.parametrize("business_type", AUTH_REQUIRED_CASES)
def test_requires_auth_for_account_and_transaction_business(business_type: str) -> None:
    assert requires_identity_verification(business_type) is True


AUTH_NOT_REQUIRED_CASES = [
    "고객 민원",
    "예적금 안내",
    "일반 상담",
]


@pytest.mark.parametrize("business_type", AUTH_NOT_REQUIRED_CASES)
def test_does_not_require_auth_for_general_inquiries(business_type: str) -> None:
    assert requires_identity_verification(business_type) is False


def test_unknown_business_type_defaults_to_requiring_auth() -> None:
    # 정책 목록에 없는 새 업무유형은 안전 우선(recall floor)으로 필요 처리
    assert requires_identity_verification("아직 분류되지 않은 신규 업무") is True


def test_empty_business_type_does_not_require_auth() -> None:
    assert requires_identity_verification(None) is False
    assert requires_identity_verification("") is False
