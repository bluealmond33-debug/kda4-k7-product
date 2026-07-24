from __future__ import annotations

import math
import random
import wave
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import numpy as np

from .emotion2vec_v2 import MODEL_FEATURE_DIMENSION, MODEL_ID, _load_aligned_features
from .evaluation import regression_metrics
from .io_utils import read_csv, sha256_file, utc_now_iso, write_csv, write_json


ORDINAL_LEVELS = (0, 1, 2)
LEVEL_NAMES = {0: "low", 1: "medium", 2: "high"}


def _truthy(value: Any) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


def _safe_segment_id(row: dict[str, str]) -> str:
    raw = f"{row['session_id']}__{row['text_no']}__spk{row['speaker_id']}"
    return "".join(character if character.isalnum() or character in "-_." else "_" for character in raw)


def _choose_group_stratified_folds(
    labels: np.ndarray,
    groups: np.ndarray,
    folds: int,
    seed: int,
    attempts: int = 256,
) -> tuple[np.ndarray, dict[str, Any]]:
    from sklearn.model_selection import StratifiedGroupKFold

    if len(np.unique(groups)) < folds:
        raise ValueError("fold 수보다 고유 화자쌍이 적습니다.")
    global_distribution = np.bincount(labels, minlength=3) / len(labels)
    best: tuple[float, np.ndarray, list[dict[str, Any]], int] | None = None
    for offset in range(attempts):
        candidate_seed = seed + offset
        splitter = StratifiedGroupKFold(
            n_splits=folds,
            shuffle=True,
            random_state=candidate_seed,
        )
        assignment = np.full(len(labels), -1, dtype=np.int64)
        fold_reports: list[dict[str, Any]] = []
        valid = True
        for fold, (_, validation) in enumerate(splitter.split(np.zeros(len(labels)), labels, groups)):
            assignment[validation] = fold
            counts = np.bincount(labels[validation], minlength=3)
            if np.any(counts == 0):
                valid = False
                break
            distribution = counts / counts.sum()
            fold_reports.append(
                {
                    "fold": fold,
                    "rows": int(len(validation)),
                    "groups": int(len(np.unique(groups[validation]))),
                    "class_counts": {str(level): int(counts[level]) for level in ORDINAL_LEVELS},
                    "class_distribution": {
                        str(level): float(distribution[level]) for level in ORDINAL_LEVELS
                    },
                }
            )
        if not valid or np.any(assignment < 0):
            continue
        size_penalty = float(
            np.std([item["rows"] for item in fold_reports]) / max(1.0, len(labels) / folds)
        )
        distribution_penalty = sum(
            abs(item["class_distribution"][str(level)] - global_distribution[level])
            for item in fold_reports
            for level in ORDINAL_LEVELS
        )
        score = distribution_penalty + size_penalty
        if best is None or score < best[0]:
            best = (score, assignment.copy(), fold_reports, candidate_seed)
    if best is None:
        raise ValueError("모든 fold에 0/1/2가 존재하는 화자쌍 분할을 찾지 못했습니다.")
    _, assignment, fold_reports, selected_seed = best
    for group in np.unique(groups):
        if len(np.unique(assignment[groups == group])) != 1:
            raise RuntimeError(f"화자쌍 누수 발견: {group}")
    return assignment, {
        "method": "STRATIFIED_GROUP_KFOLD_SPEAKER_PAIR_SEARCH",
        "requested_seed": seed,
        "selected_seed": selected_seed,
        "attempts": attempts,
        "folds": fold_reports,
    }


