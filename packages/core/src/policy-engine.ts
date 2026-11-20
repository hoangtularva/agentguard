/**
 * Policy Decision Point (PDP).
 *
 * Pure and deterministic: the same (PolicyInput, PolicyRef) always yields the same
 * PolicyDecision. No I/O, no clock, no randomness, no LLM. The LLM never decides.
 *
 * Evaluation order:
 *   1. Built-in invariants (no policy rule can relax them):
 *      - unknown tool / invalid arguments / identity failure      -> BLOCK
 *      - tool outside the user's mandate                          -> BLOCK
 *      - unknown resource / resource outside the mandate scope    -> BLOCK
 *      - sink destination that the user did not provide
 *        (it comes only from untrusted content or model text)     -> floor REVIEW
 *   2. Policy rules: every matching rule contributes its effect.
 *      Precedence BLOCK > REVIEW > ALLOW.
 *   3. Default deny: no matching rule -> BLOCK (NO_MATCHING_POLICY).
 *   Final decision = max(invariant floor, rule decision).
 */
import { matchesAny } from "./glob";
import type { Condition, PolicyRef } from "./policy-schema";
import {
  type ArgumentOrigin,
  type Decision,
  type Mandate,
  type RiskLevel,
  type Sensitivity,
  type TrustLevel,
  type UserRole,
  riskRank,
  sensitivityRank,
} from "./types";

export interface PolicyInput {
  tool: { name: string; risk: RiskLevel; kind: "source" | "sink"; known: boolean };
  argsValid: boolean;
  argsErrors?: string[];
  identity: { userOk: boolean; agentOk: boolean; userRole: UserRole };
  mandate: Mandate;
  resources: { id: string; sensitivity: Sensitivity; exists: boolean }[];
  destination?: { value: string; inMandate: boolean; origin: ArgumentOrigin[] };
  /** Max sensitivity of data that may flow into this call (session-level taint, conservative). */
  dataSensitivity: Sensitivity;
  untrustedContext: boolean;
  signals: string[];
}

export type ReasonCode =
  | "UNKNOWN_TOOL"
  | "INVALID_ARGUMENTS"
  | "IDENTITY_UNVERIFIED"
  | "TOOL_NOT_IN_MANDATE"
  | "RESOURCE_OUT_OF_SCOPE"
  | "RESOURCE_NOT_FOUND"
  | "UNTRUSTED_DESTINATION"
  | "RULE_MATCHED"
  | "NO_MATCHING_POLICY";

export interface DecisionReason {
  code: ReasonCode;
  message: string;
  ruleId?: string;
  effect?: Decision;
}

export interface PolicyDecision {
  decision: Decision;
  reasons: DecisionReason[];
  matchedRuleIds: string[];
  policyId: string;
  policyVersion: number;
  riskScore: number;
}

const DECISION_RANK: Record<Decision, number> = { ALLOW: 0, REVIEW: 1, BLOCK: 2 };
export const maxDecision = (a: Decision, b: Decision): Decision => (DECISION_RANK[a] >= DECISION_RANK[b] ? a : b);
const EFFECT_TO_DECISION = { allow: "ALLOW", review: "REVIEW", block: "BLOCK" } as const;

export function originsOf(input: PolicyInput): TrustLevel[] {
  return [...new Set((input.destination?.origin ?? []).map((o) => o.origin))].sort();
}

function conditionHolds(c: Condition, input: PolicyInput): boolean {
  const dest = input.destination?.value;
  switch (c.type) {
    case "resource_matches":
      return input.resources.length > 0 && input.resources.every((r) => matchesAny(c.patterns, r.id));
    case "resource_not_matches":
      return input.resources.some((r) => !matchesAny(c.patterns, r.id));
    case "destination_matches":
      return dest !== undefined && matchesAny(c.patterns, dest);
    case "destination_not_matches":
      return dest !== undefined && !matchesAny(c.patterns, dest);
    case "destination_in_mandate":
      return input.destination !== undefined && input.destination.inMandate === c.value;
    case "destination_origin_includes": {
      const origins = originsOf(input);
      return c.origins.some((o) => origins.includes(o));
    }
    case "sensitivity_at_least":
      return sensitivityRank(input.dataSensitivity) >= sensitivityRank(c.level);
    case "sensitivity_at_most":
      return sensitivityRank(input.dataSensitivity) <= sensitivityRank(c.level);
    case "tool_risk_at_least":
      return riskRank(input.tool.risk) >= riskRank(c.level);
    case "tool_risk_at_most":
      return riskRank(input.tool.risk) <= riskRank(c.level);
    case "tool_kind":
      return input.tool.kind === c.kind;
    case "untrusted_context":
      return input.untrustedContext === c.value;
    case "signal_present":
      return input.signals.includes(c.signal);
    case "user_role_in":
      return c.roles.includes(input.identity.userRole);
  }
}

