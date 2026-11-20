import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/server/app-context";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { json, parseBody, sameOrigin } from "@/server/http";
import { API_SCOPES, createApiKey } from "@/server/integration/apps";

export const runtime = "nodejs";

const Body = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(z.enum(API_SCOPES)).min(1),
  agentRef: z.string().regex(/^[A-Za-z0-9_.:@-]{1,128}$/).optional(),
});

/** Create an API key. The plaintext is in this response only; the server keeps its SHA-256. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return json({ error: "forbidden_origin" }, 403);
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  if (auth.user.role === "member") return json({ error: "forbidden", message: "Only approvers or admins manage API keys." }, 403);
  const { id } = await ctx.params;
  const body = await parseBody(req, Body);
  if (!body.ok) return body.res;
  const db = await getDb();
  const [app] = await db.select().from(s.apps).where(eq(s.apps.id, id));
  if (!app || app.id === "demo") return json({ error: "not_found" }, 404);
  const k = await createApiKey(db, { appId: id, ...body.data, createdBy: auth.user.id });
  return json(k, 201);
}
