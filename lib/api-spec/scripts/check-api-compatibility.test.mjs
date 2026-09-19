import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const checkerPath = path.join(scriptsDirectory, "check-api-compatibility.mjs");
const fixturesDirectory = path.join(scriptsDirectory, "fixtures", "api-compatibility");

test("rejects removed response fields with operation and schema context", () => {
  const result = runChecker("removed-response-field.yaml");

  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /GET \/inspections\/\{inspectionId\} \(getInspection\)/);
  assert.match(
    result.output,
    /GET \/inspections\/\{inspectionId\} \(getInspection\) response 200 application\/json schema InspectionResponse: removed response field "summary"/,
  );
});

test("rejects narrowed enums with operation and schema context", () => {
  const result = runChecker("narrowed-enum.yaml");

  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /GET \/inspections\/\{inspectionId\} \(getInspection\)/);
  assert.match(
    result.output,
    /GET \/inspections\/\{inspectionId\} \(getInspection\) response 200 application\/json schema InspectionResponse\.status schema InspectionStatus: enum was narrowed; removed value\(s\) \["archived"\]/,
  );
});

test("rejects newly required request properties with operation and schema context", () => {
  const result = runChecker("required-request-property.yaml");

  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /POST \/inspections \(createInspection\)/);
  assert.match(
    result.output,
    /POST \/inspections \(createInspection\) request body application\/json schema CreateInspection: required property "address" was added/,
  );
});

test("allows additive optional properties", () => {
  const result = runChecker("additive-properties.yaml");

  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /OpenAPI compatibility check passed against/);
});

test("allows documentation-only metadata changes", () => {
  const result = runChecker("documentation-only.yaml");

  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /OpenAPI compatibility check passed against/);
});

const nestedContexts = [
  "findings items schema Finding",
  "combined allOf[1]",
  "choice oneOf[1]",
  "alternative anyOf[1]",
];
const nestedOperation =
  "GET /inspections/{inspectionId} (getInspection) response 200 application/json schema InspectionResponse";

test("rejects removed fields inside array items and every composed schema with nested context", () => {
  const result = runChecker("nested-removed-response-fields.yaml", "nested-baseline.yaml");

  assert.equal(result.status, 1, result.output);
  for (const context of nestedContexts) {
    assert.ok(
      result.output.includes(`${nestedOperation}.${context}: removed response field "summary"`),
      `Missing removal diagnostic for ${context}:\n${result.output}`,
    );
  }
});

test("rejects narrowed enums inside array items and every composed schema with nested context", () => {
  const result = runChecker("nested-narrowed-enums.yaml", "nested-baseline.yaml");

  assert.equal(result.status, 1, result.output);
  for (const context of nestedContexts) {
    assert.ok(
      result.output.includes(
        `${nestedOperation}.${context}.status: enum was narrowed; removed value(s) ["archived"]`,
      ),
      `Missing narrowing diagnostic for ${context}:\n${result.output}`,
    );
  }
});

test("allows unchanged array items and composed schemas", () => {
  const result = runChecker("nested-baseline.yaml", "nested-baseline.yaml");

  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /OpenAPI compatibility check passed against/);
});

function runChecker(currentFileName, baselineFileName = "baseline.yaml") {
  const baselinePath = path.join(fixturesDirectory, baselineFileName);
  const currentPath = path.join(fixturesDirectory, currentFileName);
  const result = spawnSync(
    process.execPath,
    [checkerPath, "--baseline-file", baselinePath, "--current-file", currentPath],
    {
      cwd: path.resolve(scriptsDirectory, "..", "..", ".."),
      encoding: "utf8",
    },
  );

  return {
    ...result,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}