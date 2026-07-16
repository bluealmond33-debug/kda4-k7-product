import pytest

from app.model_adapter import (
    ModelAdapterError,
    load_postprocessing_rules,
    normalize_model_result,
)


BASE_RESULT = {
    "summary": "대출 만기 연장 및 필요 서류 문의",
    "business_type": "주택담보대출 만기 연장",
    "department": "대출 및 금융상담",
    "routing_reason": "대출 만기 연장 상담에 해당",
}


def test_adapter_defaults_missing_risk_to_low_and_ignores_experiment_fields() -> None:
    result = normalize_model_result({**BASE_RESULT, "experiment_logits": [0.1, 0.9]})
    assert result.incident_risk.value == "low"
    assert result.risk_reason is None
    assert "experiment_logits" not in result.model_dump()


def test_adapter_normalizes_korean_high_risk_label() -> None:
    result = normalize_model_result(
        {
            **BASE_RESULT,
            "incident_risk": "고위험",
            "risk_reason": "본인 미승인 계좌 개설 정황",
            "routing_confidence": 0.97,
        }
    )
    assert result.incident_risk.value == "high"
    assert result.routing_confidence == 0.97


@pytest.mark.parametrize("risk", ["high", "높음", "고위험"])
def test_adapter_rejects_high_risk_without_reason(risk: str) -> None:
    with pytest.raises(ModelAdapterError):
        normalize_model_result({**BASE_RESULT, "incident_risk": risk})


def test_adapter_rejects_unknown_risk_instead_of_guessing() -> None:
    with pytest.raises(ModelAdapterError, match="unsupported incident_risk"):
        normalize_model_result({**BASE_RESULT, "incident_risk": "긴급해보임"})


def test_financial_model_loan_labels_map_to_canonical_contract() -> None:
    result = normalize_model_result(
        {
            "summary": "주택담보대출 만기 연장과 필요 서류를 문의함.",
            "task_category": "대출",
            "consulting_situation": "만기 연장 문의",
            "qa_topic": "주택담보대출 만기 연장",
            "hidden_state": [0.2, 0.8],
        }
    )
    assert result.business_type == "주택담보대출 만기 연장"
    assert result.department == "대출 및 금융상담"
    assert result.incident_risk.value == "low"
    assert result.risk_reason is None
    assert result.routing_confidence == 0.95


def test_financial_model_fraud_labels_create_evidence_based_high_risk() -> None:
    result = normalize_model_result(
        {
            "summary": "고객이 본인 모르게 계좌가 개설되어 지급정지를 요청함.",
            "task_category": "전자금융",
            "consulting_situation": "명의도용 의심",
            "qa_topic": "무단 계좌 개설",
        }
    )
    assert result.department == "금융사기"
    assert result.incident_risk.value == "high"
    assert "명의도용" in (result.risk_reason or "")
    assert "지급정지" in (result.risk_reason or "")
    assert result.routing_confidence == 0.98


def test_financial_model_unmapped_labels_are_not_guessed() -> None:
    with pytest.raises(ModelAdapterError, match="unmapped financial model labels"):
        normalize_model_result(
            {
                "summary": "새로운 상품에 대해 문의함.",
                "task_category": "기타",
                "consulting_situation": "정보 요청",
                "qa_topic": "신규 상품",
            }
        )


def test_postprocessing_rules_are_versioned() -> None:
    rules = load_postprocessing_rules()
    assert rules["mapping_version"] == "mvp-1.0"
    assert len(rules["department_rules"]) == 6
