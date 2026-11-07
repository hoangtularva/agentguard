import { Ban, CircleCheck, Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";

export type DecisionValue = "ALLOW" | "REVIEW" | "BLOCK";

const DECISION_STYLE: Record<DecisionValue, { cls: string; icon: typeof Ban; label: string }> = {
  ALLOW: { cls: "bg-allow/12 text-allow ring-allow/25", icon: CircleCheck, label: "Allow" },
  REVIEW: { cls: "bg-review/12 text-review ring-review/30", icon: Clock3, label: "Review" },
  BLOCK: { cls: "bg-block/12 text-block ring-block/25", icon: Ban, label: "Block" },
};

export function DecisionBadge({ decision, className }: { decision: string; className?: string }) {
  const d = DECISION_STYLE[(decision as DecisionValue) in DECISION_STYLE ? (decision as DecisionValue) : "BLOCK"];
  const Icon = d.icon;
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset", d.cls, className)}>
      <Icon className="size-3" />
      {d.label}
    </span>
  );
}

export function Pill({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: "neutral" | "allow" | "review" | "block" | "brand"; className?: string }) {
  const tones = {
    neutral: "bg-muted text-muted-foreground",
    allow: "bg-allow/12 text-allow",
    review: "bg-review/12 text-review",
    block: "bg-block/12 text-block",
    brand: "bg-brand/12 text-brand",
  };
  return <span className={cn("inline-flex h-5 items-center rounded px-1.5 font-mono text-[11px]", tones[tone], className)}>{children}</span>;
}

export function PageHeader({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Panel({ title, description, actions, children, className, bodyClassName }: { title?: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn("rounded-xl border bg-card", className)}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-medium">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "allow" | "review" | "block" | "brand" }) {
  const toneCls = tone ? { allow: "text-allow", review: "text-review", block: "text-block", brand: "text-brand" }[tone] : "";
  return (
    <div className="rounded-xl border bg-card px-4 py-3.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tracking-tight tabular", toneCls)}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon: typeof Ban; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <div className="text-sm font-medium">{title}</div>
      {children && <div className="max-w-sm text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function JsonBlock({ value, className }: { value: unknown; className?: string }) {
  return (
    <pre className={cn("max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg border bg-muted/40 p-3 font-mono text-[11.5px] leading-relaxed", className)}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function timeAgo(d: Date | string): string {
  const t = typeof d === "string" ? new Date(d) : d;
  const s = Math.round((Date.now() - t.getTime()) / 1000);
  if (s < 60) return `${Math.max(0, s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return t.toISOString().slice(0, 10);
}

export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
