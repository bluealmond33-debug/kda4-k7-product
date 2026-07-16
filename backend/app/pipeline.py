import json

from openai import OpenAI

from app.config import Settings
from app.contracts import ModelConsultationResult, TranscriptResult
from app.model_adapter import normalize_model_result


_DEPARTMENTS = [
    "대출 및 금융상담",
    "금융사기",
    "외화",
    "전자금융",
    "민원",
    "ARS",
]

_ANALYSIS_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "summary",
        "business_type",
        "department",
        "routing_reason",
        "incident_risk",
        "risk_reason",
        "routing_confidence",
    ],
    "properties": {
        "summary": {"type": "string"},
        "business_type": {"type": "string"},
        "department": {"type": "string", "enum": _DEPARTMENTS},
        "routing_reason": {"type": "string"},
        "incident_risk": {"type": "string", "enum": ["low", "high"]},
        "risk_reason": {"type": ["string", "null"]},
        "routing_confidence": {"type": ["number", "null"], "minimum": 0, "maximum": 1},
    },
}

_SYSTEM_PROMPT = f"""
너는 한국 금융 고객센터의 상담 접수 보조 AI다.
고객의 STT 전사문만 근거로 요약, 업무 유형, 전달 부서, 전달 근거를 JSON으로 작성한다.
department는 반드시 다음 중 하나다: {', '.join(_DEPARTMENTS)}.
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


def request_analysis_result(settings: Settings, transcript: str) -> dict:
    """Call the current analysis provider and return its unmodified JSON result."""

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
    return json.loads(response.choices[0].message.content or "{}")


def analyze_transcript(
    settings: Settings, transcript: str
) -> tuple[ModelConsultationResult, dict]:
    """Compatibility helper returning both normalized and raw model results."""

    raw = request_analysis_result(settings, transcript)
    return normalize_model_result(raw), raw
