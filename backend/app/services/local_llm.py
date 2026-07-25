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

department는 반드시 짧은 팀/부서명(2~8자 내외)으로만 답한다. 아래 목록 중 가장 가까운 것을 고르거나,
목록에 없으면 이 형식("OO팀")을 따라 새로 만들어라:
보이스피싱대응팀, 카드분실신고팀, 이체오류처리팀, 계좌보안팀, 대출상담팀, 일반상담팀

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
