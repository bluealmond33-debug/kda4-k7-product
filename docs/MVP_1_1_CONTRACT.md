# KARI-NA 상담카드 `mvp-1.1` 계약 결정

기준 문서: `KARI-NA_mvp1.1_계약안_2026-07-20.pdf`

## 결정

`ConsultationCard` 공개 계약에 다음 네 키를 추가한다.

| 필드 | 타입 | 의미 |
|---|---|---|
| `attention_level` | `none \| medium \| high` | 융합 판단이 산출한 3단계 주의 등급 |
| `reason_codes` | `string[] \| null` | 위험 판단의 기계 판독용 근거 코드 |
| `routing` | `object \| null` | 업무 코드, 3단계 분류, 처리 주체 |
| `text_emotion` | `object \| null` | 음향 감정과 분리된 텍스트 상황 심각도 |

`attention_level`은 항상 존재한다. 나머지 세 결과는 담당 모델이 없거나 실패해도 전체 상담카드 생성을 막지 않도록 `null`을 허용한다. 정상적으로 판단했지만 근거 코드가 없는 경우 `reason_codes`는 빈 배열일 수 있다.

## 중첩 객체

```json
{
  "routing": {
    "task_code": "E002",
    "task_name": "이상거래 신고",
    "classification": "EMERGENCY",
    "handler": "HUMAN"
  },
  "text_emotion": {
    "content_emotion": "불안",
    "situation_severity": "high",
    "urgency_score": 95
  }
}
```

- `classification`: `EMERGENCY | SIMPLE | GENERAL`
- `handler`: `HUMAN | AI`
- `situation_severity`: `low | medium | high`
- `urgency_score`: `0..100`; boolean은 숫자로 허용하지 않는다.

## 기존 계약과의 관계

팀장 제안서는 기존 상담카드를 8키로 설명했지만, 현재 `lch` 활성 계약에는 체크리스트와 RAG 출처를 포함한 12키가 이미 있다. 기존 필드는 삭제하지 않고 네 키를 더해 16키로 확장한다.

`incident_risk`는 기존 UI 호환을 위해 유지한다.

- `incident_risk=high` ↔ `attention_level=high`
- `incident_risk=low` ↔ `attention_level=none | medium`

음향 모델의 `voice_arousal_score`, `voice_dominance_score`, `voice_valence_score`, `negative_activation_score`는 원시 모델 결과로 보존하지만 이번 공개 상담카드 네 필드에는 포함하지 않는다.

사람 라벨 46건의 첫 검증에서 도메인 불일치가 확인되었으므로 음향 감정은 shadow 보조신호다. 음향 결과만으로 `attention_level`이나 `reason_codes`를 올리지 않는다. 금융사고 규칙, 텍스트 HIGH, 또는 명시적으로 전달된 융합판정만 주의등급에 반영한다.

## 장애·구버전 데이터 처리

- 라우팅 또는 텍스트 감정 객체가 계약을 위반하면 해당 객체만 `null`로 내리고 상담카드는 계속 만든다.
- 기존 `mvp-1.0` DB 행은 시작 시 `mvp-1.1`로 마이그레이션한다.
- 기존 행에 신규 페이로드가 없으면 위험도에서 `attention_level`을 복원하고 나머지는 안전한 기본값으로 반환한다.
- PostgreSQL 저장·재조회와 React 런타임 파서는 동일한 16키 계약을 사용한다.

## 변경 주체

- 계약·백엔드·DB: `backend/app/contracts.py`, `integration_service.py`, `database.py`, `database/mvp/schema.sql`
- JSON 계약: `database/contracts/mvp_call_response.schema.json`
- 프론트 타입·런타임 검사: `src/services/types.ts`, `src/services/consultationContract.ts`