def prepare_add_datasets_ordinal_v3(
    source_manifest_path: Path,
    segment_dir: Path,
    output_manifest_path: Path,
    report_path: Path,
    folds: int = 5,
    seed: int = 20260717,
    min_duration_seconds: float = 0.25,
    min_rms_dbfs: float = -60.0,
    max_clipping_ratio: float = 0.10,
) -> dict[str, Any]:
    rows = [row for row in read_csv(source_manifest_path) if _truthy(row["usable_for_training"])]
    if not rows:
        raise ValueError("사용 가능한 add_datasets 발화가 없습니다.")
    source_paths = sorted({Path(row["wav_path"]) for row in rows})
    missing = [str(path) for path in source_paths if not path.exists()]
    if missing:
        raise FileNotFoundError(f"원본 WAV {len(missing)}개가 없습니다: {missing[:3]}")

    rows_by_wav: dict[Path, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        rows_by_wav[Path(row["wav_path"])].append(row)

    segment_dir.mkdir(parents=True, exist_ok=True)
    prepared: list[dict[str, Any]] = []
    quality_counts: Counter[str] = Counter()
    for wav_path, wav_rows in rows_by_wav.items():
        with wave.open(str(wav_path), "rb") as source:
            sample_rate = source.getframerate()
            channels = source.getnchannels()
            sample_width = source.getsampwidth()
            frame_count = source.getnframes()
            if (sample_rate, channels, sample_width) != (16000, 2, 2):
                raise ValueError(
                    f"지원하지 않는 WAV 형식 {wav_path}: {sample_rate}Hz/{channels}ch/{sample_width * 8}bit"
                )
            for row in wav_rows:
                start_frame = max(0, int(round(float(row["start_sec"]) * sample_rate)))
                end_frame = min(frame_count, int(round(float(row["end_sec"]) * sample_rate)))
                duration_seconds = (end_frame - start_frame) / sample_rate
                quality = "valid"
                if duration_seconds < min_duration_seconds:
                    quality = "too_short"
                source.setpos(start_frame)
                raw = source.readframes(max(0, end_frame - start_frame))
                samples = np.frombuffer(raw, dtype="<i2")
                if samples.size == 0 or samples.size % channels:
                    quality = "invalid_audio"
                    mono = np.empty(0, dtype=np.int16)
                else:
                    stereo = samples.reshape(-1, channels)
                    channel_index = int(row["source_channel"]) - 1
                    if channel_index not in (0, 1):
                        raise ValueError(f"유효하지 않은 source_channel: {row['source_channel']}")
                    mono = stereo[:, channel_index].copy()
                normalised = mono.astype(np.float32) / 32768.0
                rms = float(np.sqrt(np.mean(normalised**2))) if len(normalised) else 0.0
                rms_dbfs = 20.0 * math.log10(max(rms, 1e-12))
                clipping_ratio = (
                    float(np.mean(np.abs(mono.astype(np.int32)) >= 32760)) if len(mono) else 0.0
                )
                if quality == "valid" and rms_dbfs < min_rms_dbfs:
                    quality = "near_silence"
                if quality == "valid" and clipping_ratio > max_clipping_ratio:
                    quality = "excessive_clipping"

                segment_id = _safe_segment_id(row)
                audio_path = segment_dir / f"{segment_id}.wav"
                if quality == "valid" and not audio_path.exists():
                    with wave.open(str(audio_path), "wb") as target:
                        target.setnchannels(1)
                        target.setsampwidth(2)
                        target.setframerate(sample_rate)
                        target.writeframes(mono.astype("<i2", copy=False).tobytes())
                quality_counts[quality] += 1
                prepared.append(
                    {
                        "embedding_key": segment_id,
                        "wav_id": segment_id,
                        "segment_id": segment_id,
                        "session_id": row["session_id"],
                        "speaker_id": row["speaker_id"],
                        "speaker_pair": row["speaker_pair"],
                        "source_channel": row["source_channel"],
                        "text_no": row["text_no"],
                        "start_sec": row["start_sec"],
                        "end_sec": row["end_sec"],
                        "duration_sec": round(duration_seconds, 6),
                        "intensity_0_2": int(row["intensity_0_2"]),
                        "verified_level": row["verified_level"],
                        "verified_emotion": row["verified_emotion"],
                        "verified_category": row["verified_category"],
                        "audio_quality": quality,
                        "rms_dbfs": round(rms_dbfs, 6),
                        "clipping_ratio": round(clipping_ratio, 8),
                        "audio_path": str(audio_path.resolve()) if quality == "valid" else "",
                        "source_wav_path": str(wav_path.resolve()),
                    }
                )

    valid_indices = np.asarray(
        [index for index, row in enumerate(prepared) if row["audio_quality"] == "valid"],
        dtype=int,
    )
    labels = np.asarray([prepared[index]["intensity_0_2"] for index in valid_indices], dtype=int)
    groups = np.asarray([prepared[index]["speaker_pair"] for index in valid_indices])
    assignments, fold_report = _choose_group_stratified_folds(labels, groups, folds, seed)
    for index, fold in zip(valid_indices, assignments, strict=True):
        prepared[index]["split"] = "ORDINAL_CV"
        prepared[index]["cv_fold"] = int(fold)
    valid_rows = [row for row in prepared if row["audio_quality"] == "valid"]
    fields = list(valid_rows[0].keys())
    write_csv(output_manifest_path, valid_rows, fields)
    class_counts = Counter(int(row["intensity_0_2"]) for row in valid_rows)
    report = {
        "status": "ADD_DATASETS_ORDINAL_V3_READY",
        "created_at": utc_now_iso(),
        "target_definition": {"0": "low", "1": "medium", "2": "high"},
        "source_rows": len(rows),
        "valid_rows": len(valid_rows),
        "quality_excluded_rows": len(rows) - len(valid_rows),
        "quality_counts": dict(quality_counts),
        "class_counts": {str(level): int(class_counts[level]) for level in ORDINAL_LEVELS},
        "sessions": len({row["session_id"] for row in valid_rows}),
        "speakers": len({row["speaker_id"] for row in valid_rows}),
        "speaker_pairs": len({row["speaker_pair"] for row in valid_rows}),
        "audio_format": "MONO_PCM16_16000HZ",
        "filters": {
            "min_duration_seconds": min_duration_seconds,
            "min_rms_dbfs": min_rms_dbfs,
            "max_clipping_ratio": max_clipping_ratio,
        },
        "fold_assignment": fold_report,
        "input": {
            "source_manifest": str(source_manifest_path.resolve()),
            "source_manifest_sha256": sha256_file(source_manifest_path),
        },
        "outputs": {
            "segment_dir": str(segment_dir.resolve()),
            "manifest": str(output_manifest_path.resolve()),
        },
        "metadata_usage": (
            "speaker/session/pair IDs are leakage guards; demographic, region, topic, text, "
            "and device are not model inputs"
        ),
    }
    write_json(report_path, report)
    return report


def ordinal_probabilities_from_cumulative(cumulative: np.ndarray) -> np.ndarray:
    cumulative = np.asarray(cumulative, dtype=np.float64)
    if cumulative.ndim != 2 or cumulative.shape[1] != 2:
        raise ValueError("cumulative 확률 shape는 (n, 2)여야 합니다.")
    p_ge_1 = np.clip(cumulative[:, 0], 0.0, 1.0)
    p_ge_2 = np.minimum(p_ge_1, np.clip(cumulative[:, 1], 0.0, 1.0))
    probabilities = np.column_stack([1.0 - p_ge_1, p_ge_1 - p_ge_2, p_ge_2])
    probabilities = np.clip(probabilities, 0.0, 1.0)
    return probabilities / probabilities.sum(axis=1, keepdims=True)


def ordinal_classification_metrics(truth: np.ndarray, probabilities: np.ndarray) -> dict[str, Any]:
    from sklearn.metrics import (
        accuracy_score,
        balanced_accuracy_score,
        cohen_kappa_score,
        confusion_matrix,
        f1_score,
        precision_recall_fscore_support,
    )

    truth = np.asarray(truth, dtype=int)
    probabilities = np.asarray(probabilities, dtype=np.float64)
    predicted = probabilities.argmax(axis=1)
    expected = probabilities @ np.asarray(ORDINAL_LEVELS, dtype=np.float64)
    precision, recall, f1, support = precision_recall_fscore_support(
        truth,
        predicted,
        labels=ORDINAL_LEVELS,
        zero_division=0,
    )
    regression = regression_metrics(truth.astype(float), expected)
    return {
        "rows": int(len(truth)),
        "accuracy": float(accuracy_score(truth, predicted)),
        "balanced_accuracy": float(balanced_accuracy_score(truth, predicted)),
        "macro_f1": float(f1_score(truth, predicted, average="macro", zero_division=0)),
        "weighted_f1": float(f1_score(truth, predicted, average="weighted", zero_division=0)),
        "quadratic_weighted_kappa": float(cohen_kappa_score(truth, predicted, weights="quadratic")),
        "ordinal_mae_class": float(np.mean(np.abs(truth - predicted))),
        "expected_level_metrics": regression,
        "per_class": {
            str(level): {
                "name": LEVEL_NAMES[level],
                "precision": float(precision[level]),
                "recall": float(recall[level]),
                "f1": float(f1[level]),
                "support": int(support[level]),
            }
            for level in ORDINAL_LEVELS
        },
        "confusion_matrix": confusion_matrix(truth, predicted, labels=ORDINAL_LEVELS).tolist(),
    }


def _emotion_indices(rows: list[dict[str, str]]) -> tuple[np.ndarray, dict[str, int]]:
    labels = sorted({row["verified_emotion"] for row in rows})
    mapping = {label: index for index, label in enumerate(labels)}
    return np.asarray([mapping[row["verified_emotion"]] for row in rows], dtype=np.int64), mapping


def _train_neural_fold(
    train_x: np.ndarray,
    train_y: np.ndarray,
    train_emotion: np.ndarray,
    validation_x: np.ndarray,
    validation_y: np.ndarray,
    validation_emotion: np.ndarray,
    emotion_classes: int,
    auxiliary_weight: float,
    device: str,
    epochs: int,
    batch_size: int,
    learning_rate: float,
    weight_decay: float,
    seed: int,
) -> tuple[dict[str, Any], np.ndarray, list[dict[str, Any]]]:
    import torch
    import torch.nn as nn
    import torch.nn.functional as functional
    from torch.utils.data import DataLoader, TensorDataset, WeightedRandomSampler

    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if device == "cuda":
        torch.cuda.manual_seed_all(seed)

    mean = train_x.mean(axis=0, dtype=np.float64).astype(np.float32)
    std = train_x.std(axis=0, dtype=np.float64).astype(np.float32)
    std[std < 1e-5] = 1.0
    train_scaled = ((train_x - mean) / std).astype(np.float32)
    validation_scaled = ((validation_x - mean) / std).astype(np.float32)

    class OrdinalHead(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.shared = nn.Sequential(
                nn.Linear(MODEL_FEATURE_DIMENSION, 256),
                nn.LayerNorm(256),
                nn.GELU(),
                nn.Dropout(0.25),
                nn.Linear(256, 96),
                nn.GELU(),
                nn.Dropout(0.10),
            )
            self.score = nn.Linear(96, 1)
            self.threshold_base = nn.Parameter(torch.tensor(-0.5))
            self.threshold_delta = nn.Parameter(torch.tensor(0.5))
            self.emotion = nn.Linear(96, emotion_classes)

        def forward(self, values: Any) -> tuple[Any, Any]:
            hidden = self.shared(values)
            score = self.score(hidden).squeeze(-1)
            first = self.threshold_base
            second = first + functional.softplus(self.threshold_delta)
            logits = torch.stack([score - first, score - second], dim=-1)
            return logits, self.emotion(hidden)

    counts = np.bincount(train_y, minlength=3).astype(np.float64)
    sample_weights = 1.0 / np.sqrt(np.maximum(counts[train_y], 1.0))
    sampler = WeightedRandomSampler(sample_weights, len(sample_weights), replacement=True)
    dataset = TensorDataset(
        torch.from_numpy(train_scaled),
        torch.from_numpy(train_y.astype(np.int64)),
        torch.from_numpy(train_emotion.astype(np.int64)),
    )
    loader = DataLoader(dataset, batch_size=batch_size, sampler=sampler)
    model = OrdinalHead().to(device)
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=learning_rate, weight_decay=weight_decay
    )
    validation_tensor = torch.from_numpy(validation_scaled).to(device)
    best_state: dict[str, Any] | None = None
    best_score = -math.inf
    stale = 0
    history: list[dict[str, Any]] = []
    for epoch in range(epochs):
        model.train()
        losses: list[float] = []
        for values, targets, emotions in loader:
            values = values.to(device)
            targets = targets.to(device)
            emotions = emotions.to(device)
            cumulative_targets = torch.stack(
                [(targets >= 1).float(), (targets >= 2).float()], dim=-1
            )
            ordinal_logits, emotion_logits = model(values)
            ordinal_loss = functional.binary_cross_entropy_with_logits(
                ordinal_logits, cumulative_targets
            )
            emotion_loss = functional.cross_entropy(emotion_logits, emotions)
            loss = ordinal_loss + auxiliary_weight * emotion_loss
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            optimizer.step()
            losses.append(float(loss.detach().cpu()))
        model.eval()
        with torch.no_grad():
            validation_logits, validation_emotion_logits = model(validation_tensor)
            cumulative = torch.sigmoid(validation_logits).cpu().numpy()
            probabilities = ordinal_probabilities_from_cumulative(cumulative)
            validation_emotion_accuracy = float(
                (validation_emotion_logits.argmax(dim=-1).cpu().numpy() == validation_emotion).mean()
            )
        metrics = ordinal_classification_metrics(validation_y, probabilities)
        selection_score = (
            metrics["macro_f1"]
            + 0.20 * metrics["quadratic_weighted_kappa"]
            + 0.10 * metrics["per_class"]["2"]["recall"]
        )
        history.append(
            {
                "epoch": epoch + 1,
                "training_loss": float(np.mean(losses)),
                "validation_macro_f1": metrics["macro_f1"],
                "validation_qwk": metrics["quadratic_weighted_kappa"],
                "validation_high_recall": metrics["per_class"]["2"]["recall"],
                "validation_emotion_accuracy": validation_emotion_accuracy,
                "selection_score": selection_score,
            }
        )
        if selection_score > best_score + 1e-5:
            best_score = selection_score
            best_state = {
                key: value.detach().cpu().clone() for key, value in model.state_dict().items()
            }
            stale = 0
        else:
            stale += 1
            if stale >= 6:
                break
    if best_state is None:
        raise RuntimeError("ordinal neural checkpoint를 만들지 못했습니다.")
    model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad():
        logits, _ = model(validation_tensor)
        probabilities = ordinal_probabilities_from_cumulative(torch.sigmoid(logits).cpu().numpy())
    return {
        "state_dict": best_state,
        "feature_mean": mean,
        "feature_std": std,
        "emotion_classes": emotion_classes,
        "auxiliary_weight": auxiliary_weight,
    }, probabilities, history


def _predict_neural_state(state: dict[str, Any], features: np.ndarray, device: str) -> np.ndarray:
    import torch
    import torch.nn as nn
    import torch.nn.functional as functional

    class OrdinalHead(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.shared = nn.Sequential(
                nn.Linear(MODEL_FEATURE_DIMENSION, 256), nn.LayerNorm(256), nn.GELU(),
                nn.Dropout(0.25), nn.Linear(256, 96), nn.GELU(), nn.Dropout(0.10)
            )
            self.score = nn.Linear(96, 1)
            self.threshold_base = nn.Parameter(torch.tensor(-0.5))
            self.threshold_delta = nn.Parameter(torch.tensor(0.5))
            self.emotion = nn.Linear(96, int(state["emotion_classes"]))

        def forward(self, values: Any) -> Any:
            hidden = self.shared(values)
            score = self.score(hidden).squeeze(-1)
            first = self.threshold_base
            second = first + functional.softplus(self.threshold_delta)
            return torch.stack([score - first, score - second], dim=-1)

    scaled = ((features - state["feature_mean"]) / state["feature_std"]).astype(np.float32)
    model = OrdinalHead().to(device)
    model.load_state_dict(state["state_dict"])
    model.eval()
    chunks: list[np.ndarray] = []
    with torch.no_grad():
        for start in range(0, len(scaled), 2048):
            logits = model(torch.from_numpy(scaled[start : start + 2048]).to(device))
            chunks.append(torch.sigmoid(logits).cpu().numpy())
    return ordinal_probabilities_from_cumulative(np.concatenate(chunks, axis=0))


def _fit_cumulative_logistic(features: np.ndarray, labels: np.ndarray, seed: int) -> list[Any]:
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    models = []
    for threshold in (1, 2):
        target = (labels >= threshold).astype(int)
        model = make_pipeline(
            StandardScaler(),
            LogisticRegression(
                C=0.1,
                class_weight="balanced",
                max_iter=1000,
                random_state=seed + threshold,
            ),
        )
        model.fit(features, target)
        models.append(model)
    return models


def _predict_cumulative_logistic(models: list[Any], features: np.ndarray) -> np.ndarray:
    cumulative = np.column_stack([model.predict_proba(features)[:, 1] for model in models])
    return ordinal_probabilities_from_cumulative(cumulative)


def train_add_datasets_ordinal_v3(
    manifest_path: Path,
    embeddings_path: Path,
    index_path: Path,
    artifact_path: Path,
    predictions_path: Path,
    report_json_path: Path,
    report_md_path: Path,
    device: str = "auto",
    epochs: int = 30,
    batch_size: int = 256,
    learning_rate: float = 8e-4,
    weight_decay: float = 1e-3,
    seed: int = 20260717,
) -> dict[str, Any]:
    import joblib
    import torch

    resolved_device = "cuda" if device == "auto" and torch.cuda.is_available() else device
    if resolved_device == "auto":
        resolved_device = "cpu"
    if resolved_device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA가 요청됐지만 사용할 수 없습니다.")
    rows, features = _load_aligned_features(manifest_path, embeddings_path, index_path)
    valid_indices = np.asarray(
        [index for index, row in enumerate(rows) if row.get("split") == "ORDINAL_CV"], dtype=int
    )
    if not len(valid_indices):
        raise ValueError("ORDINAL_CV 행이 없습니다.")
    labels = np.asarray([int(row["intensity_0_2"]) for row in rows], dtype=int)
    emotions, emotion_mapping = _emotion_indices(rows)
    folds = sorted({int(rows[index]["cv_fold"]) for index in valid_indices})
    candidates = {
        "cumulative_logistic": np.full((len(rows), 3), np.nan, dtype=np.float64),
        "ordinal_neural": np.full((len(rows), 3), np.nan, dtype=np.float64),
        "ordinal_neural_emotion_aux": np.full((len(rows), 3), np.nan, dtype=np.float64),
    }
    fold_models: dict[str, list[Any]] = {name: [] for name in candidates}
    fold_reports: list[dict[str, Any]] = []
    for fold in folds:
        train_indices = valid_indices[
            np.asarray([int(rows[index]["cv_fold"]) != fold for index in valid_indices])
        ]
        validation_indices = valid_indices[
            np.asarray([int(rows[index]["cv_fold"]) == fold for index in valid_indices])
        ]
        train_groups = {rows[index]["speaker_pair"] for index in train_indices}
        validation_groups = {rows[index]["speaker_pair"] for index in validation_indices}
        if train_groups & validation_groups:
            raise RuntimeError(f"fold {fold} 화자쌍 누수")

        logistic = _fit_cumulative_logistic(features[train_indices], labels[train_indices], seed + fold)
        candidates["cumulative_logistic"][validation_indices] = _predict_cumulative_logistic(
            logistic, features[validation_indices]
        )
        fold_models["cumulative_logistic"].append(logistic)

        neural, neural_probabilities, neural_history = _train_neural_fold(
            features[train_indices], labels[train_indices], emotions[train_indices],
            features[validation_indices], labels[validation_indices], emotions[validation_indices],
            len(emotion_mapping), 0.0, resolved_device, epochs, batch_size,
            learning_rate, weight_decay, seed + 100 + fold,
        )
        candidates["ordinal_neural"][validation_indices] = neural_probabilities
        fold_models["ordinal_neural"].append(neural)

        auxiliary, auxiliary_probabilities, auxiliary_history = _train_neural_fold(
            features[train_indices], labels[train_indices], emotions[train_indices],
            features[validation_indices], labels[validation_indices], emotions[validation_indices],
            len(emotion_mapping), 0.10, resolved_device, epochs, batch_size,
            learning_rate, weight_decay, seed + 200 + fold,
        )
        candidates["ordinal_neural_emotion_aux"][validation_indices] = auxiliary_probabilities
        fold_models["ordinal_neural_emotion_aux"].append(auxiliary)
        fold_reports.append(
            {
                "fold": fold,
                "train_rows": int(len(train_indices)),
                "validation_rows": int(len(validation_indices)),
                "train_speaker_pairs": len(train_groups),
                "validation_speaker_pairs": len(validation_groups),
                "candidate_metrics": {
                    name: ordinal_classification_metrics(
                        labels[validation_indices], probabilities[validation_indices]
                    )
                    for name, probabilities in candidates.items()
                },
                "neural_epochs": len(neural_history),
                "auxiliary_epochs": len(auxiliary_history),
            }
        )

    candidate_metrics = {
        name: ordinal_classification_metrics(labels[valid_indices], probabilities[valid_indices])
        for name, probabilities in candidates.items()
    }
    selected_candidate = max(
        candidates,
        key=lambda name: (
            candidate_metrics[name]["macro_f1"],
            candidate_metrics[name]["quadratic_weighted_kappa"],
            candidate_metrics[name]["per_class"]["2"]["recall"],
        ),
    )
    selected = candidates[selected_candidate]
    majority_class = int(np.bincount(labels[valid_indices], minlength=3).argmax())
    majority = np.zeros((len(valid_indices), 3), dtype=np.float64)
    majority[:, majority_class] = 1.0
    majority_metrics = ordinal_classification_metrics(labels[valid_indices], majority)
    class_counts = np.bincount(labels[valid_indices], minlength=3)

    prediction_rows = []
    for index in valid_indices:
        probabilities = selected[index]
        predicted = int(np.argmax(probabilities))
        prediction_rows.append(
            {
                "segment_id": rows[index]["segment_id"],
                "session_id": rows[index]["session_id"],
                "speaker_id": rows[index]["speaker_id"],
                "speaker_pair": rows[index]["speaker_pair"],
                "cv_fold": rows[index]["cv_fold"],
                "target_level": int(labels[index]),
                "predicted_level": predicted,
                "predicted_label": LEVEL_NAMES[predicted],
                "confidence": round(float(probabilities[predicted]), 8),
                "expected_level": round(float(probabilities @ np.asarray(ORDINAL_LEVELS)), 8),
                "p0": round(float(probabilities[0]), 8),
                "p1": round(float(probabilities[1]), 8),
                "p2": round(float(probabilities[2]), 8),
                "audio_quality": rows[index]["audio_quality"],
            }
        )
    write_csv(predictions_path, prediction_rows, list(prediction_rows[0].keys()))

    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "candidate_id": "emotion_temperature_ordinal_v3",
            "selected_head": selected_candidate,
            "base_model_id": MODEL_ID,
            "levels": ORDINAL_LEVELS,
            "level_names": LEVEL_NAMES,
            "emotion_mapping": emotion_mapping,
            "fold_models": fold_models[selected_candidate],
            "group_method": "REAL_SPEAKER_PAIR",
            "inference_status": "RESEARCH_SHADOW_ONLY",
        },
        artifact_path,
    )
    selected_metrics = candidate_metrics[selected_candidate]
    gates = {
        "macro_f1_beats_majority": selected_metrics["macro_f1"] > majority_metrics["macro_f1"],
        "balanced_accuracy_minimum_0_45": selected_metrics["balanced_accuracy"] >= 0.45,
        "qwk_minimum_0_20": selected_metrics["quadratic_weighted_kappa"] >= 0.20,
        "high_recall_minimum_0_30": selected_metrics["per_class"]["2"]["recall"] >= 0.30,
    }
    report = {
        "status": "ORDINAL_V3_CROSS_VALIDATION_COMPLETE",
        "created_at": utc_now_iso(),
        "candidate_id": "emotion_temperature_ordinal_v3",
        "selected_head": selected_candidate,
        "selection_rule": "MAX_REAL_SPEAKER_PAIR_OOF_MACRO_F1_THEN_QWK_THEN_HIGH_RECALL",
        "device": resolved_device,
        "gpu_name": torch.cuda.get_device_name(0) if resolved_device == "cuda" else None,
        "target_definition": {"0": "low", "1": "medium", "2": "high"},
        "input_features": "EMOTION2VEC_768_PLUS_NATIVE_SCORES_9",
        "text_or_demographic_features_used": False,
        "data": {
            "rows": int(len(valid_indices)),
            "sessions": len({rows[index]["session_id"] for index in valid_indices}),
            "speakers": len({rows[index]["speaker_id"] for index in valid_indices}),
            "speaker_pairs": len({rows[index]["speaker_pair"] for index in valid_indices}),
            "class_counts": {str(level): int(class_counts[level]) for level in ORDINAL_LEVELS},
            "group_method": "REAL_SPEAKER_PAIR",
            "speaker_independent_within_sample": True,
        },
        "configuration": {
            "epochs_max": epochs,
            "batch_size": batch_size,
            "learning_rate": learning_rate,
            "weight_decay": weight_decay,
            "seed": seed,
            "folds": len(folds),
            "sampling": "INVERSE_SQRT_CLASS_FREQUENCY",
            "ordinal_loss": "CUMULATIVE_BINARY_CROSS_ENTROPY_WITH_ORDERED_THRESHOLDS",
        },
        "cross_validated": {
            "selected_metrics": selected_metrics,
            "candidate_metrics": candidate_metrics,
            "majority_baseline": majority_metrics,
            "fold_reports": fold_reports,
        },
        "development_gates": gates,
        "all_development_gates_pass": all(gates.values()),
        "artifact": {"path": str(artifact_path.resolve()), "sha256": sha256_file(artifact_path)},
        "outputs": {"oof_predictions": str(predictions_path.resolve())},
        "api_allowed": False,
        "api_block_reason": "NO_NEW_INDEPENDENT_CALL_CENTER_HOLDOUT",
    }
    write_json(report_json_path, report)
    lines = [
        "# emotion temperature ordinal v3 — speaker-pair CV",
        "",
        f"- 상태: `{report['status']}`",
        f"- 선택 head: `{selected_candidate}`",
        f"- GPU: `{report['gpu_name']}`",
        f"- 학습 발화: {len(valid_indices):,}",
        f"- 실제 화자/화자쌍: {report['data']['speakers']} / {report['data']['speaker_pairs']}",
        f"- OOF Macro F1: {selected_metrics['macro_f1']:.4f}",
        f"- OOF Balanced accuracy: {selected_metrics['balanced_accuracy']:.4f}",
        f"- OOF QWK: {selected_metrics['quadratic_weighted_kappa']:.4f}",
        f"- high(2) recall: {selected_metrics['per_class']['2']['recall']:.4f}",
        f"- 전체 개발 게이트 통과: `{all(gates.values())}`",
        "",
        "모델 입력은 음성 특징뿐이다. 실제 speaker_pair는 fold 누수 방지에만 사용했다.",
        "새 독립 콜센터 holdout이 없으므로 API와 운영 자동화에는 아직 사용할 수 없다.",
        "",
    ]
    report_md_path.write_text("\n".join(lines), encoding="utf-8")
    return report


