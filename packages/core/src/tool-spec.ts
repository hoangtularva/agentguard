import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { z } from "zod";
import { RiskLevelSchema } from "./types";

/**
 * Data-driven tool description. Any application can register its own tools with
 * Callwrit using this shape; the PEP needs nothing else to enforce policy.
 *
 * Security-relevant metadata:
 *  - kind: "source" brings data in, "sink" sends data out (destinations are provenance-checked)
 *  - resourceArg: argument naming resource ids (checked against mandate scope + labels)
 *  - destinationArg: argument naming an outbound destination (email, URL, account, …)
 *  - contentArgs: free-text arguments; hashed (never stored verbatim) in audit
 */
export const ToolSpecSchema = z
  .object({
    name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/, "tool names: letters, digits, _ . - (max 64)"),
    title: z.string().max(120).optional(),
    description: z.string().max(2000).default(""),
    kind: z.enum(["source", "sink"]),
    risk: RiskLevelSchema,
    inputSchema: z.record(z.string(), z.unknown()),
    resourceArg: z.string().max(64).optional(),
    destinationArg: z.string().max(64).optional(),
    destinationType: z.enum(["email", "url", "phone", "account", "other"]).optional(),
    contentArgs: z.array(z.string().max(64)).max(20).default([]),
    /** Optional per-argument hints appended to validation errors so a model can self-correct. */
    argHints: z.record(z.string(), z.string().max(300)).default({}),
  })
  .strict()
  .superRefine((s, ctx) => {
    const props = (s.inputSchema.properties ?? {}) as Record<string, unknown>;
    if (s.inputSchema.type !== "object") ctx.addIssue({ code: "custom", message: "inputSchema.type must be 'object'", path: ["inputSchema"] });
    for (const k of ["resourceArg", "destinationArg"] as const) {
      const v = s[k];
      if (v && !(v in props)) ctx.addIssue({ code: "custom", message: `${k} '${v}' is not a property of inputSchema`, path: [k] });
    }
    if (s.kind === "sink" && !s.destinationArg)
      ctx.addIssue({ code: "custom", message: "sink tools must declare destinationArg (where data goes)", path: ["destinationArg"] });
  });
export type ToolSpecInput = z.input<typeof ToolSpecSchema>;
export type ToolSpec = z.infer<typeof ToolSpecSchema>;

export interface CompiledTool extends ToolSpec {
  validate(args: unknown): { ok: true; data: Record<string, unknown> } | { ok: false; errors: string[] };
}

const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: false, useDefaults: false });
addFormats(ajv);

/**
 * Unknown arguments are always rejected, whatever the registered schema says:
 * a tool's attack surface must not grow with fields the policy never looked at.
 */
function hardenSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const s = structuredClone(schema);
  if (s.type === "object") s.additionalProperties = false;
  return s;
}

function explain(spec: ToolSpec, e: ErrorObject): string {
  const field = e.instancePath.replace(/^\//, "").replace(/\//g, ".") || "args";
  if (e.keyword === "additionalProperties") {
    const extra = (e.params as { additionalProperty: string }).additionalProperty;
    const allowed = Object.keys((spec.inputSchema.properties ?? {}) as object).join(", ");
    return `unknown argument '${extra}'; ${spec.name} accepts only: ${allowed}`;
  }
  if (e.keyword === "required") return `missing required argument '${(e.params as { missingProperty: string }).missingProperty}'`;
  const top = field.split(".")[0];
  const hint = spec.argHints[top] ?? spec.argHints[field];
  return `${field}: ${e.message ?? "invalid"}${hint ? ` — ${hint}` : ""}`;
}

/** Validate a spec and compile its input schema. Throws on an invalid spec. */
export function compileToolSpec(input: ToolSpecInput): CompiledTool {
  const spec = ToolSpecSchema.parse(input);
  let fn: ValidateFunction;
  try {
    fn = ajv.compile(hardenSchema(spec.inputSchema));
  } catch (err) {
    throw new Error(`Invalid inputSchema for tool ${spec.name}: ${(err as Error).message}`);
  }
  return {
    ...spec,
    validate(args: unknown) {
      if (!args || typeof args !== "object" || Array.isArray(args)) return { ok: false, errors: ["args: must be a JSON object"] };
      const copy = structuredClone(args) as Record<string, unknown>;
      if (fn(copy)) return { ok: true, data: copy };
      const errors = [...new Set((fn.errors ?? []).map((e) => explain(spec, e)))];
      return { ok: false, errors };
    },
  };
}

export function resourcesOfSpec(tool: ToolSpec, args: Record<string, unknown>): string[] {
  if (!tool.resourceArg) return [];
  const v = args[tool.resourceArg];
  if (Array.isArray(v)) return v.map(String);
  return typeof v === "string" ? [v] : [];
}

export function destinationOfSpec(tool: ToolSpec, args: Record<string, unknown>): string | undefined {
  if (!tool.destinationArg) return undefined;
  const v = args[tool.destinationArg];
  return typeof v === "string" ? v : undefined;
}
