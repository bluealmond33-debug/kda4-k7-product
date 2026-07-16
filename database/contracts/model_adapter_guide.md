# 변경 가능한 모델 결과 연동 가이드

> 참고용 확장 설계: 이 문서의 12테이블·마스킹 계약과 `database/adapters/` 변환기는 현재 `mvp-1.0` 배포 경로가 아닙니다. 활성 MVP 모델 경계는 `backend/app/model_adapter.py`, 최종 응답은 `mvp_call_response.schema.json`, 활성 목록은 `database/active-manifest.json`을 따릅니다.

## 1. 목적

STT·감정·분류·요약·라우팅 모델은 학습과 라벨링 과정에서 출력 필드가 바뀔 수 있습니다. PostgreSQL 스키마가 모델 실험 구조를 직접 따라가면 모델이 바뀔 때마다 DB·FastAPI·React를 함께 수정해야 합니다.

K7 MVP는 모델의 원시 출력을 DB에 바로 넣지 않고, FastAPI의 작은 변환 계층인 **어댑터(adapter)** 를 거쳐 프로젝트 표준 JSON으로 바꿉니다.

```text
변경 가능한 모델 출력
        │
        ▼
FastAPI 모델별 어댑터
  - 필드명 변환
  - 상담 키 연결
  - 점수·상태 검증
  - 불필요한 원시 필드 제거
        │
        ▼
database/contracts/*.schema.json
  - K7의 안정적인 운영 계약
        │
        ▼
commands.sql → PostgreSQL → 통합 상담카드 → React
```

이 가이드는 특정 모델 저장소의 현재 필드명을 영구 표준으로 정하지 않습니다.

## 2. 현재 데이터 자료의 역할

