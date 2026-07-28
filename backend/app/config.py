from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings shared by Railway and local development.

    실행 엔진 이식(ADR-0012)으로 온프레미스 필드가 합쳐졌다. 접근 스타일도 두
    가지가 공존한다 — 실행 엔진 코드는 모듈 레벨 `settings`를, product 코드는
    `get_settings()`를 쓴다. 파일 맨 아래에서 둘 다 노출한다.
    """

    database_url: str = ""
    openai_api_key: str = ""
    openai_chat_model: str = "gpt-4o-mini"
    openai_stt_model: str = "whisper-1"
    frontend_origin: str = "http://localhost:5173"
    extra_cors_origins: str = "https://k7product.vercel.app"
    chroma_persist_dir: str = "./data/chroma"

    # 온프레미스 데모용 — true면 OpenAI 대신 로컬 STT(faster-whisper)/로컬 LLM(Ollama)을 쓴다.
    use_local_models: bool = False

    # 데모 스텁 스위치 — true면 로컬모델/OpenAI 대신 canned 응답(UI 흐름 데모용).
    # GPU·Ollama가 없는 팀원 환경에서 켠다. 실배포에선 false 유지(키 누락을 가리지 않도록).
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
    # WavLM은 CPU로 돈다(기본). torch(cuDNN 9.1)와 faster-whisper의 CTranslate2(cuDNN 9.24)가
    # 같은 프로세스에서 GPU cuDNN을 동시에 로드하면 'cudnnGetLibConfig' 심볼 충돌로 크래시하므로,
    # STT는 GPU 유지하고 WavLM(짧은 발화)은 CPU로 격리한다. 충돌 해소 시 "cuda"로 바꿔도 됨.
    wavlm_anger_device: str = "cpu"
    # 실시간 VAD 에너지 임계값(RMS). 낮출수록 작은 소리도 발화로 잡는다(노이즈도 잡힐 수 있음).
    vad_rms_threshold: float = 120.0

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origins(self) -> list[str]:
        """허용 오리진. 로컬 개발(vite dev 5173 / preview 4173)과 LAN 시연을 함께 덮는다.

        배포된 프론트(Vercel) 도메인은 EXTRA_CORS_ORIGINS(콤마 구분)로 추가한다.
        """
        origins = [
            self.frontend_origin,
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://192.168.0.2:5173",
            "http://192.168.11.135:5173",
            # vite preview(프로덕션 빌드) — dev StrictMode/HMR 회피용 안정 서버
            "http://localhost:4173",
            "http://127.0.0.1:4173",
            "http://192.168.0.2:4173",
            "http://192.168.11.135:4173",
            "http://localhost:5500",
            "http://127.0.0.1:5500",
            "http://localhost:8788",
        ]
        origins.extend(
            origin.strip()
            for origin in self.extra_cors_origins.split(",")
            if origin.strip()
        )
        return list(dict.fromkeys(origins))

    @property
    def cors_allow_origins(self) -> list[str]:
        """실행 엔진 main.py가 쓰던 이름. cors_origins와 같은 값."""
        return self.cors_origins


@lru_cache
def get_settings() -> Settings:
    return Settings()


# 실행 엔진 8개 파일이 `from app.config import settings`로 쓴다.
# product 3개 파일은 get_settings()를 쓴다. 두 스타일을 모두 지원한다.
settings = get_settings()
