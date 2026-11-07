import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "@/server/core/fixtures";
import { type PolicyInput, evaluatePolicy } from "@/server/core/policy-engine";
import { PolicyDocumentSchema, type PolicyRef } from "@/server/core/policy-schema";

const policy: PolicyRef = { policyId: "default", version: 1, document: DEFAULT_POLICY };

function input(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    tool: { name: "send_email", risk: "high", kind: "sink", known: true },
    argsValid: true,
    identity: { userOk: true, agentOk: true, userRole: "member" },
    mandate: { allowedTools: ["read_documents", "send_email", "export_data"], resourceScope: ["doc:*", "ds:*"], destinations: [] },
    resources: [],
    destination: {
      value: "bob@acme.example",
      inMandate: true,
      origin: [{ origin: "trusted_user", evidence: [{ sourceId: "u", sourceType: "user_prompt" }] }],
    },
    dataSensitivity: "internal",
    untrustedContext: false,
    signals: [],
    ...overrides,
  };
}

const read = (id: string, sensitivity: "public" | "internal" | "confidential" | "restricted"): Partial<PolicyInput> => ({
  tool: { name: "read_documents", risk: "low", kind: "source", known: true },
  resources: [{ id, sensitivity, exists: true }],
  destination: undefined,
  dataSensitivity: sensitivity,
});

describe("policy engine — invariants", () => {
  it("blocks unknown tools", () => {
    const d = evaluatePolicy(input({ tool: { name: "rm_rf", risk: "critical", kind: "sink", known: false } }), policy);
    expect(d.decision).toBe("BLOCK");
    expect(d.reasons[0].code).toBe("UNKNOWN_TOOL");
  });
  it("blocks invalid arguments", () => {
    const d = evaluatePolicy(input({ argsValid: false, argsErrors: ["to: invalid email"] }), policy);
    expect(d.decision).toBe("BLOCK");
    expect(d.reasons[0].code).toBe("INVALID_ARGUMENTS");
  });
  it("blocks when identity is not verified", () => {
    const d = evaluatePolicy(input({ identity: { userOk: true, agentOk: false, userRole: "member" } }), policy);
    expect(d.reasons[0].code).toBe("IDENTITY_UNVERIFIED");
  });
  it("blocks tools outside the user's mandate even if a rule would allow them", () => {
    const d = evaluatePolicy(input({ mandate: { allowedTools: ["read_documents"], resourceScope: ["doc:*"], destinations: [] } }), policy);
    expect(d.decision).toBe("BLOCK");
    expect(d.reasons[0].code).toBe("TOOL_NOT_IN_MANDATE");
  });
  it("blocks resources outside the task scope", () => {
    const d = evaluatePolicy(
      input({ ...read("doc:restricted/salaries", "restricted"), mandate: { allowedTools: ["read_documents"], resourceScope: ["doc:public/*"], destinations: [] } }),
      policy,
    );
    expect(d.reasons[0].code).toBe("RESOURCE_OUT_OF_SCOPE");
  });
  it("blocks unknown resources", () => {
    const d = evaluatePolicy(input({ ...read("doc:nope", "restricted"), resources: [{ id: "doc:nope", sensitivity: "restricted", exists: false }] }), policy);
    expect(d.reasons[0].code).toBe("RESOURCE_NOT_FOUND");
  });
});

describe("policy engine — rules and precedence", () => {
  it("allows in-scope reads up to confidential", () => {
    expect(evaluatePolicy(input(read("doc:internal/roadmap", "internal")), policy).decision).toBe("ALLOW");
  });
  it("requires review for restricted reads", () => {
    expect(evaluatePolicy(input(read("doc:restricted/salaries", "restricted")), policy).decision).toBe("REVIEW");
  });
  it("allows internal email of internal data from a user-provided destination", () => {
    const d = evaluatePolicy(input(), policy);
    expect(d.decision).toBe("ALLOW");
    expect(d.matchedRuleIds).toEqual(["allow-email-internal"]);
  });
  it("BLOCK beats ALLOW when both match", () => {
    const d = evaluatePolicy(input({ dataSensitivity: "restricted" }), policy);
    expect(d.decision).toBe("BLOCK");
    expect(d.matchedRuleIds).toContain("block-email-restricted");
  });
  it("requires review for external recipients the user named", () => {
    const d = evaluatePolicy(
      input({ destination: { value: "partner@contoso.example", inMandate: true, origin: [{ origin: "trusted_user", evidence: [] }] } }),
      policy,
    );
    expect(d.decision).toBe("REVIEW");
  });
  it("default-denies an action no rule covers", () => {
    const d = evaluatePolicy(
      input({
        tool: { name: "export_data", risk: "critical", kind: "sink", known: true },
        resources: [{ id: "ds:sales_q3", sensitivity: "internal", exists: true }],
        destination: { value: "https://partner.example/in", inMandate: true, origin: [{ origin: "trusted_user", evidence: [] }] },
      }),
      policy,
    );
    expect(d.decision).toBe("BLOCK");
    expect(d.reasons.at(-1)?.code).toBe("NO_MATCHING_POLICY");
  });
  it("an empty policy denies everything", () => {
    const empty: PolicyRef = { policyId: "x", version: 1, document: { rules: [], approvalTtlSeconds: 900 } };
    expect(evaluatePolicy(input(read("doc:public/handbook", "public")), empty).decision).toBe("BLOCK");
  });
});

