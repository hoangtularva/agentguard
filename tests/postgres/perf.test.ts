import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * P4: measure (not guess) dashboard query latency on a real PostgreSQL 16 server with a
 * realistic audit volume, for both a member (scoped) and an approver (unscoped) viewer.
 * Thresholds are generous; the numbers are printed and recorded in PHASE3_PROGRESS.md.
 */
const PORT = 54331;
let pg: EmbeddedPostgres;
type Q = typeof import("@/server/queries");
let q: Q;
let db: Awaited<ReturnType<typeof import("@/server/db/client").getDb>>;

beforeAll(async () => {
  pg = new EmbeddedPostgres({ databaseDir: path.resolve(`.data/pg-perf-${Date.now()}`), user: "agentguard", password: "local-test-only", port: PORT, persistent: false, onLog: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("perf");
  process.env.DATABASE_URL = `postgres://agentguard:local-test-only@127.0.0.1:${PORT}/perf`;
  const client = await import("@/server/db/client");
  db = await client.getDb();
  q = await import("@/server/queries");
  // 2,000 sessions, 10,000 tool calls, 50,000 audit events across three users.
  await db.execute(sql`
    insert into agent_sessions (id, user_id, agent_id, user_prompt, mandate, planner, status, origin)
    select 'ses_p' || g, (array['u_alice','u_bob','u_mallory'])[1 + g % 3], 'agent_assistant', 'perf', '{}'::jsonb, 'perf', 'completed', 'playground'
    from generate_series(1, 2000) g`);
  await db.execute(sql`
    insert into tool_calls (id, session_id, user_id, agent_id, tool, args_redacted, args_hash, decision, reasons, matched_rule_ids, risk_score, policy_id, policy_version, provenance, status, eval_latency_ms, created_at)
    select 'tc_p' || g, 'ses_p' || (1 + g % 2000), (array['u_alice','u_bob','u_mallory'])[1 + (1 + g % 2000) % 3], 'agent_assistant', 'send_email', '{}'::jsonb, 'h',
      (array['ALLOW','REVIEW','BLOCK'])[1 + g % 3], '[{"code":"NO_MATCHING_POLICY"}]'::jsonb, '[]'::jsonb, 50, 'default', 1, '{}'::jsonb, 'executed', 0.05,
      now() - (g % 14) * interval '1 day'
    from generate_series(1, 10000) g`);
  await db.execute(sql`
    insert into audit_events (id, type, severity, session_id, tool_call_id, actor_id, decision, reason_codes, payload, created_at)
    select 'evt_p' || g, 'tool_call.evaluated', (array['info','warning','critical'])[1 + g % 3], 'ses_p' || (1 + g % 2000), null,
      'agent_assistant', 'ALLOW', '[]'::jsonb, '{}'::jsonb, now() - (g % 1000) * interval '1 minute'
    from generate_series(1, 50000) g`);
  await db.execute(sql`analyze`);
}, 300_000);

afterAll(async () => {
  await (db as unknown as { $client?: { end(): Promise<void> } })?.$client?.end();
  await pg?.stop();
});

async function time(fn: () => Promise<unknown>, n = 15) {
  await fn();
  const t: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = performance.now();
    await fn();
    t.push(performance.now() - s);
  }
  t.sort((a, b) => a - b);
  return { p50: Math.round(t[Math.floor(n / 2)]), p95: Math.round(t[Math.ceil(n * 0.95) - 1]) };
}

describe("dashboard query performance (real PostgreSQL, 50k audit events)", () => {
  const member = { id: "u_alice", role: "member" };
  const approver = { id: "u_bob", role: "approver" };

  it("overview, events and approvals stay fast for scoped and unscoped viewers", async () => {
    const r = {
      overviewMember: await time(() => q.overviewStats(member)),
      overviewApprover: await time(() => q.overviewStats(approver)),
      eventsMember: await time(() => q.listEvents(member, {})),
      eventsApprover: await time(() => q.listEvents(approver, {})),
      eventsMemberFiltered: await time(() => q.listEvents(member, { severity: "critical" })),
      approvalsMember: await time(() => q.listApprovals(member)),
    };
    console.log("PERF_RESULTS", JSON.stringify(r));
    (await import("node:fs")).writeFileSync(path.resolve(".data/perf-results.json"), JSON.stringify(r, null, 2));
    for (const v of Object.values(r)) expect(v.p95).toBeLessThan(1500);
  });
});