/** Informational 0–100 score for UI sorting. It never changes the decision. */
export function computeRiskScore(input: PolicyInput): number {
  let score = [10, 30, 50, 70][riskRank(input.tool.risk)];
  score += [0, 5, 15, 25][sensitivityRank(input.dataSensitivity)];
  if (input.untrustedContext) score += 10;
  if (input.destination && !input.destination.inMandate) score += 15;
  if (input.signals.length > 0) score += 10;
  return Math.min(100, score);
}

export function evaluatePolicy(input: PolicyInput, policy: PolicyRef): PolicyDecision {
  const reasons: DecisionReason[] = [];
  const base = { policyId: policy.policyId, policyVersion: policy.version, riskScore: computeRiskScore(input) };
  const block = (code: ReasonCode, message: string): PolicyDecision => ({
    ...base,
    decision: "BLOCK",
    reasons: [...reasons, { code, message, effect: "BLOCK" }],
    matchedRuleIds: [],
  });

  // ---- 1. Hard invariants -------------------------------------------------
  if (!input.tool.known) return block("UNKNOWN_TOOL", `Tool "${input.tool.name}" is not registered.`);
  if (!input.argsValid)
    return block("INVALID_ARGUMENTS", `Arguments failed schema validation: ${(input.argsErrors ?? []).join("; ")}`);
  if (!input.identity.userOk || !input.identity.agentOk)
    return block("IDENTITY_UNVERIFIED", "User or agent identity could not be verified for this session.");
  if (!input.mandate.allowedTools.includes(input.tool.name))
    return block("TOOL_NOT_IN_MANDATE", `The user did not authorize "${input.tool.name}" for this task.`);
  const missing = input.resources.filter((r) => !r.exists);
  if (missing.length > 0)
    return block("RESOURCE_NOT_FOUND", `Unknown resource(s): ${missing.map((r) => r.id).join(", ")}.`);
  const outOfScope = input.resources.filter((r) => !matchesAny(input.mandate.resourceScope, r.id));
  if (outOfScope.length > 0)
    return block(
      "RESOURCE_OUT_OF_SCOPE",
      `Resource(s) outside the task scope: ${outOfScope.map((r) => r.id).join(", ")}.`,
    );

  let floor: Decision = "ALLOW";
  if (input.tool.kind === "sink" && input.destination) {
    const origins = originsOf(input);
    const fromUser = origins.includes("trusted_user") || input.destination.inMandate;
    if (!fromUser) {
      floor = "REVIEW";
      const where = origins.includes("untrusted_external") ? "untrusted retrieved content" : "model-generated text";
      reasons.push({
        code: "UNTRUSTED_DESTINATION",
        message: `Destination "${input.destination.value}" was not provided by the user; it originates from ${where}.`,
        effect: "REVIEW",
      });
    }
  }

  // ---- 2. Policy rules ----------------------------------------------------
  let ruleDecision: Decision | undefined;
  let permitted = false;
  const matched: string[] = [];
  for (const rule of policy.document.rules) {
    if (!rule.tools.includes("*") && !rule.tools.includes(input.tool.name)) continue;
    if (!rule.conditions.every((c) => conditionHolds(c, input))) continue;
    const d = EFFECT_TO_DECISION[rule.effect];
    matched.push(rule.id);
    reasons.push({ code: "RULE_MATCHED", ruleId: rule.id, effect: d, message: rule.description || `Rule ${rule.id}` });
    if (rule.effect !== "block" && !rule.escalateOnly) permitted = true;
    ruleDecision = ruleDecision ? maxDecision(ruleDecision, d) : d;
  }

  // ---- 3. Default deny ----------------------------------------------------
  // A decision exists only if a non-escalation rule permitted the action or a rule blocked it.
  if (ruleDecision !== "BLOCK" && !permitted) ruleDecision = undefined;
  if (!ruleDecision) {
    reasons.push({
      code: "NO_MATCHING_POLICY",
      message: `No policy rule permits "${input.tool.name}" with these arguments (default deny).`,
      effect: "BLOCK",
    });
    ruleDecision = "BLOCK";
  }

  return { ...base, decision: maxDecision(floor, ruleDecision), reasons, matchedRuleIds: matched };
}
