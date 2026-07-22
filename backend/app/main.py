from contextlib import asynccontextmanager
from uuid import UUID, uuid4

from fastapi import FastAPI, File, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.compat import build_compat_router
from app.contracts import (
    HealthResponse,
    MvpCallResponse,
)
from app.database import (
    DatabaseUnavailable,
    get_call,
    initialize_database,
    ping_database,
)
from app.integration_service import persist_pipeline_result
from app.card_routing_pipeline import (
    PipelineConfigurationError,
    request_analysis_result,
    transcribe_audio,
)
from app.rag import (
    RegulationSearchUnavailable,
    initialize_rag,
    search_regulations,
)
from app.rag.taxonomy import is_valid_category


settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.database_url:
        initialize_database(settings)
        # regulation RAG is optional (needs pgvector); never block startup.
        try:
            initialize_rag(settings)
        except RegulationSearchUnavailable:
            pass
    yield


app = FastAPI(
    title="K7 상담카드 통합 API",
    version="mvp-1.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)
app.include_router(build_compat_router(settings))


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        database="connected" if ping_database(settings) else "not_connected",
    )


@app.post(
    "/api/v1/calls",
    response_model=MvpCallResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_call(audio: UploadFile = File(...)) -> MvpCallResponse:
    if not audio.content_type or not audio.content_type.startswith("audio/"):
        raise HTTPException(status_code=415, detail="audio file is required")
    try:
        audio_bytes = audio.file.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="audio file is empty")
        call_id = uuid4()
        transcript = transcribe_audio(settings, audio.filename or "customer-audio.wav", audio_bytes)
        raw_model_result = request_analysis_result(settings, transcript.text)
        return persist_pipeline_result(
            settings,
            call_id=call_id,
            audio_filename=audio.filename or "customer-audio.wav",
            transcript=transcript,
            raw_model_result=raw_model_result,
        )
    except HTTPException:
        raise
    except (DatabaseUnavailable, PipelineConfigurationError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"call pipeline failed: {exc}") from exc


@app.get("/api/v1/regulations/search")
def search_regulations_endpoint(
    q: str,
    category: str | None = None,
    k: int = 5,
) -> dict:
    """Hybrid regulation search for the "관련 규정 및 매뉴얼" panel.

    Returns {available, documents}. `available` is False (not an error) when the
    RAG index or embedding model is not provisioned, so the panel can fall back
    to its manual file list instead of showing a failure.
    """
    if not q.strip():
        raise HTTPException(status_code=400, detail="q is required")
    if not is_valid_category(category):
        raise HTTPException(status_code=400, detail=f"unknown category: {category}")
    try:
        documents = search_regulations(
            settings, q, category=category, limit=max(1, min(k, 20))
        )
    except RegulationSearchUnavailable:
        return {"query": q, "category": category, "available": False, "documents": []}
    return {"query": q, "category": category, "available": True, "documents": documents}


@app.get(
    "/api/v1/calls/{call_id}/consultation-card",
    response_model=MvpCallResponse,
)
def read_consultation_card(call_id: UUID) -> MvpCallResponse:
    try:
        response = get_call(settings, call_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if response is None:
        raise HTTPException(status_code=404, detail="call not found")
    return response
