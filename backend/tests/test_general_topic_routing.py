from pathlib import Path

from app.config import Settings
from app.services.routing.general_topic import (
    G004_FALLBACK_TOPIC,
    GeneralTopicRouting,
    apply_general_topic_routing,
    classify_general_topic,
)


class _FakePipeline:
    def __init__(self, prediction: str, scores: list[float]):
        self.prediction = prediction
        self.scores = scores

    def predict(self, rows):
        assert rows == ["대출 만기를 연장하고 싶습니다"]
        return [self.prediction]

    def decision_function(self, rows):
        assert rows == ["대출 만기를 연장하고 싶습니다"]
        return [self.scores]


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        routing_topic_model_path=str(tmp_path / "model.joblib"),
        routing_topic_model_sha256="ABC",
        routing_topic_margin_threshold=0.75,
    )


def test_high_margin_general_topic_is_applied_to_low_risk_call(
    monkeypatch, tmp_path
) -> None:
    monkeypatch.setattr(
        "app.services.routing.general_topic._load_model_artifact",
        lambda *_args: (
            _FakePipeline("대출문의(만기/연장/조회등)", [0.1, 1.4, 0.2]),
            "ABC",
        ),
    )

    routing = classify_general_topic(_settings(tmp_path), "대출 만기를 연장하고 싶습니다")
    result, applied = apply_general_topic_routing(
        {
            "business_type": "대출 상담",
            "routing_reason": "LLM 초안",
            "incident_risk": "low",
        },
        routing,
    )

    assert routing.status == "classified"
    assert routing.margin == 1.2
    assert result["business_type"] == "대출문의(만기/연장/조회등)"
    assert "margin 1.200" in result["routing_reason"]
    assert applied.application == "applied"


def test_low_margin_uses_g004_fallback(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(
        "app.services.routing.general_topic._load_model_artifact",
        lambda *_args: (
            _FakePipeline("거래내역/잔액조회", [0.7, 0.2, 0.1]),
            "ABC",
        ),
    )

    routing = classify_general_topic(_settings(tmp_path), "대출 만기를 연장하고 싶습니다")

    assert routing.status == "fallback"
    assert routing.resolved_topic == G004_FALLBACK_TOPIC
    assert routing.automatic is False


def test_incident_route_has_priority_over_general_topic() -> None:
    routing = GeneralTopicRouting(
        status="classified",
        predicted_topic="거래내역/잔액조회",
        resolved_topic="거래내역/잔액조회",
        margin=1.1,
        threshold=0.75,
        automatic=True,
        model_sha256="ABC",
        application="pending",
        reason="high confidence",
    )
    raw = {
        "business_type": "보이스피싱 의심",
        "routing_reason": "금융사고 우선",
        "incident_risk": "high",
    }

    result, applied = apply_general_topic_routing(raw, routing)

    assert result == raw
    assert applied.application == "incident_priority"


def test_missing_model_is_non_fatal(tmp_path) -> None:
    routing = classify_general_topic(_settings(tmp_path), "대출 만기를 연장하고 싶습니다")

    assert routing.status == "unavailable"
    assert routing.application == "unavailable"
