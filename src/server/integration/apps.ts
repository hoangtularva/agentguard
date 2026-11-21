import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { deriveEd25519KeyPair, deriveTokenKey } from "../../../packages/core/src/decision-token";
import { STARTER_POLICY } from "../../../packages/core/src/starter-policy";
import { hashCanonical, sha256 } from "@/server/core/canonical";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { writeAudit } from "@/server/enforcement/audit";
import { newId } from "@/server/enforcement/ids";
import { secret } from "@/server/identity";

export type App = typeof s.apps.$inferSelect;
export const API_SCOPES = ["check", "verify", "admin"] as const;
export type ApiScope = (typeof API_SCOPES)[number];
export const APP_ID_RE = /^[a-z][a-z0-9-]{2,31}$/;

/** Internal agent ids are namespaced per app, so two apps can both have an agent "researcher". */
export const agentKey = (appId: string, agentRef: string) => `${appId}.${agentRef}`;

/** Shared HMAC key for this app's agt1 decision tokens (derived; nothing stored). */
export const tokenKeyFor = (app: Pick<App, "id" | "tokenKeyVersion">) => deriveTokenKey(secret(), app.id, app.tokenKeyVersion);
/** Ed25519 key pair for agt2 tokens (derived; the public key can be published). */
export const ed25519For = (app: Pick<App, "id" | "tokenKeyVersion">) => deriveEd25519KeyPair(secret(), app.id, app.tokenKeyVersion);
export type TokenAlg = "hmac" | "ed25519";
/** "hmac" (default; offline verification needs the shared key) or "ed25519" (verify with the public key). */
export const tokenAlgOf = (app: Pick<App, "settings">): TokenAlg => (app.settings.tokenAlg === "ed25519" ? "ed25519" : "hmac");

/** Register an app with its own copy of the tool-agnostic starter policy. */
export async function createApp(db: DB, p: { id: string; name: string; createdBy: string; tokenAlg?: TokenAlg }): Promise<App> {
  if (!APP_ID_RE.test(p.id) || p.id === "demo") throw new Error("App id must be 3–32 chars: a-z, 0-9, '-' (and not 'demo').");
  const policyId = `${p.id}.default`;
  return db.transaction(async (raw) => {
    const tx = raw as unknown as DB;
    const [app] = await tx
      .insert(s.apps)
      .values({ id: p.id, name: p.name, createdBy: p.createdBy, defaultPolicyId: policyId, settings: p.tokenAlg ? { tokenAlg: p.tokenAlg } : {} })
      .returning();
    await tx.insert(s.policyVersions).values({
      id: `${policyId}@1`,
      appId: p.id,
      policyId,
      version: 1,
      name: `${p.name} starter policy`,
      document: STARTER_POLICY,
      documentHash: hashCanonical(STARTER_POLICY),
      changeNote: "Starter policy (tool-agnostic)",
      createdBy: p.createdBy,
    });
    await tx.insert(s.activePolicy).values({ appId: p.id, policyId, version: 1 });
    await writeAudit(tx, { type: "app.created", appId: p.id, actorId: p.createdBy, payload: { name: p.name, policyId } });
    return app;
  });
}

/** Create an API key. The plaintext is returned ONCE; only its SHA-256 is stored. */
export async function createApiKey(
  db: DB,
  p: { appId: string; name: string; scopes: ApiScope[]; agentRef?: string; createdBy: string },
): Promise<{ id: string; key: string; prefix: string }> {
  if (p.appId === "demo") throw new Error("The built-in demo app has no API keys; create an app first.");
  const key = `agk_${randomBytes(24).toString("base64url")}`;
  const id = newId("key");
  const prefix = key.slice(0, 12);
  await db.insert(s.apiKeys).values({
    id,
    appId: p.appId,
    agentId: p.agentRef ? agentKey(p.appId, p.agentRef) : null,
    name: p.name,
    keyHash: sha256(key),
    prefix,
    scopes: [...new Set(p.scopes)],
  });
  await writeAudit(db, { type: "api_key.created", appId: p.appId, actorId: p.createdBy, payload: { keyId: id, prefix, scopes: p.scopes } });
  return { id, key, prefix };
}

export async function revokeApiKey(db: DB, appId: string, keyId: string, actorId: string): Promise<boolean> {
  const rows = await db
    .update(s.apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(s.apiKeys.id, keyId), eq(s.apiKeys.appId, appId), isNull(s.apiKeys.revokedAt)))
    .returning({ id: s.apiKeys.id });
  if (rows.length) await writeAudit(db, { type: "api_key.revoked", appId, actorId, payload: { keyId } });
  return rows.length === 1;
}

export interface ApiPrincipal {
  keyId: string;
  app: App;
  /** Internal agent id this key is bound to, or null for an app-wide key. */
  agentId: string | null;
  scopes: ApiScope[];
}

/** Resolve a Bearer API key. Unknown, revoked or malformed keys → null (caller answers 401). */
export async function authenticateApiKey(db: DB, authorization: string | null): Promise<ApiPrincipal | null> {
  const m = /^Bearer (agk_[A-Za-z0-9_-]{20,64})$/.exec(authorization ?? "");
  if (!m) return null;
  const [row] = await db
    .select({ key: s.apiKeys, app: s.apps })
    .from(s.apiKeys)
    .innerJoin(s.apps, eq(s.apps.id, s.apiKeys.appId))
    .where(and(eq(s.apiKeys.keyHash, sha256(m[1])), isNull(s.apiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;
  // Best-effort usage stamp, at most once a minute per key; never blocks the request.
  const now = Date.now();
  if (!row.key.lastUsedAt || now - row.key.lastUsedAt.getTime() > 60_000)
    void db.update(s.apiKeys).set({ lastUsedAt: new Date(now) }).where(eq(s.apiKeys.id, row.key.id)).catch(() => {});
  return { keyId: row.key.id, app: row.app, agentId: row.key.agentId, scopes: row.key.scopes as ApiScope[] };
}
