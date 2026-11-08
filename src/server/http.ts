import "server-only";
import { NextResponse } from "next/server";
import type { z } from "zod";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

/** Max accepted JSON body. Bodies are read with a hard cap so oversized requests are refused early (finding F5). */
export const MAX_BODY_BYTES = 64 * 1024;

async function readCapped(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Parse a JSON body with a Zod schema; returns a 400/413 response on failure. */
export async function parseBody<T extends z.ZodType>(
  req: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: NextResponse }> {
  let raw: unknown;
  const text = await readCapped(req);
  if (text === null) return { ok: false, res: json({ error: "payload_too_large", limitBytes: MAX_BODY_BYTES }, 413) };
  try {
    raw = JSON.parse(text);
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
