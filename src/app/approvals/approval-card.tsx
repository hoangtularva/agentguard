"use client";

import { Clock3, Loader2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { JsonBlock, Pill } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ApprovalView {
  id: string;
  status: string;
  tool: string;
  args: Record<string, unknown>;
  argsAreExact: boolean;
  reasons: { code: string; message: string; ruleId?: string; effect?: string }[];
  riskScore: number;
  provenance: { dataSensitivity: string; destination?: { value: string; inMandate: boolean; origin: { origin: string }[] }; signals: string[] };
  prompt: string;
  requestedFor: string;
  policyVersion: number;
  bindingHash: string;
  expiresAt: string;
  createdAt: string;
  decidedBy: string | null;
  canDecide: boolean;
}

const STATUS_TONE: Record<string, "review" | "allow" | "block" | "neutral" | "brand"> = {
  pending: "review",
  approved: "brand",
  executed: "allow",
  rejected: "block",
  expired: "neutral",
  invalidated: "block",
};

function Countdown({ to }: { to: string }) {
  // null on the server and the first client render, so SSR and hydration produce the same text.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  if (now === null) return <span className="tabular">expires {new Date(to).toISOString().slice(11, 16)} UTC</span>;
  const s = Math.max(0, Math.round((new Date(to).getTime() - now) / 1000));
  return <span className="tabular">{s === 0 ? "expired" : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s left`}</span>;
}

export function ApprovalCard({ v }: { v: ApprovalView }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const open = v.status === "pending" || v.status === "approved";

  async function call(path: string, body: unknown) {
    const r = await fetch(`/api/approvals/${v.id}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.code ? `${j.code}: ${j.message}` : j.error);
    return j;
  }
  async function act(kind: "approve" | "reject" | "execute") {
    setBusy(kind);
    try {
      if (kind !== "execute" && v.status === "pending") await call("decide", { decision: kind });
      if (kind !== "reject") {
        const j = await call("execute", { idempotencyKey: crypto.randomUUID() });
        toast.success("Executed exactly once", { description: j.output });
      } else toast("Rejected");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const reasons = v.reasons.filter((r) => r.effect === "REVIEW" || r.effect === "BLOCK" || r.code !== "RULE_MATCHED");
  return (
    <article className={cn("rounded-xl border p-4", open ? "bg-card" : "bg-muted/20")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-medium">{v.tool}</span>
        <Pill tone={STATUS_TONE[v.status] ?? "neutral"}>{v.status}</Pill>
        <Pill>risk {v.riskScore}</Pill>
        <Pill>policy v{v.policyVersion}</Pill>
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Clock3 className="size-3.5" /> {open ? <Countdown to={v.expiresAt} /> : new Date(v.createdAt).toLocaleString()}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        User request: <span className="text-foreground">“{v.prompt}”</span>
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">{v.argsAreExact ? "Exact arguments you are approving" : "Arguments (redacted audit copy)"}</div>
          <JsonBlock value={v.args} className="max-h-44" />
        </div>
        <div className="space-y-2 text-[13px]">
          <div className="text-xs font-medium text-muted-foreground">Why it needs review</div>
          <ul className="space-y-1.5">
            {reasons.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", r.effect === "BLOCK" ? "bg-block" : "bg-review")} />
                <span>{r.message}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Pill tone={["confidential", "restricted"].includes(v.provenance.dataSensitivity) ? "block" : "neutral"}>data: {v.provenance.dataSensitivity}</Pill>
            {v.provenance.destination?.origin.map((o) => (
              <Pill key={o.origin} tone={o.origin === "trusted_user" ? "allow" : "block"}>dest from {o.origin.replace("_", " ")}</Pill>
            ))}
            {v.provenance.signals.map((s) => (
              <Pill key={s} tone="review">{s}</Pill>
            ))}
          </div>
          <div className="flex items-center gap-1 pt-1 font-mono text-[11px] text-muted-foreground" title="sha256 binding over call id, session, user, agent, tool, args, policy version">
            <ShieldCheck className="size-3.5" /> binding {v.bindingHash.slice(0, 16)}…
          </div>
        </div>
      </div>
      {open && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t pt-3">
          {!v.canDecide && <span className="mr-auto text-xs text-muted-foreground">Only the requesting user or an approver can decide.</span>}
          {v.status === "pending" && (
            <>
              <Button variant="outline" size="sm" disabled={!!busy} onClick={() => act("reject")}>
                {busy === "reject" && <Loader2 className="animate-spin" />} Reject
              </Button>
              <Button size="sm" disabled={!!busy} onClick={() => act("approve")}>
                {busy === "approve" && <Loader2 className="animate-spin" />} Approve &amp; execute
              </Button>
            </>
          )}
          {v.status === "approved" && (
            <Button size="sm" disabled={!!busy} onClick={() => act("execute")}>
              {busy === "execute" && <Loader2 className="animate-spin" />} Execute approved action
            </Button>
          )}
        </div>
      )}
    </article>
  );
}
