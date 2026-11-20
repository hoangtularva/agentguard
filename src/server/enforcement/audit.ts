import { randomUUID } from "node:crypto";
import { redactDeep } from "@/server/core/redact";
import type { DB } from "@/server/db/client";
import { auditEvents } from "@/server/db/schema";

export type AuditEventType =
  | "session.started"
  | "session.completed"
  | "tool_call.evaluated"
  | "tool_call.executed"
  | "tool_call.failed"
  | "approval.requested"
  | "approval.approved"
  | "approval.rejected"
  | "approval.execution_denied"
  | "approval.executed"
  | "approval.consumed"
  | "tool_call.allowed"
  | "tool_call.result_reported"
  | "decision_token.verified"
  | "app.created"
  | "api_key.created"
  | "api_key.revoked"
  | "tool_spec.saved"
  | "agent.saved"
  | "policy.version_created"
  | "policy.activated"
  | "benchmark.completed";

export interface AuditInput {
  type: AuditEventType;
  /** Tenant; omitted means the built-in demo app. */
  appId?: string;
  severity?: "info" | "warning" | "critical";
  sessionId?: string | null;
  toolCallId?: string | null;
  actorId?: string | null;
  decision?: string | null;
  reasonCodes?: string[];
  payload?: Record<string, unknown>;
}

type Tx = Pick<DB, "insert">;

/** Append-only audit writer. Payloads pass through secret redaction before persistence. */
export async function writeAudit(db: Tx, e: AuditInput): Promise<void> {
  await db.insert(auditEvents).values({
    id: `evt_${randomUUID()}`,
    ...(e.appId ? { appId: e.appId } : {}),
    type: e.type,
    severity: e.severity ?? "info",
    sessionId: e.sessionId ?? null,
    toolCallId: e.toolCallId ?? null,
    actorId: e.actorId ?? null,
    decision: e.decision ?? null,
    reasonCodes: e.reasonCodes ?? [],
    payload: redactDeep(e.payload ?? {}) as Record<string, unknown>,
  });
}
