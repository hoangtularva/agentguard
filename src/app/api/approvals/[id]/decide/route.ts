import { z } from "zod";
import { getCurrentUser } from "@/server/app-context";
import { getDb } from "@/server/db/client";
import { decideApproval } from "@/server/enforcement/approvals";
import { json, parseBody, sameOrigin } from "@/server/http";

export const runtime = "nodejs";

const Body = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().max(500).optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return json({ error: "forbidden_origin" }, 403);
  const { id } = await ctx.params;
  const body = await parseBody(req, Body);
  if (!body.ok) return body.res;
  const user = await getCurrentUser();
  const r = await decideApproval(await getDb(), { approvalId: id, actorId: user.id, ...body.data });
  return json(r, r.ok ? 200 : r.code === "NOT_AUTHORIZED" ? 403 : 409);
}
