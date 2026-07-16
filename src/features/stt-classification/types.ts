export type IncidentRisk = "low" | "high";

/**
 * Model-facing input contract.
 *
 * Source of truth:
 * database/contracts/model_consultation_result_input.schema.json
 *
 * Keep snake_case here because this object crosses the FastAPI boundary.
 * UI-only camelCase types must not be reused as an API contract.
 */
export interface SttClassificationResult {
  summary: string;
  business_type: string;
  department: string;
  routing_reason: string;
  incident_risk?: IncidentRisk;
  risk_reason?: string;
  routing_confidence?: number;
  model_name?: string;
  model_version?: string;
  generated_at?: string;
}

export interface SttClassificationRequest {
  text: string;
}
