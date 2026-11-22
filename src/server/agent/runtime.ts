import type { EnforcementPoint, EnforcementResult, SessionState } from "@/server/enforcement/pep";
import { getTool } from "@/server/tools/registry";
import type { AgentPlanner, Observation } from "./types";

export interface TraceStep {
  index: number;
  tool: string;
  args: unknown;
  rationale?: string;
  injected?: boolean;
  result: EnforcementResult;
  observation: Observation;
  approval?: { outcome: "approved_executed" | "rejected" | "paused" | "denied"; detail?: string };
}

export interface AgentRunResult {
  sessionId: string;
  status: "completed" | "awaiting_approval" | "failed";
  steps: TraceStep[];
  finalMessage: string;
}

/**
 * What to do when the PEP returns REVIEW:
 *  - "pause": stop the run at the first action needing approval
 *  - "defer": leave the action pending (human decides later in the Approval Inbox) and let the agent continue
 *  - a function: synchronous reviewer (benchmark's simulated human) that returns the observation
 */
export type ReviewHandler = "pause" | "defer" | ((r: EnforcementResult, step: { tool: string; args: unknown; injected?: boolean }) => Promise<{ observation: Observation; outcome: NonNullable<TraceStep["approval"]>["outcome"] }>);

function blockedText(r: EnforcementResult) {
  const reasons = r.decision.reasons
    .filter((x) => x.effect === "BLOCK" || x.code !== "RULE_MATCHED")
    .map((x) => `${x.code}: ${x.message}`)
    .join(" | ");
  const hint = r.decision.reasons.some((x) => x.code === "INVALID_ARGUMENTS") ? " Correct the arguments as described and call the tool again." : "";
  return `BLOCKED by Callwrit (policy v${r.decision.policyVersion}). ${reasons}${hint}`;
}

/**
 * The agent loop. The planner proposes; the PEP decides and (only if allowed) executes.
 * The runtime has no reference to any executor.
 */
export async function runAgent(params: {
  pep: EnforcementPoint;
  planner: AgentPlanner;
  session: SessionState;
  prompt: string;
  agentId: string;
  onReview: ReviewHandler;
  maxSteps?: number;
}): Promise<AgentRunResult> {
  const { pep, planner, session } = params;
  const maxSteps = params.maxSteps ?? 10;
  const tools = session.mandate.allowedTools.map((t) => getTool(t)).filter((t) => !!t);
  planner.start(params.prompt, tools);
  const steps: TraceStep[] = [];
  let deferred = 0;
  const done = (finalMessage: string): AgentRunResult => ({ sessionId: session.id, status: deferred > 0 ? "awaiting_approval" : "completed", steps, finalMessage });

  for (let i = 0; i < maxSteps; i++) {
    let step;
    try {
      step = await planner.next();
    } catch (err) {
      return { sessionId: session.id, status: "failed", steps, finalMessage: `Planner error: ${(err as Error).message}` };
    }
    if (step.kind === "final") return done(step.text);

    const result = await pep.enforce(session, {
      tool: step.tool,
      args: step.args,
      agentId: params.agentId,
      rationale: step.rationale,
    });
    let observation: Observation;
    let approval: TraceStep["approval"];
    if (result.decision.decision === "BLOCK") {
      observation = { status: "blocked", text: blockedText(result) };
    } else if (result.decision.decision === "REVIEW") {
      if (params.onReview === "defer") {
        observation = { status: "pending_approval", text: "This action is awaiting human approval; it has NOT been executed. Continue with other work." };
        approval = { outcome: "paused" };
        deferred += 1;
        planner.observe(step.stepId, observation);
        steps.push({ index: i, tool: step.tool, args: step.args, rationale: step.rationale, injected: step.injected, result, observation, approval });
        continue;
      }
      if (params.onReview === "pause") {
        observation = { status: "pending_approval", text: "Awaiting human approval." };
        approval = { outcome: "paused" };
        steps.push({ index: i, tool: step.tool, args: step.args, rationale: step.rationale, injected: step.injected, result, observation, approval });
        return {
          sessionId: session.id,
          status: "awaiting_approval",
          steps,
          finalMessage: `Paused: "${step.tool}" needs approval in the Approval Inbox.`,
        };
      }
      const r = await params.onReview(result, step);
      observation = r.observation;
      approval = { outcome: r.outcome };
    } else {
      observation = result.status === "executed" ? { status: "executed", text: result.output ?? "" } : { status: "failed", text: result.output ?? "Execution failed." };
    }
    planner.observe(step.stepId, observation);
    steps.push({ index: i, tool: step.tool, args: step.args, rationale: step.rationale, injected: step.injected, result, observation, approval });
  }
  return done("Stopped: step limit reached.");
}
