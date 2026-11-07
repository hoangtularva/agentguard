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

/** Same-origin check for state-changing requests (basic CSRF defence for the cookie identity). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients (tests, curl)
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}
