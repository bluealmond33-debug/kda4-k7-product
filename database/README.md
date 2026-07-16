# K7 DB·데이터 통합 모듈

## 1. 30초 요약

고객이 상담사를 기다리는 동안 말한 내용을 STT와 AI가 분석하면, 이 DB 모듈은 각 결과를 하나의 상담 세션으로 연결하여 상담카드로 저장합니다. FastAPI는 이 데이터를 안전하게 조회해 React 상담사 화면에 전달합니다.

이 모듈의 핵심은 **공통 통화 키, PostgreSQL 스키마, JSON 계약**입니다. 개별 팀이 서로의 알고리즘을 다시 만들지 않고도 같은 통화의 결과를 정확히 이어 붙일 수 있게 합니다.

## 2. 이 모듈이 필요한 이유

각 팀이 개별 결과만 만들면 다음 문제가 생깁니다.

| 문제 | 이 모듈의 해결 방식 |
|---|---|
| 팀마다 다른 세션 식별자 | 공통 `external_session_key` 사용 |
| JSON 필드명 불일치 | JSON Schema와 `snake_case` 규칙 |
| 감정 점수·구간 불일치 | DB `CHECK`와 JSON Schema에 동일한 경계 적용 |
| 개인정보 원문 노출 | 마스킹·암호문 분리와 조회로그 적용 |
| 카드와 라우팅 결과 연결 실패 | `session_id` PK·FK와 복합 FK로 무결성 보장 |
| React가 받을 값이 불명확 | 통합 조회 SQL과 최종 응답 예제 제공 |

즉, 이 모듈은 결과를 단순 보관하는 곳이 아니라 **STT→AI→상담카드→라우팅→화면을 연결하는 데이터 기준점**입니다.

## 3. 전체 구조

```mermaid
flowchart LR
    CUSTOMER["고객 음성"] --> STT["STT"]
    CUSTOMER --> EMOTION["감정온도 분석"]
    STT --> CATEGORY["문의 유형·요약"]
    CATEGORY --> RAG["규정·매뉴얼 검색"]

    STT --> API["FastAPI"]
    EMOTION --> API
    CATEGORY --> API
    RAG --> API

    API <--> DB["PostgreSQL"]
    DB --> ROUTING["라우팅"]
    ROUTING --> API
    API --> REACT["React 상담사 화면"]
```

React와 AI 모델은 DB에 직접 접근하지 않습니다. 모든 입력 검증·마스킹·권한 확인·저장·조회는 FastAPI를 경유합니다.

## 4. 모듈 기능과 시스템 경계

이 모듈은 **K7 서비스의 상담 데이터 허브**입니다. 각 팀의 결과를 직접 생성하지 않고, 결과가 같은 통화에 정확히 연결되고 동일한 형식으로 저장·조회되도록 표준을 제공합니다.

| 기능 | 제공 내용 | 핵심 산출물 |
|---|---|---|
| 세션 허브 | 모든 결과를 `external_session_key`와 `session_id`로 연결 | `consultation_sessions` |
| 계약 검증 | 모델 출력 필드·타입·점수 경계를 통일 | JSON Schema |
| 운영 저장 | 상담·발화·감정온도·카드·라우팅을 관계형으로 저장 | `schema.sql` |
| 화면 조회 | React가 사용할 마스킹 통합 결과 제공 | `queries.sql`, 예제 JSON |
| 운영 통제 | 조회 권한·감사로그·참조 무결성·인덱스 제공 | 권한·로그 테이블, 제약조건 |
| 배포 준비 | 로컬과 Railway에서 같은 순서로 초기화 | `README.md`, `DATABASE_URL` |

| 이 모듈이 제공하는 것 | 외부 구성요소가 제공하는 것 |
|---|---|
| PostgreSQL 데이터 모델·무결성·인덱스 | STT·감정온도 분석 결과 |
| 공통 세션 키와 JSON 계약 | AI 문의 분류·요약 결과 |
| SQL·가상데이터·통합 조회 | RAG 규정 참조 결과 |
| 개인정보 마스킹 저장·권한·조회로그 구조 | 라우팅 추천 결과 |
| React 응답 예시와 필드 매핑 | FastAPI API와 React UI |

본인인증과 실제 금융 거래는 현재 프로젝트 범위에 포함하지 않습니다.

## 5. 핵심 개념

