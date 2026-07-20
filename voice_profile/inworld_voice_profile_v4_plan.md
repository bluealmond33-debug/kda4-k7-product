# Inworld STT Voice Profile 기반 v4 모델 적용 계획서

작성일: 2026-07-20  
프로젝트: K7 음성 기반 감정온도 예측 모델  
적용 대상 모델: 감정온도 모델 v4

---

## 1. 문서 목적

이 문서는 Inworld AI의 `STT Voice Profile` 기능을 조사하고, 해당 기능을 우리 프로젝트의 `감정온도 모델 v4`에 어떻게 활용할 수 있는지 정리하기 위한 계획서다.

우리 프로젝트의 최종 목표는 고객 음성을 입력으로 받아, 고객의 현재 감정적 고조 수준을 `감정온도 점수`로 산출하는 것이다.

기존 모델 방향은 다음과 같다.

```text
고객 음성
→ 음성 전처리
→ audeering/wav2vec2 기반 arousal, dominance, valence 추출
→ 기본 음성 피처 추출
→ LightGBM/XGBoost 등 회귀 모델
→ 감정온도 점수
```

Inworld STT Voice Profile은 이 구조에서 `외부 음성 프로파일링 피처`로 활용할 수 있다.

즉, Inworld 자체가 우리 모델의 정답 데이터가 되는 것이 아니라, Inworld가 음성에서 추출한 감정, 피치, 말투, 악센트 등의 예측값을 우리 모델의 추가 입력 피처로 사용하는 방식이다.

---

## 2. 참고 사이트

### 2.1 공식 사이트

| 구분 | 링크 | 설명 |
|---|---|---|
| Inworld AI 공식 홈페이지 | https://inworld.ai/ | Inworld 전체 제품 소개 |
| Inworld Platform | https://platform.inworld.ai/ | 계정 생성, API Key 발급 |
| Inworld STT 소개 | https://inworld.ai/speech-to-text | STT 및 Voice Profile 기능 소개 |
| Inworld Realtime API | https://inworld.ai/realtime-api | STT, LLM, TTS를 연결한 실시간 음성 파이프라인 |

### 2.2 Voice Profile 핵심 문서

| 구분 | 링크 | 설명 |
|---|---|---|
| STT Voice Profiling 소개 글 | https://inworld.ai/resources/stt-voice-profiling-api | 감정, 악센트, 나이, 피치, 발화 스타일 분석 소개 |
| Voice Profiles 공식 문서 | https://docs.inworld.ai/stt/voice-profiles | Voice Profile 반환값, 라벨, 설정 방법 설명 |
| STT Quickstart | https://docs.inworld.ai/stt/quickstart | Python/JavaScript 사용 예제 |
| Language Support | https://docs.inworld.ai/stt/languages | 지원 언어 목록. 한국어 `ko` 지원 |
| Authentication | https://docs.inworld.ai/admin/authentication | API 인증 방식 |

### 2.3 관련 기사 및 배경 자료

| 구분 | 링크 | 설명 |
|---|---|---|
| AI타임스 기사 | https://www.aitimes.com/news/articleView.html?idxno=210217 | Inworld의 실시간 음성 AI 관련 기사 |
| Realtime TTS-2 소개 | https://inworld.ai/blog/realtime-tts-2 | 감정과 대화 맥락을 반영하는 TTS-2 소개 |

---

## 3. Inworld STT Voice Profile이란?

Inworld STT Voice Profile은 음성을 텍스트로 변환하는 STT 기능에 더해, 사용자의 목소리에서 추가적인 음성 특성을 분석해 주는 기능이다.

일반 STT는 보통 다음 결과만 제공한다.

```text
음성 → 텍스트
```

반면 Inworld STT Voice Profile은 다음과 같은 구조다.

```text
음성
→ STT 텍스트
→ 감정 라벨
→ 피치 라벨
→ 발화 스타일 라벨
→ 악센트/방언 신호
→ 나이대 추정
```

