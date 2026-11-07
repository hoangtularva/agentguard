import { eq } from "drizzle-orm";
import { z } from "zod";
import { ClaudePlanner, llmConfigured } from "@/server/agent/claude-planner";
import { runAgent } from "@/server/agent/runtime";
import { SimulatedPlanner } from "@/server/agent/simulated-planner";
import { getAppPep, getCurrentUser } from "@/server/app-context";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { DEFAULT_POLICY_ID, DEMO_AGENT_ID } from "@/server/db/seed";
import { json, parseBody, sameOrigin } from "@/server/http";
import { TOOL_NAMES } from "@/server/tools/registry";

export const runtime = "nodejs";

const Body = z.object({
  prompt: z.string().trim().min(3).max(2000),
  tools: z.array(z.enum(TOOL_NAMES as [string, ...string[]])).min(1).max(TOOL_NAMES.length),
  scope: z.array(z.string().regex(/^(doc|ds):[a-z0-9_\-/.*]+$/i)).min(1).max(12),
  destinations: z.array(z.string().max(300)).max(10).default([]),
  planner: z.enum(["simulated", "claude"]).default("simulated"),
});

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "forbidden_origin" }, 403);
  const body = await parseBody(req, Body);
  if (!body.ok) return body.res;
  const { prompt, tools, scope, destinations, planner: plannerKind } = body.data;
  if (plannerKind === "claude" && !llmConfigured())
    return json({ error: "llm_not_configured", message: "Set ANTHROPIC_API_KEY to use the Claude planner." }, 400);

  const user = await getCurrentUser();
  const pep = await getAppPep();
  const session = await pep.startSession({
    userId: user.id,
    agentId: DEMO_AGENT_ID,
    prompt,
    mandate: { allowedTools: tools, resourceScope: scope, destinations },
    planner: plannerKind,
    origin: "playground",
    policyId: DEFAULT_POLICY_ID,
  });
  const planner = plannerKind === "claude" ? new ClaudePlanner() : new SimulatedPlanner();
  const result = await runAgent({ pep, planner, session, prompt, agentId: DEMO_AGENT_ID, onReview: "defer" });
  const db = await getDb();
  await db
    .update(s.agentSessions)
    .set({ status: result.status, finalMessage: result.finalMessage.slice(0, 4000) })
    .where(eq(s.agentSessions.id, session.id));

  return json({
    sessionId: session.id,
    status: result.status,
    finalMessage: result.finalMessage,
    planner: planner.label,
    mandate: session.mandate,
    steps: result.steps.map((st) => ({
      index: st.index,
      tool: st.tool,
      args: st.args,
      rationale: st.rationale,
      injected: st.injected ?? false,
      decision: st.result.decision,
      status: st.result.status,
      toolCallId: st.result.toolCallId,
      approvalId: st.result.approvalId,
      approvalExpiresAt: st.result.approvalExpiresAt,
      provenance: st.result.provenance,
      output: st.observation.text.slice(0, 4000),
      evalLatencyMs: st.result.evalLatencyMs,
    })),
  });
}
