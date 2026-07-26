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
from app.schemas import GptAnalysis, RiskFlags


_SYSTEM_PROMPT = """\
너는 보이스피싱 대응 금융 콜센터의 사전 브리핑 보조 AI다.
고객 상담 전사문을 읽고 아래 JSON 스키마 그대로 구조화된 정보를 추출해서 JSON만 출력해라.
다른 설명 문장은 절대 붙이지 마라.

department는 **아래 7개 중 하나를 그대로** 답한다. 목록에 없는 이름을 새로 만들지 마라 —
라우팅과 규정검색이 이 이름으로 필터하므로, 목록 밖 이름이 오면 필터가 조용히 풀린다.
애매하면 가장 가까운 것을 고르고, 정말 못 정하겠으면 "수신·예적금"으로 답한다.
수신·예적금, 여신·대출, 카드·결제, 외환·수출입, 전자금융·디지털, 연금·신탁·투자, 사고·신고
(보이스피싱·명의도용·지급정지 등 사고·신고성 건은 반드시 "사고·신고")

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
            department=payload["department"],
            keywords=payload["keywords"],
            risk_flags=RiskFlags(**payload.get("risk_flags", {})),
        )
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        raise LocalLlmError(f"로컬 LLM 응답 파싱 실패: {exc}\n원본: {content[:500]}") from exc
