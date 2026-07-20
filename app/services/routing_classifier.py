"""상담 라우팅 분류 어댑터 — 전형진(nangom)님 classify_transcript()를 우리 스키마로 감싼다.

app/services/routing/(벤더링된 원본)의 순수 함수를 호출해 RoutingResult로 변환한다. 규칙 기반
분류는 외부 파일 의존이 없어 즉시 동작하고, 3단계 로컬 ML 주제 분류(topic_classifier)는 모델
파일이 있을 때만 활성화된다(없으면 그 단계만 조용히 스킵 — classify_transcript 내부에서 처리).

박정운 emotion·EXAONE text_emotion과 마찬가지로 "어느 업무/부서로 보낼지"라는 별도 축이라,
GptAnalysis.department(자유형 추측)를 대체하지 않고 병행 신호로 붙인다.
"""

import logging

from app.schemas import RoutingResult

logger = logging.getLogger(__name__)


class RoutingError(RuntimeError):
    pass


def classify_routing(transcript: str) -> RoutingResult:
    from app.services.routing.classifier import classify_transcript

    result = classify_transcript(transcript)
    return RoutingResult(
        task_code=result["code"],
        task_name=result["name"],
        classification=result["classification"],
        handler=result["handler"],
        reason=result["reason"],
        matched_keywords=result.get("matched_keywords", []),
        bank_topic=result.get("bank_topic"),
    )


def classify_routing_safe(transcript: str) -> RoutingResult | None:
    """라우팅 분류는 보조 신호라, 실패해도 전체 파이프라인을 막지 않고 이 신호 없이 진행한다."""
    try:
        return classify_routing(transcript)
    except Exception:
        logger.warning("routing 분류 실패, 라우팅 신호 없이 진행", exc_info=True)
        return None
