"""전형진 라우팅 분류기 어댑터 테스트.

규칙 기반 분류는 외부 모델 파일 없이 동작하므로 게이팅 없이 항상 돈다. 로컬 ML 모델
(topic_classifier)이 필요한 3단계는 파일이 없으면 classify_transcript 내부에서 스킵되므로,
여기서는 규칙 기반 경로(긴급·이상거래·일반)만 검증한다.
"""

import pytest

from app.schemas import RoutingResult
from app.services.routing_classifier import classify_routing, classify_routing_safe, fast_auth_policy


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


# ── 사칭+금전 요구를 자연어로만 말하는 경우 (2026-07-28) ────────────────────
# "송금"/"이체" 같은 정확한 단어 없이 "보내라고 해요"로만 말하면 SENSITIVE_DEMANDS가
# 못 잡아 G004로 떨어졌었다(LLM 보완 경로 리뷰 중 발견).

def test_사칭_금전요구_자연어_표현도_긴급이다():
    result = classify_routing("검찰이라는 사람이 전화와서 안전계좌로 5000만원 보내라고 해요")
    assert result.classification == "EMERGENCY", result.reason
    assert result.task_code == "E001"


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


# ── G006 자연어 표현 보강 (2026-07-28 Windows 시연 오분류 재현) ──────────────
# "자동이체"라는 단어 없이 "다른 계좌에서 빠져나가도록 변경하고 싶거든요"라고 말한
# 실제 발화가 규칙 매칭에 전부 실패해 G004로 떨어졌고, 그 뒤 LLM 보완 분류가 카드
# 전용 S126(자동납부)으로 잘못 골랐다(카드 ARS 카탈로그가 은행 계좌 이체와 다른
# 도메인이라는 걸 LLM 프롬프트가 구분하지 못함). 아래는 규칙 기반 경로만으로 이
# 실제 발화가 G006으로 잡히는지 고정한다.

def test_windows_시연_보고된_자동이체_변경_발화는_G006이다(no_topic_model):
    """실제 보고된 발화를 그대로 재현 — 회귀 방지용 고정 테스트."""
    result = classify_routing(
        "지금 사용중인 계좌 말고 다른 계좌에서 빠져나가도록 변경하고 싶거든요. "
        "다른 달부터 적용되면 되고 급한 건 아니에요. 변경하려면 어떤 절차가 "
        "필요할까요? 한지 알려주세요."
    )
    assert result.task_code == "G006", result.reason
    assert result.classification == "GENERAL"
    assert result.handler == "HUMAN"
    assert result.auth_policy == "REQUIRED"


@pytest.mark.parametrize("transcript", [
    "출금계좌를 변경하고 싶어요",
    "출금 계좌를 바꾸고 싶은데요",
    "이체 계좌를 바꾸고 싶은데요",
    "매달 빠져나가는 계좌를 바꾸고 싶어요",
    "자동으로 빠져나가는 계좌 좀 바꿔주세요",
])
def test_G006_자연어_표현_보강(no_topic_model, transcript):
    result = classify_routing(transcript)
    assert result.task_code == "G006", result.reason


def test_과거형_미승인_출금_표현은_G006이_아니라_긴급이다(no_topic_model):
    """G006에 "빠져나가"류 키워드를 추가했다고 해서 이미 벌어진 미승인 출금 신고
    ("빠져나갔어요")까지 자동이체 상담으로 흡수해선 안 된다 — EMERGENCY가 우선."""
    result = classify_routing("제가 하지 않은 이체로 계좌에서 50만원이 빠져나갔어요")
    assert result.classification == "EMERGENCY"
    assert result.task_code == "E002"


# ── S1xx(카드 ARS) 자연어 표현 보강 (2026-07-28) ────────────────────────────

@pytest.mark.parametrize(
    "transcript,expected_code",
    [
        ("이번달 카드값이 얼마인지 알려주세요", "S101"),
        ("카드 한도 늘려주세요", "S105"),
        ("카드 비밀번호를 바꾸고 싶어요", "S112"),
        ("카드 새로 발급받고 싶어요", "S115"),
        ("6개월 할부로 바꾸고 싶어요", "S121"),
        ("리볼빙으로 해주세요", "S127"),
    ],
)
def test_S1xx_자연어_표현_보강(no_topic_model, transcript, expected_code):
    result = classify_routing(transcript)
    assert result.task_code == expected_code, result.reason
    assert result.classification == "SIMPLE"
    assert result.handler == "AI_CC"


