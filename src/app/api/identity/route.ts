import { eq } from "drizzle-orm";
import { z } from "zod";
import { IDENTITY_COOKIE, encodeIdentity } from "@/server/app-context";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { json, parseBody, sameOrigin } from "@/server/http";

export const runtime = "nodejs";

/** DEMO-ONLY identity switcher (see app-context.ts). Not an authentication mechanism. */
const Body = z.object({ userId: z.string().min(1).max(40) });

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "forbidden_origin" }, 403);
  const body = await parseBody(req, Body);
  if (!body.ok) return body.res;
  const [user] = await (await getDb()).select().from(s.users).where(eq(s.users.id, body.data.userId)).limit(1);
  if (!user) return json({ error: "unknown_user" }, 404);
  const res = json({ ok: true, user: { id: user.id, name: user.name, role: user.role } });
  res.cookies.set(IDENTITY_COOKIE, encodeIdentity(user.id), { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
  return res;
}
