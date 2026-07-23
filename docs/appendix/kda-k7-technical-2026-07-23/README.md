# KDA K7 기술 Appendix 시각화 패키지

이 폴더는 발표 본문을 대신하는 자료가 아니라, 발표 후 질의응답·포트폴리오·개발 인수인계에서 시스템의 기술 근거를 확인하기 위한 Appendix입니다. 화면 설명보다 **실제 데이터 흐름, API 계약, 데이터 구조, 모델 실행 위치와 상태**를 우선했습니다.

- 기준일: 2026-07-23
- 본문 이미지: 모두 1920×1080 PNG
- 전체 미리보기: `final-contact-sheet.png`
- 편집 원본: SVG·DBML·YAML·생성 스크립트
- 네트워크 전제: 고성능 서버 노트북의 모바일 핫스팟으로 구성한 로컬 폐쇄망

## 최종 그림 목록

| 파일 | 질문에 답하는 내용 | 발표 활용 |
|---|---|---|
| `final-01-system-context.png` | Galaxy 음성이 어느 장비와 서버를 거쳐 상담사·관리자에게 도달하는가 | 전체 구성 소개 |
| `final-02-system-layers.png` | 프론트엔드·실시간 서버·AI·데이터 계층은 어떻게 의존하는가 | 계층/역할 질문 |
| `final-03-realtime-sequence.png` | 통화 시작부터 STT·분석·상담 연결·종료·재연결은 어떤 순서인가 | 실시간 처리 질문 |
| `final-04-ai-data-pipeline.png` | STT 원문, EXAONE, 감정, RAG, 라우팅 결과를 어떻게 분리·통합하는가 | AI 파이프라인 질문 |
| `final-05-call-lifecycle.png` | 정상 종료·갑작스러운 종료·잔여 오디오 처리·후처리는 어떻게 안전하게 이어지는가 | 예외/상태 질문 |
| `final-06-auth-dtmf.png` | 일반 키패드와 인증 입력을 어떻게 구분하고 PII를 어떻게 격리하는가 | 보안/인증 질문 |
| `final-07a-service-erd.png` | 운영 도메인 12개 테이블의 논리 관계는 무엇인가 | 전체 DB 질문 |
| `final-07b-mvp-rag-erd.png` | 실행 MVP와 RAG의 물리 테이블·인덱스 관계는 무엇인가 | 저장/RAG 질문 |
| `final-08-api-websocket-contract.png` | REST 경로와 WebSocket 경로·이벤트가 화면 및 처리 계층과 어떻게 연결되는가 | API 명세 질문 |
| `final-09-runtime-model-profile.png` | 캡처 노트북과 서버 노트북의 역할, 현재 모델, 후보 모델, 실행 설정은 무엇인가 | 모델/장비 질문 |

권장 발표 삽입 순서는 `01 → 03 → 04 → 05 → 06 → 07A/07B → 08 → 09`입니다. `02`는 전체 구조를 계층 관점으로 다시 설명해야 할 때 사용합니다.

## 함께 제공하는 기술 원본

- `schema.dbml`: 전체 컬럼·PK·FK·unique·인덱스를 보존한 ERD 원본
- `openapi.yaml`, `openapi.json`: FastAPI에서 추출한 REST 계약
- `websocket-events.yaml`: WebSocket 경로, query, 이벤트군, 세션 불변 조건
- `final-08-api-websocket-contract.svg`: API 계약 지도의 편집 가능한 벡터 원본
- `final-09-runtime-model-profile.svg`: 실행·모델 프로파일의 편집 가능한 벡터 원본
- `04-service-erd.svg`, `05-mvp-rag-erd.svg`: ERD 벡터 원본
- `02-realtime-call-flow.mmd`, `03-auth-pii-dtmf-flow.mmd`: Mermaid 흐름 원본
- `04-service-erd.dot`, `05-mvp-rag-erd.dot`: Graphviz ERD 원본

## 핵심 데이터 단계

아래 값은 이름이 비슷해도 서로 덮어쓰면 안 되는 별도 데이터입니다.

1. **오디오 프레임**: PCM16 little-endian, 16 kHz, mono, `speaker=customer|agent`
2. **STT 원문**: 중간 전사와 확정 전사. 고객·상담사 발화를 분리해 저장
3. **AI 결과**: 업무 분류, 상담 요약, 내용 위험, 감정온도, 규정 근거, 라우팅 결과
4. **키패드 이벤트**: 일반 `dtmf`와 인증용 `auth_input`을 목적에 따라 구분
5. **상담 카드**: 원문을 요약으로 위장하지 않고, 요약·주의·근거·업무·라우팅을 조합한 준비 데이터
6. **종료·후처리**: `ended_by`, `end_reason`, 잔여 오디오 drain, 최종 전사, 카드·이력 저장

