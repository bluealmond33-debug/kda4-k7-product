# K7 DB·데이터 통합 모듈

이 문서는 K7 프로젝트를 처음 보는 사람도 데이터가 어디서 생기고, 어디에 저장되며, 상담사 화면까지 어떻게 전달되는지 이해하고 직접 실행할 수 있도록 만든 안내서입니다.

이 모듈은 완성형 금융 시스템이 아닙니다. **MVP 시연과 팀 병렬 개발에 필요한 공통 데이터 골격**입니다. 지금 필요한 연결 규칙만 제공하고, 실제 연동 과정에서 확인된 항목만 추가합니다.

---

## 1. 정말 쉽게 설명하면

학교에서 여러 동아리가 한 축제 참가자를 함께 돕는 상황을 생각하면 쉽습니다.

- STT팀은 고객의 말을 글로 바꿉니다.
- 감정팀은 고객이 얼마나 불안하거나 긴급한지 분석합니다.
- AI·RAG팀은 문의를 요약하고 참고 규정을 찾습니다.
- 라우팅팀은 어느 부서와 상담사가 적합한지 추천합니다.
- React는 상담사에게 최종 결과를 보여줍니다.

각 팀이 서로 다른 이름과 형식을 사용하면 같은 고객의 같은 전화를 연결하기 어렵습니다. 이 모듈은 모든 결과에 같은 이름표를 붙이고, 정해진 형식으로 안전하게 보관합니다.

| 쉬운 비유 | 프로젝트 용어 | 역할 |
|---|---|---|
| 통화 한 건의 공통 접수번호 | `external_session_key` | 모든 팀의 결과를 같은 상담에 연결 |
| 학교의 공식 장부 | PostgreSQL | 상담 데이터를 관계에 맞게 저장 |
| 빈 신청서 양식 | JSON Schema | 팀이 보내야 할 필드와 자료형 정의 |
| 작성된 연습 신청서 | 예제 JSON | API 없이 화면과 파싱을 먼저 시험 |
| 접수 창구 직원 | FastAPI | 입력 검증, 저장, 조회, 권한 확인 |
| 결과 안내 화면 | React | 상담사가 볼 정보만 표시 |

가장 중요한 규칙은 하나입니다.

> 같은 통화에서 나온 모든 결과는 같은 `external_session_key`를 사용합니다.

---

## 2. 지금 가능한 것

### 바로 가능한 것

- React 시연 화면을 mock 데이터로 실행
- PostgreSQL 16에 12개 테이블 생성
- 고객 10명, 상담사 5명, 과거 상담 35건 등 가상 데이터 생성
- STT·감정온도·상담카드·라우팅 JSON 형식 검증
- 현재 상담카드와 마스킹 고객정보를 하나의 JSON으로 조회
- 권한, 고객 주의정보, 개인정보 조회로그 구조 확인
- 로컬 PostgreSQL과 Railway PostgreSQL에 같은 스키마 적용

### 다른 팀이 연결할 부분

- `openapi.yaml`을 기준으로 FastAPI 엔드포인트 구현
- 실제 STT, 감정분석, AI 요약, RAG, 라우팅 알고리즘 실행
- 실제 로그인·인증과 권한 연결
- Railway 서비스 생성과 배포

따라서 현재 상태는 다음과 같습니다.

| 실행 방식 | 현재 상태 | 필요한 것 |
|---|---|---|
| React 시연만 보기 | 실행 가능 | Node.js |
| DB만 생성·조회하기 | 실행 가능 | Docker 또는 PostgreSQL 16 |
| JSON 계약 검사하기 | 실행 가능 | Node.js |
| 실제 AI 결과를 화면까지 연결하기 | 연결 규격 준비 완료 | FastAPI 구현 |

---

## 3. 전체 구조

