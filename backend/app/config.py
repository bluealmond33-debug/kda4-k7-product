from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings shared by Railway and local development."""

    pipeline_mode: Literal["cloud", "local"] = "cloud"
    database_url: str = ""
    openai_api_key: str = ""
    openai_chat_model: str = "gpt-4o-mini"
    openai_stt_model: str = "whisper-1"
    local_stt_model: str = "small"
    local_stt_device: str = "cpu"
    local_stt_compute_type: str = "int8"
    local_stt_model_dir: str = "/models/whisper"
    ollama_base_url: str = "http://ollama:11434"
    ollama_model: str = "exaone3.5:7.8b"
    ollama_timeout_sec: float = 180
    routing_topic_enabled: bool = True
    routing_topic_model_path: str = (
        "backend/app/services/routing/models/bank_topic_classifier.joblib"
    )
    routing_topic_model_sha256: str = (
        "0474677A2C335817F9F677A37077C3E56C81BD2CB3378E506B6479910A263832"
    )
    routing_topic_margin_threshold: float = 0.75
    frontend_origin: str = "http://localhost:5173"
    extra_cors_origins: str = "https://k7product.vercel.app"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origins(self) -> list[str]:
        origins = [self.frontend_origin]
        origins.extend(
            origin.strip()
            for origin in self.extra_cors_origins.split(",")
            if origin.strip()
        )
        return list(dict.fromkeys(origins))

    @property
    def is_local_pipeline(self) -> bool:
        return self.pipeline_mode.strip().lower() == "local"


@lru_cache
def get_settings() -> Settings:
    return Settings()
