// Shared UI service types. Backend-facing data contracts live in
// database/contracts and use snake_case at the API boundary.

/** A single (partial or final) speech-to-text fragment. */
export interface TranscriptChunk {
  /** Recognised text for this fragment. */
  text: string;
  /** ms since the STT session started. */
  at: number;
  /** true once the recogniser considers the fragment final. */
  isFinal: boolean;
}

export type EmotionTemperatureLevel = "stable" | "caution" | "elevated";

/** Customer emotional temperature using the team-wide 0–100 / three-level scale. */
export interface EmotionScore {
  score: number;
  level: EmotionTemperatureLevel;
  label_ko: "안정" | "주의" | "고조";
  /** Short phrases explaining the score, e.g. ["불안·다급 발화 감지"]. */
  signals: string[];
}

export type IncidentRisk = "none" | "watch" | "high";

/** Demo-only summary projection used when the integrated card API is disabled. */
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

// ---------------------------------------------------------------------------
// Active MVP FastAPI ↔ PostgreSQL contract.
// Source of truth: database/contracts/mvp_call_response.schema.json

export type MvpCallStatus = "processing" | "ready" | "failed";
export type MvpIncidentRisk = "low" | "high";
export type MvpEmotionStatus = "unavailable" | "completed";

export interface MvpEmotionResult {
  status: MvpEmotionStatus;
  score: number | null;
  level: EmotionTemperatureLevel | null;
  reason: string | null;
}

export interface MvpConsultationCard {
  summary: string;
  business_type: string;
  department: string;
  routing_reason: string;
  incident_risk: MvpIncidentRisk;
  risk_reason: string | null;
  routing_confidence: number | null;
  emotion: MvpEmotionResult;
}

export interface ConsultationCardResponse {
  schema_version: "mvp-1.0";
  call_id: string;
  status: MvpCallStatus;
  source_channel: "voice";
  audio_filename: string;
  transcript: {
    text: string;
    stt_model: string;
    duration_sec: number;
  };
  consultation_card: MvpConsultationCard;
  created_at: string;
}