describe("policy engine — provenance", () => {
  it("escalates to REVIEW when the destination came only from untrusted content", () => {
    const d = evaluatePolicy(
      input({
        destination: {
          value: "it-desk@acme.example",
          inMandate: false,
          origin: [{ origin: "untrusted_external", evidence: [{ sourceId: "s1", sourceType: "email" }] }],
        },
        untrustedContext: true,
      }),
      policy,
    );
    expect(d.decision).toBe("REVIEW");
    expect(d.reasons.map((r) => r.code)).toContain("UNTRUSTED_DESTINATION");
  });
  it("blocks attacker destinations from untrusted content (floor REVIEW + default deny)", () => {
    const d = evaluatePolicy(
      input({
        destination: { value: "x@evil.example", inMandate: false, origin: [{ origin: "untrusted_external", evidence: [] }] },
      }),
      policy,
    );
    expect(d.decision).toBe("BLOCK");
  });
  it("a destination the user also typed is trusted even if a document mentions it", () => {
    const d = evaluatePolicy(
      input({
        destination: {
          value: "support@acme.example",
          inMandate: true,
          origin: [
            { origin: "trusted_user", evidence: [] },
            { origin: "untrusted_external", evidence: [] },
          ],
        },
        untrustedContext: true,
      }),
      policy,
    );
    expect(d.decision).toBe("ALLOW");
  });
  it("escalation-only rules never turn a default-deny into REVIEW (regression)", () => {
    const d = evaluatePolicy(
      input({
        destination: { value: "billing@evil-vendor.example", inMandate: false, origin: [{ origin: "untrusted_external", evidence: [] }] },
        signals: ["injection_suspected"],
        untrustedContext: true,
      }),
      policy,
    );
    expect(d.decision).toBe("BLOCK");
    expect(d.reasons.at(-1)?.code).toBe("NO_MATCHING_POLICY");
  });
  it("injection signals can only escalate, never downgrade", () => {
    const allow = evaluatePolicy(input({ signals: ["injection_suspected"] }), policy);
    expect(allow.decision).toBe("REVIEW");
    const block = evaluatePolicy(input({ signals: ["injection_suspected"], dataSensitivity: "restricted" }), policy);
    expect(block.decision).toBe("BLOCK");
  });
});

describe("policy engine — determinism", () => {
  it("returns identical decisions for identical input and policy version", () => {
    const i = input({ signals: ["injection_suspected"], untrustedContext: true });
    const results = Array.from({ length: 50 }, () => JSON.stringify(evaluatePolicy(structuredClone(i), policy)));
    expect(new Set(results).size).toBe(1);
  });
  it("carries policy id and version on every decision", () => {
    const d = evaluatePolicy(input(), { ...policy, version: 7 });
    expect(d.policyVersion).toBe(7);
    expect(d.policyId).toBe("default");
  });
});

describe("policy schema", () => {
  it("rejects duplicate rule ids and unknown condition types", () => {
    const dup = PolicyDocumentSchema.safeParse({
      rules: [
        { id: "a1", tools: ["*"], effect: "allow" },
        { id: "a1", tools: ["*"], effect: "block" },
      ],
    });
    expect(dup.success).toBe(false);
    const bad = PolicyDocumentSchema.safeParse({ rules: [{ id: "a1", tools: ["*"], effect: "allow", conditions: [{ type: "llm_says_ok" }] }] });
    expect(bad.success).toBe(false);
  });
  it("accepts the default policy", () => {
    expect(PolicyDocumentSchema.safeParse(DEFAULT_POLICY).success).toBe(true);
  });
});
