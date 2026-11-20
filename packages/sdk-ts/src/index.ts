/**
 * @agentguard/sdk — guard any agent's tool calls with an AgentGuard server.
 *
 *   const ag = new AgentGuard({ baseUrl, apiKey });
 *   const session = await ag.startSession({ userRef, agentId, prompt, mandate: { tools: ["send_email"] } });
 *   const sendEmail = session.guard("send_email", realSendEmail);   // same signature, now checked
 *
 * Safety defaults: fail closed (network error / timeout / 5xx ⇒ the call does not run), 2 s
 * timeout, privacy mode (content the agent reads is reduced to email/URL fingerprints + local
 * injection signals before it leaves the process).
 */
import { detectInjectionSignals, extractFingerprints } from "../../core/src/provenance";

export type Decision = "ALLOW" | "REVIEW" | "BLOCK";
export type Sensitivity = "public" | "internal" | "confidential" | "restricted";
export type SourceType = "document" | "email" | "web" | "tool_output" | "agent_message";

export interface Reason {
  code: string;
  message: string;
  ruleId?: string;
}

export interface CheckResult {
  callId: string;
  decision: Decision;
  status: "allowed" | "pending_approval" | "blocked";
  reasons: Reason[];
  policyId: string;
  policyVersion: number;
  riskScore: number;
  approvalId?: string;
  approvalExpiresAt?: string;
  decisionToken?: string;
  decisionTokenExpiresAt?: string;
}

export interface AgentGuardOptions {
  baseUrl: string;
  apiKey: string;
  /** Per-request timeout. Default 2000 ms. */
  timeoutMs?: number;
  /** Send fingerprints instead of content when registering sources/outputs. Default true. */
  privacy?: boolean;
  /**
   * "closed" (default): AgentGuard unreachable ⇒ nothing runs.
   * "allow-reads": guards marked `readOnly` may run when AgentGuard is unreachable. Sinks never fail open.
   */
  failMode?: "closed" | "allow-reads";
  fetch?: typeof fetch;
}

/** The call was not allowed. `decision` is BLOCK, or REVIEW that was rejected/expired/timed out. */
export class AgentGuardBlockedError extends Error {
  constructor(
    readonly tool: string,
    readonly decision: Decision | "UNAVAILABLE",
    readonly reasons: Reason[],
    readonly callId?: string,
  ) {
    super(`AgentGuard ${decision === "UNAVAILABLE" ? "unavailable (fail closed)" : decision} for ${tool}: ${reasons.map((r) => r.message).join(" ") || "no reason given"}`);
    this.name = "AgentGuardBlockedError";
  }
}

/** The call needs a human decision. Approve it in the Approval Inbox, then retry or wait. */
export class ApprovalRequiredError extends Error {
  constructor(
    readonly tool: string,
    readonly approvalId: string,
    readonly reasons: Reason[],
    readonly callId: string,
  ) {
    super(`Approval required for ${tool} (approval ${approvalId}): ${reasons.map((r) => r.message).join(" ")}`);
    this.name = "ApprovalRequiredError";
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error?: string; message?: string },
  ) {
    super(`${status} ${body.error ?? ""}: ${body.message ?? ""}`);
  }
}

export type Args = Record<string, unknown>;
export type ToolFn<R> = (args: Args, ctx: ToolContext) => R | Promise<R>;

export interface GuardOptions {
  /** REVIEW: wait for a human (polling) instead of throwing ApprovalRequiredError. */
  waitForApproval?: boolean | { timeoutMs?: number; intervalMs?: number };
  /** A read-only tool (may run under failMode "allow-reads" when AgentGuard is unreachable). */
  readOnly?: boolean;
  /** Register the tool's output as untrusted provenance for later calls. Default true. */
  reportOutput?: boolean;
  rationale?: string;
  /** Multi-agent: the call whose agent delegated this step (recorded in the audit trail). */
  parentCallId?: string;
}

export interface ToolContext {
  /** Signed, single-use proof for the tool backend (verify with @agentguard/sdk/verify or /v1/tokens/verify). */
  decisionToken?: string;
  callId: string;
}

