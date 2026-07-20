from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import random
import time
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

import numpy as np

from .evaluation import (
    bootstrap_regression_metrics,
    fit_affine_calibrator,
    regression_metrics,
    robustness_metrics,
)
from .io_utils import read_csv, sha256_file, utc_now_iso, write_csv, write_json
from .weak_supervision import EMOTION_COLUMNS, INTENSITY_COLUMNS, intensity_vector, read_cp949_csv


MODEL_ID = "emotion2vec/emotion2vec_plus_base"
MODEL_HUB = "hf"
EMBEDDING_DIMENSION = 768
NATIVE_SCORE_DIMENSION = 9
MODEL_FEATURE_DIMENSION = EMBEDDING_DIMENSION + NATIVE_SCORE_DIMENSION
EMOTION_CLASSES = (
    "ANGRY",
    "DISGUST",
    "FEAR",
    "HAPPINESS",
    "NEUTRAL",
    "SADNESS",
    "SURPRISE",
)
INTENSITY_VALUES = np.asarray([0.0, 1.0, 2.0], dtype=np.float32)


def _normalise_emotion(value: str) -> str:
    aliases = {
        "ANGER": "ANGRY",
        "ANGRY": "ANGRY",
        "DISGUST": "DISGUST",
        "DISGUSTED": "DISGUST",
        "FEAR": "FEAR",
        "FEARFUL": "FEAR",
        "HAPPY": "HAPPINESS",
        "HAPPINESS": "HAPPINESS",
        "NEUTRAL": "NEUTRAL",
        "SAD": "SADNESS",
        "SADNESS": "SADNESS",
        "SURPRISE": "SURPRISE",
        "SURPRISED": "SURPRISE",
    }
    return aliases.get(value.strip().upper(), value.strip().upper())


def _distribution(values: Iterable[int], classes: int) -> np.ndarray:
    counts = np.bincount(np.asarray(list(values), dtype=np.int64), minlength=classes)
    return counts.astype(np.float32) / float(counts.sum())


def _stable_fold(group: str, folds: int, seed: int) -> int:
    digest = hashlib.sha256(f"{seed}:{group}".encode("utf-8")).hexdigest()
    return int(digest[:16], 16) % folds


def _manifest_labels(metadata: dict[str, str]) -> dict[str, float]:
    intensities = intensity_vector(metadata)
    intensity_distribution = _distribution(intensities.astype(int), 3)
    emotions = [_normalise_emotion(metadata[column]) for column in EMOTION_COLUMNS]
    emotion_counts = Counter(emotions)
    result: dict[str, float] = {
        "mean_intensity": float(intensities.mean()),
        "intensity_std": float(intensities.std()),
        "intensity_p0": float(intensity_distribution[0]),
        "intensity_p1": float(intensity_distribution[1]),
        "intensity_p2": float(intensity_distribution[2]),
    }
    for emotion in EMOTION_CLASSES:
        result[f"emotion_p_{emotion.lower()}"] = emotion_counts.get(emotion, 0) / 5.0
    return result


def build_emotion2vec_v2_manifests(
    metadata_csv: Path,
    full_manifest_path: Path,
    admin_manifest_path: Path,
    silver_manifest_path: Path,
    dataset_root: Path,
    modeling_root: Path,
    auxiliary_manifest_path: Path,
    variant_manifest_path: Path,
    report_path: Path,
    folds: int = 5,
    seed: int = 20260716,
) -> dict[str, Any]:
    if folds < 2:
        raise ValueError("folds는 2 이상이어야 합니다.")
    metadata_rows = read_cp949_csv(metadata_csv)
    full_rows = read_csv(full_manifest_path)
    full_by_id = {
        row["wav_id"]: row
        for row in full_rows
        if row.get("audio_status") == "OK" and row.get("metadata_status") == "OK"
    }
    admin_rows = read_csv(admin_manifest_path)
    admin_by_clip = {row["clip_id"]: row for row in admin_rows}
    package_source_ids = {row["source_wav_id"] for row in admin_rows}

    prepared: list[dict[str, Any]] = []
    previous_demographic: tuple[str, str] | None = None
    proxy_run = -1
    for metadata in metadata_rows:
        wav_id = metadata["wav_id"]
        if wav_id not in full_by_id:
            continue
        demographic = (metadata.get("나이", "").strip(), metadata.get("성별", "").strip())
        if demographic != previous_demographic:
            proxy_run += 1
            previous_demographic = demographic
        full = full_by_id[wav_id]
        relative_path = Path(full["relative_path"])
        audio_path = relative_path if relative_path.is_absolute() else dataset_root / relative_path
        prepared.append(
            {
                "embedding_key": wav_id,
                "wav_id": wav_id,
                "clip_id": "",
                "variant": "SOURCE_AUTO_RESAMPLED_16K",
                "audio_path": str(audio_path.resolve()),
                "age": demographic[0],
                "sex": demographic[1],
                "proxy_group": f"DEMO_RUN_{proxy_run:05d}",
                "proxy_group_method": "CONTIGUOUS_AGE_SEX_RUN",
                **_manifest_labels(metadata),
            }
        )

    package_proxy_groups = {
        row["proxy_group"] for row in prepared if row["wav_id"] in package_source_ids
    }
    train_rows: list[dict[str, Any]] = []
    for row in prepared:
        if row["wav_id"] in package_source_ids:
            row["split"] = "PACKAGE_EVAL"
            row["cv_fold"] = ""
        elif row["proxy_group"] in package_proxy_groups:
            row["split"] = "PACKAGE_PROXY_EXCLUDED"
            row["cv_fold"] = ""
        else:
            row["split"] = "AUX_TRAIN"
            row["cv_fold"] = _stable_fold(str(row["proxy_group"]), folds, seed)
            train_rows.append(row)

    if len(train_rows) < 1000:
        raise ValueError("proxy leakage 제외 후 auxiliary 학습 행이 비정상적으로 적습니다.")

    auxiliary_fields = [
        "embedding_key",
        "wav_id",
        "clip_id",
        "variant",
        "audio_path",
        "split",
        "cv_fold",
        "proxy_group",
        "proxy_group_method",
        "age",
        "sex",
        "mean_intensity",
        "intensity_std",
        "intensity_p0",
        "intensity_p1",
        "intensity_p2",
        *[f"emotion_p_{emotion.lower()}" for emotion in EMOTION_CLASSES],
    ]
    write_csv(auxiliary_manifest_path, prepared, auxiliary_fields)

    metadata_by_id = {row["wav_id"]: row for row in metadata_rows}
    variant_rows: list[dict[str, Any]] = []
    for row in read_csv(silver_manifest_path):
        if row.get("status") != "OK":
            continue
        clip_id = row["wav_id"]
        if clip_id not in admin_by_clip:
            raise ValueError(f"admin manifest에 없는 package clip: {clip_id}")
        source_wav_id = admin_by_clip[clip_id]["source_wav_id"]
        metadata = metadata_by_id[source_wav_id]
        candidate = Path(row["processed_path"])
        audio_path = candidate if candidate.is_absolute() else modeling_root / candidate
        source_prepared = next(item for item in prepared if item["wav_id"] == source_wav_id)
        variant_rows.append(
            {
                "embedding_key": f"{clip_id}|{row['variant']}",
                "wav_id": source_wav_id,
                "clip_id": clip_id,
                "variant": row["variant"],
                "audio_path": str(audio_path.resolve()),
                "split": "PACKAGE_VARIANT_EVAL",
                "cv_fold": "",
                "proxy_group": source_prepared["proxy_group"],
                "proxy_group_method": source_prepared["proxy_group_method"],
                "age": metadata.get("나이", ""),
                "sex": metadata.get("성별", ""),
                **_manifest_labels(metadata),
            }
        )
    write_csv(variant_manifest_path, variant_rows, auxiliary_fields)

    split_counts = Counter(str(row["split"]) for row in prepared)
    fold_counts = Counter(str(row["cv_fold"]) for row in train_rows)
    report = {
        "status": "EMOTION2VEC_V2_MANIFESTS_READY",
        "created_at": utc_now_iso(),
        "folds": folds,
        "seed": seed,
        "auxiliary_rows": len(prepared),
        "variant_rows": len(variant_rows),
        "split_counts": dict(split_counts),
        "fold_counts": dict(sorted(fold_counts.items())),
        "package_source_rows": len(package_source_ids),
        "package_proxy_groups": len(package_proxy_groups),
        "proxy_group_method": "CONTIGUOUS_AGE_SEX_RUN",
        "proxy_group_warning": (
            "Heuristic leakage mitigation only; this is not a verified speaker identity."
        ),
        "inputs": {
            "metadata_csv": sha256_file(metadata_csv),
            "full_manifest": sha256_file(full_manifest_path),
            "admin_manifest": sha256_file(admin_manifest_path),
            "silver_manifest": sha256_file(silver_manifest_path),
        },
        "outputs": {
            "auxiliary_manifest": str(auxiliary_manifest_path.resolve()),
            "variant_manifest": str(variant_manifest_path.resolve()),
        },
    }
    write_json(report_path, report)
    return report


