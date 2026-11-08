import "server-only";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import type { Corpus } from "@/server/core/types";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { dbPolicyResolver } from "@/server/enforcement/policy-store";
import { EnforcementPoint } from "@/server/enforcement/pep";
import { json } from "@/server/http";
import { IDENTITY_COOKIE, decodeIdentity, encodeIdentity } from "@/server/identity";

export { IDENTITY_COOKIE, encodeIdentity };

export type CurrentUser = typeof s.users.$inferSelect;

/** The signed-in demo user, or null. There is deliberately no default identity. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const id = decodeIdentity((await cookies()).get(IDENTITY_COOKIE)?.value);
  if (!id) return null;
  const db = await getDb();
  const [user] = await db.select().from(s.users).where(eq(s.users.id, id)).limit(1);
  return user ?? null;
}

/** For API routes: the current user, or a 401 response. */
export async function requireUser(): Promise<{ ok: true; user: CurrentUser } | { ok: false; res: NextResponse }> {
  const user = await getCurrentUser();
  return user ? { ok: true, user } : { ok: false, res: json({ error: "unauthenticated", message: "Sign in first (demo identity)." }, 401) };
}

export async function loadCorpus(): Promise<Corpus> {
  const db = await getDb();
  const rows = await db.select().from(s.corpus);
  return new Map(rows.map((r) => [r.id, r]));
}

export async function getAppPep(): Promise<EnforcementPoint> {
  const db = await getDb();
  return new EnforcementPoint(db, { corpus: await loadCorpus(), resolvePolicy: dbPolicyResolver(db) });
}
