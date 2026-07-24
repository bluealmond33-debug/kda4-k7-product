# K7 음성·텍스트 이중 분석 파이프라인

## 확정된 MVP 흐름

고객 통화가 끝나 완성된 음성 파일을 얻으면 FastAPI가 `call_id`를 먼저 발급합니다. 같은 음성 바이트를 두 갈래로 전달합니다.

```mermaid
flowchart LR
    A["완성 통화 음성 파일"] --> B["FastAPI call_id 선발급"]

    B --> C["Whisper STT"]
    C --> D["STT 텍스트"]
    D --> E["OpenAI"]
    E --> F["요약·업무분류·라우팅·위험도"]

    B --> G["동일 원본 음성"]
    G --> H["음성 감정 모델"]
    H --> I["감정 점수·단계·음질"]

    F --> J["call_id 기준 결과 결합"]
    I --> J
    J --> K["K7 어댑터·mvp-1.1 검증"]
    K --> L[("PostgreSQL 3테이블 저장")]
    L --> M["상담카드 API"]
    M --> N["Vercel 상담사 화면"]
```

텍스트 분석에는 STT 텍스트만 전달합니다. 음성 감정 분석에는 같은 원본 음성만 전달합니다. STT 텍스트·키워드·문자열 바이트를 음성 감정 모델 결과로 사용할 수 없습니다.

## 현재 MVP와 향후 실시간 기능의 구분

현재 구현은 전화 통신망이나 WebSocket 실시간 STT가 아닙니다. 녹음 또는 업로드가 끝난 완성 음성 파일 전체를 한 요청에서 처리합니다.

```text
현재 MVP
통화 녹음 완료 → 음성 파일 업로드 → STT/OpenAI + 음성 감정 → 저장

향후 확장
실시간 전화망 → 스트리밍 STT와 별도 녹음 → 통화 종료 후 감정 분석
```

실시간 STT를 추가해도 음성 감정 분석용 원본 녹음은 별도로 보존해야 합니다. 이 확장은 이번 MVP 완료 조건이 아닙니다.

## `call_id` 생성 시점

`call_id`는 STT와 모델 호출보다 먼저 생성합니다. 텍스트 결과와 음성 감정 결과가 같은 상담에 속하는지를 검증하는 결합 키입니다.

```text
call_id 생성
├─ call_id + audio → STT → OpenAI 결과
└─ call_id + same audio → 음성 감정 결과
                      ↓
external_session_key == call_id 확인
```

음성 감정 결과의 `external_session_key`가 `call_id`와 다르면 다른 통화 결과가 섞일 위험이 있으므로 저장을 거절합니다.

## 음성 감정 모델 입력 계약

모델 서버 요청의 최소 의미는 다음과 같습니다. 전송 형식은 모델팀과 합의해 `multipart/form-data` 또는 승인된 바이너리 방식으로 정할 수 있습니다.

```text
call_id: FastAPI가 선발급한 UUID
audio: 고객의 동일 원본 음성 파일 또는 바이트
```

모델 서버 응답은 `database/contracts/emotion_temperature_result.schema.json`을 따릅니다.

```json
{
  "schema_version": "1.0",
  "external_session_key": "94650acb-f213-49ee-a94e-87dfd645cc40",
  "result_key": "K7-EMOTION-0001",
  "model_name": "team-audio-emotion",
  "model_version": "0.1.0",
  "analysis_status": "completed",
  "emotion_temperature_score": 74,
  "emotion_temperature_level": "elevated",
  "voice_arousal_score": 70,
  "voice_dominance_score": 58,
  "voice_valence_score": 28,
  "negative_activation_score": 50.4,
  "audio_quality": "normal",
  "failure_code": null,
  "generated_at": "2026-07-16T08:00:00Z"
}
```

점수 규칙:

| 점수 | 단계 |
|---:|---|
| 0 이상 33 이하 | `stable` |
| 33 초과 66 이하 | `caution` |
| 66 초과 100 이하 | `elevated` |

분석 실패·분석 불가일 때는 점수와 단계를 `null`로 보내고 `failure_code`를 반드시 보냅니다. K7 상담카드는 가짜 점수를 만들지 않고 `emotion.status=unavailable`로 저장합니다.

활성 상담카드의 감정 상태는 `unavailable | completed`만 허용합니다. `demo` 상태는 계약·프론트·PostgreSQL에서 모두 거절합니다.

## 통합 모듈의 처리

`backend/app/emotion_adapter.py`가 음성 모델 응답을 검증합니다.

1. 허용되지 않은 추가 필드 거절
2. `schema_version=1.0` 확인
3. `external_session_key == call_id` 확인
4. 점수 범위와 단계 조합 확인
5. 실패 응답에 가짜 점수가 없는지 확인
6. 활성 `MvpEmotionResult`로 변환

`backend/app/integration_service.py`는 OpenAI 결과와 음성 감정 결과를 합쳐 하나의 `mvp-1.1` 상담카드를 만들고 한 트랜잭션으로 저장합니다.

## PostgreSQL 저장

테이블은 MVP 최소 구조인 세 개를 유지합니다.

```text
calls
transcripts
consultation_cards
```

`consultation_cards`에는 다음 두 형태를 함께 보관합니다.

- 표준 감정 컬럼: `emotion_status`, `emotion_score`, `emotion_level`, `emotion_reason`
- 원시 추적 데이터: `raw_emotion_result JSONB`

원시 JSON은 모델 버전·음질·보조 점수 등을 추적하기 위한 것이며 화면은 표준 감정 컬럼만 사용합니다.

## 음성 파일 보관 정책

현재 MVP는 음성 파일을 PostgreSQL에 넣거나 장기 보관하지 않습니다.

```text
음성 파일/바이트
→ 한 요청 동안 STT와 감정 모델에 전달
→ 분석 결과만 PostgreSQL 저장
```

화면·DB에는 `audio_filename`만 기록됩니다. 추후 음성 재생이나 비동기 재분석이 필요하면 S3·Cloudflare R2 같은 객체 저장소를 별도 설계해야 합니다.

## 팀별 연결

| 담당 | 제공할 것 | 통합 모듈이 하는 일 |
|---|---|---|
| 이희창 | 통화 음성·STT·FastAPI 파이프라인 | `call_id` 선발급 후 두 분석 갈래 조립 |
| 요약·분류 담당 | STT 텍스트 기반 OpenAI 결과 | K7 업무·부서·위험도 계약으로 정규화 |
| 음성 감정 담당 | 원본 음성 기반 점수·단계·음질 | 음성 전용 계약 검증 및 가짜 점수 차단 |
| 이찬희 | 계약·어댑터·DB·저장/조회 경계 | 두 결과 결합·트랜잭션 저장·재조회 보장 |
| Vercel 담당 | React 상담사 화면 | 통합 상담카드 API 응답 표시 |
