import "server-only";
import type { z } from "zod";
import { getDb } from "@/server/db/client";
import type { DB } from "@/server/db/client";
import { json, parseBody } from "@/server/http";
import { type ApiPrincipal, type ApiScope, authenticateApiKey } from "./apps";
import { ApiError } from "./service";

/** Per-key token bucket (in-process): sustained rate req/s (AGENTGUARD_V1_RATE, default 50), bursts up to 2× the rate. */
const rate = () => Math.max(1, Number(process.env.AGENTGUARD_V1_RATE) || 50);
const g = globalThis as unknown as { __agBuckets?: Map<string, { tokens: number; at: number }> };

function take(keyId: string): boolean {
  g.__agBuckets ??= new Map();
  const now = Date.now();
  const burst = rate() * 2;
  const b = g.__agBuckets.get(keyId) ?? { tokens: burst, at: now };
  b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * rate());
  b.at = now;
  const ok = b.tokens >= 1;
  if (ok) b.tokens -= 1;
  g.__agBuckets.set(keyId, b);
  return ok;
}

type Ctx = { req: Request; db: DB; principal: ApiPrincipal; params: Record<string, string> };

/**
 * Controller wrapper for /v1: Bearer API key → scope → rate limit → handler → JSON.
 * Errors never leak internals. Cookies are ignored entirely, so there is no CSRF surface,
 * and no CORS headers are sent, so browsers cannot read responses cross-origin.
 */
export function v1(scope: ApiScope, handler: (ctx: Ctx) => Promise<unknown>) {
  return async (req: Request, route?: { params?: Promise<Record<string, string>> }) => {
    try {
      const db = await getDb();
      const principal = await authenticateApiKey(db, req.headers.get("authorization"));
      if (!principal) return json({ error: "unauthenticated", message: "Send a valid API key: Authorization: Bearer agk_…" }, 401);
      if (!principal.scopes.includes(scope)) return json({ error: "forbidden", message: `This key lacks the "${scope}" scope.` }, 403);
      // Defence in depth for keys created before this rule: bound keys never administer the app.
      if (scope === "admin" && principal.agentId) return json({ error: "forbidden", message: "Agent-bound keys cannot administer the app." }, 403);
      if (!take(principal.keyId)) {
        const res = json({ error: "rate_limited", message: `Limit: ${rate()} requests/s per key.` }, 429);
        res.headers.set("retry-after", "1");
        return res;
      }
      const params = (await route?.params) ?? {};
      const out = await handler({ req, db, principal, params });
      return out instanceof Response ? out : json(out);
    } catch (err) {
      if (err instanceof ApiError) return json({ error: err.code, message: err.message, details: err.details }, err.status);
      console.error("[v1] unhandled error:", (err as Error).message);
      return json({ error: "internal_error", message: "Request failed; nothing was allowed." }, 500);
    }
  };
}

/** Parse a capped JSON body or throw the 400/413 response as an ApiError-shaped Response. */
export async function body<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T> | Response> {
  const r = await parseBody(req, schema);
  return r.ok ? r.data : r.res;
}