def _fit_lgbm_cumulative(
    features: np.ndarray,
    labels: np.ndarray,
    seed: int,
    sample_weight: np.ndarray | None = None,
) -> list[Any]:
    from lightgbm import LGBMClassifier

    models: list[Any] = []
    for threshold in (1, 2):
        target = (labels >= threshold).astype(int)
        positives = max(1, int(target.sum()))
        negatives = max(1, int(len(target) - positives))
        model = LGBMClassifier(
            objective="binary",
            n_estimators=400,
            learning_rate=0.03,
            num_leaves=31,
            max_depth=-1,
            min_child_samples=40,
            subsample=0.85,
            colsample_bytree=0.75,
            reg_alpha=1.0,
            reg_lambda=5.0,
            scale_pos_weight=math.sqrt(negatives / positives),
            random_state=seed + threshold,
            n_jobs=-1,
            verbosity=-1,
        )
        model.fit(features, target, sample_weight=sample_weight)
        models.append(model)
    return models


def _predict_lgbm_cumulative(models: list[Any], features: np.ndarray) -> np.ndarray:
    cumulative = np.column_stack([model.predict_proba(features)[:, 1] for model in models])
    return ordinal_probabilities_from_cumulative(cumulative)


def train_ordinal_fusion_v3(
    manifest_path: Path,
    emotion_embeddings_path: Path,
    emotion_index_path: Path,
    egemaps_features_path: Path,
    egemaps_index_path: Path,
    existing_oof_path: Path,
    artifact_path: Path,
    predictions_path: Path,
    report_json_path: Path,
    report_md_path: Path,
    seed: int = 20260717,
) -> dict[str, Any]:
    import joblib

    from .prosody_fusion import _load_egemaps_aligned

    rows, emotion_features = _load_aligned_features(
        manifest_path, emotion_embeddings_path, emotion_index_path
    )
    egemaps_features = _load_egemaps_aligned(rows, egemaps_features_path, egemaps_index_path)
    labels = np.asarray([int(row["intensity_0_2"]) for row in rows], dtype=int)
    valid_indices = np.asarray(
        [index for index, row in enumerate(rows) if row.get("split") == "ORDINAL_CV"], dtype=int
    )
    folds = sorted({int(rows[index]["cv_fold"]) for index in valid_indices})
    existing_by_key = {row["segment_id"]: row for row in read_csv(existing_oof_path)}
    candidate_probabilities = {
        "emotion2vec_ordinal_neural_aux": np.asarray(
            [
                [
                    float(existing_by_key[rows[index]["segment_id"]]["p0"]),
                    float(existing_by_key[rows[index]["segment_id"]]["p1"]),
                    float(existing_by_key[rows[index]["segment_id"]]["p2"]),
                ]
                for index in valid_indices
            ],
            dtype=np.float64,
        ),
        "emotion2vec_cumulative_lgbm": np.full((len(valid_indices), 3), np.nan),
        "egemaps_cumulative_lgbm": np.full((len(valid_indices), 3), np.nan),
        "emotion2vec_egemaps_cumulative_lgbm": np.full((len(valid_indices), 3), np.nan),
    }
    features_by_candidate = {
        "emotion2vec_cumulative_lgbm": emotion_features,
        "egemaps_cumulative_lgbm": egemaps_features,
        "emotion2vec_egemaps_cumulative_lgbm": np.concatenate(
            [emotion_features, egemaps_features], axis=1
        ),
    }
    position_by_index = {row_index: position for position, row_index in enumerate(valid_indices)}
    fold_models: dict[str, list[Any]] = {candidate: [] for candidate in features_by_candidate}
    fold_reports: list[dict[str, Any]] = []
    for fold in folds:
        train_indices = valid_indices[
            np.asarray([int(rows[index]["cv_fold"]) != fold for index in valid_indices])
        ]
        validation_indices = valid_indices[
            np.asarray([int(rows[index]["cv_fold"]) == fold for index in valid_indices])
        ]
        validation_positions = np.asarray([position_by_index[index] for index in validation_indices])
        train_groups = {rows[index]["speaker_pair"] for index in train_indices}
        validation_groups = {rows[index]["speaker_pair"] for index in validation_indices}
        if train_groups & validation_groups:
            raise RuntimeError(f"fold {fold} fusion 화자쌍 누수")
        candidate_fold_metrics: dict[str, Any] = {}
        for candidate, features in features_by_candidate.items():
            models = _fit_lgbm_cumulative(
                features[train_indices], labels[train_indices], seed + 100 * fold
            )
            probabilities = _predict_lgbm_cumulative(models, features[validation_indices])
            candidate_probabilities[candidate][validation_positions] = probabilities
            fold_models[candidate].append(models)
            candidate_fold_metrics[candidate] = ordinal_classification_metrics(
                labels[validation_indices], probabilities
            )
        baseline_probabilities = candidate_probabilities["emotion2vec_ordinal_neural_aux"][
            validation_positions
        ]
        candidate_fold_metrics["emotion2vec_ordinal_neural_aux"] = ordinal_classification_metrics(
            labels[validation_indices], baseline_probabilities
        )
        fold_reports.append(
            {
                "fold": fold,
                "train_rows": int(len(train_indices)),
                "validation_rows": int(len(validation_indices)),
                "train_speaker_pairs": len(train_groups),
                "validation_speaker_pairs": len(validation_groups),
                "candidate_metrics": candidate_fold_metrics,
            }
        )

    for candidate, probabilities in candidate_probabilities.items():
        if not np.isfinite(probabilities).all():
            raise RuntimeError(f"{candidate} OOF 확률에 결측이 있습니다.")
    truth = labels[valid_indices]
    candidate_metrics = {
        candidate: ordinal_classification_metrics(truth, probabilities)
        for candidate, probabilities in candidate_probabilities.items()
    }
    selected_candidate = max(
        candidate_probabilities,
        key=lambda name: (
            candidate_metrics[name]["macro_f1"],
            candidate_metrics[name]["quadratic_weighted_kappa"],
            candidate_metrics[name]["per_class"]["2"]["recall"],
        ),
    )
    selected_probabilities = candidate_probabilities[selected_candidate]
    prediction_rows = []
    for position, row_index in enumerate(valid_indices):
        probabilities = selected_probabilities[position]
        predicted = int(np.argmax(probabilities))
        prediction_rows.append(
            {
                "segment_id": rows[row_index]["segment_id"],
                "session_id": rows[row_index]["session_id"],
                "speaker_id": rows[row_index]["speaker_id"],
                "speaker_pair": rows[row_index]["speaker_pair"],
                "cv_fold": rows[row_index]["cv_fold"],
                "target_level": int(truth[position]),
                "predicted_level": predicted,
                "predicted_label": LEVEL_NAMES[predicted],
                "confidence": round(float(probabilities[predicted]), 8),
                "expected_level": round(float(probabilities @ np.asarray(ORDINAL_LEVELS)), 8),
                "p0": round(float(probabilities[0]), 8),
                "p1": round(float(probabilities[1]), 8),
                "p2": round(float(probabilities[2]), 8),
                "selected_candidate": selected_candidate,
            }
        )
    write_csv(predictions_path, prediction_rows, list(prediction_rows[0].keys()))

    selected_models = fold_models.get(selected_candidate)
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "candidate_id": "emotion_temperature_ordinal_fusion_v3",
            "selected_head": selected_candidate,
            "base_model_id": MODEL_ID,
            "levels": ORDINAL_LEVELS,
            "level_names": LEVEL_NAMES,
            "fold_models": selected_models,
            "feature_order": selected_candidate,
            "fallback_artifact": (
                "emotion_temperature_ordinal_v3.joblib" if selected_models is None else None
            ),
            "group_method": "REAL_SPEAKER_PAIR",
            "inference_status": "RESEARCH_SHADOW_ONLY",
        },
        artifact_path,
    )
    selected_metrics = candidate_metrics[selected_candidate]
    gates = {
        "macro_f1_minimum_0_45": selected_metrics["macro_f1"] >= 0.45,
        "balanced_accuracy_minimum_0_45": selected_metrics["balanced_accuracy"] >= 0.45,
        "qwk_minimum_0_20": selected_metrics["quadratic_weighted_kappa"] >= 0.20,
        "high_recall_minimum_0_30": selected_metrics["per_class"]["2"]["recall"] >= 0.30,
    }
    report = {
        "status": "ORDINAL_FUSION_V3_CROSS_VALIDATION_COMPLETE",
        "created_at": utc_now_iso(),
        "candidate_id": "emotion_temperature_ordinal_fusion_v3",
        "selected_head": selected_candidate,
        "selection_rule": "MAX_REAL_SPEAKER_PAIR_OOF_MACRO_F1_THEN_QWK_THEN_HIGH_RECALL",
        "target_definition": {"0": "low", "1": "medium", "2": "high"},
        "model_inputs": {
            "audio_only": True,
            "emotion2vec_features": 777,
            "egemaps_features": 88,
            "text_demographic_topic_used": False,
        },
        "data": {
            "rows": int(len(valid_indices)),
            "sessions": len({rows[index]["session_id"] for index in valid_indices}),
            "speakers": len({rows[index]["speaker_id"] for index in valid_indices}),
            "speaker_pairs": len({rows[index]["speaker_pair"] for index in valid_indices}),
            "group_method": "REAL_SPEAKER_PAIR",
        },
        "cross_validated": {
            "selected_metrics": selected_metrics,
            "candidate_metrics": candidate_metrics,
            "fold_reports": fold_reports,
        },
        "development_gates": gates,
        "all_development_gates_pass": all(gates.values()),
        "artifact": {"path": str(artifact_path.resolve()), "sha256": sha256_file(artifact_path)},
        "outputs": {"oof_predictions": str(predictions_path.resolve())},
        "api_allowed": False,
        "api_block_reason": "NO_NEW_INDEPENDENT_CALL_CENTER_HOLDOUT",
    }
    write_json(report_json_path, report)
    lines = [
        "# emotion temperature ordinal fusion v3",
        "",
        f"- 상태: `{report['status']}`",
        f"- 선택 head: `{selected_candidate}`",
        f"- 실제 화자쌍 OOF Macro F1: {selected_metrics['macro_f1']:.4f}",
        f"- Balanced accuracy: {selected_metrics['balanced_accuracy']:.4f}",
        f"- QWK: {selected_metrics['quadratic_weighted_kappa']:.4f}",
        f"- high(2) precision/recall: {selected_metrics['per_class']['2']['precision']:.4f} / {selected_metrics['per_class']['2']['recall']:.4f}",
        f"- 전체 개발 게이트 통과: `{all(gates.values())}`",
        "",
        "입력은 emotion2vec과 eGeMAPS 음성 특징뿐이며 텍스트·성별·나이·지역·주제는 사용하지 않았다.",
        "실제 콜센터 독립 holdout 전까지 연구용 shadow 후보로만 유지한다.",
        "",
    ]
    report_md_path.write_text("\n".join(lines), encoding="utf-8")
    return report


