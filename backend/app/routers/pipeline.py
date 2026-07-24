import logging
import uuid
from dataclasses import dataclass

from fastapi import APIRouter, Form, HTTPException, UploadFile
from openai import OpenAI
from pydantic import BaseModel

from app.config import settings
from app.services.pii_guard import PII_SCOPE, mask_transcript
from app.schemas import (
    AnalyzeResult,
    AttentionReasonCode,
    BriefingCard,
    EmotionResult,
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
    RoutingResult,
    TextEmotionResult,
    TranscribeResult,
    VoiceAngerResult,
)
from app.schemas import GptAnalysis
from app.services.emotion import analyze_emotion
from app.services.fusion import fuse_judgement
from app.services.gpt_analysis import analyze_transcript
from app.services.judge import judge as run_judge
from app.services.legacy_adapter import emotion_label_and_score, routing_reason, urgency_score_for
from app.services.local_llm import analyze_transcript_local
from app.services.local_stt import transcribe_audio_local
from app.services.rag import search_procedures
from app.services.react_adapter import build_call_summary, emotion_label, emotion_level_and_signals
from app.services.routing_classifier import classify_routing_safe
from app.services.stt import transcribe_audio
from app.services.stub_models import analyze_transcript_stub, transcribe_audio_stub
from app.services.text_emotion import TextEmotionError, classify_text_emotion
from app.services.voice_anger import analyze_voice_anger

logger = logging.getLogger(__name__)

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
    AttentionReasonCode.TEXT_HIGH_RISK_SIGNAL: "텍스트 상황 고위험 신호",
}


def _get_openai_client() -> OpenAI:
    if not settings.openai_api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY가 서버에 설정되어 있지 않습니다.")
    return OpenAI(api_key=settings.openai_api_key)


def _rag_query(reason_codes: list[AttentionReasonCode], summary: str) -> str:
    labels = " ".join(_REASON_LABELS[code] for code in reason_codes)
    return f"{labels} {summary}".strip()


def _transcribe(filename: str, audio_bytes: bytes) -> TranscribeResult:
    """온프레미스 스위치. stub_models면 canned, 아니면 로컬(faster-whisper)/OpenAI Whisper."""
    if settings.stub_models:
        return transcribe_audio_stub(filename, audio_bytes)
    if settings.use_local_models:
        return transcribe_audio_local(settings, filename, audio_bytes)
    return transcribe_audio(_get_openai_client(), filename, audio_bytes)


def _analyze(transcript: str) -> GptAnalysis:
    """온프레미스 스위치. stub_models면 canned, 아니면 Ollama 로컬 LLM/OpenAI GPT."""
    if settings.stub_models:
        return analyze_transcript_stub(transcript)
    if settings.use_local_models:
        return analyze_transcript_local(settings, transcript)
    return analyze_transcript(_get_openai_client(), transcript)


def _classify_text_emotion_safe(transcript: str) -> TextEmotionResult | None:
    """텍스트 감정분류는 음향 신호를 보완하는 부가 채널이라, 실패해도(Ollama 미기동 등)
    전체 파이프라인을 막지 않고 그냥 이 신호 없이 진행한다."""
    try:
        return classify_text_emotion(settings, transcript)
    except TextEmotionError:
        logger.warning("text_emotion 분류 실패, 융합 없이 진행", exc_info=True)
        return None


@dataclass
class _CallAnalysis:
    """오디오 한 통을 끝까지 분석한 결과 묶음 — '병합된 judgement'까지 포함한다."""

    transcribed: TranscribeResult
    gpt_result: GptAnalysis
    emotion_result: EmotionResult
    text_emotion_result: TextEmotionResult | None
    routing_result: RoutingResult | None
    voice_anger_result: VoiceAngerResult | None
    judgement: JudgeResult


def _analyze_call(filename: str, audio_bytes: bytes) -> _CallAnalysis:
    """원본 오디오 → 전사·요약·격양도(eGeMAPS)·라우팅·음성분노(WavLM)를 돌리고 judge를
    fusion으로 승격까지 끝낸 '병합된 judgement'를 만든다.

    /briefing(브리핑 카드)과 /summarize-call(CS 요약 카드)이 이 하나를 공유한다 —
    두 출력 모양이 달라도 '주의등급을 만드는 과정'은 완전히 동일해야 하기 때문이다.
    voice_anger/text_emotion이 없으면 fusion은 무동작이라 기존 동작과 같다(하위호환).
    """
    transcribed = _transcribe(filename, audio_bytes)
    # 개인정보 보호(주제 11·12): 전사 직후 마스킹 → 이후 분석(LLM)·응답은 마스킹본만.
    # mvp.py의 /api/v1/calls와 동일한 규율. 원본 오디오는 이 요청 처리 중에만 쓰고 저장하지 않는다.
    transcribed.text, _pii = mask_transcript(transcribed.text)
    gpt_result = _analyze(transcribed.text)
    emotion_result = analyze_emotion(audio_bytes)
    text_emotion_result = _classify_text_emotion_safe(transcribed.text)
    routing_result = classify_routing_safe(transcribed.text)
    # 음성 분노(WavLM) 부스터 입력 — 모델/의존성 없으면 None(부스터 무동작, 하위호환).
    voice_anger_result = analyze_voice_anger(audio_bytes)

    judgement = run_judge(gpt_result.risk_flags, emotion_result)
    if text_emotion_result is not None or voice_anger_result is not None:
        judgement = fuse_judgement(
            judgement,
            text_emotion_result,
            voice_anger=voice_anger_result,
            audio_emotion=emotion_result,
        )

    return _CallAnalysis(
        transcribed=transcribed,
        gpt_result=gpt_result,
        emotion_result=emotion_result,
        text_emotion_result=text_emotion_result,
        routing_result=routing_result,
        voice_anger_result=voice_anger_result,
        judgement=judgement,
    )


