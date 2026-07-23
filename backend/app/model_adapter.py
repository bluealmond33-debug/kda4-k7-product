"""Normalize replaceable team-model output into the active K7 MVP contract.

Two input shapes are accepted:

1. The canonical K7 fields already produced by the temporary OpenAI pipeline.
2. The financial-model fields agreed with the model team:
   summary, task_category, consulting_situation and qa_topic.

Only canonical fields cross the FastAPI -> PostgreSQL boundary. Mapping rules
are versioned outside the code so label changes can be reviewed independently.
"""

import json
from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.contracts import ModelConsultationResult


POSTPROCESSING_RULES_PATH = (
    Path(__file__).resolve().parents[2]
    / "database"
    / "mvp"
    / "model_postprocessing.v1.json"
)


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

_CANONICAL_REQUIRED_FIELDS = {
    "summary",
    "business_type",
    "department",
    "routing_reason",
}
_FINANCIAL_MODEL_FIELDS = {
    "summary",
    "task_category",
    "consulting_situation",
    "qa_topic",
}
_ACTIVE_FIELDS = _CANONICAL_REQUIRED_FIELDS | {
    "incident_risk",
    "risk_reason",
    "routing_confidence",
    "customer_requests",
    "missing_information",
    "required_actions",
}


def _required_text(payload: Mapping[str, Any], field: str) -> str:
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ModelAdapterError(f"{field} must be a non-empty string")
    return value.strip()


@lru_cache(maxsize=1)
def load_postprocessing_rules() -> dict[str, Any]:
    """Load and minimally validate the reviewed financial label mapping."""

    try:
        rules = json.loads(POSTPROCESSING_RULES_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ModelAdapterError("financial postprocessing rules could not be loaded") from exc

    if rules.get("mapping_version") != "mvp-1.0":
        raise ModelAdapterError("unsupported financial postprocessing mapping_version")
    department_rules = rules.get("department_rules")
    high_risk_keywords = rules.get("high_risk_keywords")
    if not isinstance(department_rules, list) or not department_rules:
        raise ModelAdapterError("department_rules must be a non-empty list")
    if not isinstance(high_risk_keywords, list) or not high_risk_keywords:
        raise ModelAdapterError("high_risk_keywords must be a non-empty list")

    for rule in department_rules:
        if not isinstance(rule.get("department"), str) or not rule["department"].strip():
            raise ModelAdapterError("every department rule needs a department")
        if not isinstance(rule.get("keywords"), list) or not rule["keywords"]:
            raise ModelAdapterError("every department rule needs keywords")
        confidence = rule.get("routing_confidence")
        if (
            not isinstance(confidence, (int, float))
            or isinstance(confidence, bool)
            or not 0 <= float(confidence) <= 1
        ):
            raise ModelAdapterError("routing_confidence must be between 0 and 1")
    return rules


def _contains(source: str, keyword: str) -> bool:
    return keyword.casefold() in source.casefold()


def _normalize_financial_model_result(
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    summary = _required_text(payload, "summary")
    task_category = _required_text(payload, "task_category")
    consulting_situation = _required_text(payload, "consulting_situation")
    qa_topic = _required_text(payload, "qa_topic")
    classification_text = " / ".join(
        [task_category, consulting_situation, qa_topic, summary]
    )
    rules = load_postprocessing_rules()

    matched_rule = next(
        (
            rule
            for rule in rules["department_rules"]
            if any(_contains(classification_text, keyword) for keyword in rule["keywords"])
        ),
        None,
    )
    if matched_rule is None:
        raise ModelAdapterError(
            "unmapped financial model labels; add a reviewed department rule before routing"
        )

    matched_risk_keywords = [
        keyword
        for keyword in rules["high_risk_keywords"]
        if _contains(classification_text, keyword)
    ]
    is_high_risk = bool(matched_risk_keywords)
    department = matched_rule["department"].strip()
    routing_reason = (
        f"금융 특화 모델 분류(task_category={task_category}, "
        f"consulting_situation={consulting_situation}, qa_topic={qa_topic})를 "
        f"후처리 규칙 {rules['mapping_version']}으로 매핑"
    )
    return {
        "summary": summary,
        "business_type": qa_topic,
        "department": department,
        "routing_reason": routing_reason,
        "incident_risk": "high" if is_high_risk else "low",
        "risk_reason": (
            f"금융사고 징후 키워드 감지: {', '.join(matched_risk_keywords)}"
            if is_high_risk
            else None
        ),
        "routing_confidence": float(matched_rule["routing_confidence"]),
    }


def _normalize_canonical_result(payload: Mapping[str, Any]) -> dict[str, Any]:
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
    return normalized


def normalize_model_result(payload: Mapping[str, Any]) -> ModelConsultationResult:
    """Return one canonical summary/classification/routing result.

    Canonical K7 fields take precedence when both shapes are present. Unknown
    experiment fields are discarded. Unmapped financial labels are rejected;
    the adapter never invents a destination department.
    """

    if not isinstance(payload, Mapping):
        raise ModelAdapterError("model result must be a JSON object")

    if _CANONICAL_REQUIRED_FIELDS <= payload.keys():
        normalized = _normalize_canonical_result(payload)
    elif _FINANCIAL_MODEL_FIELDS <= payload.keys():
        normalized = _normalize_financial_model_result(payload)
    else:
        raise ModelAdapterError(
            "model result must contain either canonical K7 fields or "
            "summary/task_category/consulting_situation/qa_topic"
        )

    try:
        return ModelConsultationResult.model_validate(normalized)
    except ValueError as exc:
        raise ModelAdapterError(str(exc)) from exc