| 개념 | 쉬운 설명 |
|---|---|
| `external_session_key` | 팀 전체가 공유하는 통화 한 건의 식별자 |
| `session_id` | PostgreSQL 내부에서 관계를 연결하는 `bigint` 식별자 |
| PostgreSQL | 운영 상담·카드·라우팅·이력 데이터를 저장하는 관계형 DB |
| JSON Schema | 모델과 백엔드가 주고받을 필드·타입·범위를 정의한 계약 |
| 예제 JSON | React·백엔드가 실제 API 전 화면과 파싱을 시험하는 가상 응답 |
| CSV·Parquet | 감정 모델 학습용 표 형식 파일; 운영 DB와 분리 |
| 객체 저장소 | 음성 원본 같은 대용량 파일의 배포 환경 저장소 |
| 마스킹 데이터 | 이름·전화·계좌 일부를 `*`로 가려 화면에 사용하는 값 |

저장 위치는 명확히 나눕니다.

| 데이터 | 저장 위치 |
|---|---|
| 운영 상담 데이터 | PostgreSQL |
| 팀 간 입력·출력 규격 | JSON Schema |
| React 테스트 데이터 | 예제 JSON |
| 음성 원본 | 파일시스템·객체 저장소 |
| 모델 학습 데이터 | CSV·Parquet |
| 규정 원문 | RAG·별도 문서 저장소 |
| 민감정보 원문 | 최소 저장 또는 애플리케이션 암호화 |

JSON은 운영 DB의 대체재가 아닙니다.

## 6. 데이터 흐름 예시

| 순서 | 처리 | 사용하는 테이블·계약 |
|---:|---|---|
| 1 | 상담 세션 생성 | `consultation_sessions` |
| 2 | STT 결과 수신·개인정보 마스킹 | `utterances` |
| 3 | 감정온도 결과 수신·검증 | `emotion_temperature_result.schema.json`, `model_analysis_results` |
| 4 | 문의 유형·요약 생성 | `consultation_sessions`, `ai_consultation_cards` |
| 5 | 규정 참조·추천 조치 연결 | 카드의 `related_manual_refs`, `recommended_actions` |
| 6 | 상담카드 저장 | `ai_consultation_cards` |
| 7 | 라우팅 후보·선택 결과 저장 | `routing_recommendations` |
| 8 | FastAPI 통합 조회 | `get_current_session_card` |
| 9 | React 화면 표시 | `consultation_card_response.example.json` 구조 |
| 10 | 고객정보 조회 감사기록 | `counselor_permissions`, `access_logs` |

모든 단계는 같은 `external_session_key`에서 시작하며 FastAPI가 내부 `session_id`로 변환합니다.

## 7. 파일 지도

| 파일 | 읽을 사람 | 목적 |
|---|---|---|
| `README.md` | 전체 팀 | DB 모듈 전체 안내 |
| `schema.sql` | DB·백엔드 | 12개 테이블·제약조건·인덱스 생성 |
| `seed.sql` | 전체 개발팀 | 가상 테스트 데이터 생성; 개발·테스트 전용 |
| `queries.sql` | 백엔드 | 조회·권한 9개와 조회로그 저장 1개, 실행 예시 |
| `commands.sql` | 백엔드 | 세션·발화·감정·카드·라우팅·종료 멱등 저장 명령 |
| `migrations/*.sql` | DB·배포 | 기존 설치 DB의 비파괴 업그레이드 |
| `integration_contract.md` | 모델·백엔드·프론트 | 팀 간 입력·출력·API 경계 |
| `data_dictionary.md` | DB·백엔드 | 컬럼·코드·삭제 정책 정의 |
| `erd.md` | 전체 팀 | 테이블 관계 확인 |
| `contracts/*.schema.json` | 모델·백엔드 | JSON 검증 규격 |
| `contracts/examples/*.json` | 프론트·백엔드 | 화면·API 테스트 예시 |
| `contracts/openapi.yaml` | 백엔드·프론트 | FastAPI 구현 전 API 경계와 응답 규격 |

신규 테스트 DB의 실행 순서는 `schema.sql → seed.sql → queries.sql → commands.sql → verify.sql`입니다. `seed.sql`은 테이블을 비우므로 개발·테스트 DB에서만 실행합니다.

## 8. 팀별 빠른 시작

### STT팀

- 입력 계약: `contracts/stt_utterance_input.schema.json`
- 마스킹 후 저장 계약: `contracts/masked_utterance.schema.json`
- 전달값: `external_session_key`, `sequence_no`, `speaker_type`, `transcript`, `stt_confidence`, `spoken_at`
- `sequence_no`는 통화별 1부터 시작하고 중복하지 않습니다.
- `stt_confidence`는 0~1, `spoken_at`은 ISO 8601 UTC입니다.
- STT 원문을 모델팀·React에 직접 넘기지 않고 FastAPI 마스킹 경계를 거칩니다.

