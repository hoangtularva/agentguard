import { eq } from "drizzle-orm";
import { z } from "zod";
import { LLMPlanner } from "@/server/agent/llm/llm-planner";
import { PLANNER_KINDS, makePlanner, plannerAvailability } from "@/server/agent/planners";
import { runAgent } from "@/server/agent/runtime";
import { getAppPep, requireUser } from "@/server/app-context";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { DEFAULT_POLICY_ID, DEMO_AGENT_ID } from "@/server/db/seed";
import { exclusive, json, parseBody, sameOrigin } from "@/server/http";
import { TOOL_NAMES } from "@/server/tools/registry";

export const runtime = "nodejs";
export const maxDuration = 600;

const Body = z.object({
  prompt: z.string().trim().min(3).max(2000),
  tools: z.array(z.enum(TOOL_NAMES as [string, ...string[]])).min(1).max(TOOL_NAMES.length),
  scope: z.array(z.string().regex(/^(doc|ds):[a-z0-9_\-/.*]+$/i)).min(1).max(12),
  destinations: z.array(z.string().max(300)).max(10).default([]),
  planner: z.preprocess((v) => (v === "claude" ? "anthropic" : v), z.enum(PLANNER_KINDS)).default("simulated"),
});

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "forbidden_origin" }, 403);
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  const body = await parseBody(req, Body);
  if (!body.ok) return body.res;
  const { prompt, tools, scope, destinations, planner: plannerKind } = body.data;

  if (plannerKind !== "simulated") {
    const avail = await plannerAvailability();
    if (plannerKind === "ollama" && !avail.ollama.available)
      return json(
        {
          error: "llm_unavailable",
          message: avail.ollama.reachable
            ? `Ollama is running but model "${avail.ollama.model}" is not pulled. Run: ollama pull ${avail.ollama.model}`
            : `Ollama is not reachable at ${avail.ollama.host}. Start it with "ollama serve".`,
        },
        503,
      );
    if (plannerKind === "anthropic" && !avail.anthropic.available)
      return json({ error: "llm_unavailable", message: "Set ANTHROPIC_API_KEY to use the Anthropic planner." }, 503);
  }

  const handle = async () => {
  const user = auth.user;
  const pep = await getAppPep();
  const planner = makePlanner(plannerKind);
  const session = await pep.startSession({
    userId: user.id,
    agentId: DEMO_AGENT_ID,
    prompt,
    mandate: { allowedTools: tools, resourceScope: scope, destinations },
    planner: planner.label,
    origin: "playground",
    policyId: DEFAULT_POLICY_ID,
  });
  const t0 = performance.now();
  const result = await runAgent({ pep, planner, session, prompt, agentId: DEMO_AGENT_ID, onReview: "defer" });
  const db = await getDb();
  await db
    .update(s.agentSessions)
    .set({ status: result.status, finalMessage: result.finalMessage.slice(0, 4000) })
    .where(eq(s.agentSessions.id, session.id));

  const llm = planner instanceof LLMPlanner ? planner : null;
  return json({
    sessionId: session.id,
    status: result.status,
    finalMessage: result.finalMessage,
    planner: planner.label,
    provider: plannerKind,
    model: llm?.provider.config.model ?? null,
    llmTurns: llm?.turnLog ?? [],
    totalMs: Math.round(performance.now() - t0),
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
  };

  // A local model on CPU can take minutes per run: allow one LLM run at a time.
  if (plannerKind === "simulated") return handle();
  const r = await exclusive("LLM agent run", handle);
  return r.ok ? r.value : r.res;
}
