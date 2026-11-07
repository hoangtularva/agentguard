import { eq } from "drizzle-orm";
import { z } from "zod";
import { getAppPep, getCurrentUser } from "@/server/app-context";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { json, parseBody, sameOrigin } from "@/server/http";

export const runtime = "nodejs";

/**
 * Execute an approved action. The client sends NO arguments by default — the server
 * executes exactly what was approved. `args` is accepted only so tampering attempts
 * are detected and audited (ARGS_MISMATCH), never to change the action.
 */
const Body = z.object({
  idempotencyKey: z.string().min(8).max(100),
  args: z.unknown().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return json({ error: "forbidden_origin" }, 403);
  const { id } = await ctx.params;
  const body = await parseBody(req, Body);
  if (!body.ok) return body.res;
  const user = await getCurrentUser();
  const pep = await getAppPep();
  const r = await pep.executeApprovedAction({ approvalId: id, actorId: user.id, ...body.data });
  if (r.ok && !r.replayed) {
    const db = await getDb();
    const [apr] = await db.select().from(s.approvals).where(eq(s.approvals.id, id)).limit(1);
    if (apr)
      await db
        .update(s.agentSessions)
        .set({ status: "completed", finalMessage: `Approved action executed: ${r.output ?? "done"}` })
        .where(eq(s.agentSessions.id, apr.sessionId));
  }
  if (!r.ok) return json(r, r.code === "NOT_AUTHORIZED" ? 403 : 409);
  return json({ ok: true, replayed: r.replayed, toolCallId: r.toolCallId, summary: r.summary, output: r.output });
}
