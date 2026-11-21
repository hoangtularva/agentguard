import { and, eq, ne, sql } from "drizzle-orm";
import { computeBindingHash } from "@/server/core/approval-binding";
import { hashCanonical } from "@/server/core/canonical";
import { type PolicyDecision, evaluatePolicy } from "@/server/core/policy-engine";
import type { PolicyRef } from "@/server/core/policy-schema";
import { redactArgs } from "@/server/core/redact";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { writeAudit } from "./audit";
import { runExecution } from "./execution";
import { newId } from "./ids";
import { buildPolicyInput } from "./policy-input";
import type { EnforcementDeps } from "./ports";
import { ingestOutput, verifyIdentity } from "./session";
import type { CallStatus, EnforcementResult, ProposedToolCall, SessionState } from "./types";

const SEVERITY = { BLOCK: "critical", REVIEW: "warning", ALLOW: "info" } as const;
const STATUS: Record<PolicyDecision["decision"], CallStatus> = {
  BLOCK: "blocked",
  REVIEW: "pending_approval",
  ALLOW: "executed",
};

/** Outbound (sink) calls that were not blocked count against the per-session limit, if any. */
async function sinkBudget(deps: EnforcementDeps, sessionId: string) {
  const max = deps.limits?.maxSinkCallsPerSession;
  if (!max) return undefined;
  const [{ n }] = await deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.toolCalls)
    .where(and(eq(s.toolCalls.sessionId, sessionId), ne(s.toolCalls.decision, "BLOCK"), sql`${s.toolCalls.provenance} -> 'destination' is not null`));
  return { sinkCalls: n, maxSinkCalls: max };
}

/** Evaluate the active policy; fail closed (BLOCK) when it cannot be loaded or evaluated. */
async function decide(deps: EnforcementDeps, policyId: string, input: Parameters<typeof evaluatePolicy>[0]) {
  try {
    const policy = await deps.resolvePolicy(policyId);
    return { policy, decision: evaluatePolicy(input, policy) };
  } catch (err) {
    const decision: PolicyDecision = {
      decision: "BLOCK",
      reasons: [{ code: "NO_MATCHING_POLICY", message: `Policy unavailable: ${(err as Error).message}`, effect: "BLOCK" }],
      matchedRuleIds: [],
      policyId,
      policyVersion: 0,
      riskScore: 100,
    };
    return { policy: undefined, decision };
  }
}

/**
 * Use case: check one proposed tool call. Persists the decision and its audit event, then
 * ALLOW → execute once · REVIEW → create an approval bound to the exact action · BLOCK → refuse.
 * Never throws for policy outcomes.
 */
