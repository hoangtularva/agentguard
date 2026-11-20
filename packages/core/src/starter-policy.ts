import { type PolicyDocument, PolicyDocumentSchema } from "./policy-schema";

/**
 * Tool-name-agnostic starting policy for a newly integrated app. It relies only on the
 * facts every ToolSpec declares (kind, risk) and on provenance, so it is safe before the
 * app writes any rule of its own. Anything not matched here is denied by default.
 *
 *  - reads (sources) up to confidential: ALLOW; restricted: REVIEW
 *  - sends (sinks) to a destination the USER gave: low/medium risk + data ≤ internal → ALLOW;
 *    high/critical risk or confidential data → REVIEW
 *  - sinks never carry restricted data; instruction-like untrusted content escalates to REVIEW
 *  - sinks to destinations the user never gave hit default deny (and the provenance invariant)
 */
export const STARTER_POLICY: PolicyDocument = PolicyDocumentSchema.parse({
  approvalTtlSeconds: 900,
  rules: [
    {
      id: "allow-read-up-to-confidential",
      tools: ["*"],
      conditions: [{ type: "tool_kind", kind: "source" }, { type: "sensitivity_at_most", level: "confidential" }],
      effect: "allow",
    },
    {
      id: "review-read-restricted",
      tools: ["*"],
      conditions: [{ type: "tool_kind", kind: "source" }, { type: "sensitivity_at_least", level: "restricted" }],
      effect: "review",
    },
    {
      id: "allow-send-to-user-destination",
      tools: ["*"],
      conditions: [
        { type: "tool_kind", kind: "sink" },
        { type: "destination_in_mandate", value: true },
        { type: "tool_risk_at_most", level: "medium" },
        { type: "sensitivity_at_most", level: "internal" },
      ],
      effect: "allow",
    },
    // Rules combine as BLOCK > REVIEW > ALLOW, so the REVIEW rules must not overlap the ALLOW above.
    {
      id: "review-send-confidential",
      tools: ["*"],
      conditions: [
        { type: "tool_kind", kind: "sink" },
        { type: "destination_in_mandate", value: true },
        { type: "sensitivity_at_least", level: "confidential" },
      ],
      effect: "review",
    },
    {
      id: "review-send-high-risk",
      tools: ["*"],
      conditions: [
        { type: "tool_kind", kind: "sink" },
        { type: "destination_in_mandate", value: true },
        { type: "tool_risk_at_least", level: "high" },
      ],
      effect: "review",
    },
    {
      id: "block-send-restricted",
      tools: ["*"],
      conditions: [{ type: "tool_kind", kind: "sink" }, { type: "sensitivity_at_least", level: "restricted" }],
      effect: "block",
    },
    {
      id: "review-send-after-injection-signal",
      tools: ["*"],
      conditions: [{ type: "tool_kind", kind: "sink" }, { type: "signal_present", signal: "injection_suspected" }],
      effect: "review",
      escalateOnly: true,
    },
  ],
});