```mermaid
flowchart LR
    CUSTOMER["고객 음성"]
    STT["STT팀<br/>음성 → 글"]
    MODEL["감정·요약·RAG팀<br/>분석 결과"]
    API["FastAPI<br/>접수·검증·권한"]
    DB[("PostgreSQL<br/>공통 장부")]
    ROUTING["라우팅팀<br/>부서·상담사 추천"]
    RESPONSE["통합 상담카드 JSON"]
    UI["React<br/>상담사 화면"]

    CUSTOMER --> STT
    STT --> API
    STT --> MODEL
    MODEL --> API
    ROUTING --> API
    API <--> DB
    DB --> RESPONSE
    RESPONSE --> API
    API --> UI
```

### 꼭 지킬 연결 원칙

1. STT·AI·React는 PostgreSQL에 직접 접속하지 않습니다.
2. 모든 저장과 조회는 FastAPI를 통합니다.
3. FastAPI는 JSON을 검사한 뒤 DB에 저장합니다.
4. React에는 원문 개인정보가 아닌 마스킹된 값만 전달합니다.
5. 고객정보를 조회하면 누가, 언제, 무엇을, 왜 조회했는지 로그를 남깁니다.

### 통화 한 건이 처리되는 순서

```text
고객 전화
  ↓
상담 세션 생성
  ↓
STT 발화 저장 ──→ 감정온도·문의유형·요약 저장
  ↓
AI 상담카드 생성
  ↓
추천 부서·상담사 저장
  ↓
마스킹된 통합 JSON 생성
  ↓
React 상담사 화면 표시
  ↓
상담 종료 후 과거 상담내역 저장
```

---

## 4. 세 가지 사용 방법

처음이라면 필요한 방법 하나만 선택하면 됩니다.

### A. 화면 시연만 보고 싶을 때

DB와 FastAPI 없이도 가상 JSON으로 화면이 동작합니다.

```powershell
npm install
npm run dev
```

브라우저에서 `http://localhost:5173`을 엽니다. 기본값인 `VITE_USE_REAL_DATA_API=false`에서는 다음 파일이 상담카드 데이터로 사용됩니다.

```text
database/contracts/examples/consultation_card_response.example.json
```

### B. DB를 직접 만들고 조회하고 싶을 때

