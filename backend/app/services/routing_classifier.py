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


# 형진님 KARI-NA 본인확인 적용 정책(IDENTITY_AUTH_POLICY.md) — task_code 기준 3분류.
# REQUIRED: 한도·비밀번호·분실신고·자동이체 등 계좌/카드 상태나 출금권한이 실제로 바뀌는
# 업무만 명시 목록으로 잡는다. 목록 밖 S/G 업무는 NOT_REQUIRED가 기본값(접수 단계에서는
# 인증 없이 받고, 통화 중 실제 조회·변경으로 의도가 바뀌면 상담사가 그때 다시 요청한다).
# EXEMPT(E001·E002)는 본인확인보다 긴급 연결이 우선이라 5번(본인확인 실행) 자체를 건너뛴다.
_AUTH_REQUIRED_TASK_CODES = {
    "S105", "S106", "S111", "S112", "S115", "S120", "S121", "S122", "S123",
    "S124", "S126", "S127", "G001", "G003", "G004", "G006", "G007",
}
_AUTH_EXEMPT_TASK_CODES = {"E001", "E002"}


def _auth_policy_for(task_code: str, classification: str) -> str:
    if task_code in _AUTH_EXEMPT_TASK_CODES or classification == "EMERGENCY":
        return "EXEMPT"
    if task_code in _AUTH_REQUIRED_TASK_CODES:
        return "REQUIRED"
    return "NOT_REQUIRED"


def classify_routing(transcript: str, settings=None) -> RoutingResult:
    from app.services.routing.classifier import TASKS_BY_CODE, classify_transcript

    result = classify_transcript(transcript)

    # 키워드 규칙이 "기타"(G004)로만 떨어졌으면 로컬 LLM(EXAONE)에게 한 번 더 물어본다 —
    # 현장 피드백: "카드를 잃어버렸어요"처럼 자연어 표현이 키워드 목록에 없어 전부 G004로
    # 뭉개지는 문제. G004일 때만 부르므로(전체 통화의 일부) 흔한 표현의 응답속도엔 영향
    # 없다. settings가 없으면(호출부가 안 넘기면) 그냥 건너뛴다 — 있으면 좋은 보완이지
    # 필수 의존성은 아니다.
    if result["code"] == "G004" and settings is not None:
        from app.services.local_llm import classify_task_with_llm

        llm_code = classify_task_with_llm(settings, transcript)
        if llm_code and llm_code != "G004":
            llm_task = TASKS_BY_CODE[llm_code]
            logger.info("routing LLM 보완: G004 → %s (%s)", llm_code, llm_task["name"])
            result = {
                **llm_task,
                "matched_keywords": [],
                "reason": "규칙 키워드 매칭 실패 — 로컬 LLM(EXAONE) 보완 판정",
            }

    auth_policy = _auth_policy_for(result["code"], result["classification"])
    return RoutingResult(
        task_code=result["code"],
        task_name=result["name"],
        classification=result["classification"],
        handler=result["handler"],
        reason=result["reason"],
        matched_keywords=result.get("matched_keywords", []),
        bank_topic=result.get("bank_topic"),
        auth_policy=auth_policy,
        auth_required=auth_policy == "REQUIRED",
    )


def classify_routing_safe(transcript: str, settings=None) -> RoutingResult | None:
    """라우팅 분류는 보조 신호라, 실패해도 전체 파이프라인을 막지 않고 이 신호 없이 진행한다."""
    try:
        return classify_routing(transcript, settings)
    except Exception:
        logger.warning("routing 분류 실패, 라우팅 신호 없이 진행", exc_info=True)
        return None
