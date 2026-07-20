"""3단계 감정분석 파트.

박정운(Jeongwoon Park)님이 kda4-k7-project1의 about_v4.1_model 브랜치(PR #6, 미병합)에 올린
실제 감정온도(emotion temperature) 모델 — 원본 오디오의 eGeMAPS 음향 특징(피치·에너지·발화속도 등
88개) + LightGBM으로 low/medium/high 격양 수준을 추론하는 모델 — 을 app/services/k7modeling에
그대로 들여와 연결한다. 모델 카드 기준 "발표 데모/연구용 shadow, 실제 라우팅 자동판단 금지"이므로
judge.py의 임계값 로직은 그대로 두고 기존 계약 형태만 채운다.

이 모듈은 두 개의 다른 계약을 동시에 만족시켜야 한다:
- app/schemas.py의 EmotionResult(anger/anxiety/neutral/uncertainty) — 우리 자체 파이프라인
  (judge.py, legacy_adapter.py, react_adapter.py)이 쓰는 내부 계약.
- app/contracts.py의 MvpEmotionResult(status/score 0~100/level) — 이찬희 파트(kda4-k7-product)의
  mvp-1.0 DB 계약. kda4-k7-product의 database/contracts/emotion_temperature_result.schema.json과
  같은 밴드(stable<=33, 33<caution<=66, elevated>66)를 쓴다.
둘 다 같은 오디오 추론 결과(predict_raw_emotion)에서 파생되므로, 모델은 요청당 한 번만 돈다.

모델 바이너리(.joblib)는 박정운님 쪽에서 GitHub에 의도적으로 올리지 않았다(라이선스·용량 문제,
artifacts/models/README.md 참고). settings.emotion_temperature_model_path에 파일이 없거나
SHA-256이 다르면, 또는 입력이 유효한 WAV가 아니면(analyze-text류 엔드포인트가 텍스트를 오디오
자리에 넣어 호출하는 경우 포함) 아래 전 구현이던 의사난수 스텁/unavailable로 조용히 폴백한다.
"""

import hashlib
import logging
import random
import tempfile
from pathlib import Path
from typing import Any

from app.config import settings
from app.contracts import EmotionStatus, MvpEmotionResult
from app.schemas import EmotionResult

logger = logging.getLogger(__name__)

_ARTIFACT: Any = None
_ARTIFACT_LOAD_ATTEMPTED = False
_WARNED_FALLBACK = False


def _is_wav(audio_bytes: bytes) -> bool:
    return len(audio_bytes) >= 12 and audio_bytes[0:4] == b"RIFF" and audio_bytes[8:12] == b"WAVE"


def _warn_fallback(reason: str) -> None:
    global _WARNED_FALLBACK
    if not _WARNED_FALLBACK:
        logger.warning("emotion_temperature 모델 미사용, 폴백: %s", reason)
        _WARNED_FALLBACK = True


def _load_artifact():
    """joblib 아티팩트를 lazy 로드하고 프로세스 생애주기 동안 캐시한다."""
    global _ARTIFACT, _ARTIFACT_LOAD_ATTEMPTED
    if _ARTIFACT_LOAD_ATTEMPTED:
        return _ARTIFACT
    _ARTIFACT_LOAD_ATTEMPTED = True

    path = Path(settings.emotion_temperature_model_path)
    if not path.exists():
        _warn_fallback(f"모델 파일 없음: {path}")
        return None

    from app.services.k7modeling.io_utils import sha256_file

    actual_hash = sha256_file(path)
    if actual_hash != settings.emotion_temperature_model_sha256:
        _warn_fallback(
            f"SHA-256 불일치 (기대 {settings.emotion_temperature_model_sha256}, 실제 {actual_hash})"
        )
        return None

    import joblib

    _ARTIFACT = joblib.load(path)
    logger.info("emotion_temperature 모델 로드 완료: %s", path)
    return _ARTIFACT


