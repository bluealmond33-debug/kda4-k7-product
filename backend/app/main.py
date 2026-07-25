import os

# faiss(RAG)와 faster-whisper/ctranslate2가 서로 다른 OpenMP 런타임(libiomp5md.dll /
# libomp140.dll)을 링크해서 같은 프로세스에서 둘 다 쓰면 Windows에서 충돌·크래시가 난다.
# 다른 라이브러리 import 전에 설정해야 효과가 있다. (온프레미스 모드에서만 실제로 문제됨)
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from app.classification import feedback_demo as clf_feedback
from app.config import settings
from app.database import initialize_database, ping_database
from app.rag import RegulationSearchUnavailable, embedder, initialize_rag
from app.routers.mvp import router as mvp_router
from app.routers.pipeline import router as pipeline_router
from app.routers.regulations import router as regulations_router
from app.ws.call import router as ws_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.database_url:
        initialize_database(settings)
        # 규정 RAG는 pgvector가 필요해 선택적이다. 부팅을 막지 않는다.
        try:
            initialize_rag(settings)
        except RegulationSearchUnavailable:
            pass
    # 임베더 warm-up — bge-m3 lazy load가 첫 검색을 수 초 지연시키지 않도록
    # 백그라운드에서 미리 로드한다(부팅은 막지 않음, 실패해도 무해).
    threading.Thread(target=embedder.is_available, daemon=True).start()
    yield


app = FastAPI(
    title="KARI-NA(Kiwoom Academy Response Innovation · No ARS) — 상담카드 통합 API",
    version="mvp-1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    # Vercel 프리뷰 배포(k7product-git-<branch>-….vercel.app)도 허용
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],  # WebSocket·파일 업로드가 있어 GET/POST/OPTIONS로는 부족
    allow_headers=["*"],
)

# 레거시 데모 경로(/analyze-text·/summarize·/emotion·/judge·/rag·/briefing·/stt·
# /analyze)는 엔진 pipeline 라우터가 온프레미스(stub/local/OpenAI) 인지 형태로 제공한다.
# product의 compat 라우터(app/compat.py)는 같은 경로의 부분집합을 OpenAI 전용으로만
# 제공해 온프레미스 핸들러를 가렸으므로 include하지 않는다(ADR-0012 이식 정리).
app.include_router(pipeline_router)
app.include_router(mvp_router)
app.include_router(regulations_router)  # 규정 지식베이스 /api/v1/regulations/*
app.include_router(ws_router)           # 실시간 통화 WebSocket /ws/call/{call_id}


# ── 분류기 개선 피드백 루프 — 상담사가 후처리 화면에서 AI 분류 판정을 검수/교정한다.
#    틀린 판정만 edge_cases.jsonl에 학습 데이터로 축적된다. verdict=incorrect 만 학습
#    마스터에 append, task_code에서 부서·업무명·handler를 서버가 파생.
@app.post("/api/v1/classifier/feedback", status_code=status.HTTP_201_CREATED)
def classifier_feedback(payload: dict) -> dict:
    try:
        return clf_feedback.save_feedback(payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/v1/classifier/catalog")
def classifier_catalog() -> dict:
    """교정 드롭다운용 업무 카탈로그 — code·name·routing(S/G/E)·department·business_code."""
    return {"tasks": clf_feedback.task_catalog()}


@app.get("/api/v1/classifier/stats")
def classifier_stats() -> dict:
    """학습 후보 통계 — total·incorrect·reusable_edge_cases(고유 정규화 발화 수)."""
    return clf_feedback.feedback_stats()


@app.post("/api/v1/classifier/session/start", status_code=status.HTTP_201_CREATED)
def classifier_session_start() -> dict:
    return clf_feedback.start_review_session()


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "database": "connected" if ping_database(settings) else "not_connected",
        "contract_version": "mvp-1.0",
    }
