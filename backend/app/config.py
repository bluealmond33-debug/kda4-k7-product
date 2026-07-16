from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings shared by Railway and local development."""

    database_url: str = ""
    openai_api_key: str = ""
    openai_chat_model: str = "gpt-4o-mini"
    openai_stt_model: str = "whisper-1"
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


@lru_cache
def get_settings() -> Settings:
    return Settings()
