import { DEFAULT_CORPUS } from "@/server/core/fixtures";
import { createDatabase } from "@/server/db/client";
import { DEFAULT_POLICY_ID, DEMO_AGENT_ID } from "@/server/db/seed";
import { dbPolicyResolver } from "@/server/enforcement/policy-store";
import { EnforcementPoint } from "@/server/enforcement/pep";
import type { Corpus } from "@/server/core/types";

export async function setup(opts: { now?: () => Date } = {}) {
  const db = await createDatabase({ pgliteDir: "memory" });
  const corpus: Corpus = new Map(DEFAULT_CORPUS.map((c) => [c.id, c]));
  const pep = new EnforcementPoint(db, { corpus, resolvePolicy: dbPolicyResolver(db), now: opts.now });
  const start = (prompt: string, mandate?: Partial<{ allowedTools: string[]; resourceScope: string[]; destinations: string[] }>) =>
    pep.startSession({
      userId: "u_alice",
      agentId: DEMO_AGENT_ID,
      prompt,
      planner: "test",
      policyId: DEFAULT_POLICY_ID,
      mandate: {
        allowedTools: mandate?.allowedTools ?? ["read_documents", "send_email", "export_data"],
        resourceScope: mandate?.resourceScope ?? ["doc:*", "ds:*"],
        destinations: mandate?.destinations ?? [],
      },
    });
  return { db, pep, corpus, start, agentId: DEMO_AGENT_ID };
}
