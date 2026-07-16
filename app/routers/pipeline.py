import uuid

from fastapi import APIRouter, Form, HTTPException, UploadFile
from openai import OpenAI

from app.config import settings
from app.schemas import (
    AnalyzeResult,
    AttentionReasonCode,
    BriefingCard,
    JudgeRequest,
    JudgeResult,
    LegacyAnalyzeRequest,
    LegacyAnalyzeResponse,
    LegacyEmotion,
    LegacyRouting,
    RagRequest,
    RagResult,
    ReactCallSummary,
    ReactEmotionRequest,
    ReactEmotionScore,
    ReactSummarizeRequest,
    TranscribeResult,
)
from app.schemas import GptAnalysis
from app.services.emotion import analyze_emotion
from app.services.gpt_analysis import analyze_transcript
from app.services.judge import judge as run_judge
from app.services.legacy_adapter import emotion_label_and_score, routing_reason, urgency_score_for
from app.services.local_llm import analyze_transcript_local
from app.services.local_stt import transcribe_audio_local
from app.services.rag import search_procedures
from app.services.react_adapter import build_call_summary, emotion_label, emotion_level_and_signals
from app.services.stt import transcribe_audio

router = APIRouter()

_REASON_LABELS: dict[AttentionReasonCode, str] = {
    AttentionReasonCode.FINANCIAL_ACCIDENT: "금융사고 발생",
    AttentionReasonCode.CREDENTIAL_EXPOSED: "인증정보 노출",
    AttentionReasonCode.REMOTE_APP_INSTALLED: "원격제어 앱 설치",
    AttentionReasonCode.CONTROL_LOST: "통제권 상실",
    AttentionReasonCode.PROTECTION_NOT_DONE: "보호조치 미완료",
    AttentionReasonCode.MISSING_CRITICAL_INFO: "핵심 정보 누락",
    AttentionReasonCode.MULTIPLE_INTENTS: "복합 상담",
    AttentionReasonCode.REPEAT_CONTACT: "반복 연락",
    AttentionReasonCode.PRIOR_RESOLUTION_FAILED: "이전 해결 실패",
    AttentionReasonCode.HIGH_EMOTIONAL_DISTRESS: "고객 감정 주의",
}


def _get_openai_client() -> OpenAI:
    if not settings.openai_api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY가 서버에 설정되어 있지 않습니다.")
    return OpenAI(api_key=settings.openai_api_key)


def _rag_query(reason_codes: list[AttentionReasonCode], summary: str) -> str:
    labels = " ".join(_REASON_LABELS[code] for code in reason_codes)
    return f"{labels} {summary}".strip()


def _transcribe(filename: str, audio_bytes: bytes) -> TranscribeResult:
    """온프레미스 스위치(settings.use_local_models) — true면 faster-whisper, 아니면 OpenAI Whisper."""
    if settings.use_local_models:
        return transcribe_audio_local(settings, filename, audio_bytes)
    return transcribe_audio(_get_openai_client(), filename, audio_bytes)


def _analyze(transcript: str) -> GptAnalysis:
    """온프레미스 스위치(settings.use_local_models) — true면 Ollama 로컬 LLM, 아니면 OpenAI GPT.

    ⚠️ RAG(search_procedures)는 임베딩 때문에 이 스위치와 무관하게 아직 OpenAI를 쓴다 —
    로컬 임베딩 모델 전환은 별도 작업으로 남겨둠."""
    if settings.use_local_models:
        return analyze_transcript_local(settings, transcript)
    return analyze_transcript(_get_openai_client(), transcript)


@router.post("/stt", response_model=TranscribeResult)
async def stt_endpoint(audio: UploadFile) -> TranscribeResult:
    audio_bytes = await audio.read()
    return _transcribe(audio.filename or "audio.wav", audio_bytes)


@router.post("/analyze", response_model=AnalyzeResult)
async def analyze_endpoint(audio: UploadFile, transcript: str = Form(...)) -> AnalyzeResult:
    audio_bytes = await audio.read()

    gpt_result = _analyze(transcript)
    emotion_result = analyze_emotion(audio_bytes)

    return AnalyzeResult(gpt=gpt_result, emotion=emotion_result)