def evaluate_ordinal_external_v3(
    external_manifest_path: Path,
    external_egemaps_path: Path,
    external_egemaps_index_path: Path,
    artifact_path: Path,
    predictions_path: Path,
    report_json_path: Path,
    report_md_path: Path,
) -> dict[str, Any]:
    import joblib

    from .prosody_fusion import _load_egemaps_aligned

    rows = read_csv(external_manifest_path)
    features = _load_egemaps_aligned(rows, external_egemaps_path, external_egemaps_index_path)
    artifact = joblib.load(artifact_path)
    if artifact.get("selected_head") != "egemaps_cumulative_lgbm":
        raise ValueError("외부 평가는 eGeMAPS 선택 artifact만 지원합니다.")
    fold_models = artifact.get("fold_models")
    if not fold_models:
        raise ValueError("artifact에 fold_models가 없습니다.")
    probabilities = np.mean(
        np.stack([_predict_lgbm_cumulative(models, features) for models in fold_models], axis=0),
        axis=0,
    )
    vote_distributions = np.asarray(
        [
            [float(row["intensity_p0"]), float(row["intensity_p1"]), float(row["intensity_p2"])]
            for row in rows
        ],
        dtype=np.float64,
    )
    labels = np.where(
        vote_distributions[:, 0] >= 0.6,
        0,
        np.where(vote_distributions[:, 0] + vote_distributions[:, 1] >= 0.6, 1, 2),
    ).astype(int)
    metrics = ordinal_classification_metrics(labels, probabilities)
    output_rows = []
    for index, row in enumerate(rows):
        predicted = int(np.argmax(probabilities[index]))
        output_rows.append(
            {
                "embedding_key": row["embedding_key"],
                "wav_id": row["wav_id"],
                "target_median_level": int(labels[index]),
                "predicted_level": predicted,
                "predicted_label": LEVEL_NAMES[predicted],
                "confidence": round(float(probabilities[index, predicted]), 8),
                "p0": round(float(probabilities[index, 0]), 8),
                "p1": round(float(probabilities[index, 1]), 8),
                "p2": round(float(probabilities[index, 2]), 8),
            }
        )
    write_csv(predictions_path, output_rows, list(output_rows[0].keys()))
    report = {
        "status": "ORDINAL_V3_EXTERNAL_DATASET_EVALUATION_COMPLETE",
        "created_at": utc_now_iso(),
        "target_definition": "MEDIAN_OF_FIVE_ORDINAL_INTENSITY_VOTES",
        "model_trained_on_external_rows": False,
        "rows": len(rows),
        "metrics": metrics,
        "interpretation": (
            "Cross-dataset directional evidence only; original dataset lacks verified speaker IDs "
            "and label protocol differs from add_datasets VerifyEmotionLevel."
        ),
        "inputs": {
            "external_manifest": str(external_manifest_path.resolve()),
            "artifact": str(artifact_path.resolve()),
        },
        "outputs": {"predictions": str(predictions_path.resolve())},
    }
    write_json(report_json_path, report)
    lines = [
        "# ordinal v3 external dataset evaluation",
        "",
        f"- 외부 발화: {len(rows):,}",
        f"- Macro F1: {metrics['macro_f1']:.4f}",
        f"- Balanced accuracy: {metrics['balanced_accuracy']:.4f}",
        f"- QWK: {metrics['quadratic_weighted_kappa']:.4f}",
        f"- high recall: {metrics['per_class']['2']['recall']:.4f}",
        "",
        "이 평가는 add_datasets 학습에 포함되지 않은 기존 5인 강도 데이터에 대한 교차 데이터셋 검증이다. "
        "다만 기존 데이터에는 실제 화자 ID가 없고 라벨 프로토콜도 달라 운영 성능으로 해석하지 않는다.",
        "",
    ]
    report_md_path.write_text("\n".join(lines), encoding="utf-8")
    return report


