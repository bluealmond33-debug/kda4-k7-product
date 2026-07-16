from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers.pipeline import router as pipeline_router

app = FastAPI(title="보이스피싱 상담 브리핑 API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(pipeline_router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
