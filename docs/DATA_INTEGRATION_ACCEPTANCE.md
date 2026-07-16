# K7 데이터 통합 인수 기준

## 목적

이 문서는 “각 기능이 따로 동작한다”가 아니라 고객 음성 한 건이 표준 계약으로 PostgreSQL에 저장되고 화면에서 다시 조회되는지를 최종 판정합니다.

데이터 거버넌스·통합 담당자는 **이찬희**이며 다음 경계의 변경 검토와 최종 E2E 인수를 담당합니다.

- `database/active-manifest.json`
- `database/contracts/model_consultation_result_input.schema.json`
- `database/contracts/mvp_call_response.schema.json`
- `database/mvp/model_postprocessing.v1.json`
- `database/mvp/schema.sql`
- `backend/app/model_adapter.py`
- `backend/app/integration_service.py`
- `backend/app/database.py`
- `POST /api/v1/calls`
- `GET /api/v1/calls/{call_id}/consultation-card`

소유권은 다른 팀원의 코드를 대신 작성한다는 뜻이 아닙니다. STT·모델·백엔드·React가 서로 다른 형식으로 갈라지지 않도록 공통 경계를 승인하고, 저장·재조회 결과가 같은지 검증하는 책임입니다.

## 팀별 입력과 책임

| 담당 | 제공할 것 | 데이터 통합 인수 조건 |
|---|---|---|
| 이희창 | STT·운영 FastAPI·Railway 배포 | POST/GET과 `DATABASE_URL` 연결, 기존 API 유지 |
| 전형진 | 금융 Summary·Classification 모델 서버 | 원시 4필드, 전체 라벨, 오류 계약, 버전 제공 |
| 김설빈 | 감정·요약·라우팅 관련 실제 로직 | 가짜 점수 없이 상태·값 의미 확정 |
| 김민기 | RAG·브리핑카드·규정 자료 | 카드 참조값과 실제 문서 연결 |
| UI/Vercel 소유자 | React 운영 배포 | DB 직접 접근 없이 상담카드 GET 결과 표시 |
| 이찬희 | 계약·어댑터·PostgreSQL·인수 테스트 | 아래 완료 기준 전체 검증과 결과 기록 |

## 변경 통제 규칙

1. 모델 라벨이 바뀌면 DB 컬럼을 바로 바꾸지 않고 `model_postprocessing.v1.json`을 갱신합니다.
2. API 필드가 바뀌면 JSON Schema·Pydantic·TypeScript·예제·테스트를 같은 PR에서 바꿉니다.
3. React와 모델 서버는 PostgreSQL에 직접 접속하지 않습니다.
4. `DATABASE_URL`과 API 키는 Railway 백엔드 변수로만 관리합니다.
5. 새 분류 라벨을 임의 부서로 추측하지 않습니다.
6. 감정 모델이 준비되지 않았으면 `unavailable`을 사용하며 임의 점수를 만들지 않습니다.
7. 개인정보 마스킹은 현재 MVP 범위가 아니므로 활성 계약에 몰래 추가하지 않습니다.

## 최종 완료 기준

- [x] `lch`에 `mvp-1.0` 계약·어댑터·PostgreSQL 3테이블 구현
- [x] 대출·금융사기·미매핑 모델 후처리 테스트
- [x] 실제 Railway PostgreSQL UTF-8·3테이블·제약조건 검증
- [x] 형진 원시 4필드 → 표준 카드 → 실제 DB 저장·재조회 검증
- [x] 희창 기존 STT·모델 결과 주입형 독립 통합 서비스와 실제 DB 검증
- [x] React·계약·FastAPI GitHub CI 통과
- [ ] `lch` 변경을 이희창 운영 FastAPI에 실제 이식
- [ ] 운영 `/health`가 `database=connected`, `contract_version=mvp-1.0` 반환
- [ ] 운영 POST가 실제 한국어 음성에서 201과 call_id 반환
- [ ] 같은 call_id의 GET이 POST와 동일한 응답 반환
- [ ] 기존 8개 호환 API 회귀 통과
- [ ] Vercel 소유자가 실제 운영 API 응답을 상담카드에 표시
- [ ] 연결 해제된 preview 빈 서비스 최종 정리

## 최종 인수 기록

운영 배포 후 이찬희 담당자가 다음 표를 실제 값으로 채우고 승인합니다. API 키·DB URL·고객 개인정보는 기록하지 않습니다.

| 증거 | 기록값 |
|---|---|
| 운영 백엔드 commit | 대기 |
| `lch` 기준 commit | PR #1 최신 HEAD |
| readiness 실행 시각 | 대기 |
| readiness 결과 | 현재 `false` |
| 실제 음성 test call_id | 대기 |
| POST/GET 동일 | 대기 |
| Vercel 표시 | 대기 |
| 최종 인수 담당 | 이찬희 |

운영 완료 판정은 `scripts/check-production-readiness.ps1`의 `ready=true`와 `scripts/smoke-mvp.ps1`의 실제 음성 성공이 모두 있어야 합니다.