공식 문서 기준으로 Voice Profile은 `Age`, `Emotion`, `Pitch`, `Vocal Style`, `Accent`를 반환하며, 각 결과에는 `label`과 `confidence`가 포함된다.

---

## 4. 입력과 출력

### 4.1 입력

입력은 음성 데이터다.

사용 가능한 방식은 두 가지다.

| 방식 | 설명 | 우리 프로젝트 적용 |
|---|---|---|
| 파일 업로드 | wav, mp3, ogg, flac 등 음성 파일을 API로 전송 | AI Hub 샘플 또는 test 음성 분석 |
| 실시간 스트리밍 | WebSocket으로 통화 음성을 실시간 전송 | 실제 콜센터 데모 시나리오 |

권장 음성 설정은 다음과 같다.

| 항목 | 권장값 |
|---|---|
| 샘플레이트 | 16kHz |
| 비트 | 16-bit |
| 채널 | mono |
| 스트리밍 포맷 | LINEAR16 PCM |
| 파일 업로드 포맷 | LINEAR16, MP3, OGG_OPUS, FLAC, AUTO_DETECT |

한국어는 `language: "ko"`로 지정할 수 있다.

### 4.2 출력

출력은 JSON 형태다.

예상 구조는 다음과 같다.

```json
{
  "transcription": {
    "transcript": "상담 내용 텍스트",
    "isFinal": true
  },
  "voiceProfile": {
    "emotion": [
      { "label": "angry", "confidence": 0.72 },
      { "label": "neutral", "confidence": 0.18 }
    ],
    "pitch": [
      { "label": "high", "confidence": 0.81 }
    ],
    "vocalStyle": [
      { "label": "shouting", "confidence": 0.67 }
    ],
    "accent": [
      { "label": "ko", "confidence": 0.55 }
    ],
    "age": [
      { "label": "adult", "confidence": 0.78 }
    ]
  },
  "usage": {
    "transcribedAudioMs": 3200,
    "modelId": "inworld/inworld-stt-1"
  }
}
```

중요한 점은 이 JSON이 `정답 데이터`가 아니라는 것이다.

이 JSON은 Inworld 모델의 예측 결과다. 따라서 우리 프로젝트에서는 `ground truth`가 아니라 `external prediction`, `external feature`, `silver signal`로 표현해야 한다.

---

## 5. Voice Profile 주요 라벨

### 5.1 Emotion

| 라벨 | 의미 | 감정온도와의 관계 |
|---|---|---|
| tender | 부드럽고 다정한 톤 | 낮음 |
| sad | 슬픔, 우울한 톤 | 중간 또는 낮음 |
| calm | 차분함 | 낮음 |
| neutral | 뚜렷한 감정 없음 | 낮음 |
| happy | 밝고 긍정적 | 낮음 또는 중간 |
| angry | 분노, 공격적, 불만 | 높음 |
| fearful | 불안, 두려움 | 높음 |
| surprised | 놀람 | 중간 또는 높음 |
| disgusted | 혐오, 강한 불쾌감 | 높음 |
| unclear | 판단 어려움 | 품질/불확실성 신호 |

### 5.2 Pitch

| 라벨 | 의미 | 감정온도와의 관계 |
|---|---|---|
| low | 낮은 피치 | 단독으로는 낮음 또는 중립 |
| medium | 중간 피치 | 중립 |
| high | 높은 피치 | 긴장, 흥분, 고조 가능성 |

### 5.3 Vocal Style

| 라벨 | 의미 | 감정온도와의 관계 |
|---|---|---|
| normal | 일반 발화 | 중립 |
| whispering | 속삭임 | 낮음 또는 특수 상황 |
| mumbling | 웅얼거림 | 불명확, 품질 이슈 가능 |
| crying | 울음 섞인 말 | 고조 가능성 |
| laughing | 웃음 섞인 말 | 상황에 따라 낮음 또는 중간 |
| shouting | 소리침 | 높음 |
| monotone | 단조로운 말투 | 낮음 또는 무기력 |
| singing | 노래하듯 말함 | 콜센터 상황에서는 예외값 |
| unclear | 판단 어려움 | 품질/불확실성 신호 |

