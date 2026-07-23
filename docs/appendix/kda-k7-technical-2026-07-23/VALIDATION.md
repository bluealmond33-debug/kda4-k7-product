# 최종 검증 기록

검증일: 2026-07-23

## 산출물

- 최종 PNG 10장: 모두 1920×1080
- 전체 미리보기 1장: `final-contact-sheet.png`
- REST 계약: `openapi.yaml`, `openapi.json`
- WebSocket 계약: `websocket-events.yaml`
- ERD 원본: `schema.dbml`, SVG, DOT
- 편집 가능한 API·모델 프로파일 SVG 제공

## 내용 검증

- [x] Galaxy WO Mic → 고객 Windows → 서버 노트북 폐쇄망 경로 표시
- [x] 고객·상담사 발화를 `speaker` 기준으로 분리
- [x] PCM16 little-endian, mono, 16 kHz 전송 조건 표시
- [x] STT 원문과 AI 요약을 별도 데이터 단계로 구분
- [x] faster-whisper `large-v3-turbo`, EXAONE 3.5 7.8B 표시
- [x] eGeMAPS 88개 특징 + LightGBM 현재 감정온도 표시
- [x] WavLM Base+ 후보 상태와 검증 지표를 점선·주황색으로 구분
- [x] BGE-M3, pgvector, 규칙 + local scikit-learn 표시
- [x] PostgreSQL 저장과 PII 격리 경계 표시
- [x] 정상 종료·갑작스러운 종료·고객 초기 종료 경로 표시
- [x] 종료 후 잔여 오디오 drain → 최종 저장 → 후처리 순서 표시
- [x] 재연결 시 `call_id + generation` 및 이전 세대 무시 규칙 표시
- [x] DTMF와 `auth_input` 구분, 0번을 종료 키로 고정하지 않음
- [x] 인증 실패·시간초과에도 상담 연결 유지
- [x] REST 경로와 WebSocket 경로·이벤트를 실제 계약 파일과 교차 확인
- [x] 서비스 논리 ERD와 MVP·RAG 물리 ERD를 분리

## 시각 검증

- [x] 제목·핵심 흐름이 16:9 축소 화면에서 식별 가능
- [x] 고객·상담사 장비보다 중앙 서버와 처리 계층을 크게 표현
- [x] 화살표에 실제 이동 데이터 또는 상태만 짧게 표기
- [x] 기술명·모델명 외 기능 설명은 한국어 중심
- [x] 현재 경로, 후보/확인 필요 경로, 저장·정상 처리의 색상 구분
- [x] `final-contact-sheet.png`로 10장 전체 밀도·순서 점검

## 알려진 표현 범위

- Appendix는 코드 스냅샷과 확인된 설계를 함께 표현한다.
- WavLM은 현재 제품 경로가 아니라 연구 완료 후 교체 검증 중인 후보이다.
- 호환 분석 REST 경로는 실시간 통화의 주 계약과 분리해 흐리게 표현한다.
- WebSocket은 별도 AI 모델이나 별도 서버가 아니라 FastAPI가 제공하는 지속 연결 방식이다.