아래 [7. 처음부터 DB 실행하기](#7-처음부터-db-실행하기)를 따라 합니다. FastAPI가 없어도 테이블, 가상 데이터, 쿼리를 확인할 수 있습니다.

### C. 자기 팀 기능을 연결하고 싶을 때

1. [9. 팀별 연결 방법](#9-팀별-연결-방법)에서 자기 팀 항목을 찾습니다.
2. 해당 JSON Schema와 예제 JSON을 확인합니다.
3. 모든 결과에 같은 `external_session_key`를 넣습니다.
4. FastAPI팀에 JSON을 전달합니다.
5. FastAPI팀은 `commands.sql`의 저장 SQL을 사용합니다.
6. React는 통합 상담카드 API 한 개를 호출합니다.

현재 결합형 모델 JSON은 다음 명령으로 상담카드·라우팅 결과로 바로 변환할 수 있습니다.

```powershell
py -3.12 database/adapters/model_result_adapter.py `
  --input database/contracts/examples/model_consultation_result_input.example.json `
  --session-key K7-DEMO-20260715-0001 `
  --generated-at 2026-07-16T00:00:00Z
```

새 업무유형·부서는 Python 코드를 고치지 않고 `database/adapters/model_result_mapping.v1.json`에 추가합니다.

---

## 5. 폴더와 파일 지도

```text
database/
├── README.md                  ← 지금 읽는 전체 사용설명서
├── adapters/                  ← 모델 JSON을 표준 카드·라우팅으로 바꾸는 실행 모듈
│   ├── README.md              ← 실행·확장 방법
│   ├── model_result_adapter.py
│   └── model_result_mapping.v1.json
├── schema.sql                ← 12개 테이블·제약조건·인덱스 생성
├── seed.sql                  ← 가상 고객·상담·카드 데이터 생성
├── queries.sql               ← 조회 쿼리와 실행 예시
├── commands.sql              ← 세션·발화·분석·카드·라우팅 저장 쿼리
├── verify.sql                ← 데이터 수와 무결성 자동 점검
├── data_dictionary.md        ← 테이블과 모든 컬럼의 뜻
├── erd.md                    ← 테이블 관계도
├── integration_contract.md   ← 팀 사이 입력·출력 연결 규칙
├── migrations/
│   └── 002_standardize_team_contracts.sql
│                               ← 이전 DB를 새 규격으로 올릴 때만 사용
└── contracts/
    ├── README.md              ← JSON 계약만 따로 보는 설명서
    ├── model_adapter_guide.md ← 변경 가능한 모델 출력을 연결하는 방법
    ├── model_consultation_result_input.schema.json
    │                           ← 현재 결합형 모델 출력의 임시 입력 규격
    ├── openapi.yaml           ← FastAPI 경로·요청·응답 명세
    ├── *.schema.json          ← JSON 검사 규칙
    └── examples/*.json        ← 전부 가상 데이터인 정상 예제
```

### 무엇부터 읽어야 하나요?

| 목적 | 읽을 파일 |
|---|---|
| 전체 흐름 이해 | `database/README.md` |
| 테이블 관계를 그림으로 보기 | `database/erd.md` |
| 컬럼 하나의 정확한 뜻 찾기 | `database/data_dictionary.md` |
| 팀끼리 주고받을 데이터 확인 | `database/integration_contract.md` |
| FastAPI 경로 확인 | `database/contracts/openapi.yaml` |
| 아직 바뀌는 모델 결과 연결 | `database/contracts/model_adapter_guide.md` |
| 현재 모델 JSON을 직접 변환 | `database/adapters/README.md` |
| React가 받을 최종 모양 확인 | `database/contracts/examples/consultation_card_response.example.json` |

---

## 6. DB 안에는 무엇이 있나요?

총 12개 테이블을 세 묶음으로 이해하면 됩니다.

### 사람과 조직

| 테이블 | 쉬운 설명 |
|---|---|
| `departments` | 상담 부서 목록 |
| `customers` | 마스킹된 고객 기본정보 |
| `counselors` | 상담사 정보 |
| `counselor_permissions` | 상담사별 조회 가능 정보 |

### 현재 통화 처리

| 테이블 | 쉬운 설명 |
|---|---|
| `consultation_sessions` | 통화 한 건의 중심 기록 |
| `utterances` | 고객·AI 발화와 마스킹 발화 |
| `model_analysis_results` | 감정온도 등 모델 분석 결과 |
| `ai_consultation_cards` | AI 요약, 위험도, 추천 조치 |
| `routing_recommendations` | 추천 부서·상담사와 선택 결과 |

### 이력과 안전관리

| 테이블 | 쉬운 설명 |
|---|---|
| `consultation_history` | 종료된 과거 상담내역 |
| `customer_cautions` | 주의 유형, 사유, 심각도, 유효기간 |
| `access_logs` | 고객정보를 누가, 언제, 왜 조회했는지 기록 |

### 핵심 관계

```mermaid
flowchart TD
    CUSTOMER["customers<br/>고객"]
    SESSION["consultation_sessions<br/>상담 세션"]
    UTTERANCE["utterances<br/>발화"]
    ANALYSIS["model_analysis_results<br/>모델 분석"]
    CARD["ai_consultation_cards<br/>상담카드"]
    ROUTING["routing_recommendations<br/>라우팅"]
    HISTORY["consultation_history<br/>과거 상담"]
    CAUTION["customer_cautions<br/>고객 주의정보"]
    COUNSELOR["counselors<br/>상담사"]
    LOG["access_logs<br/>조회로그"]

    CUSTOMER --> SESSION
    SESSION --> UTTERANCE
    SESSION --> ANALYSIS
    SESSION --> CARD
    SESSION --> ROUTING
    CUSTOMER --> HISTORY
    CUSTOMER --> CAUTION
    COUNSELOR --> SESSION
    COUNSELOR --> LOG
    CUSTOMER --> LOG
```

정확한 PK·FK 관계는 `erd.md`, 컬럼과 삭제 정책은 `data_dictionary.md`에서 확인합니다.

---

## 7. 처음부터 DB 실행하기

명령은 저장소 최상위 폴더에서 실행합니다.

### 방법 1: Docker Desktop 사용

이 방법은 컴퓨터에 PostgreSQL을 따로 설치하지 않아도 됩니다.

#### 1단계: PostgreSQL 컨테이너 만들기

```powershell
docker run --name k7-postgres `
  -e POSTGRES_USER=postgres `
  -e POSTGRES_PASSWORD=password `
  -e POSTGRES_DB=k7_consultation `
  -p 5432:5432 `
  -d postgres:16

Start-Sleep -Seconds 5
docker exec k7-postgres pg_isready -U postgres -d k7_consultation
```

마지막 줄에 `accepting connections`가 나오면 준비가 끝난 것입니다. 아직 준비 중이면 잠시 후 `pg_isready` 명령만 다시 실행합니다.

#### 2단계: SQL 파일을 컨테이너에 복사하기

```powershell
docker cp database/. k7-postgres:/database
```

#### 3단계: 정해진 순서로 실행하기

```powershell
docker exec k7-postgres psql -U postgres -d k7_consultation -v ON_ERROR_STOP=1 -f /database/schema.sql
docker exec k7-postgres psql -U postgres -d k7_consultation -v ON_ERROR_STOP=1 -f /database/seed.sql
docker exec k7-postgres psql -U postgres -d k7_consultation -v ON_ERROR_STOP=1 -f /database/queries.sql
docker exec k7-postgres psql -U postgres -d k7_consultation -v ON_ERROR_STOP=1 -f /database/commands.sql
docker exec k7-postgres psql -U postgres -d k7_consultation -v ON_ERROR_STOP=1 -f /database/verify.sql
```

`ON_ERROR_STOP=1`은 오류가 하나라도 생기면 그 자리에서 멈추게 하는 안전장치입니다.

#### 4단계: 테이블 확인하기

```powershell
docker exec k7-postgres psql -U postgres -d k7_consultation -c "\dt"
```

정상이라면 12개 테이블이 보입니다. `verify.sql`은 고객 10명, 상담사 5명, 과거 상담 35건 이상과 주요 제약조건을 검사합니다.

#### 다시 사용할 때

```powershell
docker stop k7-postgres
docker start k7-postgres
```

컨테이너와 테스트 데이터를 전부 버릴 때만 다음 명령을 사용합니다.

```powershell
docker rm -f k7-postgres
```

### 방법 2: PostgreSQL과 psql이 이미 설치된 경우

```powershell
$env:DATABASE_URL = "postgresql://postgres:password@localhost:5432/k7_consultation"

psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f database/schema.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f database/seed.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f database/queries.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f database/commands.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f database/verify.sql
```

### 각 SQL 파일을 왜 이 순서로 실행하나요?

| 순서 | 파일 | 하는 일 |
|---:|---|---|
| 1 | `schema.sql` | 빈 서랍과 연결 규칙을 만듭니다. |
| 2 | `seed.sql` | 가상 연습 데이터를 넣습니다. |
| 3 | `queries.sql` | 조회 SQL이 문법상 실행되는지 확인합니다. |
| 4 | `commands.sql` | 저장 SQL과 멱등 처리를 확인합니다. |
| 5 | `verify.sql` | 개수, FK, 제약조건이 맞는지 검사합니다. |

`queries.sql`과 `commands.sql`의 `PREPARE`는 해당 psql 연결에서만 유지되는 검증용 포장입니다. FastAPI에서는 각 `PREPARE` 안의 SQL 본문을 매개변수 바인딩 쿼리로 사용합니다.

> `seed.sql`은 개발·테스트 DB 전용입니다. 실제 운영 DB에서는 실행하지 않습니다.

---

## 8. JSON 파일은 어떻게 사용하나요?

JSON 파일은 DB 대신 데이터를 계속 쌓는 저장소가 아닙니다. 팀끼리 형식을 맞추고 테스트하기 위한 계약입니다.

| 종류 | 의미 | 사용 방법 |
|---|---|---|
| `*.schema.json` | 빈 양식과 검사 규칙 | 모델 출력 또는 API 입력을 자동 검사 |
| `examples/*.json` | 정상적으로 작성된 가상 예제 | React mock, 테스트, 회의 때 참고 |
| PostgreSQL | 실제 상담 데이터 장부 | FastAPI가 저장·조회 |

### 계약 자동 검사

```powershell
npm install
npm run validate:contracts
```

React 빌드까지 함께 검사하려면 다음 명령을 사용합니다.

```powershell
npm run check
npm run validate:adapter
```

### 주요 계약

| 팀·기능 | Schema | 정상 예제 |
|---|---|---|
| STT 입력 | `stt_utterance_input.schema.json` | `stt_utterance_input.example.json` |
| 마스킹 발화 | `masked_utterance.schema.json` | `masked_utterance.example.json` |
| 감정온도 | `emotion_temperature_result.schema.json` | `emotion_temperature_result.example.json` |
| AI 상담카드 | `consultation_card.schema.json` | `consultation_card.example.json` |
| 라우팅 후보 | `routing_candidate.schema.json` | `routing_candidate.example.json` |
| React 통합 응답 | `consultation_card_response.schema.json` | `consultation_card_response.example.json` |

모든 예제는 가상 데이터입니다.

---

## 9. 팀별 연결 방법

### 공통 모델 어댑터 원칙

모델링 저장소의 데이터 라벨·출력 JSON·필드명은 실험 과정에서 바뀔 수 있습니다. 그 구조를 PostgreSQL이나 React가 직접 따라가지 않고 FastAPI의 모델별 어댑터가 K7 표준 JSON으로 변환합니다.

```text
모델별 중간 결과 → FastAPI 어댑터 → contracts/*.schema.json → PostgreSQL
```

WAV·학습 JSON·CSV·embedding·세그먼트별 원시 예측은 운영 PostgreSQL에 넣지 않습니다. 감정 모델은 상담 단위로 보정된 최종 결과만 `model_analysis_results`에 저장하고, 문의 분류·요약 모델은 `consultation_card.schema.json` 구조로 변환합니다. 상세 규칙은 `contracts/model_adapter_guide.md`를 사용합니다.

### STT팀

1. 한 통화에 사용할 `external_session_key`를 받습니다.
2. 발화마다 `sequence_no`를 1부터 증가시킵니다.
3. `stt_utterance_input.schema.json` 형식으로 FastAPI에 보냅니다.
4. 개인정보 원문은 React나 다른 모델에 직접 전달하지 않습니다.
5. FastAPI의 마스킹 단계를 거쳐 `utterances`에 저장합니다.

필수 핵심값은 세션 키, 발화 순번, 화자, 발화문, STT 신뢰도, 발화 시각입니다.

### 감정 데이터팀

1. `emotion_temperature_result.schema.json` 형식으로 결과를 만듭니다.
2. 점수는 0~100을 사용합니다.
3. 구간은 `stable` 0~33, `caution` 33 초과~66, `elevated` 66 초과~100입니다.
4. 재전송할 때는 같은 `result_key`를 사용합니다.
5. 고객정보, STT 전체 문장, 로컬 음성 경로는 결과 JSON에 넣지 않습니다.

### AI 요약·RAG팀

1. 같은 `external_session_key`를 사용합니다.
2. 문의 유형, 요약, 위험도, 추천 조치, 확인 항목을 만듭니다.
3. RAG 결과는 규정 원문 전체가 아니라 규정 참조 ID 목록으로 전달합니다.
4. `consultation_card.schema.json`을 통과하는지 확인합니다.
5. 현재처럼 요약·업무·부서·위험이 한 JSON으로 오면 `model_consultation_result_input.schema.json`으로 먼저 검증한 뒤 FastAPI 어댑터가 상담카드와 라우팅 결과로 분리합니다.

### 라우팅팀

1. `routing_candidate.schema.json` 형식을 사용합니다.
2. 추천 부서 또는 상담사, 순위, 신뢰도, 추천 근거를 전달합니다.
3. 여러 후보 중 최종 선택된 항목만 `is_selected=true`로 저장합니다.

### FastAPI팀

1. `contracts/openapi.yaml`을 API 경계로 사용합니다.
2. 요청 JSON을 Schema 또는 Pydantic으로 먼저 검사합니다.
3. `external_session_key`를 DB 내부 `session_id`로 변환합니다.
4. 저장은 `commands.sql`, 조회는 `queries.sql`의 SQL 본문을 사용합니다.
5. SQL 문자열 조합 대신 매개변수 바인딩을 사용합니다.
6. 고객정보 조회 전에 권한을 검사하고 성공·거부 모두 `access_logs`에 남깁니다.
7. DB 연결 주소는 코드가 아닌 `DATABASE_URL` 환경변수로 받습니다.

### React팀

1. 처음에는 `consultation_card_response.example.json`으로 화면을 개발합니다.
2. 실제 API가 생기면 응답 구조를 바꾸지 않고 호출 방식만 전환합니다.
3. React에서 PostgreSQL에 직접 접속하지 않습니다.
4. 암호문, 검색 해시, DB 주소, 개인정보 원문을 화면 코드에 넣지 않습니다.

현재 연결 코드는 `src/services/consultation.ts`에 있습니다.

---

## 10. React mock을 실제 API로 바꾸는 방법

FastAPI가 다음 API를 구현한 뒤 진행합니다.

```text
GET /api/v1/consultation-sessions/{external_session_key}/consultation-card
```

프로젝트 루트에 `.env` 파일을 만들고 다음처럼 설정합니다.

```dotenv
VITE_API_BASE_URL=http://localhost:8000
VITE_USE_REAL_DATA_API=true
VITE_DATA_API_PREFIX=/api/v1
VITE_DATA_ACCESS_PURPOSE=consultation_preparation
VITE_DEMO_SESSION_KEY=K7-DEMO-20260715-0001
```

그다음 React를 다시 시작합니다.

```powershell
npm run dev
```

동작 방식은 단순합니다.

```text
VITE_USE_REAL_DATA_API=false
  → examples/consultation_card_response.example.json 사용

VITE_USE_REAL_DATA_API=true
  → FastAPI의 같은 구조 JSON 사용
```

React 코드는 응답 구조가 같기 때문에 화면을 다시 만들 필요가 없습니다. 로그인 토큰은 `.env`에 저장하지 않고 실행 중 `setApiAccessToken(token)`으로 주입합니다.

---

## 11. 주요 조회와 저장

### 백엔드가 자주 사용할 조회

| 목적 | `queries.sql` 이름 |
|---|---|
| 고객 기본정보 | `get_customer_basic` |
| 최근 상담 5건 | `get_recent_consultation_history` |
| 현재 유효한 주의정보 | `get_customer_cautions` |
| 현재 세션의 평면 통합 결과 | `get_current_session_card` |
| 상담사 권한 확인 | `check_counselor_permission` |
| 개인정보 조회로그 저장 | `insert_customer_access_log` |
| 문의 유형별 상담 건수 | `count_consultations_by_inquiry_type` |
| 고위험 상담 | `get_high_risk_consultations` |
| 라우팅 후보와 선택 결과 | `get_session_routing_results` |
| React용 중첩 JSON | `get_consultation_card_response` |

React에 보낼 최종 응답은 `get_consultation_card_response(external_session_key)`의 결과를 사용합니다. 여기에는 마스킹 고객정보, 활성 주의정보, 감정온도, 상담카드, 라우팅, 최근 상담 5건, 마스킹 발화가 들어 있습니다.

### 백엔드가 사용할 저장 흐름

| 순서 | `commands.sql` 이름 |
|---:|---|
| 1 | `create_consultation_session` |
| 2 | `save_masked_utterance` |
| 3 | `save_emotion_temperature_result` |
| 4 | `upsert_consultation_card` |
| 5 | `clear_selected_routing` |
| 6 | `upsert_routing_candidate` |
| 7 | `complete_consultation_session` |

같은 요청이 네트워크 문제로 다시 들어와도 중복 저장을 줄이도록 멱등 키를 사용합니다. 같은 키인데 내용이 다르면 FastAPI가 `409 Conflict`로 처리하는 것이 계약입니다.

---

## 12. 착오송금 한 건의 예시

공통 키가 `K7-DEMO-20260715-0001`이라고 가정합니다.

1. FastAPI가 `consultation_sessions`에 상담 세션을 만듭니다.
2. STT팀 결과가 마스킹된 뒤 `utterances`에 저장됩니다.
3. 감정팀이 점수 74, `elevated` 결과를 전달합니다.
4. AI팀이 문의 유형 `mistaken_transfer`, 요약, 위험도, 추천 조치를 전달합니다.
5. 라우팅팀이 송금지원팀을 추천합니다.
6. FastAPI가 `get_consultation_card_response`를 실행합니다.
7. React는 다음 정보를 한 번에 받습니다.

- 마스킹 고객명
- 현재 고객 주의정보
- 문의 요약과 고객 요청
- 감정온도와 위험도
- 추천 조치와 확인 항목
- 관련 규정 참조
- 추천 부서·상담사
- 최근 상담 5건
- 마스킹된 현재 발화

프로토타입 화면과 DB 필드의 연결은 다음과 같습니다.

| 화면 항목 | 통합 응답 필드 |
|---|---|
| 고객 기본정보 | `customer` |
| 고객 주의정보 | `customer_cautions` |
| 문의 제목·요약 | `consultation_card.summary`, `customer_request` |
| 감정온도 | `emotion_temperature` |
| 상담 유의사항 | `risk_factors`, `confirmation_items` |
| 관련 규정 | `related_manual_refs` |
| 추천 부서·상담사 | `routing_result` |
| 과거 상담 | `recent_consultations` |

---

## 13. Railway PostgreSQL 적용

### 새 DB를 만들 때

1. Railway 프로젝트에 PostgreSQL 서비스를 추가합니다.
2. FastAPI 서비스에 `DATABASE_URL=${{Postgres.DATABASE_URL}}` 참조 변수를 등록합니다.
3. 외부 PC에서 SQL을 적용할 때는 Railway가 제공하는 TCP Proxy 주소를 사용합니다.
4. 새 DB에는 `schema.sql`을 적용합니다.
5. 시연용 데이터가 꼭 필요한 개발 환경에서만 `seed.sql`을 적용합니다.
6. `verify.sql`로 결과를 확인합니다.

### 기존 DB를 올릴 때

`schema.sql`을 다시 실행하지 않습니다. `migrations/` 안의 파일을 번호 순서대로 적용합니다.

### Railway에서 지킬 것

- 애플리케이션은 `DATABASE_URL`만 읽도록 합니다.
- 비밀번호와 연결 문자열을 Git에 올리지 않습니다.
- 운영 DB에는 `seed.sql`을 실행하지 않습니다.
- `queries.sql`과 `commands.sql`은 영구 DB 객체가 아니라 백엔드가 참고할 쿼리 모음입니다.
- 실제 금융 고객정보 대신 MVP 가상 데이터만 사용합니다.

---

## 14. 개인정보와 조회로그

### 화면에 보여도 되는 값

- `김*준` 같은 마스킹 이름
- 일부가 가려진 전화번호와 계좌번호
- 상담에 필요한 요약, 위험도, 주의사유

### 화면과 로그에 남기면 안 되는 값

- 실제 고객의 이름·전화번호·계좌번호 원문
- STT 원문 전체가 포함된 개인정보 조회로그
- 암호화 키와 검색용 비밀키
- DB 비밀번호와 `DATABASE_URL`
- 개발자 컴퓨터의 음성 파일 경로

`access_logs`에는 상담사, 조회시각, 고객, 정보 범위, 조회 목적, 성공·거부 결과만 기록합니다. 생성된 로그는 UPDATE와 DELETE가 차단됩니다.

PostgreSQL 제약조건은 로그인과 사용자 인증을 대신하지 않습니다. 실제 사용자 인증과 요청 권한은 FastAPI가 담당합니다.

---

## 15. 자주 생기는 문제

| 상황 | 확인 방법 |
|---|---|
| `docker: command not found` | Docker Desktop 설치와 실행 여부 확인 |
| 컨테이너 이름이 이미 존재함 | `docker start k7-postgres`로 기존 컨테이너 사용 |
| 포트 5432가 사용 중임 | 기존 PostgreSQL 종료 또는 Docker 포트 변경 |
| `psql` 명령을 찾을 수 없음 | Docker 방식 사용 또는 PostgreSQL client 설치 |
| 테이블이 이미 있다고 나옴 | 새 테스트 DB 사용; `schema.sql` 중복 실행 금지 |
| `seed.sql`에서 FK 오류 | `schema.sql` 다음에 전체 `seed.sql` 실행 |
| JSON 계약 검증 실패 | 필수 필드, `snake_case`, UTC 시각, 허용 범위 확인 |
| React가 계속 mock을 사용함 | `.env`의 API 주소와 `VITE_USE_REAL_DATA_API=true` 확인 후 재시작 |
| API는 되는데 카드가 비어 있음 | React와 DB가 같은 `external_session_key`를 사용하는지 확인 |
| 고객정보 조회가 거부됨 | 상담사 권한과 `access_logs`의 거부 사유 확인 |
| Railway 연결 실패 | TCP Proxy 주소·포트 또는 서비스 참조 변수 확인 |

---

## 16. MVP 변경 원칙

이 모듈은 팀이 함께 시연하고 병렬 개발하기 위한 기준점입니다. 운영급 기능을 미리 모두 만들지 않습니다.

변경이 필요할 때는 다음 순서만 지킵니다.

1. 실제 연동 중 필요한 문제인지 확인합니다.
2. 기존 JSON 계약이나 테이블로 해결 가능한지 먼저 봅니다.
3. 꼭 필요한 경우에만 스키마나 계약을 추가합니다.
4. 스키마를 바꾸면 ERD, 데이터 사전, JSON 계약도 함께 수정합니다.
5. `schema.sql → seed.sql → queries.sql → commands.sql → verify.sql`을 다시 검사합니다.
6. `npm run check`로 JSON 계약과 React 빌드를 확인합니다.

### 팀 공유 전 마지막 체크

- [ ] 같은 통화에 같은 `external_session_key`를 사용했습니다.
- [ ] JSON 필드명은 `snake_case`입니다.
- [ ] 시간은 ISO 8601 UTC입니다.
- [ ] 실제 고객정보를 넣지 않았습니다.
- [ ] JSON Schema 검사를 통과했습니다.
- [ ] React는 FastAPI를 통해 데이터를 받습니다.
- [ ] 고객정보 조회 성공·거부를 로그에 남깁니다.
- [ ] 운영 DB에 `seed.sql`을 실행하지 않았습니다.

더 자세한 필드 정의가 필요하면 `data_dictionary.md`, 관계 그림은 `erd.md`, 팀 간 API 규칙은 `integration_contract.md`를 이어서 보면 됩니다.
