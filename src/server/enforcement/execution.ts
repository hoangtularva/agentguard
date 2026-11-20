import { eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { writeAudit } from "./audit";
import { newId } from "./ids";
import type { EnforcementDeps } from "./ports";
import type { ExecResult } from "./types";

export interface ExecutionRequest {
  sessionId: string;
  toolCallId: string;
  tool: string;
  args: Record<string, unknown>;
  idempotencyKey: string;
  approvalId: string | null;
  actorId: string;
}

/**
 * Run a tool's side effect and record it under a unique idempotency key. When `outerTx`
 * is given the execution joins it, so that claim + side effects + execution record commit
 * or roll back together.
 */
export async function runExecution(deps: EnforcementDeps, req: ExecutionRequest, outerTx?: DB): Promise<ExecResult> {
  const { runner } = deps;
  if (!runner) throw new Error(`No tool runner configured (decision-only mode) for ${req.tool}`);
  const { sessionId, toolCallId, tool, approvalId, idempotencyKey, actorId } = req;
  const body = async (tx: DB) => {
    const exec = await runner.run(tool, req.args, {
      sessionId,
      toolCallId,
      recordEffect: async (e) => {
        await tx.insert(s.sandboxEffects).values({ id: newId("fx"), sessionId, toolCallId, ...e });
      },
    });
    await tx.insert(s.executions).values({
      id: newId("ex"),
      toolCallId,
      idempotencyKey,
      approvalId,
      ok: exec.ok,
      resultSummary: exec.summary,
    });
    await tx
      .update(s.toolCalls)
      .set({ status: exec.ok ? "executed" : "failed", pendingArgs: null })
      .where(eq(s.toolCalls.id, toolCallId));
    await writeAudit(tx, {
      type: exec.ok ? "tool_call.executed" : "tool_call.failed",
      severity: exec.ok ? "info" : "warning",
      sessionId,
      toolCallId,
      actorId,
      payload: { tool, summary: exec.summary, approvalId, idempotencyKey },
    });
    return exec;
  };
  return outerTx ? body(outerTx) : deps.db.transaction(async (tx) => body(tx as unknown as DB));
}
