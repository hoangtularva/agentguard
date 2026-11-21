import { z } from "zod";
import { requireUser } from "@/server/app-context";
import { getDb } from "@/server/db/client";
import { eq } from "drizzle-orm";
import * as s from "@/server/db/schema";
import { decideApproval } from "@/server/enforcement/approvals";
import { notifyLater } from "@/server/integration/webhooks";
import { json, parseBody, sameOrigin } from "@/server/http";

export const runtime = "nodejs";

const Body = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().max(500).optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return json({ error: "forbidden_origin" }, 403);
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  const { id } = await ctx.params;
  const body = await parseBody(req, Body);
  if (!body.ok) return body.res;
  const user = auth.user;
  const db = await getDb();
  const r = await decideApproval(db, { approvalId: id, actorId: user.id, ...body.data });
  if (r.ok) {
    // External apps may be waiting: tell them (only if the operator configured a webhook).
    const [a] = await db
      .select({ appId: s.approvals.appId, callId: s.approvals.toolCallId, tool: s.toolCalls.tool, expiresAt: s.approvals.expiresAt })
      .from(s.approvals)
      .innerJoin(s.toolCalls, eq(s.toolCalls.id, s.approvals.toolCallId))
      .where(eq(s.approvals.id, id))
      .limit(1);
    if (a && a.appId !== "demo")
      notifyLater(db, { type: "approval.decided", app: a.appId, approvalId: id, callId: a.callId, tool: a.tool, status: r.status, expiresAt: a.expiresAt.toISOString() });
  }
  return json(r, r.ok ? 200 : r.code === "NOT_AUTHORIZED" ? 403 : 409);
}
