import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));

const manifest = readJson("database/active-manifest.json");
if (manifest.status !== "active") throw new Error("active manifest status must be active");
if (manifest.contract_version !== "mvp-1.1") {
  throw new Error("active contract_version must be mvp-1.1");
}
if (manifest.source_channel !== "voice") {
  throw new Error("MVP source_channel must be voice");
}
if (manifest.masking_enabled !== false) {
  throw new Error("MVP masking_enabled must remain false");
}
if (
  manifest.audio_processing?.mode !== "whole_file_batch" ||
  manifest.audio_processing?.streaming !== false ||
  manifest.audio_processing?.telephony_connected !== false
) {
  throw new Error("MVP audio processing must remain non-streaming whole-file batch");
}
if (
  manifest.audio_processing?.stt_input !== "audio" ||
  manifest.audio_processing?.summary_input !== "stt_text" ||
  manifest.audio_processing?.stt_processor !== "provider_configured" ||
  manifest.audio_processing?.summary_processor !== "provider_configured" ||
  manifest.audio_processing?.emotion_input !== "same_audio_file_only"
) {
  throw new Error(
    "text analysis must use STT text and emotion must use the same audio file"
  );
}
if (
  manifest.audio_processing?.capture_output !== "audio_file" ||
  manifest.audio_processing?.audio_retention !==
    "transient_request_processing" ||
  manifest.audio_processing?.audio_object_storage !== "not_in_mvp" ||
  manifest.audio_processing?.branching !== "after_audio_capture" ||
  manifest.audio_processing?.correlation_key !== "call_id" ||
  manifest.audio_processing?.call_id_created !== "before_analysis" ||
  manifest.audio_processing?.parallel_execution_allowed !== true ||
  manifest.audio_processing?.join_before_persist !== true
) {
  throw new Error("dual audio/text branches must join by a pre-created call_id");
}
if (
  JSON.stringify(manifest.audio_processing?.branches?.text_analysis) !==
    JSON.stringify(["stt_provider", "analysis_provider"]) ||
  JSON.stringify(manifest.audio_processing?.branches?.audio_emotion) !==
    JSON.stringify(["audio_emotion_model"])
) {
  throw new Error("active text and audio model branches have drifted");
}
if (
  manifest.audio_processing?.providers?.cloud?.stt !== "openai" ||
  manifest.audio_processing?.providers?.cloud?.analysis !== "openai" ||
  manifest.audio_processing?.providers?.local?.stt !== "faster_whisper" ||
  manifest.audio_processing?.providers?.local?.analysis !== "ollama"
) {
  throw new Error("active cloud/local provider matrix has drifted");
}
if (
  JSON.stringify(
    manifest.audio_processing?.emotion_result_policy?.allowed_statuses
  ) !== JSON.stringify(["unavailable", "completed"]) ||
  manifest.audio_processing?.emotion_result_policy?.demo_forbidden !== true
) {
  throw new Error("active consultation cards must reject demo emotion results");
}
if (
  manifest.adapter?.implementation !== manifest.backend.model_adapter ||
  manifest.adapter?.kind !== "deterministic_code" ||
  manifest.adapter?.uses_ai !== false
) {
  throw new Error("active model adapter must remain deterministic non-AI code");
}
if (
  manifest.release_validation?.requires_real_audio !== true ||
  manifest.release_validation?.database_row_policy !==
    "restore_pre_smoke_counts"
) {
  throw new Error(
    "final release validation must use real audio and restore pre-smoke DB counts"
  );
}

const governedPaths = [
  manifest.database.schema,
  ...Object.values(manifest.database.optional_extensions ?? {}).map(
    (extension) => extension.schema
  ),
  ...Object.values(manifest.contracts),
  manifest.backend.app,
  manifest.backend.pydantic_contracts,
  manifest.backend.model_adapter,
  manifest.backend.audio_emotion_adapter,
  manifest.backend.integration_service,
  manifest.backend.database_gateway,
  ...Object.values(manifest.frontend),
  manifest.release_validation.gate,
  manifest.release_validation.database_verifier,
  manifest.release_validation.test_call_cleanup,
  ...Object.values(manifest.handoffs),
];
for (const relativePath of governedPaths) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    throw new Error(`active manifest path does not exist: ${relativePath}`);
  }
}

const schemaSql = fs.readFileSync(path.join(root, manifest.database.schema), "utf8");
const actualTables = [...schemaSql.matchAll(/^CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/gm)]
  .map((match) => match[1])
  .sort();
const expectedTables = [...manifest.database.tables].sort();
if (JSON.stringify(actualTables) !== JSON.stringify(expectedTables)) {
  throw new Error(
    `active table drift: expected=${expectedTables.join(",")} actual=${actualTables.join(",")}`
  );
}

for (const [extensionName, extension] of Object.entries(
  manifest.database.optional_extensions ?? {}
)) {
  if (extension.required !== false) {
    throw new Error(`optional database extension must not be required: ${extensionName}`);
  }
  const extensionSql = fs.readFileSync(path.join(root, extension.schema), "utf8");
  const extensionTables = [
    ...extensionSql.matchAll(/^CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/gm),
  ]
    .map((match) => match[1])
    .sort();
  const expectedExtensionTables = [...extension.tables].sort();
  if (
    JSON.stringify(extensionTables) !== JSON.stringify(expectedExtensionTables)
  ) {
    throw new Error(
      `optional table drift (${extensionName}): ` +
        `expected=${expectedExtensionTables.join(",")} ` +
        `actual=${extensionTables.join(",")}`
    );
  }
}

const responseSchema = readJson(manifest.contracts.api_response);
if (responseSchema.properties?.schema_version?.const !== manifest.contract_version) {
  throw new Error("response schema_version does not match active manifest");
}
if (responseSchema.properties?.source_channel?.const !== manifest.source_channel) {
  throw new Error("response source_channel does not match active manifest");
}

const example = readJson(manifest.contracts.example);
if (example.schema_version !== manifest.contract_version) {
  throw new Error("example schema_version does not match active manifest");
}
if (example.source_channel !== manifest.source_channel) {
  throw new Error("example source_channel does not match active manifest");
}

console.log(
  `ACTIVE_MANIFEST_OK version=${manifest.contract_version} tables=${expectedTables.length} governed_paths=${governedPaths.length}`
);
