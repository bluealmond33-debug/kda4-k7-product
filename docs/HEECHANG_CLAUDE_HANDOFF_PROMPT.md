# 이희창·Claude용 K7 데이터 거버넌스 통합 인계 프롬프트

아래 프롬프트 전체를 이희창 님의 백엔드 작업 Claude에게 그대로 전달하면 됩니다.

---

당신은 K7 음성 상담 MVP의 운영 FastAPI 통합 담당자다. 먼저 현재 이희창 백엔드 저장소와 Railway 운영 서비스의 실제 코드를 읽고, 아래 인계 자산을 대조한 뒤 작업하라. 추측으로 기존 STT·분석·RAG 파이프라인을 덮어쓰거나 서비스를 새로 만들지 마라.

## 사람과 역할

- 이희창: 기존 FastAPI, 실제 STT, 전체 파이프라인과 Railway 운영 서비스 소유자
- 이찬희: 데이터 거버넌스, 표준 JSON 계약, PostgreSQL, 저장·조회 API, React 연결 경계 담당자
- 이찬희 작업 저장소: `bluealmond33-debug/kda4-k7-product`
- 작업 브랜치: `lch`
- 검토 PR: `lch → main`, PR #1
- 이희창 운영 백엔드: `https://kda4-k7-backend-production.up.railway.app`
- 운영 API 문서: `https://kda4-k7-backend-production.up.railway.app/docs`

## MVP의 확정 범위

고객 입력은 음성만 사용한다. 개인정보 마스킹, 고객 마스터, 권한·감사로그, 실제 상담사 자동배정은 이번 MVP 범위가 아니다. 감정·요약·라우팅·RAG의 임시 로직은 각 팀원의 실제 로직을 받으면 교체하되, 준비되지 않은 감정 점수를 실제 모델 결과처럼 만들지 않는다.

최종 흐름은 반드시 다음과 같아야 한다.

```text
고객 음성
→ 이희창 FastAPI
→ 실제 STT
→ 팀 요약·분류·라우팅 결과
→ 이찬희 model_adapter.py 정규화
→ mvp-1.0 Pydantic 계약 검증
→ Railway PostgreSQL 3테이블 트랜잭션 저장
→ call_id 반환
→ GET 저장 결과 재조회
→ Vercel React 상담카드 표시
```

## 이찬희가 구현하고 검증한 활성 자산

다음 파일은 `lch` 브랜치에서 확인하라.

- `database/active-manifest.json`: 활성 버전·파일·테이블·API를 기계가 읽는 단일 기준으로 고정
- `database/mvp/schema.sql`: 활성 PostgreSQL 스키마. 정확히 `calls`, `transcripts`, `consultation_cards` 3테이블
- `database/contracts/model_consultation_result_input.schema.json`: 교체 가능한 모델 결과 입력 경계
- `database/mvp/model_postprocessing.v1.json`: 형진 모델의 금융 분류 라벨을 K7 부서·위험도로 변환하는 버전형 규칙
- `database/contracts/mvp_call_response.schema.json`: FastAPI·DB·React 최종 `mvp-1.0` 응답 계약
- `backend/app/model_adapter.py`: 모델 실험 필드를 버리고 위험도 별칭을 `low | high`로 정규화하는 활성 어댑터
- `backend/app/contracts.py`: Pydantic 계약, 고위험 사유·감정 상태 조합·버전·음성 채널 검증
- `backend/app/database.py`: `DATABASE_URL`을 사용하는 유일한 저장소 경계, 3테이블 원자적 저장과 call_id 재조회
- `backend/app/main.py`: `POST /api/v1/calls`, `GET /api/v1/calls/{call_id}/consultation-card`, `GET /health` 참조 구현
- `src/services/consultation.ts`: React가 DB에 직접 접근하지 않고 POST/GET API만 호출하는 경계
- `scripts/smoke-mvp.ps1`: 배포 API의 음성 POST→DB→GET 동일성 검증
- `scripts/check-production-readiness.ps1`: 운영 OpenAPI·기존 경로·DB·계약 버전을 변경 없이 확인
- `.github/workflows/production-readiness.yml`: 병합 후 GitHub Actions 버튼으로 동일 검사를 실행
- `backend/tests/test_database_integration.py`: 실제 PostgreSQL UTF-8·정확히 3테이블·제약조건·한글 왕복 저장·자동 삭제 검증
- `docs/HYUNGJIN_MODEL_HANDOFF_MESSAGE.md`: 형진 모델 서버 연결에 필요한 자료를 요청하는 Slack 메시지

