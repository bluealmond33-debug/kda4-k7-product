import demoResponse from "../../database/contracts/examples/mvp_call_response.example.json";
import {
  API_BASE_URL,
  DATA_API_PREFIX,
  useReal,
} from "./config";
import { parseConsultationCardResponse } from "./consultationContract";
import type { ConsultationCardResponse } from "./types";

/** Fresh copy so UI state cannot mutate the shared contract fixture. */
export function getDemoConsultationCard(): ConsultationCardResponse {
  return parseConsultationCardResponse(structuredClone(demoResponse));
}

/**
 * Fetch a stored MVP consultation card from FastAPI.
 * The frontend never connects to PostgreSQL directly.
 */
export async function getConsultationCard(
  callId: string
): Promise<ConsultationCardResponse> {
  if (!useReal.data) return getDemoConsultationCard();
  const key = encodeURIComponent(callId);
  const path = `${DATA_API_PREFIX}/calls/${key}/consultation-card`;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${path} failed: ${response.status} ${detail}`.trim());
  }
  return parseConsultationCardResponse(await response.json());
}

/** Upload the customer's voice and receive the persisted mvp-1.0 card. */
export async function createConsultationFromAudio(
  audio: File
): Promise<ConsultationCardResponse> {
  if (!useReal.data) return getDemoConsultationCard();
  const body = new FormData();
  body.append("audio", audio, audio.name);
  const path = `${DATA_API_PREFIX}/calls`;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    body,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${path} failed: ${response.status} ${detail}`.trim());
  }
  return parseConsultationCardResponse(await response.json());
}