export async function checkToolCall(deps: EnforcementDeps, state: SessionState, call: ProposedToolCall): Promise<EnforcementResult> {
  const { db } = deps;
  const t0 = performance.now();
  const identity = await verifyIdentity(db, state, call);
  const built = buildPolicyInput(state, call, identity, deps, await sinkBudget(deps, state.id));
  const { input, args } = built;
  const snapshot = call.parentCallId ? { ...built.snapshot, delegatedFrom: call.parentCallId } : built.snapshot;

  const e0 = performance.now();
  const { policy, decision } = await decide(deps, state.policyId, input);
  const evalLatencyMs = performance.now() - e0;

  const tool = deps.tools.get(call.tool);
  const toolCallId = newId("tc");
  const argsForAudit = redactArgs(tool, args ?? call.args);
  const status = STATUS[decision.decision];

  await db.insert(s.toolCalls).values({
    id: toolCallId,
    appId: state.appId,
    sessionId: state.id,
    userId: state.userId,
    agentId: call.agentId,
    tool: call.tool.slice(0, 100),
    argsRedacted: argsForAudit ?? {},
    argsHash: hashCanonical(args ?? call.args ?? null),
    pendingArgs: decision.decision === "REVIEW" ? args : null,
    decision: decision.decision,
    reasons: decision.reasons,
    matchedRuleIds: decision.matchedRuleIds,
    riskScore: decision.riskScore,
    policyId: decision.policyId,
    policyVersion: decision.policyVersion,
    provenance: snapshot,
    // ALLOW starts as "failed" and is flipped to "executed" only inside the execution transaction;
    // in decision-only mode (no runner) it is "allowed" until the host reports the result.
    status: decision.decision === "ALLOW" ? (deps.runner ? "failed" : "allowed") : status,
    rationale: call.rationale?.slice(0, 1000) ?? null,
    evalLatencyMs,
  });
  await writeAudit(db, {
    type: "tool_call.evaluated",
    appId: state.appId,
    severity: SEVERITY[decision.decision],
    sessionId: state.id,
    toolCallId,
    actorId: call.agentId,
    decision: decision.decision,
    reasonCodes: [...new Set(decision.reasons.map((r) => r.code))],
    payload: {
      tool: call.tool,
      args: argsForAudit,
      matchedRuleIds: decision.matchedRuleIds,
      policyVersion: decision.policyVersion,
      riskScore: decision.riskScore,
      destination: snapshot.destination,
      dataSensitivity: snapshot.dataSensitivity,
      signals: snapshot.signals,
      delegatedFrom: snapshot.delegatedFrom,
    },
  });

  const result: EnforcementResult = { toolCallId, tool: call.tool, decision, status, provenance: snapshot, evalLatencyMs, totalLatencyMs: 0 };

  if (decision.decision === "ALLOW" && args && tool && !deps.runner) {
    Object.assign(result, await authorizeForHost(deps, state, call, toolCallId, args));
  } else if (decision.decision === "ALLOW" && args && tool) {
    const exec = await runExecution(deps, {
      appId: state.appId,
      sessionId: state.id,
      toolCallId,
      tool: call.tool,
      args,
      idempotencyKey: `auto:${toolCallId}`,
      approvalId: null,
      actorId: call.agentId,
    });
    result.status = exec.ok ? "executed" : "failed";
    result.output = exec.output;
    result.execSummary = exec.summary;
    if (exec.ok) await ingestOutput(db, state, toolCallId, call.tool, exec);
  } else if (decision.decision === "REVIEW" && args && policy) {
    Object.assign(result, await requestApproval(deps, state, call, toolCallId, args, policy));
  }

  result.totalLatencyMs = performance.now() - t0;
  return result;
}

/**
 * Decision-only mode: the host app executes. Mark the call "allowed" (it becomes "executed"
 * when the host reports the result) and hand out a single-use token bound to the arguments.
 */
async function authorizeForHost(
  deps: EnforcementDeps,
  state: SessionState,
  call: ProposedToolCall,
  toolCallId: string,
  args: Record<string, unknown>,
) {
  return deps.db.transaction(async (raw) => {
    const tx = raw as unknown as DB;
    const token = await deps.tokens?.issue(tx, { appId: state.appId, agentId: call.agentId, toolCallId, tool: call.tool, args });
    await writeAudit(tx, {
      type: "tool_call.allowed",
      appId: state.appId,
      sessionId: state.id,
      toolCallId,
      actorId: call.agentId,
      decision: "ALLOW",
      payload: { tool: call.tool, tokenExpiresAt: token?.expiresAt.toISOString() },
    });
    return {
      status: "allowed" as const,
      decisionToken: token?.token,
      decisionTokenExpiresAt: token?.expiresAt.toISOString(),
    };
  });
}

/** Create a pending approval whose hash binds the exact call to the current policy version. */
async function requestApproval(
  deps: EnforcementDeps,
  state: SessionState,
  call: ProposedToolCall,
  toolCallId: string,
  args: Record<string, unknown>,
  policy: PolicyRef,
) {
  const { db } = deps;
  const expiresAt = new Date(deps.clock.now().getTime() + policy.document.approvalTtlSeconds * 1000);
  const approvalId = newId("apr");
  await db.insert(s.approvals).values({
    id: approvalId,
    appId: state.appId,
    toolCallId,
    sessionId: state.id,
    requestedFor: state.userId,
    bindingHash: computeBindingHash({
      toolCallId,
      sessionId: state.id,
      userId: state.userId,
      agentId: call.agentId,
      tool: call.tool,
      args,
      policyId: policy.policyId,
      policyVersion: policy.version,
    }),
    policyId: policy.policyId,
    policyVersion: policy.version,
    status: "pending",
    expiresAt,
  });
  await writeAudit(db, {
    type: "approval.requested",
    appId: state.appId,
    severity: "warning",
    sessionId: state.id,
    toolCallId,
    actorId: call.agentId,
    decision: "REVIEW",
    payload: { approvalId, expiresAt: expiresAt.toISOString(), tool: call.tool },
  });
  await db.update(s.agentSessions).set({ status: "awaiting_approval" }).where(eq(s.agentSessions.id, state.id));
  return { approvalId, approvalExpiresAt: expiresAt.toISOString() };
}
