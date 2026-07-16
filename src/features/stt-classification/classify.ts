import type { SttClassificationRequest, SttClassificationResult } from "./types";

export type ClassificationTransport = (
  request: SttClassificationRequest,
) => Promise<SttClassificationResult>;

/**
 * STT 분류 기능의 연결 지점.
 * 실제 HTTP/OpenAI 호출은 사용하는 프로젝트에서 transport로 주입한다.
 */
export async function classifySttText(
  text: string,
  transport: ClassificationTransport,
): Promise<SttClassificationResult> {
  const normalizedText = text.trim();

  if (!normalizedText) {
    throw new Error("STT text is required");
  }

  const result = await transport({ text: normalizedText });
  validateResult(result);
  return result;
}

function validateResult(result: SttClassificationResult): void {
  if (
    !result.summary?.trim() ||
    !result.business_type?.trim() ||
    !result.department?.trim() ||
    !result.routing_reason?.trim()
  ) {
    throw new Error("Invalid classification response");
  }
  if (
    result.incident_risk !== undefined &&
    result.incident_risk !== "low" &&
    result.incident_risk !== "high"
  ) {
    throw new Error("incident_risk must be low or high");
  }
  if (result.incident_risk && !result.risk_reason?.trim()) {
    throw new Error("risk_reason is required when incident_risk is provided");
  }
  if (
    result.routing_confidence !== undefined &&
    (result.routing_confidence < 0 || result.routing_confidence > 1)
  ) {
    throw new Error("routing_confidence must be between 0 and 1");
  }
}

export type { SttClassificationRequest, SttClassificationResult } from "./types";
