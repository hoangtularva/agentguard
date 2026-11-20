import type { PolicyDecision, PolicyInput } from "@/server/core/policy-engine";
import type { CorpusItem, Mandate, ProvenanceSource, Sensitivity } from "@/server/core/types";

/** In-memory state of one agent session (sources keep content for provenance matching only). */
export interface SessionState {
  id: string;
  appId: string;
  userId: string;
  agentId: string;
  policyId: string;
  mandate: Mandate;
  sources: ProvenanceSource[];
  readSensitivity: Sensitivity;
}

export interface ProposedToolCall {
  tool: string;
  args: unknown;
  /** Identity the agent runtime claims; must match the session's agent. */
  agentId: string;
  rationale?: string;
}

export type CallStatus = "blocked" | "pending_approval" | "executed" | "failed";

export interface ProvenanceSnapshot {
  dataSensitivity: Sensitivity;
  destination?: PolicyInput["destination"];
  sourcesInContext: { id: string; type: string; trust: string; label: string; sensitivity: string; signals: string[] }[];
  signals: string[];
}

export interface EnforcementResult {
  toolCallId: string;
  tool: string;
  decision: PolicyDecision;
  status: CallStatus;
  output?: string;
  execSummary?: Record<string, unknown>;
  approvalId?: string;
  approvalExpiresAt?: string;
  provenance: ProvenanceSnapshot;
  evalLatencyMs: number;
  totalLatencyMs: number;
}

/** A side effect recorded by a (mock) tool. */
export interface SandboxEffect {
  tool: string;
  destination: string;
  summary: Record<string, unknown>;
}

export interface ExecResult {
  ok: boolean;
  /** Text returned to the agent (becomes an UNTRUSTED provenance source). */
  output: string;
  /** Redacted summary for audit and UI. */
  summary: Record<string, unknown>;
  /** Corpus items whose content entered the agent context. */
  readItems: CorpusItem[];
}

export type ApprovalDenyCode =
  | "APPROVAL_NOT_FOUND"
  | "NOT_AUTHORIZED"
  | "APPROVAL_ALREADY_USED"
  | "APPROVAL_NOT_APPROVED"
  | "APPROVAL_EXPIRED"
  | "ARGS_MISMATCH"
  | "ARGS_TAMPERED"
  | "POLICY_CHANGED"
  | "IDEMPOTENCY_KEY_REUSED"
  | "EXECUTION_CONFLICT";

export type ApprovalExecutionOutcome =
  | { ok: false; code: ApprovalDenyCode; message: string }
  | { ok: true; replayed: boolean; toolCallId: string; summary: Record<string, unknown>; output?: string; exec?: ExecResult };
