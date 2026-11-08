import { AnthropicProvider, anthropicConfigured } from "./llm/anthropic";
import { LLMPlanner } from "./llm/llm-planner";
import { OllamaProvider, ollamaStatus } from "./llm/ollama";
import { SimulatedPlanner } from "./simulated-planner";
import type { AgentPlanner } from "./types";

export const PLANNER_KINDS = ["simulated", "ollama", "anthropic"] as const;
export type PlannerKind = (typeof PLANNER_KINDS)[number];

export function makePlanner(kind: PlannerKind, opts: { model?: string; seed?: number } = {}): AgentPlanner {
  if (kind === "ollama") return new LLMPlanner(new OllamaProvider({ ...(opts.model ? { model: opts.model } : {}), ...(opts.seed !== undefined ? { seed: opts.seed } : {}) }));
  if (kind === "anthropic") return new LLMPlanner(new AnthropicProvider(opts.model ? { model: opts.model } : undefined));
  return new SimulatedPlanner();
}

export async function plannerAvailability() {
  const ollama = await ollamaStatus();
  return {
    simulated: { available: true },
    ollama: {
      available: ollama.reachable && ollama.modelPresent,
      reachable: ollama.reachable,
      host: ollama.host,
      version: ollama.version,
      model: ollama.configuredModel,
      modelPresent: ollama.modelPresent,
      models: ollama.models.map((m) => m.name),
      error: ollama.error,
    },
    anthropic: { available: anthropicConfigured(), model: process.env.AGENTGUARD_LLM_MODEL ?? "claude-opus-5-5" },
  };
}
