import { sha256 } from "./canonical";
import type { ArgumentOrigin, ProvenanceSource, Sensitivity, SourceType, TrustLevel } from "./types";

/**
 * Data provenance for EXPLICITLY INSTRUMENTED flows only.
 *
 * Every piece of context the agent sees is registered as a ProvenanceSource
 * (user prompt, documents returned by read_documents, tool outputs).
 * For security-relevant arguments (destinations) we determine which sources
 * contain the exact (normalized) value. This is value-level matching, not full
 * information-flow tracking: paraphrased, encoded or split values are NOT traced.
 * That is why provenance only ever *escalates* a decision and the destination
 * allowlist + default deny remain the primary control.
 */

export function normalizeValue(v: string): string {
  return v.trim().toLowerCase().replace(/\/+$/, "");
}

const TRUST_BY_TYPE: Record<SourceType, TrustLevel> = {
  user_prompt: "trusted_user",
  system: "system",
  document: "untrusted_external",
  email: "untrusted_external",
  web: "untrusted_external",
  tool_output: "untrusted_external",
  model: "model_generated",
};

export function trustForSourceType(t: SourceType): TrustLevel {
  return TRUST_BY_TYPE[t];
}

let counter = 0;
export function makeSource(params: {
  type: SourceType;
  label: string;
  content: string;
  sensitivity?: Sensitivity;
  relatedToolCallId?: string;
  createdAt?: string;
  id?: string;
}): ProvenanceSource {
  counter += 1;
  return {
    id: params.id ?? `src_${Date.now().toString(36)}_${counter.toString(36)}`,
    type: params.type,
    trust: trustForSourceType(params.type),
    label: params.label,
    content: params.content,
    contentHash: sha256(params.content),
    sensitivity: params.sensitivity ?? "public",
    createdAt: params.createdAt ?? new Date().toISOString(),
    relatedToolCallId: params.relatedToolCallId,
    signals: detectInjectionSignals(params.type, params.content),
  };
}

/** Which sources contain this value? Values found nowhere are attributed to the model. */
export function traceArgument(value: string, sources: ProvenanceSource[]): ArgumentOrigin[] {
  const needle = normalizeValue(value);
  const byTrust = new Map<TrustLevel, ArgumentOrigin>();
  for (const s of sources) {
    if (!needle || !s.content.toLowerCase().includes(needle)) continue;
    const entry = byTrust.get(s.trust) ?? { origin: s.trust, evidence: [] };
    entry.evidence.push({ sourceId: s.id, sourceType: s.type });
    byTrust.set(s.trust, entry);
  }
  if (byTrust.size === 0) return [{ origin: "model_generated", evidence: [] }];
  return [...byTrust.values()].sort((a, b) => a.origin.localeCompare(b.origin));
}

/**
 * Deterministic heuristic signals for instruction-like text inside UNTRUSTED content.
 * Signals can only escalate decisions through policy rules (`signal_present`);
 * they never allow anything. Expect false negatives — this is not a classifier.
 */
const INJECTION_PATTERNS: { signal: string; re: RegExp }[] = [
  { signal: "injection_override", re: /\b(ignore|disregard|forget)\b.{0,40}\b(previous|prior|above|all)\b.{0,20}\b(instructions?|rules?)\b/i },
  { signal: "injection_role", re: /\b(system (prompt|notice|message)|you are now|new instructions?|as the assistant)\b/i },
  { signal: "injection_action", re: /\b(send|forward|email|export|upload|transfer)\b.{0,80}\b(to|at)\b\s+\S+(@|https?:\/\/)/i },
  { signal: "injection_secrecy", re: /\b(do not (tell|mention|inform)|without (telling|notifying)|silently|secretly)\b/i },
];

export function detectInjectionSignals(type: SourceType, content: string): string[] {
  if (trustForSourceType(type) !== "untrusted_external") return [];
  const hits = INJECTION_PATTERNS.filter((p) => p.re.test(content)).map((p) => p.signal);
  return hits.length > 0 ? ["injection_suspected", ...hits] : [];
}

/** Extract destinations (emails, https URLs) the user typed in the trusted channel. */
export function extractDestinations(text: string): string[] {
  const emails = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
  const urls = text.match(/https:\/\/[^\s"'<>)]+/gi) ?? [];
  return [...new Set([...emails, ...urls].map((v) => normalizeValue(v.replace(/[.,;:]+$/, ""))))];
}