def prepare_ordinal_telephone_v3(
    manifest_path: Path,
    output_audio_dir: Path,
    output_manifest_path: Path,
    report_path: Path,
) -> dict[str, Any]:
    from .audio import read_pcm_wav, telephony_8k_mulaw_up16k, write_pcm16_wav

    rows = read_csv(manifest_path)
    output_audio_dir.mkdir(parents=True, exist_ok=True)
    output_rows: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for row in rows:
        try:
            samples, sample_rate = read_pcm_wav(Path(row["audio_path"]))
            if sample_rate != 16000:
                raise ValueError(f"예상하지 못한 sample rate: {sample_rate}")
            transformed, method = telephony_8k_mulaw_up16k(samples)
            output_path = output_audio_dir / f"{row['segment_id']}__telephone.wav"
            if not output_path.exists():
                write_pcm16_wav(output_path, transformed, 16000)
            output_rows.append(
                {
                    **row,
                    "embedding_key": f"{row['segment_id']}|TELEPHONY_8K_MULAW_UP16K",
                    "wav_id": f"{row['segment_id']}|TELEPHONY_8K_MULAW_UP16K",
                    "audio_path": str(output_path.resolve()),
                    "variant": "TELEPHONY_8K_MULAW_UP16K",
                    "transform": method,
                }
            )
        except Exception as exc:
            errors.append({"segment_id": row["segment_id"], "error": repr(exc)})
    if errors:
        raise RuntimeError(f"전화 열화 생성 오류 {len(errors)}개: {errors[:3]}")
    write_csv(output_manifest_path, output_rows, list(output_rows[0].keys()))
    report = {
        "status": "ORDINAL_V3_TELEPHONE_VARIANTS_READY",
        "created_at": utc_now_iso(),
        "rows": len(output_rows),
        "errors": errors,
        "variant": "TELEPHONY_8K_MULAW_UP16K",
        "limitations": (
            "Deterministic 8 kHz mu-law-like roundtrip; packet loss and live network effects are not simulated."
        ),
        "outputs": {
            "audio_dir": str(output_audio_dir.resolve()),
            "manifest": str(output_manifest_path.resolve()),
        },
    }
    write_json(report_path, report)
    return report


