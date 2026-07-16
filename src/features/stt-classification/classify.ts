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
  if (!result.summary || !result.businessType || !result.department) {
    throw new Error("Invalid classification response");
  }
  if (result.incidentRisk !== "low" && result.incidentRisk !== "high") {
    throw new Error("incidentRisk must be low or high");
  }
  if (!Array.isArray(result.riskReasons) || result.riskReasons.length === 0) {
    throw new Error("riskReasons must contain at least one reason");
  }
  if (result.confidence < 0 || result.confidence > 1) {
    throw new Error("confidence must be between 0 and 1");
  }
}

export type { SttClassificationRequest, SttClassificationResult } from "./types";
