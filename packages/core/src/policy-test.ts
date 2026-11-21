import { z } from "zod";
import { type PolicyInput, evaluatePolicy } from "./policy-engine";
import type { PolicyDocument } from "./policy-schema";
import { type Decision, RiskLevelSchema, SensitivitySchema, TRUST_LEVELS, USER_ROLES } from "./types";

/**
 * Policy unit tests ("policy as code"): describe a tool call in a few fields, state the decision
 * you expect, run it through the real PDP. Everything not given defaults to a valid, in-mandate,
 * identity-verified call, so each case only states what matters.
 */
export const PolicyTestCaseSchema = z
  .object({
    name: z.string().min(1),
    tool: z.object({ name: z.string().min(1), kind: z.enum(["source", "sink"]), risk: RiskLevelSchema }).strict(),
    destination: z
      .object({ value: z.string(), inMandate: z.boolean().default(false), origin: z.array(z.enum(TRUST_LEVELS)).default(["model_generated"]) })
      .strict()
      .optional(),
    resources: z.array(z.object({ id: z.string(), sensitivity: SensitivitySchema.default("internal") }).strict()).default([]),
    dataSensitivity: SensitivitySchema.default("public"),
    signals: z.array(z.string()).default([]),
    role: z.enum(USER_ROLES).default("member"),
    inMandate: z.boolean().default(true),
    expect: z.enum(["ALLOW", "REVIEW", "BLOCK"]),
  })
  .strict();
export type PolicyTestCase = z.input<typeof PolicyTestCaseSchema>;

export interface PolicyTestResult {
  name: string;
  expected: Decision;
  actual: Decision;
  pass: boolean;
  reasons: string[];
}

export function runPolicyTests(document: PolicyDocument, cases: PolicyTestCase[]): PolicyTestResult[] {
  return cases.map((raw) => {
    const c = PolicyTestCaseSchema.parse(raw);
    const input: PolicyInput = {
      tool: { ...c.tool, known: true },
      argsValid: true,
      identity: { userOk: true, agentOk: true, userRole: c.role },
      mandate: { allowedTools: c.inMandate ? [c.tool.name] : [], resourceScope: ["*"], destinations: c.destination?.inMandate ? [c.destination.value] : [] },
      resources: c.resources.map((r) => ({ ...r, exists: true })),
      destination: c.destination && {
        value: c.destination.value,
        inMandate: c.destination.inMandate,
        origin: c.destination.origin.map((origin) => ({ origin, evidence: [] })),
      },
      dataSensitivity: c.dataSensitivity,
      untrustedContext: c.signals.length > 0,
      signals: c.signals,
    };
    const d = evaluatePolicy(input, { policyId: "test", version: 1, document });
    return {
      name: c.name,
      expected: c.expect,
      actual: d.decision,
      pass: d.decision === c.expect,
      reasons: d.reasons.map((r) => (r.ruleId ? `${r.code}:${r.ruleId}` : r.code)),
    };
  });
}
