# K7 JSON 계약

## 먼저 확인할 운영 기준

현재 배포 기준은 `database/active-manifest.json`에 등록된 **음성 전용·비마스킹 `mvp-1.0`**입니다.

| 상태 | 파일 | 용도 |
|---|---|---|
| 활성 | `model_consultation_result_input.schema.json` | 교체 가능한 팀 모델 결과가 FastAPI 어댑터로 들어오는 입력 경계 |
| 활성 | `mvp_call_response.schema.json` | FastAPI·PostgreSQL·React가 공유하는 최종 응답 계약 |
| 활성 | `examples/mvp_call_response.example.json` | 프런트 mock과 계약 테스트용 정상 예제 |

활성 변환 코드는 `backend/app/model_adapter.py`, Pydantic 검증은 `backend/app/contracts.py`에 있습니다. 모델의 실험 필드나 내부 데이터셋 구조를 PostgreSQL 계약으로 사용하지 않습니다.

## 참고용 확장 계약

아래 파일은 기존 12테이블·마스킹·감정온도·상담사 라우팅 확장 설계 자료입니다. JSON 문법과 예제는 회귀 테스트하지만 **현재 Railway MVP 저장·조회에는 사용하지 않습니다.**

- `openapi.yaml`
- `stt_utterance_input.schema.json`
- `masked_utterance.schema.json`
- `emotion_temperature_result.schema.json`
- `consultation_card.schema.json`
- `routing_candidate.schema.json`
- `consultation_card_response.schema.json`
- `error_response.schema.json`
- 각 파일의 `examples/` 예제
- `model_adapter_guide.md`

이 확장 계약을 활성화하려면 `active-manifest.json`과 계약 버전을 변경하는 별도 PR이 필요합니다. 기존 파일을 Railway에 직접 적용하지 않습니다.

## `mvp-1.0` 공통 규칙

- 입력 채널은 `voice`만 허용합니다.
- 필드명은 API·DB 경계에서 `snake_case`를 사용합니다.
- API 계약 버전은 `mvp-1.0`으로 고정합니다.
- 개인정보 마스킹은 이번 MVP 처리 단계가 아닙니다.
- 모델 결과는 `backend/app/model_adapter.py`를 통과한 뒤에만 저장합니다.
- 위험도는 `low | high`로 저장하고 화면에서만 `낮음 | 높음`으로 번역합니다.
- `high`이면 `risk_reason`이 반드시 있어야 합니다.
- 감정 모델 미연동 상태는 `unavailable`, 점수와 단계는 `null`입니다.
- React와 모델은 PostgreSQL에 직접 연결하지 않고 FastAPI만 `DATABASE_URL`을 사용합니다.
- 계약 변경은 예제·Pydantic·TypeScript·SQL·테스트를 같은 PR에서 함께 바꿉니다.

검증은 저장소 루트에서 `npm run check`를 실행합니다.
