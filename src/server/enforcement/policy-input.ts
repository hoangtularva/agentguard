import type { PolicyInput } from "@/server/core/policy-engine";
import { normalizeValue, traceArgument } from "@/server/core/provenance";
import { maxSensitivity } from "@/server/core/types";
import { destinationOfSpec, resourcesOfSpec } from "../../../packages/core/src/tool-spec";
import type { ResourceResolver, ToolCatalog } from "./ports";
import type { ProposedToolCall, ProvenanceSnapshot, SessionState } from "./types";

export type Identity = PolicyInput["identity"];

export interface BuiltInput {
  input: PolicyInput;
  /** Schema-validated arguments; absent when the tool is unknown or the args are invalid. */
  args?: Record<string, unknown>;
  snapshot: ProvenanceSnapshot;
}

/**
 * Build the PDP input. Pure: every security-relevant fact is derived server-side from the
 * session state, the verified identity and the catalogs, never from the agent's claims.
 */
export function buildPolicyInput(
  state: SessionState,
  call: ProposedToolCall,
  identity: Identity,
  catalog: { tools: ToolCatalog; resources: ResourceResolver },
  budget?: PolicyInput["budget"],
): BuiltInput {
  const tool = catalog.tools.get(call.tool);
  const sourcesInContext = state.sources.map(({ id, type, trust, label, sensitivity, signals }) => ({
    id,
    type,
    trust,
    label,
    sensitivity,
    signals,
  }));
  const signals = [...new Set(state.sources.flatMap((x) => x.signals))].sort();
  const base = {
    identity,
    mandate: state.mandate,
    untrustedContext: state.sources.some((x) => x.trust === "untrusted_external"),
    signals,
  };
  const rejected = (toolFacts: PolicyInput["tool"], argsErrors?: string[]): BuiltInput => ({
    snapshot: { dataSensitivity: state.readSensitivity, sourcesInContext, signals },
    input: { ...base, tool: toolFacts, argsValid: false, argsErrors, resources: [], dataSensitivity: state.readSensitivity },
  });

  if (!tool) return rejected({ name: call.tool, risk: "critical", kind: "sink", known: false });
  const facts = { name: tool.name, risk: tool.risk, kind: tool.kind, known: true } as const;
  const parsed = tool.validate(call.args);
  if (!parsed.ok) return rejected(facts, parsed.errors);

  const args = parsed.data;
  const resources = resourcesOfSpec(tool, args).map((id) => ({ id, ...catalog.resources.resolve(id) }));
  const resourceSensitivity = maxSensitivity(resources.map((r) => r.sensitivity));
  // Sinks carry everything the session has read; sources only what they touch.
  const dataSensitivity = tool.kind === "sink" ? maxSensitivity([state.readSensitivity, resourceSensitivity]) : resourceSensitivity;

  const destValue = destinationOfSpec(tool, args);
  const destination = destValue
    ? {
        value: normalizeValue(destValue),
        inMandate: state.mandate.destinations.includes(normalizeValue(destValue)),
        origin: traceArgument(destValue, state.sources),
      }
    : undefined;

  return {
    args,
    snapshot: { dataSensitivity, destination, sourcesInContext, signals },
    input: { ...base, tool: facts, argsValid: true, resources, destination, dataSensitivity, budget },
  };
}
