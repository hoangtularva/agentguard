import { requireUser } from "@/server/app-context";
import { getDb } from "@/server/db/client";
import { json, sameOrigin } from "@/server/http";
import { revokeApiKey } from "@/server/integration/apps";

export const runtime = "nodejs";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; keyId: string }> }) {
  if (!sameOrigin(req)) return json({ error: "forbidden_origin" }, 403);
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  if (auth.user.role === "member") return json({ error: "forbidden", message: "Only approvers or admins manage API keys." }, 403);
  const { id, keyId } = await ctx.params;
  const ok = await revokeApiKey(await getDb(), id, keyId, auth.user.id);
  return ok ? json({ ok: true }) : json({ error: "not_found" }, 404);
}
