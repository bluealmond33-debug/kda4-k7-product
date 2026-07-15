import type { Transcript, CallSummary } from "./types";
import { postJSON, useReal } from "./config";
import { emotionLabel } from "./emotion";

/**
 * Produce the AI pre-summary from the caller's natural-language intake.
 *
 * mock: returns the scripted 착오송금 summary used in the demo.
 * real: POST /summarize  → CallSummary  (RAG + LLM over the transcript).
 */
export async function summarize(transcript: Transcript): Promise<CallSummary> {
  if (useReal.summary) {
    return postJSON<CallSummary>("/summarize", { transcript });
  }
  // Deterministic mock for the demo.
  return {
    type: "전자금융 › 착오송금",
    headline: "착오송금 반환 · 거래 확인 문의",
    bullets: [
      "오늘 오전 지인에게 30만원 이체 중 다른 계좌로 착오송금했다고 진술.",
      "거래 시각·수취 계좌 확인 및 반환 절차 안내 요청.",
      "보이스피싱 의심 정황 없음 · 단, 고객 불안·다급 발화 감지됨.",
    ],
    emotion: { level: 2, label: emotionLabel(2), signals: ["불안·다급 발화 감지"] },
    incidentRisk: "watch",
    recommendedAgent: "숙련 상담사 우선",
  };
}
