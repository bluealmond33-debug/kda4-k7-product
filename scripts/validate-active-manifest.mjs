import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));

const manifest = readJson("database/active-manifest.json");
if (manifest.status !== "active") throw new Error("active manifest status must be active");
if (manifest.contract_version !== "mvp-1.0") {
  throw new Error("active contract_version must be mvp-1.0");
}
if (manifest.source_channel !== "voice") {
  throw new Error("MVP source_channel must be voice");
}
if (manifest.masking_enabled !== false) {
  throw new Error("MVP masking_enabled must remain false");
}

const governedPaths = [
  manifest.database.schema,
  ...Object.values(manifest.contracts),
  manifest.backend.app,
  manifest.backend.pydantic_contracts,
  manifest.backend.model_adapter,
  manifest.backend.database_gateway,
  ...Object.values(manifest.frontend),
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
