import { type CompiledTool, type ToolSpecInput, compileToolSpec, destinationOfSpec, resourcesOfSpec } from "../../../packages/core/src/tool-spec";

/**
 * Tool Registry for the built-in demo app: declarative ToolSpecs ONLY (JSON Schema + security metadata).
 * External applications register their own ToolSpecs the same way (Phase 4).
 * Executors live in `src/server/tools/executors.ts` and may only be imported by the PEP
 * (enforced by an ESLint rule and tests/unit/boundaries.test.ts).
 */
const RESOURCE_ID = { type: "string", minLength: 1, maxLength: 120, pattern: "^[a-zA-Z]+:[a-zA-Z0-9_\\-/.]+$" };
const ID_HINT = "must be a full resource id including its prefix, e.g. doc:public/handbook or ds:sales_q3";

export const DEMO_TOOL_SPECS: ToolSpecInput[] = [
  {
    name: "read_documents",
    title: "Read Documents",
    description:
      "Read one or more documents or datasets from the company corpus. Pass ids exactly as the user wrote them, including the doc: or ds: prefix (e.g. doc:public/handbook).",
    kind: "source",
    risk: "low",
    resourceArg: "documentIds",
    inputSchema: {
      type: "object",
      properties: { documentIds: { type: "array", items: RESOURCE_ID, minItems: 1, maxItems: 10 } },
      required: ["documentIds"],
    },
    argHints: { documentIds: ID_HINT },
  },
  {
    name: "send_email",
    title: "Send Email (mock)",
    description: "Send an email. In this demo emails are written to a sandbox outbox and never delivered.",
    kind: "sink",
    risk: "high",
    destinationArg: "to",
    destinationType: "email",
    contentArgs: ["body"],
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", format: "email", maxLength: 254 },
        subject: { type: "string", minLength: 1, maxLength: 200 },
        body: { type: "string", maxLength: 8000 },
      },
      required: ["to", "subject", "body"],
    },
    argHints: { to: "a single email address the user provided" },
  },
  {
    name: "export_data",
    title: "Export Data (mock)",
    description: "Export a dataset to an HTTPS destination. In this demo exports are recorded in a sandbox and never transmitted.",
    kind: "sink",
    risk: "critical",
    resourceArg: "dataset",
    destinationArg: "destination",
    destinationType: "url",
    inputSchema: {
      type: "object",
      properties: {
        dataset: RESOURCE_ID,
        destination: { type: "string", format: "uri", pattern: "^https://", maxLength: 500 },
        format: { type: "string", enum: ["csv", "json"] },
      },
      required: ["dataset", "destination", "format"],
    },
    argHints: { dataset: ID_HINT, destination: "an https:// URL the user provided" },
  },
];

/** A compiled tool plus the JSON schema handed to LLMs for tool calling. */
export type ToolDefinition = CompiledTool & { jsonSchema: Record<string, unknown> };

function toDefinition(spec: ToolSpecInput): ToolDefinition {
  const compiled = compileToolSpec(spec);
  return { ...compiled, jsonSchema: { ...compiled.inputSchema, additionalProperties: false } };
}

export const TOOL_REGISTRY: Record<string, ToolDefinition> = Object.fromEntries(DEMO_TOOL_SPECS.map((s) => [s.name, toDefinition(s)]));

export function getTool(name: string): ToolDefinition | undefined {
  return Object.prototype.hasOwnProperty.call(TOOL_REGISTRY, name) ? TOOL_REGISTRY[name] : undefined;
}

export const TOOL_NAMES = Object.keys(TOOL_REGISTRY);

export const resourcesOf = resourcesOfSpec;
export const destinationOf = destinationOfSpec;