| 자료 | 역할 | 운영 DB에 직접 저장하는가 |
|---|---|---|
| [AI Hub 263 감정 분류용 대화 음성](https://www.aihub.or.kr/aihubdata/data/view.do?dataSetSn=263) | 음성 특징·감정온도 모델 개발 | 아니요 |
| [AI Hub 71926 금융분야 고객상담 데이터](https://www.aihub.or.kr/aihubdata/data/view.do?dataSetSn=71926) | 문의 분류·요약·질문응답 모델 개발 | 아니요 |
| [huk3475/Dataset](https://github.com/huk3475/Dataset) | 모델링 코드·라벨링·실험·중간 산출물 | 아니요 |
| K7 모델의 상담별 최종 추론 결과 | 상담카드 생성과 화면 표시 | 예 |

WAV·학습 JSON·CSV·Parquet·embedding·세그먼트별 원시 예측은 모델 저장소 또는 승인된 데이터 저장소에 둡니다. PostgreSQL에는 실제 상담 처리에 필요한 정규화된 결과만 저장합니다.

## 3. 바뀌지 않는 공통 경계

모델 구현과 관계없이 다음 값은 K7 운영 계약에서 유지합니다.

| 공통 값 | 의미 |
|---|---|
| `external_session_key` | 같은 통화를 연결하는 팀 공통 키 |
| `result_key` | 같은 추론의 중복 저장을 막는 멱등 키 |
| `model_name` | 어떤 모델 계열이 결과를 만들었는지 식별 |
| `model_version` | 재현 가능한 모델·보정 조합 버전 |
| `analysis_status` | 정상 완료·사용 불가·실패 상태 |
| `generated_at` | 모델 결과가 생성된 UTC 시각 |
| `schema_version` | K7 표준 JSON 계약 버전 |

모델팀이 `call_id`, `conversation_id`, `session_key` 등 다른 이름을 사용해도 어댑터가 `external_session_key`로 변환합니다.

## 4. 감정온도 모델 연결

### 표준 출력

FastAPI가 최종적으로 만들어야 하는 형식은 다음 파일입니다.

- 검증 규격: `emotion_temperature_result.schema.json`
- 정상 예제: `examples/emotion_temperature_result.example.json`
- 저장 명령: `../commands.sql`의 `save_emotion_temperature_result`

### 현재 모델링 저장소와의 예시 매핑

아래 표는 2026-07-16에 확인한 중간 구조의 참고 예시이며 고정 계약이 아닙니다.

| 변경 가능한 모델 필드 | K7 표준 필드 | 변환 원칙 |
|---|---|---|
| `call_id` | `external_session_key` | FastAPI가 현재 상담 키와 동일한지 확인 |
| `segment_id` | `result_key`의 일부 | 모델명·버전·세그먼트 키로 결정적 키 생성 |
| `emotion_temperature_score` | 동일 | 사람 평가·보정이 끝난 0~100 점수만 허용 |
| `model_version` | 동일 | 보정이 별도면 모델 버전에 함께 식별 |
| `created_at` | `generated_at` | ISO 8601 UTC로 변환 |
| `audio_quality.status/flags` | `audio_quality` | K7의 단일 품질 코드로 정규화 |
| `emotion_temperature_confidence` | 현재 저장하지 않음 | 모델 측 평가·관측 자료로 유지 |
| `emotion_temperature_raw` | 현재 저장하지 않음 | 보정 전 원값을 운영 점수로 사용 금지 |

현재 K7 품질 코드는 `normal`, `low_volume`, `noisy`, `too_short`, `unavailable`입니다. 모델의 품질 플래그가 달라지면 모델별 어댑터 안에서 이 코드로 변환합니다.

### 세그먼트 결과와 상담 결과

음성 모델은 한 통화를 여러 구간으로 나누어 예측할 수 있습니다. K7 운영 DB의 `model_analysis_results`는 현재 상담카드에 사용할 **상담 단위 최종 결과**를 저장합니다.

```text
세그먼트 1 예측 ┐
세그먼트 2 예측 ├─ 모델팀 집계·보정 ─→ 상담 단위 최종 결과 ─→ K7 표준 계약
세그먼트 3 예측 ┘
```

세그먼트별 원시 결과는 지금 DB에 추가하지 않습니다. 실제 화면이나 운영 검증에서 필요해질 때 별도 요구사항으로 판단합니다.

### 아직 보정되지 않은 모델

zero-shot 원값이나 사람 평가가 끝나지 않은 점수는 `completed` 운영 결과로 보내지 않습니다.

```json
{
  "schema_version": "1.0",
  "external_session_key": "K7-DEMO-20260715-0001",
  "result_key": "emotion-shadow-v0.1:K7-DEMO-20260715-0001",
  "model_name": "k7-emotion-shadow",
  "model_version": "0.1.0",
  "analysis_status": "unavailable",
  "emotion_temperature_score": null,
  "emotion_temperature_level": null,
  "audio_quality": "normal",
  "failure_code": "MODEL_NOT_CALIBRATED",
  "generated_at": "2026-07-16T00:00:00Z"
}
```

시연용 고정 mock 점수와 실제 모델 성능 주장은 구분합니다.

## 5. 문의 분류·요약 모델 연결

AI Hub 71926 같은 텍스트 학습 데이터의 원본 JSON 구조를 그대로 DB에 넣지 않습니다. 모델 결과를 다음 K7 운영 값으로 변환합니다.

현재 팀에서 전달 가능한 결합형 결과는 다음 임시 계약으로 먼저 검증합니다.

- 입력 규격: `model_consultation_result_input.schema.json`
- 위험정보 포함 예제: `examples/model_consultation_result_input.example.json`
- 위험정보 미제공 예제: `examples/model_consultation_result_input_no_risk.example.json`
- 실행 가능한 참조 변환기: `../adapters/model_result_adapter.py`
- 수정 가능한 업무·부서 매핑: `../adapters/model_result_mapping.v1.json`

```text
결합형 모델 입력
  ├─ summary·business_type·incident_risk ─→ 상담카드 정규화
  └─ department·routing_reason ───────────→ 라우팅 후보 정규화
```

이 임시 입력은 현재 모델팀과의 연결을 위한 완충 계층입니다. 추가 필드가 와도 어댑터는 허용 목록의 필드만 사용하고 나머지는 운영 DB에 전달하지 않습니다.

| 모델 결과 의미 | K7 저장 위치·계약 |
|---|---|
| 상담 분야·주제 | `consultation_sessions.inquiry_type` |
| 상담 요약 | `consultation_card.summary` |
| 고객이 요청한 내용 | `consultation_card.customer_request` |
| 확인할 항목 | `consultation_card.confirmation_items` |
| 추천 응대 | `consultation_card.recommended_actions` |
| 규정 참조 ID | `consultation_card.related_manual_refs` |

표준 출력은 `consultation_card.schema.json`을 따릅니다. 학습 데이터의 분류명을 K7 `inquiry_type` 코드로 바꾸는 매핑표는 모델·백엔드팀이 최종 라벨을 확정한 뒤 버전 관리합니다.

### 현재 예제의 변환 기준

| 현재 입력 | K7 정규화 결과 |
|---|---|
| `명의도용·해킹 신고` | 현재 `inquiry_type=other`; 원문 라벨은 키워드 또는 어댑터 로그에 유지 |
| `금융사기` | `department_code=fraud_response` |
| `고위험` | `risk_level=high` |
| `주택담보대출 만기 연장` | `inquiry_type=loan` |
| `대출 및 금융상담` | 현재 `department_code=general_banking` |

`incident_risk`가 없거나 `null`이면 저위험으로 간주하지 않습니다. 버전이 있는 업무 규칙이 위험도·긴급도를 보완한 뒤 상담카드 저장 계약을 통과시켜야 합니다.

`routing_confidence`가 없을 때 모델 신뢰도를 임의로 만들지 않습니다. MVP에서는 업무 유형과 부서의 확정 매핑이 일치할 때 라우팅 정책 결과로 저장하고, 알 수 없는 부서는 일반 상담 대기열로 보냅니다.

`external_session_key`, `model_name`, `model_version`, `generated_at`이 모델 응답에 없으면 FastAPI가 요청 경로와 배포 설정에서 주입합니다. 모델 응답에도 키가 있으면 요청 경로의 키와 일치해야 합니다.

## 6. 어댑터가 처리할 것과 처리하지 않을 것

### 처리할 것

- 외부 필드명을 K7 `snake_case` 필드로 변환
- `external_session_key` 일치 확인
- 모델·계약 버전 기록
- 점수 범위와 상태 조합 검사
- 모델 장애를 `unavailable` 또는 `failed`로 변환
- 같은 결과가 재전송될 때 같은 `result_key` 생성
- K7 JSON Schema 검증 후 저장

### 처리하지 않을 것

- 원본 WAV·전체 학습 JSON을 PostgreSQL에 복사
- 보정되지 않은 원값을 임의로 0~100 변환
- 모델의 모든 실험용 필드를 운영 컬럼으로 추가
- 고객 개인정보나 로컬 파일 경로를 모델 JSON에 포함
- 감정온도만으로 금융 위험도나 최종 라우팅 결정

## 7. 모델팀이 최종적으로 전달할 최소 자료

모델 구조가 확정될 때 다음 자료만 받으면 어댑터를 구현할 수 있습니다.

1. 정상 결과 JSON 한 건
2. 음성 부족 또는 분석 불가 JSON 한 건
3. 모델 오류 JSON 한 건
4. 각 필드의 의미와 단위
5. 모델 버전과 보정 버전 규칙
6. 통화 단위인지 세그먼트 단위인지
7. 같은 요청을 재처리했을 때 결과 키 규칙

학습 코드 전체나 원본 데이터셋을 DB 저장소에 복사할 필요는 없습니다.

## 8. 통합 시점의 최소 검증

- [ ] 모델 결과가 전용 어댑터를 통합니다.
- [ ] 어댑터 결과가 K7 JSON Schema를 통과합니다.
- [ ] 같은 통화에 같은 `external_session_key`를 사용합니다.
- [ ] 동일 결과 재전송이 중복 행을 만들지 않습니다.
- [ ] 보정 전 원값을 운영 점수로 표시하지 않습니다.
- [ ] 실패 결과에는 점수가 없고 `failure_code`가 있습니다.
- [ ] 실제 고객정보·WAV·로컬 경로가 JSON에 없습니다.
- [ ] React는 기존 통합 상담카드 계약을 그대로 사용합니다.
- [ ] `npm run check`와 PostgreSQL 저장 테스트를 통과합니다.

이 검증을 통과하기 전에는 모델 결과를 시연 mock과 교체하지 않습니다.
