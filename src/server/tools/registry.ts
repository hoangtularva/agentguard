import { z } from "zod";
import type { RiskLevel } from "@/server/core/types";

/**
 * Tool Registry: declarative tool metadata ONLY. Executors live in
 * `src/server/tools/executors.ts` and may only be imported by the
 * Policy Enforcement Point (enforced by an ESLint rule and a unit test).
 */

const ResourceId = z.string().min(1).max(120).regex(/^[a-z]+:[a-z0-9_\-/.]+$/i, "must be a full resource id including its prefix, e.g. doc:public/handbook or ds:sales_q3");

export const ReadDocumentsArgs = z
  .object({ documentIds: z.array(ResourceId).min(1).max(10) })
  .strict();

export const SendEmailArgs = z
  .object({
    to: z.email().max(254),
    subject: z.string().min(1).max(200),
    body: z.string().max(8000),
  })
  .strict();

export const ExportDataArgs = z
  .object({
    dataset: ResourceId,
    destination: z.url({ protocol: /^https$/ }).max(500),
    format: z.enum(["csv", "json"]),
  })
  .strict();

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  risk: RiskLevel;
  /** source: brings data into context. sink: sends data out of the trust boundary. */
  kind: "source" | "sink";
  argsSchema: z.ZodType<Record<string, unknown>>;
  /** Argument that names resources (checked against mandate resource scope). */
  resourceArg?: string;
  /** Argument that names an outbound destination (checked for provenance). */
  destinationArg?: string;
  /** Free-text arguments whose content is hashed (never stored verbatim) in audit. */
  contentArgs: string[];
  /** JSON schema handed to LLMs for tool calling. */
  jsonSchema: Record<string, unknown>;
}

export const TOOL_REGISTRY: Record<string, ToolDefinition> = {
  read_documents: {
    name: "read_documents",
    title: "Read Documents",
    description: "Read one or more documents or datasets from the company corpus. Pass ids exactly as the user wrote them, including the doc: or ds: prefix (e.g. doc:public/handbook).",
    risk: "low",
    kind: "source",
    argsSchema: ReadDocumentsArgs,
    resourceArg: "documentIds",
    contentArgs: [],
    jsonSchema: {
      type: "object",
      properties: { documentIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 } },
      required: ["documentIds"],
      additionalProperties: false,
    },
  },
  send_email: {
    name: "send_email",
    title: "Send Email (mock)",
    description: "Send an email. In this demo emails are written to a sandbox outbox and never delivered.",
    risk: "high",
    kind: "sink",
    argsSchema: SendEmailArgs,
    destinationArg: "to",
    contentArgs: ["body"],
    jsonSchema: {
      type: "object",
      properties: {
        to: { type: "string", format: "email" },
        subject: { type: "string", maxLength: 200 },
        body: { type: "string", maxLength: 8000 },
      },
      required: ["to", "subject", "body"],
      additionalProperties: false,
    },
  },
  export_data: {
    name: "export_data",
    title: "Export Data (mock)",
    description: "Export a dataset to an HTTPS destination. In this demo exports are recorded in a sandbox and never transmitted.",
    risk: "critical",
    kind: "sink",
    argsSchema: ExportDataArgs,
    resourceArg: "dataset",
    destinationArg: "destination",
    contentArgs: [],
    jsonSchema: {
      type: "object",
      properties: {
        dataset: { type: "string" },
        destination: { type: "string", format: "uri" },
        format: { type: "string", enum: ["csv", "json"] },
      },
      required: ["dataset", "destination", "format"],
      additionalProperties: false,
    },
  },
};

export function getTool(name: string): ToolDefinition | undefined {
  return Object.prototype.hasOwnProperty.call(TOOL_REGISTRY, name) ? TOOL_REGISTRY[name] : undefined;
}

export const TOOL_NAMES = Object.keys(TOOL_REGISTRY);

/** Extract resource ids referenced by a (validated) argument object. */
export function resourcesOf(tool: ToolDefinition, args: Record<string, unknown>): string[] {
  if (!tool.resourceArg) return [];
  const v = args[tool.resourceArg];
  if (Array.isArray(v)) return v.map(String);
  return typeof v === "string" ? [v] : [];
}

export function destinationOf(tool: ToolDefinition, args: Record<string, unknown>): string | undefined {
  if (!tool.destinationArg) return undefined;
  const v = args[tool.destinationArg];
  return typeof v === "string" ? v : undefined;
}
