# K7 JSON 계약

## 목적

JSON 파일은 운영 데이터를 쌓는 저장소가 아니라 팀 간 입력·출력 형식을 고정하는 계약과 테스트용 예시입니다.

| 파일 | 사용 주체 | 용도 |
|---|---|---|
| `openapi.yaml` | 백엔드·React | FastAPI 경로·상태 코드·요청·응답 계약 |
| `model_adapter_guide.md` | 모델·백엔드·DB | 변경 가능한 모델 출력을 K7 표준 계약으로 변환하는 경계 |
| `stt_utterance_input.schema.json` | STT·백엔드 | STT 원문 입력 검증 규격 |
| `masked_utterance.schema.json` | 백엔드·후속 모델 | 마스킹 이후 전달·저장 규격 |
| `emotion_temperature_result.schema.json` | 감정 모델·백엔드 | 모델 결과 검증 규격 |
| `consultation_card.schema.json` | 분류·요약·RAG·백엔드 | 상담카드 저장 규격 |
| `routing_candidate.schema.json` | 라우팅·백엔드 | 부서·상담사 후보 규격 |
| `consultation_card_response.schema.json` | 백엔드·React | 마스킹 고객정보·현재 주의정보·화면 통합 응답 검증 규격 |
| `error_response.schema.json` | 백엔드·전체 클라이언트 | 공통 오류 응답 규격 |
| `examples/emotion_temperature_result.example.json` | 감정 모델·백엔드 | 정상 입력 예시 |
| `examples/consultation_card_response.example.json` | 백엔드·React | 화면 개발용 응답 예시 |

각 `*.schema.json`에는 같은 이름의 정상 예제가 `examples/`에 있습니다. 예제는 실제 고객정보가 아닌 가상 데이터만 사용합니다.

## 공통 규칙

- 필드명은 `snake_case`를 사용합니다.
- 팀 공통 연결 키는 `external_session_key`입니다.
- 시각은 ISO 8601 UTC 문자열로 전달합니다.
- 모델은 로컬 `audio_file` 경로, 음성 원본, 고객 개인정보를 JSON에 넣지 않습니다.
- 계약이 바뀌면 `schema_version`을 올리고 기존 버전과 동시에 지원할 기간을 합의합니다.
- 재전송 가능한 결과는 같은 `external_session_key`와 멱등 키를 사용합니다.
- 같은 멱등 키의 내용이 달라지면 덮어쓰지 않고 `409 Conflict`로 처리합니다.
- React는 예제 JSON으로 먼저 개발하고, 이후 동일한 응답 구조의 FastAPI 호출로 교체합니다.
- 모델 저장소의 중간 스키마를 DB 계약으로 직접 사용하지 않고 `model_adapter_guide.md`의 어댑터 경계를 사용합니다.

## 감정온도 코드

| 시스템 코드 | 화면 표시 | 점수 |
|---|---|---:|
| `stable` | 안정 | 0~33 |
| `caution` | 주의 | 33 초과~66 |
| `elevated` | 고조 | 66 초과~100 |

JSON Schema와 PostgreSQL `CHECK` 제약조건이 같은 경계를 사용합니다.

시연 화면은 [K7 라이브 상담 프로토타입](https://k7product.vercel.app/)을 참고하되, 실제 연동 필드와 감정 단계는 이 계약을 우선합니다.
