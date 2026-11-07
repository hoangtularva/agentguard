import { AnthropicProvider, anthropicConfigured } from "./llm/anthropic";
import { LLMPlanner } from "./llm/llm-planner";

/** Backwards-compatible factory: Claude via the generic LLM planner. */
export class ClaudePlanner extends LLMPlanner {
  constructor() {
    super(new AnthropicProvider());
  }
}

export const llmConfigured = anthropicConfigured;
