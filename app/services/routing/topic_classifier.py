from __future__ import annotations

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
    except ImportError as error:
        raise RuntimeError("joblib과 scikit-learn이 필요합니다.") from error
    return joblib.load(MODEL_PATH)


def predict_bank_topic(text: str, margin_threshold: float = DEFAULT_MARGIN_THRESHOLD) -> dict:
    bundle = load_model()
    pipeline = bundle["pipeline"]
    scores = pipeline.decision_function([text])[0]
    classes = pipeline.classes_
    ordered = scores.argsort()
    best_index = int(ordered[-1])
    second_index = int(ordered[-2])
    margin = float(scores[best_index] - scores[second_index])
    return {
        "topic": str(classes[best_index]),
        "margin": round(margin, 6),
        "accepted": margin >= margin_threshold,
        "threshold": margin_threshold,
    }


def get_model_status() -> dict:
    try:
        bundle = load_model()
    except (FileNotFoundError, RuntimeError, ImportError) as error:
        return {"available": False, "threshold": DEFAULT_MARGIN_THRESHOLD, "detail": str(error)}
    return {
        "available": True,
        "threshold": DEFAULT_MARGIN_THRESHOLD,
        "model_type": bundle.get("metadata", {}).get("model_type", "unknown"),
        "created_at": bundle.get("metadata", {}).get("created_at"),
    }
