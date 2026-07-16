# STT 상담 요약·분류 모듈

STT로 전사된 상담 텍스트를 받아 상담 요약, 업무 유형, 전달 부서, 사고징후를 반환하기 위한 독립 모듈입니다. 기존 K7 화면이나 통화 흐름에는 연결하지 않았으며, API 호출부만 주입하면 사용할 수 있습니다.

## 응답 JSON

```json
{
  "summary": "고객이 잘못 송금한 30만 원의 반환 절차를 문의함",
  "businessType": "착오송금 반환",
  "department": "금융사기",
  "incidentRisk": "high",
  "riskReasons": ["착오송금으로 인한 자금 오류 및 반환 요청"],
  "confidence": 0.93
}
```

응답에는 위 여섯 필드만 사용합니다. `emotion`, `emotionLevel`, `headline`, `bullets`, `recommendedAgent`는 포함하지 않습니다.

## 파일 역할

- `types.ts`: 요청·응답 타입
- `rules.ts`: 부서 라우팅 및 사고징후 기준
- `prompt.ts`: 모델 지시문과 구조화 응답 JSON Schema
- `classify.ts`: 실제 API 호출부를 주입하는 연결 함수와 응답 검증

## 연결 방법

백엔드 API가 `POST /api/summarize`를 제공한다고 가정한 예시입니다.

```ts
import {
  classifySttText,
  type ClassificationTransport,
} from "./features/stt-classification/classify";

const transport: ClassificationTransport = async ({ text }) => {
  const response = await fetch("/api/summarize", {
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

OpenAI API 키는 브라우저 코드에 넣지 않고 백엔드 환경변수로 관리합니다. 백엔드에서는 `prompt.ts`의 `classificationInstructions`와 `classificationResponseSchema`를 구조화 출력 설정에 사용하면 됩니다.

## 입력 예시

```text
오늘 오전 다른 사람 계좌로 30만 원을 잘못 보냈습니다. 착오송금 반환 절차를 알려주세요.
```

`incidentRisk`는 반드시 `low` 또는 `high`, `confidence`는 0부터 1 사이 숫자로 반환해야 합니다.
