"""상담 가이드 생성 — EXAONE(Ollama)이 통화 분석 결과로 단계별 스크립트·후속 조치를 만든다.

설계도(04. 음성·AI 데이터 변환)의 "주의도·상담 카드 통합 → 해야 할 일" 경로 구현.
기존에 프론트가 콜 유형별 하드코딩 스크립트(SCRIPTS[incoming])를 보여줘서, 실제 통화
내용(예: 계좌 개설 문의)과 카드 내용(주담대 만기 연장)이 어긋나는 문제가 있었다.
이 모듈이 실제 요약·키워드·RAG 규정 근거로 스크립트를 생성해 그 간극을 없앤다.

입력은 **원문 전사가 아니라 요약+키워드**다 — /analyze-text의 RAG 질의와 같은 원칙
(주제 12: 개인정보가 LLM 프롬프트에 실리지 않게, 그리고 잡음 억제).

⚠️ local_llm.py와 같은 한계: Ollama format="json"은 유효한 JSON은 보장하지만 필드
누락·형식 이탈 가능성이 있다. 검증 실패 시 ConsultGuideError를 던지고, 호출부(파이프라인)는
빈 가이드로 폴백한다 — 프론트는 빈 값이면 기존 데모 픽스처를 쓰므로 화면이 깨지지 않는다.
"""

import json
import logging

import httpx

from app.config import Settings
from app.schemas import ConsultGuide, ConsultScriptStep, RagDocument

logger = logging.getLogger(__name__)

# 스크립트는 항상 4단계 — 프론트 UI(단계별 상담 스크립트 카드)와 팀 상담 플로우 합의 구조.
_STEP_TITLES = ["1. 오프닝 · 공감", "2. 사실 확인", "3. 절차 안내", "4. 마무리 · 후속 안내"]

_SYSTEM_PROMPT = """\
너는 금융 콜센터 상담사를 돕는 AI다. 고객 문의 분석 결과를 읽고, 상담사가 지금 통화에서
그대로 읽을 수 있는 단계별 상담 스크립트와 통화 종료 후 할 일을 JSON으로만 출력해라.
다른 설명 문장은 절대 붙이지 마라.

JSON 스키마:
{
  "script_steps": [
    {"title": "1. 오프닝 · 공감", "text": "..."},
    {"title": "2. 사실 확인", "text": "..."},
    {"title": "3. 절차 안내", "text": "..."},
    {"title": "4. 마무리 · 후속 안내", "text": "..."}
  ],
  "follow_ups": ["...", "..."],
  "result_label": "..."
}

규칙:
- script_steps는 정확히 4단계, title은 위 스키마의 문구를 그대로 쓴다.
- text는 상담사가 고객에게 그대로 말할 수 있는 정중한 존댓말 1~2문장. 따옴표로 감싸지 마라.
- "3. 절차 안내"는 관련 규정 근거가 주어지면 그 내용(필요 서류·절차·조건)만 반영한다.
  근거에 없는 수치·수수료·기한을 지어내지 마라. 근거가 없으면 일반 절차 안내로 쓴다.
- follow_ups는 통화 종료 후 상담사가 할 일 2~4개. 각 20자 이내 명사형(예: "계좌 개설 서류 안내 SMS 발송").
- result_label은 "상담 완료 · " 뒤에 핵심 업무를 10자 이내로 붙인 한 줄(예: "상담 완료 · 계좌 개설 안내").
"""


class ConsultGuideError(RuntimeError):
    """가이드 생성 불가(모델 미가용/응답 형식 이탈). 호출부는 빈 가이드로 폴백한다."""


def _build_user_prompt(
    summary: str, department: str, keywords: list[str], references: list[RagDocument]
) -> str:
    lines = [
        f"문의 요약: {summary}",
        f"담당 부서: {department}",
        f"키워드: {', '.join(keywords) if keywords else '(없음)'}",
    ]
    if references:
        lines.append("관련 규정 근거:")
        for ref in references[:3]:
            excerpt = " ".join((ref.excerpt or "").split())[:200]
            lines.append(f"- {ref.title}: {excerpt}")
    else:
        lines.append("관련 규정 근거: (없음)")
    return "\n".join(lines)


