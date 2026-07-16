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


app = FastAPI(title="보이스피싱 상담 브리핑 API", lifespan=lifespan)

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