def test_계좌_자동이체_요청은_카드_자동납부_S126이_아니다(no_topic_model):
    """S126은 카드 청구서 자동납부(공과금) 전용이다 — 은행 계좌 간 자동이체 변경
    요청이 카탈로그가 다른 S126으로 잘못 흡수되지 않는지 고정한다."""
    result = classify_routing("자동이체 계좌를 다른 통장으로 바꾸고 싶어요")
    assert result.task_code == "G006"
    assert result.task_code != "S126"


# ── LLM 보완 경로 end-to-end (2026-07-28) ───────────────────────────────────
# classify_task_with_llm 자체가 후보를 거부/수용하는 단위 테스트는 test_local_llm.py에
# 있다(S126 응답이 거부되는지는 거기서 실제 함수로 검증됨 — 여기서 그 함수를 통째로
# 목킹해 같은 걸 다시 확인하는 건 검증 대상을 없애는 셈이라 하지 않는다). 여기서는
# classify_routing() 전체 흐름에서 "LLM이 정상적으로 되살린 결과가 실제로 반영되는지"
# 만 end-to-end로 확인한다.

def test_LLM_보완이_규칙이_놓친_긴급발화를_되살릴_수_있다(monkeypatch, no_topic_model):
    """규칙이 (가상으로) G004로 떨어뜨린 사건이어도, LLM 보완이 E001을 답하면 최종
    결과가 EMERGENCY로 승격되는 배선을 확인한다. 특정 키워드 갭에 의존하지 않는
    합성 문구를 쓴다 — SENSITIVE_DEMANDS가 나중에 더 넓어져도 이 테스트는 안 깨진다."""
    import app.services.local_llm as local_llm

    text = "음 그냥 은행 관련해서 여쭤보려고 전화했어요"
    pre_check = classify_routing(text)  # settings 없이 — 규칙 기반만
    assert pre_check.task_code == "G004", "이 문구가 여전히 규칙 기반에서 G004로 떨어지는지 전제 확인"

    monkeypatch.setattr(local_llm, "classify_task_with_llm", lambda *_a, **_k: "E001")
    result = classify_routing(text, settings=object())
    assert result.classification == "EMERGENCY"
    assert result.task_code == "E001"


# ── fast_auth_policy: 애매한 첫마디만으로 인증을 조르지 않는다 (2026-07-28) ─────────
# call.py가 발화가 들어올 때마다(첫 마디부터) 누적 전사로 이 함수를 반복 호출한다.
# "안녕하세요" 한마디도 규칙 매칭이 다 실패해 G004로 떨어지고, G004는 정책상 REQUIRED
# 기본값이라, 문턱 없이 그대로 쓰면 고객이 용건을 말하기도 전에 인증 화면부터 떴다
# (실측 확인 — 의도한 동작 아님).

@pytest.mark.parametrize("greeting", ["안녕하세요", "네 안녕하세요", "어 저기요", "아 네"])
def test_fast_auth_policy_짧은_인사말만으로는_인증을_요구하지_않는다(greeting):
    assert fast_auth_policy(greeting) == "NOT_REQUIRED"


def test_fast_auth_policy_짧아도_명확한_업무는_바로_인증을_요구한다():
    """G004(애매함)만 유예 대상이다 — 키워드로 명확히 매칭된 업무는 문장이 짧아도
    그대로 신뢰한다(예: "카드 한도 늘려주세요"는 10자 미만이지만 S105로 명확히 잡힘)."""
    result = fast_auth_policy("카드 한도 늘려주세요")
    assert result == "REQUIRED"


def test_fast_auth_policy_명확한_요청은_인증을_요구한다():
    result = fast_auth_policy("다른 계좌에서 빠져나가도록 변경하고 싶거든요")
    assert result == "REQUIRED"


def test_fast_auth_policy_단순조회는_인증이_필요없다():
    result = fast_auth_policy("이번달 카드값이 얼마인지 알려주세요")
    assert result == "NOT_REQUIRED"


def test_fast_auth_policy_긴급상황은_인증을_건너뛴다():
    result = fast_auth_policy("검찰이라는 사람이 전화와서 안전계좌로 5000만원 보내라고 해요")
    assert result == "EXEMPT"


def test_fast_auth_policy_애매해도_누적_길이가_길어지면_인증을_요구한다(no_topic_model):
    """길이 문턱은 "아직 이르다"는 유예일 뿐, G004면 영원히 면제되는 게 아니다 — 통화가
    이어져 애매한 발화가 충분히 누적되면(여전히 G004) 원래 정책대로 REQUIRED가 나온다."""
    text = "음 그냥 은행 관련해서 여쭤보려고 전화했어요"
    assert len(text) >= 8
    result = fast_auth_policy(text)
    assert result == "REQUIRED"
