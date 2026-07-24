import os

# faiss(RAG)와 faster-whisper/ctranslate2가 서로 다른 OpenMP 런타임(libiomp5md.dll /
# libomp140.dll)을 링크해서 같은 프로세스에서 둘 다 쓰면 Windows에서 충돌·크래시가 난다.
# 다른 라이브러리 import 전에 설정해야 효과가 있다. (온프레미스 모드에서만 실제로 문제됨)
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.compat import build_compat_router
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

app.include_router(build_compat_router(settings))
app.include_router(pipeline_router)
app.include_router(mvp_router)
app.include_router(regulations_router)  # 규정 지식베이스 /api/v1/regulations/*
app.include_router(ws_router)           # 실시간 통화 WebSocket /ws/call/{call_id}


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "database": "connected" if ping_database(settings) else "not_connected",
        "contract_version": "mvp-1.0",
    }
