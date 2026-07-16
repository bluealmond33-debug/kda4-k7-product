import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.contracts import ModelConsultationResult, MvpCallResponse


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


def test_active_schema_is_three_table_mvp() -> None:
    schema = (ROOT / "database/mvp/schema.sql").read_text(encoding="utf-8")
    assert schema.count("CREATE TABLE IF NOT EXISTS") == 3
    assert "masked_transcript" not in schema
    assert "access_logs" not in schema
