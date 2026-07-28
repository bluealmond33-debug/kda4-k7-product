"""온프레미스 GPT 분석 대체 — Ollama(로컬 LLM, 예: Qwen2.5)로 상담 요약/분류/위험플래그 추출.

app/services/gpt_analysis.py(클라우드판)와 같은 출력(GptAnalysis)을 만들어서 호출부는
settings.use_local_models만 보고 어느 쪽을 쓸지 고르면 된다.

⚠️ Ollama는 OpenAI의 strict JSON schema(response_format)만큼 출력 형식을 강제하지
못한다. format="json"으로 유효한 JSON은 보장되지만, 필드 누락/오분류 가능성은
클라우드판보다 높다 — 데모/온프레미스 대안용으로만 쓴다.
"""

import json

import httpx

from app.config import Settings
from app.routing.taxonomy import normalize_department
from app.schemas import GptAnalysis, RiskFlags


_SYSTEM_PROMPT = """\
너는 보이스피싱 대응 금융 콜센터의 사전 브리핑 보조 AI다.
고객 상담 전사문을 읽고 아래 JSON 스키마 그대로 구조화된 정보를 추출해서 JSON만 출력해라.
다른 설명 문장은 절대 붙이지 마라.

department는 **아래 7개 중 하나를 그대로** 답한다. 목록에 없는 이름을 새로 만들지 마라 —
라우팅과 규정검색이 이 이름으로 필터하므로, 목록 밖 이름이 오면 필터가 조용히 풀린다.
애매하면 가장 가까운 것을 고르고, 정말 못 정하겠으면 "수신·예적금"으로 답한다.
수신·예적금, 여신·대출, 카드·결제, 외환·수출입, 전자금융·디지털, 연금·신탁·투자, 사고·신고

부서 판단 순서 — 위에서부터 먼저 맞는 조건 하나만 적용한다(뒤 규칙보다 항상 우선):
1. 보이스피싱·명의도용·원격제어·**본인이 하지 않은 거래(무단 출금/이체/결제)** 등 사고·신고
   성격의 긴급 건은 반드시 "사고·신고" — "출금"·"이체" 같은 단어가 같이 나와도 사고 정황이면
   이 규칙이 아래 2·3번보다 우선이다.
2. (사고 정황이 없을 때) 계좌 잔액·거래내역 등 "계좌 자체"에 대한 단순 조회·문의는 "수신·예적금".
3. (사고 정황이 없을 때) 인터넷/모바일뱅킹 로그인·공동인증서·앱 오류 등 "디지털 채널 자체"의
   기술적 문제는 "전자금융·디지털".
예: "계좌에 얼마 있어요?" → 수신·예적금 / "제가 안 한 출금이 찍혀 있어요" → 사고·신고 /
"앱 로그인이 안 돼요" → 전자금융·디지털

JSON 스키마:
{
  "summary": "상담 내용 2~3문장 요약",
  "department": "담당 부서",
  "keywords": ["핵심 키워드 3~6개"],
  "risk_flags": {
    "actual_damage_occurred": bool, "credential_exposed": bool,
    "remote_app_installed": bool, "control_lost": bool,
    "protection_measures_incomplete": bool, "damage_amount_unknown": bool,
    "transfer_time_unknown": bool, "payment_hold_status_unknown": bool,
    "protection_status_unknown": bool, "other_critical_info_missing": bool,
    "multiple_issues_present": bool, "multiple_procedures_applicable": bool,
    "repeat_contact_same_case": bool, "prior_resolution_failed": bool
  }
}
플래그는 전사문에서 명시적으로 확인되는 경우에만 true, 확인 불가하면 false로 남겨라.
"""


class LocalLlmError(RuntimeError):
    pass


