/**
 * CLI: npm run bench            -> deterministic benchmark (simulated planner), 3 runs
 *      npm run bench -- --runs 5
 *      npm run bench:llm         -> same scenarios with the Claude planner (needs credentials)
 * Writes bench-results/latest.json and bench-results/<id>.json, prints a summary table.
 */
import fs from "node:fs";
import path from "node:path";
import { llmConfigured } from "../src/server/agent/claude-planner";
import { runBenchmark } from "../src/server/bench/harness";
import { createDatabase } from "../src/server/db/client";

async function main() {
  const argv = process.argv.slice(2);
  const llm = argv.includes("--llm");
  const runsIdx = argv.indexOf("--runs");
  const runs = runsIdx >= 0 ? Number(argv[runsIdx + 1]) : llm ? 1 : 3;
  if (llm && !llmConfigured()) {
    console.error("LLM benchmark skipped: set ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN). Nothing was run.");
    process.exit(2);
  }
  const db = await createDatabase({ pgliteDir: "memory" });
  const report = await runBenchmark(db, { planner: llm ? "claude" : "simulated", runs }, (m) => process.stdout.write(`\r${m.padEnd(30)}`));
  process.stdout.write("\n");
  const dir = path.join(process.cwd(), "bench-results");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${report.id}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, llm ? "latest-llm.json" : "latest.json"), JSON.stringify(report, null, 2));
  const m = report.metrics;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.table({
    "Scenarios (agent+approval)": `${m.agentScenarios}+${m.approvalScenarios}`,
    "Scenario pass rate": pct(m.passRate),
    "ASR baseline (no guard)": pct(m.attackSuccessRate.baseline),
    "ASR AgentGuard": pct(m.attackSuccessRate.guarded),
    "ASR AgentGuard, rubber-stamp reviewer": pct(m.attackSuccessRate.rubberStamp),
    "Unauthorized block rate": `${pct(m.unauthorizedActions.blockRate)} (${m.unauthorizedActions.blocked}/${m.unauthorizedActions.proposed})`,
    "Unauthorized intercept rate (block+review)": pct(m.unauthorizedActions.interceptRate),
    "False positive rate (legit blocked)": `${pct(m.legitimateActions.falsePositiveRate)} (${m.legitimateActions.blocked}/${m.legitimateActions.proposed})`,
    "Legit review rate (friction)": pct(m.legitimateActions.reviewRate),
    "Task completion baseline / guarded": `${pct(m.taskCompletionRate.baseline)} / ${pct(m.taskCompletionRate.guarded)}`,
    "Expected-decision accuracy": pct(m.expectationAccuracy),
    "Approval replay prevention": `${m.approvalReplayPrevention.prevented}/${m.approvalReplayPrevention.total}`,
    "PDP latency p50/p95 (µs, microbench)": `${m.pdpMicrobenchUs.p50} / ${m.pdpMicrobenchUs.p95}`,
    "PEP end-to-end p50/p95 (ms)": `${m.latencyMs.pepP50} / ${m.latencyMs.pepP95}`,
    Deterministic: String(m.deterministic),
  });
  const failed = report.scenarios.filter((x) => !x.pass);
  if (failed.length) console.log("FAILED scenarios:", failed.map((f) => f.id).join(", "));
  console.log(`Report: bench-results/${report.id}.json (${report.durationMs} ms)`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