### 감정 데이터팀

- 계약: `contracts/emotion_temperature_result.schema.json`
- 정상 예제: `contracts/examples/emotion_temperature_result.example.json`
- 동일 결과 재전송에는 같은 `result_key`를 사용합니다.
- 정상 결과는 `analysis_status=completed`, 장애 결과는 `unavailable` 또는 `failed`입니다.
- `stable` 0~33 → 안정
- `caution` 33 초과~66 → 주의
- `elevated` 66 초과~100 → 고조
- 고객정보·STT 문장·과거상담·로컬 음성 파일 경로를 JSON에 넣지 않습니다.

### 백엔드팀

- `DATABASE_URL` 환경변수를 사용하고 SQL 값을 문자열로 조합하지 않습니다.
- 스키마 적용 후 JSON Schema 또는 Pydantic으로 모델 입력을 검증합니다.
- 저장 순서: 세션 → 발화·감정온도 → 카드 → 라우팅입니다.
- 카드 저장 시 같은 세션의 모델 결과인지 복합 FK가 확인합니다.
- 고객정보 조회 전 권한을 확인하고 성공·거부 모두 `access_logs`에 기록합니다.
- 주요 SQL은 `queries.sql`, API 경계는 `integration_contract.md`를 사용합니다.
- 저장 명령은 `commands.sql`, 요청·응답 계약은 `contracts/openapi.yaml`을 사용합니다.
- 모델·STT 재요청은 멱등 처리하며 같은 키의 내용이 다르면 `409`를 반환합니다.
- SQL 파일의 `PREPARE`는 독립 실행 검증용 래퍼입니다. FastAPI 연결 풀에서는 각 `PREPARE`의 SQL 본문을 바인딩 쿼리로 사용합니다.

### React팀

- 목업: `contracts/examples/consultation_card_response.example.json`
- 검증 규격: `contracts/consultation_card_response.schema.json`
- 화면의 해당 분석 항목은 `감정온도`로 표시합니다.
- API의 `label_ko`를 그대로 표시하고 자체 4단계 구간을 만들지 않습니다.
- 목업 파일 로딩 코드를 동일 구조의 FastAPI `GET` 호출로 교체합니다.
- DB 주소·SQL·검색 해시·암호문을 프론트 코드에 넣지 않습니다.

### 라우팅·RAG팀

- 라우팅 계약: `contracts/routing_candidate.schema.json`
- 입력: `external_session_key`, 문의 유형, 위험도·긴급도
- 라우팅 출력: 추천 부서·상담사, 순위, 신뢰도, 근거, 선택 여부, 모델 버전
- RAG 출력: 규정 원문이 아닌 안정적인 규정 참조 ID 목록
- 모든 결과는 `external_session_key`로 원 통화에 연결합니다.

## 9. 5분 실행 방법

### 로컬 PostgreSQL 16 실행

```powershell
docker run --name k7-postgres `
  -e POSTGRES_USER=postgres `
  -e POSTGRES_PASSWORD=password `
  -e POSTGRES_DB=k7_consultation `
  -p 5432:5432 `
  -d postgres:16

$env:DATABASE_URL = "postgresql://postgres:password@localhost:5432/k7_consultation"

psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f database/schema.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f database/seed.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f database/queries.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f database/commands.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f database/verify.sql
```

정상 기준은 테이블 12개, 고객 10명, 상담사 5명, 상담 세션 10건, 감정온도 8건, 카드 8건, 과거 상담 35건입니다. `queries.sql`은 검증용 쓰기를 `ROLLBACK`하므로 seed 건수를 바꾸지 않습니다.

### Railway PostgreSQL

1. Railway 프로젝트에서 PostgreSQL 서비스를 추가합니다.
2. FastAPI 서비스 변수에 `DATABASE_URL=${{Postgres.DATABASE_URL}}`을 등록합니다.
3. 외부 `psql` 적용은 PostgreSQL 서비스의 TCP Proxy 주소를 사용합니다.
4. 신규 운영 DB에는 `schema.sql`만 적용하고, 기존 v1 DB에는 `migrations/002_standardize_team_contracts.sql`을 적용합니다.
5. 운영 DB에서는 `seed.sql`을 실행하지 않습니다.
6. 비밀번호·호스트·연결 문자열을 코드나 Git에 커밋하지 않습니다.

Railway가 제공하는 `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `DATABASE_URL` 중 애플리케이션은 `DATABASE_URL`만 읽도록 구성합니다.

