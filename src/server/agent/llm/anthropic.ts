import Anthropic from "@anthropic-ai/sdk";
import { type ChatMessage, type ChatRequest, type ChatResponse, type LLMProvider, type ModelConfig, ProviderError } from "./types";

/**
 * Anthropic provider (optional, needs ANTHROPIC_API_KEY or an `ant auth login` profile).
 * Model: AGENTGUARD_LLM_MODEL (default claude-opus-5-5), effort AGENTGUARD_LLM_EFFORT (default low).
 * Assistant turns are replayed from their raw content blocks so thinking blocks are passed back unchanged.
 */
export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic" as const;
  readonly config: ModelConfig;
  private client = new Anthropic();

  constructor(config?: Partial<ModelConfig>) {
    this.config = { model: config?.model ?? process.env.AGENTGUARD_LLM_MODEL ?? "claude-opus-5-5", maxOutputTokens: config?.maxOutputTokens ?? 16000 };
  }

  private toMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
    const out: Anthropic.MessageParam[] = [];
    let pendingResults: Anthropic.ToolResultBlockParam[] = [];
    const flush = () => {
      if (pendingResults.length) out.push({ role: "user", content: pendingResults });
      pendingResults = [];
    };
    for (const m of messages) {
      if (m.role === "tool") {
        pendingResults.push({ type: "tool_result", tool_use_id: m.toolCallId, content: m.content, is_error: m.isError });
        continue;
      }
      flush();
      if (m.role === "user") out.push({ role: "user", content: m.content });
      else
        out.push({
          role: "assistant",
          content: (m.raw as Anthropic.ContentBlockParam[] | undefined) ?? [
            ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
            ...m.toolCalls.map((c) => ({ type: "tool_use" as const, id: c.id, name: c.name, input: c.arguments as Record<string, unknown> })),
          ],
        });
    }
    flush();
    return out;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const t0 = performance.now();
    const effort = (process.env.AGENTGUARD_LLM_EFFORT ?? "low") as "low" | "medium" | "high";
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create(
        {
          model: this.config.model,
          max_tokens: this.config.maxOutputTokens,
          system: req.system,
          tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Tool.InputSchema, strict: true })),
          tool_choice: { type: "auto" },
          output_config: { effort },
          messages: this.toMessages(req.messages),
        },
        { timeout: req.timeoutMs },
      );
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new ProviderError("Anthropic authentication failed", "auth");
      if (e instanceof Anthropic.APIConnectionTimeoutError) throw new ProviderError("Anthropic request timed out", "timeout");
      if (e instanceof Anthropic.APIConnectionError) throw new ProviderError("Anthropic API unreachable", "unavailable");
      throw new ProviderError(`Anthropic error: ${(e as Error).message}`, "other");
    }
    const toolCalls = response.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, arguments: b.input }));
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const stop = response.stop_reason;
    return {
      text,
      toolCalls,
      stopReason: stop === "tool_use" ? "tool_use" : stop === "end_turn" ? "end_turn" : stop === "max_tokens" ? "max_tokens" : stop === "refusal" ? "refusal" : "other",
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      latencyMs: performance.now() - t0,
      model: response.model,
      raw: response.content,
    };
  }
}

export function anthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}
