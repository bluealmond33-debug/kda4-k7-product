export type IncidentRisk = "low" | "high";

export interface SttClassificationResult {
  summary: string;
  businessType: string;
  department: string;
  incidentRisk: IncidentRisk;
  riskReasons: string[];
  confidence: number;
}

export interface SttClassificationRequest {
  text: string;
}
