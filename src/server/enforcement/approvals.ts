import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { writeAudit } from "./audit";

export type DecideCode = "APPROVAL_NOT_FOUND" | "NOT_AUTHORIZED" | "NOT_PENDING" | "APPROVAL_EXPIRED";

/**
 * Record a human decision on a pending approval. Deciding does NOT execute;
 * execution is a separate, binding-verified step in the PEP.
 * Who may decide: the user the action is performed for, or an approver/admin.
 */
export async function decideApproval(
  db: DB,
  params: { approvalId: string; actorId: string; decision: "approve" | "reject"; note?: string; now?: Date },
): Promise<{ ok: true; status: "approved" | "rejected" } | { ok: false; code: DecideCode; message: string }> {
  const now = params.now ?? new Date();
  const result = await db.transaction(async (tx) => {
    const [apr] = await tx.select().from(s.approvals).where(eq(s.approvals.id, params.approvalId)).for("update").limit(1);
    if (!apr) return { ok: false as const, code: "APPROVAL_NOT_FOUND" as const, message: "Approval not found." };
    const [actor] = await tx.select().from(s.users).where(eq(s.users.id, params.actorId)).limit(1);
    if (!actor || (actor.id !== apr.requestedFor && actor.role === "member"))
      return { ok: false as const, code: "NOT_AUTHORIZED" as const, message: "You may not decide on this approval.", apr };
    if (apr.status !== "pending")
      return { ok: false as const, code: "NOT_PENDING" as const, message: `Approval is ${apr.status}.`, apr };
    if (now.getTime() > apr.expiresAt.getTime()) {
      await tx.update(s.approvals).set({ status: "expired" }).where(eq(s.approvals.id, apr.id));
      await tx.update(s.toolCalls).set({ status: "expired", pendingArgs: null }).where(eq(s.toolCalls.id, apr.toolCallId));
      return { ok: false as const, code: "APPROVAL_EXPIRED" as const, message: "Approval expired.", apr };
    }
    const status = params.decision === "approve" ? ("approved" as const) : ("rejected" as const);
    await tx
      .update(s.approvals)
      .set({ status, decidedBy: actor.id, decidedAt: now, decisionNote: params.note?.slice(0, 500) ?? null })
      .where(and(eq(s.approvals.id, apr.id), eq(s.approvals.status, "pending")));
    if (status === "rejected") {
      await tx.update(s.toolCalls).set({ status: "rejected", pendingArgs: null }).where(eq(s.toolCalls.id, apr.toolCallId));
      const open = await tx
        .select({ id: s.approvals.id })
        .from(s.approvals)
        .where(and(eq(s.approvals.sessionId, apr.sessionId), inArray(s.approvals.status, ["pending", "approved"])));
      if (open.every((o) => o.id === apr.id))
        await tx.update(s.agentSessions).set({ status: "completed" }).where(eq(s.agentSessions.id, apr.sessionId));
    }
    await writeAudit(tx, {
      type: status === "approved" ? "approval.approved" : "approval.rejected",
      severity: "warning",
      appId: apr.appId,
      sessionId: apr.sessionId,
      toolCallId: apr.toolCallId,
      actorId: actor.id,
      decision: status === "approved" ? "ALLOW" : "BLOCK",
      payload: { approvalId: apr.id, note: params.note ?? "" },
    });
    return { ok: true as const, status };
  });
  if (!result.ok) {
    await writeAudit(db, {
      type: "approval.execution_denied",
      severity: "warning",
      actorId: params.actorId,
      appId: "apr" in result && result.apr ? result.apr.appId : undefined,
      sessionId: "apr" in result && result.apr ? result.apr.sessionId : null,
      toolCallId: "apr" in result && result.apr ? result.apr.toolCallId : null,
      reasonCodes: [result.code],
      payload: { approvalId: params.approvalId, stage: "decide", message: result.message },
    });
    return { ok: false, code: result.code, message: result.message };
  }
  return result;
}