def analyze_transcript_local(settings: Settings, transcript: str) -> GptAnalysis:
    try:
        response = httpx.post(
            f"{settings.ollama_base_url}/api/chat",
            json={
                "model": settings.ollama_model,
                "messages": [
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": transcript},
                ],
                "format": "json",
                "stream": False,
                # 속도 개선(박정운 피드백) — 요약/부서/키워드/위험플래그 JSON엔 400토큰이면 충분.
                "options": {"temperature": 0.2, "num_predict": 400},
            },
            timeout=120,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise LocalLlmError(f"Ollama 호출 실패 (모델 '{settings.ollama_model}' 로딩됐는지 확인): {exc}") from exc

    content = response.json().get("message", {}).get("content", "")
    try:
        payload = json.loads(content)
        return GptAnalysis(
            summary=payload["summary"],
            department=normalize_department(payload["department"]),
            keywords=payload["keywords"],
            risk_flags=RiskFlags(**payload.get("risk_flags", {})),
        )
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        raise LocalLlmError(f"로컬 LLM 응답 파싱 실패: {exc}\n원본: {content[:500]}") from exc


def classify_task_with_llm(settings: Settings, transcript: str) -> str | None:
    """G0xx(+E00x) 업무코드 분류의 LLM 보완 경로 — routing_classifier.py의 키워드 규칙이
    "기타"(G004)로만 떨어졌을 때만 호출된다(현장 피드백: "카드를 잃어버렸어요"처럼
    키워드 목록에 없는 자연어 표현은 못 잡음). 매 통화 부르지 않으므로 속도에 영향 없다.

    후보를 GENERAL_TASK_NAMES(G0xx + E00x)로 제한한다. 예전엔 TASK_NAMES(S/G/E 전체)를
    후보로 줬는데, 그중 우리카드 ARS 전용 카탈로그(S101~127)만 예시 문구가 붙어 있어
    (ARS_TASK_KEYWORDS 출신) 애매한 발화일수록 LLM이 그쪽으로 쏠렸다 — 은행 계좌 자동이체
    문의("다른 계좌에서 빠져나가도록 변경")가 카드 자동납부 S126으로 잘못 분류된 사고
    (2026-07-28 Windows 시연 보고)의 원인. SIMPLE(S) 코드는 도메인 자체가 달라(카드 ARS
    전용) 후보에서 뺐지만, EMERGENCY(E00x)는 남겨뒀다 — 규칙 기반 긴급 판정이 "보내라고
    해요"처럼 자연어 표현을 놓쳐 G004로 떨어뜨린 사건성 발화를, 여기서라도 다시 건져올릴
    수 있는 유일한 경로이기 때문이다(2026-07-28 추가 검토). 예시는 TASK_KEYWORDS(G0xx·
    E00x 키워드까지 포함)에서 뽑아, 카드 카탈로그에만 예시가 있던 비대칭도 함께 없앤다.

    실패하거나 목록에 없는 코드를 답하면 None — 호출부는 기존 규칙기반 결과를 그대로 쓴다.
    """
    from app.services.routing.classifier import GENERAL_TASK_NAMES, TASK_KEYWORDS

    def _catalog_line(code: str, name: str) -> str:
        examples = TASK_KEYWORDS.get(code)
        if not examples:
            return f"{code}: {name}"
        return f"{code}: {name} (예: {', '.join(examples[:3])})"

    catalog = "\n".join(_catalog_line(code, name) for code, name in GENERAL_TASK_NAMES.items())
    system_prompt = (
        "너는 금융 콜센터 업무 분류기다. 아래 업무 목록 중 고객 발화에 가장 가까운 업무 "
        "코드 하나를 골라라. 애매하거나 목록에 맞는 게 전혀 없으면 NONE이라고만 답해라. "
        "코드나 NONE 한 단어만 출력하고 다른 설명은 붙이지 마라.\n\n업무 목록:\n" + catalog
    )
    try:
        response = httpx.post(
            f"{settings.ollama_base_url}/api/chat",
            json={
                "model": settings.ollama_model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": transcript},
                ],
                "stream": False,
                "options": {"temperature": 0.1, "num_predict": 10},
            },
            timeout=30,
        )
        response.raise_for_status()
    except httpx.HTTPError:
        return None

    code = response.json().get("message", {}).get("content", "").strip().upper()
    return code if code in GENERAL_TASK_NAMES else None


def suggest_reg_terms_with_llm(
    settings: Settings, transcript: str, candidates: list[str]
) -> list[str] | None:
    """관련 규정 추천 칩(자동완성) — 후보 중 지금 발화와 관련 있는 것만 골라 순서를 매긴다.

    후보는 이미 의미검색(BGE-M3)으로 뽑힌 것들이라 다 그럴듯해 보이지만, 발화 전체를
    그대로 쿼리로 써서 상위 5개만 그대로 보여주던 예전 방식은 어떤 문서 제목이 우연히
    걸리느냐에 따라 매번 다르게 나왔다(현장 피드백: "어떤 건 나오고 어떤 건 안 나와").
    후보를 넉넉히 받아 LLM이 실제로 지금 대화와 맞는 것만 추리고 순서를 매기게 한다.

    실패하거나 답을 못 골라내면 None — 호출부는 의미검색 점수순으로 그대로 폴백한다.
    """
    if not candidates:
        return None
    numbered = "\n".join(f"{i + 1}. {c}" for i, c in enumerate(candidates))
    system_prompt = (
        "너는 금융 콜센터 상담 화면에 띄울 '관련 규정' 추천 용어를 고르는 도우미다. "
        "user 메시지는 지금 통화에서 실제로 나온 내용이다. 아래 후보 용어 목록 중 그 "
        "내용과 관련 있는 것만, 관련도가 높은 순서로 최대 5개까지 번호를 골라라. "
        "번호만 쉼표로 구분해서 출력해라(예: 3,1,5). 관련 있는 게 하나도 없으면 "
        "NONE이라고만 답해라. 다른 설명은 붙이지 마라.\n\n"
        f"후보 목록:\n{numbered}"
    )
    try:
        response = httpx.post(
            f"{settings.ollama_base_url}/api/chat",
            json={
                "model": settings.ollama_model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": transcript[-600:]},
                ],
                "stream": False,
                "options": {"temperature": 0.1, "num_predict": 20},
            },
            timeout=30,
        )
        response.raise_for_status()
    except httpx.HTTPError:
        return None

    raw = response.json().get("message", {}).get("content", "").strip().upper()
    if raw == "NONE":
        return []
    picked: list[str] = []
    for part in raw.replace(" ", "").split(","):
        if not part.isdigit():
            continue
        idx = int(part) - 1
        if 0 <= idx < len(candidates) and candidates[idx] not in picked:
            picked.append(candidates[idx])
    return picked or None