### 5.4 Accent

Accent는 지역적 억양 또는 언어적 배경을 나타내는 신호다.

공식 문서에서는 BCP-47 형태의 locale code를 반환한다고 설명한다. 예시는 `en-US`, `en-GB`, `zh-CN` 등이다.

한국어의 경우 `ko`는 STT 지원 언어에 포함되어 있으나, 공식 문서만으로는 `경상도`, `전라도`, `제주도`처럼 한국 내부 방언을 세밀하게 구분해 주는지 확정하기 어렵다.

따라서 우리 프로젝트에서는 accent를 다음처럼 다룬다.

```text
방언 정답 라벨이 아니라,
발화자 억양 또는 언어 배경에 대한 확률적 참고 신호
```

---

## 6. 우리 v4 모델에서의 활용 방향

### 6.1 v4 모델의 목표

v4 모델의 목표는 기존 음성 피처만 사용한 모델보다 더 안정적으로 감정온도 점수를 예측하는 것이다.

기존 v3까지의 가정 구조를 다음과 같이 둔다.

```text
기본 음성 피처
+ audeering arousal/dominance/valence
→ 감정온도 예측
```

v4에서는 여기에 Inworld Voice Profile 피처를 추가한다.

```text
기본 음성 피처
+ audeering arousal/dominance/valence
+ Inworld emotion/pitch/vocalStyle/accent confidence
→ 감정온도 예측
```

### 6.2 Inworld 피처 추가 방식

Inworld 결과 JSON을 CSV 피처로 변환한다.

예시:

```csv
audio_id,inworld_angry,inworld_fearful,inworld_sad,inworld_calm,inworld_neutral,inworld_pitch_high,inworld_vocal_shouting,inworld_vocal_crying,inworld_unclear
0001,0.72,0.13,0.04,0.01,0.08,0.81,0.67,0.02,0.00
0002,0.05,0.03,0.12,0.64,0.21,0.14,0.00,0.00,0.01
```

추천 피처 목록은 다음과 같다.

| 피처명 | 원천 | 설명 |
|---|---|---|
| `inworld_emotion_angry` | emotion | 분노 confidence |
| `inworld_emotion_fearful` | emotion | 불안/두려움 confidence |
| `inworld_emotion_disgusted` | emotion | 불쾌감 confidence |
| `inworld_emotion_sad` | emotion | 슬픔 confidence |
| `inworld_emotion_calm` | emotion | 차분함 confidence |
| `inworld_emotion_neutral` | emotion | 중립 confidence |
| `inworld_emotion_unclear` | emotion | 감정 판단 불확실 |
| `inworld_pitch_high` | pitch | 높은 피치 confidence |
| `inworld_pitch_medium` | pitch | 중간 피치 confidence |
| `inworld_pitch_low` | pitch | 낮은 피치 confidence |
| `inworld_vocal_shouting` | vocalStyle | 소리침 confidence |
| `inworld_vocal_crying` | vocalStyle | 울음 confidence |
| `inworld_vocal_mumbling` | vocalStyle | 웅얼거림 confidence |
| `inworld_vocal_monotone` | vocalStyle | 단조로움 confidence |
| `inworld_vocal_unclear` | vocalStyle | 말투 판단 불확실 |
| `inworld_accent_top_label` | accent | 가장 높은 accent 라벨 |
| `inworld_accent_top_confidence` | accent | accent confidence |

v4 모델에는 문자열 라벨인 `accent_top_label`을 그대로 넣지 않고, 필요 시 one-hot encoding 또는 빈도 기반 encoding을 적용한다.

---

## 7. v4 모델 학습 설계

### 7.1 데이터 흐름

