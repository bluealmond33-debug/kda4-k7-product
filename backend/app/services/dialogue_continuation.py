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
- 정확히 10~16턴. "지금까지의 대화"가 주어지면 그 바로 다음부터 이어 쓴다(이미 나온 말은
  반복하지 말고, 화자 순서도 자연스럽게 이어간다 — 직전 턴이 고객이면 상담원부터).
  "지금까지의 대화"가 없으면 상담원이 먼저 응답한다.
- 각 턴은 실제 통화체로 1~2문장, 존댓말. 따옴표로 감싸지 마라.
- 고객의 원래 용건(요약·키워드·담당 부서)에서 벗어나지 않는다 — 새 용건을 지어내지 마라.
- **내용을 실제로 진행시켜라.** "확인해드리겠습니다"/"잠시만 기다려 주세요"류 대기 멘트를
  두 턴 이상 연달아 쓰지 마라 — 한 번 기다리게 했으면 다음 상담원 턴은 반드시 구체적인
  진행 내용(확인된 사실, 다음 절차, 필요 서류·조건, 예상 소요시간 등)을 담아야 한다.
  같은 말을 다른 단어로 반복하지 마라(예: "확인 중입니다"→"조회하고 있습니다"→
  "잠시만요"를 순서대로 쓰는 건 세 턴을 쓰고도 내용은 하나도 안 늘어난 것과 같다 — 금지).
- 고객 쪽도 매번 "네, 알겠습니다"로만 받지 말고 구체적인 되묻기·확인·추가 정보 제공을
  섞어라(예: 금액·기간을 되묻거나, 절차에 대한 우려를 표하거나, 다른 선택지를 물어보거나).
- 부서·키워드에 맞는 실제 업무 절차를 구체적으로 언급해라(예: 자동이체면 등록 계좌·출금일·
  해지 시점, 만기 관련이면 재예치·해지 옵션과 이율 차이 등) — 막연한 안내 문구로 때우지 마라.
- "마무리 지시"가 없으면 아직 상담이 끝나지 않은 것으로 본다 — 마지막 턴도 인사로 끝맺지 말고
  자연스럽게 진행 중인 상태로 끝낸다(예: 확인·안내가 이어지는 중).
- "마무리 지시"가 있으면 마지막 턴은 상담원이 안내를 마무리하는 인사로 끝낸다.
- 실제 계좌번호·전화번호·금액 등 구체적 개인정보 수치는 지어내지 마라(일반적 표현만).

JSON 스키마:
{"turns": [{"speaker": "agent", "text": "..."}, {"speaker": "customer", "text": "..."}, ...]}
"""


def _build_user_prompt(
    opening_text: str,
    summary: str,
    keywords: list[str],
    department: str,
    prior_turns: list[tuple[str, str]] | None = None,
    conclude: bool = False,
) -> str:
    lines = [f"고객이 접수 때 한 말: {opening_text}"]
    if summary:
        lines.append(f"요약: {summary}")
    if keywords:
        lines.append(f"핵심 키워드: {', '.join(keywords)}")
    if department:
        lines.append(f"담당 부서: {department}")
    if prior_turns:
        lines.append("지금까지의 대화:")
        lines.extend(f"- {speaker}: {text}" for speaker, text in prior_turns)
    if conclude:
        lines.append("마무리 지시: 이번 배치에서 상담을 마무리 인사로 끝내라.")
    return "\n".join(lines)


class DialogueContinuationError(RuntimeError):
    pass


def generate_continuation(
    settings: Settings,
    opening_text: str,
    summary: str = "",
    keywords: list[str] | None = None,
    department: str = "",
    prior_turns: list[DialogueTurn] | None = None,
    conclude: bool = False,
) -> ContinuationResponse:
    prior_pairs = [(t.speaker, t.text) for t in (prior_turns or [])]
    try:
        response = httpx.post(
            f"{settings.ollama_base_url}/api/chat",
            json={
                "model": settings.ollama_model,
                "messages": [
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": _build_user_prompt(
                            opening_text, summary, keywords or [], department, prior_pairs, conclude
                        ),
                    },
                ],
                "format": "json",
                "stream": False,
                # 턴 수를 6~8→10~16으로 늘려서 num_predict도 같이 올린다 — 안 그러면 뒷턴이
                # 잘려서 JSON 파싱이 깨진다.
                "options": {"temperature": 0.4, "num_predict": 1300},
            },
            # 7.8b로 올라간 뒤로 응답이 눈에 띄게 느려져서(단순 분류 1건도 20초대) 턴 수까지
            # 늘어난 이 호출은 60초로는 부족할 수 있다.
            timeout=120,
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
