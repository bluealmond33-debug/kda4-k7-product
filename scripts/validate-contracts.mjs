import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contracts = path.join(root, "database", "contracts");
const pairs = [
  ["mvp_call_response.schema.json", "examples/mvp_call_response.example.json"],
  ["consultation_card.schema.json", "examples/consultation_card.example.json"],
  [
    "consultation_card_response.schema.json",
    "examples/consultation_card_response.example.json",
  ],
  [
    "emotion_temperature_result.schema.json",
    "examples/emotion_temperature_result.example.json",
  ],
  ["error_response.schema.json", "examples/error_response.example.json"],
  ["masked_utterance.schema.json", "examples/masked_utterance.example.json"],
  [
    "model_consultation_result_input.schema.json",
    "examples/model_consultation_result_input.example.json",
  ],
  ["routing_candidate.schema.json", "examples/routing_candidate.example.json"],
  ["stt_utterance_input.schema.json", "examples/stt_utterance_input.example.json"],
];
const extraExamples = [
  [
    "model_consultation_result_input.schema.json",
    "examples/model_consultation_result_input_no_risk.example.json",
  ],
  [
    "model_consultation_result_input.schema.json",
    "examples/financial_model_result_input.example.json",
  ],
];

const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(contracts, relativePath), "utf8"));

for (const [schemaPath, examplePath] of pairs) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(readJson(schemaPath));
  const example = readJson(examplePath);
  if (!validate(example)) {
    throw new Error(`${examplePath} failed ${schemaPath}: ${ajv.errorsText(validate.errors)}`);
  }
}

for (const [schemaPath, examplePath] of extraExamples) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(readJson(schemaPath));
  const example = readJson(examplePath);
  if (!validate(example)) {
    throw new Error(`${examplePath} failed ${schemaPath}: ${ajv.errorsText(validate.errors)}`);
  }
}

const provisionalInputSchema = readJson("model_consultation_result_input.schema.json");
const provisionalInputExample = readJson(
  "examples/model_consultation_result_input.example.json"
);
const provisionalAjv = new Ajv2020({ allErrors: true, strict: false });
addFormats(provisionalAjv);
const validateProvisionalInput = provisionalAjv.compile(provisionalInputSchema);
const invalidProvisionalInputs = [
  { ...provisionalInputExample, summary: "" },
  { ...provisionalInputExample, incident_risk: "고위험", risk_reason: null },
  { ...provisionalInputExample, incident_risk: "긴급해보임", risk_reason: "추측" },
  { ...provisionalInputExample, routing_confidence: 1.1 },
  {
    summary: "불완전한 금융 모델 결과",
    task_category: "대출",
    consulting_situation: "만기 연장",
  },
];
for (const candidate of invalidProvisionalInputs) {
  if (validateProvisionalInput(candidate)) {
    throw new Error("invalid provisional model input accepted");
  }
}

const validLowRiskInput = {
  ...provisionalInputExample,
  incident_risk: "low",
  risk_reason: null,
};
if (!validateProvisionalInput(validLowRiskInput)) {
  throw new Error(
    `valid low-risk provisional input rejected: ${provisionalAjv.errorsText(
      validateProvisionalInput.errors
    )}`
  );
}

const emotionSchema = readJson("emotion_temperature_result.schema.json");
const emotionExample = readJson("examples/emotion_temperature_result.example.json");
const emotionAjv = new Ajv2020({ allErrors: true, strict: false });
addFormats(emotionAjv);
const validateEmotion = emotionAjv.compile(emotionSchema);

const invalidBoundaries = [
  [34, "stable"],
  [33, "caution"],
  [67, "caution"],
  [66, "elevated"],
  [-1, "stable"],
  [101, "elevated"],
];
for (const [score, level] of invalidBoundaries) {
  const candidate = {
    ...emotionExample,
    emotion_temperature_score: score,
    emotion_temperature_level: level,
  };
  if (validateEmotion(candidate)) {
    throw new Error(`invalid emotion boundary accepted: score=${score}, level=${level}`);
  }
}

console.log(
  `JSON_CONTRACTS_OK schemas=${pairs.length} examples=${pairs.length + extraExamples.length} invalid_boundaries_rejected=${invalidBoundaries.length} invalid_provisional_inputs_rejected=${invalidProvisionalInputs.length}`
);