```text
1. 원본 음성 파일 준비
2. 음성 전처리
   - 16kHz
   - mono
   - 음량/무음/길이 품질 체크
3. audeering 피처 추출
   - arousal
   - dominance
   - valence
4. 기본 음성 피처 추출
   - duration
   - mean_dbfs
   - rms
   - zero_crossing_rate
   - speaking_rate proxy
5. Inworld API 호출
   - transcript
   - emotion confidence
   - pitch confidence
   - vocalStyle confidence
   - accent confidence
6. feature table 병합
7. 감정온도 라벨과 연결
8. LightGBM/XGBoost 회귀 모델 학습
9. 0~100 감정온도 점수 예측
10. 안정/주의/고조 3단계 구간화
```

### 7.2 실험군 설계

v4에서 Inworld가 실제로 도움이 되는지 확인하려면 모델을 나누어 비교해야 한다.

| 실험 | 사용 피처 | 목적 |
|---|---|---|
| Baseline A | 기본 음성 피처만 | 가장 단순한 기준 모델 |
| Baseline B | 기본 음성 피처 + audeering | 기존 핵심 모델 |
| v4-A | 기본 음성 피처 + Inworld | Inworld 단독 효과 확인 |
| v4-B | 기본 음성 피처 + audeering + Inworld | 최종 v4 후보 |

가장 중요한 비교는 `Baseline B`와 `v4-B`다.

```text
Baseline B보다 v4-B의 성능이 좋아지면,
Inworld Voice Profile 피처가 감정온도 예측에 추가적인 설명력을 제공했다고 볼 수 있다.
```

---

## 8. 모델 성능 향상 가설

Inworld Voice Profile이 v4 성능을 높일 수 있는 이유는 다음과 같다.

### 8.1 감정 라벨을 직접 제공

audeering은 `arousal`, `dominance`, `valence`처럼 해석이 추상적인 값을 제공한다.

반면 Inworld는 `angry`, `fearful`, `calm`, `shouting`처럼 사람이 이해하기 쉬운 라벨을 제공한다.

따라서 모델이 감정온도를 예측할 때 더 직접적인 단서를 얻을 수 있다.

### 8.2 발화 스타일을 별도 피처로 제공

감정온도는 단순히 감정 라벨만으로 결정되지 않는다.

예를 들어 같은 `angry`라도 조용히 말하는 분노와 소리치는 분노는 상담 대응 난이도가 다를 수 있다.

Inworld의 `vocalStyle`은 이 차이를 보완할 수 있다.

```text
angry 낮음 + shouting 높음
→ 격앙된 상태일 가능성

sad 높음 + crying 높음
→ 감정적 고조 가능성

calm 높음 + normal 높음
→ 안정 상태 가능성
```

### 8.3 pitch 신호 보완

피치 변화는 긴장, 흥분, 불안, 긴급성과 연관될 수 있다.

기본 음성 피처에서 pitch를 직접 안정적으로 계산하기 어렵다면, Inworld의 `pitch` confidence를 보조 피처로 활용할 수 있다.

### 8.4 품질/불확실성 판단에 도움

`unclear`, `mumbling`, 낮은 confidence는 모델 결과를 무조건 믿기 어렵다는 신호가 될 수 있다.

v4에서는 이런 값을 `불확실성 피처`로 사용한다.

예:

```text
inworld_emotion_unclear가 높음
→ 감정온도 예측 confidence 낮춤

inworld_vocal_mumbling이 높음
→ STT 결과보다는 음성 피처 중심으로 판단
```

---

## 9. 감정온도 점수 변환 예시

Inworld는 감정온도 점수를 직접 제공하지 않는다.

따라서 v4에서 사용할 수 있는 1차 규칙 기반 변환식은 다음과 같다.

```text
inworld_temperature_proxy =
  angry * 45
+ fearful * 20
+ disgusted * 15
+ surprised * 8
+ shouting * 10
+ crying * 7
+ high_pitch * 5
- calm * 15
- neutral * 10
```

이 값은 최종 점수가 아니라 보조 피처로 사용한다.

