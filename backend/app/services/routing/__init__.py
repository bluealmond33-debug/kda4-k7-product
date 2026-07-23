"""Local, advisory routing classifiers."""

from app.services.routing.general_topic import (
    GeneralTopicRouting,
    apply_general_topic_routing,
    classify_general_topic,
)

__all__ = [
    "GeneralTopicRouting",
    "apply_general_topic_routing",
    "classify_general_topic",
]
