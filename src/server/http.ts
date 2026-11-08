import "server-only";
import { NextResponse } from "next/server";
import type { z } from "zod";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

/** Parse a JSON body with a Zod schema; returns a 400 response on failure. */
export async function parseBody<T extends z.ZodType>(
  req: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, res: json({ error: "invalid_json" }, 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      res: json({ error: "validation_failed", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400),
    };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Same-origin check for state-changing requests (CSRF defence for the cookie identity).
 * Browsers send `Sec-Fetch-Site` and `Origin`; either one saying cross-site rejects the request.
 * Requests with neither header come from non-browser clients (tests, curl), which carry no
 * ambient cookie a malicious site could ride on.
 */
export function sameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

/**
 * Process-wide single-flight guard for expensive operations (benchmark runs, local-LLM
 * agent runs on CPU). A second caller gets 429 instead of piling up work: a cheap
 * protection against accidental or deliberate resource exhaustion in the demo.
 */
const g = globalThis as unknown as { __agBusy?: Set<string> };
export async function exclusive<T>(name: string, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; res: NextResponse }> {
  g.__agBusy ??= new Set();
  if (g.__agBusy.has(name)) return { ok: false, res: json({ error: "busy", message: `Another ${name} is already running. Try again when it finishes.` }, 429) };
  g.__agBusy.add(name);
  try {
    return { ok: true, value: await fn() };
  } finally {
    g.__agBusy.delete(name);
  }
}
