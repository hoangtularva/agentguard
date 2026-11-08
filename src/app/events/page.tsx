import { Activity } from "lucide-react";
import Link from "next/link";
import { DecisionBadge, EmptyState, JsonBlock, PageHeader, Panel, Pill, timeAgo } from "@/components/primitives";
import { cn } from "@/lib/utils";
import { getCurrentUser } from "@/server/app-context";
import { listEvents, toolCallsByIds } from "@/server/queries";

export const metadata = { title: "Security Events" };

const FILTERS = {
  decision: ["ALLOW", "REVIEW", "BLOCK"],
  severity: ["info", "warning", "critical"],
  type: ["tool_call", "approval", "policy", "session", "benchmark"],
};

type Search = { decision?: string; severity?: string; type?: string; session?: string; open?: string };

function href(cur: Search, patch: Partial<Search>) {
  const next = { ...cur, ...patch };
  const q = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]);
  return `/events${q.size ? `?${q}` : ""}`;
}

export default async function EventsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const clean: Search = {
    decision: FILTERS.decision.includes(sp.decision ?? "") ? sp.decision : undefined,
    severity: FILTERS.severity.includes(sp.severity ?? "") ? sp.severity : undefined,
    type: FILTERS.type.includes(sp.type ?? "") ? sp.type : undefined,
    session: sp.session && /^ses_[a-z0-9]+$/i.test(sp.session) ? sp.session : undefined,
    open: sp.open && /^evt_[a-z0-9-]+$/i.test(sp.open) ? sp.open : undefined,
  };
  const user = await getCurrentUser();
  if (!user) return null;
  const events = await listEvents(user, clean);
  const calls = await toolCallsByIds(user, [...new Set(events.map((e) => e.toolCallId).filter((x): x is string => !!x))]);
  const callMap = new Map(calls.map((c) => [c.id, c]));

  return (
    <>
      <PageHeader title="Security Events" description="Append-only audit trail. Payloads are redacted: content arguments are stored as length + hash, secrets are masked." />
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        {(Object.keys(FILTERS) as (keyof typeof FILTERS)[]).map((k) => (
          <div key={k} className="flex items-center gap-1">
            <span className="mr-1 capitalize text-muted-foreground">{k}</span>
            <Link href={href(clean, { [k]: undefined, open: undefined })} className={cn("rounded-md border px-2 py-0.5", !clean[k] && "border-foreground/30 bg-muted")}>all</Link>
            {FILTERS[k].map((v) => (
              <Link key={v} href={href(clean, { [k]: v, open: undefined })} className={cn("rounded-md border px-2 py-0.5", clean[k] === v && "border-foreground/30 bg-muted")}>
                {v}
              </Link>
            ))}
          </div>
        ))}
        {clean.session && (
          <Link href={href(clean, { session: undefined })} className="rounded-md border border-brand/40 bg-brand/10 px-2 py-0.5 text-brand">session {clean.session.slice(0, 10)}… ✕</Link>
        )}
      </div>

      <Panel bodyClassName="p-0">
        {events.length === 0 ? (
          <EmptyState icon={Activity} title="No events match">Run something in the Playground or clear the filters.</EmptyState>
        ) : (
          <ol className="divide-y">
            {events.map((e) => {
              const isOpen = clean.open === e.id;
              const call = e.toolCallId ? callMap.get(e.toolCallId) : undefined;
              const prov = call?.provenance as { destination?: { value: string; origin: { origin: string; evidence: { sourceId: string; sourceType: string }[] }[] }; sourcesInContext: { id: string; label: string; trust: string; type: string }[] } | undefined;
              return (
                <li key={e.id}>
                  <Link href={href(clean, { open: isOpen ? undefined : e.id })} scroll={false} className="flex flex-wrap items-center gap-2 px-4 py-2.5 hover:bg-muted/40">
                    <span className={cn("size-2 rounded-full", e.severity === "critical" ? "bg-block" : e.severity === "warning" ? "bg-review" : "bg-muted-foreground/40")} aria-label={e.severity} />
                    <span className="font-mono text-xs">{e.type}</span>
                    {e.decision && <DecisionBadge decision={e.decision} />}
                    {(e.reasonCodes as string[]).filter((r) => r !== "RULE_MATCHED").slice(0, 2).map((r) => <Pill key={r}>{r}</Pill>)}
                    <span className="ml-auto text-xs text-muted-foreground tabular">{timeAgo(e.createdAt)}</span>
                  </Link>
                  {isOpen && (
                    <div className="grid gap-3 border-t bg-muted/20 px-4 py-3 md:grid-cols-2">
                      <div>
                        <div className="mb-1 text-xs font-medium text-muted-foreground">Event payload (redacted)</div>
                        <JsonBlock value={{ id: e.id, actor: e.actorId, session: e.sessionId, toolCall: e.toolCallId, ...(e.payload as object) }} />
                      </div>
                      <div className="space-y-3 text-[13px]">
                        {call && (
                          <div>
                            <div className="mb-1 text-xs font-medium text-muted-foreground">Decision explanation · policy v{call.policyVersion}</div>
                            <ul className="space-y-1">
                              {(call.reasons as { code: string; message: string; ruleId?: string }[]).map((r, i) => (
                                <li key={i}><span className="font-mono text-[11px] text-muted-foreground">{r.ruleId ?? r.code}</span> — {r.message}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {prov && (
                          <div>
                            <div className="mb-1 text-xs font-medium text-muted-foreground">Source evidence</div>
                            {prov.destination && (
                              <p className="mb-1">
                                Destination <Pill>{prov.destination.value}</Pill> found in:{" "}
                                {prov.destination.origin.flatMap((o) => (o.evidence.length ? o.evidence.map((ev) => `${ev.sourceType} ${ev.sourceId.slice(0, 12)} (${o.origin})`) : [`${o.origin} (no source)`])).join(", ")}
                              </p>
                            )}
                            <ul className="space-y-0.5 text-xs text-muted-foreground">
                              {prov.sourcesInContext.map((s) => (
                                <li key={s.id}>
                                  <span className="font-mono">{s.id.slice(0, 14)}</span> · {s.type} · {s.label} · <span className={s.trust === "untrusted_external" ? "text-block" : "text-allow"}>{s.trust}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {e.sessionId && (
                          <Link href={`/sessions/${e.sessionId}`} className="inline-block text-xs underline underline-offset-4">Open session audit record</Link>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    </>
  );
}