def _validate(payload: dict) -> ConsultGuide:
    steps_raw = payload.get("script_steps")
    if not isinstance(steps_raw, list) or len(steps_raw) != len(_STEP_TITLES):
        raise ConsultGuideError(f"script_steps는 {len(_STEP_TITLES)}단계여야 합니다: {steps_raw!r:.200}")
    steps: list[ConsultScriptStep] = []
    for i, raw in enumerate(steps_raw):
        text = str((raw or {}).get("text", "")).strip().strip('"“”')
        if not text:
            raise ConsultGuideError(f"{i + 1}단계 text가 비어 있습니다")
        # 제목은 모델 출력 대신 고정 문구를 쓴다 — UI 일관성 + 모델의 제목 변형 방지.
        steps.append(ConsultScriptStep(title=_STEP_TITLES[i], text=text))

    follow_ups = [str(f).strip() for f in payload.get("follow_ups", []) if str(f).strip()]
    if not 2 <= len(follow_ups) <= 4:
        raise ConsultGuideError(f"follow_ups는 2~4개여야 합니다: {follow_ups!r:.200}")

    result_label = str(payload.get("result_label", "")).strip()
    if not result_label:
        raise ConsultGuideError("result_label이 비어 있습니다")

    return ConsultGuide(script_steps=steps, follow_ups=follow_ups[:4], result_label=result_label[:30])


def generate_consult_guide(
    settings: Settings,
    summary: str,
    department: str,
    keywords: list[str],
    references: list[RagDocument],
) -> ConsultGuide:
    """요약·부서·키워드·RAG 근거로 상담 가이드를 생성한다(온프레미스 Ollama 전용).

    클라우드 모드(use_local_models=False)는 미지원 — ConsultGuideError를 던져 호출부가
    빈 가이드로 폴백하게 한다(데모·실구동이 전부 온프레미스라 실사용 경로가 아님).
    """
    if not settings.use_local_models:
        raise ConsultGuideError("상담 가이드 생성은 온프레미스(Ollama) 모드 전용입니다")

    try:
        response = httpx.post(
            f"{settings.ollama_base_url}/api/chat",
            json={
                "model": settings.ollama_model,
                "messages": [
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": _build_user_prompt(summary, department, keywords, references)},
                ],
                "format": "json",
                "stream": False,
                # 속도 개선(박정운 피드백: "요약 시간 너무 오래 걸림") — 옵션 없으면 기본값이
                # 사실상 무제한이라 필요 이상으로 길게 생성한다. 4단계 스크립트+후속조치+
                # 결과라벨 JSON엔 600토큰이면 충분하다.
                "options": {"temperature": 0.2, "num_predict": 600},
            },
            timeout=120,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise ConsultGuideError(f"Ollama 호출 실패: {exc}") from exc

    content = response.json().get("message", {}).get("content", "")
    try:
        payload = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ConsultGuideError(f"가이드 응답 파싱 실패: {exc}\n원본: {content[:300]}") from exc
    return _validate(payload)


def stub_consult_guide(summary: str, department: str) -> ConsultGuide:
    """STUB_MODELS용 canned 가이드 — GPU/Ollama 없는 환경에서도 화면 흐름이 일관되게."""
    topic = (summary or "고객 문의").rstrip(".")
    return ConsultGuide(
        script_steps=[
            ConsultScriptStep(title=_STEP_TITLES[0], text=f"네 고객님, 문의 주신 내용 확인했습니다. 제가 바로 도와드리겠습니다."),
            ConsultScriptStep(title=_STEP_TITLES[1], text="정확한 안내를 위해 몇 가지만 확인하겠습니다. 천천히 말씀해 주셔도 됩니다."),
            ConsultScriptStep(title=_STEP_TITLES[2], text=f"{department}에서 처리 가능한 절차를 순서대로 안내드리겠습니다."),
            ConsultScriptStep(title=_STEP_TITLES[3], text="안내드린 내용을 문자로 정리해 보내드리겠습니다. 더 궁금하신 점 있으실까요?"),
        ],
        follow_ups=["안내 내용 SMS 발송", "상담 이력 기록"],
        result_label="상담 완료 · 안내",
    )
