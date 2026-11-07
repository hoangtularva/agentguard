import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CORPUS } from "@/server/core/fixtures";
import { type DB, createDatabase } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { DEFAULT_POLICY_ID, DEMO_AGENT_ID } from "@/server/db/seed";
import { decideApproval } from "@/server/enforcement/approvals";
import { EnforcementPoint } from "@/server/enforcement/pep";
import { dbPolicyResolver } from "@/server/enforcement/policy-store";

/**
 * Exercises the DATABASE_URL code path (node-postgres driver + node-postgres migrator,
 * as used by Docker Compose) over the real PostgreSQL wire protocol, served by
 * pglite-socket. This substitutes for a Postgres container in environments without Docker.
 */
const PORT = 55432;
let server: PGLiteSocketServer;
let db: DB;

beforeAll(async () => {
  const pg = await PGlite.create();
  server = new PGLiteSocketServer({ db: pg, port: PORT, host: "127.0.0.1" });
  await server.start();
  // pglite-socket serves one connection at a time; multi-connection row locking on real
  // PostgreSQL is NOT verified here (see docs/BLOCKERS.md).
  process.env.DATABASE_POOL_MAX = "1";
  db = await createDatabase({ url: `postgres://postgres:postgres@127.0.0.1:${PORT}/postgres` });
});

afterAll(async () => {
  await (db as unknown as { $client: { end(): Promise<void> } } | undefined)?.$client.end();
  await server?.stop();
});

describe("node-postgres driver over the PostgreSQL wire protocol", () => {
  it("migrates, seeds, enforces, and prevents approval replay", async () => {
    const corpus = new Map(DEFAULT_CORPUS.map((c) => [c.id, c]));
    const pep = new EnforcementPoint(db, { corpus, resolvePolicy: dbPolicyResolver(db) });
    const st = await pep.startSession({
      userId: "u_alice",
      agentId: DEMO_AGENT_ID,
      prompt: "Email the Q3 summary to partner@contoso.example",
      mandate: { allowedTools: ["read_documents", "send_email"], resourceScope: ["doc:internal/*"] },
      planner: "test",
      policyId: DEFAULT_POLICY_ID,
    });
    const read = await pep.enforce(st, { tool: "read_documents", args: { documentIds: ["doc:internal/q3-sales-summary"] }, agentId: DEMO_AGENT_ID });
    expect(read.status).toBe("executed");
    const r = await pep.enforce(st, { tool: "send_email", args: { to: "partner@contoso.example", subject: "Q3", body: "x" }, agentId: DEMO_AGENT_ID });
    expect(r.decision.decision).toBe("REVIEW");
    await decideApproval(db, { approvalId: r.approvalId!, actorId: "u_alice", decision: "approve" });
    const results = await Promise.all(
      [1, 2, 3].map((i) => pep.executeApprovedAction({ approvalId: r.approvalId!, actorId: "u_alice", idempotencyKey: `wire-${i}` })),
    );
    expect(results.filter((x) => x.ok).length).toBe(1);
    const effects = await db.select().from(s.sandboxEffects).where(eq(s.sandboxEffects.toolCallId, r.toolCallId));
    expect(effects.length).toBe(1);
  });
});