@router.post("/stt", response_model=TranscribeResult)
async def stt_endpoint(audio: UploadFile) -> TranscribeResult:
    audio_bytes = await audio.read()
    return _transcribe(audio.filename or "audio.wav", audio_bytes)


@router.post("/analyze", response_model=AnalyzeResult)
async def analyze_endpoint(audio: UploadFile, transcript: str = Form(...)) -> AnalyzeResult:
    audio_bytes = await audio.read()

    gpt_result = _analyze(transcript)
    emotion_result = analyze_emotion(audio_bytes)
    text_emotion_result = _classify_text_emotion_safe(transcript)
    routing_result = classify_routing_safe(transcript)

    return AnalyzeResult(
        gpt=gpt_result,
        emotion=emotion_result,
        text_emotion=text_emotion_result,
        routing=routing_result,
    )


@router.post("/judge", response_model=JudgeResult)
async def judge_endpoint(body: JudgeRequest) -> JudgeResult:
    return run_judge(body.gpt.risk_flags, body.emotion)


@router.post("/rag", response_model=RagResult)
async def rag_endpoint(body: RagRequest) -> RagResult:
    query = _rag_query(body.reason_codes, body.summary)
    documents = search_procedures(settings, query)
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

    # 관련 규정(김동희 RAG) — 상담 유의사항/응대 가이드로 프론트에 넘긴다. 실패해도 분석은 유지.
    try:
        references = search_procedures(settings, body.text, top_k=3)
    except Exception:
        logger.warning("규정 RAG 검색 실패 — references 없이 진행", exc_info=True)
        references = []

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
        references=references,
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


@router.post("/summarize-call", response_model=ReactCallSummary)
async def react_summarize_call_endpoint(audio: UploadFile) -> ReactCallSummary:
    """kda4-k7-product 연동 — 원본 오디오로 AI 사전요약 카드(CallSummary)를 반환한다.

    텍스트 전용 /summarize와 달리 실제 음성을 받아 격양도(eGeMAPS)·음성분노(WavLM)를 함께
    돌리고, fusion으로 '병합된 주의등급'을 카드에 싣는다 — 격양도가 낮아 감정온도는 '안정'
    이어도, WavLM이 분노를 잡으면 incidentRisk가 상향돼 상담사 화면에 '주의 상향'이 뜬다
    ('냉정한 분노'). 감정온도(emotion)는 격양도 원본 그대로 두고 덮어쓰지 않는다.
    """
    audio_bytes = await audio.read()
    analysis = _analyze_call(audio.filename or "audio.wav", audio_bytes)

    return build_call_summary(
        department=analysis.gpt_result.department,
        summary=analysis.gpt_result.summary,
        emotion=analysis.emotion_result,
        attention_level=analysis.judgement.attention_level,
        recommended_agent_level=analysis.judgement.recommended_agent_level,
    )


@router.post("/briefing", response_model=BriefingCard)
async def briefing_endpoint(audio: UploadFile) -> BriefingCard:
    audio_bytes = await audio.read()
    analysis = _analyze_call(audio.filename or "audio.wav", audio_bytes)

    # 김민기 RAG 설계: 긴급(EMERGENCY=사고·신고) 통화면 SG 대분류 규정만 좁혀 추천.
    # 그 외에는 전체 검색(기존 동작 유지). 에스컬레이션 안전 — 확실한 신호일 때만 필터.
    rag_categories = (
        ["SG"]
        if analysis.routing_result is not None
        and analysis.routing_result.classification == "EMERGENCY"
        else None
    )
    references = search_procedures(
        settings,
        _rag_query(analysis.judgement.reason_codes, analysis.gpt_result.summary),
        categories=rag_categories,
    )

    return BriefingCard(
        call_id=analysis.transcribed.call_id,
        transcript=analysis.transcribed.text,
        summary=analysis.gpt_result.summary,
        department=analysis.gpt_result.department,
        emotion=analysis.emotion_result,
        text_emotion=analysis.text_emotion_result,
        routing=analysis.routing_result,
        judgement=analysis.judgement,
        references=references,
    )


# ── 개인정보 보호 데모 도구 (발표 C. 개인정보·보안) ──────────────────
class PiiScanRequest(BaseModel):
    text: str


@router.post("/pii/scan")
async def pii_scan_endpoint(body: PiiScanRequest) -> dict:
    """정규식 기반 개인정보 탐지·마스킹 시연(주제 12).

    임의 문장을 넣으면 무엇을 개인정보로 보고(주제 10) 어떻게 마스킹했는지 돌려준다.
    발표에서 "정규식/NER 탐지, 애매하면 마스킹" 원칙을 라이브로 보여주는 용도.
    """
    masked, hits = mask_transcript(body.text)
    return {
        "scope": list(PII_SCOPE.values()),  # 주제 10: 무엇을 개인정보로 보는가
        "masked": masked,                     # 주제 12: 마스킹 결과 (저장·AI 입력은 이것만)
        "count": len(hits),
        "hits": [
            {"type": h.type, "label": h.label, "original": h.original, "masked": h.masked}
            for h in hits
        ],
    }
