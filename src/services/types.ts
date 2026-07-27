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
  /** Known endpoint role. Missing means legacy/customer input. */
  speaker?: "customer" | "agent";
  /** Server-wide transcript ordering key when available. */
  seq?: number;
  generation?: number;
  audioSeq?: number;
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
export type MvpAttentionLevel = "none" | "medium" | "high";

export interface MvpEmotionResult {
  status: MvpEmotionStatus;
  score: number | null;
  level: EmotionTemperatureLevel | null;
  reason: string | null;
}

export interface MvpChecklistItem {
  title: string;
  detail: string;
  source: "model" | "policy" | "rag";
}

export interface MvpKnowledgeReference {
  doc_id: string;
  title: string;
  section: string;
  excerpt: string;
  source: string;
  score: number;
}

export interface MvpRoutingResult {
  task_code: string;
  task_name: string;
  classification: "EMERGENCY" | "SIMPLE" | "GENERAL";
  handler: "HUMAN" | "AI";
  // 본인인증 정책(형진님 KARI-NA 본인확인 적용 정책, IDENTITY_AUTH_POLICY.md).
  // 구버전 백엔드는 안 보낼 수 있어 옵셔널.
  authPolicy?: "NOT_REQUIRED" | "REQUIRED" | "EXEMPT";
}

export interface MvpTextEmotionResult {
  content_emotion: string;
  situation_severity: "low" | "medium" | "high";
  urgency_score: number;
}

export interface MvpConsultationCard {
  summary: string;
  business_type: string;
  department: string;
  routing_reason: string;
  incident_risk: MvpIncidentRisk;
  risk_reason: string | null;
  routing_confidence: number | null;
  customer_requests: string[];
  missing_information: string[];
  required_actions: MvpChecklistItem[];
  knowledge_references: MvpKnowledgeReference[];
  emotion: MvpEmotionResult;
  attention_level: MvpAttentionLevel;
  reason_codes: string[] | null;
  routing: MvpRoutingResult | null;
  text_emotion: MvpTextEmotionResult | null;
}

export interface ConsultationCardResponse {
  schema_version: "mvp-1.1";
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
