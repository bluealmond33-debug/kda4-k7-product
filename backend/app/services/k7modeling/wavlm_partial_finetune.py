"""Length-aware, resumable partial WavLM fine-tuning for binary anger detection."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import random
import time
import wave
from pathlib import Path
from typing import Any, Iterator, Sequence

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F
from torch.utils.data import DataLoader, Dataset, Sampler
from transformers import AutoFeatureExtractor, AutoModel

from .anger_baselines import _classification_metrics
from .anger_mlp import AngerMLP, _best_balanced_threshold, _read
from .io_utils import sha256_file, utc_now_iso, write_json
from .wavlm_alternative import MODEL_ID, _load_16k


SAMPLE_RATE = 16000


def _duration_samples(path: str, maximum: int | None = None) -> int:
    with wave.open(path, "rb") as handle:
        samples = math.ceil(handle.getnframes() * SAMPLE_RATE / handle.getframerate())
    return min(samples, maximum) if maximum is not None else samples


def _window_starts(length: int, window: int, hop: int) -> list[int]:
    if length <= window:
        return [0]
    starts = list(range(0, length - window + 1, hop))
    final = length - window
    if starts[-1] != final:
        starts.append(final)
    return starts


class LengthBucketBatchSampler(Sampler[list[int]]):
    """Shuffle local length buckets while bounding padded samples per batch."""

    def __init__(
        self,
        lengths: Sequence[int],
        *,
        max_batch_size: int,
        max_padded_samples: int,
        bucket_size: int = 256,
        seed: int = 20260721,
    ) -> None:
        if not lengths:
            raise ValueError("lengths must not be empty")
        if min(max_batch_size, max_padded_samples, bucket_size) < 1:
            raise ValueError("batch limits must be positive")
        self.lengths = list(lengths)
        self.max_batch_size = max_batch_size
        self.max_padded_samples = max_padded_samples
        self.bucket_size = bucket_size
        self.seed = seed
        self.epoch = 1
        self.start_batch = 0

    def set_epoch(self, epoch: int, start_batch: int = 0) -> None:
        self.epoch = epoch
        self.start_batch = start_batch

    def batches(self) -> list[list[int]]:
        rng = random.Random(self.seed + self.epoch * 1_000_003)
        ordered = sorted(range(len(self.lengths)), key=self.lengths.__getitem__)
        buckets = [ordered[start:start + self.bucket_size] for start in range(0, len(ordered), self.bucket_size)]
        rng.shuffle(buckets)
        batches: list[list[int]] = []
        for bucket in buckets:
            rng.shuffle(bucket)
            batch: list[int] = []
            batch_max = 0
            for index in bucket:
                proposed_max = max(batch_max, self.lengths[index])
                proposed_size = len(batch) + 1
                if batch and (
                    proposed_size > self.max_batch_size
                    or proposed_max * proposed_size > self.max_padded_samples
                ):
                    batches.append(batch)
                    batch = []
                    batch_max = 0
                batch.append(index)
                batch_max = max(batch_max, self.lengths[index])
            if batch:
                batches.append(batch)
        rng.shuffle(batches)
        return batches

    def __iter__(self) -> Iterator[list[int]]:
        yield from self.batches()[self.start_batch:]

    def __len__(self) -> int:
        return max(0, len(self.batches()) - self.start_batch)


class TrainAudioRows(Dataset):
    def __init__(self, rows: list[dict[str, str]], max_samples: int, seed: int) -> None:
        self.rows = rows
        self.max_samples = max_samples
        self.seed = seed
        self.epoch = 1
        self.lengths = [_duration_samples(row["audio_path"], max_samples) for row in rows]

    def set_epoch(self, epoch: int) -> None:
        self.epoch = epoch

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int) -> tuple[np.ndarray, float, float, float, int]:
        row = self.rows[index]
        signal = _load_16k(row["audio_path"])
        if len(signal) > self.max_samples:
            rng = random.Random(self.seed + self.epoch * 1_000_003 + index * 97)
            start = rng.randint(0, len(signal) - self.max_samples)
            signal = signal[start:start + self.max_samples]
        return (
            signal,
            float(row["anger_binary_target"]),
            float(row["anger_vote_ratio"]),
            float(row["annotation_agreement"]),
            index,
        )


class EvaluationWindows(Dataset):
    def __init__(self, rows: list[dict[str, str]], window_samples: int, hop_samples: int) -> None:
        self.rows = rows
        self.window_samples = window_samples
        self.items: list[tuple[int, int]] = []
        self.lengths: list[int] = []
        for row_index, row in enumerate(rows):
            length = _duration_samples(row["audio_path"])
            for start in _window_starts(length, window_samples, hop_samples):
                self.items.append((row_index, start))
                self.lengths.append(min(window_samples, length - start))

    def __len__(self) -> int:
        return len(self.items)

    def __getitem__(self, index: int) -> tuple[np.ndarray, float, float, float, int]:
        row_index, start = self.items[index]
        row = self.rows[row_index]
        signal = _load_16k(row["audio_path"])
        signal = signal[start:start + self.window_samples]
        return (
            signal,
            float(row["anger_binary_target"]),
            float(row["anger_vote_ratio"]),
            float(row["annotation_agreement"]),
            row_index,
        )


class Collator:
    def __init__(self, extractor: Any) -> None:
        self.extractor = extractor

    def __call__(self, batch: list[tuple[np.ndarray, float, float, float, int]]) -> dict[str, torch.Tensor]:
        signals, targets, soft_targets, agreements, group_indices = zip(*batch, strict=True)
        values = self.extractor(list(signals), sampling_rate=SAMPLE_RATE, padding=True, return_tensors="pt")
        return {
            "input_values": values.input_values,
            "attention_mask": values.get("attention_mask", torch.ones_like(values.input_values, dtype=torch.long)),
            "targets": torch.tensor(targets, dtype=torch.float32),
            "soft_targets": torch.tensor(soft_targets, dtype=torch.float32),
            "agreements": torch.tensor(agreements, dtype=torch.float32),
            "group_indices": torch.tensor(group_indices, dtype=torch.long),
        }


class WavLMAnger(nn.Module):
    def __init__(self, backbone: nn.Module) -> None:
        super().__init__()
        self.backbone = backbone
        self.dropout = nn.Dropout(0.15)
        self.classifier = nn.Linear(768, 1)

    def forward(self, input_values: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
        hidden = self.backbone(input_values=input_values, attention_mask=attention_mask).last_hidden_state
        feature_mask = self.backbone._get_feature_vector_attention_mask(hidden.shape[1], attention_mask)
        pooled = (hidden * feature_mask.unsqueeze(-1)).sum(dim=1) / feature_mask.sum(dim=1, keepdim=True).clamp_min(1)
        return self.classifier(self.dropout(pooled)).squeeze(-1)


class WavLMMLPAnger(nn.Module):
    """Raw-audio WavLM with a previously trained normalized MLP head."""

    def __init__(self, backbone: nn.Module, artifact: dict[str, Any]) -> None:
        super().__init__()
        self.backbone = backbone
        self.head = AngerMLP(768)
        self.head.load_state_dict(artifact["state_dict"])
        self.register_buffer("feature_mean", torch.as_tensor(artifact["mean"], dtype=torch.float32))
        self.register_buffer("feature_std", torch.as_tensor(artifact["std"], dtype=torch.float32))

    def forward(self, input_values: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
        hidden = self.backbone(input_values=input_values, attention_mask=attention_mask).last_hidden_state
        feature_mask = self.backbone._get_feature_vector_attention_mask(hidden.shape[1], attention_mask)
        pooled = (hidden * feature_mask.unsqueeze(-1)).sum(dim=1) / feature_mask.sum(dim=1, keepdim=True).clamp_min(1)
        with torch.autocast(device_type=pooled.device.type, enabled=False):
            normalized = (pooled.float() - self.feature_mean) / self.feature_std
            return self.head(normalized)


def _subset(rows: list[dict[str, str]], split: str, limit: int | None, seed: int) -> list[dict[str, str]]:
    selected = [row for row in rows if row["split"] == split]
    if limit is None or limit >= len(selected):
        return selected
    positive = [row for row in selected if row["anger_binary_target"] == "1"]
    negative = [row for row in selected if row["anger_binary_target"] == "0"]
    rng = random.Random(seed)
    rng.shuffle(positive)
    rng.shuffle(negative)
    positive_count = max(1, round(limit * len(positive) / len(selected)))
    sample = positive[:positive_count] + negative[: limit - positive_count]
    rng.shuffle(sample)
    return sample


def _evaluate(
    model: nn.Module,
    loader: DataLoader,
    rows: list[dict[str, str]],
    device: torch.device,
    aggregation: str,
) -> tuple[np.ndarray, np.ndarray]:
    model.eval()
    probabilities_by_row: list[list[float]] = [[] for _ in rows]
    with torch.inference_mode():
        for batch in loader:
            input_values = batch["input_values"].to(device)
            attention_mask = batch["attention_mask"].to(device)
            with torch.autocast(device_type=device.type, dtype=torch.float16, enabled=device.type == "cuda"):
                logits = model(input_values, attention_mask)
            probabilities = torch.sigmoid(logits).float().cpu().numpy()
            for row_index, probability in zip(batch["group_indices"].tolist(), probabilities, strict=True):
                probabilities_by_row[row_index].append(float(probability))
    if any(not values for values in probabilities_by_row):
        raise ValueError("evaluation window aggregation left an empty clip")
    reducer = np.mean if aggregation == "mean" else np.max
    clip_probabilities = np.asarray([reducer(values) for values in probabilities_by_row], dtype=np.float32)
    targets = np.asarray([int(row["anger_binary_target"]) for row in rows], dtype=np.int8)
    return targets, clip_probabilities


def _trainable_state(model: nn.Module) -> dict[str, torch.Tensor]:
    trainable_names = {name for name, parameter in model.named_parameters() if parameter.requires_grad}
    return {
        name: value.detach().cpu().clone()
        for name, value in model.state_dict().items()
        if name in trainable_names
    }


def _atomic_torch_save(value: Any, path: Path) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    torch.save(value, temporary)
    temporary.replace(path)


def _configuration_hash(configuration: dict[str, Any]) -> str:
    encoded = json.dumps(configuration, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def partial_finetune(
    manifest_path: Path,
    cache_dir: Path,
    output_dir: Path,
    *,
    seed: int = 20260721,
    epochs: int = 1,
    max_batch_size: int = 4,
    max_padded_seconds: float = 24.0,
    gradient_accumulation: int = 4,
    top_layers: int = 2,
    max_window_seconds: float = 12.0,
    evaluation_hop_seconds: float = 10.0,
    evaluation_aggregation: str = "mean",
    checkpoint_updates: int = 100,
    resume: bool = False,
    train_limit: int | None = None,
    validation_limit: int | None = None,
    evaluate_test: bool = False,
    max_optimizer_steps: int | None = None,
    mlp_head_artifact: Path | None = None,
    backbone_learning_rate: float = 2e-5,
    head_learning_rate: float = 2e-4,
    soft_target_weight: float = 0.0,
    agreement_weighting: bool = False,
    evaluate_before_training: bool = False,
) -> dict[str, Any]:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type != "cuda":
        raise RuntimeError("partial fine-tuning requires CUDA for this workflow")
    if evaluation_aggregation not in {"mean", "max"}:
        raise ValueError("evaluation_aggregation must be mean or max")
    if not 0.0 <= soft_target_weight <= 1.0:
        raise ValueError("soft_target_weight must be in 0..1")
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_hash = sha256_file(manifest_path)
    window_samples = round(max_window_seconds * SAMPLE_RATE)
    hop_samples = round(evaluation_hop_seconds * SAMPLE_RATE)
    max_padded_samples = round(max_padded_seconds * SAMPLE_RATE)
    if not 0 < hop_samples <= window_samples:
        raise ValueError("evaluation hop must be positive and no longer than the window")
    if max_padded_samples < window_samples:
        raise ValueError("max padded samples must fit at least one full window")

    configuration = {
        "model_id": MODEL_ID,
        "manifest_sha256": manifest_hash,
        "seed": seed,
        "epochs": epochs,
        "max_batch_size": max_batch_size,
        "max_padded_seconds": max_padded_seconds,
        "gradient_accumulation": gradient_accumulation,
        "top_layers": top_layers,
        "max_window_seconds": max_window_seconds,
        "evaluation_hop_seconds": evaluation_hop_seconds,
        "evaluation_aggregation": evaluation_aggregation,
        "train_limit": train_limit,
        "validation_limit": validation_limit,
        "mlp_head_artifact_sha256": sha256_file(mlp_head_artifact) if mlp_head_artifact else None,
        "backbone_learning_rate": backbone_learning_rate,
        "head_learning_rate": head_learning_rate,
        "soft_target_weight": soft_target_weight,
        "agreement_weighting": agreement_weighting,
        "evaluate_before_training": evaluate_before_training,
    }
    configuration_hash = _configuration_hash(configuration)
    rows = _read(manifest_path)
    train_rows = _subset(rows, "train", train_limit, seed)
    validation_rows = _subset(rows, "validation", validation_limit, seed + 1)
    test_rows = _subset(rows, "test", None, seed + 2) if evaluate_test else []

    extractor = AutoFeatureExtractor.from_pretrained(MODEL_ID, cache_dir=cache_dir, local_files_only=True)
    backbone = AutoModel.from_pretrained(MODEL_ID, cache_dir=cache_dir, local_files_only=True, dtype=torch.float32)
    for parameter in backbone.parameters():
        parameter.requires_grad = False
    encoder_layers = backbone.encoder.layers
    if top_layers < 1 or top_layers > len(encoder_layers):
        raise ValueError(f"top_layers must be in 1..{len(encoder_layers)}")
    for layer in encoder_layers[-top_layers:]:
        for parameter in layer.parameters():
            parameter.requires_grad = True
    head_artifact = None
    if mlp_head_artifact is not None:
        head_artifact = torch.load(mlp_head_artifact, map_location="cpu", weights_only=False)
        if head_artifact["feature_set"] != "embedding_768" or head_artifact["input_dim"] != 768:
            raise ValueError("expected a 768-dimensional frozen WavLM MLP artifact")
        model = WavLMMLPAnger(backbone, head_artifact).to(device)
    else:
        model = WavLMAnger(backbone).to(device)

    collator = Collator(extractor)
    train_dataset = TrainAudioRows(train_rows, window_samples, seed)
    train_sampler = LengthBucketBatchSampler(
        train_dataset.lengths,
        max_batch_size=max_batch_size,
        max_padded_samples=max_padded_samples,
        seed=seed,
    )
    validation_dataset = EvaluationWindows(validation_rows, window_samples, hop_samples)
    validation_sampler = LengthBucketBatchSampler(
        validation_dataset.lengths,
        max_batch_size=max_batch_size,
        max_padded_samples=max_padded_samples,
        seed=seed + 10,
    )
    validation_sampler.set_epoch(1)
    validation_loader = DataLoader(
        validation_dataset,
        batch_sampler=validation_sampler,
        collate_fn=collator,
        num_workers=0,
    )
    test_loader = None
    if test_rows:
        test_dataset = EvaluationWindows(test_rows, window_samples, hop_samples)
        test_sampler = LengthBucketBatchSampler(
            test_dataset.lengths,
            max_batch_size=max_batch_size,
            max_padded_samples=max_padded_samples,
            seed=seed + 20,
        )
        test_sampler.set_epoch(1)
        test_loader = DataLoader(
            test_dataset,
            batch_sampler=test_sampler,
            collate_fn=collator,
            num_workers=0,
        )

    head_module = model.head if isinstance(model, WavLMMLPAnger) else model.classifier
    head_parameters = list(head_module.parameters())
    backbone_parameters = [
        parameter
        for name, parameter in model.named_parameters()
        if parameter.requires_grad and not name.startswith("classifier") and not name.startswith("head")
    ]
    optimizer = torch.optim.AdamW(
        [
            {"params": backbone_parameters, "lr": backbone_learning_rate},
            {"params": head_parameters, "lr": head_learning_rate},
        ],
        weight_decay=1e-4,
    )
    positives = sum(int(row["anger_binary_target"]) for row in train_rows)
    pos_weight = (len(train_rows) - positives) / positives
    positive_weight_tensor = torch.tensor(pos_weight, device=device)
    scaler = torch.amp.GradScaler("cuda", enabled=True)

    checkpoint_path = output_dir / "wavlm_partial_finetune_progress.pt"
    start_epoch = 1
    start_batch = 0
    global_step = 0
    history: list[dict[str, Any]] = []
    best_score: tuple[float, float, float] | None = None
    best_state: dict[str, torch.Tensor] | None = None
    best_threshold: float | None = None
    best_epoch = 0
    if resume:
        if not checkpoint_path.exists():
            raise FileNotFoundError(f"resume checkpoint not found: {checkpoint_path}")
        checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
        if checkpoint["configuration_hash"] != configuration_hash:
            raise ValueError("resume checkpoint configuration does not match this run")
        model.load_state_dict(checkpoint["model_state"], strict=False)
        optimizer.load_state_dict(checkpoint["optimizer_state"])
        scaler.load_state_dict(checkpoint["scaler_state"])
        start_epoch = int(checkpoint["epoch"])
        start_batch = int(checkpoint["next_batch"])
        global_step = int(checkpoint["global_step"])
        history = list(checkpoint["history"])
        best_score = tuple(checkpoint["best_score"]) if checkpoint["best_score"] is not None else None
        best_state = checkpoint["best_state"]
        best_threshold = checkpoint["best_threshold"]
        best_epoch = int(checkpoint["best_epoch"])

    if not resume and evaluate_before_training:
        y_initial, p_initial = _evaluate(
            model, validation_loader, validation_rows, device, evaluation_aggregation
        )
        initial_threshold, initial_metrics = _best_balanced_threshold(y_initial, p_initial)
        history.append({
            "epoch": 0,
            "stage": "pretrained_mlp_before_finetuning",
            "train_loss": None,
            "validation": initial_metrics,
            "train_batches": 0,
            "validation_windows": len(validation_dataset),
        })
        best_score = (
            initial_metrics["macro_f1"],
            initial_metrics["uar"],
            initial_metrics["f1"],
        )
        best_threshold = initial_threshold
        best_state = copy.deepcopy(_trainable_state(model))
        best_epoch = 0

    def save_progress(epoch: int, next_batch: int, status: str) -> None:
        _atomic_torch_save(
            {
                "status": status,
                "configuration": configuration,
                "configuration_hash": configuration_hash,
                "model_state": _trainable_state(model),
                "optimizer_state": optimizer.state_dict(),
                "scaler_state": scaler.state_dict(),
                "epoch": epoch,
                "next_batch": next_batch,
                "global_step": global_step,
                "history": history,
                "best_score": best_score,
                "best_state": best_state,
                "best_threshold": best_threshold,
                "best_epoch": best_epoch,
                "updated_at": utc_now_iso(),
            },
            checkpoint_path,
        )

    started = time.time()
    torch.cuda.reset_peak_memory_stats()
    for epoch in range(start_epoch, epochs + 1):
        epoch_start_batch = start_batch if epoch == start_epoch else 0
        train_dataset.set_epoch(epoch)
        train_sampler.set_epoch(epoch, epoch_start_batch)
        total_batches = len(train_sampler.batches())
        train_loader = DataLoader(train_dataset, batch_sampler=train_sampler, collate_fn=collator, num_workers=0)
        model.train()
        optimizer.zero_grad(set_to_none=True)
        loss_sum = 0.0
        example_count = 0
        accumulation_count = 0
        for batch_number, batch in enumerate(train_loader, start=epoch_start_batch + 1):
            input_values = batch["input_values"].to(device)
            attention_mask = batch["attention_mask"].to(device)
            targets = batch["targets"].to(device)
            soft_targets = batch["soft_targets"].to(device)
            agreements = batch["agreements"].to(device)
            with torch.autocast(device_type="cuda", dtype=torch.float16):
                logits = model(input_values, attention_mask)
                hard_loss = F.binary_cross_entropy_with_logits(
                    logits, targets, pos_weight=positive_weight_tensor, reduction="none"
                )
                soft_loss = F.binary_cross_entropy_with_logits(logits, soft_targets, reduction="none")
                per_example_loss = (
                    (1.0 - soft_target_weight) * hard_loss
                    + soft_target_weight * soft_loss
                )
                if agreement_weighting:
                    weights = agreements / agreements.mean().clamp_min(1e-6)
                    per_example_loss = per_example_loss * weights
                raw_loss = per_example_loss.mean()
                loss = raw_loss / gradient_accumulation
            scaler.scale(loss).backward()
            accumulation_count += 1
            is_update = accumulation_count >= gradient_accumulation or batch_number == total_batches
            if is_update:
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(
                    [parameter for parameter in model.parameters() if parameter.requires_grad], 1.0
                )
                scaler.step(optimizer)
                scaler.update()
                optimizer.zero_grad(set_to_none=True)
                accumulation_count = 0
                global_step += 1
                if checkpoint_updates > 0 and global_step % checkpoint_updates == 0:
                    save_progress(epoch, batch_number, "RUNNING")
                if max_optimizer_steps is not None and global_step >= max_optimizer_steps:
                    save_progress(epoch, batch_number, "INTERRUPTED_FOR_SMOKE")
                    report = {
                        "status": "WAVLM_PARTIAL_FINETUNE_INTERRUPTED",
                        "created_at": utc_now_iso(),
                        "configuration": configuration,
                        "configuration_hash": configuration_hash,
                        "checkpoint": str(checkpoint_path.resolve()),
                        "epoch": epoch,
                        "next_batch": batch_number,
                        "global_step": global_step,
                        "peak_gpu_memory_bytes": int(torch.cuda.max_memory_allocated()),
                        "elapsed_seconds": time.time() - started,
                    }
                    write_json(output_dir / "wavlm_partial_finetune.json", report)
                    return report
            loss_sum += float(raw_loss.detach().cpu()) * len(targets)
            example_count += len(targets)

        y_validation, p_validation = _evaluate(
            model, validation_loader, validation_rows, device, evaluation_aggregation
        )
        threshold, metrics = _best_balanced_threshold(y_validation, p_validation)
        history.append(
            {
                "epoch": epoch,
                "stage": "partial_finetuning",
                "train_loss": loss_sum / max(example_count, 1),
                "validation": metrics,
                "train_batches": total_batches,
                "validation_windows": len(validation_dataset),
            }
        )
        score = (metrics["macro_f1"], metrics["uar"], metrics["f1"])
        if best_score is None or score > best_score:
            best_score = score
            best_threshold = threshold
            best_state = copy.deepcopy(_trainable_state(model))
            best_epoch = epoch
        save_progress(epoch + 1, 0, "EPOCH_COMPLETE")
        start_batch = 0

    if best_state is None or best_threshold is None:
        raise RuntimeError("no completed validation epoch is available")
    model.load_state_dict(best_state, strict=False)
    test_metrics = None
    test_windows = 0
    if test_loader is not None:
        y_test, p_test = _evaluate(model, test_loader, test_rows, device, evaluation_aggregation)
        test_metrics = _classification_metrics(y_test, p_test, best_threshold)
        test_windows = len(test_loader.dataset)

    artifact_path = output_dir / "wavlm_partial_finetune.pt"
    _atomic_torch_save(
        {
            "model_id": MODEL_ID,
            "top_layers": top_layers,
            "state_dict": best_state,
            "threshold": best_threshold,
            "window_seconds": max_window_seconds,
            "evaluation_hop_seconds": evaluation_hop_seconds,
            "evaluation_aggregation": evaluation_aggregation,
            "configuration_hash": configuration_hash,
            "head_type": "pretrained_mlp" if head_artifact is not None else "linear",
            "feature_mean": head_artifact["mean"] if head_artifact is not None else None,
            "feature_std": head_artifact["std"] if head_artifact is not None else None,
        },
        artifact_path,
    )
    save_progress(epochs + 1, 0, "COMPLETE")
    report = {
        "status": "WAVLM_PARTIAL_FINETUNE_COMPLETE",
        "created_at": utc_now_iso(),
        "seed": seed,
        "device": str(device),
        "gpu_name": torch.cuda.get_device_name(0),
        "model_id": MODEL_ID,
        "configuration": configuration,
        "configuration_hash": configuration_hash,
        "dataset": {
            "train_clips": len(train_rows),
            "train_angry": positives,
            "validation_clips": len(validation_rows),
            "validation_windows": len(validation_dataset),
            "test_clips": len(test_rows),
            "test_windows": test_windows,
        },
        "trainable_parameters": int(sum(parameter.numel() for parameter in model.parameters() if parameter.requires_grad)),
        "peak_gpu_memory_bytes": int(torch.cuda.max_memory_allocated()),
        "elapsed_seconds": time.time() - started,
        "global_optimizer_steps": global_step,
        "history": history,
        "selected_epoch": best_epoch,
        "selected_threshold": best_threshold,
        "test": test_metrics,
        "evaluation_policy": "select epoch and threshold on validation; optional test uses the fixed selection",
        "inputs": {"manifest": {"path": str(manifest_path.resolve()), "sha256": manifest_hash}},
        "outputs": {
            "artifact": str(artifact_path.resolve()),
            "checkpoint": str(checkpoint_path.resolve()),
        },
    }
    write_json(output_dir / "wavlm_partial_finetune.json", report)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--cache-dir", type=Path, default=Path("data/model_cache"))
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=20260721)
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--max-batch-size", type=int, default=4)
    parser.add_argument("--max-padded-seconds", type=float, default=24.0)
    parser.add_argument("--gradient-accumulation", type=int, default=4)
    parser.add_argument("--top-layers", type=int, default=2)
    parser.add_argument("--max-window-seconds", type=float, default=12.0)
    parser.add_argument("--evaluation-hop-seconds", type=float, default=10.0)
    parser.add_argument("--evaluation-aggregation", choices=("mean", "max"), default="mean")
    parser.add_argument("--checkpoint-updates", type=int, default=100)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--train-limit", type=int)
    parser.add_argument("--validation-limit", type=int)
    parser.add_argument("--evaluate-test", action="store_true")
    parser.add_argument("--max-optimizer-steps", type=int)
    parser.add_argument("--mlp-head-artifact", type=Path)
    parser.add_argument("--backbone-learning-rate", type=float, default=2e-5)
    parser.add_argument("--head-learning-rate", type=float, default=2e-4)
    parser.add_argument("--soft-target-weight", type=float, default=0.0)
    parser.add_argument("--agreement-weighting", action="store_true")
    parser.add_argument("--evaluate-before-training", action="store_true")
    args = parser.parse_args()
    report = partial_finetune(
        args.manifest,
        args.cache_dir,
        args.output_dir,
        seed=args.seed,
        epochs=args.epochs,
        max_batch_size=args.max_batch_size,
        max_padded_seconds=args.max_padded_seconds,
        gradient_accumulation=args.gradient_accumulation,
        top_layers=args.top_layers,
        max_window_seconds=args.max_window_seconds,
        evaluation_hop_seconds=args.evaluation_hop_seconds,
        evaluation_aggregation=args.evaluation_aggregation,
        checkpoint_updates=args.checkpoint_updates,
        resume=args.resume,
        train_limit=args.train_limit,
        validation_limit=args.validation_limit,
        evaluate_test=args.evaluate_test,
        max_optimizer_steps=args.max_optimizer_steps,
        mlp_head_artifact=args.mlp_head_artifact,
        backbone_learning_rate=args.backbone_learning_rate,
        head_learning_rate=args.head_learning_rate,
        soft_target_weight=args.soft_target_weight,
        agreement_weighting=args.agreement_weighting,
        evaluate_before_training=args.evaluate_before_training,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
