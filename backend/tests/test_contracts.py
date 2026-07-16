import json
import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.contracts import EmotionResult, ModelConsultationResult, MvpCallResponse


ROOT = Path(__file__).resolve().parents[2]


def test_checked_in_example_matches_pydantic_contract() -> None:
    payload = json.loads(
        (ROOT / "database/contracts/examples/mvp_call_response.example.json").read_text(
            encoding="utf-8"
        )
    )
    response = MvpCallResponse.model_validate(payload)
    assert response.schema_version == "mvp-1.0"
    assert response.source_channel == "voice"
    assert response.consultation_card.department == "대출 및 금융상담"


@pytest.mark.parametrize(
    ("field", "value"),
    [("schema_version", "1.0"), ("source_channel", "text")],
)
def test_fixed_mvp_identifiers_cannot_drift(field: str, value: str) -> None:
    payload = json.loads(
        (ROOT / "database/contracts/examples/mvp_call_response.example.json").read_text(
            encoding="utf-8"
        )
    )
    payload[field] = value
    with pytest.raises(ValidationError):
        MvpCallResponse.model_validate(payload)


def test_mvp_contract_rejects_unknown_nested_fields() -> None:
    payload = json.loads(
        (ROOT / "database/contracts/examples/mvp_call_response.example.json").read_text(
            encoding="utf-8"
        )
    )
    payload["consultation_card"]["model_experiment"] = "must not cross API boundary"
    with pytest.raises(ValidationError):
        MvpCallResponse.model_validate(payload)


def test_numeric_contract_does_not_coerce_boolean() -> None:
    with pytest.raises(ValidationError):
        ModelConsultationResult(
            summary="대출 문의",
            business_type="대출",
            department="대출 및 금융상담",
            routing_reason="대출 상담 업무",
            routing_confidence=True,
        )


def test_high_risk_requires_reason() -> None:
    with pytest.raises(ValidationError):
        ModelConsultationResult(
            summary="명의도용 신고",
            business_type="명의도용·해킹 신고",
            department="금융사기",
            routing_reason="금융사기 신고 업무",
            incident_risk="high",
            risk_reason=None,
        )


def test_low_risk_allows_null_reason() -> None:
    result = ModelConsultationResult(
        summary="대출 만기 문의",
        business_type="대출 만기 연장",
        department="대출 및 금융상담",
        routing_reason="대출 상담 업무",
        incident_risk="low",
        risk_reason=None,
    )
    assert result.risk_reason is None


def test_active_emotion_contract_rejects_demo_status() -> None:
    with pytest.raises(ValidationError):
        EmotionResult(status="demo", score=50, level="caution")


def test_active_schema_is_three_table_mvp() -> None:
    schema = (ROOT / "database/mvp/schema.sql").read_text(encoding="utf-8")
    table_statements = re.findall(r"(?m)^CREATE TABLE IF NOT EXISTS\s+", schema)
    assert len(table_statements) == 3
    assert "masked_transcript" not in schema
    assert "access_logs" not in schema
    assert "consultation_cards_schema_version_chk" in schema
    assert "consultation_cards_available_emotion_chk" in schema
    assert "consultation_cards_active_emotion_status_chk" in schema
    assert "consultation_cards_emotion_level_chk" in schema
    assert "consultation_cards_temperature_band_chk" in schema
    assert "raw_emotion_result jsonb" in schema
