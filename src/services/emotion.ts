import type { EmotionScore, EmotionTemperatureLevel } from "./types";

const LABELS = { stable: "안정", caution: "주의", elevated: "고조" } as const;

/** 감정 결과가 실제로 어디서 나왔는지. 백엔드가 emotion.reason 맨 앞에 [SOURCE=...]로 실어 보낸다. */
export type EmotionSource = "REAL_MODEL" | "RULE_FALLBACK" | "STUB" | "UNAVAILABLE";

/**
 * mvp-1.0 emotion.reason에서 [SOURCE=...] 접두사를 파싱한다.
 *
 * 백엔드(KARI-NA)는 계약(exactKeys)에 새 키를 못 넣는 대신, 자유 텍스트인 reason 맨 앞에
 * `[SOURCE=REAL_MODEL] ...` / `[SOURCE=STUB] ...` 형태로 출처를 실어 보낸다(박정운님 P0-3).
 * 접두사가 없으면(구버전 응답·mock) 안전하게 UNAVAILABLE로 본다.
 */
export function parseEmotionSource(reason: string | null): EmotionSource {
  const match = reason?.match(/^\[SOURCE=(REAL_MODEL|RULE_FALLBACK|STUB|UNAVAILABLE)\]/);
  return (match?.[1] as EmotionSource) ?? "UNAVAILABLE";
}

/** 화면 배지용 — 실제 모델이 아닌 결과는 "데모값"임을 상담사가 알 수 있어야 한다(P0-3). */
export function emotionSourceBadge(
  source: EmotionSource
): { label: string; isReal: boolean } {
  switch (source) {
    case "REAL_MODEL":
      return { label: "AI 모델", isReal: true };
    case "RULE_FALLBACK":
      return { label: "규칙 기반", isReal: false };
    default:
      return { label: "데모값", isReal: false };
  }
}

/** Map a numeric level to the display label used across the UI. */
export function emotionLabel(level: EmotionTemperatureLevel): "안정" | "주의" | "고조" {
  return LABELS[level];
}

const AGITATED = /(당황|급해|돌려|어떡|화가|왜|빨리|큰일|불안|어떻게)/;

/**
 * Score the customer's emotional temperature from a piece of transcript.
 *
 * mock: keyword heuristic (used in the demo).
 * This is demo-only. The active mvp-1.0 contract reports emotion as
 * unavailable until the team model is actually integrated.
 */
export async function scoreEmotion(text: string): Promise<EmotionScore> {
  const hits = (text.match(AGITATED) ?? []).length;
  const score = Math.min(100, hits ? 48 + hits * 13 : 24);
  const level: EmotionTemperatureLevel =
    score <= 33 ? "stable" : score <= 66 ? "caution" : "elevated";
  return {
    score,
    level,
    label_ko: emotionLabel(level),
    signals: level !== "stable" ? ["불안·다급 발화 감지"] : [],
  };
}
