import os

# faiss(RAG)와 faster-whisper/ctranslate2가 서로 다른 OpenMP 런타임(libiomp5md.dll /
# libomp140.dll)을 링크해서 같은 프로세스에서 둘 다 쓰면 Windows에서 충돌·크래시가 난다.
# 다른 라이브러리 import 전에 설정해야 효과가 있다. (온프레미스 모드에서만 실제로 문제됨)
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import initialize_database, ping_database
from app.routers.mvp import router as mvp_router
from app.routers.pipeline import router as pipeline_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.database_url:
        initialize_database(settings)
    yield


app = FastAPI(title="NARS(No ARS) — 보이스피싱 상담 브리핑 API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(pipeline_router)
app.include_router(mvp_router)


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "database": "connected" if ping_database(settings) else "not_connected",
        "contract_version": "mvp-1.0",
    }
