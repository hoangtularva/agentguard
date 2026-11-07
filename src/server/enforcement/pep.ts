/**
 * Policy Enforcement Point (PEP).
 *
 * The ONLY production path from an agent's proposed tool call to a tool executor.
 * Flow for every call:
 *   validate args (Zod) -> verify identities -> resolve resources -> trace provenance
 *   -> PDP decision -> persist + audit -> ALLOW: execute | REVIEW: bind approval | BLOCK: refuse
 *
 * Approved actions are executed by `executeApprovedAction`, which re-verifies the
 * binding inside a row-locked transaction and records a uniquely-keyed execution.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { computeBindingHash } from "@/server/core/approval-binding";
import { hashCanonical } from "@/server/core/canonical";
import { type PolicyDecision, type PolicyInput, evaluatePolicy } from "@/server/core/policy-engine";
import type { PolicyRef } from "@/server/core/policy-schema";
import { extractDestinations, makeSource, normalizeValue, traceArgument } from "@/server/core/provenance";
import { redactArgs } from "@/server/core/redact";
import {
  type Mandate,
  MandateSchema,
  type ProvenanceSource,
  type Sensitivity,
  type UserRole,
  maxSensitivity,
} from "@/server/core/types";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { type Corpus, type ExecResult, getExecutor } from "@/server/tools/executors";
import { destinationOf, getTool, resourcesOf } from "@/server/tools/registry";
import { writeAudit } from "./audit";
import type { PolicyResolver } from "./policy-store";

export interface SessionState {
  id: string;
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

export interface ProvenanceSnapshot {
  dataSensitivity: Sensitivity;
  destination?: PolicyInput["destination"];
  sourcesInContext: { id: string; type: string; trust: string; label: string; sensitivity: string; signals: string[] }[];
  signals: string[];
}

export interface PepOptions {
  corpus: Corpus;
  resolvePolicy: PolicyResolver;
  now?: () => Date;
}

const newId = (p: string) => `${p}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

export class EnforcementPoint {
  constructor(
    private readonly db: DB,
    private readonly opts: PepOptions,
  ) {}

  private now() {
    return this.opts.now ? this.opts.now() : new Date();
  }

  /**
   * Start an agent session. The mandate is the user's explicit authorization:
   * selected tools ∩ the agent's registered tools, selected resource scope, and
   * destinations the user typed in the (trusted) prompt or added explicitly.
   */
  async startSession(params: {
    userId: string;
    agentId: string;
    prompt: string;
    mandate: { allowedTools: string[]; resourceScope: string[]; destinations?: string[] };
    planner: string;
    origin?: "playground" | "benchmark" | "api";
    policyId: string;
  }): Promise<SessionState> {
    const [user] = await this.db.select().from(s.users).where(eq(s.users.id, params.userId)).limit(1);
    if (!user) throw new Error("Unknown user");
    const [agent] = await this.db.select().from(s.agents).where(eq(s.agents.id, params.agentId)).limit(1);
    if (!agent || !agent.active) throw new Error("Unknown or inactive agent");

    const destinations = [
      ...new Set([...(params.mandate.destinations ?? []).map(normalizeValue), ...extractDestinations(params.prompt)]),
    ];
    const mandate = MandateSchema.parse({
      allowedTools: params.mandate.allowedTools.filter((t) => agent.allowedTools.includes(t) && getTool(t)),
      resourceScope: params.mandate.resourceScope,
      destinations,
    });

    const id = newId("ses");
    await this.db.insert(s.agentSessions).values({
      id,
      userId: user.id,
      agentId: agent.id,
      userPrompt: params.prompt,
      mandate,
      planner: params.planner,
      status: "running",
      origin: params.origin ?? "playground",
    });
    const state: SessionState = {
      id,
      userId: user.id,
      agentId: agent.id,
      policyId: params.policyId,
      mandate,
      sources: [],
      readSensitivity: "public",
    };
    await this.addSource(state, makeSource({ type: "user_prompt", label: "User request", content: params.prompt }));
    await writeAudit(this.db, {
      type: "session.started",
      sessionId: id,
      actorId: user.id,
      payload: { agentId: agent.id, planner: params.planner, mandate },
    });
    return state;
  }

  private async addSource(state: SessionState, src: ProvenanceSource) {
    state.sources.push(src);
    await this.db.insert(s.provenanceSources).values({
      id: src.id,
      sessionId: state.id,
      type: src.type,
      trust: src.trust,
      label: src.label,
      contentHash: src.contentHash,
      sensitivity: src.sensitivity,
      signals: src.signals,
      relatedToolCallId: src.relatedToolCallId ?? null,
    });
  }

  /** Build the PDP input. Every security-relevant fact is computed server-side. */
  private async buildInput(
    state: SessionState,
    call: ProposedToolCall,
  ): Promise<{ input: PolicyInput; args?: Record<string, unknown>; snapshot: ProvenanceSnapshot }> {
    const tool = getTool(call.tool);
    const sourcesInContext = state.sources.map((x) => ({
      id: x.id,
      type: x.type,
      trust: x.trust,
      label: x.label,
      sensitivity: x.sensitivity,
      signals: x.signals,
    }));
    const signals = [...new Set(state.sources.flatMap((x) => x.signals))].sort();
    const untrustedContext = state.sources.some((x) => x.trust === "untrusted_external");

    // Identity: the session row is the source of truth, not the caller's claim.
    const [row] = await this.db.select().from(s.agentSessions).where(eq(s.agentSessions.id, state.id)).limit(1);
    const [user] = row ? await this.db.select().from(s.users).where(eq(s.users.id, row.userId)).limit(1) : [];
    const [agent] = row ? await this.db.select().from(s.agents).where(eq(s.agents.id, row.agentId)).limit(1) : [];
    const identity = {
      userOk: !!row && !!user && row.userId === state.userId,
      agentOk: !!row && !!agent && agent.active && row.agentId === call.agentId && agent.allowedTools.includes(call.tool),
      userRole: (user?.role ?? "member") as UserRole,
    };

    const base = {
      identity,
      mandate: state.mandate,
      untrustedContext,
      signals,
    };
    if (!tool) {
      const snapshot = { dataSensitivity: state.readSensitivity, sourcesInContext, signals };
      return {
        snapshot,
        input: {
          ...base,
          tool: { name: call.tool, risk: "critical", kind: "sink", known: false },
          argsValid: false,
          resources: [],
          dataSensitivity: state.readSensitivity,
        },
      };
    }
    const parsed = tool.argsSchema.safeParse(call.args);
    if (!parsed.success) {
      const snapshot = { dataSensitivity: state.readSensitivity, sourcesInContext, signals };
      return {
        snapshot,
        input: {
          ...base,
          tool: { name: tool.name, risk: tool.risk, kind: tool.kind, known: true },
          argsValid: false,
          argsErrors: parsed.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`),
          resources: [],
          dataSensitivity: state.readSensitivity,
        },
      };
    }
    const args = parsed.data;
    const resources = resourcesOf(tool, args).map((id) => {
      const item = this.opts.corpus.get(id);
      return { id, exists: !!item, sensitivity: (item?.sensitivity ?? "restricted") as Sensitivity };
    });
    const resourceSensitivity = maxSensitivity(resources.map((r) => r.sensitivity));
    const dataSensitivity =
      tool.kind === "sink" ? maxSensitivity([state.readSensitivity, resourceSensitivity]) : resourceSensitivity;

    const destValue = destinationOf(tool, args);
    const destination = destValue
      ? {
          value: normalizeValue(destValue),
          inMandate: state.mandate.destinations.includes(normalizeValue(destValue)),
          origin: traceArgument(destValue, state.sources),
        }
      : undefined;

    return {
      args,
      snapshot: { dataSensitivity, destination, sourcesInContext, signals },
      input: {
        ...base,
        tool: { name: tool.name, risk: tool.risk, kind: tool.kind, known: true },
        argsValid: true,
        resources,
        destination,
        dataSensitivity,
      },
    };
  }

  /** Enforce a single proposed tool call. Never throws for policy outcomes. */
  async enforce(state: SessionState, call: ProposedToolCall): Promise<EnforcementResult> {
    const t0 = performance.now();
    const { input, args, snapshot } = await this.buildInput(state, call);

    let policy: PolicyRef | undefined;
    let decision: PolicyDecision;
    const e0 = performance.now();
    try {
      policy = await this.opts.resolvePolicy(state.policyId);
      decision = evaluatePolicy(input, policy);
    } catch (err) {
      // Fail closed: no loadable policy means no execution.
      decision = {
        decision: "BLOCK",
        reasons: [{ code: "NO_MATCHING_POLICY", message: `Policy unavailable: ${(err as Error).message}`, effect: "BLOCK" }],
        matchedRuleIds: [],
        policyId: state.policyId,
        policyVersion: 0,
        riskScore: 100,
      };
    }
    const evalLatencyMs = performance.now() - e0;

    const tool = getTool(call.tool);
    const toolCallId = newId("tc");
    const argsForAudit = redactArgs(tool, args ?? call.args);
    const argsHash = hashCanonical(args ?? call.args ?? null);
    const status: CallStatus =
      decision.decision === "BLOCK" ? "blocked" : decision.decision === "REVIEW" ? "pending_approval" : "executed";

    await this.db.insert(s.toolCalls).values({
      id: toolCallId,
      sessionId: state.id,
      userId: state.userId,
      agentId: call.agentId,
      tool: call.tool.slice(0, 100),
      argsRedacted: argsForAudit ?? {},
      argsHash,
      pendingArgs: decision.decision === "REVIEW" ? args : null,
      decision: decision.decision,
      reasons: decision.reasons,
      matchedRuleIds: decision.matchedRuleIds,
      riskScore: decision.riskScore,
      policyId: decision.policyId,
      policyVersion: decision.policyVersion,
      provenance: snapshot,
      // ALLOW starts as "failed" and is flipped to "executed" only inside the execution transaction.
      status: decision.decision === "ALLOW" ? "failed" : status,
      rationale: call.rationale?.slice(0, 1000) ?? null,
      evalLatencyMs,
    });
    await writeAudit(this.db, {
      type: "tool_call.evaluated",
      severity: decision.decision === "BLOCK" ? "critical" : decision.decision === "REVIEW" ? "warning" : "info",
      sessionId: state.id,
      toolCallId,
      actorId: call.agentId,
      decision: decision.decision,
      reasonCodes: [...new Set(decision.reasons.map((r) => r.code))],
      payload: {
        tool: call.tool,
        args: argsForAudit,
        matchedRuleIds: decision.matchedRuleIds,
        policyVersion: decision.policyVersion,
        riskScore: decision.riskScore,
        destination: snapshot.destination,
        dataSensitivity: snapshot.dataSensitivity,
        signals: snapshot.signals,
      },
    });

    const result: EnforcementResult = {
      toolCallId,
      tool: call.tool,
      decision,
      status,
      provenance: snapshot,
      evalLatencyMs,
      totalLatencyMs: 0,
    };

    if (decision.decision === "ALLOW" && args && tool) {
      const exec = await this.runExecution(state.id, toolCallId, call.tool, args, `auto:${toolCallId}`, null, call.agentId);
      result.status = exec.ok ? "executed" : "failed";
      result.output = exec.output;
      result.execSummary = exec.summary;
      if (exec.ok) await this.ingestOutput(state, toolCallId, call.tool, exec);
    } else if (decision.decision === "REVIEW" && args && policy) {
      const ttl = policy.document.approvalTtlSeconds;
      const expiresAt = new Date(this.now().getTime() + ttl * 1000);
      const approvalId = newId("apr");
      await this.db.insert(s.approvals).values({
        id: approvalId,
        toolCallId,
        sessionId: state.id,
        requestedFor: state.userId,
        bindingHash: computeBindingHash({
          toolCallId,
          sessionId: state.id,
          userId: state.userId,
          agentId: call.agentId,
          tool: call.tool,
          args,
          policyId: policy.policyId,
          policyVersion: policy.version,
        }),
        policyId: policy.policyId,
        policyVersion: policy.version,
        status: "pending",
        expiresAt,
      });
      await writeAudit(this.db, {
        type: "approval.requested",
        severity: "warning",
        sessionId: state.id,
        toolCallId,
        actorId: call.agentId,
        decision: "REVIEW",
        payload: { approvalId, expiresAt: expiresAt.toISOString(), tool: call.tool },
      });
      result.approvalId = approvalId;
      result.approvalExpiresAt = expiresAt.toISOString();
      await this.db.update(s.agentSessions).set({ status: "awaiting_approval" }).where(eq(s.agentSessions.id, state.id));
    }

    result.totalLatencyMs = performance.now() - t0;
    return result;
  }

  /** Register what a tool returned as UNTRUSTED provenance (data, never instructions). */
  async ingestOutput(state: SessionState, toolCallId: string, tool: string, exec: ExecResult) {
    if (tool === "read_documents") {
      for (const item of exec.readItems) {
        await this.addSource(
          state,
          makeSource({
            type: item.sourceType,
            label: item.id,
            content: item.content,
            sensitivity: item.sensitivity,
            relatedToolCallId: toolCallId,
          }),
        );
        state.readSensitivity = maxSensitivity([state.readSensitivity, item.sensitivity]);
      }
    } else {
      await this.addSource(
        state,
        makeSource({ type: "tool_output", label: `${tool} result`, content: exec.output, relatedToolCallId: toolCallId }),
      );
    }
  }

  /**
   * Execute inside a transaction with a unique idempotency key. When `outerTx` is given
   * the execution joins it, so that claim + side effects + execution record commit or
   * roll back together.
   */
  private async runExecution(
    sessionId: string,
    toolCallId: string,
    tool: string,
    args: Record<string, unknown>,
    idempotencyKey: string,
    approvalId: string | null,
    actorId: string,
    outerTx?: DB,
  ): Promise<ExecResult> {
    const executor = getExecutor(tool);
    if (!executor) throw new Error(`No executor for ${tool}`);
    const body = async (tx: DB) => {
      const exec = await executor(args, {
        sessionId,
        toolCallId,
        corpus: this.opts.corpus,
        recordEffect: async (e) => {
          await tx.insert(s.sandboxEffects).values({ id: newId("fx"), sessionId, toolCallId, ...e });
        },
      });
      await tx.insert(s.executions).values({
        id: newId("ex"),
        toolCallId,
        idempotencyKey,
        approvalId,
        ok: exec.ok,
        resultSummary: exec.summary,
      });
      await tx
        .update(s.toolCalls)
        .set({ status: exec.ok ? "executed" : "failed", pendingArgs: null })
        .where(eq(s.toolCalls.id, toolCallId));
      await writeAudit(tx, {
        type: exec.ok ? "tool_call.executed" : "tool_call.failed",
        severity: exec.ok ? "info" : "warning",
        sessionId,
        toolCallId,
        actorId,
        payload: { tool, summary: exec.summary, approvalId, idempotencyKey },
      });
      return exec;
    };
    return outerTx ? body(outerTx) : this.db.transaction(async (tx) => body(tx as unknown as DB));
  }

  /**
   * Execute an APPROVED action exactly once.
   * Checks (all inside one transaction holding a row lock on the approval):
   *  - approval exists, status = approved, not expired
   *  - caller is the session owner or an approver
   *  - optional caller-supplied args equal the approved args (no post-approval edits)
   *  - binding hash recomputed from stored args + CURRENT active policy version matches
   *  - no prior execution (unique tool_call_id + idempotency key)
   * Retrying with the SAME idempotency key returns the original result without re-executing.
   */
  async executeApprovedAction(params: {
    approvalId: string;
    actorId: string;
    idempotencyKey: string;
    args?: unknown;
  }): Promise<ApprovalExecutionOutcome> {
    const deny = async (code: ApprovalDenyCode, message: string, sessionId?: string, toolCallId?: string) => {
      await writeAudit(this.db, {
        type: "approval.execution_denied",
        severity: "critical",
        sessionId,
        toolCallId,
        actorId: params.actorId,
        decision: "BLOCK",
        reasonCodes: [code],
        payload: { approvalId: params.approvalId, message },
      });
      return { ok: false as const, code, message };
    };

    // Idempotent retry: same key already executed -> return stored result, no side effect.
    const [prior] = await this.db
      .select()
      .from(s.executions)
      .where(eq(s.executions.idempotencyKey, params.idempotencyKey))
      .limit(1);
    if (prior) {
      if (prior.approvalId !== params.approvalId)
        return deny("IDEMPOTENCY_KEY_REUSED", "Idempotency key belongs to a different action.");
      return { ok: true, replayed: true, toolCallId: prior.toolCallId, summary: prior.resultSummary as Record<string, unknown> };
    }

    type Prepared =
      | { kind: "deny"; code: ApprovalDenyCode; message: string; sessionId?: string; toolCallId?: string }
      | { kind: "go"; sessionId: string; toolCallId: string; tool: string; exec: ExecResult };

    let prepared: Prepared;
    try {
      prepared = await this.db.transaction(async (tx) => {
        const [apr] = await tx
          .select()
          .from(s.approvals)
          .where(eq(s.approvals.id, params.approvalId))
          .for("update")
          .limit(1);
        if (!apr) return { kind: "deny", code: "APPROVAL_NOT_FOUND", message: "Approval not found." } as Prepared;
        const ctx = { sessionId: apr.sessionId, toolCallId: apr.toolCallId };
        const [tc] = await tx.select().from(s.toolCalls).where(eq(s.toolCalls.id, apr.toolCallId)).limit(1);
        const [actor] = await tx.select().from(s.users).where(eq(s.users.id, params.actorId)).limit(1);
        if (!tc) return { kind: "deny", code: "APPROVAL_NOT_FOUND", message: "Tool call missing.", ...ctx } as Prepared;
        if (!actor || (actor.id !== apr.requestedFor && actor.role === "member"))
          return { kind: "deny", code: "NOT_AUTHORIZED", message: "Caller may not execute this approval.", ...ctx } as Prepared;
        if (apr.status === "executed" || tc.status === "executed")
          return { kind: "deny", code: "APPROVAL_ALREADY_USED", message: "Approval was already used (replay).", ...ctx } as Prepared;
        if (apr.status !== "approved")
          return { kind: "deny", code: "APPROVAL_NOT_APPROVED", message: `Approval status is ${apr.status}.`, ...ctx } as Prepared;
        if (this.now().getTime() > apr.expiresAt.getTime()) {
          await tx.update(s.approvals).set({ status: "expired" }).where(eq(s.approvals.id, apr.id));
          await tx.update(s.toolCalls).set({ status: "expired", pendingArgs: null }).where(eq(s.toolCalls.id, tc.id));
          return { kind: "deny", code: "APPROVAL_EXPIRED", message: "Approval expired.", ...ctx } as Prepared;
        }
        const stored = tc.pendingArgs as Record<string, unknown> | null;
        if (!stored) return { kind: "deny", code: "ARGS_TAMPERED", message: "Approved arguments are missing.", ...ctx } as Prepared;
        if (params.args !== undefined && hashCanonical(params.args) !== hashCanonical(stored))
          return {
            kind: "deny",
            code: "ARGS_MISMATCH",
            message: "Arguments differ from what was approved; approval does not cover them.",
            ...ctx,
          } as Prepared;

        let current: PolicyRef;
        try {
          current = await this.opts.resolvePolicy(apr.policyId, tx as unknown as DB);
        } catch {
          return { kind: "deny", code: "POLICY_CHANGED", message: "Bound policy is no longer available.", ...ctx } as Prepared;
        }
        if (current.version !== apr.policyVersion) {
          await tx.update(s.approvals).set({ status: "invalidated" }).where(eq(s.approvals.id, apr.id));
          await tx.update(s.toolCalls).set({ status: "expired", pendingArgs: null }).where(eq(s.toolCalls.id, tc.id));
          return {
            kind: "deny",
            code: "POLICY_CHANGED",
            message: `Policy changed from v${apr.policyVersion} to v${current.version} while pending; re-request approval.`,
            ...ctx,
          } as Prepared;
        }
        const recomputed = computeBindingHash({
          toolCallId: tc.id,
          sessionId: tc.sessionId,
          userId: tc.userId,
          agentId: tc.agentId,
          tool: tc.tool,
          args: stored,
          policyId: current.policyId,
          policyVersion: current.version,
        });
        if (recomputed !== apr.bindingHash)
          return { kind: "deny", code: "ARGS_TAMPERED", message: "Binding hash mismatch: action changed after approval.", ...ctx } as Prepared;

        // Claim the approval atomically while the row is locked.
        const claimed = await tx
          .update(s.approvals)
          .set({ status: "executed" })
          .where(and(eq(s.approvals.id, apr.id), eq(s.approvals.status, "approved")))
          .returning({ id: s.approvals.id });
        if (claimed.length !== 1)
          return { kind: "deny", code: "APPROVAL_ALREADY_USED", message: "Approval was claimed concurrently.", ...ctx } as Prepared;

        // Execute in the SAME transaction: if the side effect or the uniquely-keyed
        // execution record fails, the claim rolls back too (no "used but never ran" state).
        const exec = await this.runExecution(
          tc.sessionId,
          tc.id,
          tc.tool,
          stored,
          params.idempotencyKey,
          params.approvalId,
          params.actorId,
          tx as unknown as DB,
        );
        await writeAudit(tx, {
          type: "approval.executed",
          sessionId: tc.sessionId,
          toolCallId: tc.id,
          actorId: params.actorId,
          decision: "ALLOW",
          payload: { approvalId: params.approvalId },
        });
        return { kind: "go", ...ctx, tool: tc.tool, exec } as Prepared;
      });
    } catch (err) {
      // Unique constraint on executions(tool_call_id | idempotency_key), serialization or
      // connection failure: the whole transaction (claim + effects) was rolled back.
      const msg = (err as Error).message;
      const dup = /duplicate key|unique/i.test(msg + String((err as { cause?: unknown }).cause ?? ""));
      return deny(dup ? "APPROVAL_ALREADY_USED" : "EXECUTION_CONFLICT", `${dup ? "Duplicate execution prevented" : "Execution failed and was rolled back"}: ${msg}`);
    }

    if (prepared.kind === "deny") return deny(prepared.code, prepared.message, prepared.sessionId, prepared.toolCallId);
    const exec = prepared.exec;
    return { ok: true, replayed: false, toolCallId: prepared.toolCallId, summary: exec.summary, output: exec.output, exec };
  }
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
  | {
      ok: true;
      replayed: boolean;
      toolCallId: string;
      summary: Record<string, unknown>;
      output?: string;
      exec?: ExecResult;
    };
