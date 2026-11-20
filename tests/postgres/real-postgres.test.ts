import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CORPUS, DEFAULT_POLICY } from "@/server/core/fixtures";
import type { Corpus } from "@/server/core/types";
import { type DB, createDatabase } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { DEFAULT_POLICY_ID, DEMO_AGENT_ID } from "@/server/db/seed";
import { decideApproval } from "@/server/enforcement/approvals";
import { EnforcementPoint } from "@/server/enforcement/pep";
import { createPolicyVersion, dbPolicyResolver } from "@/server/enforcement/policy-store";
import { authenticateApiKey, createApiKey, createApp } from "@/server/integration/apps";
import * as v1 from "@/server/integration/service";
import journal from "../../drizzle/meta/_journal.json";

const MIGRATION_COUNT = journal.entries.length;

/**
 * Integration suite against a REAL PostgreSQL 16 server process (official binaries
 * shipped by the embedded-postgres package; no Docker or admin rights needed).
 * Unlike PGlite (single connection), the pool here uses up to 10 concurrent server
 * connections, so row locks and unique constraints are exercised across sessions.
 */
const PORT = 54329;
const URL = `postgres://agentguard:local-test-only@127.0.0.1:${PORT}/agentguard_test`;
let pg: EmbeddedPostgres;
let db: DB;
let pep: EnforcementPoint;
const corpus: Corpus = new Map(DEFAULT_CORPUS.map((c) => [c.id, c]));

