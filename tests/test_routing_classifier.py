"""전형진 라우팅 분류기 어댑터 테스트.

규칙 기반 분류는 외부 모델 파일 없이 동작하므로 게이팅 없이 항상 돈다. 로컬 ML 모델
(topic_classifier)이 필요한 3단계는 파일이 없으면 classify_transcript 내부에서 스킵되므로,
여기서는 규칙 기반 경로(긴급·이상거래·일반)만 검증한다.
"""

from app.schemas import RoutingResult
from app.services.routing_classifier import classify_routing, classify_routing_safe


def test_phishing_is_emergency():
    result = classify_routing(
        "모르는 번호로 금감원이라면서 계좌가 범죄에 연루됐다고 인증번호랑 계좌번호를 불러달래요"
    )
    assert isinstance(result, RoutingResult)
    assert result.classification == "EMERGENCY"
    assert result.task_code == "E001"
    assert result.handler == "HUMAN"


def test_unauthorized_transaction_is_emergency():
    result = classify_routing("통장에서 제가 안 한 출금이 세 건 찍혀 있어요")
    assert result.classification == "EMERGENCY"
    assert result.task_code == "E002"


# ── 해외 부정결제: 본인 아님을 '간접적으로' 말하는 경우 (2026-07-23) ──────────
# 시연 전사문에서 발견. 고객은 "내가 안 한"이라고 직접 말하지 않고 위치 모순
# ("전 지금 한국에 있는데")으로 표현해 unauthorized 신호가 하나도 잡히지 않았다.

def test_해외_부정결제_정지요청은_긴급이다():
    """실제 시연 전사문. 해외 결제 알림 + 즉시 정지 요청 = 사고 신고."""
    result = classify_routing(
        "저기요 지금 부산인데요 제 카드가 방금 해외에서 250달러 결제했다는 문자가 "
        "왔어요 전 지금 한국에 있는데 이거 돈 아닌 것 같아요 빨리 정지시켜주세요"
    )

    assert result.classification == "EMERGENCY", result.reason
    assert result.task_code == "E002"


def test_해외결제_문의만으로는_긴급이_아니다():
    """정지 요청 없이 묻기만 하면 일반 상담이어야 한다(오탐 방지)."""
    result = classify_routing("해외에서 카드 결제 되나요? 수수료가 어떻게 되는지 궁금해요")

    assert result.classification != "EMERGENCY"


def test_해외결제_실패_문의는_긴급이_아니다():
    """'정지'라는 말이 나와도 본인의 정지 요청이 아니면 긴급이 아니다(오탐 방지)."""
    result = classify_routing("해외에서 카드 결제가 자꾸 안 되는데 혹시 정지된 건가요")

    assert result.classification != "EMERGENCY"


def test_loan_inquiry_is_general_human():
    result = classify_routing("대출 금리 좀 알아보려고요")
    assert result.classification == "GENERAL"
    assert result.handler == "HUMAN"


def test_bare_institution_name_alone_is_not_emergency():
    """사칭 주체(금감원) 하나만으로는 긴급 처리하지 않는다 — 민감정보·금전 요구가 함께 있어야 함."""
    result = classify_routing("금융감독원 연락처가 어떻게 되나요")
    assert result.classification != "EMERGENCY"


def test_ambiguous_defaults_to_general_not_crash():
    result = classify_routing("어 그냥 뭐 좀 물어보려고요")
    assert result.classification in {"SIMPLE", "GENERAL", "EMERGENCY"}


def test_safe_wrapper_returns_result_on_success():
    result = classify_routing_safe("대출 상담 받고 싶어요")
    assert result is not None
    assert result.classification in {"SIMPLE", "GENERAL", "EMERGENCY"}
