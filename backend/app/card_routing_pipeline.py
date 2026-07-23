"""카드 라우팅 파이프라인 (card routing pipeline).

통화 음성 → STT 전사 → 긴급 게이트 → AI 분석 → 상담카드에 부서·긴급 도장.
"카드를 어느 부서 큐로 보낼지"를 결정하는 K7의 라우팅 파이프라인이다.

카드 라우터 흐름:
  1단계 긴급 게이트(app/routing/emergency_gate) — 규칙 recall floor
  2단계 AI 분석(이 모듈) — LLM이 요약·부서·업무코드·위험 산출
  게이트가 걸리면 LLM 결과 위에 긴급(SG) 라우팅을 강제 오버라이드하고,
  LLM이 실패해도 긴급 콜만은 규칙 결과로 폴백해 라우팅한다(안전 우선).

부서·업무코드는 app/routing/taxonomy.py의 3층 taxonomy(닫힌 집합)를 따른다.
"""

import json

from openai import OpenAI

from app.config import Settings
from app.contracts import ModelConsultationResult, TranscriptResult
from app.model_adapter import normalize_model_result
from app.routing.emergency_gate import EmergencyGateResult, check_emergency
from app.routing.taxonomy import (
    BUSINESS_CODES,
    DEPARTMENTS,
    EMERGENCY_DEPARTMENT_LABEL,
    ROUTING_EMERGENCY,
    ROUTING_LEVELS,
    is_valid_business_code,
)

_DEPARTMENT_LABELS = list(DEPARTMENTS.values())
_BUSINESS_CODE_GUIDE = ", ".join(
    f"{code}({name})" for code, (_, _, name) in BUSINESS_CODES.items()
)

_ANALYSIS_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "summary",
        "business_type",
        "routing",
        "department",
        "business_code",
        "routing_reason",
        "incident_risk",
        "risk_reason",
        "routing_confidence",
    ],
    "properties": {
        "summary": {"type": "string"},
        "business_type": {"type": "string"},
        "routing": {"type": "string", "enum": list(ROUTING_LEVELS)},
        "department": {"type": "string", "enum": _DEPARTMENT_LABELS},
        "business_code": {"type": ["string", "null"]},
        "routing_reason": {"type": "string"},
        "incident_risk": {"type": "string", "enum": ["low", "high"]},
        "risk_reason": {"type": ["string", "null"]},
        "routing_confidence": {"type": ["number", "null"], "minimum": 0, "maximum": 1},
    },
}

_SYSTEM_PROMPT = f"""
너는 한국 금융 고객센터의 상담 접수 보조 AI다.
고객의 STT 전사문만 근거로 요약, 업무 유형, 3층 라우팅, 전달 근거를 JSON으로 작성한다.

[3층 라우팅]
- routing: S(단순: 상담사 판단이 필요 없는 짧은 단일 조회·자동 처리 후보) /
  G(일반: 부서 상담 필요) / E(긴급: 금융사고 정황).
- department는 반드시 다음 중 하나다: {', '.join(_DEPARTMENT_LABELS)}.
- business_code는 해당할 때만 다음 중 하나, 없으면 null: {_BUSINESS_CODE_GUIDE}.
- routing이 E이면 department는 반드시 '사고·신고'다.

[긴급 판정 원리 — 키워드가 아니라 원리로 판단한다]
- 기관 사칭: 검찰·경찰·금융감독원 등 사법·감독기관은 전화로 계좌·송금·개인정보를
  요구하지 않는다. 이런 주체가 위협(체포·수사·범죄 연루) 또는 금전·정보 요구와
  함께 나오면 보이스피싱(E). 기관을 단순 언급만 하면 정상이다.
- 부정 표현: 긴급 표현이 부정형("보이스피싱 아니고요")으로 쓰이면 그 신호는 무효다.
- 입금 vs 출금: 제3자가 내 계좌로 잘못 보낸 입금(착오송금)은 사고·신고 부서의
  일반(G) 접수다. 본인 계좌에서 나간 본인 미승인 출금만 이상거래(E)로 본다.
- 민감어 단독: 인증번호·비밀번호 언급은 정상 상담에도 흔하다. 사칭 주체나 강요
  없이 단독이면 긴급이 아니다.

금융사기, 명의도용, 해킹, 지급정지, 무단거래처럼 실제 사고징후가 있으면
incident_risk를 high로 하고 risk_reason에 근거를 쓴다. 그 외에는 low이고 risk_reason은 null이다.
원문에 없는 사실은 만들지 않는다. 개인정보 마스킹은 이 MVP의 처리 단계가 아니다.
""".strip()


