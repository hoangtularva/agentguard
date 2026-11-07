/**
 * BENCHMARK-ONLY UNGUARDED BASELINE.
 *
 * Runs the same planner against the same mock executors WITHOUT AgentGuard, to
 * measure what happens when an agent calls tools directly (argument validation only).
 * It is the single documented exception to the "executors only via PEP" rule and is
 * never reachable from app request handlers that act on user data: it runs against an
 * in-memory effect log and the scenario's synthetic corpus.
 */
import type { AgentPlanner } from "@/server/agent/types";
import { type Corpus, type SandboxEffect, getExecutor } from "@/server/tools/executors";
import { getTool, resourcesOf, destinationOf } from "@/server/tools/registry";

export interface BaselineCall {
  tool: string;
  args: unknown;
  executed: boolean;
  resources: string[];
  destination?: string;
  injected?: boolean;
}

export async function runUnguarded(params: {
  planner: AgentPlanner;
  prompt: string;
  corpus: Corpus;
  maxSteps?: number;
}): Promise<{ calls: BaselineCall[]; effects: SandboxEffect[] }> {
  const effects: SandboxEffect[] = [];
  const calls: BaselineCall[] = [];
  // Without a guard, the agent has every registered tool available.
  const tools = ["read_documents", "send_email", "export_data"].map((t) => getTool(t)!).filter(Boolean);
  params.planner.start(params.prompt, tools);
  for (let i = 0; i < (params.maxSteps ?? 10); i++) {
    const step = await params.planner.next();
    if (step.kind === "final") break;
    const tool = getTool(step.tool);
    const exec = getExecutor(step.tool);
    const parsed = tool?.argsSchema.safeParse(step.args);
    if (!tool || !exec || !parsed?.success) {
      calls.push({ tool: step.tool, args: step.args, executed: false, resources: [], injected: step.injected });
      params.planner.observe(step.stepId, { status: "failed", text: "Invalid tool call." });
      continue;
    }
    const resources = resourcesOf(tool, parsed.data);
    const missing = resources.filter((r) => !params.corpus.has(r));
    if (missing.length > 0) {
      calls.push({ tool: step.tool, args: step.args, executed: false, resources, injected: step.injected });
      params.planner.observe(step.stepId, { status: "failed", text: "Not found." });
      continue;
    }
    const r = await exec(parsed.data, {
      sessionId: "baseline",
      toolCallId: `b${i}`,
      corpus: params.corpus,
      recordEffect: async (e) => {
        effects.push(e);
      },
    });
    calls.push({
      tool: step.tool,
      args: step.args,
      executed: r.ok,
      resources,
      destination: destinationOf(tool, parsed.data)?.toLowerCase(),
      injected: step.injected,
    });
    params.planner.observe(step.stepId, { status: r.ok ? "executed" : "failed", text: r.output });
  }
  return { calls, effects };
}
