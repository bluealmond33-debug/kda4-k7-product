"""3단계 감정분석 파트 — MVP 스텁.

⚠️ 임시 구현 — 원래 감정분석은 전형진 팀 담당(팀 R&R 최종안 기준, 카테고리별 가중치 키워드 사전
방식). 이 파일은 그 팀 산출물이 아직 없어서 만든 자리채움이며, 전형진 팀 로직 도착하면 교체될 예정.


실제로는 Wav2Vec2 기반 한국어 감정인식 모델(GPU 권장, 별도 라이선스 확인 필요)로
분노/불안/중립 확률과 모델 불확실성을 산출해야 하지만, MVP 단계에서는
오디오 길이를 시드로 한 고정 의사난수로 대체한다.

시그니처(오디오 바이트 입력 -> EmotionResult 출력)만 실제 모델과 동일하게 맞춰뒀으므로,
나중에 이 함수 본문만 실제 추론 코드로 교체하면 나머지 파이프라인은 변경할 필요가 없다.
"""

import hashlib
import random

from app.schemas import EmotionResult


def analyze_emotion(audio_bytes: bytes) -> EmotionResult:
    seed = int(hashlib.sha256(audio_bytes).hexdigest(), 16) % (2**32)
    rng = random.Random(seed)

    anger = rng.uniform(0.0, 0.4)
    anxiety = rng.uniform(0.0, 0.4)
    neutral = max(0.0, 1.0 - anger - anxiety)
    uncertainty = rng.uniform(0.05, 0.35)

    return EmotionResult(
        anger_probability=round(anger, 3),
        anxiety_probability=round(anxiety, 3),
        neutral_probability=round(neutral, 3),
        uncertainty=round(uncertainty, 3),
    )
