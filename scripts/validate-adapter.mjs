import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adapter = path.join(root, "database", "adapters", "model_result_adapter.py");
const examples = path.join(root, "database", "contracts", "examples");
const contracts = path.join(root, "database", "contracts");

const candidates =
  process.platform === "win32"
    ? [
        ["py", ["-3.12"]],
        ["py", ["-3.13"]],
        ["py", ["-3.11"]],
        ["py", ["-3.10"]],
        ["py", ["-3"]],
        ["python", []],
      ]
    : [
        ["python3", []],
        ["python", []],
      ];

let python = null;
for (const [command, prefix] of candidates) {
  const probe = spawnSync(
    command,
    [...prefix, "-c", "import encodings, json; print('K7_PYTHON_OK')"],
    {
    cwd: root,
    encoding: "utf8",
    }
  );
  if (probe.status === 0) {
    python = { command, prefix };
    break;
  }
}
if (!python) {
  throw new Error("Python 3 was not found. Install Python 3 or use the documented CLI manually.");
}

const env = {
  ...process.env,
  PYTHONDONTWRITEBYTECODE: "1",
  PYTHONIOENCODING: "utf-8",
};

function runPython(args, label) {
  const result = spawnSync(python.command, [...python.prefix, ...args], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      label + " failed\nstdout:\n" + result.stdout + "\nstderr:\n" + result.stderr
    );
  }
  return result.stdout;
}

runPython(
  ["-m", "unittest", "discover", "database/adapters/tests", "-v"],
  "adapter unit tests"
);

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const cardSchema = JSON.parse(
  fs.readFileSync(path.join(contracts, "consultation_card.schema.json"), "utf8")
);
const routingSchema = JSON.parse(
  fs.readFileSync(path.join(contracts, "routing_candidate.schema.json"), "utf8")
);
const validateCard = ajv.compile(cardSchema);
const validateRouting = ajv.compile(routingSchema);

const cases = [
  "model_consultation_result_input.example.json",
  "model_consultation_result_input_no_risk.example.json",
];
for (const [index, example] of cases.entries()) {
  const raw = runPython(
    [
      adapter,
      "--input",
      path.join(examples, example),
      "--session-key",
      "K7-ADAPTER-VERIFY-" + String(index + 1).padStart(4, "0"),
      "--generated-at",
      "2026-07-16T00:00:00Z",
    ],
    example
  );
  const normalized = JSON.parse(raw);
  if (normalized.status !== "ready") {
    throw new Error(example + " did not produce ready output");
  }
  if (!validateCard(normalized.consultation_card)) {
    throw new Error(example + " card invalid: " + ajv.errorsText(validateCard.errors));
  }
  if (!validateRouting(normalized.routing_candidate)) {
    throw new Error(
      example + " routing invalid: " + ajv.errorsText(validateRouting.errors)
    );
  }
}

console.log(
  "MODEL_ADAPTER_OK unit_tests=8 ready_cases=2 canonical_outputs_validated=4"
);
