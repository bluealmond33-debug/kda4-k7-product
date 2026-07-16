import pytest

from app.model_adapter import ModelAdapterError, normalize_model_result


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
