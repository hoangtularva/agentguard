import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import type { Corpus } from "@/server/core/types";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { dbPolicyResolver } from "@/server/enforcement/policy-store";
import { EnforcementPoint } from "@/server/enforcement/pep";

/**
 * DEMO IDENTITY — not authentication.
 * The current user is read from an HMAC-signed cookie so the server (never the
 * client body) decides who is acting. A real deployment replaces this with SSO/OIDC.
 */
const COOKIE = "ag_uid";
const g = globalThis as unknown as { __agSecret?: string };
function secret(): string {
  if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16) return process.env.AUTH_SECRET;
  g.__agSecret ??= randomBytes(32).toString("hex"); // dev fallback: sessions reset on restart
  return g.__agSecret;
}
function sign(v: string) {
  return createHmac("sha256", secret()).update(v).digest("hex").slice(0, 32);
}
export function encodeIdentity(userId: string) {
  return `${userId}.${sign(userId)}`;
}
function decodeIdentity(raw: string | undefined): string | null {
  if (!raw) return null;
  const i = raw.lastIndexOf(".");
  if (i <= 0) return null;
  const id = raw.slice(0, i);
  const mac = Buffer.from(raw.slice(i + 1));
  const want = Buffer.from(sign(id));
  return mac.length === want.length && timingSafeEqual(mac, want) ? id : null;
}

export const IDENTITY_COOKIE = COOKIE;
export const DEFAULT_USER_ID = "u_alice";

export async function getCurrentUser() {
  const db = await getDb();
  const jar = await cookies();
  const id = decodeIdentity(jar.get(COOKIE)?.value) ?? DEFAULT_USER_ID;
  const [user] = await db.select().from(s.users).where(eq(s.users.id, id)).limit(1);
  if (user) return user;
  const [fallback] = await db.select().from(s.users).where(eq(s.users.id, DEFAULT_USER_ID)).limit(1);
  return fallback;
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
