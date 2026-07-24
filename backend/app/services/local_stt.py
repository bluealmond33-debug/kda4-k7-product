"""온프레미스 STT — faster-whisper로 로컬에서 음성을 텍스트로 변환 (OpenAI 미사용).

app/services/stt.py(클라우드판)와 동일한 시그니처(TranscribeResult 반환)를 맞춰서,
호출부에서는 settings.use_local_models로 둘 중 뭘 쓸지만 고르면 되게 했다.

오디오 디코딩은 faster-whisper 기본 경로(내부적으로 av/PyAV 사용) 대신 ffmpeg 서브프로세스로
직접 한다 — 이 랩탑은 Windows 스마트 앱 제어(Smart App Control)가 켜져 있어 av의 일부
서명 안 된 DLL(av.subtitles.stream 등)이 로드 시점에 차단된다. 스마트 앱 제어는 한 번 끄면
Windows 재설치 전까지 되돌릴 수 없는 보안설정이라 건드리지 않고, model.transcribe()에 파일
경로 대신 이미 디코딩된 numpy 배열을 넘겨 av 경로 자체를 타지 않게 우회한다.
"""

import os
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

import numpy as np

from app.config import Settings
from app.schemas import TranscribeResult

_model = None


def _decode_audio_ffmpeg(path: str, sampling_rate: int = 16000) -> np.ndarray:
    cmd = [
        "ffmpeg", "-nostdin", "-threads", "0", "-i", path,
        "-f", "f32le", "-ac", "1", "-ar", str(sampling_rate), "-",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, check=True)
    except FileNotFoundError as exc:
        raise RuntimeError("ffmpeg 실행 파일을 찾을 수 없습니다 (PATH 확인 필요)") from exc
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.decode(errors="ignore")[:300]
        raise RuntimeError(f"ffmpeg 오디오 디코딩 실패: {detail}") from exc
    return np.frombuffer(proc.stdout, dtype=np.float32)


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
        audio = _decode_audio_ffmpeg(tmp_path)
        segments, info = model.transcribe(audio, language="ko")
        text = "".join(segment.text for segment in segments).strip()
        return TranscribeResult(
            call_id=str(uuid.uuid4()),
            text=text,
            duration_sec=info.duration or 0.0,
        )
    finally:
        Path(tmp_path).unlink(missing_ok=True)
