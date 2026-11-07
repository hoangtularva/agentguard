import { and, desc, eq } from "drizzle-orm";
import { hashCanonical } from "@/server/core/canonical";
import { type PolicyDocument, PolicyDocumentSchema, type PolicyRef } from "@/server/core/policy-schema";
import type { DB } from "@/server/db/client";
import { activePolicy, policyVersions } from "@/server/db/schema";
import { writeAudit } from "./audit";

/** Resolve the active policy. Pass `tx` when called inside a transaction so the read is consistent. */
export type PolicyResolver = (policyId: string, tx?: DB) => Promise<PolicyRef>;

export class PolicyNotFoundError extends Error {}

export async function getActivePolicy(db: DB, policyId: string): Promise<PolicyRef> {
  const [active] = await db.select().from(activePolicy).where(eq(activePolicy.policyId, policyId)).limit(1);
  if (!active) throw new PolicyNotFoundError(`No active policy "${policyId}"`);
  const [row] = await db
    .select()
    .from(policyVersions)
    .where(and(eq(policyVersions.policyId, policyId), eq(policyVersions.version, active.version)))
    .limit(1);
  if (!row) throw new PolicyNotFoundError(`Active version ${active.version} of "${policyId}" missing`);
  // Re-validate on load: a corrupted row must fail closed, not evaluate partially.
  const document = PolicyDocumentSchema.parse(row.document);
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
      .select({ version: policyVersions.version })
      .from(policyVersions)
      .where(eq(policyVersions.policyId, params.policyId))
      .orderBy(desc(policyVersions.version))
      .limit(1);
    const version = (latest?.version ?? 0) + 1;
    await tx.insert(policyVersions).values({
      id: `${params.policyId}@${version}`,
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
      actorId: params.actorId,
      payload: { policyId: params.policyId, version, changeNote: params.changeNote },
    });
    if (params.activate) {
      await tx
        .insert(activePolicy)
        .values({ policyId: params.policyId, version })
        .onConflictDoUpdate({ target: activePolicy.policyId, set: { version, updatedAt: new Date() } });
      await writeAudit(tx, {
        type: "policy.activated",
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
