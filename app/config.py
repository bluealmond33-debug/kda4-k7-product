from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    openai_api_key: str = ""
    openai_chat_model: str = "gpt-4o-mini"
    frontend_origin: str = "http://localhost:3000"
    chroma_persist_dir: str = "./data/chroma"
    extra_cors_origins: str = ""
    database_url: str = ""

    # 온프레미스 데모용 — true면 OpenAI 대신 로컬 STT(faster-whisper)/로컬 LLM(Ollama)을 쓴다.
    use_local_models: bool = False

    # 데모 스텁 스위치 — true면 로컬모델/OpenAI 대신 canned 응답(UI 흐름 데모용).
    # cpu 프로파일(docker-compose.yml)에서 켠다. 실배포에선 false 유지(키 누락을 가리지 않도록).
    stub_models: bool = False
    local_whisper_model: str = "large-v3-turbo"
    local_whisper_device: str = "cuda"
    local_whisper_compute_type: str = "float16"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "exaone3.5:7.8b"

    # 박정운 emotion_temperature v4 모델(격양도) — 파일 없으면 emotion.py가 자동으로 스텁 폴백.
    emotion_temperature_model_path: str = "app/services/k7modeling/models/emotion_temperature_demo_final_v4.joblib"
    emotion_temperature_model_sha256: str = (
        "88e2c3f3e0d85497a3e59a84ac42835ccf8620aab999de27cdb9ff92fc27d4ac"
    )

    # 전형진 WavLM 음성분노 모델(.pt 체크포인트) + HF backbone 캐시.
    # 파일/의존성(torch·transformers) 없으면 voice_anger.py가 자동으로 None 폴백(부스터 무동작).
    wavlm_anger_model_path: str = "app/services/k7modeling/models/wavlm_anger_layer_fusion_v1.pt"
    wavlm_anger_cache_dir: str = "app/services/k7modeling/models/hf_cache"

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
