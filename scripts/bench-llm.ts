/**
 * Real-LLM benchmark (separate track from `npm run bench`).
 *
 *   npm run bench:llm                                  # Ollama, held-out set, 1 run
 *   npm run bench:llm -- --set development --runs 2
 *   npm run bench:llm -- --ids H05,H07 --model qwen2.5:3b
 *   npm run bench:llm -- --provider anthropic          # needs ANTHROPIC_API_KEY
 *
 * Writes bench-results/llm-<id>.json (+ a checkpoint after every scenario) and
 * docs/benchmark-llm-latest.md. Nothing here is hand-edited.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { anthropicConfigured } from "../src/server/agent/llm/anthropic";
import { ollamaHost, ollamaStatus } from "../src/server/agent/llm/ollama";
import type { PlannerKind } from "../src/server/agent/planners";
import { HOLDOUT_SCENARIOS } from "../src/server/bench/independent-scenarios";
import { type LlmScenarioResult, computeLlmMetrics, runLlmBenchmark } from "../src/server/bench/llm-harness";
import { AGENT_SCENARIOS } from "../src/server/bench/scenarios";
import { LLM_V2_VERSION, V2_DEV, V2_HOLDOUT } from "../src/server/bench/llm-v2-scenarios";
import { createDatabase } from "../src/server/db/client";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const provider = (arg("provider") ?? "ollama") as PlannerKind;
  const set = arg("set") ?? "holdout";
  const runs = Number(arg("runs") ?? 1);
  const ids = arg("ids")?.split(",");
  const model = arg("model") ?? (provider === "ollama" ? process.env.AGENTGUARD_OLLAMA_MODEL : undefined);
  const SETS: Record<string, { list: typeof AGENT_SCENARIOS; label: string; doc: string }> = {
    development: { list: AGENT_SCENARIOS, label: "simulated development set (scenarios.ts)", doc: "benchmark-llm-development.md" },
    holdout: { list: HOLDOUT_SCENARIOS, label: "phase-2 held-out set (independent-scenarios.ts)", doc: "benchmark-llm-latest.md" },
    "v2-dev": { list: V2_DEV, label: `${LLM_V2_VERSION} DEV split (llm-v2-scenarios.ts)`, doc: "benchmark-llm-v2-dev.md" },
    "v2-holdout": { list: V2_HOLDOUT, label: `${LLM_V2_VERSION} HOLDOUT split (llm-v2-scenarios.ts)`, doc: "benchmark-llm-v2-holdout.md" },
  };
  if (!SETS[set]) {
    console.error(`Unknown --set ${set}. Use one of: ${Object.keys(SETS).join(", ")}`);
    process.exit(2);
  }
  const seedBase = Number(arg("seed") ?? 42);
  let scenarios = SETS[set].list;
  if (ids) scenarios = scenarios.filter((s) => ids.includes(s.id));

  const meta: Record<string, unknown> = {
    nodeVersion: process.version,
    hardware: `${os.cpus()[0]?.model} x${os.cpus().length} threads, ${(os.totalmem() / 2 ** 30).toFixed(1)} GB RAM, ${os.platform()} ${os.release()}`,
  };
  if (provider === "ollama") {
    const st = await ollamaStatus();
    const want = model ?? st.configuredModel;
    if (!st.reachable) {
      console.error(`Ollama not reachable at ${st.host}. Start it with "ollama serve". Nothing was run.`);
      process.exit(2);
    }
    const m = st.models.find((x) => x.name === want || x.name === `${want}:latest`);
    if (!m) {
      console.error(`Model ${want} is not pulled. Run "ollama pull ${want}". Nothing was run.`);
      process.exit(2);
    }
    Object.assign(meta, { ollamaVersion: st.version, modelDigest: m.digest, modelDetails: { family: m.family, parameterSize: m.parameterSize, quantization: m.quantization, sizeBytes: m.size }, host: ollamaHost() });
  } else if (provider === "anthropic" && !anthropicConfigured()) {
    console.error("ANTHROPIC_API_KEY not set. Nothing was run.");
    process.exit(2);
  }

  const db = await createDatabase({ pgliteDir: "memory" });
  const id = `llm_${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12)}`;
  const dir = path.join(process.cwd(), "bench-results");
  fs.mkdirSync(dir, { recursive: true });
  const checkpoint = path.join(dir, `${id}.partial.json`);
  const results: LlmScenarioResult[] = [];
  let lastConfig: Record<string, unknown> = {};
  const started = Date.now();

  for (const sc of scenarios) {
    const r = await runLlmBenchmark(db, { provider, model, runs, seedBase, scenarios: [sc], datasetLabel: set }, (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`));
    results.push(...r.scenarios);
    lastConfig = r.config;
    fs.writeFileSync(checkpoint, JSON.stringify({ id, done: results.map((x) => x.id), results }, null, 2));
  }

  const report = {
    id,
    track: "real-llm",
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    config: { ...lastConfig, ...meta, dataset: SETS[set].label },
    metrics: computeLlmMetrics(results, scenarios),
    scenarios: results,
  };
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, set.startsWith("v2") ? `latest-llm-${set}.json` : "latest-llm.json"), JSON.stringify(report, null, 2));
  fs.mkdirSync(path.join(process.cwd(), "docs", "results"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), "docs", "results", `${id}-${set}.json`), JSON.stringify(report, null, 2));
  fs.rmSync(checkpoint, { force: true });

  const m = report.metrics;
  const p = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);
  const cfg = report.config as Record<string, unknown>;
  const md = [
    "<!-- GENERATED by `npm run bench:llm` from bench-results/latest-llm.json. Do not edit by hand. -->",
    "# Real-LLM benchmark — latest run",
    "",
    `Run \`${id}\` · ${report.startedAt} · ${(report.durationMs / 60000).toFixed(1)} min`,
    "",
    "| Config | Value |",
    "|---|---|",
    `| Provider / model | ${cfg.provider} / ${cfg.model} |`,
    `| Model digest | ${cfg.modelDigest ?? "n/a"} |`,
    `| Model details | ${JSON.stringify(cfg.modelDetails ?? {})} |`,
    `| Runtime | Ollama ${cfg.ollamaVersion ?? "n/a"} · Node ${cfg.nodeVersion} |`,
    `| Hardware | ${cfg.hardware} |`,
    `| Sampling | ${JSON.stringify(cfg.sampling)} |`,
    `| System prompt | defensive (shipped default) |`,
    `| Dataset | ${cfg.dataset} · ${scenarios.length} scenarios × ${runs} run(s) |`,
    "",
    "| Metric | Unguarded | AgentGuard |",
    "|---|---|---|",
    `| Attack success rate | ${p(m.attackSuccessRate.unguarded)} (95% CI ${p(m.ci95.attackSuccessUnguarded.lo)}–${p(m.ci95.attackSuccessUnguarded.hi)}) | ${p(m.attackSuccessRate.guarded)} (95% CI ${p(m.ci95.attackSuccessGuarded.lo)}–${p(m.ci95.attackSuccessGuarded.hi)}) |`,
    `| Attack attempt rate (model proposed a forbidden call) | ${p(m.attackAttemptRate.unguarded)} | ${p(m.attackAttemptRate.guarded)} |`,
    `| Legitimate task completion | ${p(m.taskCompletionRate.unguarded)} | ${p(m.taskCompletionRate.guarded)} |`,
    `| Unintended action executed on a legit task (e.g. hallucinated recipient) | ${p(m.unintendedActionRate.unguarded)} | ${p(m.unintendedActionRate.guarded)} |`,
    `| Provider errors (runs) | ${m.providerErrors.unguarded} | ${m.providerErrors.guarded} |`,
    "",
    "| Guarded metric | Value |",
    "|---|---|",
    `| Unauthorized calls proposed | ${m.unauthorizedActions.proposed} (blocked ${m.unauthorizedActions.blocked}, review ${m.unauthorizedActions.reviewed}, allowed ${m.unauthorizedActions.allowed}) |`,
    `| Unauthorized block rate / intercept rate | ${p(m.unauthorizedActions.blockRate)} / ${p(m.unauthorizedActions.interceptRate)} |`,
    `| False positive rate (legit calls blocked) | ${p(m.legitimateActions.falsePositiveRate)} (${m.legitimateActions.blocked}/${m.legitimateActions.proposed}); review ${m.legitimateActions.reviewed} |`,
    `| LLM turn latency p50 / p95 | ${m.latency.llmTurnP50Ms} / ${m.latency.llmTurnP95Ms} ms |`,
    `| End-to-end scenario (guarded) p50 | ${m.latency.scenarioP50Ms} ms |`,
    `| PDP evaluation p50 / p95 (in run) | ${m.latency.pdpEvalP50Ms} / ${m.latency.pdpEvalP95Ms} ms |`,
    `| Tokens in / out (all runs) | ${m.latency.inputTokensTotal} / ${m.latency.outputTokensTotal} |`,
    "",
    `| Calls held for approval (share of all guarded calls) | — | ${p(m.approvalRate.reviewShareOfAllGuardedCalls)} (${m.approvalRate.approvedByReviewer} approved, ${m.approvalRate.rejectedByReviewer} rejected) |`,
    `| False positive 95% CI | — | ${p(m.ci95.falsePositive.lo)}–${p(m.ci95.falsePositive.hi)} (n=${m.ci95.falsePositive.n}) |`,
    `| Seeds | ${(cfg.seeds as number[] | undefined)?.join(", ") ?? "42"} | |`,
    "",
    "_CIs treat each scenario-run as independent; repetitions of one scenario are correlated, so intervals are optimistic._",
    "",
    "## Outcomes",
    "",
    `Unguarded: ${JSON.stringify(m.outcomes.unguarded)}  `,
    `Guarded: ${JSON.stringify(m.outcomes.guarded)}`,
    "",
    "## Per-scenario (all runs: outcome per seed)",
    "",
    "| ID | Category | Unguarded outcome(s) | Unguarded calls (seed 1) | Guarded outcome(s) | Guarded calls → decision (seed 1) |",
    "|---|---|---|---|---|---|",
    ...results.map((r) => {
      const x = r.runs[0];
      const ug = x.unguarded.proposals.map((c) => `${c.tool}(${c.destination ?? c.resources.join(",")})${c.executed ? "✓" : ""}`).join("; ") || (x.unguarded.error ? `error: ${x.unguarded.error.slice(0, 60)}` : "—");
      const g = x.guarded.proposals.map((c) => `${c.tool}(${c.destination ?? c.resources.join(",")})→${c.decision}${c.reasonCodes?.length ? ` [${c.reasonCodes.join(",")}]` : ""}`).join("; ") || (x.guarded.error ? `error: ${x.guarded.error.slice(0, 60)}` : "—");
      return `| ${r.id} | ${r.category} | ${r.runs.map((y) => y.unguarded.outcome).join(" / ")} | ${ug} | ${r.runs.map((y) => y.guarded.outcome).join(" / ")} | ${g} |`;
    }),
    "",
    "## Limitations",
    "",
    "- Small local model on CPU; results describe this model/config only.",
    "- Temperature 0 + fixed seed: near-deterministic on this machine, not guaranteed across hardware or Ollama versions.",
    "- Oracle reviewer approves exactly the legitimate actions.",
    "- Defensive system prompt is on in both modes, so the unguarded baseline already includes prompt-level defense.",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(process.cwd(), "docs", SETS[set].doc), md);
  console.log(md.split("## Outcomes")[0]);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
