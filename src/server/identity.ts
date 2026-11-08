import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * DEMO IDENTITY — not real authentication.
 *
 * The acting user is read from an HMAC-signed cookie, so the server (never a request body)
 * decides who acts. There is NO implicit default user: requests without a valid cookie are
 * unauthenticated (401 on APIs, sign-in screen on pages).
 *
 * Choosing an identity ("demo sign-in") is only possible when AGENTGUARD_DEMO_AUTH is
 * enabled. It is ON by default outside production and must be set explicitly in production.
 * Anyone who can reach a server with demo auth enabled can act as any demo user, including
 * approvers: never expose such a deployment beyond localhost. Real deployments replace this
 * module with OIDC/SSO.
 */
export const IDENTITY_COOKIE = "ag_uid";

const g = globalThis as unknown as { __agSecret?: string };
function secret(): string {
  if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16) return process.env.AUTH_SECRET;
  g.__agSecret ??= randomBytes(32).toString("hex"); // dev fallback: sessions reset on restart
  return g.__agSecret;
}

function sign(v: string) {
  return createHmac("sha256", secret()).update(v).digest("hex").slice(0, 32);
}

export function encodeIdentity(userId: string): string {
  return `${userId}.${sign(userId)}`;
}

export function decodeIdentity(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const i = raw.lastIndexOf(".");
  if (i <= 0) return null;
  const id = raw.slice(0, i);
  const mac = Buffer.from(raw.slice(i + 1));
  const want = Buffer.from(sign(id));
  return mac.length === want.length && timingSafeEqual(mac, want) ? id : null;
}

export function demoAuthEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = env.AGENTGUARD_DEMO_AUTH;
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return env.NODE_ENV !== "production";
}

/** Members see only their own sessions/approvals/events; approvers and admins see all. */
export function canSeeAll(role: string): boolean {
  return role === "approver" || role === "admin";
}