class PipelineConfigurationError(RuntimeError):
    pass


def _client(settings: Settings) -> OpenAI:
    if not settings.openai_api_key:
        raise PipelineConfigurationError("OPENAI_API_KEY is not configured")
    return OpenAI(api_key=settings.openai_api_key)


def transcribe_audio(settings: Settings, filename: str, audio_bytes: bytes) -> TranscriptResult:
    response = _client(settings).audio.transcriptions.create(
        model=settings.openai_stt_model,
        file=(filename, audio_bytes),
        language="ko",
        response_format="verbose_json",
    )
    return TranscriptResult(
        text=response.text.strip(),
        stt_model=settings.openai_stt_model,
        duration_sec=float(getattr(response, "duration", 0) or 0),
    )


def _sanitize_analysis_result(raw: dict) -> dict:
    """LLM 산출물의 taxonomy 일관성 보정 (닫힌 집합 밖 값은 버린다)."""
    if not is_valid_business_code(raw.get("business_code")):
        raw["business_code"] = None
    if raw.get("routing") not in ROUTING_LEVELS:
        raw["routing"] = "G"
    # E인데 부서가 사고·신고가 아니면 강제 정렬 (프롬프트 제약의 코드 방어선)
    if raw.get("routing") == ROUTING_EMERGENCY:
        raw["department"] = EMERGENCY_DEPARTMENT_LABEL
    return raw


def _apply_emergency_override(raw: dict, gate: EmergencyGateResult) -> dict:
    """긴급 게이트가 걸린 콜은 LLM 판단과 무관하게 SG 긴급으로 라우팅한다."""
    raw["routing"] = ROUTING_EMERGENCY
    raw["department"] = EMERGENCY_DEPARTMENT_LABEL
    raw["incident_risk"] = "high"
    gate_reason = f"긴급 게이트(규칙) 판정: {gate.reason}"
    llm_reason = (raw.get("risk_reason") or "").strip()
    raw["risk_reason"] = (
        f"{gate_reason} · {llm_reason}" if llm_reason else gate_reason
    )
    raw["routing_reason"] = (
        f"{gate_reason} — 규칙이 recall floor로 즉시 사고·신고 배정"
    )
    return raw


def _emergency_fallback_result(transcript: str, gate: EmergencyGateResult) -> dict:
    """LLM 실패 시에도 긴급 콜은 규칙 결과만으로 라우팅한다 (서비스 계속)."""
    snippet = " ".join(transcript.split())[:300]
    reason = f"긴급 게이트(규칙) 판정: {gate.reason}"
    return {
        "summary": f"[AI 분석 불가 — 규칙 게이트 접수] {snippet}",
        "business_type": "긴급 금융사고 접수",
        "routing": ROUTING_EMERGENCY,
        "department": EMERGENCY_DEPARTMENT_LABEL,
        "business_code": None,
        "routing_reason": f"{reason} — AI 분석 실패로 규칙 결과만으로 배정",
        "incident_risk": "high",
        "risk_reason": reason,
        "routing_confidence": None,
    }


def request_analysis_result(settings: Settings, transcript: str) -> dict:
    """카드 라우터 1·2단계: 긴급 게이트 → LLM 분석 → 긴급 오버라이드."""

    gate = check_emergency(transcript)
    try:
        response = _client(settings).chat.completions.create(
            model=settings.openai_chat_model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": transcript},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "k7_mvp_consultation_result",
                    "strict": True,
                    "schema": _ANALYSIS_SCHEMA,
                },
            },
        )
    except PipelineConfigurationError:
        # 설정 자체가 없으면 긴급 폴백도 반복 실패한다 — 그대로 알린다
        raise
    except Exception:
        if gate.is_emergency:
            return _emergency_fallback_result(transcript, gate)
        raise

    raw = json.loads(response.choices[0].message.content or "{}")
    raw = _sanitize_analysis_result(raw)
    if gate.is_emergency:
        raw = _apply_emergency_override(raw, gate)
    return raw


def analyze_transcript(
    settings: Settings, transcript: str
) -> tuple[ModelConsultationResult, dict]:
    """Compatibility helper returning both normalized and raw model results."""

    raw = request_analysis_result(settings, transcript)
    return normalize_model_result(raw), raw