`database/schema.sql`, `commands.sql`, `queries.sql`, `seed.sql`, `verify.sql`, `database/adapters/` 및 마스킹 중심 계약은 기존 12테이블 확장 참고 자산이다. 현재 Railway MVP에 적용하거나 import하지 마라.

## 표준 모델 결과

모델팀 함수의 결과를 다음 최소 필드로 `normalize_model_result()`에 넘겨라.

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

전형진 금융 특화 모델 서버는 다음 원시 결과를 반환해도 된다.

```json
{
  "summary": "고객이 주택담보대출 만기 연장 가능 여부를 문의함.",
  "task_category": "대출",
  "consulting_situation": "만기 연장 문의",
  "qa_topic": "주택담보대출 만기 연장"
}
```

활성 어댑터는 이 네 필드를 `model_postprocessing.v1.json`과 대조해 `business_type`, `department`, `incident_risk`, `risk_reason`, `routing_confidence`를 만든다. `routing_confidence`는 형진 모델의 정확도나 확률이 아니라 검토된 업무→부서 매핑 규칙의 신뢰도다. 처음 보는 라벨은 일반 부서로 추측하지 말고 오류로 처리한 뒤 규칙 파일을 PR로 보완하라.

규칙:

- `incident_risk`: `low | high`; 입력 어댑터는 `낮음 | 저위험 | 높음 | 고위험`도 정규화 가능
- `high`일 때 `risk_reason` 필수
- 위험 정보가 누락되면 이번 2단계 MVP에서는 `low`로 정규화
- 알려지지 않은 위험 문자열은 추측하지 말고 거부
- 추가 실험 필드는 DB 표준 컬럼에 넣지 않고 `raw_model_result` JSONB에 원본 추적용으로 저장
- `schema_version`은 `mvp-1.0`, `source_channel`은 `voice`로 고정
- 감정 모델 미연동 시 `status=unavailable`, `score=null`, `level=null`

형진 님에게 실제 연동 전에 반드시 받을 자료:

1. 모델 서버 요청·응답 JSON 한 건
2. `task_category`, `consulting_situation`, `qa_topic`의 전체 라벨 목록
3. 정상·분석불가·오류 응답 각 한 건
4. 모델 버전 식별값
5. 서버 URL과 인증 방식
6. 모델 자체 confidence가 있다면 필드 의미와 범위

형진 모델 서버가 사내 PC나 내부망에서만 열려 있으면 Railway는 직접 호출할 수 없다. MVP 시연 시에도 Railway에서 접근 가능한 HTTPS 주소, 승인된 터널/프록시, 또는 Railway에서 실행되는 별도 모델 서비스 중 하나가 필요하다. 접근 경로가 확정되기 전에는 URL이나 인증 방식을 추측해 구현하지 마라.

## 운영 백엔드에 통합하는 순서

1. 이희창 저장소의 현재 엔드포인트·Pydantic 모델·STT 함수·분석 함수·Railway 시작 명령을 먼저 목록화하라.
2. 기존 `/stt`, `/analyze`, `/judge`, `/rag`, `/analyze-text`, `/emotion`, `/summarize`, `/briefing` 동작을 삭제하지 마라.
3. `lch`의 `contracts.py`, `model_adapter.py`, `database.py`와 `database/mvp/schema.sql`에서 필요한 경계만 이희창 코드 구조에 맞게 이식하라. `lch`의 전체 FastAPI 앱으로 운영 앱을 교체하지 마라.
4. 기존 STT 결과 텍스트를 형진 모델 서버에 보내고, 받은 `summary/task_category/consulting_situation/qa_topic`을 `normalize_model_result(raw_result)`에 전달하라. 같은 음성을 두 번 STT하지 마라.
5. 정규화 결과로 `MvpCallResponse`를 만들고 `save_call()`로 저장한 뒤 응답하라.
6. `GET /api/v1/calls/{call_id}/consultation-card`는 모델을 다시 실행하지 말고 PostgreSQL에 저장된 결과만 조회해야 한다.
7. `GET /health`가 PostgreSQL 연결 여부와 `contract_version=mvp-1.0`을 반환하게 하라.
8. Railway 운영 백엔드 변수에 새 비밀값을 복사하지 말고 기존 Postgres 서비스 참조 `DATABASE_URL=${{Postgres.DATABASE_URL}}`를 연결하라.
9. 기존 Postgres 서비스 하나만 사용하라. 별도 DB나 `k7-mvp-lch-preview` 서비스를 만들지 마라.
10. Vercel origin `https://k7product.vercel.app`을 CORS 허용 목록에 유지하라. Vercel 팀 공유는 유료이므로 소유자가 자기 계정에서 환경변수와 배포를 직접 반영한다.
11. 로그·PR·답변에 `DATABASE_URL`이나 `OPENAI_API_KEY` 값을 출력하지 마라.

