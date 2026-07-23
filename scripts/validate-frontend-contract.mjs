import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseConsultationCardResponse } from "../src/services/consultationContract.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(
  fs.readFileSync(
    path.join(
      root,
      "database/contracts/examples/mvp_call_response.example.json"
    ),
    "utf8"
  )
);

const accepted = parseConsultationCardResponse(fixture);
if (accepted.schema_version !== "mvp-1.1" || accepted.source_channel !== "voice") {
  throw new Error("valid response did not survive frontend parsing");
}

const enriched = structuredClone(fixture);
enriched.consultation_card.attention_level = "medium";
enriched.consultation_card.reason_codes = ["TEXT_HIGH_RISK_SIGNAL"];
enriched.consultation_card.routing = {
  task_code: "G004",
  task_name: "기타·복합 일반 상담",
  classification: "GENERAL",
  handler: "HUMAN",
};
enriched.consultation_card.text_emotion = {
  content_emotion: "불안",
  situation_severity: "high",
  urgency_score: 95,
};
parseConsultationCardResponse(enriched);

const nullableReasonCodes = structuredClone(fixture);
nullableReasonCodes.consultation_card.reason_codes = null;
parseConsultationCardResponse(nullableReasonCodes);

const rejectedCases = [
  { ...fixture, schema_version: "mvp-2.0" },
  { ...fixture, source_channel: "text" },
  {
    ...fixture,
    consultation_card: {
      ...fixture.consultation_card,
      incident_risk: "high",
      risk_reason: null,
    },
  },
  {
    ...fixture,
    consultation_card: {
      ...fixture.consultation_card,
      emotion: {
        status: "unavailable",
        score: 70,
        level: "elevated",
        reason: null,
      },
    },
  },
  {
    ...fixture,
    consultation_card: {
      ...fixture.consultation_card,
      emotion: {
        status: "demo",
        score: 50,
        level: "caution",
        reason: "demo result must not cross the active API",
      },
    },
  },
  {
    ...fixture,
    consultation_card: {
      ...fixture.consultation_card,
      routing_confidence: true,
    },
  },
  {
    ...fixture,
    consultation_card: {
      ...fixture.consultation_card,
      attention_level: "high",
    },
  },
  {
    ...fixture,
    consultation_card: {
      ...fixture.consultation_card,
      routing: {
        task_code: "G004",
        task_name: "기타·복합 일반 상담",
        classification: "GENERAL",
        handler: "BOT",
      },
    },
  },
  {
    ...fixture,
    consultation_card: {
      ...fixture.consultation_card,
      text_emotion: {
        content_emotion: "불안",
        situation_severity: "high",
        urgency_score: true,
      },
    },
  },
  {
    ...fixture,
    consultation_card: Object.fromEntries(
      Object.entries(fixture.consultation_card).filter(
        ([key]) => key !== "attention_level"
      )
    ),
  },
  {
    ...fixture,
    consultation_card: {
      ...fixture.consultation_card,
      emotion: {
        status: "completed",
        score: 74,
        level: "stable",
        reason: "invalid score-level pair",
      },
    },
  },
  {
    ...fixture,
    extra_field: "contract drift",
  },
];

for (const candidate of rejectedCases) {
  let rejected = false;
  try {
    parseConsultationCardResponse(candidate);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("invalid frontend response was accepted");
}

console.log(
  `FRONTEND_CONTRACT_OK valid=3 invalid_rejected=${rejectedCases.length}`
);
