import { z } from "zod";
import { ToolSpecSchema } from "../../../packages/core/src/tool-spec";
import { AddSourceBody, CheckBody, OpenSessionBody, PutAgentBody, ResultBody, VerifyBody } from "./service";

/**
 * OpenAPI 3.1 description of /v1. Request schemas are generated from the same Zod schemas the
 * handlers validate with, so the document cannot drift from the implementation.
 */
const schema = (t: z.ZodType) => z.toJSONSchema(t, { io: "input", unrepresentable: "any" });
const jsonBody = (t: z.ZodType) => ({ required: true, content: { "application/json": { schema: schema(t) } } });
const ok = (description: string, props: Record<string, unknown> = {}) => ({
  description,
  content: { "application/json": { schema: { type: "object", properties: props } } },
});
const errors = {
  "400": { $ref: "#/components/responses/Error" },
  "401": { $ref: "#/components/responses/Error" },
  "403": { $ref: "#/components/responses/Error" },
  "404": { $ref: "#/components/responses/Error" },
  "409": { $ref: "#/components/responses/Error" },
  "413": { $ref: "#/components/responses/Error" },
  "429": { $ref: "#/components/responses/Error" },
};
const id = (name: string) => ({ name, in: "path", required: true, schema: { type: "string" } });
const str = { type: "string" };

export function openApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Callwrit Decision API",
      version: "1.0.0",
      description:
        "Check every tool call an AI agent proposes before it runs. Callwrit decides (ALLOW / REVIEW / BLOCK); your app executes. " +
        "Fail closed: treat timeouts and errors as BLOCK for any tool that sends data out.",
    },
    servers: [{ url: "/" }],
    security: [{ apiKey: [] }],
    components: {
      securitySchemes: { apiKey: { type: "http", scheme: "bearer", description: "API key `agk_…` (scopes: check, verify, admin)" } },
      responses: {
        Error: {
          description: "Error",
          content: { "application/json": { schema: { type: "object", properties: { error: str, message: str, details: {} } } } },
        },
      },
      schemas: { ToolSpec: schema(ToolSpecSchema) },
    },
    paths: {
      "/v1/health": { get: { security: [], summary: "Liveness", responses: { "200": ok("OK") } } },
      "/v1/sessions": {
        post: {
          summary: "Open an agent session (scope: check)",
          description: "`prompt` is the trusted channel: emails/URLs the user typed there become authorized destinations.",
          requestBody: jsonBody(OpenSessionBody),
          responses: { "201": ok("Session opened", { sessionId: str, mandate: { type: "object" }, policyId: str }), ...errors },
        },
      },
      "/v1/sessions/{id}/sources": {
        post: {
          summary: "Register content the agent saw (scope: check)",
          description: "Untrusted provenance. Privacy mode sends `fingerprints` (emails/URLs) instead of `content`.",
          parameters: [id("id")],
          requestBody: jsonBody(AddSourceBody),
          responses: { "201": ok("Registered", { sourceId: str, fingerprints: { type: "integer" }, signals: { type: "array" } }), ...errors },
        },
      },
      "/v1/check": {
        post: {
          summary: "Decide a proposed tool call (scope: check)",
          requestBody: jsonBody(CheckBody),
          responses: {
            "200": ok("Decision", {
              callId: str,
              decision: { enum: ["ALLOW", "REVIEW", "BLOCK"] },
              status: { enum: ["allowed", "pending_approval", "blocked"] },
              reasons: { type: "array", items: { type: "object", properties: { code: str, message: str, ruleId: str } } },
              policyId: str,
              policyVersion: { type: "integer" },
              riskScore: { type: "integer" },
              approvalId: str,
              approvalExpiresAt: str,
              decisionToken: { ...str, description: "ALLOW only: single-use, 60 s, bound to tool + args" },
              decisionTokenExpiresAt: str,
              provenance: { type: "object" },
            }),
            ...errors,
          },
        },
      },
      "/v1/approvals/{id}": {
        get: {
          summary: "Approval status (scope: check)",
          parameters: [id("id")],
          responses: { "200": ok("Status", { approvalId: str, callId: str, status: str, expiresAt: str, decidedAt: str }), ...errors },
        },
      },
      "/v1/approvals/{id}/consume": {
        post: {
          summary: "Claim an approved action and get its decision token (scope: check)",
          parameters: [id("id")],
          responses: { "200": ok("Token", { callId: str, decisionToken: str, decisionTokenExpiresAt: str }), ...errors },
        },
      },
      "/v1/calls/{id}/result": {
        post: {
          summary: "Report the outcome of an allowed call (scope: check)",
          parameters: [id("id")],
          requestBody: jsonBody(ResultBody),
          responses: { "200": ok("Recorded", { callId: str, status: str }), ...errors },
        },
      },
      "/v1/tokens/verify": {
        post: {
          summary: "Verify (and consume) a decision token for exactly this tool + args (scope: verify)",
          requestBody: jsonBody(VerifyBody),
          responses: { "200": ok("Result", { valid: { type: "boolean" }, code: str, message: str, callId: str }), ...errors },
        },
      },
      "/v1/tools": { get: { summary: "List active tool specs (scope: admin)", responses: { "200": ok("Tools", { tools: { type: "array" } }), ...errors } } },
      "/v1/tools/{name}": {
        put: {
          summary: "Save a new version of a tool spec (scope: admin)",
          parameters: [id("name")],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ToolSpec" } } } },
          responses: { "200": ok("Saved", { name: str, version: { type: "integer" } }), ...errors },
        },
      },
      "/v1/agents/{id}": {
        put: {
          summary: "Create or update an agent identity (scope: admin)",
          parameters: [id("id")],
          requestBody: jsonBody(PutAgentBody),
          responses: { "200": ok("Saved", { agentId: str, allowedTools: { type: "array" }, active: { type: "boolean" } }), ...errors },
        },
      },
    },
  };
}