beforeAll(async () => {
  pg = new EmbeddedPostgres({
    databaseDir: path.resolve(`.data/pg-test-${Date.now()}`),
    user: "agentguard",
    password: "local-test-only",
    port: PORT,
    persistent: false, // throw-away test cluster, removed on stop
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("agentguard_test");
  process.env.DATABASE_POOL_MAX = "10";
  db = await createDatabase({ url: URL });
  pep = new EnforcementPoint(db, { corpus, resolvePolicy: dbPolicyResolver(db) });
});

afterAll(async () => {
  await (db as unknown as { $client?: { end(): Promise<void> } })?.$client?.end();
  await pg?.stop();
});

async function pendingApproval(to = "partner@contoso.example") {
  const st = await pep.startSession({
    userId: "u_alice",
    agentId: DEMO_AGENT_ID,
    prompt: `Email the Q3 summary to ${to}`,
    mandate: { allowedTools: ["read_documents", "send_email"], resourceScope: ["doc:internal/*"] },
    planner: "test",
    policyId: DEFAULT_POLICY_ID,
  });
  await pep.enforce(st, { tool: "read_documents", args: { documentIds: ["doc:internal/q3-sales-summary"] }, agentId: DEMO_AGENT_ID });
  const r = await pep.enforce(st, { tool: "send_email", args: { to, subject: "Q3", body: "Q3 revenue was 4.2M" }, agentId: DEMO_AGENT_ID });
  expect(r.decision.decision).toBe("REVIEW");
  return { st, r, approvalId: r.approvalId! };
}

const effects = async (toolCallId: string) =>
  (await db.select().from(s.sandboxEffects).where(eq(s.sandboxEffects.toolCallId, toolCallId))).length;

describe("real PostgreSQL 16", () => {
  it("is a real server with multiple backends", async () => {
    const v = await db.execute(sql`select version() as v`);
    expect(String((v as unknown as { rows: { v: string }[] }).rows[0].v)).toMatch(/^PostgreSQL 16\./);
    // open several concurrent connections and confirm distinct backend pids
    const pids = await Promise.all(
      Array.from({ length: 4 }, () =>
        db.transaction(async (tx) => {
          const r = await tx.execute(sql`select pg_backend_pid() as pid, pg_sleep(0.2)`);
          return (r as unknown as { rows: { pid: number }[] }).rows[0].pid;
        }),
      ),
    );
    expect(new Set(pids).size).toBeGreaterThan(1);
  });

  it("migrations applied and are idempotent", async () => {
    const t = await db.execute(sql`select count(*)::int as n from information_schema.tables where table_schema='public'`);
    expect((t as unknown as { rows: { n: number }[] }).rows[0].n).toBe(18); // 13 (0000_init) + 5 (0001_external_apps)
    const again = await createDatabase({ url: URL }); // re-run migrate + seed
    const m = await again.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    expect((m as unknown as { rows: { n: number }[] }).rows[0].n).toBe(MIGRATION_COUNT); // one row per migration file, not re-applied
    await (again as unknown as { $client: { end(): Promise<void> } }).$client.end();
  });

  it("concurrent executions of one approval across connections → exactly one side effect", async () => {
    const { r, approvalId } = await pendingApproval();
    await decideApproval(db, { approvalId, actorId: "u_alice", decision: "approve" });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => pep.executeApprovedAction({ approvalId, actorId: "u_alice", idempotencyKey: `conc-${approvalId}-${i}` })),
    );
    expect(results.filter((x) => x.ok).length).toBe(1);
    expect(await effects(r.toolCallId)).toBe(1);
    const denied = results.filter((x) => !x.ok).map((x) => (x as { code: string }).code);
    expect(new Set(denied)).toEqual(new Set(["APPROVAL_ALREADY_USED"]));
  });

  it("concurrent retries with the SAME idempotency key → one execution, others replay or are denied", async () => {
    const { r, approvalId } = await pendingApproval();
    await decideApproval(db, { approvalId, actorId: "u_alice", decision: "approve" });
    const key = `same-${approvalId}`;
    const results = await Promise.all(Array.from({ length: 6 }, () => pep.executeApprovedAction({ approvalId, actorId: "u_alice", idempotencyKey: key })));
    expect(results.filter((x) => x.ok && !x.replayed).length).toBe(1);
    expect(await effects(r.toolCallId)).toBe(1);
    const retry = await pep.executeApprovedAction({ approvalId, actorId: "u_alice", idempotencyKey: key });
    expect(retry).toMatchObject({ ok: true, replayed: true });
  });

  it("replay with a new key after execution is denied", async () => {
    const { r, approvalId } = await pendingApproval();
    await decideApproval(db, { approvalId, actorId: "u_alice", decision: "approve" });
    expect((await pep.executeApprovedAction({ approvalId, actorId: "u_alice", idempotencyKey: `a-${approvalId}` })).ok).toBe(true);
    const replay = await pep.executeApprovedAction({ approvalId, actorId: "u_alice", idempotencyKey: `b-${approvalId}` });
    expect(replay).toMatchObject({ ok: false, code: "APPROVAL_ALREADY_USED" });
    expect(await effects(r.toolCallId)).toBe(1);
  });

  it("two DIFFERENT approvals racing on the same idempotency key: one wins, the loser rolls back fully", async () => {
    const a = await pendingApproval("p1@contoso.example");
    const b = await pendingApproval("p2@contoso.example");
    await decideApproval(db, { approvalId: a.approvalId, actorId: "u_alice", decision: "approve" });
    await decideApproval(db, { approvalId: b.approvalId, actorId: "u_alice", decision: "approve" });
    const key = `shared-${a.approvalId}`;
    const [ra, rb] = await Promise.all([
      pep.executeApprovedAction({ approvalId: a.approvalId, actorId: "u_alice", idempotencyKey: key }),
      pep.executeApprovedAction({ approvalId: b.approvalId, actorId: "u_alice", idempotencyKey: key }),
    ]);
    expect([ra.ok, rb.ok].filter(Boolean).length).toBe(1);
    const loser = ra.ok ? b : a;
    // atomicity: loser has no side effect AND its approval was not burnt
    expect(await effects(loser.r.toolCallId)).toBe(0);
    const [apr] = await db.select().from(s.approvals).where(eq(s.approvals.id, loser.approvalId));
    expect(apr.status).toBe("approved");
    // and it can still run with its own key
    const again = await pep.executeApprovedAction({ approvalId: loser.approvalId, actorId: "u_alice", idempotencyKey: `own-${loser.approvalId}` });
    expect(again.ok).toBe(true);
    expect(await effects(loser.r.toolCallId)).toBe(1);
  });

  it("a failure after the side effect rolls back the effect and the claim", async () => {
    const { r, approvalId } = await pendingApproval();
    await decideApproval(db, { approvalId, actorId: "u_alice", decision: "approve" });
    // Pre-existing execution row for this tool call → the uniquely-keyed insert will fail
    // AFTER the executor has written its sandbox effect inside the transaction.
    await db.insert(s.executions).values({ id: `ex_conflict_${approvalId}`, toolCallId: r.toolCallId, idempotencyKey: `pre-${approvalId}`, approvalId: null, ok: true, resultSummary: {} });
    const res = await pep.executeApprovedAction({ approvalId, actorId: "u_alice", idempotencyKey: `k-${approvalId}` });
    expect(res.ok).toBe(false);
    expect(await effects(r.toolCallId)).toBe(0);
    const [apr] = await db.select().from(s.approvals).where(eq(s.approvals.id, approvalId));
    expect(apr.status).toBe("approved");
  });

  it("policy activation racing with execution: never executes under a stale binding after the change is visible", async () => {
    const outcomes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const { r, approvalId } = await pendingApproval(`race${i}@contoso.example`);
      await decideApproval(db, { approvalId, actorId: "u_alice", decision: "approve" });
      const [ex] = await Promise.all([
        pep.executeApprovedAction({ approvalId, actorId: "u_alice", idempotencyKey: `race-${approvalId}` }),
        createPolicyVersion(db, { policyId: DEFAULT_POLICY_ID, name: "race", document: DEFAULT_POLICY, changeNote: `race ${i}`, actorId: "u_bob", activate: true }),
      ]);
      const n = await effects(r.toolCallId);
      if (ex.ok) {
        expect(n).toBe(1);
        outcomes.push("executed-before-change");
      } else {
        expect(ex.code).toBe("POLICY_CHANGED");
        expect(n).toBe(0);
        outcomes.push("invalidated");
      }
      // after the race, the approval can never execute again
      const after = await pep.executeApprovedAction({ approvalId, actorId: "u_alice", idempotencyKey: `after-${approvalId}` });
      expect(after.ok).toBe(false);
    }
    expect(outcomes.length).toBe(5);
  });

  it("session consistency under concurrent proposals: every call gets its own decision + audit record", async () => {
    const st = await pep.startSession({
      userId: "u_alice",
      agentId: DEMO_AGENT_ID,
      prompt: "Email bob@acme.example and carol@acme.example the handbook",
      mandate: { allowedTools: ["read_documents", "send_email"], resourceScope: ["doc:public/*"] },
      planner: "test",
      policyId: DEFAULT_POLICY_ID,
    });
    const calls = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        pep.enforce(st, { tool: "send_email", args: { to: i % 2 ? "bob@acme.example" : "carol@acme.example", subject: `m${i}`, body: "hi" }, agentId: DEMO_AGENT_ID }),
      ),
    );
    expect(new Set(calls.map((c) => c.toolCallId)).size).toBe(8);
    expect(calls.every((c) => c.decision.decision === "ALLOW" && c.status === "executed")).toBe(true);
    const audited = await db
      .select()
      .from(s.auditEvents)
      .where(and(eq(s.auditEvents.sessionId, st.id), eq(s.auditEvents.type, "tool_call.evaluated")));
    expect(audited.length).toBe(8);
    const ex = await db.select().from(s.executions).where(sql`${s.executions.toolCallId} in ${calls.map((c) => c.toolCallId)}`);
    expect(ex.length).toBe(8);
  });

  it("survives killed connections (pg_terminate_backend) and keeps working", async () => {
    await db.execute(sql`select pg_terminate_backend(pid) from pg_stat_activity where usename = 'agentguard' and pid <> pg_backend_pid() and datname = 'agentguard_test'`);
    await new Promise((r) => setTimeout(r, 300));
    const { approvalId } = await pendingApproval("after-kill@contoso.example");
    expect(approvalId).toBeTruthy();
  });

  it("fails closed when the database is unreachable", async () => {
    await expect(createDatabase({ url: `postgres://agentguard:x@127.0.0.1:${PORT + 1}/nope` })).rejects.toThrow();
  });
  it("/v1: concurrent consume of one approval and concurrent token verification each succeed exactly once", async () => {
    await createApp(db, { id: "pgapp", name: "PG app", createdBy: "u_bob" });
    const { key } = await createApiKey(db, { appId: "pgapp", name: "k", scopes: ["check", "verify", "admin"], createdBy: "u_bob" });
    const principal = (await authenticateApiKey(db, `Bearer ${key}`))!;
    await v1.putTool(db, principal, "notify", {
      name: "notify",
      kind: "sink",
      risk: "high",
      destinationArg: "to",
      inputSchema: { type: "object", properties: { to: { type: "string" } }, required: ["to"] },
    });
    await v1.putAgent(db, principal, "bot", { name: "Bot", allowedTools: ["notify"], active: true });
    const { sessionId } = await v1.openSession(db, principal, {
      userRef: "u1",
      agentId: "bot",
      agents: [],
      prompt: "Notify ops@pg.example",
      mandate: { tools: ["notify"], resources: [], destinations: [] },
    });
    const r = await v1.check(db, principal, { sessionId, agentId: "bot", tool: "notify", args: { to: "ops@pg.example" } });
    expect(r.decision).toBe("REVIEW"); // high-risk sink
    await decideApproval(db, { approvalId: r.approvalId!, actorId: "u_bob", decision: "approve" });

    const consumed = await Promise.allSettled(Array.from({ length: 10 }, () => v1.consume(db, principal, r.approvalId!)));
    const wins = consumed.filter((x) => x.status === "fulfilled") as PromiseFulfilledResult<{ decisionToken?: string }>[];
    expect(wins.length).toBe(1);
    const token = wins[0].value.decisionToken!;
    const verified = await Promise.all(
      Array.from({ length: 10 }, () => v1.verifyToken(db, principal, { token, tool: "notify", args: { to: "ops@pg.example" }, consume: true })),
    );
    expect(verified.filter((x) => x.valid).length).toBe(1);
    expect(verified.filter((x) => x.code === "REPLAYED").length).toBe(9);
  });
});
