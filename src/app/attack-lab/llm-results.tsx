import fs from "node:fs";
import path from "node:path";
import { Cpu } from "lucide-react";
import { DecisionBadge, EmptyState, Panel, Pill, Stat } from "@/components/primitives";

type Prop = { tool: string; destination?: string; resources: string[]; decision?: string; reasonCodes?: string[]; executed: boolean; unauthorized: boolean };
type Mode = { outcome: string; attempted: boolean; attackSucceeded: boolean; completed: boolean; proposals: Prop[]; error?: string; durationMs: number };
type LlmReport = {
  id: string;
  startedAt: string;
  durationMs: number;
  config: { provider: string; model: string; modelDigest?: string; ollamaVersion?: string; hardware?: string; runs: number; dataset: string; sampling: Record<string, unknown> };
  metrics: {
    attackSuccessRate: { unguarded: number | null; guarded: number | null };
    attackAttemptRate: { unguarded: number | null; guarded: number | null };
    taskCompletionRate: { unguarded: number | null; guarded: number | null };
    unauthorizedActions: { proposed: number; blocked: number; reviewed: number; allowed: number };
    legitimateActions: { proposed: number; blocked: number; reviewed: number; falsePositiveRate: number | null };
    providerErrors: { unguarded: number; guarded: number };
    latency: { llmTurnP50Ms: number; scenarioP50Ms: number };
  };
  scenarios: { id: string; title: string; category: string; attack: boolean; runs: { unguarded: Mode; guarded: Mode }[] }[];
};

const p = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(0)}%`);
const OUTCOME_TONE: Record<string, "allow" | "block" | "review" | "neutral"> = {
  attack_blocked: "allow",
  attack_not_attempted: "neutral",
  attack_succeeded: "block",
  task_completed: "allow",
  task_failed_model: "review",
  task_failed_guard: "block",
  provider_error: "review",
};

/** Real-LLM track: read-only view of the latest `npm run bench:llm` report (never mixed with the simulated numbers). */
export function LlmResults() {
  const file = path.join(/* turbopackIgnore: true */ process.cwd(), "bench-results", "latest-llm.json");
  let r: LlmReport | null = null;
  try {
    r = JSON.parse(fs.readFileSync(file, "utf8")) as LlmReport;
  } catch {
    r = null;
  }
  if (!r)
    return (
      <Panel title="Real-LLM benchmark" description="Separate track: a real model proposes the tool calls.">
        <EmptyState icon={Cpu} title="No real-LLM run yet">
          Start Ollama, pull a model, then run <code>npm run bench:llm</code>. Results appear here.
        </EmptyState>
      </Panel>
    );
  const m = r.metrics;
  return (
    <Panel
      title="Real-LLM benchmark (held-out scenarios)"
      description={`${r.config.provider} · ${r.config.model} · ${r.config.dataset} · ${r.config.runs} run(s) · ${(r.durationMs / 60000).toFixed(0)} min on ${r.config.hardware ?? "local machine"}`}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Attack success, unguarded" value={p(m.attackSuccessRate.unguarded)} hint={`model attempted ${p(m.attackAttemptRate.unguarded)} of attacks`} />
        <Stat label="Attack success, AgentGuard" value={p(m.attackSuccessRate.guarded)} tone={m.attackSuccessRate.guarded === 0 ? "allow" : "block"} hint={`${m.unauthorizedActions.proposed} unauthorized calls proposed`} />
        <Stat label="Legit task completion" value={`${p(m.taskCompletionRate.unguarded)} → ${p(m.taskCompletionRate.guarded)}`} hint="unguarded → guarded" />
        <Stat label="False positives" value={p(m.legitimateActions.falsePositiveRate)} hint={`${m.legitimateActions.blocked}/${m.legitimateActions.proposed} legit calls blocked · ${m.legitimateActions.reviewed} reviewed`} />
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 pr-3 font-medium">Scenario</th>
              <th className="py-2 pr-3 font-medium">Unguarded</th>
              <th className="py-2 pr-3 font-medium">AgentGuard</th>
              <th className="py-2 font-medium">Calls the model proposed (guarded)</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {r.scenarios.map((s) => {
              const x = s.runs[0];
              return (
                <tr key={s.id} className="align-top">
                  <td className="py-2 pr-3"><span className="font-mono text-xs text-muted-foreground">{s.id}</span> {s.title}</td>
                  <td className="py-2 pr-3"><Pill tone={OUTCOME_TONE[x.unguarded.outcome] ?? "neutral"}>{x.unguarded.outcome}</Pill></td>
                  <td className="py-2 pr-3"><Pill tone={OUTCOME_TONE[x.guarded.outcome] ?? "neutral"}>{x.guarded.outcome}</Pill></td>
                  <td className="py-2 text-xs">
                    {x.guarded.error && <span className="text-review">{x.guarded.error.slice(0, 120)}</span>}
                    <ul className="space-y-0.5">
                      {x.guarded.proposals.map((c, i) => (
                        <li key={i} className="flex flex-wrap items-center gap-1">
                          {c.decision && <DecisionBadge decision={c.decision} />}
                          <span className="font-mono">{c.tool} {c.destination ?? c.resources.join(",")}</span>
                          {c.unauthorized && <Pill tone="block">unauthorized</Pill>}
                          {c.reasonCodes?.length ? <span className="text-muted-foreground">{c.reasonCodes.join(", ")}</span> : null}
                        </li>
                      ))}
                      {x.guarded.proposals.length === 0 && !x.guarded.error && <li className="text-muted-foreground">no tool calls</li>}
                    </ul>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Outcome legend: <b>attack_not_attempted</b> = the model ignored the injection itself; <b>attack_blocked</b> = it tried and AgentGuard stopped it; <b>task_failed_model</b> = the model could not finish a legitimate task (not caused by the guard). Digest {r.config.modelDigest?.slice(0, 12) ?? "n/a"} · LLM turn p50 {(m.latency.llmTurnP50Ms / 1000).toFixed(1)} s.
      </p>
    </Panel>
  );
}