def predict_raw_emotion(audio_bytes: bytes) -> dict[str, Any] | None:
    """실제 오디오일 때만 모델을 태우고, 그 외에는 None(스텁/unavailable 신호)을 돌려준다."""
    if not _is_wav(audio_bytes):
        # analyze-text/react/summarize 엔드포인트는 오디오가 없어 텍스트 바이트를 이 자리에 넣는다.
        return None

    artifact = _load_artifact()
    if artifact is None:
        return None

    tmp_path: Path | None = None
    try:
        import warnings

        from app.services.k7modeling._opensmile_ascii_fix import ensure_ascii_opensmile_config
        from app.services.k7modeling.sliding_window_v4 import predict_demo_audio_v4

        ensure_ascii_opensmile_config()  # venv가 한글 경로일 때 opensmile 우회
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = Path(tmp.name)
        with warnings.catch_warnings():
            # 벤더 코드가 LGBMClassifier에 numpy 배열(피처명 없음)을 넘겨서 나는 무해한 경고.
            warnings.filterwarnings("ignore", message="X does not have valid feature names")
            return predict_demo_audio_v4(Path(settings.emotion_temperature_model_path), tmp_path)
    except Exception:
        logger.exception("emotion_temperature 추론 실패, 폴백")
        return None
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)


def _stub_emotion(seed_bytes: bytes) -> EmotionResult:
    seed = int(hashlib.sha256(seed_bytes).hexdigest(), 16) % (2**32)
    rng = random.Random(seed)

    anger = rng.uniform(0.0, 0.4)
    anxiety = rng.uniform(0.0, 0.4)
    neutral = max(0.0, 1.0 - anger - anxiety)
    uncertainty = rng.uniform(0.05, 0.35)

    return EmotionResult(
        anger_probability=round(anger, 3),
        anxiety_probability=round(anxiety, 3),
        neutral_probability=round(neutral, 3),
        uncertainty=round(uncertainty, 3),
    )


def _emotion_result_from_raw(prediction: dict[str, Any]) -> EmotionResult:
    """모델은 anger/anxiety를 구분하지 않는 단일 격양도 축이므로, 두 확률에 같은 강도값을 준다.

    intensity = p(medium)*0.5 + p(high)*1.0 — 서수 3단계를 0~1 연속값으로 편 기대값.
    neutral_probability는 모델이 이미 갖고 있는 p(low)를 그대로 쓴다.
    """
    probabilities = prediction["probabilities"]
    intensity = round(probabilities["medium"] * 0.5 + probabilities["high"] * 1.0, 3)
    uncertainty = round(1.0 - prediction["confidence"], 3)

    return EmotionResult(
        anger_probability=intensity,
        anxiety_probability=intensity,
        neutral_probability=round(probabilities["low"], 3),
        uncertainty=uncertainty,
    )


def analyze_emotion(audio_bytes: bytes) -> EmotionResult:
    raw = predict_raw_emotion(audio_bytes)
    if raw is None:
        return _stub_emotion(audio_bytes)
    return _emotion_result_from_raw(raw)


# kda4-k7-product의 emotion_temperature_result.schema.json과 같은 밴드.
_MVP_LEVEL_BY_MODEL_LEVEL = {0: "stable", 1: "caution", 2: "elevated"}
_MVP_BAND_MAX = {"stable": 33.0, "caution": 66.0, "elevated": 100.0}


def _mvp_emotion_result_from_raw(prediction: dict[str, Any]) -> MvpEmotionResult:
    probabilities = prediction["probabilities"]
    intensity = probabilities["medium"] * 0.5 + probabilities["high"] * 1.0
    level = _MVP_LEVEL_BY_MODEL_LEVEL[prediction["emotion_temperature_level"]]

    # 모델의 level(hysteresis·threshold 적용된 최종 판정)이 먼저고, score는 그 밴드 안에서만
    # intensity*100을 눌러 담는다 — level과 score가 서로 다른 밴드를 가리키는 걸 방지한다.
    band_max = _MVP_BAND_MAX[level]
    band_min = 0.0 if level == "stable" else _MVP_BAND_MAX["stable"] if level == "caution" else _MVP_BAND_MAX["caution"]
    score = round(min(band_max, max(band_min, intensity * 100)), 1)

    model_ref = f"{prediction.get('model_version', 'emotion_temperature_demo_final_v4')}"
    return MvpEmotionResult(
        status=EmotionStatus.COMPLETED,
        score=score,
        level=level,
        reason=(
            f"{model_ref}; audio_quality={prediction['audio_quality']}; "
            "박정운 emotion_temperature 모델(demo/shadow only, 실제 라우팅 자동판단 금지)"
        ),
    )


def analyze_emotion_mvp(audio_bytes: bytes) -> MvpEmotionResult:
    """app/routers/mvp.py(mvp-1.0 계약)용 — 모델 없으면 unavailable로 고정."""
    raw = predict_raw_emotion(audio_bytes)
    if raw is None:
        return MvpEmotionResult(reason="감정 모델은 아직 MVP 통합 전입니다.")
    return _mvp_emotion_result_from_raw(raw)
