import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { json } from "@/server/http";
import { ed25519For, tokenAlgOf } from "@/server/integration/apps";

export const runtime = "nodejs";

/** Public verification key of an app's Ed25519 decision tokens (no auth: it is a public key). */
export async function GET(_req: Request, ctx: { params: Promise<{ appId: string }> }) {
  const { appId } = await ctx.params;
  const [app] = await (await getDb()).select().from(s.apps).where(eq(s.apps.id, appId)).limit(1);
  if (!app || app.id === "demo") return json({ error: "not_found" }, 404);
  return json({ app: app.id, kid: `${app.id}:${app.tokenKeyVersion}`, alg: "Ed25519", publicKey: ed25519For(app).publicKey, issuing: tokenAlgOf(app) });
}