def evaluate_ordinal_telephone_v3(
    clean_manifest_path: Path,
    telephone_manifest_path: Path,
    telephone_egemaps_path: Path,
    telephone_egemaps_index_path: Path,
    clean_oof_path: Path,
    artifact_path: Path,
    predictions_path: Path,
    report_json_path: Path,
    report_md_path: Path,
) -> dict[str, Any]:
    import joblib

    from .prosody_fusion import _load_egemaps_aligned

    clean_rows = read_csv(clean_manifest_path)
    telephone_rows = read_csv(telephone_manifest_path)
    if [row["segment_id"] for row in clean_rows] != [row["segment_id"] for row in telephone_rows]:
        raise ValueError("clean/telephone manifest 행 정렬이 다릅니다.")
    telephone_features = _load_egemaps_aligned(
        telephone_rows, telephone_egemaps_path, telephone_egemaps_index_path
    )
    artifact = joblib.load(artifact_path)
    if artifact.get("selected_head") != "egemaps_cumulative_lgbm":
        raise ValueError("전화 평가는 eGeMAPS 선택 artifact만 지원합니다.")
    fold_models = artifact["fold_models"]
    telephone_probabilities = np.full((len(clean_rows), 3), np.nan)
    fold_values = np.asarray([int(row["cv_fold"]) for row in clean_rows], dtype=int)
    for fold, models in enumerate(fold_models):
        fold_indices = np.where(fold_values == fold)[0]
        telephone_probabilities[fold_indices] = _predict_lgbm_cumulative(
            models, telephone_features[fold_indices]
        )
    clean_by_key = {row["segment_id"]: row for row in read_csv(clean_oof_path)}
    clean_probabilities = np.asarray(
        [
            [
                float(clean_by_key[row["segment_id"]]["p0"]),
                float(clean_by_key[row["segment_id"]]["p1"]),
                float(clean_by_key[row["segment_id"]]["p2"]),
            ]
            for row in clean_rows
        ],
        dtype=np.float64,
    )
    labels = np.asarray([int(row["intensity_0_2"]) for row in clean_rows], dtype=int)
    clean_metrics = ordinal_classification_metrics(labels, clean_probabilities)
    telephone_metrics = ordinal_classification_metrics(labels, telephone_probabilities)
    clean_classes = clean_probabilities.argmax(axis=1)
    telephone_classes = telephone_probabilities.argmax(axis=1)
    mean_probability_shift = float(np.mean(np.abs(clean_probabilities - telephone_probabilities)))
    class_flip_rate = float(np.mean(clean_classes != telephone_classes))
    macro_f1_drop = clean_metrics["macro_f1"] - telephone_metrics["macro_f1"]
    qwk_drop = clean_metrics["quadratic_weighted_kappa"] - telephone_metrics[
        "quadratic_weighted_kappa"
    ]
    high_recall_drop = (
        clean_metrics["per_class"]["2"]["recall"]
        - telephone_metrics["per_class"]["2"]["recall"]
    )
    output_rows = []
    for index, row in enumerate(clean_rows):
        output_rows.append(
            {
                "segment_id": row["segment_id"],
                "cv_fold": row["cv_fold"],
                "target_level": int(labels[index]),
                "clean_level": int(clean_classes[index]),
                "telephone_level": int(telephone_classes[index]),
                "class_changed": bool(clean_classes[index] != telephone_classes[index]),
                "telephone_confidence": round(
                    float(telephone_probabilities[index, telephone_classes[index]]), 8
                ),
                "telephone_p0": round(float(telephone_probabilities[index, 0]), 8),
                "telephone_p1": round(float(telephone_probabilities[index, 1]), 8),
                "telephone_p2": round(float(telephone_probabilities[index, 2]), 8),
            }
        )
    write_csv(predictions_path, output_rows, list(output_rows[0].keys()))
    gates = {
        "macro_f1_drop_maximum_0_10": macro_f1_drop <= 0.10,
        "qwk_drop_maximum_0_10": qwk_drop <= 0.10,
        "high_recall_drop_maximum_0_15": high_recall_drop <= 0.15,
        "mean_probability_shift_maximum_0_10": mean_probability_shift <= 0.10,
    }
    report = {
        "status": "ORDINAL_V3_TELEPHONE_ROBUSTNESS_COMPLETE",
        "created_at": utc_now_iso(),
        "rows": len(clean_rows),
        "clean_metrics": clean_metrics,
        "telephone_metrics": telephone_metrics,
        "robustness": {
            "macro_f1_drop": macro_f1_drop,
            "qwk_drop": qwk_drop,
            "high_recall_drop": high_recall_drop,
            "mean_absolute_probability_shift": mean_probability_shift,
            "class_flip_rate": class_flip_rate,
        },
        "gates": gates,
        "all_gates_pass": all(gates.values()),
        "limitations": (
            "Synthetic deterministic telephony degradation; not a substitute for real call-center audio."
        ),
        "outputs": {"predictions": str(predictions_path.resolve())},
    }
    write_json(report_json_path, report)
    lines = [
        "# ordinal v3 telephone robustness",
        "",
        f"- clean Macro F1: {clean_metrics['macro_f1']:.4f}",
        f"- telephone Macro F1: {telephone_metrics['macro_f1']:.4f}",
        f"- Macro F1 drop: {macro_f1_drop:.4f}",
        f"- clean/telephone class flip rate: {class_flip_rate:.4f}",
        f"- mean probability shift: {mean_probability_shift:.4f}",
        f"- robustness gates pass: `{all(gates.values())}`",
        "",
        "8 kHz mu-law 유사 열화 실험이며 실제 통신망·패킷 손실을 대체하지 않는다.",
        "",
    ]
    report_md_path.write_text("\n".join(lines), encoding="utf-8")
    return report


