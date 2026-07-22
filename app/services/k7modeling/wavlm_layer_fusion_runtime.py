"""Raw-WAV inference runtime for the selected frozen WavLM layer-fusion anger model."""

from __future__ import annotations

import io
import math
import wave
from pathlib import Path
from typing import Any, BinaryIO, Sequence

import numpy as np
import torch
from scipy.signal import resample_poly
from torch import nn
from transformers import AutoFeatureExtractor, AutoModel

# 추론 전용 이식본 — head 정의/backbone id를 학습 trainer 없이 이 모듈에서 가져온다.
from .io_utils import sha256_file
from .wavlm_layer_fusion_head import LAYERS, MODEL_ID, WeightedLayerMLP


MODEL_VERSION = "wavlm-base-plus-layer-stats-fusion-v1"
SAMPLE_RATE = 16_000


def _decode_pcm_wav(source: str | Path | bytes | BinaryIO) -> np.ndarray:
    """Decode uncompressed 16-bit PCM WAV and deterministically resample to 16 kHz."""
    opened: BinaryIO | str
    opened = io.BytesIO(source) if isinstance(source, bytes) else source
    with wave.open(opened, "rb") as handle:
        channels = handle.getnchannels()
        sample_width = handle.getsampwidth()
        sample_rate = handle.getframerate()
        frame_count = handle.getnframes()
        compression = handle.getcomptype()
        raw = handle.readframes(frame_count)

    if compression != "NONE":
        raise ValueError(f"compressed WAV is unsupported: {compression}")
    if channels < 1:
        raise ValueError(f"invalid channel count: {channels}")
    if sample_width != 2:
        raise ValueError(f"only 16-bit PCM WAV is supported, got {sample_width * 8}-bit")
    if sample_rate <= 0:
        raise ValueError(f"invalid sample rate: {sample_rate}")

    signal = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if signal.size % channels:
        raise ValueError("PCM sample count is not divisible by channel count")
    if channels > 1:
        signal = signal.reshape(-1, channels).mean(axis=1, dtype=np.float32)
    if sample_rate != SAMPLE_RATE:
        divisor = math.gcd(sample_rate, SAMPLE_RATE)
        signal = resample_poly(
            signal, SAMPLE_RATE // divisor, sample_rate // divisor
        ).astype(np.float32, copy=False)
    if signal.size == 0:
        raise ValueError("empty WAV is unsupported")
    return np.ascontiguousarray(signal, dtype=np.float32)


