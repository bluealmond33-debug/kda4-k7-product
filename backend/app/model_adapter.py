"""Normalize replaceable team-model output into the active K7 MVP contract.

The model team may change its implementation or include experiment metadata.
Only the fields accepted here cross the FastAPI -> PostgreSQL boundary.
"""

from collections.abc import Mapping
from typing import Any

from app.contracts import ModelConsultationResult


class ModelAdapterError(ValueError):
    """Raised when a model result cannot be normalized without guessing."""


_RISK_ALIASES = {
    "low": "low",
    "high": "high",
    "낮음": "low",
    "저위험": "low",
    "높음": "high",
    "고위험": "high",
}

_ACTIVE_FIELDS = {
    "summary",
    "business_type",
    "department",
    "routing_reason",
    "incident_risk",
    "risk_reason",
    "routing_confidence",
}


def normalize_model_result(payload: Mapping[str, Any]) -> ModelConsultationResult:
    """Return the one canonical summary/classification/routing result.

    Unknown experiment fields are deliberately discarded. Missing risk means
    low for this two-level MVP; a high-risk result is rejected unless it also
    explains the evidence in ``risk_reason``.
    """

    if not isinstance(payload, Mapping):
        raise ModelAdapterError("model result must be a JSON object")

    normalized = {key: payload[key] for key in _ACTIVE_FIELDS if key in payload}
    raw_risk = normalized.get("incident_risk")
    if raw_risk is None:
        normalized["incident_risk"] = "low"
    elif isinstance(raw_risk, str):
        mapped_risk = _RISK_ALIASES.get(raw_risk.strip())
        if mapped_risk is None:
            raise ModelAdapterError(f"unsupported incident_risk: {raw_risk}")
        normalized["incident_risk"] = mapped_risk
    else:
        raise ModelAdapterError("incident_risk must be a string or null")

    try:
        return ModelConsultationResult.model_validate(normalized)
    except ValueError as exc:
        raise ModelAdapterError(str(exc)) from exc
