import { incidentRiskPolicy, routingDepartments } from "./rules";

export const classificationResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "business_type",
    "department",
    "routing_reason",
  ],
  properties: {
    summary: { type: "string" },
    business_type: { type: "string" },
    department: {
      type: "string",
      enum: routingDepartments.map(({ name }) => name),
    },
    routing_reason: { type: "string" },
    incident_risk: { type: "string", enum: ["low", "high"] },
    risk_reason: { type: "string" },
    routing_confidence: { type: "number", minimum: 0, maximum: 1 },
    model_name: { type: "string" },
    model_version: { type: "string" },
    generated_at: { type: "string", format: "date-time" },
  },
} as const;

export const classificationInstructions = `
너는 한국 금융 고객센터의 STT 상담 접수 분류기다.

STT 원문만 근거로 다음 작업을 수행한다.
1. 상담의 핵심 내용을 간결한 한 문단으로 요약한다.
2. 상담의 업무 유형을 한 가지로 분류한다.
3. 아래 부서 중 가장 적합한 전달 부서를 한 곳 선택한다.
4. 선택한 부서의 근거를 routing_reason에 작성한다.
5. 사고징후가 실제로 있을 때만 incident_risk와 risk_reason을 함께 작성한다.
6. 분류 신뢰도를 제공할 수 있으면 routing_confidence에 0부터 1 사이 숫자로 작성한다.

부서 기준:
${JSON.stringify(routingDepartments)}

사고징후 기준:
${JSON.stringify(incidentRiskPolicy)}

원문에 없는 사실을 만들지 않는다. 개인정보 마스킹은 이 MVP 분류 모듈의 처리 단계가 아니다.
응답 필드는 database/contracts/model_consultation_result_input.schema.json의 snake_case 계약을 따른다.
필수 필드는 summary, business_type, department, routing_reason이다.
incident_risk를 작성하면 risk_reason도 반드시 함께 작성한다.
emotion, emotionLevel, headline, bullets, recommendedAgent는 포함하지 않는다.
`.trim();
