"""K7 mvp-1.0 통합 API — POST /api/v1/calls, GET /api/v1/calls/{call_id}/consultation-card.

이찬희 파트(kda4-k7-product/lch)가 정의한 PostgreSQL 스키마·응답 계약을 그대로 쓰되,
STT/GPT분석/judge는 우리 기존 파이프라인(app/services/*)을 그대로 재사용한다.
"""

from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from openai import OpenAI

from app.config import settings
from app.contracts import CallStatus, ConsultationCard, MvpCallResponse, TranscriptResult
from app.database import DatabaseUnavailable, get_call, save_call
from app.services.emotion import analyze_emotion, analyze_emotion_mvp
from app.services.gpt_analysis import analyze_transcript
from app.services.judge import judge as run_judge
from app.services.local_llm import analyze_transcript_local
from app.services.local_stt import transcribe_audio_local
from app.services.mvp_adapter import to_consultation_card
from app.services.stt import transcribe_audio
from app.services.stub_models import analyze_transcript_stub, transcribe_audio_stub

router = APIRouter(tags=["mvp-v1"])


def _get_openai_client() -> OpenAI:
    if not settings.openai_api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY가 서버에 설정되어 있지 않습니다.")
    return OpenAI(api_key=settings.openai_api_key)


@router.post(
    "/api/v1/calls",
    response_model=MvpCallResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_call(audio: UploadFile = File(...)) -> MvpCallResponse:
    if not audio.content_type or not audio.content_type.startswith("audio/"):
        raise HTTPException(status_code=415, detail="audio file is required")

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="audio file is empty")

    try:
        if settings.stub_models:
            transcribed = transcribe_audio_stub(audio.filename or "customer-audio.wav", audio_bytes)
            gpt_result = analyze_transcript_stub(transcribed.text)
        elif settings.use_local_models:
            transcribed = transcribe_audio_local(settings, audio.filename or "customer-audio.wav", audio_bytes)
            gpt_result = analyze_transcript_local(settings, transcribed.text)
        else:
            client = _get_openai_client()
            transcribed = transcribe_audio(client, audio.filename or "customer-audio.wav", audio_bytes)
            gpt_result = analyze_transcript(client, transcribed.text)
        emotion_result_for_judge = analyze_emotion(audio_bytes)
        judgement = run_judge(gpt_result.risk_flags, emotion_result_for_judge)
        card: ConsultationCard = to_consultation_card(
            gpt_result, judgement, emotion=analyze_emotion_mvp(audio_bytes)
        )

        response = MvpCallResponse(
            call_id=uuid4(),
            status=CallStatus.READY,
            audio_filename=audio.filename or "customer-audio.wav",
            transcript=TranscriptResult(
                text=transcribed.text,
                stt_model=(
                    "stub"
                    if settings.stub_models
                    else f"faster-whisper:{settings.local_whisper_model}"
                    if settings.use_local_models
                    else "whisper-1"
                ),
                duration_sec=transcribed.duration_sec,
            ),
            consultation_card=card,
            created_at=datetime.now(timezone.utc),
        )
        save_call(settings, response, gpt_result.model_dump())
        return response
    except HTTPException:
        raise
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"call pipeline failed: {exc}") from exc


@router.get(
    "/api/v1/calls/{call_id}/consultation-card",
    response_model=MvpCallResponse,
)
async def read_consultation_card(call_id: UUID) -> MvpCallResponse:
    try:
        response = get_call(settings, call_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if response is None:
        raise HTTPException(status_code=404, detail="call not found")
    return response
