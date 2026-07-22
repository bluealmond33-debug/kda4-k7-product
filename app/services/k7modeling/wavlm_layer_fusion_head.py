"""WavLM 계층융합 분노 head 정의 (추론 전용 이식본).

원본: hippo 연구 브랜치 `agent/anger-model-handoff`의
`app/services/k7modeling/anger_layer_fusion.py`(LAYERS, WeightedLayerMLP) +
`wavlm_alternative.py`(MODEL_ID). 학습 trainer/baseline 코드는 라이브 추론에 불필요해
제외하고, 런타임(wavlm_layer_fusion_runtime.py)이 실제로 쓰는 심볼만 원문 그대로 옮겼다.

⚠️ 클래스 구조·register_buffer·레이어 이름/차원을 절대 바꾸지 말 것 — 학습된 `.pt`
체크포인트의 state_dict가 이 정의와 1:1로 맞아야 `load_state_dict`가 성공한다.
"""

from __future__ import annotations

import numpy as np
import torch
from torch import nn

# WavLM encoder에서 통계 특징(mean+std)을 뽑는 계층 (3·6·9·12).
LAYERS = (3, 6, 9, 12)

# frozen backbone. HF 캐시에 미리 받아둬야 한다(runtime은 local_files_only로 로드).
MODEL_ID = "microsoft/wavlm-base-plus"


class WeightedLayerMLP(nn.Module):
    """계층별 학습가중 결합 + MLP 이진 head. 원문(anger_layer_fusion.py:78) 그대로."""

    def __init__(self, mean: np.ndarray, std: np.ndarray) -> None:
        super().__init__()
        self.register_buffer("mean", torch.from_numpy(mean))
        self.register_buffer("std", torch.from_numpy(std))
        self.layer_logits = nn.Parameter(torch.zeros(len(LAYERS)))
        self.network = nn.Sequential(
            nn.Linear(1536, 256), nn.GELU(), nn.Dropout(0.2),
            nn.Linear(256, 64), nn.GELU(), nn.Dropout(0.15), nn.Linear(64, 1),
        )

    def forward(self, values: torch.Tensor) -> torch.Tensor:
        normalized = (values - self.mean) / self.std
        weights = torch.softmax(self.layer_logits, dim=0)
        fused = (normalized * weights.view(1, -1, 1)).sum(dim=1)
        return self.network(fused).squeeze(-1)