def train_ordinal_telephony_augmented_v3(
    clean_manifest_path: Path,
    clean_egemaps_path: Path,
    clean_egemaps_index_path: Path,
    telephone_manifest_path: Path,
    telephone_egemaps_path: Path,
    telephone_egemaps_index_path: Path,
    artifact_path: Path,
    predictions_path: Path,
    report_json_path: Path,
    report_md_path: Path,
    seed: int = 20260717,
) -> dict[str, Any]:
    import joblib

    from .prosody_fusion import _load_egemaps_aligned

    clean_rows = read_csv(clean_manifest_path)
    telephone_rows = read_csv(telephone_manifest_path)
    if [row["segment_id"] for row in clean_rows] != [row["segment_id"] for row in telephone_rows]:
        raise ValueError("clean/telephone manifest 행 정렬이 다릅니다.")
    clean_features = _load_egemaps_aligned(
        clean_rows, clean_egemaps_path, clean_egemaps_index_path
    )
    telephone_features = _load_egemaps_aligned(
        telephone_rows, telephone_egemaps_path, telephone_egemaps_index_path
    )
    labels = np.asarray([int(row["intensity_0_2"]) for row in clean_rows], dtype=int)
    fold_values = np.asarray([int(row["cv_fold"]) for row in clean_rows], dtype=int)
    folds = sorted(np.unique(fold_values).tolist())
    clean_probabilities = np.full((len(clean_rows), 3), np.nan)
    telephone_probabilities = np.full((len(clean_rows), 3), np.nan)
    fold_models: list[Any] = []
    fold_reports: list[dict[str, Any]] = []
    for fold in folds:
        train_indices = np.where(fold_values != fold)[0]
        validation_indices = np.where(fold_values == fold)[0]
        train_groups = {clean_rows[index]["speaker_pair"] for index in train_indices}
        validation_groups = {clean_rows[index]["speaker_pair"] for index in validation_indices}
        if train_groups & validation_groups:
            raise RuntimeError(f"fold {fold} telephony augmentation 화자쌍 누수")
        augmented_features = np.concatenate(
            [clean_features[train_indices], telephone_features[train_indices]], axis=0
        )
        augmented_labels = np.concatenate([labels[train_indices], labels[train_indices]], axis=0)
        models = _fit_lgbm_cumulative(augmented_features, augmented_labels, seed + 100 * fold)
        clean_probabilities[validation_indices] = _predict_lgbm_cumulative(
            models, clean_features[validation_indices]
        )
        telephone_probabilities[validation_indices] = _predict_lgbm_cumulative(
            models, telephone_features[validation_indices]
        )
        fold_models.append(models)
        fold_reports.append(
            {
                "fold": fold,
                "train_rows_with_variants": int(len(augmented_labels)),
                "validation_rows": int(len(validation_indices)),
                "clean_metrics": ordinal_classification_metrics(
                    labels[validation_indices], clean_probabilities[validation_indices]
                ),
                "telephone_metrics": ordinal_classification_metrics(
                    labels[validation_indices], telephone_probabilities[validation_indices]
                ),
            }
        )
    if not np.isfinite(clean_probabilities).all() or not np.isfinite(telephone_probabilities).all():
        raise RuntimeError("telephony augmented OOF 확률에 결측이 있습니다.")
    clean_metrics = ordinal_classification_metrics(labels, clean_probabilities)
    telephone_metrics = ordinal_classification_metrics(labels, telephone_probabilities)
    clean_classes = clean_probabilities.argmax(axis=1)
    telephone_classes = telephone_probabilities.argmax(axis=1)
    robustness = {
        "macro_f1_drop": clean_metrics["macro_f1"] - telephone_metrics["macro_f1"],
        "qwk_drop": clean_metrics["quadratic_weighted_kappa"]
        - telephone_metrics["quadratic_weighted_kappa"],
        "high_recall_drop": clean_metrics["per_class"]["2"]["recall"]
        - telephone_metrics["per_class"]["2"]["recall"],
        "mean_absolute_probability_shift": float(
            np.mean(np.abs(clean_probabilities - telephone_probabilities))
        ),
        "class_flip_rate": float(np.mean(clean_classes != telephone_classes)),
    }
    output_rows = []
    for index, row in enumerate(clean_rows):
        clean_level = int(clean_classes[index])
        telephone_level = int(telephone_classes[index])
        output_rows.append(
            {
                "segment_id": row["segment_id"],
                "speaker_pair": row["speaker_pair"],
                "cv_fold": row["cv_fold"],
                "target_level": int(labels[index]),
                "clean_level": clean_level,
                "clean_confidence": round(float(clean_probabilities[index, clean_level]), 8),
                "telephone_level": telephone_level,
                "telephone_confidence": round(
                    float(telephone_probabilities[index, telephone_level]), 8
                ),
                "class_changed": bool(clean_level != telephone_level),
                "clean_p0": round(float(clean_probabilities[index, 0]), 8),
                "clean_p1": round(float(clean_probabilities[index, 1]), 8),
                "clean_p2": round(float(clean_probabilities[index, 2]), 8),
                "telephone_p0": round(float(telephone_probabilities[index, 0]), 8),
                "telephone_p1": round(float(telephone_probabilities[index, 1]), 8),
                "telephone_p2": round(float(telephone_probabilities[index, 2]), 8),
            }
        )
    write_csv(predictions_path, output_rows, list(output_rows[0].keys()))
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "candidate_id": "emotion_temperature_ordinal_telephony_augmented_v3",
            "selected_head": "egemaps_cumulative_lgbm_clean_telephone_augmented",
            "levels": ORDINAL_LEVELS,
            "level_names": LEVEL_NAMES,
            "fold_models": fold_models,
            "feature_order": "EGEMAPS_88",
            "training_variants": ["CLEAN_16K", "TELEPHONY_8K_MULAW_UP16K"],
            "group_method": "REAL_SPEAKER_PAIR",
            "inference_status": "RESEARCH_SHADOW_ONLY",
        },
        artifact_path,
    )
    gates = {
        "clean_macro_f1_minimum_0_45": clean_metrics["macro_f1"] >= 0.45,
        "clean_qwk_minimum_0_20": clean_metrics["quadratic_weighted_kappa"] >= 0.20,
        "telephone_macro_f1_minimum_0_45": telephone_metrics["macro_f1"] >= 0.45,
        "telephone_qwk_minimum_0_15": telephone_metrics["quadratic_weighted_kappa"] >= 0.15,
        "telephone_high_recall_minimum_0_30": telephone_metrics["per_class"]["2"]["recall"]
        >= 0.30,
        "macro_f1_drop_maximum_0_10": robustness["macro_f1_drop"] <= 0.10,
    }
    report = {
        "status": "ORDINAL_V3_TELEPHONY_AUGMENTED_CV_COMPLETE",
        "created_at": utc_now_iso(),
        "candidate_id": "emotion_temperature_ordinal_telephony_augmented_v3",
        "clean_metrics": clean_metrics,
        "telephone_metrics": telephone_metrics,
        "robustness": robustness,
        "fold_reports": fold_reports,
        "gates": gates,
        "all_gates_pass": all(gates.values()),
        "artifact": {"path": str(artifact_path.resolve()), "sha256": sha256_file(artifact_path)},
        "outputs": {"oof_predictions": str(predictions_path.resolve())},
        "api_allowed": False,
        "api_block_reason": "CROSS_DATASET_GENERALIZATION_FAILED_AND_NO_REAL_CALL_HOLDOUT",
    }
    write_json(report_json_path, report)
    lines = [
        "# ordinal v3 telephony-augmented model",
        "",
        f"- clean Macro F1 / QWK: {clean_metrics['macro_f1']:.4f} / {clean_metrics['quadratic_weighted_kappa']:.4f}",
        f"- telephone Macro F1 / QWK: {telephone_metrics['macro_f1']:.4f} / {telephone_metrics['quadratic_weighted_kappa']:.4f}",
        f"- telephone high precision/recall: {telephone_metrics['per_class']['2']['precision']:.4f} / {telephone_metrics['per_class']['2']['recall']:.4f}",
        f"- class flip rate: {robustness['class_flip_rate']:.4f}",
        f"- gates pass: `{all(gates.values())}`",
        "",
        "각 fold의 학습 화자쌍에만 clean/telephone 쌍을 추가했고 검증 화자쌍은 두 variant 모두 제외했다.",
        "외부 데이터셋 일반화 실패와 실제 콜 holdout 부재 때문에 아직 운영 모델은 아니다.",
        "",
    ]
    report_md_path.write_text("\n".join(lines), encoding="utf-8")
    return report


def _five_vote_median_labels(rows: list[dict[str, str]]) -> np.ndarray:
    distributions = np.asarray(
        [
            [float(row["intensity_p0"]), float(row["intensity_p1"]), float(row["intensity_p2"])]
            for row in rows
        ],
        dtype=np.float64,
    )
    return np.where(
        distributions[:, 0] >= 0.6,
        0,
        np.where(distributions[:, 0] + distributions[:, 1] >= 0.6, 1, 2),
    ).astype(int)


