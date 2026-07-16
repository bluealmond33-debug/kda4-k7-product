"""온프레미스 STT — faster-whisper로 로컬에서 음성을 텍스트로 변환 (OpenAI 미사용).

app/services/stt.py(클라우드판)와 동일한 시그니처(TranscribeResult 반환)를 맞춰서,
호출부에서는 settings.use_local_models로 둘 중 뭘 쓸지만 고르면 되게 했다.
"""

import os
import sys
import tempfile
import uuid
from pathlib import Path

from app.config import Settings
from app.schemas import TranscribeResult

_model = None


def _register_cuda_dll_dirs() -> None:
    """Windows에서 pip로 깐 nvidia-cublas-cu12/nvidia-cudnn-cu12의 DLL을
    ctranslate2(faster-whisper)가 찾을 수 있게 등록한다. GPU 모드에서만 필요.

    ctranslate2는 LoadLibrary 검색 시 PATH 환경변수를 보므로(os.add_dll_directory는
    적용 안 됨, 실측 확인함), PATH 앞에 직접 붙인다."""
    if sys.platform != "win32":
        return
    site_packages = Path(__file__).resolve().parents[2] / ".venv" / "Lib" / "site-packages"
    bin_dirs = [
        str(site_packages / "nvidia" / pkg / "bin")
        for pkg in ("cublas", "cudnn")
        if (site_packages / "nvidia" / pkg / "bin").is_dir()
    ]
    if bin_dirs:
        os.environ["PATH"] = os.pathsep.join(bin_dirs) + os.pathsep + os.environ.get("PATH", "")


def _get_model(settings: Settings):
    global _model
    if _model is None:
        if settings.local_whisper_device == "cuda":
            _register_cuda_dll_dirs()
        from faster_whisper import WhisperModel

        _model = WhisperModel(
            settings.local_whisper_model,
            device=settings.local_whisper_device,
            compute_type=settings.local_whisper_compute_type,
        )
    return _model


def transcribe_audio_local(settings: Settings, filename: str, file_bytes: bytes) -> TranscribeResult:
    model = _get_model(settings)
    suffix = Path(filename).suffix or ".wav"

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        segments, info = model.transcribe(tmp_path, language="ko")
        text = "".join(segment.text for segment in segments).strip()
        return TranscribeResult(
            call_id=str(uuid.uuid4()),
            text=text,
            duration_sec=info.duration or 0.0,
        )
    finally:
        Path(tmp_path).unlink(missing_ok=True)
