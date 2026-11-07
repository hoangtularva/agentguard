import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role", { enum: ["member", "approver", "admin"] }).notNull(),
  createdAt: createdAt(),
});

export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** Tools this agent identity may ever request (upper bound on any mandate). */
  allowedTools: jsonb("allowed_tools").$type<string[]>().notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/** Corpus of synthetic documents/datasets the mock tools read. */
export const corpus = pgTable("corpus_items", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  kind: text("kind", { enum: ["document", "dataset"] }).notNull(),
  sourceType: text("source_type", { enum: ["document", "email", "web"] }).notNull(),
  sensitivity: text("sensitivity", { enum: ["public", "internal", "confidential", "restricted"] }).notNull(),
  content: text("content").notNull(),
});

/** Immutable policy versions. A new edit always creates a new row. */
export const policyVersions = pgTable(
  "policy_versions",
  {
    id: text("id").primaryKey(),
    policyId: text("policy_id").notNull(),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    document: jsonb("document").notNull(),
    documentHash: text("document_hash").notNull(),
    changeNote: text("change_note").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("policy_version_uq").on(t.policyId, t.version)],
);

/** Which policy version is active (single row per policy id). */
export const activePolicy = pgTable("active_policy", {
  policyId: text("policy_id").primaryKey(),
  version: integer("version").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const agentSessions = pgTable("agent_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  agentId: text("agent_id").notNull().references(() => agents.id),
  /** The original user request (trusted channel). Stored: it is the user's own input. */
  userPrompt: text("user_prompt").notNull(),
  mandate: jsonb("mandate").notNull(),
  planner: text("planner").notNull(),
  status: text("status", { enum: ["running", "awaiting_approval", "completed", "failed"] }).notNull(),
  finalMessage: text("final_message"),
  origin: text("origin", { enum: ["playground", "benchmark", "api"] }).notNull().default("playground"),
  createdAt: createdAt(),
});

export const provenanceSources = pgTable(
  "provenance_sources",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => agentSessions.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    trust: text("trust").notNull(),
    label: text("label").notNull(),
    /** Content hash only — content itself is not persisted in provenance records. */
    contentHash: text("content_hash").notNull(),
    sensitivity: text("sensitivity").notNull(),
    signals: jsonb("signals").$type<string[]>().notNull(),
    relatedToolCallId: text("related_tool_call_id"),
    createdAt: createdAt(),
  },
  (t) => [index("prov_session_idx").on(t.sessionId)],
);

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => agentSessions.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    agentId: text("agent_id").notNull(),
    tool: text("tool").notNull(),
    argsRedacted: jsonb("args_redacted").notNull(),
    argsHash: text("args_hash").notNull(),
    /**
     * Exact arguments retained ONLY while an approval is pending, because execution
     * after approval must use precisely what was approved. Cleared on execute/reject/expiry.
     */
    pendingArgs: jsonb("pending_args"),
    decision: text("decision", { enum: ["ALLOW", "REVIEW", "BLOCK"] }).notNull(),
    reasons: jsonb("reasons").notNull(),
    matchedRuleIds: jsonb("matched_rule_ids").$type<string[]>().notNull(),
    riskScore: integer("risk_score").notNull(),
    policyId: text("policy_id").notNull(),
    policyVersion: integer("policy_version").notNull(),
    provenance: jsonb("provenance").notNull(),
    status: text("status", {
      enum: ["blocked", "pending_approval", "executed", "rejected", "expired", "failed"],
    }).notNull(),
    rationale: text("rationale"),
    evalLatencyMs: real("eval_latency_ms").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("tool_calls_session_idx").on(t.sessionId), index("tool_calls_created_idx").on(t.createdAt)],
);

export const approvals = pgTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    toolCallId: text("tool_call_id").notNull().references(() => toolCalls.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    requestedFor: text("requested_for").notNull(),
    /** sha256(canonical({toolCallId, sessionId, userId, agentId, tool, args, policyId, policyVersion})) */
    bindingHash: text("binding_hash").notNull(),
    policyId: text("policy_id").notNull(),
    policyVersion: integer("policy_version").notNull(),
    status: text("status", { enum: ["pending", "approved", "rejected", "expired", "executed", "invalidated"] }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
    decisionNote: text("decision_note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("approvals_tool_call_uq").on(t.toolCallId), index("approvals_status_idx").on(t.status)],
);

/** One row per real execution. Unique constraints make double execution impossible. */
export const executions = pgTable(
  "executions",
  {
    id: text("id").primaryKey(),
    toolCallId: text("tool_call_id").notNull().references(() => toolCalls.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    approvalId: text("approval_id"),
    ok: boolean("ok").notNull(),
    resultSummary: jsonb("result_summary").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("executions_tool_call_uq").on(t.toolCallId), uniqueIndex("executions_idem_uq").on(t.idempotencyKey)],
);

/** Sandbox side effects of mock tools. Nothing here leaves the database. */
export const sandboxEffects = pgTable("sandbox_effects", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  toolCallId: text("tool_call_id").notNull(),
  tool: text("tool").notNull(),
  destination: text("destination").notNull(),
  summary: jsonb("summary").notNull(),
  createdAt: createdAt(),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    severity: text("severity", { enum: ["info", "warning", "critical"] }).notNull(),
    sessionId: text("session_id"),
    toolCallId: text("tool_call_id"),
    actorId: text("actor_id"),
    decision: text("decision"),
    reasonCodes: jsonb("reason_codes").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    payload: jsonb("payload").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt), index("audit_session_idx").on(t.sessionId)],
);

export const benchmarkRuns = pgTable("benchmark_runs", {
  id: text("id").primaryKey(),
  config: jsonb("config").notNull(),
  metrics: jsonb("metrics").notNull(),
  results: jsonb("results").notNull(),
  durationMs: real("duration_ms").notNull(),
  createdAt: createdAt(),
});
