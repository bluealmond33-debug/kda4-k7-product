# K7 데이터 거버넌스·통합 모듈

현재 활성 기준은 **비마스킹 MVP `mvp-1.0`**입니다.

기계가 읽는 단일 기준은 `active-manifest.json`입니다. CI가 이 파일과 활성 SQL·JSON Schema·예제·백엔드·프런트 경로를 대조합니다.

```text
고객 음성 파일
  → FastAPI POST /api/v1/calls
  → 완성된 음성 파일 전체를 실제 STT에 전달
  → STT 텍스트로 요약·업무유형·부서·라우팅 분석
  → 고객 음성으로 감정온도 분석(실제 모델 수령 전 unavailable)
  → 비-AI 어댑터가 모델 결과를 표준화
  → PostgreSQL 3개 테이블 저장
  → GET /api/v1/calls/{call_id}/consultation-card
  → React 상담카드
```

현재 MVP는 통신사 전화망이나 실시간 음성 스트리밍을 연결하지 않습니다. React의 ‘실제 음성 파일’에서 녹음 완료 파일을 업로드한 뒤 전체 파일을 한 번에 처리합니다. 화면의 통화 진행 표현은 상담 흐름 시연 UI이며, 실제 마이크 연속 녹음·WebSocket·부분 STT가 아닙니다.

## 활성 파일

| 역할 | 기준 파일 |
|---|---|
| PostgreSQL | `mvp/schema.sql` |
| 활성 자산 목록 | `active-manifest.json` |
| API 응답 JSON Schema | `contracts/mvp_call_response.schema.json` |
| 정상 예제 | `contracts/examples/mvp_call_response.example.json` |
| 원시 모델 입력 경계 | `contracts/model_consultation_result_input.schema.json` |
| 금융 모델 후처리 규칙 | `mvp/model_postprocessing.v1.json` |
| 활성 모델 어댑터 | `../backend/app/model_adapter.py` |
| FastAPI | `../backend/app/` |
| React 연결 | `../src/services/consultation.ts` |

## MVP 테이블

1. `calls`: 고객 음성 접수 한 건
2. `transcripts`: STT 원문 한 건
3. `consultation_cards`: 상담사가 볼 표준 카드 한 건

React와 모델 코드는 PostgreSQL에 직접 연결하지 않습니다. FastAPI만 `DATABASE_URL`을 사용합니다.

## 표준 모델 결과

모든 요약·분류·라우팅 구현은 최소한 다음 `snake_case` 필드를 반환합니다.

```json
{
  "summary": "고객이 주택담보대출 만기 연장 가능 여부와 필요한 서류를 문의함.",
  "business_type": "주택담보대출 만기 연장",
  "department": "대출 및 금융상담",
  "routing_reason": "대출 만기 연장 및 약정 변경 상담에 해당",
  "incident_risk": "low",
  "risk_reason": null,
  "routing_confidence": 0.94
}
```

`incident_risk`는 기계가 읽는 표준값 `low | high`만 사용합니다. 화면에서만 `낮음 | 높음`으로 번역합니다.

감정 모델이 아직 준비되지 않았으면 숫자를 만들지 않고 다음처럼 표시합니다.

```json
{
  "status": "unavailable",
  "score": null,
  "level": null,
  "reason": "감정 모델은 아직 MVP 통합 전입니다."
}
```

형진 금융 특화 모델은 표준 필드를 직접 만들 필요 없이 다음 원시 결과를 반환할 수 있습니다.

```json
{
  "summary": "고객이 주택담보대출 만기 연장 가능 여부를 문의함.",
  "task_category": "대출",
  "consulting_situation": "만기 연장 문의",
  "qa_topic": "주택담보대출 만기 연장"
}
```

`backend/app/model_adapter.py`가 `mvp/model_postprocessing.v1.json`을 사용해 `business_type`, `department`, `incident_risk`, `risk_reason`, `routing_confidence`를 만듭니다. 여기서 `routing_confidence`는 모델 성능 점수가 아니라 검토된 업무→부서 매핑 규칙의 신뢰도입니다. 매핑되지 않은 새 라벨은 잘못된 부서를 추측하지 않고 오류로 처리하므로 실제 라벨 목록을 받으면 규칙 파일을 먼저 보완해야 합니다.

이 어댑터는 GPT나 학습 모델이 아닙니다. 같은 입력에 항상 같은 결과를 만드는 일반 Python 코드이며, 모델 원시 JSON을 읽어 필드 이름을 맞추고 매핑 규칙을 적용한 다음 계약 위반을 거절합니다. 음성을 듣거나 내용을 새로 요약하거나 고객 감정을 추론하지 않습니다.

## 기존 12테이블 자산

루트의 `schema.sql`, `commands.sql`, `queries.sql`, `seed.sql`, `verify.sql`, 기존 상담카드 계약과 `adapters/`는 향후 확장 참고 및 이전 작업 보존용입니다. **Railway MVP에는 적용하거나 import하지 않습니다.** 활성 어댑터는 `backend/app/model_adapter.py` 하나입니다. 마스킹·권한·접근로그·상담사 자동배정은 현재 완료조건이 아닙니다.

## 실행과 검증

```powershell
npm install
npm run check

py -3 -m pip install -r backend/requirements.txt
py -3 -m pytest backend/tests
py -3 -m uvicorn app.main:app --app-dir backend --reload --port 8000
```

Railway에서는 PostgreSQL 서비스를 만들고 백엔드에 `DATABASE_URL=${{Postgres.DATABASE_URL}}` 참조를 추가합니다. FastAPI 시작 시 `mvp/schema.sql`이 자동 적용됩니다.
