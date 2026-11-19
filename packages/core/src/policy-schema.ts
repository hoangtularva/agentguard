import { z } from "zod";
import { RiskLevelSchema, SensitivitySchema, TRUST_LEVELS, USER_ROLES } from "./types";

const Patterns = z.array(z.string().min(1).max(200)).min(1).max(50);

export const ConditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("resource_matches"), patterns: Patterns }).strict(),
  z.object({ type: z.literal("resource_not_matches"), patterns: Patterns }).strict(),
  z.object({ type: z.literal("destination_matches"), patterns: Patterns }).strict(),
  z.object({ type: z.literal("destination_not_matches"), patterns: Patterns }).strict(),
  z.object({ type: z.literal("destination_in_mandate"), value: z.boolean() }).strict(),
  z.object({ type: z.literal("destination_origin_includes"), origins: z.array(z.enum(TRUST_LEVELS)).min(1) }).strict(),
  z.object({ type: z.literal("sensitivity_at_least"), level: SensitivitySchema }).strict(),
  z.object({ type: z.literal("sensitivity_at_most"), level: SensitivitySchema }).strict(),
  z.object({ type: z.literal("tool_risk_at_least"), level: RiskLevelSchema }).strict(),
  z.object({ type: z.literal("untrusted_context"), value: z.boolean() }).strict(),
  z.object({ type: z.literal("signal_present"), signal: z.string().min(1).max(64) }).strict(),
  z.object({ type: z.literal("user_role_in"), roles: z.array(z.enum(USER_ROLES)).min(1) }).strict(),
]);
export type Condition = z.infer<typeof ConditionSchema>;
export const CONDITION_TYPES = ConditionSchema.options.map((o) => o.shape.type.value);

export const RuleSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/, "lowercase letters, digits, - and _"),
    description: z.string().max(300).default(""),
    /** Tool names this rule applies to. "*" means every tool. */
    tools: z.array(z.string().min(1)).min(1),
    /** All conditions must hold (logical AND). An empty list always matches. */
    conditions: z.array(ConditionSchema).max(20).default([]),
    effect: z.enum(["allow", "review", "block"]),
    /**
     * Escalation-only rules raise the decision of an action that some OTHER rule
     * already permits; they never grant permission themselves. Without this, a
     * "review if suspicious" rule would turn a default-deny into a REVIEW.
     */
    escalateOnly: z.boolean().default(false),
  })
  .strict();
export type Rule = z.infer<typeof RuleSchema>;

export const PolicyDocumentSchema = z
  .object({
    rules: z.array(RuleSchema).max(200),
    /** Lifetime of an approval granted under this policy. */
    approvalTtlSeconds: z.number().int().min(30).max(86400).default(900),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const seen = new Set<string>();
    doc.rules.forEach((r, i) => {
      if (seen.has(r.id)) ctx.addIssue({ code: "custom", message: `duplicate rule id ${r.id}`, path: ["rules", i, "id"] });
      seen.add(r.id);
    });
  });
export type PolicyDocument = z.infer<typeof PolicyDocumentSchema>;

export interface PolicyRef {
  policyId: string;
  version: number;
  document: PolicyDocument;
}
