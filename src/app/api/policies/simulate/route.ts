import { z } from "zod";
import { evaluatePolicy } from "@/server/core/policy-engine";
import { PolicyDocumentSchema } from "@/server/core/policy-schema";
import { SensitivitySchema, TRUST_LEVELS } from "@/server/core/types";
import { json, parseBody } from "@/server/http";
import { getTool } from "@/server/tools/registry";

export const runtime = "nodejs";

/** Policy test simulator: evaluates a DRAFT policy against a hypothetical call. No side effects. */
const Body = z.object({
  document: PolicyDocumentSchema,
  input: z.object({
    tool: z.string().min(1).max(60),
    resource: z.string().max(120).optional(),
    resourceSensitivity: SensitivitySchema.default("internal"),
    destination: z.string().max(300).optional(),
    destinationOrigin: z.enum(TRUST_LEVELS).default("trusted_user"),
    destinationInMandate: z.boolean().default(true),
    dataSensitivity: SensitivitySchema.default("internal"),
    untrustedContext: z.boolean().default(false),
    injectionSignal: z.boolean().default(false),
    toolInMandate: z.boolean().default(true),
    resourceInScope: z.boolean().default(true),
  }),
});

export async function POST(req: Request) {
  const body = await parseBody(req, Body);
  if (!body.ok) return body.res;
  const { document, input: i } = body.data;
  const tool = getTool(i.tool);
  const resources = i.resource ? [{ id: i.resource, sensitivity: i.resourceSensitivity, exists: true }] : [];
  const decision = evaluatePolicy(
    {
      tool: tool ? { name: tool.name, risk: tool.risk, kind: tool.kind, known: true } : { name: i.tool, risk: "critical", kind: "sink", known: false },
      argsValid: true,
      identity: { userOk: true, agentOk: true, userRole: "member" },
      mandate: {
        allowedTools: i.toolInMandate ? [i.tool] : [],
        resourceScope: i.resourceInScope ? ["*"] : [],
        destinations: [],
      },
      resources,
      destination:
        tool?.kind === "sink" && i.destination
          ? { value: i.destination.toLowerCase(), inMandate: i.destinationInMandate, origin: [{ origin: i.destinationOrigin, evidence: [] }] }
          : undefined,
      dataSensitivity: tool?.kind === "sink" ? i.dataSensitivity : i.resourceSensitivity,
      untrustedContext: i.untrustedContext,
      signals: i.injectionSignal ? ["injection_suspected"] : [],
    },
    { policyId: "draft", version: 0, document },
  );
  return json(decision);
}