## AI 모델과 상태

| 기능 | 현재/후보 | 모델·기술 | 실행 위치 및 의미 |
|---|---|---|---|
| 음성→텍스트 | 현재 | faster-whisper `large-v3-turbo` | 서버 노트북 CUDA GPU·float16 |
| 텍스트 분석·요약 | 현재 | Ollama · EXAONE 3.5 7.8B | 업무 분류·요약·내용 위험 |
| 감정온도 | 현재 | eGeMAPS 88개 특징 + LightGBM | 격앙도 참고 신호, local `.joblib` |
| 음성 속 숨은 분노 | 후보 | WavLM Base+ frozen + 3/6/9/12층 통계 통합 | 연구 완료·교체 검증 중, Macro-F1 0.805, angry F1 0.689 |
| 규정 검색 | 현재 | BGE-M3 + pgvector | 1024차원, dense 0.65 + keyword 0.35 |
| 상담 라우팅 | 현재 | 규칙 + local scikit-learn | 단순/일반/긴급 및 부서 분류 |

감정온도, WavLM, EXAONE은 서로 다른 질문에 답합니다. 현재 감정온도는 격앙 정도, WavLM 후보는 음성 속 숨은 분노, EXAONE은 발화 내용의 위험을 판단합니다. 원시 결과를 각각 보존한 뒤 주의도와 상담 카드에서 통합합니다.

## REST·WebSocket 계약

주요 REST:

- `GET /health`
- `POST /api/v1/calls`
- `GET /api/v1/calls/{call_id}/consultation-card`
- `/api/v1/regulations/*`
- `/api/live-stt/*`
- `/stt`, `/emotion`, `/summarize`, `/analyze*`, `/rag` 등은 호환 분석 계층

주요 WebSocket:

- `/ws/audio/{call_id}`: 고객·상담사 오디오 수신
- `/ws/call/{call_id}`: 전사와 캡처 상태 관찰
- `/ws/ars/{call_id}`: 통화 생명주기·DTMF·인증 제어
- `/ws/demo/{call_id}`: 고객·상담사·관리자 역할별 상태 중계와 재생

중요한 세션 규칙은 `call_id + generation` 격리, 고객/상담사 버퍼 분리, 종료 후 남은 STT 작업 drain, 중복 완료 이벤트의 멱등 처리입니다.

## 코드 근거 스냅샷

시각화의 근거를 읽기 전용으로 확인한 저장소와 로컬 스냅샷입니다.

- 제품/UI·실시간 통합: `bluealmond33-debug/kda4-k7-product`
  - UI 통합 스냅샷: `c663cec81f083e0f46a254589cd7ba2420aa7446`
- 백엔드/RAG·데이터: `HeeChang50/kda4-k7-backend`
  - 확인 스냅샷: `5da9bba2f7a17da3a853b9fb30fa4eea770aecea`
- AI·라우팅·문서: `bluealmond33-debug/kda4-k7-hippo`
  - 확인 스냅샷: `35133817a029f0f5f6e145dfe8e97fa28f89818a`

API와 ERD에는 실제 코드에서 추출된 이름을 사용했습니다. 구현은 존재하지만 최종 UI 배선 확인이 필요한 항목과 후보 모델은 점선·주황색으로 구분했습니다.

## 갱신 규칙

- FastAPI 라우트 변경 → `openapi.yaml`과 08번 갱신
- WebSocket 경로·이벤트·`generation` 규칙 변경 → `websocket-events.yaml`, 03·05·06·08번 갱신
- SQL 테이블·FK·인덱스 변경 → `schema.dbml`, 07A·07B 갱신
- 모델·하이퍼파라미터·실행 장치 변경 → 02·04·09번 갱신
- 통화 상태·종료 원인·재연결 규칙 변경 → 03·05번 갱신
- 인증 정책·PII 경계·DTMF 의미 변경 → 06·08번 갱신

## 렌더링과 시각 검증

- AI 시각화 01~06: Codex 내장 이미지 생성 기능으로 생성 후 1920×1080으로 정규화
- 코드 기반 도식 07~09: DBML/OpenAPI/WebSocket 계약을 기준으로 SVG·PNG 생성
- `final-contact-sheet.png`에서 색상, 밀도, 순서, 누락 여부를 일괄 검토
- 외부 계정이나 특정 다이어그램 사이트 없이 로컬 원본으로 다시 렌더링 가능
