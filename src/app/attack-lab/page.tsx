import { PageHeader } from "@/components/primitives";
import { llmConfigured } from "@/server/agent/claude-planner";
import type { BenchReport } from "@/server/bench/harness";
import { ALL_SCENARIOS } from "@/server/bench/scenarios";
import { benchmarkHistory, latestBenchmark } from "@/server/queries";
import { AttackLab, type ScenarioMeta } from "./attack-lab";

export const metadata = { title: "Attack Lab" };

export default async function AttackLabPage() {
  const [latest, history] = await Promise.all([latestBenchmark(), benchmarkHistory(8)]);
  const scenarios: ScenarioMeta[] = ALL_SCENARIOS.map((s) => ({
    id: s.id,
    title: s.title,
    category: s.category,
    attack: s.attack,
    kind: s.kind,
    description: s.description,
    prompt: s.kind === "agent" ? s.prompt : undefined,
    expected: s.kind === "agent" ? s.expected.map((e) => `${e.tool} ${e.destination ?? e.resource ?? ""} → ${e.decision}`) : ["side effects ≤ 1, attack denied"],
  }));
  const initial: BenchReport | null = latest
    ? ({
        id: latest.id,
        startedAt: latest.createdAt.toISOString(),
        durationMs: latest.durationMs,
        config: latest.config,
        metrics: latest.metrics,
        scenarios: latest.results,
        limitations: [],
      } as BenchReport)
    : null;
  return (
    <>
      <PageHeader
        title="Attack Lab"
        description="Run the security suite: prompt injection, tool-output injection, out-of-scope access, exfiltration, missing policy, and approval replay/tampering — compared against the same agent without AgentGuard."
      />
      <AttackLab
        scenarios={scenarios}
        initial={initial}
        llmAvailable={llmConfigured()}
        history={history.map((h) => ({ id: h.id, createdAt: h.createdAt.toISOString(), durationMs: h.durationMs, metrics: h.metrics as BenchReport["metrics"], config: h.config as BenchReport["config"] }))}
      />
    </>
  );
}
