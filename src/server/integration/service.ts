/**
 * /v1 use cases for integrated apps (decision-only mode: AgentGuard decides, the host app
 * executes). Controllers in src/app/v1 only authenticate, parse and map results to HTTP.
 */
import { and, desc, eq, isNull, max } from "drizzle-orm";
import { z } from "zod";
import { type DecisionTokenPayload, signDecisionToken, signDecisionTokenEd25519, verifyDecisionToken } from "../../../packages/core/src/decision-token";
import { ToolSpecSchema, compileToolSpec } from "../../../packages/core/src/tool-spec";
import { hashCanonical, sha256 } from "@/server/core/canonical";
import { detectInjectionSignals, extractFingerprints, normalizeValue, trustForSourceType } from "@/server/core/provenance";
import { type ProvenanceSource, type Sensitivity, SensitivitySchema, maxSensitivity } from "@/server/core/types";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { writeAudit } from "@/server/enforcement/audit";
import { checkToolCall } from "@/server/enforcement/check-tool-call";
import { consumeApproved } from "@/server/enforcement/execute-approved";
import { newId } from "@/server/enforcement/ids";
import { dbPolicyResolver } from "@/server/enforcement/policy-store";
import type { DecisionTokenIssuer, EnforcementDeps } from "@/server/enforcement/ports";
import { startSession } from "@/server/enforcement/session";
import type { SessionState } from "@/server/enforcement/types";
import { type ApiPrincipal, agentKey, ed25519For, tokenAlgOf, tokenKeyFor } from "./apps";
import { invalidateCatalog, resourceResolverFor, toolCatalogFor } from "./catalog";
import { notifyLater } from "./webhooks";

/** Short on purpose: a token authorizes one imminent call, not a future one. */
export const DECISION_TOKEN_TTL_SECONDS = 60;

/** A use-case failure the controller maps to an HTTP status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const tokenIssuer = (principal: ApiPrincipal, now: () => Date): DecisionTokenIssuer => ({
  async issue(tx, call) {
    const iat = Math.floor(now().getTime() / 1000);
    const payload: DecisionTokenPayload = {
      jti: newId("dt"),
      app: call.appId,
      agent: call.agentId,
      call: call.toolCallId,
      tool: call.tool,
      ah: hashCanonical(call.args),
      iat,
      exp: iat + DECISION_TOKEN_TTL_SECONDS,
    };
    const expiresAt = new Date(payload.exp * 1000);
    await tx.insert(s.decisionTokens).values({ id: payload.jti, appId: call.appId, toolCallId: call.toolCallId, argsHash: payload.ah, expiresAt });
    const token =
      tokenAlgOf(principal.app) === "ed25519"
        ? signDecisionTokenEd25519(ed25519For(principal.app).privateKey, payload)
        : signDecisionToken(tokenKeyFor(principal.app), payload);
    return { token, expiresAt };
  },
});

/** Composition root for an API request: the app's catalogs, no runner, token issuer, tenant scope. */
export async function depsFor(db: DB, principal: ApiPrincipal, now: () => Date = () => new Date()): Promise<EnforcementDeps> {
  return {
    db,
    tools: await toolCatalogFor(db, principal.app.id),
    resources: await resourceResolverFor(db, principal.app.id, principal.app.settings),
    tokens: tokenIssuer(principal, now),
    resolvePolicy: dbPolicyResolver(db),
    clock: { now },
    appId: principal.app.id,
    limits: { maxSinkCallsPerSession: Number(principal.app.settings.maxSinkCallsPerSession) || undefined },
  };
}

const Ref = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:@-]+$/, "letters, digits and _ . : @ -");

/** A key bound to one agent may only act as that agent. */
function actingAgent(principal: ApiPrincipal, agentRef: string): string {
  const id = agentKey(principal.app.id, agentRef);
  if (principal.agentId && principal.agentId !== id) throw new ApiError(403, "agent_mismatch", "This API key is bound to a different agent.");
  return id;
}

/**
 * Agent-bound keys (audit finding F1): every operation on an existing session, call or approval
 * must stay within that agent's own work. Anything else answers 404, like an unknown id, so a
 * bound key learns nothing about other agents' activity.
 */
function boundTo(principal: ApiPrincipal, agentId: string, what: string, code: string) {
  if (principal.agentId && principal.agentId !== agentId) throw new ApiError(404, code, `${what} not found.`);
}

