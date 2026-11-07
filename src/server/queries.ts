import "server-only";
import { and, count, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { DEFAULT_POLICY_ID } from "@/server/db/seed";

/** Read models for the dashboard. Benchmark sessions run in an isolated DB and never appear here. */

export async function overviewStats() {
  const db = await getDb();
  const rows = await db.select({ decision: s.toolCalls.decision, n: count() }).from(s.toolCalls).groupBy(s.toolCalls.decision);
  const by = Object.fromEntries(rows.map((r) => [r.decision, Number(r.n)])) as Record<string, number>;
  const [pending] = await db.select({ n: count() }).from(s.approvals).where(eq(s.approvals.status, "pending"));
  const [events] = await db
    .select({ n: count() })
    .from(s.auditEvents)
    .where(inArray(s.auditEvents.severity, ["warning", "critical"]));
  const [sessions] = await db.select({ n: count() }).from(s.agentSessions);
  const since = new Date(Date.now() - 13 * 86400_000);
  since.setHours(0, 0, 0, 0);
  const daily = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${s.toolCalls.createdAt}), 'YYYY-MM-DD')`,
      decision: s.toolCalls.decision,
      n: count(),
    })
    .from(s.toolCalls)
    .where(gte(s.toolCalls.createdAt, since))
    .groupBy(sql`1`, s.toolCalls.decision);
  const reasons = await db.execute(sql`
    select r->>'code' as code, count(*)::int as n
    from tool_calls, jsonb_array_elements(reasons) r
    where decision <> 'ALLOW' and r->>'code' <> 'RULE_MATCHED'
    group by 1 order by 2 desc limit 6`);
  return {
    total: (by.ALLOW ?? 0) + (by.REVIEW ?? 0) + (by.BLOCK ?? 0),
    allowed: by.ALLOW ?? 0,
    reviewed: by.REVIEW ?? 0,
    blocked: by.BLOCK ?? 0,
    pending: Number(pending?.n ?? 0),
    securityEvents: Number(events?.n ?? 0),
    sessions: Number(sessions?.n ?? 0),
    daily: daily.map((d) => ({ day: d.day, decision: d.decision, n: Number(d.n) })),
    since: since.toISOString(),
    topReasons: ((reasons as unknown as { rows: { code: string; n: number }[] }).rows ?? []).map((r) => ({ code: r.code, n: Number(r.n) })),
  };
}

export async function recentToolCalls(limit = 12) {
  const db = await getDb();
  return db
    .select({
      id: s.toolCalls.id,
      sessionId: s.toolCalls.sessionId,
      tool: s.toolCalls.tool,
      decision: s.toolCalls.decision,
      status: s.toolCalls.status,
      riskScore: s.toolCalls.riskScore,
      argsRedacted: s.toolCalls.argsRedacted,
      createdAt: s.toolCalls.createdAt,
      reasons: s.toolCalls.reasons,
    })
    .from(s.toolCalls)
    .orderBy(desc(s.toolCalls.createdAt))
    .limit(limit);
}

export async function listApprovals() {
  const db = await getDb();
  return db
    .select({
      approval: s.approvals,
      expiredNow: sql<boolean>`${s.approvals.expiresAt} < now()`,
      call: {
        tool: s.toolCalls.tool,
        argsRedacted: s.toolCalls.argsRedacted,
        pendingArgs: s.toolCalls.pendingArgs,
        reasons: s.toolCalls.reasons,
        riskScore: s.toolCalls.riskScore,
        provenance: s.toolCalls.provenance,
        rationale: s.toolCalls.rationale,
        status: s.toolCalls.status,
      },
      session: { userPrompt: s.agentSessions.userPrompt, userId: s.agentSessions.userId },
    })
    .from(s.approvals)
    .innerJoin(s.toolCalls, eq(s.toolCalls.id, s.approvals.toolCallId))
    .innerJoin(s.agentSessions, eq(s.agentSessions.id, s.approvals.sessionId))
    .orderBy(desc(s.approvals.createdAt))
    .limit(100);
}

export async function listEvents(filter: { decision?: string; severity?: string; type?: string; session?: string }) {
  const db = await getDb();
  const conds = [];
  if (filter.decision) conds.push(eq(s.auditEvents.decision, filter.decision));
  if (filter.severity) conds.push(eq(s.auditEvents.severity, filter.severity as "info"));
  if (filter.type) conds.push(sql`${s.auditEvents.type} like ${filter.type + "%"}`);
  if (filter.session) conds.push(eq(s.auditEvents.sessionId, filter.session));
  return db
    .select()
    .from(s.auditEvents)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(s.auditEvents.createdAt))
    .limit(200);
}

export async function toolCallsByIds(ids: string[]) {
  if (ids.length === 0) return [];
  const db = await getDb();
  return db.select().from(s.toolCalls).where(inArray(s.toolCalls.id, ids));
}

export async function sessionDetail(id: string) {
  const db = await getDb();
  const [session] = await db.select().from(s.agentSessions).where(eq(s.agentSessions.id, id)).limit(1);
  if (!session) return null;
  const calls = await db.select().from(s.toolCalls).where(eq(s.toolCalls.sessionId, id)).orderBy(s.toolCalls.createdAt);
  const sources = await db.select().from(s.provenanceSources).where(eq(s.provenanceSources.sessionId, id)).orderBy(s.provenanceSources.createdAt);
  const effects = await db.select().from(s.sandboxEffects).where(eq(s.sandboxEffects.sessionId, id));
  return { session, calls, sources, effects };
}

export async function recentSessions(limit = 8) {
  const db = await getDb();
  return db.select().from(s.agentSessions).where(ne(s.agentSessions.origin, "benchmark")).orderBy(desc(s.agentSessions.createdAt)).limit(limit);
}

export async function policyState() {
  const db = await getDb();
  const versions = await db
    .select()
    .from(s.policyVersions)
    .where(eq(s.policyVersions.policyId, DEFAULT_POLICY_ID))
    .orderBy(desc(s.policyVersions.version));
  const [active] = await db.select().from(s.activePolicy).where(eq(s.activePolicy.policyId, DEFAULT_POLICY_ID)).limit(1);
  return { versions, activeVersion: active?.version ?? null };
}

export async function benchmarkHistory(limit = 10) {
  const db = await getDb();
  return db
    .select({ id: s.benchmarkRuns.id, metrics: s.benchmarkRuns.metrics, config: s.benchmarkRuns.config, durationMs: s.benchmarkRuns.durationMs, createdAt: s.benchmarkRuns.createdAt })
    .from(s.benchmarkRuns)
    .orderBy(desc(s.benchmarkRuns.createdAt))
    .limit(limit);
}

export async function latestBenchmark() {
  const db = await getDb();
  const [row] = await db.select().from(s.benchmarkRuns).orderBy(desc(s.benchmarkRuns.createdAt)).limit(1);
  return row ?? null;
}

export async function listCorpus() {
  const db = await getDb();
  return db.select({ id: s.corpus.id, title: s.corpus.title, kind: s.corpus.kind, sourceType: s.corpus.sourceType, sensitivity: s.corpus.sensitivity }).from(s.corpus).orderBy(s.corpus.id);
}

export async function listUsers() {
  const db = await getDb();
  return db.select({ id: s.users.id, name: s.users.name, role: s.users.role }).from(s.users).orderBy(s.users.id);
}
