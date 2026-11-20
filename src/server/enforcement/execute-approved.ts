import { and, eq } from "drizzle-orm";
import { computeBindingHash } from "@/server/core/approval-binding";
import { hashCanonical } from "@/server/core/canonical";
import type { PolicyRef } from "@/server/core/policy-schema";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { writeAudit } from "./audit";
import { runExecution } from "./execution";
import type { EnforcementDeps } from "./ports";
import type { ApprovalConsumeOutcome, ApprovalDenyCode, ApprovalExecutionOutcome, ExecResult } from "./types";

export interface ExecuteApprovedParams {
  approvalId: string;
  /** A user id, or `app:<keyId>` when an integrated app consumes with its API key. */
  actorId: string;
  idempotencyKey: string;
  args?: unknown;
}

type Ctx = { appId?: string; sessionId?: string; toolCallId?: string };
type Denial = Ctx & { kind: "deny"; code: ApprovalDenyCode; message: string };
type Claimed = {
  kind: "claimed";
  apr: typeof s.approvals.$inferSelect;
  tc: typeof s.toolCalls.$inferSelect;
  args: Record<string, unknown>;
};

const denial = (code: ApprovalDenyCode, message: string, ctx: Ctx = {}): Denial => ({ kind: "deny", code, message, ...ctx });

/** Audit a refused execution/consumption and return the public error shape. */
async function deny(deps: EnforcementDeps, params: ExecuteApprovedParams, d: Omit<Denial, "kind">) {
  await writeAudit(deps.db, {
    type: "approval.execution_denied",
    appId: d.appId,
    severity: "critical",
    sessionId: d.sessionId,
    toolCallId: d.toolCallId,
    actorId: params.actorId,
    decision: "BLOCK",
    reasonCodes: [d.code],
    payload: { approvalId: params.approvalId, message: d.message },
  });
  return { ok: false as const, code: d.code, message: d.message };
}

/** Unique-constraint violations mean a concurrent duplicate; anything else rolled back for another reason. */
function rolledBack(err: unknown): Omit<Denial, "kind"> {
  const msg = (err as Error).message;
  const dup = /duplicate key|unique/i.test(msg + String((err as { cause?: unknown }).cause ?? ""));
  return dup
    ? { code: "APPROVAL_ALREADY_USED", message: `Duplicate execution prevented: ${msg}` }
    : { code: "EXECUTION_CONFLICT", message: `Execution failed and was rolled back: ${msg}` };
}

/**
 * Inside a transaction holding a row lock on the approval:
 *  - approval exists (in this tenant), status = approved, not expired
 *  - caller is the session owner, an approver, or the owning app's API key
 *  - optional caller-supplied args equal the approved args (no post-approval edits)
 *  - binding hash recomputed from stored args + CURRENT active policy version matches
 * then claims it (approved → `claimStatus`). A denial still commits expiry/invalidation updates.
 */
async function verifyAndClaim(
  deps: EnforcementDeps,
  tx: DB,
  params: ExecuteApprovedParams,
  claimStatus: "executed" | "consumed",
): Promise<Denial | Claimed> {
  const [apr] = await tx.select().from(s.approvals).where(eq(s.approvals.id, params.approvalId)).for("update").limit(1);
  if (!apr || (deps.appId && apr.appId !== deps.appId)) return denial("APPROVAL_NOT_FOUND", "Approval not found.");
  const ctx = { appId: apr.appId, sessionId: apr.sessionId, toolCallId: apr.toolCallId };
  const no = (code: ApprovalDenyCode, message: string) => denial(code, message, ctx);
  const retire = async (status: "expired" | "invalidated") => {
    await tx.update(s.approvals).set({ status }).where(eq(s.approvals.id, apr.id));
    await tx.update(s.toolCalls).set({ status: "expired", pendingArgs: null }).where(eq(s.toolCalls.id, apr.toolCallId));
  };

  const [tc] = await tx.select().from(s.toolCalls).where(eq(s.toolCalls.id, apr.toolCallId)).limit(1);
  if (!tc) return no("APPROVAL_NOT_FOUND", "Tool call missing.");
  const asApp = params.actorId.startsWith("app:");
  if (!asApp) {
    const [actor] = await tx.select().from(s.users).where(eq(s.users.id, params.actorId)).limit(1);
    if (!actor || (actor.id !== apr.requestedFor && actor.role === "member")) return no("NOT_AUTHORIZED", "Caller may not execute this approval.");
  } else if (!deps.appId) return no("NOT_AUTHORIZED", "App credentials require a tenant-scoped enforcement point.");
  if (apr.status === "executed" || apr.status === "consumed" || tc.status === "executed")
    return no("APPROVAL_ALREADY_USED", "Approval was already used (replay).");
  if (apr.status !== "approved") return no("APPROVAL_NOT_APPROVED", `Approval status is ${apr.status}.`);
  if (deps.clock.now().getTime() > apr.expiresAt.getTime()) {
    await retire("expired");
    return no("APPROVAL_EXPIRED", "Approval expired.");
  }
  const stored = tc.pendingArgs as Record<string, unknown> | null;
  if (!stored) return no("ARGS_TAMPERED", "Approved arguments are missing.");
  if (params.args !== undefined && hashCanonical(params.args) !== hashCanonical(stored))
    return no("ARGS_MISMATCH", "Arguments differ from what was approved; approval does not cover them.");

  let current: PolicyRef;
  try {
    current = await deps.resolvePolicy(apr.policyId, tx);
  } catch {
    return no("POLICY_CHANGED", "Bound policy is no longer available.");
  }
  if (current.version !== apr.policyVersion) {
    await retire("invalidated");
    return no("POLICY_CHANGED", `Policy changed from v${apr.policyVersion} to v${current.version} while pending; re-request approval.`);
  }
  const recomputed = computeBindingHash({
    toolCallId: tc.id,
    sessionId: tc.sessionId,
    userId: tc.userId,
    agentId: tc.agentId,
    tool: tc.tool,
    args: stored,
    policyId: current.policyId,
    policyVersion: current.version,
  });
  if (recomputed !== apr.bindingHash) return no("ARGS_TAMPERED", "Binding hash mismatch: action changed after approval.");

  // Claim atomically while the row is locked.
  const claimed = await tx
    .update(s.approvals)
    .set({ status: claimStatus })
    .where(and(eq(s.approvals.id, apr.id), eq(s.approvals.status, "approved")))
    .returning({ id: s.approvals.id });
  if (claimed.length !== 1) return no("APPROVAL_ALREADY_USED", "Approval was claimed concurrently.");
  return { kind: "claimed", apr, tc, args: stored };
}

