"""Adapter for the delivered NIA general-banking topic classifier.

This model is deliberately advisory. Its published metrics cover ten general
banking topics only; they do not measure the urgent/simple/general rules or the
ARS 17-route rules described by the model author.
"""

from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass, replace
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal, Mapping

from app.config import Settings


G004_FALLBACK_TOPIC = "기타·복합 일반 상담"


@dataclass(frozen=True)
class GeneralTopicRouting:
    status: Literal["classified", "fallback", "unavailable"]
    predicted_topic: str | None
    resolved_topic: str | None
    margin: float | None
    threshold: float
    automatic: bool
    model_sha256: str | None
    application: Literal["pending", "applied", "incident_priority", "unavailable"]
    reason: str

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _unavailable(settings: Settings, reason: str) -> GeneralTopicRouting:
    return GeneralTopicRouting(
        status="unavailable",
        predicted_topic=None,
        resolved_topic=None,
        margin=None,
        threshold=settings.routing_topic_margin_threshold,
        automatic=False,
        model_sha256=None,
        application="unavailable",
        reason=reason,
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


@lru_cache(maxsize=2)
def _load_model_artifact(path_text: str, expected_sha256: str) -> tuple[Any, str]:
    path = Path(path_text).expanduser().resolve()
    if not path.is_file():
        raise FileNotFoundError(f"routing topic model is missing: {path}")

    actual_sha256 = _sha256(path)
    if actual_sha256 != expected_sha256.strip().upper():
        raise ValueError(
            "routing topic model SHA-256 mismatch "
            f"(expected {expected_sha256.strip().upper()}, got {actual_sha256})"
        )

    # joblib deserialization can execute code. Import and load only after the
    # delivered file has passed the agreed cryptographic hash check.
    import joblib

    artifact = joblib.load(path)
    if not isinstance(artifact, Mapping) or "pipeline" not in artifact:
        raise ValueError("routing topic model bundle has no pipeline")
    pipeline = artifact["pipeline"]
    if not callable(getattr(pipeline, "predict", None)) or not callable(
        getattr(pipeline, "decision_function", None)
    ):
        raise ValueError("routing topic model pipeline has an unsupported interface")
    return pipeline, actual_sha256


def classify_general_topic(
    settings: Settings,
    transcript: str,
) -> GeneralTopicRouting:
    """Classify one transcript, or return an explicit non-fatal unavailable result."""

    if not settings.routing_topic_enabled:
        return _unavailable(settings, "general topic routing is disabled")
    if not transcript.strip():
        return _unavailable(settings, "transcript is empty")

    try:
        pipeline, actual_sha256 = _load_model_artifact(
            settings.routing_topic_model_path,
            settings.routing_topic_model_sha256,
        )
        prediction = str(pipeline.predict([transcript])[0])
        decision_values = pipeline.decision_function([transcript])
        row = decision_values[0]
        scores = [float(value) for value in row]
        if len(scores) < 2:
            raise ValueError("routing topic model returned fewer than two class scores")
        ordered = sorted(scores, reverse=True)
        margin = round(ordered[0] - ordered[1], 6)
    except Exception as exc:
        return _unavailable(settings, str(exc))

    threshold = settings.routing_topic_margin_threshold
    if margin < threshold:
        return GeneralTopicRouting(
            status="fallback",
            predicted_topic=prediction,
            resolved_topic=G004_FALLBACK_TOPIC,
            margin=margin,
            threshold=threshold,
            automatic=False,
            model_sha256=actual_sha256,
            application="pending",
            reason=(
                f"margin {margin:.3f} is below {threshold:.2f}; "
                "fall back to G004"
            ),
        )
    return GeneralTopicRouting(
        status="classified",
        predicted_topic=prediction,
        resolved_topic=prediction,
        margin=margin,
        threshold=threshold,
        automatic=True,
        model_sha256=actual_sha256,
        application="pending",
        reason=f"margin {margin:.3f} meets the {threshold:.2f} threshold",
    )


def apply_general_topic_routing(
    raw_result: Mapping[str, Any],
    routing: GeneralTopicRouting,
) -> tuple[dict[str, Any], GeneralTopicRouting]:
    """Apply the topic only to low-risk calls; incident routing always wins."""

    result = dict(raw_result)
    if routing.status == "unavailable":
        return result, routing
    if str(result.get("incident_risk", "low")).strip().lower() == "high":
        return result, replace(
            routing,
            application="incident_priority",
            reason=(
                routing.reason
                + "; not applied because deterministic incident routing has priority"
            ),
        )

    result["business_type"] = routing.resolved_topic
    existing_reason = str(result.get("routing_reason") or "").strip()
    evidence = (
        f"일반업무 주제 모델: {routing.resolved_topic} "
        f"(margin {routing.margin:.3f}, 기준 {routing.threshold:.2f})"
    )
    result["routing_reason"] = " · ".join(
        part for part in (existing_reason, evidence) if part
    )
    return result, replace(routing, application="applied")
