import type { EmotionScore } from "./types";
import { postJSON, useReal } from "./config";

const LABELS = ["안정", "보통", "상승", "격앙 주의"] as const;

/** Map a numeric level to the display label used across the UI. */
export function emotionLabel(level: 0 | 1 | 2 | 3): string {
  return LABELS[level];
}

const AGITATED = /(당황|급해|돌려|어떡|화가|왜|빨리|큰일|불안|어떻게)/;

/**
 * Score the customer's emotional temperature from a piece of transcript.
 *
 * mock: keyword heuristic (used in the demo).
 * real: POST /emotion  → { level, label, signals }  (e.g. an ML model).
 */
export async function scoreEmotion(text: string): Promise<EmotionScore> {
  if (useReal.emotion) {
    return postJSON<EmotionScore>("/emotion", { text });
  }
  const hits = (text.match(AGITATED) ?? []).length;
  const level = Math.min(3, Math.max(1, hits ? 2 + Math.min(1, hits - 1) : 1)) as 1 | 2 | 3;
  return {
    level,
    label: emotionLabel(level),
    signals: level >= 2 ? ["불안·다급 발화 감지"] : [],
  };
}