/** External end users are identified by the app; AgentGuard keeps a pseudonymous row per (app, user). */
async function externalUser(db: DB, appId: string, userRef: string): Promise<string> {
  const h = sha256(`${appId}\u0000${userRef}`).slice(0, 24);
  const id = `ext_${h}`;
  await db
    .insert(s.users)
    .values({ id, name: userRef.slice(0, 80), email: `${h}@${appId}.apps.agentguard.invalid`, role: "member" })
    .onConflictDoNothing();
  return id;
}

// ---- sessions & provenance ------------------------------------------------------------

export const OpenSessionBody = z.object({
  userRef: Ref,
  agentId: Ref,
  /** Other agents of this app that may act in the session (sub-agents, hand-offs). */
  agents: z.array(Ref).max(20).default([]),
  /** The user's own request: the trusted channel. Destinations in it are authorized. */
  prompt: z.string().min(1).max(20_000),
  mandate: z.object({
    tools: z.array(z.string().max(64)).max(100),
    resources: z.array(z.string().max(256)).max(200).default([]),
    destinations: z.array(z.string().max(512)).max(100).default([]),
  }),
});

export async function openSession(db: DB, principal: ApiPrincipal, body: z.infer<typeof OpenSessionBody>) {
  const deps = await depsFor(db, principal);
  const agentId = actingAgent(principal, body.agentId);
  const userId = await externalUser(db, principal.app.id, body.userRef);
  try {
    const state = await startSession(deps, {
      appId: principal.app.id,
      userId,
      agentId,
      agentIds: body.agents.map((a) => agentKey(principal.app.id, a)),
      prompt: body.prompt,
      planner: "external",
      origin: "api",
      policyId: principal.app.defaultPolicyId,
      mandate: { allowedTools: body.mandate.tools, resourceScope: body.mandate.resources, destinations: body.mandate.destinations },
    });
    return { sessionId: state.id, mandate: state.mandate, policyId: state.policyId };
  } catch (err) {
    throw new ApiError(404, "unknown_agent", (err as Error).message);
  }
}

/** Rebuild session state from the database (API calls are stateless). Content is never stored: fingerprints stand in for it. */
async function loadSession(db: DB, appId: string, sessionId: string): Promise<SessionState> {
  const [row] = await db
    .select()
    .from(s.agentSessions)
    .where(and(eq(s.agentSessions.id, sessionId), eq(s.agentSessions.appId, appId)))
    .limit(1);
  if (!row || !row.policyId) throw new ApiError(404, "session_not_found", "Session not found.");
  const rows = await db.select().from(s.provenanceSources).where(eq(s.provenanceSources.sessionId, sessionId)).orderBy(s.provenanceSources.createdAt);
  const sources: ProvenanceSource[] = rows.map((r) => ({
    id: r.id,
    type: r.type as ProvenanceSource["type"],
    trust: r.trust as ProvenanceSource["trust"],
    label: r.label,
    content: r.fingerprints.join("\n"),
    contentHash: r.contentHash,
    sensitivity: r.sensitivity as Sensitivity,
    createdAt: r.createdAt.toISOString(),
    relatedToolCallId: r.relatedToolCallId ?? undefined,
    signals: r.signals,
  }));
  return {
    id: row.id,
    appId,
    userId: row.userId,
    agentId: row.agentId,
    policyId: row.policyId,
    mandate: row.mandate as SessionState["mandate"],
    sources,
    readSensitivity: maxSensitivity(sources.map((x) => x.sensitivity)),
  };
}

const SourceType = z.enum(["document", "email", "web", "tool_output", "agent_message"]);
const Signal = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

