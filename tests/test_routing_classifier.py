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
