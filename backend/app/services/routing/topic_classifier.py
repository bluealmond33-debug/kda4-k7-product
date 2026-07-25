"""Optional local NIA bank-topic model adapter."""

from functools import lru_cache
from pathlib import Path

MODEL_PATH = Path(__file__).resolve().parent / "models" / "bank_topic_classifier.joblib"
DEFAULT_MARGIN_THRESHOLD = 0.75


@lru_cache(maxsize=1)
def load_model() -> dict:
    if not MODEL_PATH.exists():
        raise FileNotFoundError(MODEL_PATH)
    try:
        import joblib
    except ImportError as exc:
        raise RuntimeError("joblib과 scikit-learn이 필요합니다") from exc
    return joblib.load(MODEL_PATH)


def predict_bank_topic(text: str, margin_threshold: float = DEFAULT_MARGIN_THRESHOLD) -> dict:
    bundle = load_model()
    pipeline = bundle["pipeline"]
    scores = pipeline.decision_function([text])[0]
    classes = pipeline.classes_
    ordered = scores.argsort()
    best, second = int(ordered[-1]), int(ordered[-2])
    margin = float(scores[best] - scores[second])
    return {
        "topic": str(classes[best]),
        "margin": round(margin, 6),
        "accepted": margin >= margin_threshold,
        "threshold": margin_threshold,
    }


def get_model_status() -> dict:
    try:
        bundle = load_model()
    except (FileNotFoundError, RuntimeError, ImportError) as exc:
        return {"available": False, "threshold": DEFAULT_MARGIN_THRESHOLD, "detail": str(exc)}
    return {
        "available": True,
        "threshold": DEFAULT_MARGIN_THRESHOLD,
        "model_type": bundle.get("metadata", {}).get("model_type", "unknown"),
    }
