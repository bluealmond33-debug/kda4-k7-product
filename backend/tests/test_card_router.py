"""카드 라우터 단위 테스트 — taxonomy 정합 + 긴급 오버라이드/폴백.

LLM 호출 없이 AI 분석기의 보정·오버라이드 헬퍼와 taxonomy 규칙만 검증한다.
"""

from app.model_adapter import normalize_model_result
from app.card_routing_pipeline import (
    _apply_emergency_override,
    _emergency_fallback_result,
    _sanitize_analysis_result,
)
from app.rag.taxonomy import CATEGORY_CODES as RAG_CATEGORY_CODES
from app.routing.emergency_gate import check_emergency
from app.routing.taxonomy import (
    BUSINESS_CODES,
    DEPARTMENTS,
    EMERGENCY_DEPARTMENT_LABEL,
    is_valid_business_code,
)


# ── taxonomy 정합 ─────────────────────────────────────────────────────────

def test_departments_align_with_rag_categories() -> None:
    """라우팅 부서(7종)는 규정검색 대분류의 부분집합 — 부서→규정 필터 항등 매핑.

    hippo 7/22 확정 taxonomy: 라우팅 부서는 7종, RAG 대분류는 8종.
    ETC(제도·민원·기타)는 문서 분류 전용이며 콜이 배정되는 큐가 아니다.
    """
    assert set(DEPARTMENTS) <= set(RAG_CATEGORY_CODES)
    assert "ETC" not in DEPARTMENTS
    assert len(DEPARTMENTS) == 7


def test_business_codes_map_to_valid_departments() -> None:
    for code, (dept, ars_code, _label) in BUSINESS_CODES.items():
        assert dept in DEPARTMENTS, f"{code} -> 없는 부서 {dept}"
        assert ars_code.startswith("G")
    # kdh 전처리 산출물(registry.csv)이 쓰는 코드가 모두 등록돼 있어야 한다
    for kdh_code in ("subscription", "deposit", "loan", "fx", "pension", "misremit"):
        assert is_valid_business_code(kdh_code)


def test_subscription_pension_card_business_codes_are_not_swapped() -> None:
    """G011(주택청약)·G012(연금·IRP)이 한때 서로 반대로(subscription↔G012, pension↔G011)
    연결돼 있었다(2026-07-27 발견) — 재발 방지용 고정 회귀 테스트."""
    assert BUSINESS_CODES["subscription"] == ("DEP", "G011", "주택청약")
    assert BUSINESS_CODES["pension"] == ("INV", "G012", "연금·IRP")
    assert BUSINESS_CODES["card"] == ("CRD", "G013", "카드이용")


def test_emergency_department_is_sg() -> None:
    assert DEPARTMENTS["SG"] == EMERGENCY_DEPARTMENT_LABEL == "사고·신고"


# ── AI 분석기 보정 (_sanitize) ────────────────────────────────────────────

def _llm_raw(**overrides) -> dict:
    raw = {
        "summary": "전세자금대출 만기 연장 문의",
        "business_type": "대출 만기 연장",
        "routing": "G",
        "department": "여신·대출",
        "business_code": "loan",
        "routing_reason": "대출 상담 필요",
        "incident_risk": "low",
        "risk_reason": None,
        "routing_confidence": 0.9,
    }
    raw.update(overrides)
    return raw


def test_sanitize_drops_unknown_business_code() -> None:
    raw = _sanitize_analysis_result(_llm_raw(business_code="made_up_code"))
    assert raw["business_code"] is None


def test_sanitize_defaults_unknown_routing_to_general() -> None:
    raw = _sanitize_analysis_result(_llm_raw(routing="X"))
    assert raw["routing"] == "G"


def test_sanitize_forces_sg_department_when_routing_is_emergency() -> None:
    raw = _sanitize_analysis_result(_llm_raw(routing="E", department="여신·대출"))
    assert raw["department"] == EMERGENCY_DEPARTMENT_LABEL


# ── 긴급 오버라이드 / 폴백 ────────────────────────────────────────────────

def test_gate_override_forces_emergency_routing() -> None:
    gate = check_emergency("경찰에서 전화왔어 5000만원 보내래")
    raw = _apply_emergency_override(_llm_raw(), gate)
    assert raw["routing"] == "E"
    assert raw["department"] == EMERGENCY_DEPARTMENT_LABEL
    assert raw["incident_risk"] == "high"
    assert "긴급 게이트" in raw["routing_reason"]
    # 오버라이드 결과는 mvp-1.0 계약을 그대로 통과해야 한다
    normalized = normalize_model_result(raw)
    assert normalized.department == EMERGENCY_DEPARTMENT_LABEL
    assert normalized.incident_risk.value == "high"


def test_gate_override_preserves_llm_risk_reason() -> None:
    gate = check_emergency("검찰이라는데 안전계좌로 돈을 보내라고 해요")
    raw = _apply_emergency_override(
        _llm_raw(incident_risk="high", risk_reason="LLM이 본 사기 정황"), gate
    )
    assert "LLM이 본 사기 정황" in raw["risk_reason"]
    assert "긴급 게이트" in raw["risk_reason"]


def test_emergency_fallback_routes_without_llm() -> None:
    """LLM이 죽어도 긴급 콜은 규칙 결과만으로 mvp-1.0 계약을 만족해야 한다."""
    transcript = "경찰에서 전화왔어 5000만원 보내래"
    gate = check_emergency(transcript)
    raw = _emergency_fallback_result(transcript, gate)
    normalized = normalize_model_result(raw)
    assert normalized.department == EMERGENCY_DEPARTMENT_LABEL
    assert normalized.incident_risk.value == "high"
    assert transcript[:20] in normalized.summary
