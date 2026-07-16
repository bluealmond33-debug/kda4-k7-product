"""Normalize a provisional combined model result into K7 operating contracts.

This module intentionally has no third-party dependencies. FastAPI can import
normalize_model_result directly, while any team can use the CLI to inspect the
normalized consultation-card and routing-candidate payloads.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping


DEFAULT_MAPPING_PATH = Path(__file__).with_name("model_result_mapping.v1.json")
ALLOWED_INQUIRY_TYPES = {
    "mistaken_transfer",
    "voice_phishing_suspected",
    "lost_card",
    "overseas_payment",
    "account_opening",
    "payment_error",
    "loan",
    "general_inquiry",
    "other",
}
ALLOWED_RISK_LEVELS = {"low", "medium", "high", "critical"}
KNOWN_INPUT_FIELDS = {
    "external_session_key",
    "summary",
    "business_type",
    "department",
    "routing_reason",
    "incident_risk",
    "risk_reason",
    "routing_confidence",
    "model_name",
    "model_version",
    "generated_at",
}
DEPARTMENT_CODE_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")


class AdapterError(ValueError):
    """Raised when an input cannot be normalized safely."""


def load_mapping(path: str | Path | None = None) -> dict[str, Any]:
    """Load and minimally validate an editable adapter mapping."""

    mapping_path = Path(path) if path else DEFAULT_MAPPING_PATH
    with mapping_path.open("r", encoding="utf-8") as handle:
        mapping = json.load(handle)

    for key in (
        "adapter_version",
        "mapping_version",
        "defaults",
        "risk_labels",
        "department_aliases",
        "business_types",
    ):
        if key not in mapping:
            raise AdapterError(f"mapping is missing required key: {key}")

    for label, entry in mapping["business_types"].items():
        if not isinstance(label, str) or not label.strip():
            raise AdapterError("business type labels must be non-empty strings")
        inquiry_type = entry.get("inquiry_type")
        if inquiry_type not in ALLOWED_INQUIRY_TYPES:
            raise AdapterError(f"unsupported inquiry_type for {label}: {inquiry_type}")
        department_code = entry.get("department_code")
        if not isinstance(department_code, str) or not DEPARTMENT_CODE_PATTERN.fullmatch(
            department_code
        ):
            raise AdapterError(f"invalid department_code for {label}: {department_code}")
        for field in ("default_risk_level", "default_urgency_level"):
            value = entry.get(field)
            if value not in ALLOWED_RISK_LEVELS:
                raise AdapterError(f"invalid {field} for {label}: {value}")
        confidence = entry.get("routing_confidence")
        if not isinstance(confidence, (int, float)) or isinstance(confidence, bool):
            raise AdapterError(f"routing_confidence must be numeric for {label}")
        if not 0 <= float(confidence) <= 1:
            raise AdapterError(f"routing_confidence must be between 0 and 1 for {label}")

    return mapping


def _required_text(payload: Mapping[str, Any], field: str) -> str:
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        raise AdapterError(f"{field} must be a non-empty string")
    return value.strip()


def _optional_text(payload: Mapping[str, Any], field: str) -> str | None:
    value = payload.get(field)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise AdapterError(f"{field} must be null or a non-empty string")
    return value.strip()


def _generated_at(value: Any, fallback: str | None) -> str:
    candidate = value or fallback
    if candidate is None:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    if not isinstance(candidate, str):
        raise AdapterError("generated_at must be an ISO 8601 string")
    try:
        parsed = datetime.fromisoformat(candidate.replace("Z", "+00:00"))
    except ValueError as exc:
        raise AdapterError("generated_at must be an ISO 8601 string") from exc
    if parsed.tzinfo is None:
        raise AdapterError("generated_at must include a timezone")
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def normalize_model_result(
    payload: Mapping[str, Any],
    *,
    external_session_key: str,
    mapping: Mapping[str, Any] | None = None,
    generated_at: str | None = None,
) -> dict[str, Any]:
    """Return canonical consultation-card and routing-candidate payloads.

    Unknown model fields are ignored and reported by name. An unmapped business
    type returns needs_enrichment instead of inventing risk or routing data.
    """

    if not isinstance(payload, Mapping):
        raise AdapterError("payload must be a JSON object")
    if not isinstance(external_session_key, str) or not external_session_key.strip():
        raise AdapterError("external_session_key must be a non-empty string")
    if len(external_session_key.strip()) > 100:
        raise AdapterError("external_session_key must be at most 100 characters")

    request_session_key = external_session_key.strip()
    payload_session_key = _optional_text(payload, "external_session_key")
    if payload_session_key and payload_session_key != request_session_key:
        raise AdapterError("payload external_session_key does not match request context")

    active_mapping = dict(mapping) if mapping is not None else load_mapping()
    defaults = active_mapping["defaults"]

    summary = _required_text(payload, "summary")
    business_type = _required_text(payload, "business_type")
    department_label = _required_text(payload, "department")
    routing_reason = _required_text(payload, "routing_reason")
    incident_risk = _optional_text(payload, "incident_risk")
    risk_reason = _optional_text(payload, "risk_reason")
    if incident_risk and not risk_reason:
        raise AdapterError("risk_reason is required when incident_risk is provided")

    confidence_value = payload.get("routing_confidence")
    if confidence_value is not None:
        if not isinstance(confidence_value, (int, float)) or isinstance(
            confidence_value, bool
        ):
            raise AdapterError("routing_confidence must be null or numeric")
        if not 0 <= float(confidence_value) <= 1:
            raise AdapterError("routing_confidence must be between 0 and 1")

    model_name = _optional_text(payload, "model_name") or defaults["model_name"]
    model_version = _optional_text(payload, "model_version") or defaults["model_version"]
    result_generated_at = _generated_at(payload.get("generated_at"), generated_at)

    warnings: list[str] = []
    pending_fields: list[str] = []
    entry = active_mapping["business_types"].get(business_type)
    department_from_alias = active_mapping["department_aliases"].get(department_label)

    if entry is None:
        warnings.append(f"unmapped business_type: {business_type}")
        inquiry_type = "other"
        risk_level = None
        urgency_level = None
        department_code = department_from_alias
        mapping_confidence = None
    else:
        inquiry_type = entry["inquiry_type"]
        risk_level = entry["default_risk_level"]
        urgency_level = entry["default_urgency_level"]
        department_code = entry["department_code"]
        mapping_confidence = entry["routing_confidence"]
        if department_from_alias and department_from_alias != department_code:
            warnings.append(
                "department label conflicts with business type mapping; "
                "business type mapping was used"
            )

    if incident_risk:
        mapped_risk = active_mapping["risk_labels"].get(incident_risk)
        if mapped_risk is None:
            warnings.append(f"unmapped incident_risk: {incident_risk}")
            risk_level = None
        else:
            risk_level = mapped_risk

    consultation_card: dict[str, Any] | None = None
    if risk_level is None:
        pending_fields.append("risk_level")
    if urgency_level is None:
        pending_fields.append("urgency_level")
    if risk_level is not None and urgency_level is not None:
        consultation_card = {
            "schema_version": "1.0",
            "external_session_key": request_session_key,
            "analysis_result_key": None,
            "inquiry_type": inquiry_type,
            "summary": summary,
            "customer_request": None,
            "keywords": [business_type],
            "risk_factors": [risk_reason] if risk_reason else [],
            "urgency_level": urgency_level,
            "risk_level": risk_level,
            "related_manual_refs": [],
            "suggested_opening": None,
            "recommended_actions": [],
            "confirmation_items": [],
            "confirmation_status": "pending",
            "confirmed_at": None,
            "model_name": model_name,
            "model_version": model_version,
            "generated_at": result_generated_at,
        }

    routing_candidate: dict[str, Any] | None = None
    routing_confidence = (
        float(confidence_value)
        if confidence_value is not None
        else float(mapping_confidence)
        if mapping_confidence is not None
        else None
    )
    if department_code is None:
        pending_fields.append("department_code")
    if routing_confidence is None:
        pending_fields.append("routing_confidence")
    if department_code is not None and routing_confidence is not None:
        routing_candidate = {
            "schema_version": "1.0",
            "external_session_key": request_session_key,
            "department_code": department_code,
            "counselor_code": None,
            "recommendation_rank": 1,
            "confidence": routing_confidence,
            "rationale": routing_reason,
            "selected": True,
            "model_name": defaults["routing_policy_name"],
            "model_version": defaults["routing_policy_version"],
        }

    ignored_fields = sorted(set(payload) - KNOWN_INPUT_FIELDS)
    return {
        "adapter_version": active_mapping["adapter_version"],
        "mapping_version": active_mapping["mapping_version"],
        "status": "ready"
        if consultation_card is not None and routing_candidate is not None
        else "needs_enrichment",
        "pending_fields": sorted(set(pending_fields)),
        "warnings": warnings,
        "ignored_fields": ignored_fields,
        "consultation_card": consultation_card,
        "routing_candidate": routing_candidate,
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Normalize a provisional K7 model result JSON."
    )
    parser.add_argument("--input", required=True, help="Input JSON file")
    parser.add_argument("--session-key", required=True, help="K7 external session key")
    parser.add_argument(
        "--mapping",
        default=str(DEFAULT_MAPPING_PATH),
        help="Editable mapping JSON file",
    )
    parser.add_argument(
        "--generated-at",
        help="Fallback ISO 8601 timestamp when the model payload omits generated_at",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        with Path(args.input).open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        normalized = normalize_model_result(
            payload,
            external_session_key=args.session_key,
            mapping=load_mapping(args.mapping),
            generated_at=args.generated_at,
        )
    except (AdapterError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2

    print(json.dumps(normalized, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