/**
 * Use case: execute an APPROVED action exactly once (built-in runner).
 * Claim + side effect + uniquely-keyed execution record share ONE transaction, so a failure
 * rolls back the claim too (no "used but never ran" state). Retrying with the SAME
 * idempotency key returns the original result without re-executing.
 */
export async function executeApproved(deps: EnforcementDeps, params: ExecuteApprovedParams): Promise<ApprovalExecutionOutcome> {
  const { db } = deps;
  const [prior] = await db.select().from(s.executions).where(eq(s.executions.idempotencyKey, params.idempotencyKey)).limit(1);
  if (prior) {
    if (prior.approvalId !== params.approvalId)
      return deny(deps, params, { code: "IDEMPOTENCY_KEY_REUSED", message: "Idempotency key belongs to a different action." });
    return { ok: true, replayed: true, toolCallId: prior.toolCallId, summary: prior.resultSummary as Record<string, unknown> };
  }

  let out: Denial | { kind: "go"; toolCallId: string; exec: ExecResult };
  try {
    out = await db.transaction(async (raw) => {
      const tx = raw as unknown as DB;
      const c = await verifyAndClaim(deps, tx, params, "executed");
      if (c.kind === "deny") return c;
      const { apr, tc, args } = c;
      const exec = await runExecution(
        deps,
        {
          appId: apr.appId,
          sessionId: tc.sessionId,
          toolCallId: tc.id,
          tool: tc.tool,
          args,
          idempotencyKey: params.idempotencyKey,
          approvalId: params.approvalId,
          actorId: params.actorId,
        },
        tx,
      );
      await writeAudit(tx, {
        type: "approval.executed",
        appId: apr.appId,
        sessionId: tc.sessionId,
        toolCallId: tc.id,
        actorId: params.actorId,
        decision: "ALLOW",
        payload: { approvalId: params.approvalId },
      });
      return { kind: "go" as const, toolCallId: tc.id, exec };
    });
  } catch (err) {
    return deny(deps, params, rolledBack(err));
  }
  if (out.kind === "deny") return deny(deps, params, out);
  const { exec } = out;
  return { ok: true, replayed: false, toolCallId: out.toolCallId, summary: exec.summary, output: exec.output, exec };
}

/**
 * Use case (decision-only mode): turn an APPROVED action into a single-use decision token for
 * the host app, which then executes the call itself and reports the result. Same checks and
 * atomic claim as `executeApproved`; the token is bound to the approved arguments.
 */
export async function consumeApproved(deps: EnforcementDeps, params: ExecuteApprovedParams): Promise<ApprovalConsumeOutcome> {
  let out: Denial | { kind: "go"; toolCallId: string; token?: { token: string; expiresAt: Date } };
  try {
    out = await deps.db.transaction(async (raw) => {
      const tx = raw as unknown as DB;
      const c = await verifyAndClaim(deps, tx, params, "consumed");
      if (c.kind === "deny") return c;
      const { apr, tc, args } = c;
      await tx.update(s.toolCalls).set({ status: "allowed", pendingArgs: null }).where(eq(s.toolCalls.id, tc.id));
      const token = await deps.tokens?.issue(tx, { appId: apr.appId, agentId: tc.agentId, toolCallId: tc.id, tool: tc.tool, args });
      await writeAudit(tx, {
        type: "approval.consumed",
        appId: apr.appId,
        sessionId: tc.sessionId,
        toolCallId: tc.id,
        actorId: params.actorId,
        decision: "ALLOW",
        payload: { approvalId: params.approvalId, tokenExpiresAt: token?.expiresAt.toISOString() },
      });
      return { kind: "go" as const, toolCallId: tc.id, token };
    });
  } catch (err) {
    return deny(deps, params, rolledBack(err));
  }
  if (out.kind === "deny") return deny(deps, params, out);
  return { ok: true, toolCallId: out.toolCallId, decisionToken: out.token?.token, expiresAt: out.token?.expiresAt.toISOString() };
}