export const AddSourceBody = z
  .object({
    type: SourceType,
    label: z.string().min(1).max(200),
    sensitivity: SensitivitySchema.default("public"),
    /** Full-content mode (opt-in): the server extracts fingerprints and signals, then discards the text. */
    content: z.string().max(60_000).optional(),
    /** Privacy mode: emails/URLs found locally by the SDK. */
    fingerprints: z.array(z.string().min(3).max(512)).max(500).optional(),
    /** Locally detected signals. They can only escalate decisions, so accepting them is safe. */
    signals: z.array(Signal).max(20).optional(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    relatedCallId: z.string().max(64).optional(),
  })
  .refine((b) => b.content !== undefined || b.fingerprints !== undefined, "send `content` or `fingerprints`");

export async function addSource(db: DB, principal: ApiPrincipal, sessionId: string, body: z.infer<typeof AddSourceBody>) {
  await loadSession(db, principal.app.id, sessionId);
  if (principal.agentId) {
    // A bound key may only add context to sessions its agent takes part in.
    const [row] = await db
      .select({ agentId: s.agentSessions.agentId, agentIds: s.agentSessions.agentIds })
      .from(s.agentSessions)
      .where(eq(s.agentSessions.id, sessionId))
      .limit(1);
    if (row.agentId !== principal.agentId && !row.agentIds.includes(principal.agentId))
      throw new ApiError(404, "session_not_found", "Session not found.");
  }
  if (body.relatedCallId) {
    const [rel] = await db
      .select({ id: s.toolCalls.id })
      .from(s.toolCalls)
      .where(and(eq(s.toolCalls.id, body.relatedCallId), eq(s.toolCalls.sessionId, sessionId)))
      .limit(1);
    if (!rel) throw new ApiError(400, "invalid_related_call", "relatedCallId must be a call of this session.");
  }
  return insertSource(db, sessionId, body);
}

async function insertSource(db: DB, sessionId: string, body: z.infer<typeof AddSourceBody>) {
  const content = body.content ?? "";
  const fingerprints = [...new Set([...extractFingerprints(content), ...(body.fingerprints ?? []).map(normalizeValue)])].sort();
  const detected = detectInjectionSignals(body.type, content);
  const extra = body.signals ?? [];
  const signals = [...new Set([...detected, ...extra, ...(extra.length ? ["injection_suspected"] : [])])].sort();
  const id = newId("src");
  await db.insert(s.provenanceSources).values({
    id,
    sessionId,
    type: body.type,
    trust: trustForSourceType(body.type),
    label: body.label,
    contentHash: body.contentHash ?? sha256(content || fingerprints.join("\n")),
    fingerprints,
    sensitivity: body.sensitivity,
    signals,
    relatedToolCallId: body.relatedCallId ?? null,
  });
  return { sourceId: id, fingerprints: fingerprints.length, signals };
}

// ---- decisions -------------------------------------------------------------------------

export const CheckBody = z.object({
  sessionId: z.string().min(1).max(64),
  agentId: Ref,
  tool: z.string().min(1).max(100),
  args: z.record(z.string(), z.unknown()),
  rationale: z.string().max(1000).optional(),
  /** Multi-agent: the call (in this session) whose agent delegated this step. Recorded for audit. */
  parentCallId: z.string().max(64).optional(),
});

export async function check(db: DB, principal: ApiPrincipal, body: z.infer<typeof CheckBody>) {
  const agentId = actingAgent(principal, body.agentId);
  const state = await loadSession(db, principal.app.id, body.sessionId);
  if (body.parentCallId) {
    const [parent] = await db
      .select({ id: s.toolCalls.id })
      .from(s.toolCalls)
      .where(and(eq(s.toolCalls.id, body.parentCallId), eq(s.toolCalls.sessionId, state.id)))
      .limit(1);
    if (!parent) throw new ApiError(400, "invalid_parent_call", "parentCallId must be a call of this session.");
  }
  const r = await checkToolCall(await depsFor(db, principal), state, {
    tool: body.tool,
    args: body.args,
    agentId,
    rationale: body.rationale,
    parentCallId: body.parentCallId,
  });
  if (r.approvalId)
    notifyLater(db, {
      type: "approval.requested",
      app: principal.app.id,
      approvalId: r.approvalId,
      callId: r.toolCallId,
      tool: body.tool,
      status: "pending",
      expiresAt: r.approvalExpiresAt!,
    });
  return {
    callId: r.toolCallId,
    decision: r.decision.decision,
    status: r.status,
    reasons: r.decision.reasons.map(({ code, message, ruleId }) => ({ code, message, ruleId })),
    policyId: r.decision.policyId,
    policyVersion: r.decision.policyVersion,
    riskScore: r.decision.riskScore,
    approvalId: r.approvalId,
    approvalExpiresAt: r.approvalExpiresAt,
    decisionToken: r.decisionToken,
    decisionTokenExpiresAt: r.decisionTokenExpiresAt,
    provenance: { destination: r.provenance.destination, dataSensitivity: r.provenance.dataSensitivity, signals: r.provenance.signals },
  };
}

async function ownedApproval(db: DB, principal: ApiPrincipal, approvalId: string) {
  const [row] = await db
    .select({ apr: s.approvals, agentId: s.toolCalls.agentId })
    .from(s.approvals)
    .innerJoin(s.toolCalls, eq(s.toolCalls.id, s.approvals.toolCallId))
    .where(and(eq(s.approvals.id, approvalId), eq(s.approvals.appId, principal.app.id)))
    .limit(1);
  if (!row) throw new ApiError(404, "approval_not_found", "Approval not found.");
  boundTo(principal, row.agentId, "Approval", "approval_not_found");
  return row.apr;
}

export async function getApproval(db: DB, principal: ApiPrincipal, approvalId: string) {
  const apr = await ownedApproval(db, principal, approvalId);
  const expired = (apr.status === "pending" || apr.status === "approved") && Date.now() > apr.expiresAt.getTime();
  return {
    approvalId: apr.id,
    callId: apr.toolCallId,
    status: expired ? "expired" : apr.status,
    expiresAt: apr.expiresAt.toISOString(),
    decidedAt: apr.decidedAt?.toISOString() ?? null,
    note: apr.decisionNote ?? null,
  };
}

export async function consume(db: DB, principal: ApiPrincipal, approvalId: string) {
  await ownedApproval(db, principal, approvalId);
  const r = await consumeApproved(await depsFor(db, principal), {
    approvalId,
    actorId: `app:${principal.keyId}`,
    idempotencyKey: `consume:${approvalId}`,
  });
  if (!r.ok) throw new ApiError(409, r.code, r.message);
  return { callId: r.toolCallId, decisionToken: r.decisionToken, decisionTokenExpiresAt: r.expiresAt };
}

export const ResultBody = z.object({
  ok: z.boolean(),
  summary: z.record(z.string(), z.unknown()).optional(),
  /** What the tool returned is UNTRUSTED provenance for later calls: send fingerprints (default) or content. */
  output: z.string().max(60_000).optional(),
  outputFingerprints: z.array(z.string().min(3).max(512)).max(500).optional(),
  signals: z.array(Signal).max(20).optional(),
  sensitivity: SensitivitySchema.default("public"),
});

export async function reportResult(db: DB, principal: ApiPrincipal, callId: string, body: z.infer<typeof ResultBody>) {
  const [tc] = await db
    .select()
    .from(s.toolCalls)
    .where(and(eq(s.toolCalls.id, callId), eq(s.toolCalls.appId, principal.app.id)))
    .limit(1);
  if (!tc) throw new ApiError(404, "call_not_found", "Tool call not found.");
  boundTo(principal, tc.agentId, "Tool call", "call_not_found");
  if (tc.status !== "allowed") throw new ApiError(409, "not_reportable", `Call is ${tc.status}; only allowed calls take a result.`);
  const summary = body.summary ?? {};
  try {
    await db.transaction(async (raw) => {
      const tx = raw as unknown as DB;
      // Unique on tool_call_id: a call has at most one recorded execution.
      await tx.insert(s.executions).values({ id: newId("ex"), toolCallId: callId, idempotencyKey: `report:${callId}`, approvalId: null, ok: body.ok, resultSummary: summary });
      await tx.update(s.toolCalls).set({ status: body.ok ? "executed" : "failed" }).where(eq(s.toolCalls.id, callId));
      await writeAudit(tx, {
        type: "tool_call.result_reported",
        appId: principal.app.id,
        severity: body.ok ? "info" : "warning",
        sessionId: tc.sessionId,
        toolCallId: callId,
        actorId: `app:${principal.keyId}`,
        payload: { tool: tc.tool, ok: body.ok, summary },
      });
    });
  } catch {
    throw new ApiError(409, "already_reported", "A result was already reported for this call.");
  }
  if (body.ok && (body.output !== undefined || body.outputFingerprints !== undefined)) {
    await insertSource(db, tc.sessionId, {
      type: "tool_output",
      label: `${tc.tool} result`,
      sensitivity: body.sensitivity,
      content: body.output,
      fingerprints: body.outputFingerprints,
      signals: body.signals,
      relatedCallId: callId,
    });
  }
  return { callId, status: body.ok ? "executed" : "failed" };
}

// ---- tool-side verification ------------------------------------------------------------

export const VerifyBody = z.object({
  token: z.string().min(10).max(4096),
  tool: z.string().min(1).max(100),
  args: z.record(z.string(), z.unknown()),
  /** Mark the token used (default). A second verification of the same token then fails. */
  consume: z.boolean().default(true),
});

export async function verifyToken(db: DB, principal: ApiPrincipal, body: z.infer<typeof VerifyBody>) {
  const v = verifyDecisionToken(body.token, {
    key: tokenKeyFor(principal.app),
    publicKey: ed25519For(principal.app).publicKey,
    tool: body.tool,
    args: body.args,
    appId: principal.app.id,
  });
  let result: { valid: boolean; code?: string; message?: string; callId?: string };
  if (!v.ok) result = { valid: false, code: v.code, message: v.message };
  // A bound key may only verify (and so consume) its own agent's tokens.
  else if (principal.agentId && v.payload.agent !== principal.agentId)
    result = { valid: false, code: "WRONG_AGENT", message: "Token was issued to another agent." };
  else if (!body.consume) result = { valid: true, callId: v.payload.call };
  else {
    const used = await db
      .update(s.decisionTokens)
      .set({ consumedAt: new Date() })
      .where(and(eq(s.decisionTokens.id, v.payload.jti), eq(s.decisionTokens.appId, principal.app.id), isNull(s.decisionTokens.consumedAt)))
      .returning({ id: s.decisionTokens.id });
    result = used.length === 1 ? { valid: true, callId: v.payload.call } : { valid: false, code: "REPLAYED", message: "Token was already used." };
  }
  await writeAudit(db, {
    type: "decision_token.verified",
    appId: principal.app.id,
    severity: result.valid ? "info" : "critical",
    toolCallId: result.callId ?? (v.ok ? v.payload.call : null),
    actorId: `app:${principal.keyId}`,
    decision: result.valid ? "ALLOW" : "BLOCK",
    reasonCodes: result.code ? [result.code] : [],
    payload: { tool: body.tool, consume: body.consume },
  });
  return result;
}

// ---- administration (scope: admin) -----------------------------------------------------

export async function listTools(db: DB, principal: ApiPrincipal) {
  const rows = await db
    .select()
    .from(s.toolSpecs)
    .where(and(eq(s.toolSpecs.appId, principal.app.id), eq(s.toolSpecs.active, true)))
    .orderBy(s.toolSpecs.name, desc(s.toolSpecs.version));
  const latest = new Map(rows.map((r) => [r.name, r] as const).reverse());
  return { tools: [...latest.values()].map((r) => ({ name: r.name, version: r.version, spec: r.spec })) };
}

/** Save a new version of a tool spec. Invalid specs are rejected with actionable errors. */
export async function putTool(db: DB, principal: ApiPrincipal, name: string, spec: unknown) {
  const parsed = ToolSpecSchema.safeParse(spec);
  if (!parsed.success)
    throw new ApiError(400, "invalid_tool_spec", "Tool spec is invalid.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  if (parsed.data.name !== name) throw new ApiError(400, "name_mismatch", "spec.name must equal the path name.");
  try {
    compileToolSpec(parsed.data);
  } catch (err) {
    throw new ApiError(400, "invalid_tool_spec", (err as Error).message);
  }
  const saved = await db.transaction(async (raw) => {
    const tx = raw as unknown as DB;
    const [{ v }] = await tx
      .select({ v: max(s.toolSpecs.version) })
      .from(s.toolSpecs)
      .where(and(eq(s.toolSpecs.appId, principal.app.id), eq(s.toolSpecs.name, name)));
    const version = (v ?? 0) + 1;
    await tx.update(s.toolSpecs).set({ active: false }).where(and(eq(s.toolSpecs.appId, principal.app.id), eq(s.toolSpecs.name, name)));
    await tx.insert(s.toolSpecs).values({ id: newId("ts"), appId: principal.app.id, name, version, spec: parsed.data });
    await writeAudit(tx, { type: "tool_spec.saved", appId: principal.app.id, actorId: `app:${principal.keyId}`, payload: { name, version, kind: parsed.data.kind, risk: parsed.data.risk } });
    return { name, version };
  });
  invalidateCatalog(principal.app.id); // after commit, so no reader re-caches the old version
  return saved;
}

export const PutAgentBody = z.object({
  name: z.string().min(1).max(120),
  /** Upper bound on any mandate: tools this agent may ever request. */
  allowedTools: z.array(z.string().max(64)).max(100),
  active: z.boolean().default(true),
});

export async function putAgent(db: DB, principal: ApiPrincipal, agentRef: string, body: z.infer<typeof PutAgentBody>) {
  const id = agentKey(principal.app.id, Ref.parse(agentRef));
  const values = { id, appId: principal.app.id, name: body.name, allowedTools: body.allowedTools, active: body.active };
  await db.insert(s.agents).values(values).onConflictDoUpdate({ target: s.agents.id, set: { name: values.name, allowedTools: values.allowedTools, active: values.active } });
  await writeAudit(db, { type: "agent.saved", appId: principal.app.id, actorId: `app:${principal.keyId}`, payload: { agentId: agentRef, allowedTools: body.allowedTools, active: body.active } });
  return { agentId: agentRef, allowedTools: body.allowedTools, active: body.active };
}
