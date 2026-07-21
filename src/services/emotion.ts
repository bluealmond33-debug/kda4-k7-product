import type { EmotionScore, EmotionTemperatureLevel } from "./types";

const LABELS = { stable: "안정", caution: "주의", elevated: "고조" } as const;

/** Map a numeric level to the display label used across the UI. */
export function emotionLabel(level: EmotionTemperatureLevel): "안정" | "주의" | "고조" {
  return LABELS[level];
}

const AGITATED = /(당황|급해|돌려|어떡|화가|왜|빨리|큰일|불안|어떻게)/;

/**
 * Score the customer's emotional temperature from a piece of transcript.
 *
 * mock: keyword heuristic (used in the demo).
 * This is demo-only. The active mvp-1.1 contract reports emotion as
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
