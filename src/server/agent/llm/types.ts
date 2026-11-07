/**
 * Provider-neutral LLM interface used by the LLM planner.
 *
 * A provider turns a conversation + tool specs into text and/or tool-call PROPOSALS.
 * Providers have no access to executors or the PEP; the runtime decides what happens
 * with each proposal (see src/server/agent/runtime.ts).
 */
export type ProviderId = "anthropic" | "ollama";

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ProposedCall {
  id: string;
  name: string;
  arguments: unknown;
}

export type ChatMessage =
  | { role: "user"; content: string }
  /** `raw` lets a provider replay its own native blocks (e.g. thinking blocks) unchanged. */
  | { role: "assistant"; content: string; toolCalls: ProposedCall[]; raw?: unknown }
  | { role: "tool"; toolCallId: string; name: string; content: string; isError: boolean };

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  timeoutMs: number;
}

export interface ChatResponse {
  text: string;
  toolCalls: ProposedCall[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "refusal" | "other";
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
  model: string;
  raw?: unknown;
}

export interface ModelConfig {
  model: string;
  temperature?: number;
  seed?: number;
  maxOutputTokens: number;
  contextTokens?: number;
}

export interface LLMProvider {
  readonly id: ProviderId;
  readonly config: ModelConfig;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: "unavailable" | "timeout" | "bad_response" | "auth" | "model_missing" | "other",
  ) {
    super(message);
  }
}
