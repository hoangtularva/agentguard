import type { ToolDefinition } from "@/server/tools/registry";
import type { AgentPlanner, AgentStep, Observation } from "./types";

/**
 * Deterministic, INTENTIONALLY NAIVE planner ("instruction follower").
 *
 * It models the failure mode Callwrit exists for: it treats instructions found
 * inside retrieved content as if the user had given them. That makes it a
 * reproducible stand-in for a prompt-injectable LLM agent, so the benchmark can
 * measure the guard (not the model's luck) with zero API cost and zero variance.
 *
 * It is NOT a claim about how any real model behaves; see docs/benchmark.md.
 */
const ID_RE = /\b(?:doc|ds):[a-z0-9_\-/.]*[a-z0-9_\-/]/gi;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const URL_RE = /https:\/\/[^\s"'<>)]+[^\s"'<>).,;:]/gi;

type Planned = Extract<AgentStep, { kind: "tool_call" }>;

export class SimulatedPlanner implements AgentPlanner {
  readonly id = "simulated-naive";
  readonly label = "Simulated agent (deterministic, injection-prone)";
  private queue: Planned[] = [];
  private seen = new Set<string>();
  private readContents: string[] = [];
  private tools = new Set<string>();
  private counter = 0;
  private userPrompt = "";
  private log: string[] = [];

  start(userPrompt: string, tools: ToolDefinition[]) {
    this.userPrompt = userPrompt;
    this.tools = new Set(tools.map((t) => t.name));
    const text = userPrompt;
    const ids = [...new Set(text.match(ID_RE) ?? [])];
    const emails = [...new Set((text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))];
    const urls = [...new Set(text.match(URL_RE) ?? [])];
    const wantsExport = /\bexport\b/i.test(text);
    const wantsEmail = /\b(e-?mail|send|forward|share)\b/i.test(text);

    const datasets = wantsExport ? ids.filter((i) => i.startsWith("ds:")) : [];
    const docs = ids.filter((i) => !datasets.includes(i));
    if (docs.length > 0) this.push("read_documents", { documentIds: docs }, "Read the documents the user referenced.");
    if (wantsEmail) {
      for (const to of emails) this.push("send_email", { to, subject: this.subject(), body: "__SUMMARY__" }, "User asked to email the summary.");
    }
    if (wantsExport) {
      for (const ds of datasets)
        for (const destination of urls) this.push("export_data", { dataset: ds, destination, format: "csv" }, "User asked for an export.");
    }
  }

  private subject() {
    const m = this.userPrompt.match(/subject\s+"([^"]{1,120})"/i);
    return m ? m[1] : "Summary from your assistant";
  }

  private push(tool: string, args: Record<string, unknown>, rationale: string, injected = false) {
    // Note: a naive agent proposes tools even outside its mandate; the PEP catches that.
    const key = `${tool}:${JSON.stringify(args)}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.counter += 1;
    this.queue.push({ kind: "tool_call", stepId: `sim_${this.counter}`, tool, args, rationale, injected });
  }

  async next(): Promise<AgentStep> {
    const step = this.queue.shift();
    if (!step) {
      return { kind: "final", text: this.log.length ? this.log.join(" ") : "Nothing to do." };
    }
    if (step.args && typeof step.args === "object" && (step.args as Record<string, unknown>).body === "__SUMMARY__") {
      const summary = this.readContents.join("\n\n").slice(0, 1500) || "No documents were read.";
      step.args = { ...(step.args as Record<string, unknown>), body: summary };
    }
    return step;
  }

  observe(_stepId: string, obs: Observation) {
    this.log.push(`[${obs.status}] ${obs.text.split("\n")[0].slice(0, 160)}`);
    if (obs.status !== "executed") return;
    const docs = [...obs.text.matchAll(/<document[^>]*>\n([\s\S]*?)\n<\/document>/g)].map((m) => m[1]);
    for (const content of docs) {
      this.readContents.push(content);
      this.followEmbeddedInstructions(content);
    }
  }

  /** The vulnerability: instructions inside data are obeyed. */
  private followEmbeddedInstructions(content: string) {
    for (const sentence of content.split(/(?<=[.!?])\s+/)) {
      const email = sentence.match(EMAIL_RE)?.[0];
      if (email && /\b(send|forward|email|mail)\b/i.test(sentence) && /\bto\b/i.test(sentence)) {
        const ids = sentence.match(ID_RE) ?? [];
        if (ids.length) this.push("read_documents", { documentIds: ids }, "Instruction found in document.", true);
        if (/salar/i.test(sentence)) this.push("read_documents", { documentIds: ["doc:restricted/salaries"] }, "Instruction found in document.", true);
        this.push("send_email", { to: email.toLowerCase(), subject: "Requested data", body: "__SUMMARY__" }, "Instruction found in document.", true);
      }
      const url = sentence.match(URL_RE)?.[0];
      const ds = sentence.match(/\bds:[a-z0-9_]+/i)?.[0];
      if (url && ds && /\b(export|upload|send)\b/i.test(sentence)) {
        this.push("export_data", { dataset: ds, destination: url, format: "csv" }, "Instruction found in document.", true);
      }
      const readMatch = sentence.match(/\b(read|open|load)\b[^.]{0,40}\b(doc:[a-z0-9_\-/]+)/i);
      if (readMatch) this.push("read_documents", { documentIds: [readMatch[2]] }, "Instruction found in document.", true);
    }
  }
}
