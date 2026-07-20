from __future__ import annotations

import csv
import json
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
from scipy.stats import pearsonr, spearmanr

from .candidates import _cross_validated_calibration
from .evaluation import (
    bootstrap_regression_metrics,
    fit_affine_calibrator,
    regression_metrics,
)
from .io_utils import read_csv, sha256_file, utc_now_iso, write_json


INTENSITY_COLUMNS = (
    "1번 감정세기",
    "2번 감정세기",
    "3번 감정세기",
    "4번감정세기",
    "5번 감정세기",
)
EMOTION_COLUMNS = (
    "1번 감정",
    "2번 감정",
    "3번 감정",
    "4번 감정",
    "5번 감정",
)


def read_cp949_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="cp949", newline="") as handle:
        return list(csv.DictReader(handle))


def intensity_vector(row: dict[str, str]) -> np.ndarray:
    values = np.asarray([float(row[column]) for column in INTENSITY_COLUMNS], dtype=np.float64)
    if values.shape != (5,) or not np.isfinite(values).all():
        raise ValueError("기존 5인 감정 강도 값이 유효하지 않습니다.")
    if np.any(values < 0.0) or np.any(values > 2.0):
        raise ValueError("기존 감정 강도는 0~2 범위여야 합니다.")
    return values


def _correlation(x: list[float], y: list[float]) -> dict[str, float]:
    return {
        "pearson": float(pearsonr(x, y).statistic),
        "spearman": float(spearmanr(x, y).statistic),
    }


def summarize_auxiliary_labels(rows: list[dict[str, str]]) -> dict[str, Any]:
    means: list[float] = []
    standard_deviations: list[float] = []
    unanimous = 0
    for row in rows:
        values = intensity_vector(row)
        means.append(round(float(values.mean()), 1))
        standard_deviations.append(float(values.std()))
        unanimous += int(len(set(values.tolist())) == 1)
    low_disagreement = sum(value <= 0.4 for value in standard_deviations)
    return {
        "rows": len(rows),
        "mean_intensity_counts": {
            str(key): value for key, value in sorted(Counter(means).items())
        },
        "unanimous_intensity_rows": unanimous,
        "unanimous_rate": unanimous / len(rows),
        "mean_rater_std": float(np.mean(standard_deviations)),
        "low_disagreement_std_le_0_4": low_disagreement,
        "low_disagreement_rate": low_disagreement / len(rows),
    }