## PostgreSQL의 이유와 책임 경계

POST 응답을 화면에 바로 보여주는 것만으로도 한 번의 시연은 가능하지만, 재조회·새로고침·다른 상담사 화면·장애 후 확인을 할 수 없다. PostgreSQL은 STT 원문과 그때 생성된 표준 상담카드를 같은 `call_id`로 보존한다. React와 모델은 DB에 직접 접속하지 않고 FastAPI만 접속한다.

저장 관계는 다음 한 줄이다.

```text
calls 1건 ─ transcripts 1건 ─ consultation_cards 1건
```

세 INSERT는 하나의 트랜잭션이어야 하며 중간 실패 시 일부 데이터만 남으면 안 된다.

## 실제 검증된 사실

- Railway Postgres 서비스 ID: `71973777-1539-462e-b29b-7675afdb6b96`
- 서버 인코딩: UTF8
- public 기본 테이블: 정확히 `calls`, `transcripts`, `consultation_cards`
- 한국어 WAV로 STT→정규화→저장→같은 call_id GET 재조회 성공
- 형진 모델 원시 4필드→후처리 어댑터→표준 카드→실제 Railway PostgreSQL 재조회 성공
- PostgreSQL 통합 테스트는 검증 행을 `finally`에서 자동 삭제
- 로컬 회귀검증: Python 테스트, JSON Schema, 어댑터, TypeScript, Vite build 통과
- 이찬희는 이희창 운영 Railway 서비스와 이희창 저장소를 수정하지 않았음
- `k7-mvp-lch-preview`는 도메인·환경변수·DB 연결을 해제했으며 운영 E2E 확인 후 빈 서비스 삭제만 Railway 관리자 권한 필요. 기술적 의존성은 없어 지금 삭제해도 운영에 영향 없음

## 통합 후 반드시 실행할 검증

```powershell
npm run check
.\.venv\Scripts\python.exe -m pytest backend\tests -q
.\scripts\check-production-readiness.ps1
```

실제 PostgreSQL 테스트는 DB URL을 화면에 출력하지 않는 방식으로 실행하고, 종료 후 환경변수를 제거하라. 배포 후에는 실제 한국어 음성으로 다음을 확인하라.

1. `GET /health`가 `database=connected`
2. `POST /api/v1/calls`가 201과 `call_id` 반환
3. STT 텍스트가 한글로 정상 반환
4. `schema_version=mvp-1.0`, `source_channel=voice`
5. 같은 call_id의 GET이 200
6. POST와 GET의 전체 응답이 동일
7. Vercel 상담 준비 카드가 mock이 아니라 이 응답을 표시
8. 기존 9개 데모 API가 계속 응답

## 작업 보고 형식

먼저 실제 코드 조사 결과와 충돌 가능성을 보고하고, 그다음 최소 변경으로 통합하라. 완료 보고에는 다음을 정확히 포함하라.

- 변경한 저장소·브랜치·커밋
- 변경 파일과 각 변경 이유
- Railway에서 연결한 변수 이름만 기재하고 값은 숨김
- 실행한 검증 명령과 결과
- 실제 POST call_id와 GET 동일성 결과
- 기존 API 회귀 결과
- 아직 임시인 감정·요약·라우팅·RAG 항목
- 형진 모델 서버의 Railway 접근 가능 여부, Vercel 소유자 직접 배포 등 본인이 해결하지 못한 외부 차단 요소

성공 기준은 “배포가 떴다”가 아니라 **기존 이희창 파이프라인을 보존하면서 실제 고객 음성이 `mvp-1.0`으로 정규화되어 PostgreSQL에 저장되고, 같은 call_id로 재조회되어 Vercel에 표시되는 것**이다.

---