### 테스트 DB 초기화

다음 명령은 `public` 스키마를 삭제하므로 개발·테스트 DB에서만 사용합니다.

```powershell
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f database/schema.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f database/seed.sql
```

## 10. 실제 사용 예시: 착오송금

### 1) 감정팀이 보내는 JSON

```json
{
  "schema_version": "1.0",
  "external_session_key": "K7-DEMO-20260715-0001",
  "result_key": "K7-EMOTION-DEMO-0001-001",
  "model_name": "k7-emotion-temperature-model",
  "model_version": "0.1.0",
  "analysis_status": "completed",
  "emotion_temperature_score": 74.0,
  "emotion_temperature_level": "elevated",
  "audio_quality": "normal",
  "failure_code": null,
  "generated_at": "2026-07-15T00:00:55Z"
}
```

백엔드는 JSON Schema 검증 후 `external_session_key`로 세션을 찾고 `model_analysis_results`에 저장합니다.

### 2) PostgreSQL 저장

- `consultation_sessions`: 문의 유형 `mistaken_transfer`
- `utterances`: 마스킹 발화
- `model_analysis_results`: 감정온도 74, `elevated`
- `ai_consultation_cards`: 요약·위험도·추천 조치·규정 참조
- `routing_recommendations`: 송금지원팀 후보와 선택 결과

### 3) 백엔드 통합 조회

백엔드 내부 처리에는 `get_current_session_card(external_session_key)`의 평면 결과를 사용합니다. React에 바로 반환할 때는 `get_consultation_card_response(external_session_key)`를 사용하면 JSON Schema와 동일한 중첩 JSON이 생성됩니다. 두 결과 모두 마스킹 고객정보·감정온도·상담카드·라우팅·최근 상담 5건·마스킹 발화만 포함합니다.

### 4) React 최종 응답

`contracts/examples/consultation_card_response.example.json`과 같은 구조를 받습니다. 화면에는 `김*준`, 착오송금, 감정온도 `고조`, 위험도 `high`, 추천 조치, 관련 규정, 송금지원팀이 표시됩니다.

