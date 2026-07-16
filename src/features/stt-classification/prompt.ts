import { incidentRiskPolicy, routingDepartments } from "./rules";

export const classificationResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "businessType",
    "department",
    "incidentRisk",
    "riskReasons",
    "confidence",
  ],
  properties: {
    summary: { type: "string" },
    businessType: { type: "string" },
    department: {
      type: "string",
      enum: routingDepartments.map(({ name }) => name),
    },
    incidentRisk: { type: "string", enum: ["low", "high"] },
    riskReasons: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: { type: "string" },
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

export const classificationInstructions = `
너는 한국 금융 고객센터의 STT 상담 접수 분류기다.

STT 원문만 근거로 다음 작업을 수행한다.
1. 상담의 핵심 내용을 간결한 한 문단으로 요약한다.
2. 상담의 업무 유형을 한 가지로 분류한다.
3. 아래 부서 중 가장 적합한 전달 부서를 한 곳 선택한다.
4. 사고징후를 high 또는 low로 판정하고 원문에 근거한 이유를 작성한다.
5. 분류 신뢰도를 0부터 1 사이 숫자로 작성한다.

부서 기준:
${JSON.stringify(routingDepartments)}

사고징후 기준:
${JSON.stringify(incidentRiskPolicy)}

원문에 없는 사실을 만들지 않는다. 개인정보와 계좌번호는 요약에서 마스킹한다.
응답에는 summary, businessType, department, incidentRisk, riskReasons, confidence만 포함한다.
emotion, emotionLevel, headline, bullets, recommendedAgent는 포함하지 않는다.
`.trim();