class WavLMLayerFusionRuntime:
    """Load backbone/head once and predict binary anger evidence from WAV audio.

    `anger_probability` is an uncalibrated model score. It must not be interpreted as
    a literal population probability or used for S/G/E routing or counselor assignment.
    """

    def __init__(
        self,
        artifact_path: str | Path,
        cache_dir: str | Path,
        *,
        device: str | torch.device | None = None,
        local_files_only: bool = True,
        max_duration_seconds: float = 60.0,
    ) -> None:
        self.artifact_path = Path(artifact_path)
        self.cache_dir = Path(cache_dir)
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        self.max_duration_seconds = float(max_duration_seconds)
        if self.max_duration_seconds <= 0:
            raise ValueError("max_duration_seconds must be positive")

        artifact = torch.load(self.artifact_path, map_location="cpu", weights_only=False)
        expected_spec = {"name": "weighted_4_layers_stats", "kind": "weighted_layers_stats"}
        if artifact.get("spec") != expected_spec:
            raise ValueError(f"unsupported layer-fusion artifact spec: {artifact.get('spec')}")
        if tuple(artifact.get("layers", ())) != LAYERS:
            raise ValueError(f"expected WavLM layers {LAYERS}, got {artifact.get('layers')}")
        self.threshold = float(artifact["threshold"])
        self.artifact_sha256 = sha256_file(self.artifact_path)

        mean = np.asarray(artifact["mean"], dtype=np.float32)
        std = np.asarray(artifact["std"], dtype=np.float32)
        if mean.shape != (len(LAYERS), 1536) or std.shape != mean.shape:
            raise ValueError(f"invalid normalization shape: mean={mean.shape}, std={std.shape}")
        self.head: nn.Module = WeightedLayerMLP(mean, std)
        self.head.load_state_dict(artifact["state_dict"])
        self.head.to(self.device).eval()

        self.extractor = AutoFeatureExtractor.from_pretrained(
            MODEL_ID, cache_dir=self.cache_dir, local_files_only=local_files_only
        )
        backbone_dtype = torch.float16 if self.device.type == "cuda" else torch.float32
        self.backbone = AutoModel.from_pretrained(
            MODEL_ID,
            cache_dir=self.cache_dir,
            local_files_only=local_files_only,
            dtype=backbone_dtype,
        ).to(self.device).eval()
        for parameter in self.backbone.parameters():
            parameter.requires_grad = False

    def extract_features(self, signals: Sequence[np.ndarray]) -> np.ndarray:
        if not signals:
            raise ValueError("at least one signal is required")
        maximum_samples = round(self.max_duration_seconds * SAMPLE_RATE)
        for signal in signals:
            if len(signal) > maximum_samples:
                raise ValueError(
                    f"audio exceeds validated {self.max_duration_seconds:.1f}s limit: "
                    f"{len(signal) / SAMPLE_RATE:.3f}s"
                )
        inputs = self.extractor(
            list(signals), sampling_rate=SAMPLE_RATE, padding=True, return_tensors="pt"
        )
        input_values = inputs.input_values.to(self.device)
        attention_mask = inputs.get(
            "attention_mask", torch.ones_like(inputs.input_values, dtype=torch.long)
        ).to(self.device)
        with torch.inference_mode(), torch.autocast(
            device_type=self.device.type,
            dtype=torch.float16,
            enabled=self.device.type == "cuda",
        ):
            output = self.backbone(
                input_values=input_values,
                attention_mask=attention_mask,
                output_hidden_states=True,
            )
            layer_values = []
            for layer_number in LAYERS:
                hidden = output.hidden_states[layer_number]
                mask = self.backbone._get_feature_vector_attention_mask(
                    hidden.shape[1], attention_mask
                ).unsqueeze(-1)
                denominator = mask.sum(dim=1).clamp_min(1)
                mean = (hidden * mask).sum(dim=1) / denominator
                variance = ((hidden - mean.unsqueeze(1)).square() * mask).sum(dim=1) / denominator
                standard_deviation = variance.clamp_min(1e-6).sqrt()
                layer_values.append(torch.cat([mean, standard_deviation], dim=-1))
            features = torch.stack(layer_values, dim=1).float()
        values = features.cpu().numpy()
        if values.shape != (len(signals), len(LAYERS), 1536) or not np.isfinite(values).all():
            raise ValueError(f"invalid layer-fusion features: {values.shape}")
        return values

    def predict_signals(self, signals: Sequence[np.ndarray]) -> list[dict[str, Any]]:
        features = self.extract_features(signals)
        feature_tensor = torch.from_numpy(features).to(self.device)
        with torch.inference_mode():
            probabilities = torch.sigmoid(self.head(feature_tensor)).cpu().numpy()
        return [self._format_prediction(float(probability), len(signal)) for probability, signal in zip(probabilities, signals)]

    def predict_paths(self, paths: Sequence[str | Path]) -> list[dict[str, Any]]:
        return self.predict_signals([_decode_pcm_wav(path) for path in paths])

    def predict_path(self, path: str | Path) -> dict[str, Any]:
        return self.predict_paths([path])[0]

    def predict_wav_bytes(self, audio_bytes: bytes) -> dict[str, Any]:
        return self.predict_signals([_decode_pcm_wav(audio_bytes)])[0]

    def _format_prediction(self, probability: float, sample_count: int) -> dict[str, Any]:
        detected = probability >= self.threshold
        return {
            "status": "completed",
            "model_version": MODEL_VERSION,
            "model_id": MODEL_ID,
            "anger_probability": probability,
            "anger_score": probability * 100.0,
            "anger_detected": detected,
            "anger_level": "elevated" if detected else "stable",
            "threshold": self.threshold,
            "probability_calibrated": False,
            "audio_duration_seconds": sample_count / SAMPLE_RATE,
            "usage_restriction": "support signal only; excluded from S/G/E routing and counselor assignment",
        }
