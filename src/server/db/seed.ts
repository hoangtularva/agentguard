import { eq } from "drizzle-orm";
import { hashCanonical } from "@/server/core/canonical";
import { DEFAULT_CORPUS, DEFAULT_POLICY } from "@/server/core/fixtures";
import type { DB } from "./client";
import * as s from "./schema";

export const DEFAULT_POLICY_ID = "default";
export const DEMO_AGENT_ID = "agent_assistant";
export const BENCH_AGENT_ID = "agent_bench";

export const DEMO_USERS = [
  { id: "u_alice", name: "Alice Nguyen", email: "alice@acme.example", role: "member" as const },
  { id: "u_bob", name: "Bob Tran", email: "bob@acme.example", role: "approver" as const },
  { id: "u_mallory", name: "Mallory Le", email: "mallory@acme.example", role: "member" as const },
];

/** Idempotent seed: inserts demo identities, corpus and policy v1 if missing. */
export async function seedDatabase(db: DB): Promise<void> {
  await db.insert(s.users).values(DEMO_USERS).onConflictDoNothing();
  await db
    .insert(s.agents)
    .values([
      { id: DEMO_AGENT_ID, name: "Workspace Assistant", allowedTools: ["read_documents", "send_email", "export_data"] },
      { id: BENCH_AGENT_ID, name: "Benchmark Agent", allowedTools: ["read_documents", "send_email", "export_data"] },
      { id: "agent_disabled", name: "Retired Agent", allowedTools: ["read_documents"], active: false },
    ])
    .onConflictDoNothing();
  await db.insert(s.corpus).values(DEFAULT_CORPUS).onConflictDoNothing();
  const existing = await db
    .select({ id: s.policyVersions.id })
    .from(s.policyVersions)
    .where(eq(s.policyVersions.policyId, DEFAULT_POLICY_ID))
    .limit(1);
  if (existing.length === 0) {
    await db
      .insert(s.policyVersions)
      .values({
        id: `${DEFAULT_POLICY_ID}@1`,
        policyId: DEFAULT_POLICY_ID,
        version: 1,
        name: "Workspace default policy",
        document: DEFAULT_POLICY,
        documentHash: hashCanonical(DEFAULT_POLICY),
        changeNote: "Initial seeded policy",
        createdBy: "system",
      })
      .onConflictDoNothing();
    await db.insert(s.activePolicy).values({ policyId: DEFAULT_POLICY_ID, version: 1 }).onConflictDoNothing();
  }
}
