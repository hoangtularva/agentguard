import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { json, parseBody, sameOrigin } from "@/server/http";
import { IDENTITY_COOKIE, demoAuthEnabled, encodeIdentity } from "@/server/identity";

export const runtime = "nodejs";

/**
 * DEMO sign-in / identity switch. Not an authentication mechanism.
 * Disabled unless CALLWRIT_DEMO_AUTH is on (default on outside production). See src/server/identity.ts.
 */
const Body = z.object({ userId: z.string().min(1).max(40) });

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "forbidden_origin" }, 403);
  if (!demoAuthEnabled()) return json({ error: "demo_auth_disabled", message: "Demo identities are disabled on this server." }, 403);
  const body = await parseBody(req, Body);
  if (!body.ok) return body.res;
  const [user] = await (await getDb()).select().from(s.users).where(eq(s.users.id, body.data.userId)).limit(1);
  if (!user) return json({ error: "unknown_user" }, 404);
  const res = json({ ok: true, user: { id: user.id, name: user.name, role: user.role } });
  const https = (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")) === "https";
  res.cookies.set(IDENTITY_COOKIE, encodeIdentity(user.id), { httpOnly: true, sameSite: "lax", path: "/", secure: https, maxAge: 8 * 3600 });
  return res;
}

/** Sign out. */
export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return json({ error: "forbidden_origin" }, 403);
  const res = json({ ok: true });
  res.cookies.set(IDENTITY_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
