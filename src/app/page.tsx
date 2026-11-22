import { ArrowRight, Bot, FlaskConical, ShieldHalf } from "lucide-react";
import Link from "next/link";
import { DecisionChart } from "@/components/decision-chart";
import { DecisionBadge, EmptyState, PageHeader, Panel, Pill, Stat, pct, timeAgo } from "@/components/primitives";
import { buttonVariants } from "@/components/ui/button";
import type { BenchMetrics } from "@/server/bench/harness";
import { getCurrentUser } from "@/server/app-context";
import { latestBenchmark, overviewStats, recentToolCalls } from "@/server/queries";

export const metadata = { title: "Overview" };

const REASON_LABEL: Record<string, string> = {
  UNTRUSTED_DESTINATION: "Destination from untrusted content",
  RESOURCE_OUT_OF_SCOPE: "Resource outside task scope",
  NO_MATCHING_POLICY: "Default deny (no policy)",
  TOOL_NOT_IN_MANDATE: "Tool not authorized by user",
  RESOURCE_NOT_FOUND: "Unknown resource",
  INVALID_ARGUMENTS: "Invalid arguments",
  IDENTITY_UNVERIFIED: "Identity not verified",
  UNKNOWN_TOOL: "Unknown tool",
};

export default async function OverviewPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const [stats, recent, bench] = await Promise.all([overviewStats(user), recentToolCalls(user, 10), latestBenchmark()]);
  const m = bench?.metrics as BenchMetrics | undefined;
  return (
    <>
      <PageHeader title="Overview" description="Every agent tool call is evaluated before execution. Numbers below come from this workspace's audit log.">
        <Link href="/playground" className={buttonVariants({ variant: "default" })}>
          <Bot /> Open Playground
        </Link>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Total actions" value={stats.total} hint={`${stats.sessions} agent sessions`} />
        <Stat label="Allowed" value={stats.allowed} tone="allow" hint={stats.total ? pct(stats.allowed / stats.total) : "—"} />
        <Stat label="Blocked" value={stats.blocked} tone="block" hint={stats.total ? pct(stats.blocked / stats.total) : "—"} />
        <Stat label="Pending approval" value={stats.pending} tone="review" hint={`${stats.reviewed} sent to review total`} />
        <Stat label="Security events" value={stats.securityEvents} hint="warning + critical audit events" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Decisions, last 14 days" className="lg:col-span-2">
          {stats.total === 0 ? (
            <EmptyState icon={ShieldHalf} title="No tool calls yet">Run a task in the Agent Playground to see decisions here.</EmptyState>
          ) : (
            <DecisionChart rows={stats.daily} since={stats.since} />
          )}
        </Panel>
        <Panel title="Why actions were stopped" description="Reason codes on BLOCK / REVIEW decisions">
          {stats.topReasons.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing stopped yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {stats.topReasons.map((r) => (
                <li key={r.code} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate">{REASON_LABEL[r.code] ?? r.code}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{r.code}</span>
                  </span>
                  <span className="font-medium tabular">{r.n}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel
          title="Recent activity"
          className="lg:col-span-2"
          bodyClassName="p-0"
          actions={<Link href="/events" className="text-xs text-muted-foreground hover:text-foreground">All events →</Link>}
        >
          {recent.length === 0 ? (
            <EmptyState icon={Bot} title="No activity">Agent tool calls will appear here.</EmptyState>
          ) : (
            <ul className="divide-y">
              {recent.map((c) => {
                const reasons = (c.reasons as { code: string }[]).map((r) => r.code).filter((x) => x !== "RULE_MATCHED");
                return (
                  <li key={c.id}>
                    <Link href={`/sessions/${c.sessionId}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50">
                      <DecisionBadge decision={c.decision} />
                      <span className="font-mono text-xs">{c.tool}</span>
                      <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block">{reasons[0] ?? c.status}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular">{timeAgo(c.createdAt)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel
          title="Latest security benchmark"
          actions={<Link href="/attack-lab" className="text-xs text-muted-foreground hover:text-foreground">Attack Lab →</Link>}
        >
          {!m ? (
            <EmptyState icon={FlaskConical} title="Not run yet">
              <Link href="/attack-lab" className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline">
                Run the attack suite <ArrowRight className="size-3.5" />
              </Link>
            </EmptyState>
          ) : (
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Attack success, no guard</dt><dd className="font-medium tabular">{pct(m.attackSuccessRate.baseline)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Attack success, Callwrit</dt><dd className="font-medium text-allow tabular">{pct(m.attackSuccessRate.guarded)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">False positive rate</dt><dd className="font-medium tabular">{pct(m.legitimateActions.falsePositiveRate)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Approval replay prevention</dt><dd className="font-medium tabular">{m.approvalReplayPrevention.prevented}/{m.approvalReplayPrevention.total}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Scenarios</dt><dd><Pill>{m.scenarios}</Pill></dd></div>
              <p className="pt-1 text-xs text-muted-foreground">Run {timeAgo(bench!.createdAt)} · simulated planner unless noted. See limitations in the Attack Lab.</p>
            </dl>
          )}
        </Panel>
      </div>
    </>
  );
}