export class AgentGuard {
  private readonly base: string;
  private readonly opts: Required<Omit<AgentGuardOptions, "fetch" | "baseUrl" | "apiKey">> & { fetch: typeof fetch };

  constructor(private readonly o: AgentGuardOptions) {
    this.base = o.baseUrl.replace(/\/+$/, "");
    this.opts = { timeoutMs: o.timeoutMs ?? 2000, privacy: o.privacy ?? true, failMode: o.failMode ?? "closed", fetch: o.fetch ?? fetch };
  }

  /** @internal */
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.opts.fetch(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.o.apiKey}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.opts.timeoutMs),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
    if (!res.ok) throw new HttpError(res.status, data);
    return data;
  }

  get privacy() {
    return this.opts.privacy;
  }
  get failMode() {
    return this.opts.failMode;
  }

  async startSession(p: {
    userRef: string;
    agentId: string;
    /** Other agents (sub-agents) that may act in this session; see `Session.as()`. */
    agents?: string[];
    /** The user's own request (trusted). Emails/URLs typed here become authorized destinations. */
    prompt: string;
    mandate: { tools: string[]; resources?: string[]; destinations?: string[] };
  }): Promise<Session> {
    const r = await this.request<{ sessionId: string }>("POST", "/v1/sessions", p);
    return new Session(this, r.sessionId, p.agentId);
  }

  /** Re-attach to an existing session (e.g. a sub-agent receiving a hand-off). */
  session(sessionId: string, agentId: string): Session {
    return new Session(this, sessionId, agentId);
  }

  approval(approvalId: string) {
    return this.request<{ status: string; expiresAt: string; callId: string }>("GET", `/v1/approvals/${encodeURIComponent(approvalId)}`);
  }

  /** Verify a decision token for exactly this tool + args (and consume it). Use in tool backends. */
  verifyToken(token: string, tool: string, args: Record<string, unknown>) {
    return this.request<{ valid: boolean; code?: string; message?: string; callId?: string }>("POST", "/v1/tokens/verify", { token, tool, args });
  }
}

/** Privacy mode payload for content: fingerprints + locally detected signals; full mode: the content. */
function provenancePayload(privacy: boolean, type: SourceType, content: string): { fingerprints?: string[]; signals?: string[]; content?: string } {
  return privacy ? { fingerprints: extractFingerprints(content), signals: detectInjectionSignals(type, content) } : { content };
}

const asText = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v) ?? "");

export class Session {
  constructor(
    private readonly ag: AgentGuard,
    readonly id: string,
    readonly agentId: string,
  ) {}

  /** The same session acting as another agent (multi-agent hand-off keeps provenance). */
  as(agentId: string): Session {
    return new Session(this.ag, this.id, agentId);
  }

  /** Register content the agent saw (documents, emails, web pages, other agents' messages) as UNTRUSTED. */
  addSource(p: { type: SourceType; label: string; content: string; sensitivity?: Sensitivity }) {
    return this.ag.request<{ sourceId: string }>("POST", `/v1/sessions/${this.id}/sources`, {
      type: p.type,
      label: p.label,
      sensitivity: p.sensitivity,
      ...provenancePayload(this.ag.privacy, p.type, p.content),
    });
  }

  check(tool: string, args: Record<string, unknown>, rationale?: string, parentCallId?: string): Promise<CheckResult> {
    return this.ag.request<CheckResult>("POST", "/v1/check", { sessionId: this.id, agentId: this.agentId, tool, args, rationale, parentCallId });
  }

  /**
   * Multi-agent hand-off: register what this agent tells `toAgent` as UNTRUSTED provenance (it may
   * carry what this agent read), then continue as `toAgent` in the same session.
   */
  async handoff(toAgent: string, message: string): Promise<Session> {
    await this.addSource({ type: "agent_message", label: `${this.agentId} → ${toAgent}`, content: message });
    return this.as(toAgent);
  }