def extract_emotion2vec_embeddings(
    manifest_path: Path,
    embeddings_path: Path,
    index_path: Path,
    progress_path: Path,
    report_path: Path,
    cache_dir: Path,
    device: str = "cuda",
    batch_size: int = 16,
    limit: int | None = None,
) -> dict[str, Any]:
    if batch_size < 1:
        raise ValueError("batch_size는 1 이상이어야 합니다.")
    rows = read_csv(manifest_path)
    if limit is not None:
        rows = rows[:limit]
    if not rows:
        raise ValueError("embedding 추출 대상이 없습니다.")
    keys = [row["embedding_key"] for row in rows]
    if len(keys) != len(set(keys)):
        raise ValueError("embedding_key는 고유해야 합니다.")
    missing_paths = [row["audio_path"] for row in rows if not Path(row["audio_path"]).exists()]
    if missing_paths:
        raise ValueError(f"오디오 파일이 없는 행 {len(missing_paths)}개: {missing_paths[:3]}")

    cache_dir.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HOME"] = str(cache_dir.resolve())
    manifest_hash = sha256_file(manifest_path)
    next_row = 0
    errors: list[dict[str, str]] = []
    if progress_path.exists() and embeddings_path.exists():
        progress = json.loads(progress_path.read_text(encoding="utf-8"))
        if progress.get("manifest_sha256") != manifest_hash:
            raise ValueError("기존 progress와 입력 manifest hash가 다릅니다.")
        if progress.get("row_count") != len(rows):
            raise ValueError("기존 progress와 입력 행 수가 다릅니다.")
        next_row = int(progress.get("next_row", 0))
        errors = list(progress.get("errors", []))
        embeddings = np.lib.format.open_memmap(embeddings_path, mode="r+")
        if embeddings.shape != (len(rows), MODEL_FEATURE_DIMENSION):
            raise ValueError("기존 embedding 배열 shape가 다릅니다.")
    else:
        embeddings_path.parent.mkdir(parents=True, exist_ok=True)
        embeddings = np.lib.format.open_memmap(
            embeddings_path,
            mode="w+",
            dtype=np.float32,
            shape=(len(rows), MODEL_FEATURE_DIMENSION),
        )
        embeddings[:] = np.nan
        embeddings.flush()
        write_json(
            progress_path,
            {
                "status": "RUNNING",
                "manifest_sha256": manifest_hash,
                "row_count": len(rows),
                "next_row": 0,
                "errors": [],
            },
        )

    import torch
    from funasr import AutoModel

    resolved_device = device
    if device == "auto":
        resolved_device = "cuda" if torch.cuda.is_available() else "cpu"
    if resolved_device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA가 요청됐지만 사용할 수 없습니다.")
    model = AutoModel(
        model=MODEL_ID,
        hub=MODEL_HUB,
        device=resolved_device,
        disable_update=True,
        disable_pbar=True,
        disable_log=True,
    )
    started = time.time()
    processed_this_run = 0
    for start in range(next_row, len(rows), batch_size):
        batch = rows[start : start + batch_size]
        paths = [row["audio_path"] for row in batch]
        try:
            results = model.generate(
                input=paths,
                granularity="utterance",
                extract_embedding=True,
                batch_size=len(batch),
                disable_pbar=True,
                disable_log=True,
            )
            if len(results) != len(batch):
                raise RuntimeError(f"출력 행 수 불일치: {len(results)} != {len(batch)}")
            for offset, result in enumerate(results):
                embedding = np.asarray(result["feats"], dtype=np.float32).reshape(-1)
                native_scores = np.asarray(result["scores"], dtype=np.float32).reshape(-1)
                feature = np.concatenate([embedding, native_scores])
                if feature.shape != (MODEL_FEATURE_DIMENSION,) or not np.isfinite(feature).all():
                    raise ValueError(f"유효하지 않은 embedding shape: {feature.shape}")
                embeddings[start + offset] = feature
        except Exception as batch_error:
            for offset, row in enumerate(batch):
                try:
                    result = model.generate(
                        input=row["audio_path"],
                        granularity="utterance",
                        extract_embedding=True,
                        batch_size=1,
                        disable_pbar=True,
                        disable_log=True,
                    )[0]
                    embedding = np.asarray(result["feats"], dtype=np.float32).reshape(-1)
                    native_scores = np.asarray(result["scores"], dtype=np.float32).reshape(-1)
                    feature = np.concatenate([embedding, native_scores])
                    if feature.shape != (MODEL_FEATURE_DIMENSION,) or not np.isfinite(feature).all():
                        raise ValueError(f"유효하지 않은 embedding shape: {feature.shape}")
                    embeddings[start + offset] = feature
                except Exception as row_error:
                    errors.append(
                        {
                            "embedding_key": row["embedding_key"],
                            "batch_error": repr(batch_error),
                            "row_error": repr(row_error),
                        }
                    )
        embeddings.flush()
        processed_this_run += len(batch)
        write_json(
            progress_path,
            {
                "status": "RUNNING" if start + len(batch) < len(rows) else "COMPLETE",
                "manifest_sha256": manifest_hash,
                "row_count": len(rows),
                "next_row": start + len(batch),
                "errors": errors,
                "updated_at": utc_now_iso(),
            },
        )

    index_rows = []
    for index, row in enumerate(rows):
        valid = bool(np.isfinite(embeddings[index]).all())
        index_rows.append(
            {
                "embedding_key": row["embedding_key"],
                "wav_id": row["wav_id"],
                "clip_id": row.get("clip_id", ""),
                "variant": row.get("variant", ""),
                "feature_row": index,
                "status": "OK" if valid else "ERROR",
            }
        )
    write_csv(
        index_path,
        index_rows,
        ["embedding_key", "wav_id", "clip_id", "variant", "feature_row", "status"],
    )
    elapsed = time.time() - started
    report = {
        "status": "EMOTION2VEC_EMBEDDINGS_COMPLETE",
        "created_at": utc_now_iso(),
        "model_id": MODEL_ID,
        "hub": MODEL_HUB,
        "device": resolved_device,
        "gpu_name": torch.cuda.get_device_name(0) if resolved_device == "cuda" else None,
        "rows": len(rows),
        "valid_rows": int(np.isfinite(embeddings).all(axis=1).sum()),
        "error_rows": len(errors),
        "embedding_dimension": EMBEDDING_DIMENSION,
        "native_score_dimension": NATIVE_SCORE_DIMENSION,
        "model_feature_dimension": MODEL_FEATURE_DIMENSION,
        "processed_this_run": processed_this_run,
        "elapsed_seconds_this_run": elapsed,
        "rows_per_second_this_run": processed_this_run / elapsed if elapsed else None,
        "inputs": {
            "manifest": str(manifest_path.resolve()),
            "manifest_sha256": manifest_hash,
        },
        "outputs": {
            "embeddings": str(embeddings_path.resolve()),
            "embeddings_sha256": sha256_file(embeddings_path),
            "index": str(index_path.resolve()),
            "index_sha256": sha256_file(index_path),
        },
        "errors": errors,
    }
    write_json(report_path, report)
    return report


