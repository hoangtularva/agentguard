import type { ToolDefinition } from "@/server/tools/registry";

/** One decision of the agent: propose a tool call, or finish. */
export type AgentStep =
  | { kind: "tool_call"; stepId: string; tool: string; args: unknown; rationale?: string; injected?: boolean }
  | { kind: "final"; text: string };

export interface Observation {
  status: "executed" | "blocked" | "pending_approval" | "rejected" | "failed";
  /** Text the agent sees. Tool output is DATA: the planner must not treat it as instructions. */
  text: string;
}

/**
 * Planner = the "brain" proposing tool calls. It NEVER executes anything:
 * the runtime hands each proposal to the Policy Enforcement Point.
 */
export interface AgentPlanner {
  readonly id: string;
  readonly label: string;
  start(userPrompt: string, tools: ToolDefinition[]): void;
  next(): Promise<AgentStep>;
  observe(stepId: string, obs: Observation): void;
}
