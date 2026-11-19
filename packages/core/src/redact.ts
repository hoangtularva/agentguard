import { sha256 } from "./canonical";
/** Minimal structural view of a tool needed for redaction (works with any tool spec). */
export interface RedactableTool {
  contentArgs?: string[];
}

/**
 * Audit redaction. Audit records must never contain secrets or sensitive content verbatim.
 *  - Free-text content arguments (e.g. email body) are replaced with {length, sha256 prefix}.
 *  - Other string values are scanned for secret-like patterns and masked.
 */
const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "api_key", re: /\b(sk|pk|rk)[-_](live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}\b/g },
  { name: "aws_key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "bearer", re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi },
  { name: "password", re: /\b(password|passwd|pwd|secret)\s*[:=]\s*\S+/gi },
  { name: "card", re: /\b(?:\d[ -]?){13,16}\b/g },
  { name: "ssn", re: /\b\d{3}-\d{2}-\d{4}\b/g },
];

export function redactString(s: string): string {
  let out = s;
  for (const p of SECRET_PATTERNS) out = out.replace(p.re, `[REDACTED:${p.name}]`);
  return out;
}

export function containsSecret(s: string): boolean {
  return SECRET_PATTERNS.some((p) => new RegExp(p.re.source, p.re.flags.replace("g", "")).test(s));
}

export function digest(content: string): { redacted: true; length: number; sha256: string } {
  return { redacted: true, length: content.length, sha256: sha256(content).slice(0, 16) };
}

export function redactDeep(v: unknown): unknown {
  if (typeof v === "string") return redactString(v);
  if (Array.isArray(v)) return v.map(redactDeep);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, redactDeep(x)]));
  return v;
}

export function redactArgs(tool: RedactableTool | undefined, args: unknown): unknown {
  if (!args || typeof args !== "object" || Array.isArray(args)) return redactDeep(args);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    out[k] = tool?.contentArgs?.includes(k) && typeof v === "string" ? digest(v) : redactDeep(v);
  }
  return out;
}
