# K7 음성 상담카드 MVP

고객의 **통화 음성**을 동일 원본 기준으로 두 갈래 처리합니다. STT 텍스트는 OpenAI가 요약·업무유형·담당 부서·라우팅을 분석하고, 원본 음성은 음성 감정 모델이 점수를 생성합니다. 두 결과를 같은 `call_id`로 결합해 PostgreSQL에 저장한 뒤 상담사 화면에 표시하는 통합 저장소입니다.

## 한 줄 흐름

```text
통화 음성 → call_id 선발급
├─ STT 텍스트 → OpenAI 요약·분류·라우팅
└─ 동일 원본 음성 → 음성 감정 모델
→ call_id 결과 결합 → mvp-1.0 → PostgreSQL → React/Vercel
```

## 단일 기준

| 영역 | 활성 기준 |
|---|---|
| 프론트엔드 | `src/` — React + Vite |
| 백엔드 | `backend/app/` — FastAPI |
| DB | `database/mvp/schema.sql` — PostgreSQL 3테이블 |
| 활성 자산 매니페스트 | `database/active-manifest.json` |
| API 계약 | `database/contracts/mvp_call_response.schema.json` |
| 모델 결과 어댑터 | `backend/app/model_adapter.py` |
| 음성 감정 어댑터 | `backend/app/emotion_adapter.py` |
| 이중 분석 명세 | `docs/AUDIO_TEXT_DUAL_PIPELINE.md` |
| 기존 파이프라인 연결 함수 | `backend/app/integration_service.py` |
| 금융 모델 후처리 | `database/mvp/model_postprocessing.v1.json` |
| Railway 설정 | `railway.toml` |

개인정보 마스킹, 고객 마스터, 권한·감사로그, 실제 상담사 자동배정은 이번 MVP 필수가 아닙니다. 기존 12테이블 SQL과 상세 계약은 향후 확장 참고용으로 보존하며 활성 배포에는 사용하지 않습니다. CI가 `active-manifest.json`을 검사해 이 경계를 고정합니다.

## 활성 API

```text
POST /api/v1/calls
  multipart/form-data audio=<고객 음성>
  STT·분석·DB 저장 후 mvp-1.0 상담카드 반환

GET /api/v1/calls/{call_id}/consultation-card
  DB에 저장된 같은 상담카드 재조회

GET /health
  API·DB 연결 상태 확인
```

현재 Railway에 이미 배포된 `/stt`, `/analyze`, `/judge`, `/rag`, `/analyze-text`, `/emotion`, `/summarize`, `/briefing`은 기존 데모가 깨지지 않도록 호환 경로로 유지합니다. 이 경로의 감정·RAG·일부 판단은 자리채움이며, 새 개발은 `/api/v1/calls`만 사용합니다.

활성 상담카드의 감정 상태는 `unavailable | completed`만 허용합니다. 실제 음성 모델이 없거나 실패하면 점수를 만들지 않고 `unavailable`로 저장하며 `demo` 결과는 활성 API와 DB에서 거절합니다.

## 프론트엔드 실행

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

실제 Railway API를 사용할 때 `.env`:

```dotenv
VITE_API_BASE_URL=https://kda4-k7-backend-production.up.railway.app
VITE_USE_REAL_DATA_API=true
VITE_DATA_API_PREFIX=/api/v1
```

상단의 `실제 음성 파일` 버튼으로 WAV·MP3·M4A 등을 업로드합니다. `VITE_USE_REAL_DATA_API=false`이면 표준 fixture로 화면만 시연합니다.

## 백엔드 실행

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
Copy-Item backend\.env.example .env
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --reload --port 8000
```

백엔드 환경변수:

```dotenv
OPENAI_API_KEY=
OPENAI_CHAT_MODEL=gpt-4o-mini
OPENAI_STT_MODEL=whisper-1
DATABASE_URL=postgresql://...
FRONTEND_ORIGIN=http://localhost:5173
EXTRA_CORS_ORIGINS=https://k7product.vercel.app
```

API 키와 `DATABASE_URL`은 GitHub나 Vite 환경변수에 넣지 않습니다.

## 검증

```powershell
npm run check
.\.venv\Scripts\python.exe -m pytest backend\tests -q
```

실제 PostgreSQL 왕복 검증은 테스트용 DB URL을 명시한 경우에만 실행되며, 만든 행은 검증 후 자동 삭제합니다.

```powershell
$env:K7_TEST_DATABASE_URL = "postgresql://테스트용-DB-URL"
.\.venv\Scripts\python.exe -m pytest backend\tests\test_database_integration.py -q
Remove-Item Env:K7_TEST_DATABASE_URL
```

배포된 실제 음성 E2E 확인:

```powershell
.\scripts\smoke-mvp.ps1 `
  -AudioPath .\samples\customer.wav `
  -ApiBaseUrl https://<railway-backend>
```

운영 백엔드가 DB 경계까지 반영됐는지 음성 호출 없이 읽기 전용으로 확인:

```powershell
.\scripts\check-production-readiness.ps1
```

`ready=true`는 새 POST/GET, 기존 8개 호환 경로, `database=connected`, `contract_version=mvp-1.0`이 모두 확인됐다는 뜻입니다.

병합 후 GitHub의 **Actions → Production readiness → Run workflow**에서도 같은 읽기 전용 검사를 실행할 수 있습니다. 운영 백엔드가 아직 반영 전이면 누락 항목을 출력하고 실패하며, 반영 후에는 `ready=true`로 통과합니다.

검증 대상:

- 활성 자산 매니페스트와 정확히 3개 테이블
- JSON Schema와 예제
- 기존 모델 결과 어댑터
- `mvp-1.0` 활성 모델 결과 어댑터
- TypeScript와 Vite 프로덕션 빌드
- FastAPI `mvp-1.0` Pydantic 계약
- 비마스킹 3테이블 활성 SQL
- 기존 Railway 9개 경로와 새 DB 경로의 OpenAPI 공존

## 팀 연결 경계

모델 팀은 다음 최소 필드를 반환하면 됩니다.

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

형진 금융 모델처럼 `summary`, `task_category`, `consulting_situation`, `qa_topic`을 반환하는 경우도 활성 어댑터가 같은 표준 결과로 변환합니다. 실제 라벨이 기존 매핑에 없으면 임의 라우팅하지 않고 명시적으로 거부합니다.

희창 운영 백엔드는 기존 STT와 모델 호출을 유지한 채 다음 함수만 호출하면 됩니다.

```python
response = persist_pipeline_result(
    settings,
    audio_filename=audio.filename,
    transcript=existing_stt_result,
    raw_model_result=existing_model_result,
)
```

이 함수가 어댑터 실행, `mvp-1.0` 상담카드 조립, PostgreSQL 트랜잭션 저장과 `call_id` 생성을 담당합니다. STT나 모델을 다시 실행하지 않습니다.

감정 모델이 아직 없으면 `emotion.status=unavailable`과 `score=null`을 사용합니다. 임의 숫자를 실제 모델 결과처럼 표시하지 않습니다.

상세 DB 설명은 `database/README.md`, STT 분류 경계는 `src/features/stt-classification/README.md`를 확인합니다.

운영 통합의 최종 판정과 팀별 책임은 `docs/DATA_INTEGRATION_ACCEPTANCE.md`를 따릅니다.
