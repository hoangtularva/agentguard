/**
 * Approval notifications (opt-in, per app). Nothing is ever sent unless an operator configured
 * a webhook URL for the app (`npm run admin -- webhook <app> <url>`).
 *
 * POST <url> with JSON { type, app, approvalId, callId, tool, status, expiresAt, sentAt } and
 *   X-AgentGuard-Timestamp: <unix seconds>
 *   X-AgentGuard-Signature: sha256=<hex HMAC-SHA256(secret, timestamp + "." + body)>
 * The secret is derived from AUTH_SECRET (`npm run admin -- webhook-secret <app>`). Delivery is
 * best effort: one attempt, 3 s timeout, failures are logged and never affect decisions.
 * Payloads carry ids and the tool name only, never arguments.
 */
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { secret } from "@/server/identity";

export type WebhookEvent = {
  type: "approval.requested" | "approval.decided";
  app: string;
  approvalId: string;
  callId: string;
  tool: string;
  status: string;
  expiresAt: string;
};

export const webhookSecretFor = (appId: string) => createHmac("sha256", secret()).update(`agentguard/webhook/${appId}`).digest("hex");

export function signWebhook(appId: string, timestamp: string, body: string) {
  return `sha256=${createHmac("sha256", webhookSecretFor(appId)).update(`${timestamp}.${body}`).digest("hex")}`;
}

/** Only absolute http(s) URLs are accepted; the operator sets them, never an API client. */
export function validWebhookUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export async function notify(db: DB, event: WebhookEvent, fetchImpl: typeof fetch = fetch): Promise<"sent" | "skipped" | "failed"> {
  const [app] = await db.select({ settings: s.apps.settings }).from(s.apps).where(eq(s.apps.id, event.app)).limit(1);
  const url = app?.settings.webhookUrl;
  if (typeof url !== "string" || !validWebhookUrl(url)) return "skipped";
  const body = JSON.stringify({ ...event, sentAt: new Date().toISOString() });
  const ts = String(Math.floor(Date.now() / 1000));
  try {
    const r = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agentguard-timestamp": ts, "x-agentguard-signature": signWebhook(event.app, ts, body) },
      body,
      signal: AbortSignal.timeout(3000),
      redirect: "manual",
    });
    return r.ok ? "sent" : "failed";
  } catch (err) {
    console.error(`[webhook] ${event.type} for ${event.app} failed: ${(err as Error).message}`);
    return "failed";
  }
}

/** Fire and forget: decisions never wait for, or depend on, a notification. */
export function notifyLater(db: DB, event: WebhookEvent) {
  void notify(db, event).catch(() => {});
}