```text
최종 모델 입력 피처:
- audeering_arousal
- audeering_valence
- mean_dbfs
- duration
- inworld_angry
- inworld_shouting
- inworld_pitch_high
- inworld_temperature_proxy
```

주의할 점:

```text
inworld_temperature_proxy는 정답이 아니다.
모델 학습을 돕기 위한 외부 모델 기반 보조 신호다.
```

---

## 10. 구현 계획

### 10.1 산출 파일

| 파일 | 설명 |
|---|---|
| `inworld_voice_profile_raw.jsonl` | 음성별 Inworld 원본 응답 저장 |
| `inworld_voice_profile_features.csv` | 모델 학습용 피처 테이블 |
| `train_features_v4.csv` | 기존 피처 + Inworld 피처 병합 결과 |
| `model_v4_lgbm.pkl` | v4 LightGBM 모델 |
| `model_v4_xgboost.pkl` | v4 XGBoost 모델 |
| `evaluation_v4_report.md` | v4 성능 비교 리포트 |

### 10.2 API 호출 스크립트

생성할 스크립트 예시:

```text
scripts/extract_inworld_voice_profile.py
```

역할:

```text
입력:
- audio manifest CSV
- audio_path
- audio_id

처리:
- 음성 파일 읽기
- base64 인코딩
- Inworld STT API 호출
- voiceProfile JSON 저장
- 실패/재시도 처리

출력:
- raw JSONL
- feature CSV
```

### 10.3 API 요청 설정

```json
{
  "transcribeConfig": {
    "modelId": "inworld/inworld-stt-1",
    "language": "ko",
    "audioEncoding": "AUTO_DETECT",
    "voiceProfileConfig": {
      "enableVoiceProfile": true,
      "topN": 10
    }
  },
  "audioData": {
    "content": "base64-encoded-audio"
  }
}
```

---

## 11. 평가 기준

### 11.1 회귀 성능

감정온도 점수는 0~100 연속값이므로 회귀 성능을 본다.

| 지표 | 의미 |
|---|---|
| MAE | 평균 절대 오차. 낮을수록 좋음 |
| RMSE | 큰 오류에 민감한 오차. 낮을수록 좋음 |
| Spearman correlation | 사람이 느끼는 순서와 모델 점수 순서가 비슷한지 |

### 11.2 3단계 분류 성능

최종 서비스/발표에서는 3단계 구간도 중요하다.

| 구간 | 점수 |
|---|---|
| 안정 | 0~33 |
| 주의 | 34~66 |
| 고조 | 67~100 |

평가 지표:

| 지표 | 의미 |
|---|---|
| Accuracy | 3단계 분류 정확도 |
| Macro F1 | 각 구간별 균형 성능 |
| Confusion Matrix | 안정/주의/고조 오분류 패턴 확인 |

### 11.3 성공 기준

v4 성공 기준은 다음과 같이 둔다.

```text
1. Baseline B보다 v4-B의 MAE가 감소한다.
2. 고조 구간의 Recall이 개선된다.
3. 사람이 들어봤을 때 고조로 느껴지는 샘플에서 Inworld angry/shouting/high_pitch가 의미 있게 높게 나타난다.
4. Inworld 피처가 없는 모델보다 결과 해석이 쉬워진다.
```

---

## 12. 개인정보 및 사용상 주의점

Inworld STT Voice Profile은 외부 API다.

따라서 실제 고객 음성을 사용하면 다음 이슈가 생길 수 있다.

| 이슈 | 설명 |
|---|---|
| 개인정보 | 고객 음성이 외부 서버로 전송됨 |
| 녹음 고지 | 고객에게 녹음 및 분석 사실 고지가 필요할 수 있음 |
| 외부 위탁 | 금융권에서는 외부 API 처리 계약 검토 필요 |
| 국외 이전 | 서버 위치에 따라 국외 이전 이슈 가능 |
| 약관 | API 출력값을 모델 학습에 사용 가능한지 약관 확인 필요 |

대학생 프로젝트에서는 실제 고객 음성이 아니라 다음 데이터를 사용하는 것이 안전하다.

