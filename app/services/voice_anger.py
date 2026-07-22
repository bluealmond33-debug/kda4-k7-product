"""음성 분노(WavLM) 어댑터 — fusion 부스터 입력 VoiceAngerResult를 만든다.

전형진 WavLM 계층융합 분노 모델(k7modeling.wavlm_layer_fusion_runtime)을 감싸, 원본 WAV에서
'분노 여부'를 산출한다. 이 신호는 격양도(EmotionResult)를 절대 덮어쓰지 않고, fusion에서
주의등급만 올리는 부스터 입력으로만 쓴다(app/services/fusion.py의 _voice_anger_target_level).

무거운 의존성(torch/transformers)·학습 체크포인트(.pt)·HF backbone 캐시가 없으면 조용히
None을 돌려주고, fusion은 아무 동작도 하지 않는다(하위호환). 이는 emotion.py의 graceful
fallback 철학과 동일하다 — '실연결' 아티팩트가 도착하기 전까지 프로덕션 경로는 안전하다.
torch/transformers는 _load_runtime 안에서만 import하므로, 미설치 환경에서도 앱은 죽지 않는다.
"""

import logging
from pathlib import Path
from typing import Any

from app.config import settings
from app.schemas import AnalysisSource, VoiceAngerResult

logger = logging.getLogger(__name__)

_RUNTIME: Any = None
_RUNTIME_LOAD_ATTEMPTED = False
_WARNED_FALLBACK = False


def _is_wav(audio_bytes: bytes) -> bool:
    return len(audio_bytes) >= 12 and audio_bytes[0:4] == b"RIFF" and audio_bytes[8:12] == b"WAVE"


def _warn_fallback(reason: str) -> None:
    global _WARNED_FALLBACK
    if not _WARNED_FALLBACK:
        logger.warning("WavLM 음성분노 모델 미사용, 폴백(voice_anger=None): %s", reason)
        _WARNED_FALLBACK = True


def _load_runtime():
    """WavLM 런타임을 lazy 로드하고 프로세스 생애주기 동안 캐시한다. 실패 시 None(폴백)."""
    global _RUNTIME, _RUNTIME_LOAD_ATTEMPTED
    if _RUNTIME_LOAD_ATTEMPTED:
        return _RUNTIME
    _RUNTIME_LOAD_ATTEMPTED = True

    artifact_path = Path(settings.wavlm_anger_model_path)
    if not artifact_path.exists():
        _warn_fallback(f"학습 체크포인트 없음: {artifact_path}")
        return None

    try:
        # torch/transformers는 여기서만 import — 미설치여도 앱 임포트는 죽지 않는다.
        from app.services.k7modeling.wavlm_layer_fusion_runtime import (
            WavLMLayerFusionRuntime,
        )

        _RUNTIME = WavLMLayerFusionRuntime(
            artifact_path=artifact_path,
            cache_dir=settings.wavlm_anger_cache_dir,
            device=settings.wavlm_anger_device,  # CPU 격리 — whisper(cuDNN)와 충돌 회피
        )
        logger.info("WavLM 음성분노 모델 로드 완료: %s", artifact_path)
    except ImportError as exc:
        _warn_fallback(f"의존성 미설치(torch/transformers): {exc}")
        _RUNTIME = None
    except Exception as exc:  # 체크포인트/HF캐시 손상·형식오류 등
        logger.exception("WavLM 음성분노 모델 로드 실패, 폴백")
        _warn_fallback(f"로드 실패: {exc}")
        _RUNTIME = None
    return _RUNTIME


def _voice_anger_result_from_prediction(prediction: dict[str, Any]) -> VoiceAngerResult:
    """런타임 예측 dict → VoiceAngerResult.

    confidence는 현재 런타임이 calibration된 값을 내지 않으므로 None으로 둔다(부스터 로직은
    confidence를 쓰지 않고 detected만 본다). probability는 비보정 모델 점수다.
    """
    return VoiceAngerResult(
        detected=bool(prediction["anger_detected"]),
        probability=float(prediction["anger_probability"]),
        confidence=None,
        threshold=float(prediction["threshold"]),
        probability_calibrated=bool(prediction["probability_calibrated"]),
        analysis_source=AnalysisSource.REAL_MODEL,
        model_version=prediction.get("model_version"),
    )


def analyze_voice_anger(audio_bytes: bytes) -> VoiceAngerResult | None:
    """원본 WAV에서 음성 분노를 산출한다.

    실제 WAV가 아니거나(텍스트 엔드포인트가 바이트를 넣는 경우 포함) 모델/의존성이 없으면
    None을 돌려준다 — fusion 부스터는 None을 받으면 아무 동작도 하지 않는다(무해).
    """
    if not _is_wav(audio_bytes):
        return None
    runtime = _load_runtime()
    if runtime is None:
        return None
    try:
        prediction = runtime.predict_wav_bytes(audio_bytes)
    except Exception:
        logger.exception("WavLM 음성분노 추론 실패, 폴백")
        return None
    return _voice_anger_result_from_prediction(prediction)
