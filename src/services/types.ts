// Shared types for the AI service layer (STT · summary · emotion).
// These are the contract between the frontend and the future backend.

/** A single (partial or final) speech-to-text fragment. */
export interface TranscriptChunk {
  /** Recognised text for this fragment. */
  text: string;
  /** ms since the STT session started. */
  at: number;
  /** true once the recogniser considers the fragment final. */
  isFinal: boolean;
}

/** Customer emotional "temperature" — how agitated the caller sounds. */
export interface EmotionScore {
  /** 0 calm · 1 normal · 2 elevated · 3 agitated. */
  level: 0 | 1 | 2 | 3;
  /** Korean label shown in the UI, e.g. "격앙 주의". */
  label: string;
  /** Short phrases explaining the score, e.g. ["불안·다급 발화 감지"]. */
  signals: string[];
}

export type IncidentRisk = "none" | "watch" | "high";

/** The AI pre-summary produced from the caller's natural-language intake. */
export interface CallSummary {
  /** 업무 유형 — extracted task type, e.g. "전자금융 › 착오송금". */
  type: string;
  /** One-line headline shown on the prep card. */
  headline: string;
  /** 2–4 bullet points summarising what the customer said. */
  bullets: string[];
  /** Emotion temperature at summary time. */
  emotion: EmotionScore;
  /** Fraud / incident signal. */
  incidentRisk: IncidentRisk;
  /** AI routing recommendation, e.g. "숙련 상담사 우선". */
  recommendedAgent: string;
}

/** Full transcript passed to the summariser. */
export interface Transcript {
  chunks: TranscriptChunk[];
  /** Convenience: the concatenated final text. */
  text: string;
}