현재 시연 화면 [K7 라이브 상담 프로토타입](https://k7product.vercel.app/)과 이 저장소의 `src/services/consultation.ts`는 아래 JSON 계약을 사용합니다. `VITE_USE_REAL_DATA_API=false`일 때는 표준 예제 JSON을, `true`일 때는 같은 구조의 FastAPI 응답을 읽습니다.

| 프로토타입 화면 | API·DB 기준 |
|---|---|
| 상담 준비 카드 제목·요약 | `consultation_card.summary`, `customer_request` |
| 감정온도 | `emotion_temperature.score`, `level`, `label_ko` |
| 이번 상담 유의사항 | `risk_factors`, `confirmation_items` |
| 숙련 상담사 우선 | `routing_result`의 부서·상담사·근거 |
| 관련 규정·매뉴얼 | `related_manual_refs` |
| 과거 상담 이력 | `recent_consultations` 최대 5건 |
| 후처리 요약·결과 | 세션 종료 시 `consultation_history` |

프로토타입의 본인확인과 보유상품 조회는 외부 금융 시스템 영역이므로 이 DB 모듈에 저장하지 않습니다.

## 11. 개인정보·보안 원칙

### 해야 할 것

- 가상 고객정보와 마스킹 값을 사용합니다.
- 전화·계좌 검색은 운영에서 서버 비밀키 기반 HMAC-SHA-256을 사용합니다.
- 발화 원문이 필요하면 애플리케이션/KMS 암호문과 키 버전을 함께 저장합니다.
- 녹취 동의가 없는 세션에는 원문 암호문도 저장하지 않습니다.
- 권한 확인과 고객정보 조회로그 기록을 같은 요청 흐름에서 처리합니다.
- 조회 거부도 감사로그에 남깁니다.

### 하면 안 되는 것

- 실제 금융 고객정보를 seed·JSON에 사용하지 않습니다.
- React에 검색 해시·암호문·키 버전을 노출하지 않습니다.
- 음성 원본을 PostgreSQL에 직접 저장하지 않습니다.
- 고객정보·발화 원문을 `access_logs`에 기록하지 않습니다.
- DB 비밀번호와 `DATABASE_URL`을 커밋하지 않습니다.
- 모델 JSON에 로컬 파일 경로를 포함하지 않습니다.

`access_logs`는 생성 후 UPDATE·DELETE가 트리거로 차단됩니다. DB 제약조건은 FastAPI의 사용자 인증·데이터 인가를 대신하지 않습니다.

## 12. 현재 범위와 향후 확장

### 현재 구현 완료

- P0 상담 세션·STT·감정온도·상담카드·라우팅 통합 구조
- STT·마스킹·감정·카드·라우팅·오류·React 응답 JSON 계약
- 멱등 저장 명령과 OpenAPI 인터페이스 계약
- P1 과거상담·주의정보·상담사 권한·조회로그 스키마와 가상데이터
- PK·FK·UNIQUE·NOT NULL·CHECK·인덱스·삭제 정책
- 로컬·Railway 실행 문서와 PostgreSQL 16 검증
- React 표준 목업 import와 FastAPI 통합 상담카드 조회 서비스

### 연동팀이 구현할 부분

- `openapi.yaml` 기준 FastAPI 엔드포인트
- STT 원문 마스킹과 선택적 애플리케이션 암호화
- RAG 규정 참조 ID 조회
- React 인증 세션과 FastAPI CORS·쿠키 정책 연결

### 이번 프로젝트에서 제외

- 본인인증
- STT·감정분석·AI 요약·RAG·라우팅 알고리즘
- FastAPI API와 신규 React 화면 설계
- 음성 원본·방언·한숨·된소리·모델 학습 특징의 PostgreSQL 저장
- 실제 금융 거래와 실제 고객정보

## 13. 문제 해결

| 문제 | 확인·해결 |
|---|---|
| `DATABASE_URL` 미설정 | PowerShell에서 `$env:DATABASE_URL` 값을 확인 |
| 스키마 중복 생성 | 새 테스트 DB 사용 또는 개발 DB `public` 스키마 초기화 |
| `seed.sql` FK 오류 | 반드시 `schema.sql` 후 실행하고 seed 일부만 실행하지 않음 |
| JSON Schema 검증 실패 | 필수 필드·`snake_case`·UTC 시각·추가 필드를 확인 |
| 감정온도 점수·구간 불일치 | 0~33 안정, 33 초과~66 주의, 66 초과~100 고조 적용 |
| `external_session_key` 중복 | 같은 통화 재요청인지 확인하고 API에서 `409` 처리 |
| 같은 `result_key`의 값이 다름 | 재처리 결과에 새 `result_key`를 발급하거나 충돌로 처리 |
| 권한 없는 고객정보 조회 | `check_counselor_permission` 결과와 `access_logs` 거부 기록 확인 |
| Railway 외부 연결 실패 | TCP Proxy 주소·포트와 서비스 상태 확인; 내부 서비스는 참조 변수 사용 |

SQL은 `ON_ERROR_STOP=1`로 실행하여 첫 오류에서 멈추게 합니다.

## 14. 팀 공유 체크리스트

- [ ] 공통 `external_session_key`를 사용한다.
- [ ] JSON 필드명은 `snake_case`다.
- [ ] 시간은 ISO 8601 UTC다.
- [ ] 실제 고객정보를 사용하지 않는다.
- [ ] 모델 결과가 JSON Schema를 통과한다.
- [ ] 같은 입력 재전송이 중복 행을 만들지 않는다.
- [ ] React는 FastAPI를 통해서만 데이터를 받는다.
- [ ] 감정온도 코드가 DB와 JSON에서 동일하다.
- [ ] 로컬 음성 파일 경로를 모델 JSON에 넣지 않는다.
- [ ] 고객정보 조회 성공·거부를 감사로그에 남긴다.

## 15. Codex·Claude Code가 이 모듈을 수정할 때 지킬 규칙

1. 먼저 `database/README.md`, `integration_contract.md`, `data_dictionary.md`를 읽습니다.
2. 본인인증 구조를 추가하지 않습니다.
3. 기존 테이블이나 컬럼을 임의로 삭제하지 않습니다.
4. 스키마 변경 시 SQL·ERD·데이터 사전·JSON 계약을 함께 수정합니다.
5. 감정온도 경계 `0~33`, `33 초과~66`, `66 초과~100`을 임의로 바꾸지 않습니다.
6. 개인정보 원문을 seed나 예제 JSON에 넣지 않습니다.
7. PostgreSQL 16에서 `schema.sql → seed.sql → queries.sql → commands.sql → verify.sql`을 다시 검증합니다.
8. 프론트 연동을 바꿀 때는 표준 예제 JSON fallback과 기존 시연 흐름을 유지합니다.
9. 미확정 정책은 임의로 결정하지 않고 `integration_contract.md`의 합의 항목에 기록합니다.