def _load_aligned_features(
    manifest_path: Path,
    embeddings_path: Path,
    index_path: Path,
) -> tuple[list[dict[str, str]], np.ndarray]:
    rows = read_csv(manifest_path)
    index_rows = read_csv(index_path)
    index_by_key = {row["embedding_key"]: row for row in index_rows if row["status"] == "OK"}
    embeddings = np.load(embeddings_path, mmap_mode="r")
    aligned = np.empty((len(rows), embeddings.shape[1]), dtype=np.float32)
    for position, row in enumerate(rows):
        if row["embedding_key"] not in index_by_key:
            raise ValueError(f"embedding index에 없는 key: {row['embedding_key']}")
        feature_row = int(index_by_key[row["embedding_key"]]["feature_row"])
        aligned[position] = embeddings[feature_row]
    if not np.isfinite(aligned).all():
        raise ValueError("정렬된 embedding에 비유한 값이 있습니다.")
    return rows, aligned


def _targets(rows: list[dict[str, str]]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    intensity = np.asarray(
        [[float(row[f"intensity_p{value}"]) for value in range(3)] for row in rows],
        dtype=np.float32,
    )
    emotion = np.asarray(
        [
            [float(row[f"emotion_p_{emotion_name.lower()}"]) for emotion_name in EMOTION_CLASSES]
            for row in rows
        ],
        dtype=np.float32,
    )
    disagreement = np.asarray([float(row["intensity_std"]) for row in rows], dtype=np.float32)
    return intensity, emotion, disagreement


def _resolve_device(device: str) -> str:
    import torch

    resolved = "cuda" if device == "auto" and torch.cuda.is_available() else device
    if resolved == "auto":
        resolved = "cpu"
    if resolved == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA가 요청됐지만 사용할 수 없습니다.")
    return resolved


def _train_head(
    train_x: np.ndarray,
    train_intensity: np.ndarray,
    train_emotion: np.ndarray,
    train_disagreement: np.ndarray,
    validation_x: np.ndarray,
    validation_intensity: np.ndarray,
    device: str,
    epochs: int,
    batch_size: int,
    learning_rate: float,
    weight_decay: float,
    seed: int,
) -> tuple[dict[str, Any], dict[str, np.ndarray], list[dict[str, float | int]]]:
    import torch
    import torch.nn as nn
    from torch.utils.data import DataLoader, TensorDataset, WeightedRandomSampler

    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if device == "cuda":
        torch.cuda.manual_seed_all(seed)

    mean = train_x.mean(axis=0, dtype=np.float64).astype(np.float32)
    std = train_x.std(axis=0, dtype=np.float64).astype(np.float32)
    std[std < 1e-5] = 1.0
    train_scaled = (train_x - mean) / std
    validation_scaled = (validation_x - mean) / std

    class MultiTaskHead(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.shared = nn.Sequential(
                nn.Linear(MODEL_FEATURE_DIMENSION, 256),
                nn.LayerNorm(256),
                nn.GELU(),
                nn.Dropout(0.2),
                nn.Linear(256, 128),
                nn.GELU(),
                nn.Dropout(0.1),
            )
            self.intensity = nn.Linear(128, 3)
            self.mean_intensity = nn.Linear(128, 1)
            self.emotion = nn.Linear(128, len(EMOTION_CLASSES))
            self.disagreement = nn.Linear(128, 1)

        def forward(self, values: Any) -> tuple[Any, Any, Any, Any]:
            hidden = self.shared(values)
            return (
                self.intensity(hidden),
                2.0 * torch.sigmoid(self.mean_intensity(hidden).squeeze(-1)),
                self.emotion(hidden),
                self.disagreement(hidden).squeeze(-1),
            )

    model = MultiTaskHead().to(device)
    train_dataset = TensorDataset(
        torch.from_numpy(train_scaled),
        torch.from_numpy(train_intensity),
        torch.from_numpy(train_emotion),
        torch.from_numpy(train_disagreement),
    )
    generator = torch.Generator()
    generator.manual_seed(seed)
    train_mean_target = train_intensity @ INTENSITY_VALUES
    intensity_bins = np.rint(train_mean_target * 5.0).astype(int)
    bin_counts = np.bincount(intensity_bins, minlength=11)
    sampling_weights = np.asarray(
        [1.0 / math.sqrt(max(1, bin_counts[value])) for value in intensity_bins],
        dtype=np.float64,
    )
    sampler = WeightedRandomSampler(
        torch.from_numpy(sampling_weights),
        num_samples=len(sampling_weights),
        replacement=True,
        generator=generator,
    )
    loader = DataLoader(
        train_dataset,
        batch_size=batch_size,
        sampler=sampler,
        num_workers=0,
        pin_memory=device == "cuda",
    )
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=learning_rate,
        weight_decay=weight_decay,
    )
    scaler = torch.amp.GradScaler("cuda", enabled=device == "cuda")
    best_state: dict[str, Any] | None = None
    best_mae = math.inf
    history: list[dict[str, float | int]] = []
    patience = 5
    stale_epochs = 0

    def predict(values: np.ndarray) -> dict[str, np.ndarray]:
        model.eval()
        with torch.no_grad():
            tensor = torch.from_numpy(values).to(device)
            (
                intensity_logits,
                mean_intensity_prediction,
                emotion_logits,
                disagreement_prediction,
            ) = model(tensor)
            intensity_distribution = torch.softmax(intensity_logits, dim=-1)
            return {
                "intensity_distribution": intensity_distribution.cpu().numpy(),
                "mean_intensity": mean_intensity_prediction.cpu().numpy(),
                "emotion_distribution": torch.softmax(emotion_logits, dim=-1).cpu().numpy(),
                "disagreement": disagreement_prediction.cpu().numpy(),
            }

    validation_truth = validation_intensity @ INTENSITY_VALUES
    for epoch in range(epochs):
        model.train()
        losses: list[float] = []
        for features, intensity_target, emotion_target, disagreement_target in loader:
            features = features.to(device, non_blocking=True)
            intensity_target = intensity_target.to(device, non_blocking=True)
            emotion_target = emotion_target.to(device, non_blocking=True)
            disagreement_target = disagreement_target.to(device, non_blocking=True)
            sample_weight = torch.clamp(1.0 - disagreement_target / 1.2, min=0.25)
            optimizer.zero_grad(set_to_none=True)
            context = (
                torch.amp.autocast("cuda", dtype=torch.float16)
                if device == "cuda"
                else torch.amp.autocast("cpu", enabled=False)
            )
            with context:
                (
                    intensity_logits,
                    mean_intensity_prediction,
                    emotion_logits,
                    disagreement_prediction,
                ) = model(features)
                mean_intensity_target = intensity_target @ torch.as_tensor(
                    INTENSITY_VALUES,
                    dtype=torch.float32,
                    device=device,
                )
                intensity_loss = -(
                    intensity_target * torch.log_softmax(intensity_logits, dim=-1)
                ).sum(dim=-1)
                regression_loss = torch.nn.functional.smooth_l1_loss(
                    mean_intensity_prediction,
                    mean_intensity_target,
                    beta=0.2,
                    reduction="none",
                )
                prediction_centered = mean_intensity_prediction - mean_intensity_prediction.mean()
                target_centered = mean_intensity_target - mean_intensity_target.mean()
                covariance = torch.mean(prediction_centered * target_centered)
                denominator = (
                    torch.mean(prediction_centered.square())
                    + torch.mean(target_centered.square())
                    + (mean_intensity_prediction.mean() - mean_intensity_target.mean()).square()
                    + 1e-6
                )
                ccc_loss = 1.0 - 2.0 * covariance / denominator
                emotion_loss = -(
                    emotion_target * torch.log_softmax(emotion_logits, dim=-1)
                ).sum(dim=-1)
                disagreement_loss = torch.nn.functional.smooth_l1_loss(
                    disagreement_prediction,
                    disagreement_target,
                    reduction="none",
                )
                loss = (
                    sample_weight * (0.5 * intensity_loss + regression_loss)
                    + 0.1 * emotion_loss
                    + 0.05 * disagreement_loss
                ).mean() + 0.25 * ccc_loss
            scaler.scale(loss).backward()
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(optimizer)
            scaler.update()
            losses.append(float(loss.detach().cpu()))
        validation_prediction = predict(validation_scaled)
        validation_mae = float(
            np.mean(np.abs(validation_truth - validation_prediction["mean_intensity"]))
        )
        history.append(
            {
                "epoch": epoch + 1,
                "mean_loss": float(np.mean(losses)),
                "validation_mae": validation_mae,
            }
        )
        if validation_mae < best_mae - 1e-5:
            best_mae = validation_mae
            best_state = {
                name: value.detach().cpu().clone() for name, value in model.state_dict().items()
            }
            stale_epochs = 0
        else:
            stale_epochs += 1
            if stale_epochs >= patience:
                break
    if best_state is None:
        raise RuntimeError("head 학습에서 유효한 checkpoint를 만들지 못했습니다.")
    model.load_state_dict(best_state)
    outputs = predict(validation_scaled)
    return (
        {
            "state_dict": best_state,
            "feature_mean": mean,
            "feature_std": std,
            "hidden_dimensions": [256, 128],
        },
        outputs,
        history,
    )


def _predict_head_state(
    state: dict[str, Any],
    features: np.ndarray,
    device: str,
) -> dict[str, np.ndarray]:
    import torch
    import torch.nn as nn

    class MultiTaskHead(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.shared = nn.Sequential(
                nn.Linear(MODEL_FEATURE_DIMENSION, 256),
                nn.LayerNorm(256),
                nn.GELU(),
                nn.Dropout(0.2),
                nn.Linear(256, 128),
                nn.GELU(),
                nn.Dropout(0.1),
            )
            self.intensity = nn.Linear(128, 3)
            self.mean_intensity = nn.Linear(128, 1)
            self.emotion = nn.Linear(128, len(EMOTION_CLASSES))
            self.disagreement = nn.Linear(128, 1)

        def forward(self, values: Any) -> tuple[Any, Any, Any, Any]:
            hidden = self.shared(values)
            return (
                self.intensity(hidden),
                2.0 * torch.sigmoid(self.mean_intensity(hidden).squeeze(-1)),
                self.emotion(hidden),
                self.disagreement(hidden).squeeze(-1),
            )

    scaled = (features - state["feature_mean"]) / state["feature_std"]
    model = MultiTaskHead().to(device)
    model.load_state_dict(state["state_dict"])
    model.eval()
    outputs = {"intensity_distribution": [], "mean_intensity": [], "emotion_distribution": [], "disagreement": []}
    with torch.no_grad():
        for start in range(0, len(scaled), 1024):
            tensor = torch.from_numpy(scaled[start : start + 1024]).to(device)
            intensity_logits, mean_intensity, emotion_logits, disagreement = model(tensor)
            intensity_distribution = torch.softmax(intensity_logits, dim=-1)
            outputs["intensity_distribution"].append(intensity_distribution.cpu().numpy())
            outputs["mean_intensity"].append(mean_intensity.cpu().numpy())
            outputs["emotion_distribution"].append(torch.softmax(emotion_logits, dim=-1).cpu().numpy())
            outputs["disagreement"].append(disagreement.cpu().numpy())
    return {name: np.concatenate(chunks, axis=0) for name, chunks in outputs.items()}


def train_emotion2vec_intensity_head(
    auxiliary_manifest_path: Path,
    auxiliary_embeddings_path: Path,
    auxiliary_index_path: Path,
    variant_manifest_path: Path,
    variant_embeddings_path: Path,
    variant_index_path: Path,
    artifact_path: Path,
    predictions_path: Path,
    variant_predictions_path: Path,
    report_json_path: Path,
    report_md_path: Path,
    device: str = "auto",
    epochs: int = 30,
    batch_size: int = 256,
    learning_rate: float = 1e-3,
    weight_decay: float = 1e-3,
    seed: int = 20260716,
) -> dict[str, Any]:
    import joblib
    import torch
    from sklearn.ensemble import ExtraTreesRegressor
    from sklearn.linear_model import Ridge
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    resolved_device = _resolve_device(device)
    rows, features = _load_aligned_features(
        auxiliary_manifest_path,
        auxiliary_embeddings_path,
        auxiliary_index_path,
    )
    variant_rows, variant_features = _load_aligned_features(
        variant_manifest_path,
        variant_embeddings_path,
        variant_index_path,
    )
    train_indices = np.asarray(
        [index for index, row in enumerate(rows) if row["split"] == "AUX_TRAIN"],
        dtype=int,
    )
    if not len(train_indices):
        raise ValueError("AUX_TRAIN 행이 없습니다.")
    folds = sorted({int(rows[index]["cv_fold"]) for index in train_indices})
    intensity, emotion, disagreement = _targets(rows)
    variant_intensity, _, _ = _targets(variant_rows)

    oof_by_candidate = {
        "multitask_neural": np.full(len(rows), np.nan, dtype=np.float32),
        "ridge": np.full(len(rows), np.nan, dtype=np.float32),
        "extra_trees": np.full(len(rows), np.nan, dtype=np.float32),
    }
    fold_states: list[dict[str, Any]] = []
    classical_fold_models: dict[str, list[Any]] = {"ridge": [], "extra_trees": []}
    fold_reports: list[dict[str, Any]] = []
    variant_by_candidate: dict[str, list[np.ndarray]] = {
        "multitask_neural": [],
        "ridge": [],
        "extra_trees": [],
    }
    for fold in folds:
        fold_train = train_indices[
            np.asarray([int(rows[index]["cv_fold"]) != fold for index in train_indices])
        ]
        fold_validation = train_indices[
            np.asarray([int(rows[index]["cv_fold"]) == fold for index in train_indices])
        ]
        state, validation_output, history = _train_head(
            features[fold_train],
            intensity[fold_train],
            emotion[fold_train],
            disagreement[fold_train],
            features[fold_validation],
            intensity[fold_validation],
            resolved_device,
            epochs,
            batch_size,
            learning_rate,
            weight_decay,
            seed + fold,
        )
        oof_by_candidate["multitask_neural"][fold_validation] = validation_output[
            "mean_intensity"
        ]
        fold_states.append(state)
        variant_output = _predict_head_state(state, variant_features, resolved_device)
        variant_by_candidate["multitask_neural"].append(variant_output["mean_intensity"])
        fold_truth = intensity[fold_validation] @ INTENSITY_VALUES

        ridge = make_pipeline(
            StandardScaler(),
            Ridge(alpha=100.0),
        )
        ridge.fit(features[fold_train], intensity[fold_train] @ INTENSITY_VALUES)
        oof_by_candidate["ridge"][fold_validation] = np.clip(
            ridge.predict(features[fold_validation]),
            0.0,
            2.0,
        )
        variant_by_candidate["ridge"].append(
            np.clip(ridge.predict(variant_features), 0.0, 2.0)
        )
        classical_fold_models["ridge"].append(ridge)

        extra_trees = ExtraTreesRegressor(
            n_estimators=120,
            max_depth=18,
            min_samples_leaf=4,
            max_features="sqrt",
            n_jobs=-1,
            random_state=seed + fold,
        )
        extra_trees.fit(features[fold_train], intensity[fold_train] @ INTENSITY_VALUES)
        oof_by_candidate["extra_trees"][fold_validation] = np.clip(
            extra_trees.predict(features[fold_validation]),
            0.0,
            2.0,
        )
        variant_by_candidate["extra_trees"].append(
            np.clip(extra_trees.predict(variant_features), 0.0, 2.0)
        )
        classical_fold_models["extra_trees"].append(extra_trees)

        fold_reports.append(
            {
                "fold": fold,
                "train_rows": len(fold_train),
                "validation_rows": len(fold_validation),
                "metrics": {
                    candidate: regression_metrics(
                        fold_truth,
                        oof_by_candidate[candidate][fold_validation],
                    )
                    for candidate in oof_by_candidate
                },
                "epochs_run": len(history),
                "best_validation_mae": min(item["validation_mae"] for item in history),
            }
        )

    for candidate, values in oof_by_candidate.items():
        if not np.isfinite(values[train_indices]).all():
            raise RuntimeError(f"{candidate} OOF intensity 예측에 결측이 있습니다.")
    train_truth = intensity[train_indices] @ INTENSITY_VALUES
    candidate_metrics = {
        candidate: regression_metrics(train_truth, values[train_indices])
        for candidate, values in oof_by_candidate.items()
    }
    selected_candidate = max(
        candidate_metrics,
        key=lambda candidate: (
            candidate_metrics[candidate]["ccc"]
            if candidate_metrics[candidate]["ccc"] is not None
            else -math.inf,
            -candidate_metrics[candidate]["mae"],
        ),
    )
    oof_mean = oof_by_candidate[selected_candidate]
    selected_variant_folds = variant_by_candidate[selected_candidate]
    variant_mean = np.median(
        np.stack(selected_variant_folds, axis=0),
        axis=0,
    )
    variant_std = np.std(
        np.stack(selected_variant_folds, axis=0),
        axis=0,
    )
    if selected_candidate == "multitask_neural":
        neural_distributions = [
            _predict_head_state(state, variant_features, resolved_device)[
                "intensity_distribution"
            ]
            for state in fold_states
        ]
        variant_distribution = np.mean(np.stack(neural_distributions, axis=0), axis=0)
    else:
        clipped = np.clip(variant_mean, 0.0, 2.0)
        variant_distribution = np.column_stack(
            [
                np.where(clipped <= 1.0, 1.0 - clipped, 0.0),
                np.where(clipped <= 1.0, clipped, 2.0 - clipped),
                np.where(clipped <= 1.0, 0.0, clipped - 1.0),
            ]
        )

    prediction_rows = []
    for index, row in enumerate(rows):
        prediction_rows.append(
            {
                "embedding_key": row["embedding_key"],
                "wav_id": row["wav_id"],
                "split": row["split"],
                "cv_fold": row["cv_fold"],
                "target_mean_intensity": row["mean_intensity"],
                "oof_mean_intensity": (
                    round(float(oof_mean[index]), 8) if np.isfinite(oof_mean[index]) else ""
                ),
            }
        )
    write_csv(
        predictions_path,
        prediction_rows,
        [
            "embedding_key",
            "wav_id",
            "split",
            "cv_fold",
            "target_mean_intensity",
            "oof_mean_intensity",
        ],
    )

    variant_prediction_rows = []
    for index, row in enumerate(variant_rows):
        variant_prediction_rows.append(
            {
                "embedding_key": row["embedding_key"],
                "clip_id": row["clip_id"],
                "source_wav_id": row["wav_id"],
                "variant": row["variant"],
                "proxy_group": row["proxy_group"],
                "target_mean_intensity": row["mean_intensity"],
                "predicted_mean_intensity": round(float(variant_mean[index]), 8),
                "ensemble_std": round(float(variant_std[index]), 8),
                "predicted_p0": round(float(variant_distribution[index, 0]), 8),
                "predicted_p1": round(float(variant_distribution[index, 1]), 8),
                "predicted_p2": round(float(variant_distribution[index, 2]), 8),
            }
        )
    write_csv(
        variant_predictions_path,
        variant_prediction_rows,
        [
            "embedding_key",
            "clip_id",
            "source_wav_id",
            "variant",
            "proxy_group",
            "target_mean_intensity",
            "predicted_mean_intensity",
            "ensemble_std",
            "predicted_p0",
            "predicted_p1",
            "predicted_p2",
        ],
    )

    clean_indices = np.asarray(
        [index for index, row in enumerate(variant_rows) if row["variant"] == "CLEAN_16K"],
        dtype=int,
    )
    telephone_by_clip = {
        row["clip_id"]: index
        for index, row in enumerate(variant_rows)
        if row["variant"] == "TELEPHONY_8K_MULAW_UP16K"
    }
    telephone_indices = np.asarray(
        [telephone_by_clip[variant_rows[index]["clip_id"]] for index in clean_indices],
        dtype=int,
    )
    clean_truth = variant_intensity[clean_indices] @ INTENSITY_VALUES
    package_robustness = robustness_metrics(
        clean_truth,
        variant_mean[clean_indices],
        variant_mean[telephone_indices],
    )
    constant_prediction = np.full(len(clean_indices), float(train_truth.mean()))

    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    selected_models: Any
    if selected_candidate == "multitask_neural":
        selected_models = fold_states
    else:
        selected_models = classical_fold_models[selected_candidate]
    joblib.dump(
        {
            "candidate_id": "emotion2vec_intensity_head_v2",
            "selected_head": selected_candidate,
            "base_model_id": MODEL_ID,
            "emotion_classes": EMOTION_CLASSES,
            "intensity_values": INTENSITY_VALUES,
            "fold_models": selected_models,
            "proxy_group_method": "CONTIGUOUS_AGE_SEX_RUN",
            "inference_status": "RESEARCH_SHADOW_ONLY",
        },
        artifact_path,
    )
    report = {
        "status": "EMOTION2VEC_INTENSITY_HEAD_COMPLETE",
        "created_at": utc_now_iso(),
        "candidate_id": "emotion2vec_intensity_head_v2",
        "selected_head": selected_candidate,
        "head_selection_rule": "MAX_AUXILIARY_PROXY_GROUP_OOF_CCC_THEN_LOWER_MAE",
        "device": resolved_device,
        "gpu_name": torch.cuda.get_device_name(0) if resolved_device == "cuda" else None,
        "configuration": {
            "epochs_max": epochs,
            "batch_size": batch_size,
            "learning_rate": learning_rate,
            "weight_decay": weight_decay,
            "seed": seed,
            "folds": len(folds),
            "losses": {
                "direct_mean_intensity_smooth_l1": 1.0,
                "batch_ccc": 0.25,
                "ordinal_soft_cross_entropy": 0.5,
                "emotion_vote_soft_cross_entropy": 0.1,
                "disagreement_smooth_l1": 0.05,
            },
            "sampling": "INVERSE_SQRT_INTENSITY_BIN_FREQUENCY",
        },
        "data": {
            "auxiliary_train_rows": len(train_indices),
            "package_variant_rows": len(variant_rows),
            "package_clips": len(clean_indices),
            "proxy_group_method": "CONTIGUOUS_AGE_SEX_RUN",
            "speaker_independent_claim_allowed": False,
        },
        "cross_validated_auxiliary": {
            "selected_metrics": candidate_metrics[selected_candidate],
            "candidate_metrics": candidate_metrics,
            "fold_reports": fold_reports,
        },
        "package_holdout_existing_intensity": {
            "robustness": package_robustness,
            "constant_train_mean_baseline": regression_metrics(clean_truth, constant_prediction),
            "label_definition": "FIVE_RATER_MEAN_ORDINAL_INTENSITY_0_TO_2",
            "temperature_labels_used": False,
        },
        "artifact": {
            "path": str(artifact_path.resolve()),
            "sha256": sha256_file(artifact_path),
        },
        "outputs": {
            "oof_predictions": str(predictions_path.resolve()),
            "variant_predictions": str(variant_predictions_path.resolve()),
        },
        "next_gate": "FIT_TEMPERATURE_BRIDGE_ON_49_CONSENSUS_TARGETS",
    }
    write_json(report_json_path, report)
    clean = package_robustness["clean"]
    telephone = package_robustness["telephone_8k"]
    lines = [
        "# emotion2vec intensity head v2",
        "",
        f"- 상태: `{report['status']}`",
        f"- GPU: `{report['gpu_name']}`",
        f"- auxiliary 학습 행: {len(train_indices):,}",
        f"- 선택 head: `{selected_candidate}`",
        f"- 기존 강도 package 평가 clip: {len(clean_indices):,}",
        f"- auxiliary OOF CCC: {report['cross_validated_auxiliary']['selected_metrics']['ccc']:.4f}",
        f"- package clean CCC: {clean['ccc']:.4f}",
        f"- package clean MAE(0~2): {clean['mae']:.4f}",
        f"- package telephone CCC: {telephone['ccc']:.4f}",
        f"- clean/telephone 평균 절대 예측 차이: {package_robustness['mean_absolute_prediction_shift']:.4f}",
        "",
        "package 500개와 같은 휴리스틱 proxy group은 auxiliary train에서 제외했다. "
        "proxy group은 실제 화자 ID가 아니므로 이 결과를 화자 독립 성능으로 주장하지 않는다.",
        "",
    ]
    report_md_path.write_text("\n".join(lines), encoding="utf-8")
    return report


def _group_splits(groups: np.ndarray, folds: int) -> list[tuple[np.ndarray, np.ndarray]]:
    from sklearn.model_selection import GroupKFold

    unique_groups = np.unique(groups)
    split_count = min(folds, len(unique_groups))
    if split_count < 2:
        raise ValueError("교차검증에 필요한 proxy group이 2개 미만입니다.")
    dummy = np.zeros(len(groups), dtype=np.float32)
    return list(GroupKFold(n_splits=split_count).split(dummy, groups=groups))


def _fit_residual_ridge(
    train_features: np.ndarray,
    train_residual: np.ndarray,
    alpha: float,
) -> dict[str, Any]:
    from sklearn.decomposition import PCA
    from sklearn.linear_model import Ridge
    from sklearn.preprocessing import StandardScaler

    scaler = StandardScaler()
    scaled = scaler.fit_transform(train_features)
    components = min(8, scaled.shape[0] - 2, scaled.shape[1])
    if components < 1:
        raise ValueError("residual PCA를 학습할 행이 부족합니다.")
    pca = PCA(n_components=components, random_state=20260716)
    reduced = pca.fit_transform(scaled)
    ridge = Ridge(alpha=alpha)
    ridge.fit(reduced, train_residual)
    return {"scaler": scaler, "pca": pca, "ridge": ridge}


def _predict_residual(model: dict[str, Any], features: np.ndarray, bound: float) -> np.ndarray:
    scaled = model["scaler"].transform(features)
    reduced = model["pca"].transform(scaled)
    return np.clip(model["ridge"].predict(reduced), -bound, bound)


def _fit_direct_pls(
    train_features: np.ndarray,
    train_targets: np.ndarray,
    components: int,
) -> dict[str, Any]:
    from sklearn.cross_decomposition import PLSRegression
    from sklearn.preprocessing import StandardScaler

    scaler = StandardScaler()
    scaled = scaler.fit_transform(train_features)
    usable_components = min(components, scaled.shape[0] - 1, scaled.shape[1])
    if usable_components < 1:
        raise ValueError("PLS를 학습할 행 또는 특성이 부족합니다.")
    model = PLSRegression(
        n_components=usable_components,
        scale=False,
        max_iter=1000,
        tol=1e-7,
    )
    model.fit(scaled, train_targets)
    return {
        "scaler": scaler,
        "model": model,
        "components": usable_components,
    }


def _predict_direct_pls(model: dict[str, Any], features: np.ndarray) -> np.ndarray:
    scaled = model["scaler"].transform(features)
    prediction = np.asarray(model["model"].predict(scaled)).reshape(-1)
    return np.clip(prediction, 0.0, 100.0)


def _choose_pls_components(
    features: np.ndarray,
    targets: np.ndarray,
    groups: np.ndarray,
    candidates: tuple[int, ...],
) -> int:
    scores: dict[int, list[float]] = {candidate: [] for candidate in candidates}
    for inner_train, inner_validation in _group_splits(
        groups,
        min(4, len(np.unique(groups))),
    ):
        for candidate in candidates:
            model = _fit_direct_pls(
                features[inner_train],
                targets[inner_train],
                candidate,
            )
            prediction = _predict_direct_pls(model, features[inner_validation])
            scores[candidate].append(
                float(np.mean(np.abs(targets[inner_validation] - prediction)))
            )
    return min(
        candidates,
        key=lambda candidate: (float(np.mean(scores[candidate])), candidate),
    )


def _choose_residual_alpha(
    predicted_intensity: np.ndarray,
    features: np.ndarray,
    targets: np.ndarray,
    groups: np.ndarray,
    alphas: tuple[float, ...],
    bound: float,
) -> float:
    scores: dict[float, list[float]] = {alpha: [] for alpha in alphas}
    for inner_train, inner_validation in _group_splits(groups, min(4, len(np.unique(groups)))):
        calibrator = fit_affine_calibrator(
            predicted_intensity[inner_train],
            targets[inner_train],
        )
        train_base = calibrator.predict(predicted_intensity[inner_train])
        validation_base = calibrator.predict(predicted_intensity[inner_validation])
        residual_target = targets[inner_train] - train_base
        for alpha in alphas:
            residual_model = _fit_residual_ridge(
                features[inner_train],
                residual_target,
                alpha,
            )
            prediction = np.clip(
                validation_base
                + _predict_residual(residual_model, features[inner_validation], bound),
                0.0,
                100.0,
            )
            scores[alpha].append(float(np.mean(np.abs(targets[inner_validation] - prediction))))
    return min(alphas, key=lambda alpha: (float(np.mean(scores[alpha])), alpha))


def train_emotion2vec_temperature_bridge(
    consensus_path: Path,
    admin_manifest_path: Path,
    variant_manifest_path: Path,
    variant_predictions_path: Path,
    variant_embeddings_path: Path,
    variant_index_path: Path,
    variant_egemaps_path: Path | None,
    artifact_path: Path,
    predictions_path: Path,
    report_json_path: Path,
    report_md_path: Path,
    folds: int = 5,
    residual_bound: float = 15.0,
    seed: int = 20260716,
) -> dict[str, Any]:
    import joblib

    consensus_rows = [
        row for row in read_csv(consensus_path) if row.get("consensus_status") == "READY"
    ]
    admin_by_clip = {row["clip_id"]: row for row in read_csv(admin_manifest_path)}
    variant_rows, variant_features = _load_aligned_features(
        variant_manifest_path,
        variant_embeddings_path,
        variant_index_path,
    )
    variant_by_key = {row["embedding_key"]: index for index, row in enumerate(variant_rows)}
    if variant_egemaps_path is not None:
        egemaps_rows = read_csv(variant_egemaps_path)
        egemaps_feature_names = [
            column
            for column in egemaps_rows[0]
            if column not in {"wav_id", "emotion_class", "variant"}
        ]
        egemaps_by_key = {
            f"{row['wav_id']}|{row['variant']}": np.asarray(
                [float(row[name]) for name in egemaps_feature_names],
                dtype=np.float32,
            )
            for row in egemaps_rows
        }
        variant_features = np.concatenate(
            [
                variant_features,
                np.asarray(
                    [egemaps_by_key[row["embedding_key"]] for row in variant_rows],
                    dtype=np.float32,
                ),
            ],
            axis=1,
        )
    prediction_by_key = {
        row["embedding_key"]: row for row in read_csv(variant_predictions_path)
    }

    clip_ids: list[str] = []
    groups: list[str] = []
    targets: list[float] = []
    clean_intensity: list[float] = []
    telephone_intensity: list[float] = []
    clean_features: list[np.ndarray] = []
    telephone_features: list[np.ndarray] = []
    for row in consensus_rows:
        clip_id = row["clip_id"]
        if clip_id not in admin_by_clip:
            raise ValueError(f"admin manifest에 없는 consensus clip: {clip_id}")
        clean_key = f"{clip_id}|CLEAN_16K"
        telephone_key = f"{clip_id}|TELEPHONY_8K_MULAW_UP16K"
        if clean_key not in prediction_by_key or telephone_key not in prediction_by_key:
            raise ValueError(f"variant intensity 예측이 없는 clip: {clip_id}")
        clip_ids.append(clip_id)
        targets.append(float(row["emotion_temperature_score"]))
        groups.append(prediction_by_key[clean_key]["proxy_group"])
        clean_intensity.append(float(prediction_by_key[clean_key]["predicted_mean_intensity"]))
        telephone_intensity.append(
            float(prediction_by_key[telephone_key]["predicted_mean_intensity"])
        )
        clean_features.append(variant_features[variant_by_key[clean_key]])
        telephone_features.append(variant_features[variant_by_key[telephone_key]])

    target_array = np.asarray(targets, dtype=np.float64)
    clean_intensity_array = np.asarray(clean_intensity, dtype=np.float64)
    telephone_intensity_array = np.asarray(telephone_intensity, dtype=np.float64)
    clean_feature_array = np.asarray(clean_features, dtype=np.float32)
    telephone_feature_array = np.asarray(telephone_features, dtype=np.float32)
    group_array = np.asarray(groups)
    splits = _group_splits(group_array, folds)
    affine_clean = np.full(len(target_array), np.nan)
    affine_telephone = np.full(len(target_array), np.nan)
    residual_clean = np.full(len(target_array), np.nan)
    residual_telephone = np.full(len(target_array), np.nan)
    pls_clean = np.full(len(target_array), np.nan)
    pls_telephone = np.full(len(target_array), np.nan)
    fold_reports: list[dict[str, Any]] = []
    alphas = (1.0, 10.0, 100.0, 1000.0, 10000.0)
    pls_component_candidates = (1, 2, 3, 4, 5)

    for fold, (train_indices, validation_indices) in enumerate(splits):
        calibrator = fit_affine_calibrator(
            clean_intensity_array[train_indices],
            target_array[train_indices],
        )
        train_base = calibrator.predict(clean_intensity_array[train_indices])
        affine_clean[validation_indices] = calibrator.predict(
            clean_intensity_array[validation_indices]
        )
        affine_telephone[validation_indices] = calibrator.predict(
            telephone_intensity_array[validation_indices]
        )
        alpha = _choose_residual_alpha(
            clean_intensity_array[train_indices],
            clean_feature_array[train_indices],
            target_array[train_indices],
            group_array[train_indices],
            alphas,
            residual_bound,
        )
        residual_model = _fit_residual_ridge(
            clean_feature_array[train_indices],
            target_array[train_indices] - train_base,
            alpha,
        )
        residual_clean[validation_indices] = np.clip(
            affine_clean[validation_indices]
            + _predict_residual(
                residual_model,
                clean_feature_array[validation_indices],
                residual_bound,
            ),
            0.0,
            100.0,
        )
        residual_telephone[validation_indices] = np.clip(
            affine_telephone[validation_indices]
            + _predict_residual(
                residual_model,
                telephone_feature_array[validation_indices],
                residual_bound,
            ),
            0.0,
            100.0,
        )
        pls_components = _choose_pls_components(
            clean_feature_array[train_indices],
            target_array[train_indices],
            group_array[train_indices],
            pls_component_candidates,
        )
        pls_model = _fit_direct_pls(
            clean_feature_array[train_indices],
            target_array[train_indices],
            pls_components,
        )
        pls_clean[validation_indices] = _predict_direct_pls(
            pls_model,
            clean_feature_array[validation_indices],
        )
        pls_telephone[validation_indices] = _predict_direct_pls(
            pls_model,
            telephone_feature_array[validation_indices],
        )
        fold_reports.append(
            {
                "fold": fold,
                "train_rows": len(train_indices),
                "validation_rows": len(validation_indices),
                "validation_clip_ids": [clip_ids[index] for index in validation_indices],
                "selected_residual_alpha": alpha,
                "selected_pls_components": pls_components,
                "calibrator": calibrator.to_dict(),
            }
        )

    affine_robustness = robustness_metrics(
        target_array,
        affine_clean,
        affine_telephone,
    )
    residual_robustness = robustness_metrics(
        target_array,
        residual_clean,
        residual_telephone,
    )
    pls_robustness = robustness_metrics(
        target_array,
        pls_clean,
        pls_telephone,
    )
    affine_metrics = affine_robustness["clean"]
    residual_metrics = residual_robustness["clean"]
    pls_metrics = pls_robustness["clean"]
    residual_improves = (
        residual_metrics["ccc"] is not None
        and affine_metrics["ccc"] is not None
        and residual_metrics["ccc"] > affine_metrics["ccc"]
        and residual_metrics["mae"] <= affine_metrics["mae"]
    )
    pls_improves = (
        pls_metrics["ccc"] is not None
        and affine_metrics["ccc"] is not None
        and pls_metrics["ccc"] > affine_metrics["ccc"]
        and pls_metrics["mae"] <= affine_metrics["mae"]
    )
    candidates = {
        "emotion2vec_intensity_affine_v2": (
            affine_clean,
            affine_telephone,
            affine_robustness,
        )
    }
    if residual_improves:
        candidates["emotion2vec_intensity_affine_bounded_residual_v2"] = (
            residual_clean,
            residual_telephone,
            residual_robustness,
        )
    if pls_improves:
        candidates["emotion2vec_direct_pls_v2"] = (
            pls_clean,
            pls_telephone,
            pls_robustness,
        )
    selected_candidate = max(
        candidates,
        key=lambda candidate: (
            candidates[candidate][2]["clean"]["ccc"],
            -candidates[candidate][2]["clean"]["mae"],
        ),
    )
    selected_clean, selected_telephone, selected_robustness = candidates[
        selected_candidate
    ]

    final_calibrator = fit_affine_calibrator(clean_intensity_array, target_array)
    final_base = final_calibrator.predict(clean_intensity_array)
    final_alpha = _choose_residual_alpha(
        clean_intensity_array,
        clean_feature_array,
        target_array,
        group_array,
        alphas,
        residual_bound,
    )
    final_residual_model = _fit_residual_ridge(
        clean_feature_array,
        target_array - final_base,
        final_alpha,
    )
    final_pls_components = _choose_pls_components(
        clean_feature_array,
        target_array,
        group_array,
        pls_component_candidates,
    )
    final_pls_model = _fit_direct_pls(
        clean_feature_array,
        target_array,
        final_pls_components,
    )
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "candidate_id": selected_candidate,
            "base_model_id": MODEL_ID,
            "affine": final_calibrator,
            "residual_model": (
                final_residual_model
                if selected_candidate
                == "emotion2vec_intensity_affine_bounded_residual_v2"
                else None
            ),
            "direct_pls_model": (
                final_pls_model
                if selected_candidate == "emotion2vec_direct_pls_v2"
                else None
            ),
            "residual_bound": residual_bound,
            "development_only": True,
            "proxy_group_method": "CONTIGUOUS_AGE_SEX_RUN",
        },
        artifact_path,
    )

    prediction_rows = []
    for index, clip_id in enumerate(clip_ids):
        prediction_rows.append(
            {
                "clip_id": clip_id,
                "proxy_group": groups[index],
                "human_target": round(float(target_array[index]), 8),
                "predicted_intensity_clean": round(float(clean_intensity_array[index]), 8),
                "predicted_intensity_telephone": round(
                    float(telephone_intensity_array[index]), 8
                ),
                "affine_clean_prediction": round(float(affine_clean[index]), 8),
                "residual_clean_prediction": round(float(residual_clean[index]), 8),
                "pls_clean_prediction": round(float(pls_clean[index]), 8),
                "selected_clean_prediction": round(float(selected_clean[index]), 8),
                "selected_telephone_prediction": round(float(selected_telephone[index]), 8),
            }
        )
    write_csv(
        predictions_path,
        prediction_rows,
        [
            "clip_id",
            "proxy_group",
            "human_target",
            "predicted_intensity_clean",
            "predicted_intensity_telephone",
            "affine_clean_prediction",
            "residual_clean_prediction",
            "pls_clean_prediction",
            "selected_clean_prediction",
            "selected_telephone_prediction",
        ],
    )

    clean_metrics = selected_robustness["clean"]
    development_gates = {
        "ccc_minimum_0_50": clean_metrics["ccc"] is not None
        and clean_metrics["ccc"] >= 0.50,
        "mae_maximum_10": clean_metrics["mae"] <= 10.0,
        "spearman_minimum_0_50": clean_metrics["spearman"] is not None
        and clean_metrics["spearman"] >= 0.50,
        "telephone_ccc_drop_maximum_0_10": selected_robustness["ccc_drop"] is not None
        and selected_robustness["ccc_drop"] <= 0.10,
        "clean_telephone_mean_shift_maximum_5": selected_robustness[
            "mean_absolute_prediction_shift"
        ]
        <= 5.0,
    }
    report = {
        "status": "EMOTION2VEC_TEMPERATURE_BRIDGE_COMPLETE",
        "created_at": utc_now_iso(),
        "candidate_id": selected_candidate,
        "selection_rule": (
            "Compare affine, bounded residual, and direct PLS. A complex candidate is "
            "eligible only when proxy-group CV improves CCC without worsening MAE; "
            "select the eligible candidate with the highest CCC."
        ),
        "interpretation": (
            "RETROSPECTIVE_DEVELOPMENT_CV_ON_49_POST_ADJUDICATION_TARGETS; "
            "NOT_A_NEW_INDEPENDENT_FINAL_TEST"
        ),
        "rows": len(target_array),
        "proxy_groups": len(np.unique(group_array)),
        "proxy_group_method": "CONTIGUOUS_AGE_SEX_RUN",
        "residual_feature_set": (
            "EMOTION2VEC_777_PLUS_EGEMAPS_88"
            if variant_egemaps_path is not None
            else "EMOTION2VEC_777"
        ),
        "speaker_independent_claim_allowed": False,
        "affine_candidate": {
            "robustness": affine_robustness,
            "bootstrap_clean": bootstrap_regression_metrics(
                target_array,
                affine_clean,
                iterations=2000,
                seed=seed,
            ),
        },
        "bounded_residual_candidate": {
            "robustness": residual_robustness,
            "bootstrap_clean": bootstrap_regression_metrics(
                target_array,
                residual_clean,
                iterations=2000,
                seed=seed + 1,
            ),
        },
        "direct_pls_candidate": {
            "robustness": pls_robustness,
            "bootstrap_clean": bootstrap_regression_metrics(
                target_array,
                pls_clean,
                iterations=2000,
                seed=seed + 2,
            ),
        },
        "selected": {
            "robustness": selected_robustness,
            "development_gates": development_gates,
            "all_development_gates_pass": all(development_gates.values()),
        },
        "fold_reports": fold_reports,
        "artifact": {
            "path": str(artifact_path.resolve()),
            "sha256": sha256_file(artifact_path),
            "final_residual_alpha": final_alpha,
            "final_pls_components": final_pls_components,
        },
        "api_allowed": False,
        "api_block_reason": "NO_FUTURE_INDEPENDENT_HOLDOUT",
    }
    write_json(report_json_path, report)
    lines = [
        "# emotion2vec intensity bridge v2",
        "",
        f"- 상태: `{report['status']}`",
        f"- 선택 후보: `{selected_candidate}`",
        f"- 개발 proxy-group CV 행: {len(target_array)}",
        f"- clean CCC: {clean_metrics['ccc']:.4f}",
        f"- clean MAE: {clean_metrics['mae']:.4f}",
        f"- clean Spearman: {clean_metrics['spearman']:.4f}",
        f"- telephone CCC: {selected_robustness['telephone_8k']['ccc']:.4f}",
        f"- clean/telephone 평균 절대 점수 차이: {selected_robustness['mean_absolute_prediction_shift']:.4f}",
        f"- 개발 게이트 전체 통과: `{all(development_gates.values())}`",
        "",
        "49개는 사후 조정 합의 타깃이며 기존 20개 역할도 이미 사용된 자료다. "
        "따라서 이 결과는 신규 최종시험이 아니라 후속 모델 개발용 proxy-group CV로만 해석한다.",
        "",
        "API는 새 독립 holdout이 없으므로 계속 금지한다.",
        "",
    ]
    report_md_path.write_text("\n".join(lines), encoding="utf-8")
    return report
