import Link from "next/link";
import { notFound } from "next/navigation";
import { DecisionBadge, JsonBlock, PageHeader, Panel, Pill, timeAgo } from "@/components/primitives";
import { getCurrentUser } from "@/server/app-context";
import { sessionDetail } from "@/server/queries";

export const metadata = { title: "Session audit record" };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^ses_[a-z0-9]+$/i.test(id)) notFound();
  const user = await getCurrentUser();
  if (!user) return null;
  const data = await sessionDetail(user, id);
  if (!data) notFound();
  const { session, calls, sources, effects } = data;
  const mandate = session.mandate as { allowedTools: string[]; resourceScope: string[]; destinations: string[] };
  return (
    <>
      <PageHeader title="Session audit record" description={`${session.id} · ${session.planner} · ${timeAgo(session.createdAt)}`}>
        <Link href={`/events?session=${session.id}`} className="text-xs underline underline-offset-4">Events for this session</Link>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Intent" className="lg:col-span-2">
          <p className="text-sm">“{session.userPrompt}”</p>
          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
            <Pill tone="brand">status: {session.status}</Pill>
            {mandate.allowedTools.map((t) => <Pill key={t}>{t}</Pill>)}
            {mandate.resourceScope.map((t) => <Pill key={t}>{t}</Pill>)}
            {mandate.destinations.map((t) => <Pill key={t} tone="allow">{t}</Pill>)}
          </div>
          {session.finalMessage && <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">{session.finalMessage}</p>}
        </Panel>
        <Panel title="Provenance sources" description="Content is not stored, only its hash.">
          <ul className="space-y-1.5 text-xs">
            {sources.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-1.5">
                <Pill tone={s.trust === "untrusted_external" ? "block" : "allow"}>{s.trust}</Pill>
                <span>{s.label}</span>
                <span className="font-mono text-muted-foreground">#{s.contentHash.slice(0, 8)}</span>
                {(s.signals as string[]).length > 0 && <Pill tone="review">{(s.signals as string[]).length} signal(s)</Pill>}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel title={`Tool calls (${calls.length})`} className="mt-4" bodyClassName="p-0">
        <ol className="divide-y">
          {calls.map((c) => (
            <li key={c.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <DecisionBadge decision={c.decision} />
                  <span className="font-mono text-[13px]">{c.tool}</span>
                  <Pill>{c.status}</Pill>
                  <Pill>v{c.policyVersion}</Pill>
                  <span className="text-xs text-muted-foreground tabular">{c.evalLatencyMs.toFixed(2)} ms</span>
                </div>
                <ul className="mt-2 space-y-0.5 text-[13px]">
                  {(c.reasons as { code: string; message: string; ruleId?: string }[]).map((r, i) => (
                    <li key={i}><span className="font-mono text-[11px] text-muted-foreground">{r.ruleId ?? r.code}</span> — {r.message}</li>
                  ))}
                </ul>
              </div>
              <JsonBlock value={{ args: c.argsRedacted, argsHash: c.argsHash.slice(0, 16) }} className="max-h-40" />
            </li>
          ))}
        </ol>
      </Panel>
      <Panel title={`Sandbox side effects (${effects.length})`} description="What the mock tools actually did. Nothing left the sandbox." className="mt-4">
        {effects.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : <JsonBlock value={effects.map((e) => ({ tool: e.tool, destination: e.destination, summary: e.summary }))} />}
      </Panel>
    </>
  );
}
