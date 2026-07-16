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
if (accepted.schema_version !== "mvp-1.0" || accepted.source_channel !== "voice") {
  throw new Error("valid response did not survive frontend parsing");
}

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
      routing_confidence: true,
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
  `FRONTEND_CONTRACT_OK valid=1 invalid_rejected=${rejectedCases.length}`
);
