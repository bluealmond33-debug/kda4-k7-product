import demoResponse from "../../database/contracts/examples/mvp_call_response.example.json";
import {
  API_BASE_URL,
  DATA_API_PREFIX,
  useReal,
} from "./config";
import { parseConsultationCardResponse } from "./consultationContract";
import type { ConsultationCardResponse } from "./types";

async function responseError(response: Response, path: string): Promise<Error> {
  let detail = "";
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const payload = (await response.json()) as { detail?: unknown };
      if (typeof payload.detail === "string") detail = payload.detail;
    } catch {
      // Keep a stable user-facing fallback when an upstream emits malformed JSON.
    }
  }

  if (response.status === 504) {
    detail = "로컬 AI 분석 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.";
  }

  return new Error(
    detail || `상담 분석 요청에 실패했습니다. (${path}, HTTP ${response.status})`
  );
}

/** Fresh copy so UI state cannot mutate the shared contract fixture. */
export function getDemoConsultationCard(): ConsultationCardResponse {
  const card = parseConsultationCardResponse(structuredClone(demoResponse));
  // 데모 더미 감정값 — 감정 모델 연동 전까지 화면용. 연동 시 이 블록만 지우면 된다.
  // (contract example JSON은 백엔드 계약 원본이므로 건드리지 않는다)
  // 일반(normal) 콜 — 차분한 정보 문의. 당근식 온도로 36.5 기준 근처(안정/초록)에 앉는다.
  // (긴급=고조·이관=주의와 함께 세 밴드를 모두 보여준다)
  card.consultation_card.emotion = {
    status: "completed",
    score: 0,
    level: "stable",
    reason: "[SOURCE=STUB] 차분한 정보 문의 — 특이 감정 신호 없음",
  };
  return card;
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
    throw await responseError(response, path);
  }
  return parseConsultationCardResponse(await response.json());
}

/** Upload the customer's voice and receive the persisted mvp-1.1 card. */
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
    throw await responseError(response, path);
  }
  return parseConsultationCardResponse(await response.json());
}
