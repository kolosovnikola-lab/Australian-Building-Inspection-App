import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(packageDirectory, "..", "..", "..");
const defaultSpecPath = path.join(rootDirectory, "lib", "api-spec", "openapi.yaml");
const specGitPath = "lib/api-spec/openapi.yaml";
const httpMethods = new Set(["get", "put", "post", "patch", "delete", "options", "head", "trace"]);

const options = parseOptions(process.argv.slice(2));
const currentPath = options.currentFile ?? defaultSpecPath;
const currentDocument = readDocument(currentPath);
const baseline = loadBaseline(options);

if (!baseline) {
  console.log("OpenAPI compatibility check skipped: no previous API specification is available.");
  process.exit(0);
}

const previousDocument = YAML.parse(baseline.contents);
const issues = [];
const issueKeys = new Set();

compareOperations(previousDocument, currentDocument, issues, issueKeys);
compareUnreferencedSchemas(previousDocument, currentDocument, issues, issueKeys);

if (issues.length > 0) {
  console.error(
    "OpenAPI compatibility check failed. Breaking changes must be reviewed before code generation.",
  );
  console.error("See lib/api-spec/README.md#review-path-for-an-intentional-breaking-change.");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log(`OpenAPI compatibility check passed against ${baseline.label}.`);

function parseOptions(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--baseline-file" || argument === "--current-file") {
      const value = args[index + 1];
      if (!value) {
        throw new Error(`${argument} requires a file path`);
      }
      const optionName = argument === "--baseline-file" ? "baselineFile" : "currentFile";
      parsed[optionName] = path.resolve(process.cwd(), value);
      index += 1;
    } else if (argument === "--baseline") {
      parsed.baselineRef = args[index + 1];
      if (!parsed.baselineRef) {
        throw new Error("--baseline requires a git ref");
      }
      index += 1;
    }
  }
  return parsed;
}

function readDocument(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`OpenAPI specification not found: ${filePath}`);
  }
  return YAML.parse(readFileSync(filePath, "utf8"));
}

