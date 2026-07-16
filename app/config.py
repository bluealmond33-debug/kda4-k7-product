from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    openai_api_key: str = ""
    openai_chat_model: str = "gpt-4o-mini"
    frontend_origin: str = "http://localhost:3000"
    chroma_persist_dir: str = "./data/chroma"
    extra_cors_origins: str = ""
    database_url: str = ""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def cors_allow_origins(self) -> list[str]:
        # 로컬 개발용 — 우리 대시보드(Next.js)와 팀원 demo_live.html/React(kda4-k7-product) 둘 다 허용.
        # 배포된 프론트(Vercel) 도메인은 EXTRA_CORS_ORIGINS 환경변수(콤마 구분)로 추가한다.
        origins = [
            self.frontend_origin,
            "http://localhost:5500",
            "http://127.0.0.1:5500",
            "http://localhost:5173",
            "http://localhost:8788",
        ]
        origins.extend(o.strip() for o in self.extra_cors_origins.split(",") if o.strip())
        return origins


settings = Settings()