  /** Poll until a human decides. Resolves with a decision token once approved (and consumed). */
  async waitForApproval(approvalId: string, o: { timeoutMs?: number; intervalMs?: number } = {}): Promise<{ decisionToken?: string; callId: string }> {
    const deadline = Date.now() + (o.timeoutMs ?? 10 * 60_000);
    for (;;) {
      const a = await this.ag.approval(approvalId);
      if (a.status === "approved")
        return this.ag.request<{ decisionToken?: string; callId: string }>("POST", `/v1/approvals/${encodeURIComponent(approvalId)}/consume`);
      if (a.status !== "pending" || Date.now() > deadline)
        throw new AgentGuardBlockedError("approval", "REVIEW", [{ code: `APPROVAL_${a.status.toUpperCase()}`, message: `Approval is ${a.status}.` }], a.callId);
      await new Promise((r) => setTimeout(r, o.intervalMs ?? 2000));
    }
  }

  reportResult(callId: string, p: { ok: boolean; output?: unknown; summary?: Record<string, unknown>; sensitivity?: Sensitivity }) {
    const out = p.output === undefined ? {} : provenancePayload(this.ag.privacy, "tool_output", asText(p.output));
    const body = { output: out.content, outputFingerprints: out.fingerprints, signals: out.signals };
    return this.ag.request("POST", `/v1/calls/${encodeURIComponent(callId)}/result`, { ok: p.ok, summary: p.summary, sensitivity: p.sensitivity, ...body });
  }

  /**
   * Wrap a tool implementation `(args, ctx) => result`. The wrapper takes `args`, checks the call
   * first and runs `fn` only on ALLOW (or after an approval). `ctx.decisionToken` lets the tool
   * backend verify that this exact call was allowed.
   */
  guard<R>(tool: string, fn: ToolFn<R>, o: GuardOptions = {}): (args: Args) => Promise<R> {
    return async (args: Args): Promise<R> => {
      let r: CheckResult;
      try {
        r = await this.check(tool, args, o.rationale, o.parentCallId);
      } catch (err) {
        const unavailable = !(err instanceof HttpError) || err.status >= 500 || err.status === 429;
        if (unavailable && o.readOnly && this.ag.failMode === "allow-reads") return fn(args, { callId: "unchecked" });
        throw new AgentGuardBlockedError(tool, unavailable ? "UNAVAILABLE" : "BLOCK", [{ code: "AGENTGUARD_ERROR", message: (err as Error).message }]);
      }
      let ctx: ToolContext = { callId: r.callId, decisionToken: r.decisionToken };
      if (r.decision === "BLOCK") throw new AgentGuardBlockedError(tool, "BLOCK", r.reasons, r.callId);
      if (r.decision === "REVIEW") {
        if (!o.waitForApproval) throw new ApprovalRequiredError(tool, r.approvalId!, r.reasons, r.callId);
        const w = await this.waitForApproval(r.approvalId!, typeof o.waitForApproval === "object" ? o.waitForApproval : {});
        ctx = { callId: w.callId, decisionToken: w.decisionToken };
      }
      let out: R;
      try {
        out = await fn(args, ctx);
      } catch (err) {
        await this.reportResult(ctx.callId, { ok: false, summary: { error: String((err as Error).message).slice(0, 200) } }).catch(() => {});
        throw err;
      }
      await this.reportResult(ctx.callId, { ok: true, output: o.reportOutput === false ? undefined : out }).catch(() => {});
      return out;
    };
  }
}

/** Wrap every function in a record (e.g. a tool map passed to an agent framework). */
export function guardTools<T extends Record<string, ToolFn<unknown>>>(
  session: Session,
  tools: T,
  o: Partial<Record<keyof T, GuardOptions>> = {},
): { [K in keyof T]: (args: Args) => Promise<Awaited<ReturnType<T[K]>>> } {
  const out: Record<string, (args: Args) => Promise<unknown>> = {};
  for (const [name, fn] of Object.entries(tools)) out[name] = session.guard(name, fn, o[name as keyof T]);
  return out as { [K in keyof T]: (args: Args) => Promise<Awaited<ReturnType<T[K]>>> };
}

export { verifyDecisionToken } from "../../core/src/decision-token";
export { DecisionVerifier, type VerifierOptions, type VerifyResult } from "./verify";
