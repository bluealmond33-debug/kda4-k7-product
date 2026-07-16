import demoResponse from "../../database/contracts/examples/consultation_card_response.example.json";
import {
  DATA_ACCESS_PURPOSE,
  DATA_API_PREFIX,
  getJSON,
  useReal,
} from "./config";
import type { ConsultationCardResponse } from "./types";

export const DEFAULT_EXTERNAL_SESSION_KEY =
  import.meta.env.VITE_DEMO_SESSION_KEY ?? "K7-DEMO-20260715-0001";

/** Fresh copy so UI state cannot mutate the shared contract fixture. */
export function getDemoConsultationCard(): ConsultationCardResponse {
  return structuredClone(demoResponse) as unknown as ConsultationCardResponse;
}

/**
 * Fetch the masked, integrated counselor-card response from FastAPI.
 * The frontend never connects to PostgreSQL directly.
 */
export async function getConsultationCard(
  externalSessionKey = DEFAULT_EXTERNAL_SESSION_KEY
): Promise<ConsultationCardResponse> {
  if (!useReal.data) return getDemoConsultationCard();

  const key = encodeURIComponent(externalSessionKey);
  return getJSON<ConsultationCardResponse>(
    `${DATA_API_PREFIX}/consultation-sessions/${key}/consultation-card`,
    { "X-Access-Purpose": DATA_ACCESS_PURPOSE }
  );
}
