import { z } from "zod";

/** Ordered sensitivity labels. Index order is the comparison order. */
export const SENSITIVITY_LEVELS = ["public", "internal", "confidential", "restricted"] as const;
export type Sensitivity = (typeof SENSITIVITY_LEVELS)[number];
export const SensitivitySchema = z.enum(SENSITIVITY_LEVELS);

export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];
export const RiskLevelSchema = z.enum(RISK_LEVELS);

export const DECISIONS = ["ALLOW", "REVIEW", "BLOCK"] as const;
export type Decision = (typeof DECISIONS)[number];

/**
 * Trust of a data source. Only `trusted_user` and `system` may carry
 * instructions or authorize destinations. Everything a tool returns is data.
 */
export const TRUST_LEVELS = ["trusted_user", "system", "untrusted_external", "model_generated"] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

export const SOURCE_TYPES = ["user_prompt", "system", "document", "email", "web", "tool_output", "model"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const USER_ROLES = ["member", "approver", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export function sensitivityRank(s: Sensitivity): number {
  return SENSITIVITY_LEVELS.indexOf(s);
}
export function riskRank(r: RiskLevel): number {
  return RISK_LEVELS.indexOf(r);
}
export function maxSensitivity(values: Sensitivity[]): Sensitivity {
  return values.reduce<Sensitivity>((acc, v) => (sensitivityRank(v) > sensitivityRank(acc) ? v : acc), "public");
}

/** A provenance record: where a piece of context came from. */
export interface ProvenanceSource {
  id: string;
  type: SourceType;
  trust: TrustLevel;
  label: string;
  /** Content is kept in memory for argument matching only; audit stores a hash. */
  content: string;
  contentHash: string;
  sensitivity: Sensitivity;
  createdAt: string;
  relatedToolCallId?: string;
  /** Deterministic risk signals detected in this content (e.g. injection heuristics). */
  signals: string[];
}

/** Where a tool-call argument value was found. */
export interface ArgumentOrigin {
  origin: TrustLevel;
  evidence: { sourceId: string; sourceType: SourceType }[];
}

/** The user's mandate: the scope the user explicitly authorized for this session. */
export const MandateSchema = z.object({
  allowedTools: z.array(z.string()).min(1),
  /** Glob patterns over resource ids, e.g. "doc:public/*". */
  resourceScope: z.array(z.string()).default([]),
  /** Destinations the user authorized in the trusted channel (emails / URLs). */
  destinations: z.array(z.string()).default([]),
});
export type Mandate = z.infer<typeof MandateSchema>;

export interface CorpusItem {
  id: string;
  title: string;
  kind: "document" | "dataset";
  sourceType: Extract<SourceType, "document" | "email" | "web">;
  sensitivity: Sensitivity;
  content: string;
}

export type Corpus = Map<string, CorpusItem>;
