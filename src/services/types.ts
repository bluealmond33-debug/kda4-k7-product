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

// ---------------------------------------------------------------------------
// FastAPI ↔ PostgreSQL integrated consultation contract (schema_version 1.0)
// Source of truth: database/contracts/consultation_card_response.schema.json

export type SessionStatus =
  | "waiting"
  | "analyzing"
  | "ready"
  | "in_progress"
  | "summarizing"
  | "wrap_up"
  | "completed"
  | "cancelled";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type AnalysisStatus = "completed" | "pending" | "unavailable" | "failed";

export interface MaskedCustomer {
  customer_number: string;
  full_name_masked: string;
  phone_masked: string;
  account_number_masked: string | null;
}

export interface CustomerCaution {
  caution_type:
    | "fraud_suspected"
    | "identity_verification_required"
    | "vulnerable_customer"
    | "repeated_complaint"
    | "legal_dispute"
    | "transaction_restriction"
    | "other";
  reason: string;
  severity: RiskLevel;
  registered_at: string;
  expires_at: string | null;
}

export interface EmotionTemperature {
  status: AnalysisStatus;
  score: number | null;
  level: EmotionTemperatureLevel | null;
  label_ko: "안정" | "주의" | "고조" | null;
  audio_quality:
    | "normal"
    | "low_volume"
    | "noisy"
    | "too_short"
    | "unavailable"
    | null;
  failure_code: string | null;
  signals: string[];
}

export interface IntegratedConsultationCard {
  schema_version: string;
  inquiry_type: string;
  summary: string;
  customer_request: string | null;
  keywords: string[];
  risk_factors: string[];
  urgency_level: RiskLevel;
  risk_level: RiskLevel;
  related_manual_refs: string[];
  suggested_opening: string | null;
  recommended_actions: string[];
  confirmation_items: string[];
  confirmation_status: "pending" | "confirmed" | "correction_requested";
}

export interface RoutingResult {
  department_code: string;
  department_name: string;
  counselor_code: string | null;
  counselor_name: string | null;
  recommendation_rank: number;
  confidence: number;
  rationale: string;
  selected: boolean;
}

export interface RecentConsultation {
  inquiry_type: string;
  ai_summary: string;
  resolution_result: string;
  department_name: string;
  risk_level: RiskLevel;
  consulted_at: string;
}

export interface MaskedUtterance {
  sequence_no: number;
  speaker_type: "customer" | "system" | "counselor";
  masked_transcript: string;
  spoken_at: string;
}

export interface ConsultationCardResponse {
  schema_version: "1.0";
  data: {
    external_session_key: string;
    session_status: SessionStatus;
    customer: MaskedCustomer;
    customer_cautions: CustomerCaution[];
    emotion_temperature: EmotionTemperature;
    consultation_card: IntegratedConsultationCard | null;
    routing_result: RoutingResult | null;
    recent_consultations: RecentConsultation[];
    masked_utterances: MaskedUtterance[];
  };
}
