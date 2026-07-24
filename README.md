# KARI-NA — K7 음성 상담카드 MVP

고객의 **통화 음성**을 동일 원본 기준으로 두 갈래 처리합니다. STT 텍스트는 요약·업무유형·담당 부서·라우팅을 분석하고, 원본 음성은 음성 감정 모델이 점수를 생성합니다. 두 결과를 같은 `call_id`로 결합해 PostgreSQL에 저장한 뒤 상담사 화면에 표시하는 통합 저장소입니다.

## ⚠️ 이 저장소를 처음 보는 사람이 먼저 알아야 할 것 — KARI-NA는 완전 온프레미스입니다

금융 민감정보(음성·계좌·상담이력)를 외부로 반출하지 않는다는 것이 이 프로젝트의 설계 전제입니다([ADR-0007](https://github.com/bluealmond33-debug/kda4-k7-hippo/blob/main/02%20Decisions/ADR-0007-아키텍처-온프레미스.md) · [ADR-0011](https://github.com/bluealmond33-debug/kda4-k7-hippo/blob/main/02%20Decisions/ADR-0011-온프레미스-전면전환.md)).

| | 실행 기준 (활성) | 폴백 (비활성) |
|---|---|---|
| **STT** | faster-whisper `large-v3-turbo` (로컬 GPU) | OpenAI Whisper API |
| **요약·분류·라우팅** | Ollama `exaone3.5:7.8b` (로컬) | OpenAI GPT |
| **임베딩** | bge-m3 (로컬) | — |
| **RAG 벡터저장소** | 설계 표준 pgvector / 데모 실구동 FAISS (둘 다 로컬) | — |
| **배포** | 호스트 직접 실행 (도커 미사용) | Railway / Vercel |

**실행 엔진은 이 저장소가 아니라 [`HeeChang50/kda4-k7-backend`](https://github.com/HeeChang50/kda4-k7-backend)입니다** (`USE_LOCAL_MODELS=true`, 외부 호출 0).

이 저장소(`kda4-k7-product`)가 담당하는 것은 **계약 · 저장 · 적재 · 프론트**입니다.

- 이 저장소 `backend/`에 남아 있는 **OpenAI 호출 경로는 레거시**입니다. 모델 팀 산출물이 도착하기 전 `mvp-1.0` 계약을 자체 검증하려고 만든 것이며, **활성 데모 경로가 아닙니다.**
- 온프레미스 장비가 없는 팀원이 화면만 확인하거나, 데모 당일 장비 장애 시 폴백으로만 사용합니다.

## 한 줄 흐름

```text
통화 음성 → call_id 선발급
├─ STT 텍스트 → 요약·분류·라우팅 (온프레미스 exaone3.5)
└─ 동일 원본 음성 → 음성 감정 모델 (온프레미스 eGeMAPS+LightGBM / WavLM)
→ call_id 결과 결합 → mvp-1.0 → PostgreSQL → React 상담 콘솔
```

> STT·모델 실행은 **실행 엔진 저장소**에서, 계약 검증·저장은 **이 저장소**에서 담당합니다.
> 접점은 아래 "팀 연결 경계"의 `persist_pipeline_result()` 하나이며, 두 곳에서 각각 실행하지 않습니다.

## 단일 기준

| 영역 | 활성 기준 |
|---|---|
| 프론트엔드 | `src/` — React + Vite |
| 백엔드 | `backend/app/` — FastAPI |
| DB | `database/mvp/schema.sql` — PostgreSQL 3테이블 |
| 활성 자산 매니페스트 | `database/active-manifest.json` |
| API 계약 | `database/contracts/mvp_call_response.schema.json` |
| 모델 결과 어댑터 | `backend/app/model_adapter.py` |
| 로컬 RAG·안전 규칙 | `backend/app/knowledge_base.py` |
| 데모 업무가이드 | `database/knowledge/demo_guides.ko.json` |
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
  ※ 이 경로 내부의 STT·분석은 OpenAI 호출(레거시·계약 검증용)입니다.
    온프레미스 실행에서는 실행 엔진이 STT·모델을 돌리고
    persist_pipeline_result()로 저장만 위임합니다.

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

**온프레미스 실행 엔진에 붙을 때 `.env` (기본·발표 데모 기준):**

```dotenv
VITE_API_BASE_URL=http://<온프레미스-서버-IP>:8000
VITE_USE_REAL_DATA_API=true
VITE_DATA_API_PREFIX=/api/v1
```

실시간 통화(`/ws/call/{call_id}`)와 온프레미스 STT·LLM은 이 경로에서만 동작합니다.

<details>
<summary>클라우드 폴백 <code>.env</code> (온프레미스 장비가 없을 때만)</summary>

```dotenv
VITE_API_BASE_URL=https://kda4-k7-backend-production.up.railway.app
VITE_USE_REAL_DATA_API=true
VITE_DATA_API_PREFIX=/api/v1
```

실시간 통화 스트리밍은 지원되지 않습니다.
</details>

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
DATABASE_URL=postgresql://...
FRONTEND_ORIGIN=http://localhost:5173
EXTRA_CORS_ORIGINS=https://k7product.vercel.app

# ▼ 레거시 — 계약 검증용 OpenAI 경로에만 필요. 온프레미스 실행에는 불필요.
#    활성 데모는 실행 엔진(HeeChang50/kda4-k7-backend, USE_LOCAL_MODELS=true)이 담당합니다.
OPENAI_API_KEY=
OPENAI_CHAT_MODEL=gpt-4o-mini
OPENAI_STT_MODEL=whisper-1
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

`ready=true`는 새 POST/GET, 기존 8개 호환 경로, `database=connected`, `contract_version=mvp-1.1`이 모두 확인됐다는 뜻입니다.

병합 후 GitHub의 **Actions → Production readiness → Run workflow**에서도 같은 읽기 전용 검사를 실행할 수 있습니다. 운영 백엔드가 아직 반영 전이면 누락 항목을 출력하고 실패하며, 반영 후에는 `ready=true`로 통과합니다.

검증 대상:

- 활성 자산 매니페스트와 정확히 3개 테이블
- JSON Schema와 예제
- 기존 모델 결과 어댑터
- `mvp-1.1` 활성 모델 결과 어댑터
- TypeScript와 Vite 프로덕션 빌드
- FastAPI `mvp-1.1` Pydantic 계약
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

이 함수가 어댑터 실행, `mvp-1.1` 상담카드 조립, PostgreSQL 트랜잭션 저장과 `call_id` 생성을 담당합니다. STT나 모델을 다시 실행하지 않습니다.

감정 모델이 아직 없으면 `emotion.status=unavailable`과 `score=null`을 사용합니다. 임의 숫자를 실제 모델 결과처럼 표시하지 않습니다.

## 노트북 오프라인 데모

Vercel은 인터넷 배포용 프론트입니다. 오프라인 데모에서는 Vercel을 사용하지 않고 React, FastAPI, PostgreSQL, faster-whisper와 Ollama를 한 노트북에서 함께 실행합니다.

최초 한 번 인터넷이 연결된 상태에서 이미지와 모델을 준비합니다.

```powershell
Copy-Item .env.local-demo.example .env.local-demo
# 데모 비밀번호와 하드웨어 프로필을 확인한 다음:
.\scripts\prepare-local-demo.ps1
```

준비가 끝난 뒤 인터넷을 끊고 격리 네트워크 모드로 실행합니다.

```powershell
.\scripts\start-local-demo.ps1 -Offline
```

접속 주소:

```text
이 노트북: http://127.0.0.1:8080
같은 LAN:  http://<서버 노트북 사설 IP>:8080
```

현재 사설 IP는 아래 명령으로 확인합니다. 핫스팟을 다시 연결하면 주소가 바뀔 수 있습니다.

```powershell
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -like '192.168.*' }
```

상태 확인과 종료:

```powershell
.\scripts\doctor-local-demo.ps1
.\scripts\stop-local-demo.ps1 -Offline
```

기본 CPU 프로필은 faster-whisper `small`/`int8`입니다. GPU 프로필은 Docker GPU 지원을 먼저 구성한 뒤 `.env.local-demo`에서 장치와 연산 형식을 변경합니다. 모델 파일이 준비되지 않았거나 Ollama에 지정 모델이 없으면 실제 음성 처리는 실패하며 fixture로 대체하지 않습니다.

전달받은 `bank_topic_classifier.joblib`은 NIA 은행 일반업무 10종 보조
분류기로 연결됩니다. 로드 전 SHA-256을 확인하고, decision margin `0.75`
이상만 자동 채택하며 미만은 `G004 기타·복합 일반 상담`으로 폴백합니다.
금융사고 안전 규칙의 고위험 라우팅이 이 결과보다 항상 우선합니다.
전체 정확도 `74.2%`, 고확신 구간 정확도 `90.4%`, 고확신 적용 범위
`61.3%`는 이 10종 모델의 검증값이며 긴급·단순·일반 전체나 ARS 17종의
실제 발화 정확도가 아닙니다. 자세한 전달 기록은
`backend/app/services/routing/MODEL_DELIVERY.md`를 확인합니다.

`-Offline` 모드에서는 FastAPI·Ollama·PostgreSQL 데이터 처리망이 Docker `internal` 네트워크에만 연결됩니다. 프론트 Nginx의 8080 포트만 서버 노트북과 같은 LAN에 공개됩니다. 로컬 아이콘 글꼴도 번들에 포함되어 Google Fonts 연결이 필요 없습니다.

실제 응답으로 바뀌는 화면 항목:

- 상담 준비 카드의 요약, 고객 요청, 추가 확인 정보, 업무유형, 담당 부서, 위험도
- 상담 전 체크리스트와 통화 중 단계별 스크립트
- 통화 화면의 AI 사전 요약
- 관련 규정 및 매뉴얼 카드와 검색 근거 표
- `call_id` 단위 PostgreSQL 저장 및 재조회

현재 남은 의도적 제한:

- 입력은 실제 CTI 전화 연결이 아니라 WAV·MP3·M4A 파일 업로드입니다.
- 감정 모델은 아직 연결하지 않았으므로 점수를 꾸며내지 않고 `모델 미연동`으로 표시합니다.
- 번들 RAG 문서는 시연용 K7 업무가이드이며 실제 은행의 내부 규정이 아닙니다.
- 본인확인, 고객 원장 조회, 실제 지급정지 실행은 UI 시연 경계이며 은행 시스템과 연결되지 않았습니다.
- 긴급·단순·ARS 17종 규칙 코드는 현재 전달 번들에 없어 통합 완료가 아니며, 실제 발화 정확도도 별도로 평가해야 합니다.

팀 데모 절차와 장애 대응은 `docs/LOCAL_DEMO_RUNBOOK.md`를 확인합니다.

Docker CLI는 보이지만 `docker info`가 `dockerDesktopLinuxEngine` 또는 WSL 오류로 실패하면 Docker Desktop을 Windows 사용자 세션에서 직접 실행하고 엔진이 `Running`이 될 때까지 기다립니다. 계속 실패하면 관리자 PowerShell에서 WSL과 Docker Desktop Service 상태를 복구해야 합니다. 엔진이 정상화되기 전에는 모델 다운로드 스크립트를 실행하지 않습니다.

상세 DB 설명은 `database/README.md`, STT 분류 경계는 `src/features/stt-classification/README.md`를 확인합니다.

운영 통합의 최종 판정과 팀별 책임은 `docs/DATA_INTEGRATION_ACCEPTANCE.md`를 따릅니다.