@router.post("/judge", response_model=JudgeResult)
async def judge_endpoint(body: JudgeRequest) -> JudgeResult:
    return run_judge(body.gpt.risk_flags, body.emotion)


@router.post("/rag", response_model=RagResult)
async def rag_endpoint(body: RagRequest) -> RagResult:
    client = _get_openai_client()
    query = _rag_query(body.reason_codes, body.summary)
    documents = search_procedures(client, query)
    return RagResult(documents=documents)


@router.post("/analyze-text", response_model=LegacyAnalyzeResponse)
async def analyze_text_endpoint(body: LegacyAnalyzeRequest) -> LegacyAnalyzeResponse:
    """demo_live.html용 어댑터 — 브라우저 STT로 이미 뽑힌 텍스트를 받아
    api_contract.md 스키마(summary/category/emotion/urgency_score/routing/keywords)로 응답한다."""
    gpt_result = _analyze(body.text)
    emotion_result = analyze_emotion(body.text.encode("utf-8"))
    judgement = run_judge(gpt_result.risk_flags, emotion_result)

    reason_labels = [_REASON_LABELS[code] for code in judgement.reason_codes]
    emotion_label, emotion_score = emotion_label_and_score(emotion_result)

    return LegacyAnalyzeResponse(
        call_id=str(uuid.uuid4()),
        summary=gpt_result.summary,
        category=gpt_result.department,
        emotion=LegacyEmotion(label=emotion_label, score=emotion_score),
        urgency_score=urgency_score_for(judgement.attention_level),
        routing=LegacyRouting(
            department=gpt_result.department,
            reason=routing_reason(reason_labels, gpt_result.department),
        ),
        keywords=gpt_result.keywords,
    )


@router.post("/emotion", response_model=ReactEmotionScore)
async def react_emotion_endpoint(body: ReactEmotionRequest) -> ReactEmotionScore:
    """kda4-k7-product 연동 — 텍스트 하나로 감정온도(EmotionScore)를 반환한다."""
    emotion_result = analyze_emotion(body.text.encode("utf-8"))
    level, signals = emotion_level_and_signals(emotion_result)
    return ReactEmotionScore(level=level, label=emotion_label(level), signals=signals)


@router.post("/summarize", response_model=ReactCallSummary)
async def react_summarize_endpoint(body: ReactSummarizeRequest) -> ReactCallSummary:
    """kda4-k7-product 연동 — 전사문 하나로 AI 사전요약(CallSummary)을 반환한다."""
    transcript_text = body.transcript.text

    gpt_result = _analyze(transcript_text)
    emotion_result = analyze_emotion(transcript_text.encode("utf-8"))
    judgement = run_judge(gpt_result.risk_flags, emotion_result)

    return build_call_summary(
        department=gpt_result.department,
        summary=gpt_result.summary,
        emotion=emotion_result,
        attention_level=judgement.attention_level,
        recommended_agent_level=judgement.recommended_agent_level,
    )


@router.post("/briefing", response_model=BriefingCard)
async def briefing_endpoint(audio: UploadFile) -> BriefingCard:
    audio_bytes = await audio.read()

    transcribed = _transcribe(audio.filename or "audio.wav", audio_bytes)
    gpt_result = _analyze(transcribed.text)
    emotion_result = analyze_emotion(audio_bytes)
    judgement = run_judge(gpt_result.risk_flags, emotion_result)
    # RAG는 임베딩이 필요해 온프레미스 스위치와 무관하게 아직 OpenAI를 쓴다.
    references = search_procedures(_get_openai_client(), _rag_query(judgement.reason_codes, gpt_result.summary))

    return BriefingCard(
        call_id=transcribed.call_id,
        transcript=transcribed.text,
        summary=gpt_result.summary,
        department=gpt_result.department,
        emotion=emotion_result,
        judgement=judgement,
        references=references,
    )
