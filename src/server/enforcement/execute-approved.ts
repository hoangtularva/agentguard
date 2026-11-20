import { and, eq } from "drizzle-orm";
import { computeBindingHash } from "@/server/core/approval-binding";
import { hashCanonical } from "@/server/core/canonical";
import type { PolicyRef } from "@/server/core/policy-schema";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { writeAudit } from "./audit";
import { runExecution } from "./execution";
import type { EnforcementDeps } from "./ports";
import type { ApprovalDenyCode, ApprovalExecutionOutcome, ExecResult } from "./types";

export interface ExecuteApprovedParams {
  approvalId: string;
  actorId: string;
  idempotencyKey: string;
  args?: unknown;
}

type Denial = { kind: "deny"; code: ApprovalDenyCode; message: string; sessionId?: string; toolCallId?: string };
type Prepared = Denial | { kind: "go"; sessionId: string; toolCallId: string; tool: string; exec: ExecResult };

/**
 * Use case: execute an APPROVED action exactly once.
 * Checks (all inside one transaction holding a row lock on the approval):
 *  - approval exists, status = approved, not expired
 *  - caller is the session owner or an approver
 *  - optional caller-supplied args equal the approved args (no post-approval edits)
 *  - binding hash recomputed from stored args + CURRENT active policy version matches
 *  - no prior execution (unique tool_call_id + idempotency key)
 * Retrying with the SAME idempotency key returns the original result without re-executing.
 */
export async function executeApproved(deps: EnforcementDeps, params: ExecuteApprovedParams): Promise<ApprovalExecutionOutcome> {
  const { db } = deps;
  const deny = async (code: ApprovalDenyCode, message: string, sessionId?: string, toolCallId?: string) => {
    await writeAudit(db, {
      type: "approval.execution_denied",
      severity: "critical",
      sessionId,
      toolCallId,
      actorId: params.actorId,
      decision: "BLOCK",
      reasonCodes: [code],
      payload: { approvalId: params.approvalId, message },
    });
    return { ok: false as const, code, message };
  };

  // Idempotent retry: same key already executed -> return stored result, no side effect.
  const [prior] = await db.select().from(s.executions).where(eq(s.executions.idempotencyKey, params.idempotencyKey)).limit(1);
  if (prior) {
    if (prior.approvalId !== params.approvalId) return deny("IDEMPOTENCY_KEY_REUSED", "Idempotency key belongs to a different action.");
    return { ok: true, replayed: true, toolCallId: prior.toolCallId, summary: prior.resultSummary as Record<string, unknown> };
  }

  let prepared: Prepared;
  try {
    prepared = await db.transaction((tx) => claimAndExecute(deps, tx as unknown as DB, params));
  } catch (err) {
    // Unique constraint on executions(tool_call_id | idempotency_key), serialization or
    // connection failure: the whole transaction (claim + effects) was rolled back.
    const msg = (err as Error).message;
    const dup = /duplicate key|unique/i.test(msg + String((err as { cause?: unknown }).cause ?? ""));
    return deny(
      dup ? "APPROVAL_ALREADY_USED" : "EXECUTION_CONFLICT",
      `${dup ? "Duplicate execution prevented" : "Execution failed and was rolled back"}: ${msg}`,
    );
  }

  if (prepared.kind === "deny") return deny(prepared.code, prepared.message, prepared.sessionId, prepared.toolCallId);
  const { exec } = prepared;
  return { ok: true, replayed: false, toolCallId: prepared.toolCallId, summary: exec.summary, output: exec.output, exec };
}

/** Runs inside the transaction: lock → verify → claim → execute. Returning a denial still commits status updates. */
async function claimAndExecute(deps: EnforcementDeps, tx: DB, params: ExecuteApprovedParams): Promise<Prepared> {
  const [apr] = await tx.select().from(s.approvals).where(eq(s.approvals.id, params.approvalId)).for("update").limit(1);
  if (!apr) return { kind: "deny", code: "APPROVAL_NOT_FOUND", message: "Approval not found." };
  const ctx = { sessionId: apr.sessionId, toolCallId: apr.toolCallId };
  const no = (code: ApprovalDenyCode, message: string): Denial => ({ kind: "deny", code, message, ...ctx });
  const retire = async (status: "expired" | "invalidated") => {
    await tx.update(s.approvals).set({ status }).where(eq(s.approvals.id, apr.id));
    await tx.update(s.toolCalls).set({ status: "expired", pendingArgs: null }).where(eq(s.toolCalls.id, apr.toolCallId));
  };

  const [tc] = await tx.select().from(s.toolCalls).where(eq(s.toolCalls.id, apr.toolCallId)).limit(1);
  const [actor] = await tx.select().from(s.users).where(eq(s.users.id, params.actorId)).limit(1);
  if (!tc) return no("APPROVAL_NOT_FOUND", "Tool call missing.");
  if (!actor || (actor.id !== apr.requestedFor && actor.role === "member"))
    return no("NOT_AUTHORIZED", "Caller may not execute this approval.");
  if (apr.status === "executed" || tc.status === "executed") return no("APPROVAL_ALREADY_USED", "Approval was already used (replay).");
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

  // Claim the approval atomically while the row is locked.
  const claimed = await tx
    .update(s.approvals)
    .set({ status: "executed" })
    .where(and(eq(s.approvals.id, apr.id), eq(s.approvals.status, "approved")))
    .returning({ id: s.approvals.id });
  if (claimed.length !== 1) return no("APPROVAL_ALREADY_USED", "Approval was claimed concurrently.");

  // Execute in the SAME transaction: if the side effect or the uniquely-keyed execution
  // record fails, the claim rolls back too (no "used but never ran" state).
  const exec = await runExecution(
    deps,
    {
      sessionId: tc.sessionId,
      toolCallId: tc.id,
      tool: tc.tool,
      args: stored,
      idempotencyKey: params.idempotencyKey,
      approvalId: params.approvalId,
      actorId: params.actorId,
    },
    tx,
  );
  await writeAudit(tx, {
    type: "approval.executed",
    sessionId: tc.sessionId,
    toolCallId: tc.id,
    actorId: params.actorId,
    decision: "ALLOW",
    payload: { approvalId: params.approvalId },
  });
  return { kind: "go", ...ctx, tool: tc.tool, exec };
}
