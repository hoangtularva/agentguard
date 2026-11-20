"use client";

import { Loader2, ShieldCheck, ShieldX } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type Verdict = { ok: boolean; length: number; head?: string; brokenAt?: number; reason?: string; unsealed: number };

/** Recompute the audit hash chain on demand (approver/admin). */
export function AuditChainCheck() {
  const [v, setV] = useState<Verdict | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {v &&
        (v.ok ? (
          <span className="inline-flex items-center gap-1 text-allow" role="status">
            <ShieldCheck className="size-3.5" /> Chain intact: {v.length} events, head {v.head?.slice(0, 12)}…
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-block" role="alert">
            <ShieldX className="size-3.5" /> Broken at #{v.brokenAt}: {v.reason}
          </span>
        ))}
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await fetch("/api/audit/verify", { method: "POST" });
            setV(await r.json());
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Verify audit chain
      </Button>
    </div>
  );
}
