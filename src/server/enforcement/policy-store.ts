import { and, desc, eq } from "drizzle-orm";
import { hashCanonical } from "@/server/core/canonical";
import { type PolicyDocument, PolicyDocumentSchema, type PolicyRef } from "@/server/core/policy-schema";
import type { DB } from "@/server/db/client";
import { activePolicy, policyVersions } from "@/server/db/schema";
import { writeAudit } from "./audit";

/** Resolve the active policy. Pass `tx` when called inside a transaction so the read is consistent. */
export type PolicyResolver = (policyId: string, tx?: DB) => Promise<PolicyRef>;

export class PolicyNotFoundError extends Error {}

/** Validated documents by (policy, version, stored hash): versions are immutable, so parsing once is enough. */
const g = globalThis as unknown as { __agPolicyCache?: Map<string, PolicyDocument> };

export async function getActivePolicy(db: DB, policyId: string): Promise<PolicyRef> {
  // One round trip: the active pointer joined to its version row.
  const [row] = await db
    .select({ active: activePolicy.version, version: policyVersions.version, document: policyVersions.document, hash: policyVersions.documentHash })
    .from(activePolicy)
    .leftJoin(policyVersions, and(eq(policyVersions.policyId, activePolicy.policyId), eq(policyVersions.version, activePolicy.version)))
    .where(eq(activePolicy.policyId, policyId))
    .limit(1);
  if (!row) throw new PolicyNotFoundError(`No active policy "${policyId}"`);
  if (row.version === null) throw new PolicyNotFoundError(`Active version ${row.active} of "${policyId}" missing`);
  const key = `${policyId}@${row.version}#${row.hash}`;
  g.__agPolicyCache ??= new Map();
  let document = g.__agPolicyCache.get(key);
  if (!document) {
    // Validate on first load: a corrupted row must fail closed, not evaluate partially.
    document = PolicyDocumentSchema.parse(row.document);
    g.__agPolicyCache.set(key, document);
  }
  return { policyId, version: row.version, document };
}

export function dbPolicyResolver(db: DB): PolicyResolver {
  return (policyId, tx) => getActivePolicy(tx ?? db, policyId);
}

export async function listPolicyVersions(db: DB, policyId: string) {
  return db
    .select()
    .from(policyVersions)
    .where(eq(policyVersions.policyId, policyId))
    .orderBy(desc(policyVersions.version));
}

/**
 * Create a new immutable version and (optionally) activate it atomically.
 * Activating a new version invalidates pending approvals bound to older versions
 * at execution time (binding hash includes the policy version).
 */
export async function createPolicyVersion(
  db: DB,
  params: { policyId: string; name: string; document: PolicyDocument; changeNote: string; actorId: string; activate: boolean },
): Promise<PolicyRef> {
  const document = PolicyDocumentSchema.parse(params.document);
  return db.transaction(async (tx) => {
    const [latest] = await tx
      .select({ version: policyVersions.version, appId: policyVersions.appId })
      .from(policyVersions)
      .where(eq(policyVersions.policyId, params.policyId))
      .orderBy(desc(policyVersions.version))
      .limit(1);
    const version = (latest?.version ?? 0) + 1;
    // A new version belongs to the same app as the policy's earlier versions.
    const appId = latest?.appId ?? "demo";
    await tx.insert(policyVersions).values({
      id: `${params.policyId}@${version}`,
      appId,
      policyId: params.policyId,
      version,
      name: params.name,
      document,
      documentHash: hashCanonical(document),
      changeNote: params.changeNote,
      createdBy: params.actorId,
    });
    await writeAudit(tx, {
      type: "policy.version_created",
      appId,
      actorId: params.actorId,
      payload: { policyId: params.policyId, version, changeNote: params.changeNote },
    });
    if (params.activate) {
      await tx
        .insert(activePolicy)
        .values({ policyId: params.policyId, version, appId })
        .onConflictDoUpdate({ target: activePolicy.policyId, set: { version, updatedAt: new Date() } });
      await writeAudit(tx, {
        type: "policy.activated",
        appId,
        severity: "warning",
        actorId: params.actorId,
        payload: { policyId: params.policyId, version },
      });
    }
    return { policyId: params.policyId, version, document };
  });
}

export async function activatePolicyVersion(db: DB, policyId: string, version: number, actorId: string) {
  const [row] = await db
    .select({ id: policyVersions.id })
    .from(policyVersions)
    .where(and(eq(policyVersions.policyId, policyId), eq(policyVersions.version, version)))
    .limit(1);
  if (!row) throw new PolicyNotFoundError(`Version ${version} not found`);
  await db
    .insert(activePolicy)
    .values({ policyId, version })
    .onConflictDoUpdate({ target: activePolicy.policyId, set: { version, updatedAt: new Date() } });
  await writeAudit(db, { type: "policy.activated", severity: "warning", actorId, payload: { policyId, version } });
}
