import { cn } from "@/lib/utils";

type Row = { day: string; decision: string; n: number };
const SERIES = [
  { key: "ALLOW", label: "Allowed", cls: "bg-allow" },
  { key: "REVIEW", label: "Review", cls: "bg-review" },
  { key: "BLOCK", label: "Blocked", cls: "bg-block" },
] as const;

/** 14-day stacked bars of real decisions. Status colors + legend + per-bar tooltip + table view. */
export function DecisionChart({ rows, since }: { rows: Row[]; since: string }) {
  const days: string[] = [];
  const start = new Date(since);
  for (let i = 0; i < 14; i++) {
    const d = new Date(start.getTime() + i * 86400_000);
    days.push(d.toISOString().slice(0, 10));
  }
  const by = new Map<string, Record<string, number>>();
  for (const r of rows) by.set(r.day, { ...(by.get(r.day) ?? {}), [r.decision]: r.n });
  const totals = days.map((d) => SERIES.reduce((a, s) => a + (by.get(d)?.[s.key] ?? 0), 0));
  const max = Math.max(1, ...totals);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground" aria-hidden>
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-sm", s.cls)} /> {s.label}
          </span>
        ))}
      </div>
      <div className="relative flex h-40 items-end gap-1.5 border-b border-border/70 sm:gap-2" role="img" aria-label="Tool-call decisions per day, last 14 days">
        {days.map((d, i) => {
          const v = by.get(d) ?? {};
          return (
            <div key={d} className="group relative flex h-full flex-1 flex-col justify-end">
              <div className="flex flex-col-reverse gap-[2px]" style={{ height: `${(totals[i] / max) * 100}%` }}>
                {SERIES.map((s, si) => {
                  const n = v[s.key] ?? 0;
                  if (!n) return null;
                  const isTop = SERIES.slice(si + 1).every((x) => !(v[x.key] ?? 0));
                  return <div key={s.key} className={cn(s.cls, isTop && "rounded-t-[4px]")} style={{ flexGrow: n, minHeight: 2 }} />;
                })}
              </div>
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1.5 text-[11px] shadow-md group-hover:block">
                <div className="font-medium text-foreground">{d}</div>
                {SERIES.map((s) => (
                  <div key={s.key} className="flex items-center gap-1.5 text-muted-foreground">
                    <span className={cn("size-2 rounded-sm", s.cls)} /> {s.label}: <span className="text-foreground tabular">{v[s.key] ?? 0}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground tabular">
        <span>{days[0].slice(5)}</span>
        <span>{days[13].slice(5)}</span>
      </div>
      <table className="sr-only">
        <caption>Decisions per day</caption>
        <thead>
          <tr><th>Day</th>{SERIES.map((s) => <th key={s.key}>{s.label}</th>)}</tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d}><td>{d}</td>{SERIES.map((s) => <td key={s.key}>{by.get(d)?.[s.key] ?? 0}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