function loadBaseline(parsedOptions) {
  const baselineFile = parsedOptions.baselineFile ?? process.env.OPENAPI_COMPATIBILITY_BASELINE_FILE;
  if (baselineFile) {
    return {
      contents: readFileSync(baselineFile, "utf8"),
      label: baselineFile,
    };
  }

  const explicitRef = parsedOptions.baselineRef ?? process.env.OPENAPI_COMPATIBILITY_BASELINE;
  const baselineRef = explicitRef ?? getDefaultBaselineRef();
  if (!baselineRef) {
    return null;
  }

  try {
    return {
      contents: execFileSync("git", ["show", `${baselineRef}:${specGitPath}`], {
        cwd: rootDirectory,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
      label: `${baselineRef}:${specGitPath}`,
    };
  } catch (error) {
    if (explicitRef) {
      throw new Error(`Could not read OpenAPI compatibility baseline ${baselineRef}: ${error.message}`);
    }
    return null;
  }
}

function getDefaultBaselineRef() {
  if (hasWorkingTreeChanges()) {
    return "HEAD";
  }

  try {
    return execFileSync("git", ["rev-parse", "HEAD^"], {
      cwd: rootDirectory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function hasWorkingTreeChanges() {
  return !isGitDiffClean(["diff"]) || !isGitDiffClean(["diff", "--cached"]);
}

function isGitDiffClean(args) {
  try {
    execFileSync("git", [...args, "--quiet", "--", specGitPath], {
      cwd: rootDirectory,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function compareOperations(previousDocument, currentDocument, issues, issueKeys) {
  const previousPaths = previousDocument.paths ?? {};
  const currentPaths = currentDocument.paths ?? {};

  for (const [route, previousPathItem] of Object.entries(previousPaths)) {
    const currentPathItem = currentPaths[route];
    if (!currentPathItem) {
      addIssue(issues, issueKeys, `${route}: the path was removed`);
      continue;
    }

    for (const method of httpMethods) {
      const previousOperation = previousPathItem?.[method];
      if (!previousOperation) {
        continue;
      }

      const currentOperation = currentPathItem?.[method];
      const operationLabel = formatOperationLabel(method, route, previousOperation);
      if (!currentOperation) {
        addIssue(issues, issueKeys, `${operationLabel}: the operation was removed`);
        continue;
      }

      compareRequestBody(
        previousOperation,
        currentOperation,
        operationLabel,
        previousDocument,
        currentDocument,
        issues,
        issueKeys,
      );
      compareResponses(
        previousOperation,
        currentOperation,
        operationLabel,
        previousDocument,
        currentDocument,
        issues,
        issueKeys,
      );
      compareParameters(
        previousOperation,
        currentOperation,
        operationLabel,
        previousDocument,
        currentDocument,
        issues,
        issueKeys,
      );
    }
  }
}

function compareRequestBody(
  previousOperation,
  currentOperation,
  operationLabel,
  previousDocument,
  currentDocument,
  issues,
  issueKeys,
) {
  const previousRequestBody = resolveReference(previousOperation.requestBody, previousDocument);
  const currentRequestBody = resolveReference(currentOperation.requestBody, currentDocument);
  if (!previousRequestBody || !currentRequestBody) {
    if (previousRequestBody?.content && !currentRequestBody) {
      addIssue(issues, issueKeys, `${operationLabel} request body: the request body was removed`);
    }
    return;
  }

  if (previousRequestBody.required === true && currentRequestBody.required !== true) {
    // Making a request body optional is additive and does not break existing callers.
  }

  compareContentSchemas(
    previousRequestBody.content,
    currentRequestBody.content,
    `${operationLabel} request body`,
    "request",
    previousDocument,
    currentDocument,
    issues,
    issueKeys,
  );
}

function compareResponses(
  previousOperation,
  currentOperation,
  operationLabel,
  previousDocument,
  currentDocument,
  issues,
  issueKeys,
) {
  const previousResponses = resolveReference(previousOperation.responses, previousDocument) ?? {};
  const currentResponses = resolveReference(currentOperation.responses, currentDocument) ?? {};

  for (const [status, previousResponseValue] of Object.entries(previousResponses)) {
    const previousResponse = resolveReference(previousResponseValue, previousDocument);
    const currentResponse = resolveReference(currentResponses[status], currentDocument);
    const responseLabel = `${operationLabel} response ${status}`;

    if (!currentResponse) {
      addIssue(issues, issueKeys, `${responseLabel}: the response was removed`);
      continue;
    }

    compareContentSchemas(
      previousResponse?.content,
      currentResponse.content,
      responseLabel,
      "response",
      previousDocument,
      currentDocument,
      issues,
      issueKeys,
    );
  }
}

function compareParameters(
  previousOperation,
  currentOperation,
  operationLabel,
  previousDocument,
  currentDocument,
  issues,
  issueKeys,
) {
  const previousParameters = collectParameters(previousOperation, previousDocument);
  const currentParameters = collectParameters(currentOperation, currentDocument);

  for (const [parameterKey, previousParameter] of previousParameters) {
    const currentParameter = currentParameters.get(parameterKey);
    if (!currentParameter) {
      addIssue(issues, issueKeys, `${operationLabel} parameter ${parameterKey}: the parameter was removed`);
      continue;
    }

    if (previousParameter.required !== true && currentParameter.required === true) {
      addIssue(
        issues,
        issueKeys,
        `${operationLabel} parameter ${parameterKey}: an optional parameter became required`,
      );
    }

    compareSchemaPair(
      previousParameter.schema,
      currentParameter.schema,
      `${operationLabel} parameter ${parameterKey}`,
      "request",
      previousDocument,
      currentDocument,
      issues,
      issueKeys,
    );
  }
}

function collectParameters(operation, document) {
  const result = new Map();
  for (const parameterValue of operation.parameters ?? []) {
    const parameter = resolveReference(parameterValue, document);
    if (parameter?.name && parameter.in) {
      result.set(`${parameter.in}=${parameter.name}`, parameter);
    }
  }
  return result;
}

function compareContentSchemas(
  previousContent,
  currentContent,
  context,
  direction,
  previousDocument,
  currentDocument,
  issues,
  issueKeys,
) {
  for (const [mediaType, previousMediaType] of Object.entries(previousContent ?? {})) {
    const currentMediaType = currentContent?.[mediaType];
    const previousSchema = previousMediaType?.schema;
    const currentSchema = currentMediaType?.schema;
    if (previousSchema && !currentSchema) {
      addIssue(issues, issueKeys, `${context} ${mediaType}: the response/request schema was removed`);
      continue;
    }
    if (previousSchema && currentSchema) {
      compareSchemaPair(
        previousSchema,
        currentSchema,
        `${context} ${mediaType}`,
        direction,
        previousDocument,
        currentDocument,
        issues,
        issueKeys,
      );
    }
  }
}

function compareSchemaPair(
  previousRaw,
  currentRaw,
  context,
  direction,
  previousDocument,
  currentDocument,
  issues,
  issueKeys,
  state = { pairs: new Set() },
) {
  if (!previousRaw || !currentRaw) {
    return;
  }

  const previousResolved = resolveSchema(previousRaw, previousDocument);
  const currentResolved = resolveSchema(currentRaw, currentDocument);
  if (!previousResolved.schema || !currentResolved.schema) {
    const schemaName = previousResolved.name ?? currentResolved.name ?? "inline schema";
    addIssue(issues, issueKeys, `${context}: schema ${schemaName} could not be resolved`);
    return;
  }

  const pairKey =
    previousResolved.name || currentResolved.name
      ? `${previousResolved.name ?? "inline"}=>${currentResolved.name ?? "inline"}:${direction}`
      : `${previousResolved.name ?? "inline"}=>${currentResolved.name ?? "inline"}:${context}`;
  if (state.pairs.has(pairKey)) {
    return;
  }
  state.pairs.add(pairKey);

  const previousSchema = previousResolved.schema;
  const currentSchema = currentResolved.schema;
  const schemaName = previousResolved.name ?? currentResolved.name;
  const schemaContext = schemaName ? `${context} schema ${schemaName}` : context;

  compareEnums(previousSchema, currentSchema, schemaContext, issues, issueKeys);
  compareTypes(previousSchema, currentSchema, schemaContext, issues, issueKeys);
  compareBounds(previousSchema, currentSchema, schemaContext, issues, issueKeys);

  if (previousSchema.type === "object" || previousSchema.properties || currentSchema.properties) {
    compareObjectSchemas(
      previousSchema,
      currentSchema,
      schemaContext,
      direction,
      previousDocument,
      currentDocument,
      issues,
      issueKeys,
      state,
    );
  }

  if (previousSchema.items && currentSchema.items) {
    compareSchemaPair(
      previousSchema.items,
      currentSchema.items,
      `${schemaContext} items`,
      direction,
      previousDocument,
      currentDocument,
      issues,
      issueKeys,
      state,
    );
  }

  for (const keyword of ["allOf", "oneOf", "anyOf"]) {
    const previousVariants = previousSchema[keyword] ?? [];
    const currentVariants = currentSchema[keyword] ?? [];
    for (let index = 0; index < Math.min(previousVariants.length, currentVariants.length); index += 1) {
      compareSchemaPair(
        previousVariants[index],
        currentVariants[index],
        `${schemaContext} ${keyword}[${index}]`,
        direction,
        previousDocument,
        currentDocument,
        issues,
        issueKeys,
        state,
      );
    }
  }
}

function compareObjectSchemas(
  previousSchema,
  currentSchema,
  schemaContext,
  direction,
  previousDocument,
  currentDocument,
  issues,
  issueKeys,
  state,
) {
  const previousProperties = previousSchema.properties ?? {};
  const currentProperties = currentSchema.properties ?? {};

  if (direction === "response") {
    for (const propertyName of Object.keys(previousProperties)) {
      if (!(propertyName in currentProperties)) {
        addIssue(
          issues,
          issueKeys,
          `${schemaContext}: removed response field "${propertyName}"`,
        );
      }
    }
  }

  const previousRequired = new Set(previousSchema.required ?? []);
  const currentRequired = new Set(currentSchema.required ?? []);
  if (direction === "request") {
    for (const propertyName of currentRequired) {
      if (!previousRequired.has(propertyName)) {
        addIssue(
          issues,
          issueKeys,
          `${schemaContext}: required property "${propertyName}" was added`,
        );
      }
    }
  } else {
    for (const propertyName of previousRequired) {
      if (propertyName in currentProperties && !currentRequired.has(propertyName)) {
        addIssue(
          issues,
          issueKeys,
          `${schemaContext}: required response property "${propertyName}" is no longer guaranteed`,
        );
      }
    }
  }

  for (const [propertyName, previousProperty] of Object.entries(previousProperties)) {
    const currentProperty = currentProperties[propertyName];
    if (!currentProperty) {
      continue;
    }

    const propertyContext = `${schemaContext}.${propertyName}`;
    compareSchemaPair(
      previousProperty,
      currentProperty,
      propertyContext,
      direction,
      previousDocument,
      currentDocument,
      issues,
      issueKeys,
      state,
    );
  }
}

function compareEnums(previousSchema, currentSchema, schemaContext, issues, issueKeys) {
  if (!Array.isArray(previousSchema.enum) || !Array.isArray(currentSchema.enum)) {
    return;
  }

  const removedValues = previousSchema.enum.filter(
    (value) => !currentSchema.enum.some((currentValue) => areEqual(currentValue, value)),
  );
  if (removedValues.length > 0) {
    addIssue(
      issues,
      issueKeys,
      `${schemaContext}: enum was narrowed; removed value(s) ${formatValues(removedValues)}`,
    );
  }
}

function compareTypes(previousSchema, currentSchema, schemaContext, issues, issueKeys) {
  const previousTypes = normalizeTypes(previousSchema.type);
  const currentTypes = normalizeTypes(currentSchema.type);
  if (previousTypes.length === 0 || currentTypes.length === 0) {
    return;
  }

  const incompatible = previousTypes.some((type) => !currentTypes.includes(type));
  if (incompatible) {
    addIssue(
      issues,
      issueKeys,
      `${schemaContext}: incompatible type changed from ${formatValues(previousTypes)} to ${formatValues(currentTypes)}`,
    );
  }
}

function compareBounds(previousSchema, currentSchema, schemaContext, issues, issueKeys) {
  const narrowed =
    (typeof previousSchema.minLength === "number" &&
      typeof currentSchema.minLength === "number" &&
      currentSchema.minLength > previousSchema.minLength) ||
    (typeof previousSchema.maxLength === "number" &&
      typeof currentSchema.maxLength === "number" &&
      currentSchema.maxLength < previousSchema.maxLength) ||
    (typeof previousSchema.minimum === "number" &&
      typeof currentSchema.minimum === "number" &&
      currentSchema.minimum > previousSchema.minimum) ||
    (typeof previousSchema.maximum === "number" &&
      typeof currentSchema.maximum === "number" &&
      currentSchema.maximum < previousSchema.maximum) ||
    (typeof previousSchema.maxItems === "number" &&
      typeof currentSchema.maxItems === "number" &&
      currentSchema.maxItems < previousSchema.maxItems);

  if (narrowed) {
    addIssue(issues, issueKeys, `${schemaContext}: a validation constraint was narrowed`);
  }
}

function compareUnreferencedSchemas(previousDocument, currentDocument, issues, issueKeys) {
  const previousSchemas = previousDocument.components?.schemas ?? {};
  const currentSchemas = currentDocument.components?.schemas ?? {};
  const referencedPreviousSchemas = collectReferencedSchemaNames(previousDocument);

  for (const schemaName of referencedPreviousSchemas) {
    if (!(schemaName in previousSchemas) || !(schemaName in currentSchemas)) {
      continue;
    }
    if (isSchemaReferencedByOperation(previousDocument, schemaName)) {
      continue;
    }
    compareSchemaPair(
      { $ref: `#/components/schemas/${schemaName}` },
      { $ref: `#/components/schemas/${schemaName}` },
      "component",
      "response",
      previousDocument,
      currentDocument,
      issues,
      issueKeys,
    );
  }
}

function collectReferencedSchemaNames(document) {
  const names = new Set();
  walk(document.paths, (value) => {
    if (value && typeof value === "object" && typeof value.$ref === "string") {
      const match = value.$ref.match(/^#\/components\/schemas\/([^/]+)$/);
      if (match) {
        names.add(match[1]);
      }
    }
  });
  return names;
}

function isSchemaReferencedByOperation(document, schemaName) {
  let found = false;
  walk(document.paths, (value) => {
    if (value && typeof value === "object" && value.$ref === `#/components/schemas/${schemaName}`) {
      found = true;
    }
  });
  return found;
}

function walk(value, visitor) {
  if (!value || typeof value !== "object") {
    return;
  }
  visitor(value);
  for (const child of Object.values(value)) {
    walk(child, visitor);
  }
}

function resolveReference(value, document) {
  if (!value) {
    return null;
  }
  if (typeof value.$ref !== "string") {
    return value;
  }
  return resolvePointer(value.$ref, document);
}

function resolveSchema(value, document) {
  if (!value) {
    return { schema: null, name: null };
  }
  if (typeof value.$ref !== "string") {
    return { schema: value, name: null };
  }
  const match = value.$ref.match(/^#\/components\/schemas\/([^/]+)$/);
  return {
    schema: resolvePointer(value.$ref, document),
    name: match?.[1] ?? value.$ref,
  };
}

function resolvePointer(reference, document) {
  if (!reference.startsWith("#/")) {
    return null;
  }
  return reference
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce((value, part) => value?.[part], document);
}

function formatOperationLabel(method, route, operation) {
  const operationId = operation.operationId ? ` (${operation.operationId})` : "";
  return `${method.toUpperCase()} ${route}${operationId}`;
}

function normalizeTypes(type) {
  return Array.isArray(type) ? type : typeof type === "string" ? [type] : [];
}

function formatValues(values) {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function areEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addIssue(issues, issueKeys, message) {
  if (!issueKeys.has(message)) {
    issueKeys.add(message);
    issues.push(message);
  }
}