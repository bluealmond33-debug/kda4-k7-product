"""전형진 라우팅 분류기 어댑터 테스트.

규칙 기반 분류는 외부 모델 파일 없이 동작하므로 게이팅 없이 항상 돈다. 로컬 ML 모델
(topic_classifier)이 필요한 3단계는 파일이 없으면 classify_transcript 내부에서 스킵되므로,
여기서는 규칙 기반 경로(긴급·이상거래·일반)만 검증한다.
"""

import pytest

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


# ── G005~G010 규칙 기반 폴백 (2026-07-27) ──────────────────────────────────
# ML 주제 분류 모델(topic_classifier) 파일이 없거나 확신도가 낮을 때, G001~G010 중
# G001~G003만 키워드 규칙이 있어 G005~G010은 전부 G004(기타)로 뭉개졌다. 자동이체
# 상담(G006)처럼 본인인증이 REQUIRED인 업무가 여기 걸리면 인증 자체가 트리거되지
# 않는 문제로 이어졌다(현장 시연 보고). 아래는 그 규칙 기반 폴백을 모델 없이도
# 검증한다 — CI에 모델 파일(joblib)이 없어도 결정적으로 통과해야 한다.

@pytest.fixture
def no_topic_model(monkeypatch):
    """topic_classifier가 없거나 실패하는 상황을 강제해 규칙 기반 폴백만 검증한다."""
    import app.services.routing.topic_classifier as topic_classifier

    def _unavailable(*_args, **_kwargs):
        raise FileNotFoundError("forced unavailable for test")

    monkeypatch.setattr(topic_classifier, "predict_bank_topic", _unavailable)


@pytest.mark.parametrize(
    "transcript,expected_code",
    [
        ("거래 내역이 이상한데요", "G005"),
        ("자동이체를 등록하고 싶어요", "G006"),
        ("자동이체 좀 해지해주세요", "G006"),
        ("적금을 해지하고 싶어요", "G007"),
        ("예금을 연장하고 싶은데요", "G007"),
        ("연체된 금액이 얼마나 되나요", "G008"),
        ("금리를 감면받을 수 있나요", "G009"),
        ("환전 수수료가 얼마인가요", "G010"),
        # G011~G013 (2026-07-27 추가) — 활성 분류기(GENERAL_TASKS)에 누락돼 있었다.
        ("주택청약 통장 만들고 싶어요", "G011"),
        ("연금저축 계좌 문의드려요", "G012"),
        ("카드 관련해서 종합 상담 받고 싶어요", "G013"),
    ],
)
def test_general_subtask_rule_fallback_without_ml_model(
    no_topic_model, transcript, expected_code
):
    result = classify_routing(transcript)
    assert result.classification == "GENERAL"
    assert result.task_code == expected_code
    assert result.handler == "HUMAN"


def test_자동이체_상담은_본인인증_required이다(no_topic_model):
    """G006은 계좌 출금권한이 바뀌는 업무라 상담사 연결 전 키패드 인증이 REQUIRED여야 한다."""
    result = classify_routing("자동이체를 등록하고 싶어요")
    assert result.task_code == "G006"
    assert result.auth_policy == "REQUIRED"
    assert result.auth_required is True


@pytest.mark.parametrize("transcript,expected_code", [
    ("주택청약 통장 만들고 싶어요", "G011"),
    ("연금저축 계좌 문의드려요", "G012"),
    ("카드 관련해서 종합 상담 받고 싶어요", "G013"),
])
def test_신규_업무코드는_본인인증_not_required이다(no_topic_model, transcript, expected_code):
    """G011~G013은 조회·상담 위주라 계좌/카드 상태가 바뀌는 REQUIRED 업무와 다르다 —
    접수 단계에서는 인증 없이 받는다(2026-07-27 요청)."""
    result = classify_routing(transcript)
    assert result.task_code == expected_code
    assert result.auth_policy == "NOT_REQUIRED"
    assert result.auth_required is False


@pytest.mark.parametrize("transcript", [
    "실수로 다른 계좌번호로 보내버렸어요",
    "계좌번호를 잘못 입력했어요",
])
def test_착오송금_자연어_표현은_G001이다(no_topic_model, transcript):
    """격식체("착오송금")가 아닌 자연어 표현도 G001로 잡혀야 한다 — main 브랜치에서
    추가됐던 키워드가 personal 병합 과정에서 빠지지 않았는지 확인하는 회귀 테스트."""
    result = classify_routing(transcript)
    assert result.task_code == "G001"
    assert result.classification == "GENERAL"
