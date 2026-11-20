import "server-only";
import { type SQL, and, count, desc, eq, gte, inArray, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { DEFAULT_POLICY_ID } from "@/server/db/seed";
import { canSeeAll } from "@/server/identity";

/**
 * Read models for the dashboard. Every query is scoped to the viewer (Phase 3 fix F4):
 * members see only their own sessions, tool calls, approvals and events; approvers and
 * admins see everything. Benchmark sessions run in an isolated DB and never appear here.
 */
export type Viewer = { id: string; role: string };

const own = (v: Viewer) => !canSeeAll(v.role);

export async function overviewStats(v: Viewer) {
  const db = await getDb();
  const tcScope = own(v) ? eq(s.toolCalls.userId, v.id) : undefined;
  const rows = await db.select({ decision: s.toolCalls.decision, n: count() }).from(s.toolCalls).where(tcScope).groupBy(s.toolCalls.decision);
  const by = Object.fromEntries(rows.map((r) => [r.decision, Number(r.n)])) as Record<string, number>;
  const [pending] = await db
    .select({ n: count() })
    .from(s.approvals)
    .where(and(eq(s.approvals.status, "pending"), own(v) ? eq(s.approvals.requestedFor, v.id) : undefined));
  const [events] = await db
    .select({ n: count() })
    .from(s.auditEvents)
    .where(and(inArray(s.auditEvents.severity, ["warning", "critical"]), eventScope(v)));
  const [sessions] = await db.select({ n: count() }).from(s.agentSessions).where(own(v) ? eq(s.agentSessions.userId, v.id) : undefined);
  const since = new Date(Date.now() - 13 * 86400_000);
  since.setHours(0, 0, 0, 0);
  const daily = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${s.toolCalls.createdAt}), 'YYYY-MM-DD')`,
      decision: s.toolCalls.decision,
      n: count(),
    })
    .from(s.toolCalls)
    .where(and(gte(s.toolCalls.createdAt, since), tcScope))
    .groupBy(sql`1`, s.toolCalls.decision);
  const userFilter = own(v) ? sql`and user_id = ${v.id}` : sql``;
  const reasons = await db.execute(sql`
    select r->>'code' as code, count(*)::int as n
    from tool_calls, jsonb_array_elements(reasons) r
    where decision <> 'ALLOW' and r->>'code' <> 'RULE_MATCHED' ${userFilter}
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
    scope: own(v) ? ("own" as const) : ("all" as const),
  };
}

export async function recentToolCalls(v: Viewer, limit = 12) {
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
    .where(own(v) ? eq(s.toolCalls.userId, v.id) : undefined)
    .orderBy(desc(s.toolCalls.createdAt))
    .limit(limit);
}

export async function listApprovals(v: Viewer) {
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
    .where(own(v) ? eq(s.approvals.requestedFor, v.id) : undefined)
    .orderBy(desc(s.approvals.createdAt))
    .limit(100);
}

/** Events a viewer may see: own actions, or events of own sessions. */
function eventScope(v: Viewer): SQL | undefined {
  if (!own(v)) return undefined;
  return or(
    eq(s.auditEvents.actorId, v.id),
    inArray(s.auditEvents.sessionId, sql`(select id from agent_sessions where user_id = ${v.id})`),
  );
}

export async function listEvents(v: Viewer, filter: { decision?: string; severity?: string; type?: string; session?: string }) {
  const db = await getDb();
  const conds: (SQL | undefined)[] = [eventScope(v)];
  if (filter.decision) conds.push(eq(s.auditEvents.decision, filter.decision));
  if (filter.severity) conds.push(eq(s.auditEvents.severity, filter.severity as "info"));
  if (filter.type) conds.push(sql`${s.auditEvents.type} like ${filter.type + "%"}`);
  if (filter.session) conds.push(eq(s.auditEvents.sessionId, filter.session));
  return db
    .select()
    .from(s.auditEvents)
    .where(and(...conds))
    .orderBy(desc(s.auditEvents.createdAt))
    .limit(200);
}

export async function toolCallsByIds(v: Viewer, ids: string[]) {
  if (ids.length === 0) return [];
  const db = await getDb();
  return db
    .select()
    .from(s.toolCalls)
    .where(and(inArray(s.toolCalls.id, ids), own(v) ? eq(s.toolCalls.userId, v.id) : undefined));
}

/** Returns null both for unknown sessions and for sessions the viewer may not see (no existence oracle). */
export async function sessionDetail(v: Viewer, id: string) {
  const db = await getDb();
  const [session] = await db.select().from(s.agentSessions).where(eq(s.agentSessions.id, id)).limit(1);
  if (!session) return null;
  if (own(v) && session.userId !== v.id) return null;
  const calls = await db.select().from(s.toolCalls).where(eq(s.toolCalls.sessionId, id)).orderBy(s.toolCalls.createdAt);
  const sources = await db.select().from(s.provenanceSources).where(eq(s.provenanceSources.sessionId, id)).orderBy(s.provenanceSources.createdAt);
  const effects = await db.select().from(s.sandboxEffects).where(eq(s.sandboxEffects.sessionId, id));
  return { session, calls, sources, effects };
}

export async function recentSessions(v: Viewer, limit = 8) {
  const db = await getDb();
  return db
    .select()
    .from(s.agentSessions)
    .where(and(ne(s.agentSessions.origin, "benchmark"), own(v) ? eq(s.agentSessions.userId, v.id) : undefined))
    .orderBy(desc(s.agentSessions.createdAt))
    .limit(limit);
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

/** Apps & API keys overview (approver/admin only; callers must check the role). Key hashes never leave the server. */
export async function listApps() {
  const db = await getDb();
  const apps = await db.select().from(s.apps).orderBy(s.apps.createdAt);
  const keys = await db
    .select({
      id: s.apiKeys.id,
      appId: s.apiKeys.appId,
      name: s.apiKeys.name,
      prefix: s.apiKeys.prefix,
      scopes: s.apiKeys.scopes,
      agentId: s.apiKeys.agentId,
      createdAt: s.apiKeys.createdAt,
      lastUsedAt: s.apiKeys.lastUsedAt,
      revokedAt: s.apiKeys.revokedAt,
    })
    .from(s.apiKeys)
    .orderBy(desc(s.apiKeys.createdAt));
  const tools = await db
    .select({ appId: s.toolSpecs.appId, name: s.toolSpecs.name, version: s.toolSpecs.version, spec: s.toolSpecs.spec })
    .from(s.toolSpecs)
    .where(eq(s.toolSpecs.active, true));
  const agents = await db.select({ id: s.agents.id, appId: s.agents.appId, name: s.agents.name, allowedTools: s.agents.allowedTools, active: s.agents.active }).from(s.agents);
  const calls = await db.select({ appId: s.toolCalls.appId, n: count() }).from(s.toolCalls).groupBy(s.toolCalls.appId);
  return apps
    .filter((a) => a.id !== "demo")
    .map((a) => ({
      ...a,
      keys: keys.filter((k) => k.appId === a.id),
      tools: tools.filter((t) => t.appId === a.id),
      agents: agents.filter((g) => g.appId === a.id).map((g) => ({ ...g, ref: g.id.slice(a.id.length + 1) })),
      calls: calls.find((c) => c.appId === a.id)?.n ?? 0,
    }));
}
