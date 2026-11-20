/**
 * Tool-side verification: the tool itself refuses calls that AgentGuard did not allow.
 *
 * Put this in the service that performs the side effect (mail sender, payment API, file store).
 * Even if an agent runtime is compromised or simply forgets to call AgentGuard, the tool only
 * acts on a valid, unused decision token that covers exactly this tool + arguments.
 */
import { type DecisionTokenPayload, verifyDecisionToken } from "../../core/src/decision-token";

export type VerifyResult = { valid: true; payload?: DecisionTokenPayload; callId?: string } | { valid: false; code: string; message: string };

export interface VerifierOptions {
  /**
   * Offline mode: the app's token key (`npm run admin -- token-key <app>`). Single use is enforced
   * per process with an in-memory cache, so run one verifier instance per tool service or use
   * online mode when the tool is replicated.
   */
  key?: string;
  /** Offline mode for Ed25519 (agt2) tokens: the app's public key from GET /v1/keys/:appId. No secret needed. */
  publicKey?: string;
  appId?: string;
  /** Online mode: AgentGuard base URL + an API key with scope `verify` (server-side single use). */
  server?: { baseUrl: string; apiKey: string; timeoutMs?: number; fetch?: typeof fetch };
}

export class DecisionVerifier {
  private readonly seen = new Map<string, number>();

  constructor(private readonly o: VerifierOptions) {
    if (!o.key && !o.publicKey && !o.server) throw new Error("DecisionVerifier needs `publicKey` or `key` (offline), or `server` (online).");
  }

  async verify(token: string | null | undefined, tool: string, args: Record<string, unknown>): Promise<VerifyResult> {
    if (!token) return { valid: false, code: "MISSING", message: "No AgentGuard decision token." };
    if (this.o.server) return this.online(token, tool, args);
    const now = Math.floor(Date.now() / 1000);
    const r = verifyDecisionToken(token, { key: this.o.key, publicKey: this.o.publicKey, tool, args, appId: this.o.appId, nowSeconds: now });
    if (!r.ok) return { valid: false, code: r.code, message: r.message };
    for (const [jti, exp] of this.seen) if (exp < now) this.seen.delete(jti);
    if (this.seen.has(r.payload.jti)) return { valid: false, code: "REPLAYED", message: "Token was already used." };
    this.seen.set(r.payload.jti, r.payload.exp);
    return { valid: true, payload: r.payload, callId: r.payload.call };
  }

  private async online(token: string, tool: string, args: Record<string, unknown>): Promise<VerifyResult> {
    const s = this.o.server!;
    try {
      const res = await (s.fetch ?? fetch)(`${s.baseUrl.replace(/\/+$/, "")}/v1/tokens/verify`, {
        method: "POST",
        headers: { authorization: `Bearer ${s.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ token, tool, args }),
        signal: AbortSignal.timeout(s.timeoutMs ?? 2000),
      });
      const j = (await res.json()) as { valid?: boolean; code?: string; message?: string; callId?: string };
      if (!res.ok) return { valid: false, code: "VERIFY_FAILED", message: `${res.status} ${j.code ?? ""}` };
      return j.valid ? { valid: true, callId: j.callId } : { valid: false, code: j.code ?? "INVALID", message: j.message ?? "" };
    } catch (err) {
      // Fail closed: no verdict means no side effect.
      return { valid: false, code: "UNAVAILABLE", message: (err as Error).message };
    }
  }

  /**
   * Wrap a fetch-style HTTP handler (Next.js route, Hono, Bun, Deno, Workers). The request must carry
   * `X-AgentGuard-Token` and a JSON body equal to the tool arguments; otherwise 403.
   */
  protect(tool: string, handler: (req: Request, args: Record<string, unknown>) => Response | Promise<Response>) {
    return async (req: Request): Promise<Response> => {
      let args: Record<string, unknown>;
      try {
        args = (await req.clone().json()) as Record<string, unknown>;
      } catch {
        return Response.json({ error: "invalid_json" }, { status: 400 });
      }
      const v = await this.verify(req.headers.get("x-agentguard-token"), tool, args);
      if (!v.valid) return Response.json({ error: "agentguard_denied", code: v.code, message: v.message }, { status: 403 });
      return handler(req, args);
    };
  }
}
