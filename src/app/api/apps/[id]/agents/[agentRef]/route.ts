import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/server/app-context";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { writeAudit } from "@/server/enforcement/audit";
import { json, parseBody, sameOrigin } from "@/server/http";
import { agentKey } from "@/server/integration/apps";

export const runtime = "nodejs";

const Body = z.object({ active: z.boolean() });

/** Kill switch: a frozen agent fails identity verification, so every check it makes is BLOCKed. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; agentRef: string }> }) {
  if (!sameOrigin(req)) return json({ error: "forbidden_origin" }, 403);
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  if (auth.user.role === "member") return json({ error: "forbidden", message: "Only approvers or admins can freeze agents." }, 403);
  const { id, agentRef } = await ctx.params;
  const body = await parseBody(req, Body);
  if (!body.ok) return body.res;
  const db = await getDb();
  const rows = await db
    .update(s.agents)
    .set({ active: body.data.active })
    .where(and(eq(s.agents.id, agentKey(id, agentRef)), eq(s.agents.appId, id)))
    .returning({ id: s.agents.id });
  if (rows.length === 0) return json({ error: "not_found" }, 404);
  await writeAudit(db, {
    type: "agent.saved",
    appId: id,
    severity: body.data.active ? "info" : "critical",
    actorId: auth.user.id,
    payload: { agentId: agentRef, active: body.data.active, via: "kill-switch" },
  });
  return json({ agentId: agentRef, active: body.data.active });
}
