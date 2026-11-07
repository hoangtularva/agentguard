import { randomUUID } from "node:crypto";
import { type ChatMessage, type ChatRequest, type ChatResponse, type LLMProvider, type ModelConfig, ProviderError } from "./types";

/**
 * Ollama provider (local, free). Uses the native /api/chat endpoint with tool calling.
 * Env: OLLAMA_HOST (default http://127.0.0.1:11434), AGENTGUARD_OLLAMA_MODEL.
 * Sampling defaults favour reproducibility: temperature 0 and a fixed seed.
 */
export const OLLAMA_DEFAULT_MODEL = "qwen2.5:3b";

export function ollamaHost(): string {
  return (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
}

type OllamaMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { function: { name: string; arguments: unknown } }[];
  tool_name?: string;
};

function toOllama(system: string, messages: ChatMessage[]): OllamaMessage[] {
  const out: OllamaMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant")
      out.push({ role: "assistant", content: m.content, tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.arguments } })) });
    else out.push({ role: "tool", content: m.content, tool_name: m.name });
  }
  return out;
}

export class OllamaProvider implements LLMProvider {
  readonly id = "ollama" as const;
  readonly config: ModelConfig;

  constructor(config?: Partial<ModelConfig>) {
    this.config = {
      model: config?.model ?? process.env.AGENTGUARD_OLLAMA_MODEL ?? OLLAMA_DEFAULT_MODEL,
      temperature: config?.temperature ?? 0,
      seed: config?.seed ?? 42,
      maxOutputTokens: config?.maxOutputTokens ?? 512,
      contextTokens: config?.contextTokens ?? 4096,
    };
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs);
    const t0 = performance.now();
    let res: Response;
    try {
      res = await fetch(`${ollamaHost()}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: this.config.model,
          stream: false,
          messages: toOllama(req.system, req.messages),
          tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
          options: {
            temperature: this.config.temperature,
            seed: this.config.seed,
            num_predict: this.config.maxOutputTokens,
            num_ctx: this.config.contextTokens,
          },
        }),
      });
    } catch (e) {
      clearTimeout(timer);
      if ((e as Error).name === "AbortError") throw new ProviderError(`Ollama timed out after ${req.timeoutMs} ms`, "timeout");
      throw new ProviderError(`Ollama is not reachable at ${ollamaHost()} (${(e as Error).message})`, "unavailable");
    }
    clearTimeout(timer);
    if (res.status === 404) throw new ProviderError(`Model "${this.config.model}" is not pulled in Ollama`, "model_missing");
    if (!res.ok) throw new ProviderError(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`, "other");
    const j = (await res.json()) as {
      model: string;
      message?: { content?: string; tool_calls?: { function: { name: string; arguments: unknown } }[] };
      done_reason?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    if (!j.message) throw new ProviderError("Ollama returned no message", "bad_response");
    const toolCalls = (j.message.tool_calls ?? []).map((c) => ({
      id: `oll_${randomUUID().slice(0, 8)}`,
      name: c.function.name,
      arguments: typeof c.function.arguments === "string" ? safeJson(c.function.arguments) : c.function.arguments,
    }));
    return {
      text: j.message.content ?? "",
      toolCalls,
      stopReason: toolCalls.length ? "tool_use" : j.done_reason === "length" ? "max_tokens" : "end_turn",
      usage: { inputTokens: j.prompt_eval_count ?? 0, outputTokens: j.eval_count ?? 0 },
      latencyMs: performance.now() - t0,
      model: j.model,
    };
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return { _unparseable: s.slice(0, 500) };
  }
}

export interface OllamaStatus {
  reachable: boolean;
  host: string;
  version?: string;
  models: { name: string; size: number; digest: string; family?: string; parameterSize?: string; quantization?: string }[];
  configuredModel: string;
  modelPresent: boolean;
  error?: string;
}

/** Cheap health check used by the UI and benchmark (2 s timeout). */
export async function ollamaStatus(): Promise<OllamaStatus> {
  const configuredModel = process.env.AGENTGUARD_OLLAMA_MODEL ?? OLLAMA_DEFAULT_MODEL;
  const base = { host: ollamaHost(), configuredModel, models: [] as OllamaStatus["models"] };
  try {
    const ctrl = AbortSignal.timeout(2000);
    const [v, t] = await Promise.all([fetch(`${ollamaHost()}/api/version`, { signal: ctrl }), fetch(`${ollamaHost()}/api/tags`, { signal: ctrl })]);
    const version = ((await v.json()) as { version?: string }).version;
    const tags = (await t.json()) as { models?: { name: string; size: number; digest: string; details?: { family?: string; parameter_size?: string; quantization_level?: string } }[] };
    const models = (tags.models ?? []).map((m) => ({
      name: m.name,
      size: m.size,
      digest: m.digest,
      family: m.details?.family,
      parameterSize: m.details?.parameter_size,
      quantization: m.details?.quantization_level,
    }));
    return { ...base, reachable: true, version, models, modelPresent: models.some((m) => m.name === configuredModel || m.name === `${configuredModel}:latest`) };
  } catch (e) {
    return { ...base, reachable: false, modelPresent: false, error: (e as Error).message };
  }
}