def train_ordinal_cross_domain_v3(
    add_manifest_path: Path,
    add_clean_egemaps_path: Path,
    add_clean_egemaps_index_path: Path,
    add_telephone_manifest_path: Path,
    add_telephone_egemaps_path: Path,
    add_telephone_egemaps_index_path: Path,
    legacy_manifest_path: Path,
    legacy_egemaps_path: Path,
    legacy_egemaps_index_path: Path,
    artifact_path: Path,
    predictions_path: Path,
    report_json_path: Path,
    report_md_path: Path,
    seed: int = 20260717,
) -> dict[str, Any]:
    import joblib

    from .prosody_fusion import _load_egemaps_aligned

    add_rows = read_csv(add_manifest_path)
    add_telephone_rows = read_csv(add_telephone_manifest_path)
    if [row["segment_id"] for row in add_rows] != [row["segment_id"] for row in add_telephone_rows]:
        raise ValueError("add clean/telephone manifest 행 정렬이 다릅니다.")
    add_clean = _load_egemaps_aligned(
        add_rows, add_clean_egemaps_path, add_clean_egemaps_index_path
    )
    add_telephone = _load_egemaps_aligned(
        add_telephone_rows, add_telephone_egemaps_path, add_telephone_egemaps_index_path
    )
    add_labels = np.asarray([int(row["intensity_0_2"]) for row in add_rows], dtype=int)
    add_folds = np.asarray([int(row["cv_fold"]) for row in add_rows], dtype=int)

    legacy_rows, _ = _load_aligned_features(
        legacy_manifest_path,
        legacy_egemaps_path,
        legacy_egemaps_index_path,
    )
    legacy_features = _load_egemaps_aligned(
        legacy_rows, legacy_egemaps_path, legacy_egemaps_index_path
    )
    legacy_labels = _five_vote_median_labels(legacy_rows)
    legacy_train_indices = np.asarray(
        [index for index, row in enumerate(legacy_rows) if row.get("split") == "AUX_TRAIN"],
        dtype=int,
    )
    package_indices = np.asarray(
        [index for index, row in enumerate(legacy_rows) if row.get("split") == "PACKAGE_EVAL"],
        dtype=int,
    )
    if not len(legacy_train_indices) or not len(package_indices):
        raise ValueError("legacy AUX_TRAIN 또는 PACKAGE_EVAL 행이 없습니다.")
    legacy_fold_values = np.full(len(legacy_rows), -1, dtype=int)
    for index in legacy_train_indices:
        legacy_fold_values[index] = int(legacy_rows[index]["cv_fold"])
    folds = sorted(np.unique(add_folds).tolist())
    add_clean_oof = np.full((len(add_rows), 3), np.nan)
    add_telephone_oof = np.full((len(add_rows), 3), np.nan)
    legacy_oof = np.full((len(legacy_rows), 3), np.nan)
    package_fold_predictions: list[np.ndarray] = []
    fold_models: list[Any] = []
    fold_reports: list[dict[str, Any]] = []
    for fold in folds:
        add_train = np.where(add_folds != fold)[0]
        add_validation = np.where(add_folds == fold)[0]
        legacy_train = legacy_train_indices[legacy_fold_values[legacy_train_indices] != fold]
        legacy_validation = legacy_train_indices[legacy_fold_values[legacy_train_indices] == fold]
        add_groups_train = {add_rows[index]["speaker_pair"] for index in add_train}
        add_groups_validation = {add_rows[index]["speaker_pair"] for index in add_validation}
        if add_groups_train & add_groups_validation:
            raise RuntimeError(f"fold {fold} cross-domain add 화자쌍 누수")
        legacy_groups_train = {legacy_rows[index]["proxy_group"] for index in legacy_train}
        legacy_groups_validation = {legacy_rows[index]["proxy_group"] for index in legacy_validation}
        if legacy_groups_train & legacy_groups_validation:
            raise RuntimeError(f"fold {fold} cross-domain legacy proxy 누수")

        training_features = np.concatenate(
            [add_clean[add_train], add_telephone[add_train], legacy_features[legacy_train]],
            axis=0,
        )
        training_labels = np.concatenate(
            [add_labels[add_train], add_labels[add_train], legacy_labels[legacy_train]],
            axis=0,
        )
        # Give the add_datasets domain and legacy domain equal total weight; split the
        # add domain weight equally between clean and telephone variants.
        add_variant_weight = 0.5 / max(1, len(add_train))
        legacy_weight = 1.0 / max(1, len(legacy_train))
        sample_weight = np.concatenate(
            [
                np.full(len(add_train), add_variant_weight),
                np.full(len(add_train), add_variant_weight),
                np.full(len(legacy_train), legacy_weight),
            ]
        )
        sample_weight *= len(sample_weight) / sample_weight.sum()
        models = _fit_lgbm_cumulative(
            training_features, training_labels, seed + 100 * fold, sample_weight=sample_weight
        )
        add_clean_oof[add_validation] = _predict_lgbm_cumulative(
            models, add_clean[add_validation]
        )
        add_telephone_oof[add_validation] = _predict_lgbm_cumulative(
            models, add_telephone[add_validation]
        )
        legacy_oof[legacy_validation] = _predict_lgbm_cumulative(
            models, legacy_features[legacy_validation]
        )
        package_fold_predictions.append(
            _predict_lgbm_cumulative(models, legacy_features[package_indices])
        )
        fold_models.append(models)
        fold_reports.append(
            {
                "fold": fold,
                "training_rows": int(len(training_labels)),
                "add_validation_rows": int(len(add_validation)),
                "legacy_validation_rows": int(len(legacy_validation)),
                "add_clean_metrics": ordinal_classification_metrics(
                    add_labels[add_validation], add_clean_oof[add_validation]
                ),
                "add_telephone_metrics": ordinal_classification_metrics(
                    add_labels[add_validation], add_telephone_oof[add_validation]
                ),
                "legacy_proxy_metrics": ordinal_classification_metrics(
                    legacy_labels[legacy_validation], legacy_oof[legacy_validation]
                ),
            }
        )
    if not np.isfinite(add_clean_oof).all() or not np.isfinite(add_telephone_oof).all():
        raise RuntimeError("cross-domain add OOF 확률에 결측이 있습니다.")
    if not np.isfinite(legacy_oof[legacy_train_indices]).all():
        raise RuntimeError("cross-domain legacy OOF 확률에 결측이 있습니다.")
    package_probabilities = np.mean(np.stack(package_fold_predictions, axis=0), axis=0)
    add_clean_metrics = ordinal_classification_metrics(add_labels, add_clean_oof)
    add_telephone_metrics = ordinal_classification_metrics(add_labels, add_telephone_oof)
    legacy_metrics = ordinal_classification_metrics(
        legacy_labels[legacy_train_indices], legacy_oof[legacy_train_indices]
    )
    package_metrics = ordinal_classification_metrics(
        legacy_labels[package_indices], package_probabilities
    )
    output_rows = []
    for index, row in enumerate(add_rows):
        clean_level = int(np.argmax(add_clean_oof[index]))
        telephone_level = int(np.argmax(add_telephone_oof[index]))
        output_rows.append(
            {
                "dataset": "add_datasets",
                "sample_id": row["segment_id"],
                "cv_fold": row["cv_fold"],
                "target_level": int(add_labels[index]),
                "clean_level": clean_level,
                "telephone_level": telephone_level,
                "clean_confidence": round(float(add_clean_oof[index, clean_level]), 8),
                "telephone_confidence": round(
                    float(add_telephone_oof[index, telephone_level]), 8
                ),
            }
        )
    for index in legacy_train_indices:
        predicted = int(np.argmax(legacy_oof[index]))
        output_rows.append(
            {
                "dataset": "legacy_auxiliary",
                "sample_id": legacy_rows[index]["embedding_key"],
                "cv_fold": legacy_rows[index]["cv_fold"],
                "target_level": int(legacy_labels[index]),
                "clean_level": predicted,
                "telephone_level": "",
                "clean_confidence": round(float(legacy_oof[index, predicted]), 8),
                "telephone_confidence": "",
            }
        )
    write_csv(predictions_path, output_rows, list(output_rows[0].keys()))
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "candidate_id": "emotion_temperature_ordinal_cross_domain_v3",
            "selected_head": "egemaps_cumulative_lgbm_cross_domain",
            "levels": ORDINAL_LEVELS,
            "level_names": LEVEL_NAMES,
            "fold_models": fold_models,
            "feature_order": "EGEMAPS_88",
            "training_domains": ["add_datasets_clean", "add_datasets_telephone", "legacy_auxiliary"],
            "inference_status": "RESEARCH_SHADOW_ONLY",
        },
        artifact_path,
    )
    robustness = {
        "macro_f1_drop": add_clean_metrics["macro_f1"] - add_telephone_metrics["macro_f1"],
        "high_recall_drop": add_clean_metrics["per_class"]["2"]["recall"]
        - add_telephone_metrics["per_class"]["2"]["recall"],
    }
    gates = {
        "add_clean_macro_f1_minimum_0_50": add_clean_metrics["macro_f1"] >= 0.50,
        "add_telephone_macro_f1_minimum_0_50": add_telephone_metrics["macro_f1"] >= 0.50,
        "legacy_proxy_macro_f1_minimum_0_40": legacy_metrics["macro_f1"] >= 0.40,
        "legacy_package_macro_f1_minimum_0_40": package_metrics["macro_f1"] >= 0.40,
        "legacy_package_qwk_minimum_0_10": package_metrics["quadratic_weighted_kappa"] >= 0.10,
        "add_telephone_high_recall_minimum_0_30": add_telephone_metrics["per_class"]["2"]["recall"]
        >= 0.30,
    }
    report = {
        "status": "ORDINAL_V3_CROSS_DOMAIN_CV_COMPLETE",
        "created_at": utc_now_iso(),
        "candidate_id": "emotion_temperature_ordinal_cross_domain_v3",
        "add_clean_metrics": add_clean_metrics,
        "add_telephone_metrics": add_telephone_metrics,
        "legacy_auxiliary_proxy_cv_metrics": legacy_metrics,
        "legacy_package_development_metrics": package_metrics,
        "robustness": robustness,
        "fold_reports": fold_reports,
        "gates": gates,
        "all_gates_pass": all(gates.values()),
        "caveats": [
            "Legacy folds use CONTIGUOUS_AGE_SEX_RUN proxy groups, not verified speaker IDs.",
            "Legacy package was inspected in prior v2 development and is not a pristine final holdout.",
            "Label protocols differ between VerifyEmotionLevel and five-vote median intensity.",
        ],
        "artifact": {"path": str(artifact_path.resolve()), "sha256": sha256_file(artifact_path)},
        "outputs": {"oof_predictions": str(predictions_path.resolve())},
        "api_allowed": False,
        "api_block_reason": "NO_NEW_REAL_CALL_CENTER_SPEAKER_INDEPENDENT_HOLDOUT",
    }
    write_json(report_json_path, report)
    lines = [
        "# ordinal v3 cross-domain joint training",
        "",
        f"- add clean Macro F1 / QWK: {add_clean_metrics['macro_f1']:.4f} / {add_clean_metrics['quadratic_weighted_kappa']:.4f}",
        f"- add telephone Macro F1 / QWK: {add_telephone_metrics['macro_f1']:.4f} / {add_telephone_metrics['quadratic_weighted_kappa']:.4f}",
        f"- legacy auxiliary proxy-CV Macro F1 / QWK: {legacy_metrics['macro_f1']:.4f} / {legacy_metrics['quadratic_weighted_kappa']:.4f}",
        f"- legacy package development Macro F1 / QWK: {package_metrics['macro_f1']:.4f} / {package_metrics['quadratic_weighted_kappa']:.4f}",
        f"- gates pass: `{all(gates.values())}`",
        "",
        "add_datasets는 실제 화자쌍 fold, legacy는 기존 proxy fold를 지켰다. legacy package는 과거에 이미 관찰된 개발 자료다.",
        "새 실제 콜센터 독립 holdout 전까지 연구용 shadow 후보로만 유지한다.",
        "",
    ]
    report_md_path.write_text("\n".join(lines), encoding="utf-8")
    return report
