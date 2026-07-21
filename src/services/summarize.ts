import { API_BASE_URL, useReal } from "./config";
import type { Transcript, CallSummary, EmotionTemperatureLevel, IncidentRisk } from "./types";
import { emotionLabel } from "./emotion";

/**
 * AI 사전요약 — 고객 발화(전사문)를 백엔드로 보내 실제 요약/부서/위험/감정을 받는다.
 *
 * useReal.data(= VITE_USE_REAL_DATA_API && API_BASE_URL)일 때 백엔드 `/summarize`(실 exaone)를
 * 호출하고, 실패/지연/미설정 시 아래 결정론적 mock으로 폴백한다(무대 안전장치).
 */

const MOCK: CallSummary = {
  type: "전자금융 › 착오송금",
  headline: "착오송금 반환 · 거래 확인 문의",
  bullets: [
    "오늘 오전 지인에게 30만원 이체 중 다른 계좌로 착오송금했다고 진술.",
    "거래 시각·수취 계좌 확인 및 반환 절차 안내 요청.",
    "보이스피싱 의심 정황 없음 · 단, 고객 불안·다급 발화 감지됨.",
  ],
  emotion: {
    score: 56,
    level: "caution",
    label_ko: emotionLabel("caution"),
    signals: ["불안·다급 발화 감지"],
  },
  incidentRisk: "watch",
  recommendedAgent: "숙련 상담사 우선",
};

// 백엔드 감정온도 level(정수 0~3) → 프론트 EmotionScore(level 문자열 + 대략 점수)
const LEVEL_MAP: EmotionTemperatureLevel[] = ["stable", "caution", "elevated", "elevated"];
const SCORE_MAP = [20, 52, 82, 92];

export async function summarize(transcript: Transcript): Promise<CallSummary> {
  if (!useReal.data) return MOCK;
  try {
    const res = await fetch(`${API_BASE_URL}/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript: { chunks: transcript.chunks, text: transcript.text },
      }),
    });
    if (!res.ok) throw new Error(`summarize failed: ${res.status}`);
    const d = await res.json();

    const lvlIdx: number = typeof d?.emotion?.level === "number" ? d.emotion.level : 1;
    const level = LEVEL_MAP[lvlIdx] ?? "caution";

    return {
      type: d?.type || MOCK.type,
      headline: d?.headline || MOCK.headline,
      bullets: Array.isArray(d?.bullets) && d.bullets.length ? d.bullets : MOCK.bullets,
      emotion: {
        score: SCORE_MAP[lvlIdx] ?? 52,
        level,
        label_ko: emotionLabel(level),
        signals: Array.isArray(d?.emotion?.signals) ? d.emotion.signals : [],
      },
      incidentRisk: (d?.incidentRisk || "watch") as IncidentRisk,
      recommendedAgent: d?.recommendedAgent || MOCK.recommendedAgent,
    };
  } catch {
    return MOCK; // 실분석 실패/지연 → 무대가 끊기지 않게 mock 폴백
  }
}