```text
- AI Hub 공개 데이터
- 팀원이 직접 녹음한 테스트 음성
- 개인정보가 없는 샘플 음성
- 합성 음성 또는 비식별 음성
```

---

## 13. 리스크와 대응

| 리스크 | 문제 | 대응 |
|---|---|---|
| API 비용 | 데이터가 많으면 비용 증가 | 일부 샘플만 먼저 실험 |
| 외부 의존성 | API 장애/정책 변경 가능 | Inworld 없이도 작동하는 Baseline 유지 |
| 정답 착각 | Inworld 결과를 정답처럼 사용할 위험 | external prediction으로 명확히 표기 |
| 한국어 방언 한계 | 국내 사투리 세부 구분 불확실 | accent는 보조 신호로만 사용 |
| 개인정보 이슈 | 실제 고객 음성 외부 전송 위험 | 공개/테스트 데이터만 사용 |
| 학습 사용 약관 | API 결과를 학습에 써도 되는지 불확실 | 약관 확인 후 피처/비교 용도부터 사용 |

---

## 14. v4 최종 모델 구조 제안

최종 v4 구조는 다음과 같다.

```text
음성 파일
   |
   |-- 전처리
   |     |-- 16kHz mono 변환
   |     |-- 음량/무음/길이 품질 검사
   |
   |-- 기본 음성 피처
   |     |-- duration
   |     |-- mean_dbfs
   |     |-- rms
   |     |-- zcr
   |
   |-- audeering 피처
   |     |-- arousal
   |     |-- dominance
   |     |-- valence
   |
   |-- Inworld Voice Profile 피처
   |     |-- emotion confidence
   |     |-- pitch confidence
   |     |-- vocalStyle confidence
   |     |-- accent confidence
   |
   → feature merge
   → LightGBM/XGBoost Regressor
   → emotion_temperature_score
   → 안정/주의/고조
```

---

## 15. 보고서 표현 예시

프로젝트 보고서에는 다음처럼 표현하는 것이 좋다.

```text
본 프로젝트에서는 음성 기반 감정온도 예측 성능 향상을 위해 Inworld STT Voice Profile API를 외부 음성 프로파일링 피처로 활용하는 v4 구조를 설계하였다.

Inworld Voice Profile은 입력 음성에 대해 감정, 피치, 발화 스타일, 악센트 등의 라벨과 confidence를 JSON 형태로 반환한다. 해당 결과는 정답 라벨이 아니므로 ground truth로 사용하지 않고, 외부 모델 기반 보조 피처로 사용하였다.

v4 모델에서는 기존 audeering 기반 arousal/dominance/valence 피처와 기본 음성 통계 피처에 Inworld emotion/pitch/vocalStyle confidence를 추가하여 LightGBM/XGBoost 회귀 모델의 감정온도 예측 성능 향상을 검증한다.
```

---

## 16. 다음 작업

1. Inworld 계정 생성 및 API Key 발급
2. API 사용 약관 확인
3. 테스트 음성 5~10개로 API 호출 실험
4. JSON 응답 구조 저장
5. `inworld_voice_profile_features.csv` 생성
6. 기존 feature table과 병합
7. Baseline B와 v4-B 성능 비교
8. 평가 결과를 `evaluation_v4_report.md`로 정리

---

## 17. 결론

Inworld STT Voice Profile은 우리 감정온도 모델을 대체하는 모델이 아니라, v4 모델의 성능과 해석력을 높이기 위한 외부 음성 프로파일링 피처로 활용하는 것이 가장 적절하다.

특히 `angry`, `fearful`, `disgusted`, `shouting`, `crying`, `high pitch` 같은 결과는 감정온도와 직접적으로 연결될 수 있다.

다만 Inworld 결과는 정답 데이터가 아니라 예측값이므로, 최종 모델의 정답 라벨은 AI Hub 데이터 또는 사람이 직접 라벨링한 감정온도 점수를 기준으로 두어야 한다.
