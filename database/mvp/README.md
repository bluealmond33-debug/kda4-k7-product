# K7 MVP 데이터베이스

이 폴더가 실제 MVP 배포에 사용하는 활성 스키마입니다.

활성 여부와 파일 경로의 최종 기준은 `../active-manifest.json`이며 CI에서 자동 검증합니다.

핵심 흐름은 `음성 1개 → STT 1개 → 상담카드 1개`이며 테이블도 세 개만 사용합니다.

1. `calls`: 한 번의 고객 음성 접수
2. `transcripts`: STT 원문
3. `consultation_cards`: 요약·업무유형·부서·라우팅 근거

개인정보 마스킹, 고객 마스터, 상담사 권한, 접근로그, 실제 자동배정은 MVP 필수가 아닙니다.
기존 `database/schema.sql`의 12개 테이블은 향후 확장 설계 참고용이며 Railway MVP에는 이 파일만 적용합니다.

FastAPI는 시작할 때 `DATABASE_URL`이 있으면 `schema.sql`을 자동 적용합니다. 기존 DB에도 새 제약조건이 추가되도록 스키마 안의 idempotent migration 블록을 함께 실행합니다.
