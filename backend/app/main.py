import shutil
import tempfile
import threading
from contextlib import asynccontextmanager
from pathlib import Path
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
    get_regulation_stats,
    initialize_rag,
    search_regulations,
    get_regulation_document,
)
from app.rag import embedder
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
    # 임베더 warm-up — bge-m3 lazy load가 첫 검색을 수 초 지연시키지 않도록
    # 백그라운드 스레드에서 미리 로드한다 (부팅은 막지 않음, 실패해도 무해).
    threading.Thread(target=embedder.is_available, daemon=True).start()
    yield


app = FastAPI(
    title="K7 상담카드 통합 API",
    version="mvp-1.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    # Vercel 프리뷰 배포(k7product-git-<branch>-….vercel.app)도 허용 —
    # 프로덕션 외 프리뷰 URL에서도 규정검색 등 API 호출이 가능해야 리뷰가 된다.
    allow_origin_regex=r"https://.*\.vercel\.app",
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


@app.get("/api/v1/regulations/stats")
def regulation_stats() -> dict:
    """지식베이스 실측 통계(활성 문서·청크 수) — 관리자 콘솔 'DB·지식베이스' 패널용."""
    try:
        counts = get_regulation_stats(settings)
    except RegulationSearchUnavailable:
        return {"available": False, "documents": None, "chunks": None}
    return {"available": True, **counts}


# 개정본 감지용 문서 대장 — 같은 파일명이 대장에 있으면 새 업로드를 개정본으로 처리한다
REGISTRY_CSV = Path(__file__).resolve().parents[2] / "database" / "rag" / "registry.csv"


@app.post("/api/v1/regulations/upload", status_code=status.HTTP_201_CREATED)
def upload_regulation(pdf: UploadFile = File(...)) -> dict:
    """관리자 콘솔 규정 PDF 자동 적재 — 업로드 한 번으로 청킹→카테고리 추천→임베딩→적재.

    hippo RAG 설계 8장의 (A) '백엔드 업로드 화면' 경로. auto_ingest의 preview+commit을
    한 번에 실행한다 — 데모에선 추천 카테고리를 자동 채택하고, 근거(키워드·확신도)를
    응답에 담아 화면에서 사후 확인한다. 같은 파일명 재업로드는 동일 doc_id로 멱등 갱신,
    registry 대장에 있는 파일명이면 개정본 처리(옛 버전은 superseded로 보관).
    스캔본 PDF는 OCR 의존성이 있으면 자동 처리, 없으면 안내 메시지로 실패한다.
    """
    filename = Path(pdf.filename or "").name
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=415, detail="PDF 파일만 업로드할 수 있습니다")
    if not settings.database_url:
        raise HTTPException(status_code=503, detail="DATABASE_URL is not configured")
    from app.rag import auto_ingest  # pdfplumber 등 무거운 의존성 — 요청 시에만 로드

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / filename
        with path.open("wb") as out:
            shutil.copyfileobj(pdf.file, out)
        try:
            preview = auto_ingest.preview(
                path, registry_path=REGISTRY_CSV if REGISTRY_CSV.exists() else None
            )
            loaded = auto_ingest.commit(
                preview, settings, supersede_doc_id=preview.revision_of
            )
        except HTTPException:
            raise
        except RegulationSearchUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except RuntimeError as exc:  # OCR 선택 의존성 미설치 등 — 안내 문구 그대로 전달
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"PDF 처리 실패: {exc}") from exc

    return {
        "filename": preview.filename,
        "title": Path(preview.filename).stem,
        "doc_id": preview.chunks[0]["doc_id"] if preview.chunks else None,
        "is_scanned": preview.is_scanned,
        "chunks_loaded": loaded,
        "n_text": preview.n_text,
        "n_table": preview.n_table,
        "revision_of": preview.revision_of,
        "suggestion": {
            "department": preview.suggestion.department,
            "business_code": preview.suggestion.business_code,
            "confidence": preview.suggestion.confidence,
            "why": preview.suggestion.why,
        },
    }


@app.get("/api/v1/regulations/documents/{doc_id}")
def read_regulation_document(doc_id: str) -> dict:
    """규정 문서 원문 열람 — 메타 + 페이지순 청크 전체 (프론트 원문 시트용)."""
    try:
        doc = get_regulation_document(settings, doc_id)
    except RegulationSearchUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if doc is None:
        raise HTTPException(status_code=404, detail=f"unknown document: {doc_id}")
    return doc


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
