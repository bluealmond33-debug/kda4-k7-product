"""상담사 연결 후 대화 시뮬레이션 — EXAONE(Ollama)이 실제 접수 발화를 이어서 있을 법한
고객↔상담원 대화를 만든다.

현장 요청: DTMF(#) 접수완료 이후로는 실기기 마이크를 더 잡지 않는다(다자간 실통화 캡처가
불안정해서). 그 자리를 채우기 위해, 고객이 접수 때 실제로 한 말을 근거로 자연스러운 이어지는
대화를 생성해 프론트가 전사 패널에 순차 스트리밍한다. 생성된 대화도 실전사와 같은 버퍼에
쌓이므로 후처리(요약)는 기존 경로를 그대로 탄다 — 이 모듈은 "그럴듯한 대화문"만 만든다.
"""

import json
import logging

import httpx

from app.config import Settings
from app.schemas import ContinuationResponse, DialogueTurn

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """\
너는 금융 콜센터 상담 대화를 자연스럽게 이어 쓰는 작가다. 고객이 방금 상담 접수 때 한 말을
보고, 그 뒤에 실제로 있을 법한 상담원↔고객 대화를 만들어 JSON으로만 출력해라.

규칙:
- 정확히 6~8턴. 상담원이 먼저 응답하고 그 뒤로 고객↔상담원이 번갈아 말한다
  (agent, customer, agent, customer, ...).
- 각 턴은 실제 통화체로 1~2문장, 존댓말. 따옴표로 감싸지 마라.
- 고객의 원래 용건(요약·키워드·담당 부서)에서 벗어나지 않는다 — 새 용건을 지어내지 마라.
- 마지막 턴은 상담원이 안내를 마무리하는 문장으로 끝낸다.
- 실제 계좌번호·전화번호·금액 등 구체적 개인정보 수치는 지어내지 마라(일반적 표현만).

JSON 스키마:
{"turns": [{"speaker": "agent", "text": "..."}, {"speaker": "customer", "text": "..."}, ...]}
"""


def _build_user_prompt(opening_text: str, summary: str, keywords: list[str], department: str) -> str:
    lines = [f"고객이 접수 때 한 말: {opening_text}"]
    if summary:
        lines.append(f"요약: {summary}")
    if keywords:
        lines.append(f"핵심 키워드: {', '.join(keywords)}")
    if department:
        lines.append(f"담당 부서: {department}")
    return "\n".join(lines)


class DialogueContinuationError(RuntimeError):
    pass


def generate_continuation(
    settings: Settings,
    opening_text: str,
    summary: str = "",
    keywords: list[str] | None = None,
    department: str = "",
) -> ContinuationResponse:
    try:
        response = httpx.post(
            f"{settings.ollama_base_url}/api/chat",
            json={
                "model": settings.ollama_model,
                "messages": [
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": _build_user_prompt(opening_text, summary, keywords or [], department),
                    },
                ],
                "format": "json",
                "stream": False,
                "options": {"temperature": 0.4, "num_predict": 700},
            },
            timeout=60,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise DialogueContinuationError(f"Ollama 호출 실패: {exc}") from exc

    content = response.json().get("message", {}).get("content", "")
    try:
        payload = json.loads(content)
        raw_turns = payload["turns"]
        turns = [
            DialogueTurn(
                speaker="agent" if str(t.get("speaker")) == "agent" else "customer",
                text=str(t.get("text", "")).strip(),
            )
            for t in raw_turns
            if str(t.get("text", "")).strip()
        ]
    except (json.JSONDecodeError, KeyError, TypeError, AttributeError) as exc:
        raise DialogueContinuationError(f"대화 시뮬레이션 응답 파싱 실패: {exc}\n원본: {content[:300]}") from exc

    if not turns:
        raise DialogueContinuationError("생성된 대화가 비어 있습니다")
    return ContinuationResponse(turns=turns)
