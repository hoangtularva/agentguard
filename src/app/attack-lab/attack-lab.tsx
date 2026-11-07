"use client";

import { CheckCircle2, ChevronDown, Download, Loader2, Play, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { DecisionBadge, Panel, Pill, Stat, pct, timeAgo } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ScenarioMeta = {
  id: string;
  title: string;
  category: string;
  attack: boolean;
  kind: "agent" | "approval";
  description: string;
  prompt?: string;
  expected: string[];
};

type Proposal = { tool: string; resources: string[]; destination?: string; decision: string; reasonCodes: string[]; executed: boolean; unauthorized: boolean; injected: boolean };
type AgentRun = {
  baseline: { attackSucceeded: boolean; completed: boolean; executed: { tool: string; resources: string[]; destination?: string }[] };
  guarded: { attackSucceeded: boolean; completed: boolean; proposals: Proposal[] };
  rubberStamp: { attackSucceeded: boolean };
  expectations: { matcher: { tool: string; destination?: string; resource?: string }; expected: string; actual: string; pass: boolean }[];
  pass: boolean;
};
type ApprovalRun = { prevented: boolean; detail: string; sideEffects: number };
type ScenarioResult = { id: string; title: string; category: string; attack: boolean; kind: "agent" | "approval"; runs: (AgentRun | ApprovalRun)[]; pass: boolean };
type Metrics = {
  scenarios: number;
  passRate: number;
  attackSuccessRate: { baseline: number; guarded: number; rubberStamp: number };
  unauthorizedActions: { proposed: number; blocked: number; reviewed: number; blockRate: number; interceptRate: number };
  legitimateActions: { proposed: number; blocked: number; reviewed: number; falsePositiveRate: number; reviewRate: number };
  taskCompletionRate: { baseline: number; guarded: number };
  expectationAccuracy: number;
  approvalReplayPrevention: { prevented: number; total: number; rate: number };
  latencyMs: { pepP50: number; pepP95: number; samples: number };
  pdpMicrobenchUs: { p50: number; p95: number; iterations: number };
  deterministic: boolean;
};
type Report = { id: string; startedAt: string; durationMs: number; config: { planner: string; runs: number; model: string }; metrics: Metrics; scenarios: ScenarioResult[] };

const CATEGORY_LABEL: Record<string, string> = {
  legitimate: "Legitimate task",
  false_positive_check: "False-positive check",
  injection_document: "Prompt injection (document/email)",
  injection_tool_output: "Tool-output injection",
  unauthorized_resource: "Unauthorized resource",
  unauthorized_destination: "Unauthorized destination",
  missing_policy: "Missing policy",
  approval_attack: "Approval attack",
};

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(v: unknown) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per scenario run: what the agent proposed and what AgentGuard decided. */
function toCsv(report: Report): string {
  const rows = [["scenario", "category", "attack", "run", "pass", "baseline_attack_succeeded", "guarded_attack_succeeded", "rubber_stamp_attack_succeeded", "guarded_decisions", "detail"]];
  for (const sc of report.scenarios) {
    sc.runs.forEach((r, i) => {
      if ("guarded" in r) {
        const a = r as AgentRun;
        rows.push([sc.id, sc.category, String(sc.attack), String(i + 1), String(sc.pass), String(a.baseline.attackSucceeded), String(a.guarded.attackSucceeded), String(a.rubberStamp.attackSucceeded), a.guarded.proposals.map((p) => `${p.tool}:${p.decision}`).join(" "), ""]);
      } else {
        const ap = r as ApprovalRun;
        rows.push([sc.id, sc.category, "true", String(i + 1), String(sc.pass), "", String(!ap.prevented), "", "", ap.detail]);
      }
    });
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

function Comparison({ label, a, b, lowerIsBetter = true }: { label: string; a: number; b: number; lowerIsBetter?: boolean }) {
  const max = Math.max(a, b, 0.0001);
  return (
    <div>
      <div className="mb-1.5 text-xs text-muted-foreground">{label}</div>
      {[
        { name: "Without AgentGuard", v: a, cls: "bg-muted-foreground/45" },
        { name: "With AgentGuard", v: b, cls: lowerIsBetter ? (b <= a ? "bg-allow" : "bg-block") : b >= a ? "bg-allow" : "bg-block" },
      ].map((r) => (
        <div key={r.name} className="mb-1 flex items-center gap-2 text-xs">
          <span className="w-32 shrink-0 text-muted-foreground">{r.name}</span>
          <div className="h-3 flex-1 rounded-sm bg-muted/60">
            <div className={cn("h-3 rounded-r-[4px]", r.cls)} style={{ width: `${(r.v / max) * 100}%`, minWidth: r.v > 0 ? 3 : 0 }} />
          </div>
          <span className="w-12 text-right font-medium tabular">{pct(r.v)}</span>
        </div>
      ))}
    </div>
  );
}

export function AttackLab({
  scenarios,
  initial,
  history,
}: {
  scenarios: ScenarioMeta[];
  initial: Report | null;
  history: { id: string; createdAt: string; durationMs: number; metrics: Metrics; config: { planner: string; runs: number } }[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set(scenarios.map((s) => s.id)));
  const [runs, setRuns] = useState(1);
  const planner = "simulated" as const;
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<Report | null>(initial as Report | null);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "attack" | "legit" | "failed">("all");

  const results = useMemo(() => new Map((report?.scenarios ?? []).map((s) => [s.id, s])), [report]);
  const visible = scenarios.filter((s) => {
    if (filter === "attack") return s.attack;
    if (filter === "legit") return !s.attack;
    if (filter === "failed") return results.get(s.id) && !results.get(s.id)!.pass;
    return true;
  });

  async function run(ids?: string[]) {
    setRunning(true);
    try {
      const r = await fetch("/api/bench/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runs, planner, scenarioIds: ids ?? [...selected] }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Run failed");
      setReport(j);
      const failed = (j.scenarios as ScenarioResult[]).filter((x) => !x.pass).length;
      if (failed) toast.error(`${failed} scenario(s) failed`);
      else toast.success(`All ${j.scenarios.length} scenarios passed`, { description: `${j.durationMs} ms` });
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const m = report?.metrics;
  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-md border px-2 py-1" title="Real-LLM runs take minutes per scenario on CPU; run them with npm run bench:llm">
              Agent: simulated (deterministic)
            </span>
            <label className="flex items-center gap-1.5">Runs
              <select value={runs} onChange={(e) => setRuns(Number(e.target.value))} className="h-8 rounded-md border bg-background px-2">
                {[1, 2, 3, 5].map((n) => <option key={n}>{n}</option>)}
              </select>
            </label>
            <span className="text-muted-foreground">{selected.size}/{scenarios.length} scenarios selected</span>
            <button type="button" className="underline underline-offset-4" onClick={() => setSelected(new Set(scenarios.map((s) => s.id)))}>all</button>
            <button type="button" className="underline underline-offset-4" onClick={() => setSelected(new Set())}>none</button>
          </div>
          {report && (
            <div className="flex gap-2 lg:ml-auto">
              <Button size="sm" variant="outline" onClick={() => download(`agentguard-${report.id}.json`, JSON.stringify(report, null, 2), "application/json")}>
                <Download /> JSON
              </Button>
              <Button size="sm" variant="outline" onClick={() => download(`agentguard-${report.id}.csv`, toCsv(report), "text/csv")}>
                <Download /> CSV
              </Button>
            </div>
          )}
          <Button className={report ? "" : "lg:ml-auto"} onClick={() => run()} disabled={running || selected.size === 0}>
            {running ? <Loader2 className="animate-spin" /> : <Play />} Run simulation
          </Button>
        </div>
      </Panel>

      {m && report && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Scenarios passed" value={`${report.scenarios.filter((s) => s.pass).length}/${report.scenarios.length}`} tone={m.passRate === 1 ? "allow" : "block"} hint={`${report.config.runs} run(s) · ${report.durationMs} ms`} />
            <Stat label="Attack success with AgentGuard" value={pct(m.attackSuccessRate.guarded)} tone={m.attackSuccessRate.guarded === 0 ? "allow" : "block"} hint={`${pct(m.attackSuccessRate.baseline)} without · ${pct(m.attackSuccessRate.rubberStamp)} if reviewer approves all`} />
            <Stat label="False positive rate" value={pct(m.legitimateActions.falsePositiveRate)} hint={`${m.legitimateActions.blocked}/${m.legitimateActions.proposed} legit calls blocked · ${pct(m.legitimateActions.reviewRate)} sent to review`} />
            <Stat label="Approval replay prevention" value={`${m.approvalReplayPrevention.prevented}/${m.approvalReplayPrevention.total}`} tone={m.approvalReplayPrevention.rate === 1 ? "allow" : "block"} hint={`PDP p50 ${m.pdpMicrobenchUs.p50} µs · PEP p95 ${m.latencyMs.pepP95} ms`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Baseline vs AgentGuard" description={`Same ${report.config.planner === "claude" ? "LLM" : "simulated"} agent, same scenarios. Bars are computed from this run.`}>
              <div className="space-y-4">
                <Comparison label="Attack success rate (lower is better)" a={m.attackSuccessRate.baseline} b={m.attackSuccessRate.guarded} />
                <Comparison label="Legitimate task completion (higher is better)" a={m.taskCompletionRate.baseline} b={m.taskCompletionRate.guarded} lowerIsBetter={false} />
              </div>
            </Panel>
            <Panel title="Unauthorized actions proposed by the agent">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-xs text-muted-foreground">Proposed</dt><dd className="text-lg font-semibold tabular">{m.unauthorizedActions.proposed}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Blocked outright</dt><dd className="text-lg font-semibold text-block tabular">{m.unauthorizedActions.blocked} <span className="text-xs font-normal text-muted-foreground">({pct(m.unauthorizedActions.blockRate)})</span></dd></div>
                <div><dt className="text-xs text-muted-foreground">Paused for review</dt><dd className="text-lg font-semibold text-review tabular">{m.unauthorizedActions.reviewed}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Intercepted (block + review)</dt><dd className="text-lg font-semibold tabular">{pct(m.unauthorizedActions.interceptRate)}</dd></div>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                Expected-decision accuracy {pct(m.expectationAccuracy)} · deterministic across runs: {String(m.deterministic)}. Reviewed attacks only stay stopped if the human rejects them — see the rubber-stamp ASR.
              </p>
            </Panel>
          </div>
        </>
      )}

      <Panel
        title="Scenarios"
        bodyClassName="p-0"
        actions={
          <div className="flex rounded-md border p-0.5 text-xs">
            {(["all", "attack", "legit", "failed"] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} className={cn("rounded px-2 py-0.5 capitalize", filter === f && "bg-muted font-medium")}>{f}</button>
            ))}
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="w-8 py-2 pl-4" />
                <th className="py-2 pr-3 font-medium">Scenario</th>
                <th className="py-2 pr-3 font-medium">Category</th>
                <th className="py-2 pr-3 font-medium">Without guard</th>
                <th className="py-2 pr-3 font-medium">AgentGuard</th>
                <th className="py-2 pr-4 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {visible.map((s) => {
                const r = results.get(s.id);
                const first = r?.runs[0];
                const isOpen = open === s.id;
                const agentRun = first && "guarded" in first ? (first as AgentRun) : null;
                const apRun = first && "prevented" in first ? (first as ApprovalRun) : null;
                return (
                  <Fragment key={s.id}>
                    <tr className="align-top hover:bg-muted/30">
                      <td className="py-2.5 pl-4">
                        <input
                          type="checkbox"
                          aria-label={`Select ${s.id}`}
                          checked={selected.has(s.id)}
                          onChange={() => setSelected((cur) => { const n = new Set(cur); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })}
                        />
                      </td>
                      <td className="py-2.5 pr-3">
                        <button type="button" className="flex items-start gap-1.5 text-left" onClick={() => setOpen(isOpen ? null : s.id)}>
                          <ChevronDown className={cn("mt-0.5 size-3.5 shrink-0 transition-transform", isOpen && "rotate-180")} />
                          <span>
                            <span className="font-mono text-xs text-muted-foreground">{s.id}</span> {s.title}
                          </span>
                        </button>
                      </td>
                      <td className="py-2.5 pr-3"><Pill tone={s.attack ? "block" : "allow"}>{CATEGORY_LABEL[s.category] ?? s.category}</Pill></td>
                      <td className="py-2.5 pr-3 text-xs">
                        {agentRun ? (s.attack ? (agentRun.baseline.attackSucceeded ? <span className="text-block">attack succeeded</span> : <span className="text-muted-foreground">attack failed</span>) : agentRun.baseline.completed ? "task done" : "task incomplete") : apRun ? <span className="text-muted-foreground">no approval layer</span> : "—"}
                      </td>
                      <td className="py-2.5 pr-3">
                        {agentRun ? (
                          <div className="flex flex-wrap gap-1">{agentRun.guarded.proposals.map((p, i) => <DecisionBadge key={i} decision={p.decision} />)}</div>
                        ) : apRun ? <span className="font-mono text-xs">{apRun.detail}</span> : <span className="text-xs text-muted-foreground">not run</span>}
                      </td>
                      <td className="py-2.5 pr-4">
                        {r ? (r.pass ? <span className="inline-flex items-center gap-1 text-xs font-medium text-allow"><CheckCircle2 className="size-4" /> Pass</span> : <span className="inline-flex items-center gap-1 text-xs font-medium text-block"><XCircle className="size-4" /> Fail</span>) : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-muted/20">
                        <td />
                        <td colSpan={5} className="py-3 pr-4">
                          <p className="text-xs text-muted-foreground">{s.description}</p>
                          {s.prompt && <p className="mt-1 text-xs">Prompt: <span className="font-mono">{s.prompt}</span></p>}
                          {agentRun ? (
                            <div className="mt-2 grid gap-3 md:grid-cols-2">
                              <div>
                                <div className="mb-1 text-xs font-medium text-muted-foreground">Expected vs actual</div>
                                <ul className="space-y-1 text-xs">
                                  {agentRun.expectations.map((e, i) => (
                                    <li key={i} className="flex flex-wrap items-center gap-1.5">
                                      {e.pass ? <CheckCircle2 className="size-3.5 text-allow" /> : <XCircle className="size-3.5 text-block" />}
                                      <span className="font-mono">{e.matcher.tool} {e.matcher.destination ?? e.matcher.resource}</span>
                                      expected <DecisionBadge decision={e.expected} /> got {e.actual === "NOT_PROPOSED" ? <Pill>not proposed</Pill> : <DecisionBadge decision={e.actual} />}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                              <div>
                                <div className="mb-1 text-xs font-medium text-muted-foreground">Agent proposals under AgentGuard</div>
                                <ul className="space-y-1 text-xs">
                                  {agentRun.guarded.proposals.map((p, i) => (
                                    <li key={i} className="flex flex-wrap items-center gap-1.5">
                                      <DecisionBadge decision={p.decision} />
                                      <span className="font-mono">{p.tool} {p.destination ?? p.resources.join(",")}</span>
                                      {p.unauthorized && <Pill tone="block">unauthorized</Pill>}
                                      {p.injected && <Pill tone="review">injected</Pill>}
                                      {p.executed && <Pill tone="allow">executed</Pill>}
                                      <span className="text-muted-foreground">{p.reasonCodes.filter((c) => c !== "RULE_MATCHED").join(", ")}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          ) : (
                            <ul className="mt-2 text-xs">{s.expected.map((e) => <li key={e}>Expected: {e}</li>)}{apRun && <li>Side effects observed: {apRun.sideEffects}</li>}</ul>
                          )}
                          <Button size="xs" variant="outline" className="mt-3" disabled={running} onClick={() => run([s.id])}>Run only this</Button>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {history.length > 0 && (
        <Panel title="Benchmark history" bodyClassName="p-0">
          <ul className="divide-y text-xs">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                <span className="font-mono">{h.id}</span>
                <Pill>{h.config.planner}</Pill>
                <span>ASR {pct(h.metrics.attackSuccessRate.baseline)} → {pct(h.metrics.attackSuccessRate.guarded)}</span>
                <span>FPR {pct(h.metrics.legitimateActions.falsePositiveRate)}</span>
                <span>pass {pct(h.metrics.passRate)}</span>
                <span className="ml-auto text-muted-foreground">{timeAgo(h.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
