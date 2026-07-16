# STT 상담 요약·분류 계약 모듈

STT로 전사된 상담 텍스트를 받아 상담 요약, 업무 유형, 전달 부서, 사고징후를 반환합니다. 외부로 나가는 결과는 K7 공식 모델 입력 계약인 `database/contracts/model_consultation_result_input.schema.json`과 같은 `snake_case` 필드를 사용합니다.

이 모듈의 결과를 PostgreSQL에 직접 저장하지 않습니다. FastAPI가 결과를 `mvp-1.0` 계약으로 검증하고 저장합니다.

## 응답 JSON

```json
{
  "summary": "고객이 잘못 송금한 30만 원의 반환 절차를 문의함",
  "business_type": "착오송금 반환",
  "department": "금융사기",
  "routing_reason": "착오송금 반환 업무에 해당",
  "incident_risk": "high",
  "risk_reason": "착오송금으로 인한 자금 오류 및 반환 요청",
  "routing_confidence": 0.93
}
```

필수 필드는 `summary`, `business_type`, `department`, `routing_reason`입니다. 사고징후가 있으면 `incident_risk`와 `risk_reason`을 함께 보냅니다. 감정온도는 별도 계약이므로 `emotion`, `emotionLevel`, `headline`, `bullets`, `recommendedAgent`는 포함하지 않습니다.

## 파일 역할

- `types.ts`: 요청·응답 타입
- `rules.ts`: 부서 라우팅 및 사고징후 기준
- `prompt.ts`: 모델 지시문과 구조화 응답 JSON Schema
- `classify.ts`: 실제 API 호출부를 주입하는 연결 함수와 응답 검증

## 연결 방법

모델 실행 백엔드가 분류 결과를 반환하는 예시입니다. 실제 MVP에서는 FastAPI의 `POST /api/v1/calls` 파이프라인 내부 어댑터가 이 결과를 받아 저장합니다.

```ts
import {
  classifySttText,
  type ClassificationTransport,
} from "./features/stt-classification/classify";

const transport: ClassificationTransport = async ({ text }) => {
  const response = await fetch("/internal/model/classify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error("상담 분류 요청에 실패했습니다.");
  }

  return response.json();
};

const result = await classifySttText(sttText, transport);
```

OpenAI API 키는 브라우저 코드에 넣지 않고 백엔드 환경변수로 관리합니다. 화면은 이 원시 결과를 직접 읽지 않고 `GET /api/v1/calls/{call_id}/consultation-card`만 사용합니다.

## 입력 예시

```text
오늘 오전 다른 사람 계좌로 30만 원을 잘못 보냈습니다. 착오송금 반환 절차를 알려주세요.
```

`incident_risk`를 제공하면 `low` 또는 `high`, `routing_confidence`를 제공하면 0부터 1 사이 숫자여야 합니다.
