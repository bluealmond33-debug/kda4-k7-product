from __future__ import annotations

import math
import wave
from pathlib import Path
from typing import Any

import numpy as np


def read_pcm_wav(path: Path) -> tuple[np.ndarray, int]:
    """Read an integer PCM WAV as mono float32 in [-1, 1]."""
    with wave.open(str(path), "rb") as audio:
        channels = audio.getnchannels()
        sample_width = audio.getsampwidth()
        sample_rate = audio.getframerate()
        frames = audio.readframes(audio.getnframes())

    if sample_width == 1:
        samples = (np.frombuffer(frames, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    elif sample_width == 2:
        samples = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    elif sample_width == 3:
        raw = np.frombuffer(frames, dtype=np.uint8).reshape(-1, 3)
        values = raw[:, 0].astype(np.int32) | (raw[:, 1].astype(np.int32) << 8) | (raw[:, 2].astype(np.int32) << 16)
        values = np.where(values & 0x800000, values - 0x1000000, values)
        samples = values.astype(np.float32) / 8388608.0
    elif sample_width == 4:
        samples = np.frombuffer(frames, dtype="<i4").astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f"지원하지 않는 PCM sample width: {sample_width}")

    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    return np.ascontiguousarray(samples, dtype=np.float32), sample_rate


def write_pcm16_wav(path: Path, samples: np.ndarray, sample_rate: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    clipped = np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0 - (1.0 / 32768.0))
    pcm = np.round(clipped * 32768.0).astype("<i2")
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(sample_rate)
        audio.writeframes(pcm.tobytes())


def resample_audio(samples: np.ndarray, source_rate: int, target_rate: int) -> tuple[np.ndarray, str]:
    if source_rate == target_rate:
        return np.asarray(samples, dtype=np.float32).copy(), "identity"
    try:
        from scipy.signal import resample_poly

        divisor = math.gcd(source_rate, target_rate)
        output = resample_poly(samples, target_rate // divisor, source_rate // divisor)
        return np.asarray(output, dtype=np.float32), "scipy_resample_poly"
    except ImportError:
        source_length = len(samples)
        target_length = max(1, round(source_length * target_rate / source_rate))
        source_positions = np.arange(source_length, dtype=np.float64)
        target_positions = np.linspace(0, max(0, source_length - 1), target_length, dtype=np.float64)
        output = np.interp(target_positions, source_positions, samples)
        return np.asarray(output, dtype=np.float32), "numpy_linear_fallback"


def mulaw_roundtrip(samples: np.ndarray, mu: int = 255) -> np.ndarray:
    """Deterministic G.711 mu-law-like 8-bit companding round trip.

    This is an experiment transform, not a bit-exact telecom codec implementation.
    """
    clipped = np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0)
    compressed = np.sign(clipped) * np.log1p(mu * np.abs(clipped)) / np.log1p(mu)
    quantized = np.round((compressed + 1.0) * 0.5 * mu).astype(np.uint8)
    restored = (quantized.astype(np.float32) / mu) * 2.0 - 1.0
    expanded = np.sign(restored) * (np.expm1(np.abs(restored) * np.log1p(mu)) / mu)
    return np.asarray(expanded, dtype=np.float32)


def telephony_8k_mulaw_up16k(samples_16k: np.ndarray) -> tuple[np.ndarray, str]:
    downsampled, method_down = resample_audio(samples_16k, 16000, 8000)
    decoded = mulaw_roundtrip(downsampled)
    upsampled, method_up = resample_audio(decoded, 8000, 16000)
    return upsampled, f"{method_down}+mulaw8bit+{method_up}"


def audio_quality(samples: np.ndarray, sample_rate: int) -> dict[str, Any]:
    values = np.asarray(samples, dtype=np.float32)
    if values.size == 0:
        return {
            "status": "FAILED",
            "flags": ["EMPTY_AUDIO"],
            "duration_sec": 0.0,
            "sample_rate": sample_rate,
            "rms": 0.0,
            "peak": 0.0,
            "clipping_ratio": 0.0,
            "silence_ratio": 1.0,
            "zero_crossing_rate": 0.0,
            "dc_offset": 0.0,
        }

    duration = values.size / sample_rate
    absolute = np.abs(values)
    rms = float(np.sqrt(np.mean(np.square(values, dtype=np.float64))))
    peak = float(np.max(absolute))
    clipping_ratio = float(np.mean(absolute >= 0.999))
    silence_ratio = float(np.mean(absolute < 0.01))
    zero_crossing_rate = float(np.mean(np.signbit(values[:-1]) != np.signbit(values[1:]))) if values.size > 1 else 0.0
    dc_offset = float(np.mean(values))

    flags: list[str] = []
    if duration < 1.0:
        flags.append("TOO_SHORT")
    if clipping_ratio > 0.001:
        flags.append("CLIPPED")
    if rms < 0.01:
        flags.append("LOW_LEVEL")
    if silence_ratio > 0.80:
        flags.append("MOSTLY_SILENT")
    if abs(dc_offset) > 0.05:
        flags.append("DC_OFFSET")

    return {
        "status": "REVIEW" if flags else "OK",
        "flags": flags,
        "duration_sec": round(duration, 6),
        "sample_rate": sample_rate,
        "rms": round(rms, 8),
        "peak": round(peak, 8),
        "clipping_ratio": round(clipping_ratio, 8),
        "silence_ratio": round(silence_ratio, 8),
        "zero_crossing_rate": round(zero_crossing_rate, 8),
        "dc_offset": round(dc_offset, 8),
    }

