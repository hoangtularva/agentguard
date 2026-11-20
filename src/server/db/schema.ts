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
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
/** Tenant of a row. The built-in demo is app "demo"; external apps get their own id. */
const appId = () => text("app_id").notNull().default("demo");

/**
 * An integrated application (tenant). Policies, agents, tools, sessions and audit are
 * scoped to it. Decision-token signing keys are derived from AUTH_SECRET + id + keyVersion,
 * so no signing secret is stored in the database.
 */
export const apps = pgTable("apps", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: text("created_by").notNull(),
  defaultPolicyId: text("default_policy_id").notNull(),
  tokenKeyVersion: integer("token_key_version").notNull().default(1),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
});

/** API keys: only a SHA-256 hash is stored; the plaintext is shown once at creation. */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    /** When set, the key can only act as this agent (per-agent credentials). */
    agentId: text("agent_id"),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    /** First characters of the key, for display ("agk_live_3f9a…"). */
    prefix: text("prefix").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull(),
    createdAt: createdAt(),
    lastUsedAt: ts("last_used_at"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [uniqueIndex("api_keys_hash_uq").on(t.keyHash), index("api_keys_app_idx").on(t.appId)],
);

/** Versioned tool descriptions (JSON Schema + kind/risk/argument roles) per app. */
export const toolSpecs = pgTable(
  "tool_specs",
  {
    id: text("id").primaryKey(),
    appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    spec: jsonb("spec").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tool_specs_version_uq").on(t.appId, t.name, t.version), index("tool_specs_app_idx").on(t.appId)],
);

/** Sensitivity labels for an app's resource ids (glob patterns; highest priority wins). */
export const resourceLabels = pgTable(
  "resource_labels",
  {
    id: text("id").primaryKey(),
    appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    pattern: text("pattern").notNull(),
    sensitivity: text("sensitivity", { enum: ["public", "internal", "confidential", "restricted"] }).notNull(),
    priority: integer("priority").notNull().default(0),
  },
  (t) => [index("resource_labels_app_idx").on(t.appId)],
);

/** Issued decision tokens (jti). consumed_at makes each token single use. */
export const decisionTokens = pgTable(
  "decision_tokens",
  {
    id: text("id").primaryKey(),
    appId: text("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    toolCallId: text("tool_call_id").notNull(),
    argsHash: text("args_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    consumedAt: ts("consumed_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("decision_tokens_call_uq").on(t.toolCallId)],
);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role", { enum: ["member", "approver", "admin"] }).notNull(),
  createdAt: createdAt(),
});

export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  appId: appId(),
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
    appId: appId(),
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
  appId: appId(),
  version: integer("version").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const agentSessions = pgTable("agent_sessions", {
  id: text("id").primaryKey(),
  appId: appId(),
  userId: text("user_id").notNull().references(() => users.id),
  agentId: text("agent_id").notNull().references(() => agents.id),
  /** The original user request (trusted channel). Stored: it is the user's own input. */
  userPrompt: text("user_prompt").notNull(),
  mandate: jsonb("mandate").notNull(),
  planner: text("planner").notNull(),
  status: text("status", { enum: ["running", "awaiting_approval", "completed", "failed"] }).notNull(),
  finalMessage: text("final_message"),
  origin: text("origin", { enum: ["playground", "benchmark", "api"] }).notNull().default("playground"),
  /** Policy bound at session start (null for sessions created before migration 0002). */
  policyId: text("policy_id"),
  /** Other agents that may act in this session (multi-agent hand-offs share one provenance record). */
  agentIds: jsonb("agent_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
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
    /** Normalized emails/URLs found in the content (or sent by a privacy-mode client); used to rebuild provenance across requests. */
    fingerprints: jsonb("fingerprints").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
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
    appId: appId(),
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
      enum: ["blocked", "pending_approval", "allowed", "executed", "rejected", "expired", "failed"],
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
    appId: appId(),
    toolCallId: text("tool_call_id").notNull().references(() => toolCalls.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    requestedFor: text("requested_for").notNull(),
    /** sha256(canonical({toolCallId, sessionId, userId, agentId, tool, args, policyId, policyVersion})) */
    bindingHash: text("binding_hash").notNull(),
    policyId: text("policy_id").notNull(),
    policyVersion: integer("policy_version").notNull(),
    status: text("status", { enum: ["pending", "approved", "rejected", "expired", "executed", "consumed", "invalidated"] }).notNull(),
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
    appId: appId(),
    type: text("type").notNull(),
    severity: text("severity", { enum: ["info", "warning", "critical"] }).notNull(),
    sessionId: text("session_id"),
    toolCallId: text("tool_call_id"),
    actorId: text("actor_id"),
    decision: text("decision"),
    reasonCodes: jsonb("reason_codes").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    payload: jsonb("payload").notNull(),
    createdAt: createdAt(),
    /** Tamper evidence: position in the hash chain and sha256(prev chain_hash ‖ canonical(event)). Set by the sealer. */
    chainPos: integer("chain_pos"),
    chainHash: text("chain_hash"),
  },
  (t) => [
    index("audit_created_idx").on(t.createdAt),
    index("audit_session_idx").on(t.sessionId),
    uniqueIndex("audit_chain_pos_uq").on(t.chainPos),
    index("audit_unsealed_idx").on(t.createdAt).where(sql`${t.chainPos} is null`),
  ],
);

export const benchmarkRuns = pgTable("benchmark_runs", {
  id: text("id").primaryKey(),
  config: jsonb("config").notNull(),
  metrics: jsonb("metrics").notNull(),
  results: jsonb("results").notNull(),
  durationMs: real("duration_ms").notNull(),
  createdAt: createdAt(),
});