def analyze_existing_intensity_supervision(
    metadata_csv: Path,
    admin_manifest_path: Path,
    consensus_path: Path,
    final_holdout_report_path: Path,
    output_json_path: Path,
    output_md_path: Path,
    folds: int = 5,
    seed: int = 20260716,
) -> dict[str, Any]:
    metadata_rows = read_cp949_csv(metadata_csv)
    metadata_by_id = {row["wav_id"]: row for row in metadata_rows}
    admin_rows = read_csv(admin_manifest_path)
    admin_by_clip = {row["clip_id"]: row for row in admin_rows}
    consensus_rows = read_csv(consensus_path)
    ready_rows = [row for row in consensus_rows if row.get("consensus_status") == "READY"]

    final_holdout_report = json.loads(final_holdout_report_path.read_text(encoding="utf-8"))
    if final_holdout_report.get("status") != "FINAL_HOLDOUT_EVALUATION_COMPLETE":
        raise ValueError("기존 holdout이 이미 최종 평가에 사용됐다는 증거가 필요합니다.")
    if final_holdout_report.get("holdout_accessed_once") is not True:
        raise ValueError("holdout 사용 상태가 명확하지 않습니다.")

    clip_ids: list[str] = []
    targets: list[float] = []
    mean_intensities: list[float] = []
    max_intensities: list[float] = []
    nonneutral_ratios: list[float] = []
    emotion_agreements: list[float] = []
    roles: list[str] = []

    for row in ready_rows:
        clip_id = row["clip_id"]
        if clip_id not in admin_by_clip:
            raise ValueError(f"admin manifest에 없는 clip: {clip_id}")
        source_id = admin_by_clip[clip_id]["source_wav_id"]
        if source_id not in metadata_by_id:
            raise ValueError(f"원본 메타데이터에 없는 source WAV: {source_id}")
        metadata = metadata_by_id[source_id]
        intensities = intensity_vector(metadata)
        emotions = [metadata[column].strip().lower() for column in EMOTION_COLUMNS]
        emotion_counts = Counter(emotions)
        clip_ids.append(clip_id)
        targets.append(float(row["emotion_temperature_score"]))
        mean_intensities.append(float(intensities.mean()))
        max_intensities.append(float(intensities.max()))
        nonneutral_ratios.append(sum(emotion != "neutral" for emotion in emotions) / 5.0)
        emotion_agreements.append(max(emotion_counts.values()) / 5.0)
        roles.append(row["hybrid_role"])

    target_array = np.asarray(targets, dtype=np.float64)
    mean_intensity_array = np.asarray(mean_intensities, dtype=np.float64)
    cross_fitted, cross_validation = _cross_validated_calibration(
        clip_ids,
        mean_intensity_array,
        target_array,
        folds=folds,
        seed=seed,
    )

    calibration_indices = np.asarray(
        [index for index, role in enumerate(roles) if role == "CALIBRATION"],
        dtype=int,
    )
    holdout_indices = np.asarray(
        [index for index, role in enumerate(roles) if role == "HUMAN_HOLDOUT"],
        dtype=int,
    )
    calibrator = fit_affine_calibrator(
        mean_intensity_array[calibration_indices],
        target_array[calibration_indices],
    )
    historical_holdout_prediction = calibrator.predict(mean_intensity_array[holdout_indices])
    calibration_mean = float(target_array[calibration_indices].mean())
    historical_holdout_bootstrap = bootstrap_regression_metrics(
        target_array[holdout_indices],
        historical_holdout_prediction,
        iterations=5000,
        seed=seed,
    )

    package_source_ids = {row["source_wav_id"] for row in admin_rows}
    metadata_source_ids = set(metadata_by_id)
    report = {
        "status": "WEAK_SUPERVISION_SIGNAL_CONFIRMED",
        "created_at": utc_now_iso(),
        "interpretation": (
            "RETROSPECTIVE_DEVELOPMENT_EVIDENCE_ONLY; "
            "ORIGINAL_HOLDOUT_ALREADY_SPENT; NOT_A_NEW_FINAL_TEST"
        ),
        "inputs": {
            "metadata_csv": {
                "path": str(metadata_csv.resolve()),
                "sha256": sha256_file(metadata_csv),
            },
            "admin_manifest": {
                "path": str(admin_manifest_path.resolve()),
                "sha256": sha256_file(admin_manifest_path),
            },
            "consensus": {
                "path": str(consensus_path.resolve()),
                "sha256": sha256_file(consensus_path),
            },
            "final_holdout_report": {
                "path": str(final_holdout_report_path.resolve()),
                "sha256": sha256_file(final_holdout_report_path),
            },
        },
        "auxiliary_label_pool": {
            **summarize_auxiliary_labels(metadata_rows),
            "package_source_rows_to_exclude_from_auxiliary_supervised_training": len(
                package_source_ids
            ),
            "remaining_auxiliary_training_rows": len(metadata_source_ids - package_source_ids),
            "annotation_type": "FIVE_RATER_EMOTION_CATEGORY_AND_ORDINAL_INTENSITY_0_1_2",
        },
        "gold_relationship": {
            "ready_rows": len(ready_rows),
            "mean_intensity": _correlation(mean_intensities, targets),
            "max_intensity": _correlation(max_intensities, targets),
            "nonneutral_ratio": _correlation(nonneutral_ratios, targets),
            "emotion_agreement": _correlation(emotion_agreements, targets),
            "cross_fitted_affine_from_mean_intensity": {
                **cross_validation["metrics"],
                "folds": cross_validation["folds"],
                "seed": cross_validation["seed"],
            },
            "raw_mean_intensity_x50": regression_metrics(
                target_array,
                mean_intensity_array * 50.0,
            ),
        },
        "retrospective_original_split": {
            "calibration_rows": len(calibration_indices),
            "holdout_rows": len(holdout_indices),
            "calibrator": calibrator.to_dict(),
            "calibration_in_sample": regression_metrics(
                target_array[calibration_indices],
                calibrator.predict(mean_intensity_array[calibration_indices]),
            ),
            "historical_holdout": regression_metrics(
                target_array[holdout_indices],
                historical_holdout_prediction,
            ),
            "historical_holdout_bootstrap": historical_holdout_bootstrap,
            "historical_holdout_constant_calibration_mean_baseline": regression_metrics(
                target_array[holdout_indices],
                np.full(len(holdout_indices), calibration_mean),
            ),
        },
        "recommended_model": {
            "candidate_id": "emotion2vec_intensity_bridge_v2",
            "stage_1": (
                "Predict five-rater ordinal intensity distribution from audio using 14,106 "
                "non-package source utterances."
            ),
            "stage_2": (
                "Cross-fit affine temperature calibration and a strongly regularized bounded "
                "residual head on 49 consensus targets."
            ),
            "stage_3": (
                "Use clean/telephone consistency, fold ensembles, and uncertainty gating; "
                "do not activate an API without a future independent test."
            ),
        },
    }
    write_json(output_json_path, report)

    holdout_metrics = report["retrospective_original_split"]["historical_holdout"]
    holdout_ccc_ci = report["retrospective_original_split"]["historical_holdout_bootstrap"][
        "metrics"
    ]["ccc"]
    cross_metrics = report["gold_relationship"]["cross_fitted_affine_from_mean_intensity"]
    auxiliary = report["auxiliary_label_pool"]
    output_md_path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# 추가 사람 라벨 없이 감정온도 모델을 고도화하는 전략",
        "",
        "## 기술 요약",
        "",
        "새 라벨을 생성하는 대신 원본 14,606개에 이미 존재하는 5인 감정 강도 "
        "주석을 대규모 보조 감독으로 사용한다. 기존 방식은 audEERING arousal을 "
        "실버 정답으로 사용했지만 사람 감정온도와 Pearson 0.078에 그쳤다. 반면 "
        f"5인 평균 강도는 49개 감정온도와 Pearson {report['gold_relationship']['mean_intensity']['pearson']:.3f}, "
        f"Spearman {report['gold_relationship']['mean_intensity']['spearman']:.3f}이다.",
        "",
        "29개 calibration으로 강도→감정온도 affine 보정을 학습해 이미 사용된 20개 "
        f"holdout에 회고적으로 적용하면 CCC {holdout_metrics['ccc']:.3f}, "
        f"MAE {holdout_metrics['mae']:.2f}, Spearman {holdout_metrics['spearman']:.3f}이다. "
        f"CCC 95% bootstrap 구간은 {holdout_ccc_ci['lower']:.3f}~"
        f"{holdout_ccc_ci['upper']:.3f}이다. "
        "이는 새 최종 검증이 아니라, 다음 모델의 학습 신호를 선택하기 위한 개발 증거다.",
        "",
        "## 확인된 정량 근거",
        "",
        "| 근거 | CCC/Pearson | MAE | Spearman | 해석 |",
        "|---|---:|---:|---:|---|",
        f"| 기존 audEERING 실버↔사람 | 0.078 Pearson | - | - | teacher target 불일치 |",
        f"| 5인 평균 강도↔사람 | {report['gold_relationship']['mean_intensity']['pearson']:.3f} Pearson | - | {report['gold_relationship']['mean_intensity']['spearman']:.3f} | 강한 단조 신호 |",
        f"| 49개 cross-fitted affine | {cross_metrics['ccc']:.3f} CCC | {cross_metrics['mae']:.2f} | {cross_metrics['spearman']:.3f} | 내부 개발 상한 |",
        f"| 기존 20개 holdout 회고 분석 | {holdout_metrics['ccc']:.3f} CCC | {holdout_metrics['mae']:.2f} | {holdout_metrics['spearman']:.3f} | 전략 선택 증거 |",
        "",
        f"전체 기존 강도 라벨은 {auxiliary['rows']:,}개이며, package의 500개 source를 "
        f"보조 지도학습에서 제외해도 {auxiliary['remaining_auxiliary_training_rows']:,}개가 남는다.",
        "",
        "## 권장 모델: emotion2vec intensity bridge v2",
        "",
        "### 1단계 — 기존 5인 강도 라벨로 음향 강도 모델 학습",
        "",
        "- `emotion2vec+ base`를 1순위 backbone으로 사용한다.",
        "- 출력은 단일 임의 점수가 아니라 5명 강도 투표의 0·1·2 soft distribution과 기대값이다.",
        "- 보조 head로 7개 감정 투표 분포와 평가자 불일치도를 함께 예측한다.",
        "- package 500개 source는 이 단계의 supervised train에서 제외한다.",
        "- 제외한 500개에는 기존 5인 강도 정답이 남아 있으므로, 감정온도 49개를 보기 전에 "
        "audio→강도 모델의 CCC·MAE·Spearman을 독립적으로 측정한다.",
        "- speaker embedding cluster가 package와 겹치는 auxiliary 행도 추가 제외해 "
        "가능한 범위에서 화자 누수를 줄인다.",
        "- clean 16k와 8k μ-law 변형의 예측이 같아지도록 consistency loss를 적용한다.",
        "",
        "### 2단계 — 49개 합의 라벨로 감정온도 변환",
        "",
        "- 기본 점수는 `clip(a + b × predicted_mean_intensity, 0, 100)`이다.",
        "- 감정온도 residual head는 전체 backbone이 아니라 작은 ridge/MLP 또는 LoRA만 학습한다.",
        "- residual 범위는 과적합을 막기 위해 ±10~15점으로 제한한다.",
        "- Huber + CCC + pairwise ranking loss를 비교하되 nested CV로 선택한다.",
        "- 5개 fold 모델의 중앙값을 최종 예측으로 사용한다.",
        "",
        "### 3단계 — 라벨 없는 target-domain 음성 활용",
        "",
        "- 500개 package 중 점수가 없는 451개는 supervised pseudo target으로 즉시 쓰지 않는다.",
        "- fold ensemble 표준편차, clean/8k 차이, 강도 분포 entropy가 모두 낮은 샘플만 "
        "EMA teacher-student consistency 학습에 단계적으로 추가한다.",
        "- audEERING arousal 단독 pseudo label은 다시 사용하지 않는다.",
        "",
        "### 4단계 — 화자 정보가 없는 문제 완화",
        "",
        "- pretrained speaker embedding으로 pseudo-speaker cluster를 생성한다.",
        "- outer CV는 cluster 단위로 분리하고, cluster 품질이 낮으면 결과를 "
        "`proxy-group CV`로 명시한다.",
        "- speaker cluster를 예측하지 못하도록 gradient reversal을 적용하는 실험은 "
        "cluster 안정성이 확인된 경우에만 수행한다.",
        "",
        "## RTX 4070 실행 우선순위",
        "",
        "1. emotion2vec+ base embedding을 14,606개에서 추출한다.",
        "2. package 500개 및 겹치는 pseudo-speaker cluster를 train에서 제외한다.",
        "3. frozen encoder + ordinal intensity head를 먼저 학습하고 제외된 500개에서 검증한다.",
        "4. 마지막 1~2개 encoder block 또는 LoRA만 풀어 intensity 모델을 미세조정한다.",
        "5. 49개 합의 라벨에 cross-fitted affine 및 bounded residual을 학습한다.",
        "6. clean/8k consistency를 추가하고 ablation으로 실제 개선 여부를 확인한다.",
        "7. audEERING·eGeMAPS·emotion2vec intensity bridge를 동일 proxy-group CV로 비교한다.",
        "",
        "## 사전 정의할 개발 게이트",
        "",
        "- nested/proxy-group CV CCC ≥ 0.50",
        "- MAE ≤ 10점",
        "- Spearman ≥ 0.50",
        "- telephone CCC drop ≤ 0.10",
        "- clean/telephone 평균 점수 차이 ≤ 5점",
        "- 상수 평균 baseline과 기존 audio-only 후보를 모두 이길 것",
        "- 이전 audio-only 후보는 이겨야 하지만, 실제 5인 강도를 입력으로 쓰는 oracle "
        "affine은 추론 시 사용할 수 없으므로 성능 상한 참고값으로만 둔다.",
        "",
        "이 게이트를 통과해도 새로운 독립 holdout이 없으므로 운영 성능을 입증한 것은 아니다. "
        "모델은 발표용·shadow 연구 후보로만 표현해야 한다.",
        "",
        "## 연구 근거",
        "",
        "- emotion2vec는 emotion-specific self-supervised representation이 소규모 downstream "
        "linear head에서도 강한 성능을 보인다고 보고한다: "
        "https://aclanthology.org/2024.findings-acl.931/",
        "- low-resource SER에서 task-adaptive/pseudo-label pretraining이 vanilla fine-tuning보다 "
        "효율적일 수 있다: https://arxiv.org/abs/2110.06309",
        "- unlabeled target-domain data와 unsupervised auxiliary loss가 cross-corpus CCC 개선에 "
        "도움이 될 수 있다: https://arxiv.org/abs/1905.02921",
        "- speaker-invariant adversarial learning은 SER 일반화 개선 가능성을 보였다: "
        "https://arxiv.org/abs/1903.09606",
        "",
        "## 남는 한계",
        "",
        "- 원본 5인 강도는 감정온도와 동일한 정의가 아니며 2단계 보정이 필수다.",
        "- 기존 20개 holdout은 이미 모델 선택 후 열렸으므로 앞으로 독립 테스트로 재사용할 수 없다.",
        "- pseudo-speaker cluster는 진짜 화자 ID의 대체물이 아니라 누수 완화 수단이다.",
        "- 현재 데이터는 일반 한국어 감정 음성으로 은행 콜 운영 도메인을 직접 증명하지 않는다.",
        "- emotion2vec Hugging Face 카드의 라이선스 표기가 `model-license`로 모호하므로 "
        "상용 활용 전 원 저작자·배포 조건을 별도로 확인해야 한다.",
        "",
    ]
    output_md_path.write_text("\n".join(lines), encoding="utf-8")
    return report
