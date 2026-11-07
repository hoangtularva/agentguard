"use client";

import { FlaskConical, History, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DecisionBadge, Panel, Pill } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type Condition, type PolicyDocument, PolicyDocumentSchema, type Rule } from "@/server/core/policy-schema";

type Version = { version: number; document: unknown; changeNote: string; createdBy: string; createdAt: string; hash: string };

function describeCondition(c: Condition): string {
  switch (c.type) {
    case "resource_matches": return `resource ∈ ${c.patterns.join(", ")}`;
    case "resource_not_matches": return `resource ∉ ${c.patterns.join(", ")}`;
    case "destination_matches": return `destination ∈ ${c.patterns.join(", ")}`;
    case "destination_not_matches": return `destination ∉ ${c.patterns.join(", ")}`;
    case "destination_in_mandate": return `destination ${c.value ? "" : "not "}authorized by user`;
    case "destination_origin_includes": return `destination from ${c.origins.join(" | ")}`;
    case "sensitivity_at_least": return `data ≥ ${c.level}`;
    case "sensitivity_at_most": return `data ≤ ${c.level}`;
    case "tool_risk_at_least": return `tool risk ≥ ${c.level}`;
    case "untrusted_context": return `untrusted content in context = ${c.value}`;
    case "signal_present": return `signal ${c.signal}`;
    case "user_role_in": return `role ∈ ${c.roles.join(", ")}`;
  }
}

const EFFECT_TONE = { allow: "ALLOW", review: "REVIEW", block: "BLOCK" } as const;

function RuleTable({ rules }: { rules: Rule[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-[13px]">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="py-2 pr-3 font-medium">Rule</th>
            <th className="py-2 pr-3 font-medium">Tools</th>
            <th className="py-2 pr-3 font-medium">When (all hold)</th>
            <th className="py-2 font-medium">Effect</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rules.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="py-2.5 pr-3">
                <div className="font-mono text-xs">{r.id}</div>
                <div className="text-xs text-muted-foreground">{r.description}</div>
              </td>
              <td className="py-2.5 pr-3">
                <div className="flex flex-wrap gap-1">{r.tools.map((t) => <Pill key={t}>{t}</Pill>)}</div>
              </td>
              <td className="py-2.5 pr-3 text-xs">
                {r.conditions.length === 0 ? <span className="text-muted-foreground">always</span> : (
                  <ul className="space-y-0.5">{r.conditions.map((c, i) => <li key={i}>{describeCondition(c)}</li>)}</ul>
                )}
              </td>
              <td className="py-2.5">
                <div className="flex flex-col items-start gap-1">
                  <DecisionBadge decision={EFFECT_TONE[r.effect]} />
                  {r.escalateOnly && <span className="text-[11px] text-muted-foreground">escalate-only</span>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-muted-foreground">
        Evaluation: built-in invariants (mandate, scope, identity, untrusted destination ⇒ ≥ REVIEW) → matching rules, BLOCK &gt; REVIEW &gt; ALLOW → <b>default deny</b> if no permitting rule matches.
      </p>
    </div>
  );
}

const TEMPLATE_RULE: Rule = {
  id: "new-rule",
  description: "Describe what this rule permits or forbids",
  tools: ["send_email"],
  conditions: [{ type: "destination_matches", patterns: ["*@acme.example"] }],
  effect: "review",
  escalateOnly: false,
};

type SimInput = {
  tool: string;
  resource: string;
  resourceSensitivity: string;
  destination: string;
  destinationOrigin: string;
  destinationInMandate: boolean;
  dataSensitivity: string;
  untrustedContext: boolean;
  injectionSignal: boolean;
  toolInMandate: boolean;
  resourceInScope: boolean;
};

function Simulator({ doc }: { doc: PolicyDocument | null }) {
  const [inp, setInp] = useState<SimInput>({
    tool: "send_email",
    resource: "",
    resourceSensitivity: "internal",
    destination: "partner@contoso.example",
    destinationOrigin: "trusted_user",
    destinationInMandate: true,
    dataSensitivity: "internal",
    untrustedContext: false,
    injectionSignal: false,
    toolInMandate: true,
    resourceInScope: true,
  });
  const [res, setRes] = useState<null | { decision: string; reasons: { code: string; message: string; ruleId?: string }[]; riskScore: number }>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof SimInput>(k: K, v: SimInput[K]) => setInp((p) => ({ ...p, [k]: v }));
  const field = "h-8 w-full rounded-md border bg-background px-2 text-xs";
  async function run() {
    if (!doc) return;
    setBusy(true);
    const r = await fetch("/api/policies/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: doc, input: { ...inp, resource: inp.resource || undefined, destination: inp.destination || undefined } }),
    });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return toast.error(j.error ?? "Simulation failed");
    setRes(j);
  }
  const sens = ["public", "internal", "confidential", "restricted"];
  return (
    <Panel title="Policy test simulator" description="Evaluate the draft against a hypothetical call. No side effects.">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="space-y-1">Tool
          <select className={field} value={inp.tool} onChange={(e) => set("tool", e.target.value)}>
            {["read_documents", "send_email", "export_data", "delete_records"].map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="space-y-1">Data sensitivity
          <select className={field} value={inp.dataSensitivity} onChange={(e) => { set("dataSensitivity", e.target.value); set("resourceSensitivity", e.target.value); }}>
            {sens.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="col-span-2 space-y-1">Destination
          <input className={field} value={inp.destination} onChange={(e) => set("destination", e.target.value)} />
        </label>
        <label className="space-y-1">Destination came from
          <select className={field} value={inp.destinationOrigin} onChange={(e) => set("destinationOrigin", e.target.value)}>
            <option value="trusted_user">user prompt</option>
            <option value="untrusted_external">retrieved content</option>
            <option value="model_generated">model-generated</option>
          </select>
        </label>
        <label className="space-y-1">Resource id
          <input className={field} placeholder="ds:sales_q3" value={inp.resource} onChange={(e) => set("resource", e.target.value)} />
        </label>
        {([
          ["destinationInMandate", "Destination in mandate"],
          ["toolInMandate", "Tool in mandate"],
          ["resourceInScope", "Resource in scope"],
          ["untrustedContext", "Untrusted content read"],
          ["injectionSignal", "Injection signal"],
        ] as const).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2">
            <input type="checkbox" checked={inp[k]} onChange={(e) => set(k, e.target.checked)} /> {label}
          </label>
        ))}
      </div>
      <Button className="mt-3 w-full" variant="outline" onClick={run} disabled={busy || !doc}>
        {busy ? <Loader2 className="animate-spin" /> : <FlaskConical />} Evaluate draft
      </Button>
      {res && (
        <div className="mt-3 rounded-lg border p-3">
          <div className="flex items-center gap-2"><DecisionBadge decision={res.decision} /><span className="text-xs text-muted-foreground">risk {res.riskScore}</span></div>
          <ul className="mt-2 space-y-1 text-xs">
            {res.reasons.map((r, i) => <li key={i}><span className="font-mono text-muted-foreground">{r.ruleId ?? r.code}</span> — {r.message}</li>)}
          </ul>
        </div>
      )}
    </Panel>
  );
}

export function PolicyStudio({ versions, activeVersion, canEdit }: { versions: Version[]; activeVersion: number | null; canEdit: boolean }) {
  const router = useRouter();
  const active = versions.find((v) => v.version === activeVersion) ?? versions[0];
  const [selected, setSelected] = useState<number>(active?.version ?? 1);
  const sel = versions.find((v) => v.version === selected) ?? active;
  const [draft, setDraft] = useState(() => JSON.stringify(active?.document ?? { rules: [] }, null, 2));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"rules" | "json">("rules");

  const parsed = useMemo(() => {
    try {
      const r = PolicyDocumentSchema.safeParse(JSON.parse(draft));
      return r.success ? { ok: true as const, doc: r.data } : { ok: false as const, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    } catch (e) {
      return { ok: false as const, error: `JSON: ${(e as Error).message}` };
    }
  }, [draft]);
  const dirty = draft !== JSON.stringify(active?.document ?? {}, null, 2);

  function mutateRules(fn: (rules: Rule[]) => Rule[]) {
    if (!parsed.ok) return;
    setDraft(JSON.stringify({ ...parsed.doc, rules: fn(parsed.doc.rules) }, null, 2));
  }

  async function save() {
    if (!parsed.ok) return;
    setSaving(true);
    const r = await fetch("/api/policies", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ document: parsed.doc, changeNote: note, activate: true }) });
    const j = await r.json();
    setSaving(false);
    if (!r.ok) return toast.error(j.message ?? j.issues?.map((i: { message: string }) => i.message).join("; ") ?? j.error);
    toast.success(`Policy v${j.version} active`, { description: "Pending approvals under older versions are now invalid." });
    setNote("");
    setSelected(j.version);
    router.refresh();
  }
  async function activate(version: number) {
    const r = await fetch("/api/policies/activate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version }) });
    if (!r.ok) return toast.error("Could not activate");
    toast.success(`Rolled back to v${version}`);
    const v = versions.find((x) => x.version === version);
    if (v) setDraft(JSON.stringify(v.document, null, 2));
    router.refresh();
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        <Panel
          title={<span className="flex items-center gap-2">Draft based on v{active?.version} {dirty && <Pill tone="review">unsaved changes</Pill>}</span>}
          description={canEdit ? "Edit rules, validate, then save as a new immutable version." : "Read-only: switch to an approver identity (top right) to edit."}
          actions={
            <div className="flex rounded-md border p-0.5 text-xs">
              {(["rules", "json"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setTab(t)} className={cn("rounded px-2 py-0.5 capitalize", tab === t && "bg-muted font-medium")}>{t}</button>
              ))}
            </div>
          }
        >
          {tab === "rules" ? (
            parsed.ok ? (
              <>
                <RuleTable rules={parsed.doc.rules} />
                {canEdit && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => { mutateRules((r) => [...r, { ...TEMPLATE_RULE, id: `new-rule-${r.length + 1}` }]); setTab("json"); }}>
                      <Plus /> Add rule (opens JSON)
                    </Button>
                    {parsed.doc.rules.length > 0 && (
                      <Button size="sm" variant="ghost" onClick={() => mutateRules((r) => r.slice(0, -1))}>
                        <Trash2 /> Remove last rule
                      </Button>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-block">Draft is invalid — fix it in the JSON tab. {parsed.error}</p>
            )
          ) : (
            <>
              <label htmlFor="policy-json" className="sr-only">Policy JSON</label>
              <textarea
                id="policy-json"
                spellCheck={false}
                readOnly={!canEdit}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={22}
                className="w-full rounded-lg border bg-muted/30 p-3 font-mono text-[12px] leading-relaxed outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
              />
              <p className={cn("mt-1 text-xs", parsed.ok ? "text-allow" : "text-block")}>{parsed.ok ? `Valid · ${parsed.doc.rules.length} rules · approval TTL ${parsed.doc.approvalTtlSeconds}s` : parsed.error}</p>
            </>
          )}
          {canEdit && (
            <div className="mt-4 flex flex-col gap-2 border-t pt-3 sm:flex-row">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Change note (required), e.g. allow exports to finance share" className="h-8 flex-1 rounded-md border bg-background px-2.5 text-xs" />
              <Button size="sm" disabled={!parsed.ok || !dirty || note.trim().length < 3 || saving} onClick={save}>
                {saving ? <Loader2 className="animate-spin" /> : <Save />} Save &amp; activate v{(versions[0]?.version ?? 0) + 1}
              </Button>
            </div>
          )}
        </Panel>
        {sel && sel.version !== active?.version && (
          <Panel title={`Viewing v${sel.version}`} description={sel.changeNote}>
            {(() => {
              const p = PolicyDocumentSchema.safeParse(sel.document);
              return p.success ? <RuleTable rules={p.data.rules} /> : <p className="text-sm text-block">Stored version failed validation.</p>;
            })()}
          </Panel>
        )}
      </div>
      <div className="space-y-4">
        <Panel title={<span className="flex items-center gap-1.5"><History className="size-4" /> Version history</span>} bodyClassName="p-0">
          <ul className="divide-y">
            {versions.map((v) => (
              <li key={v.version} className={cn("flex items-start gap-2 px-4 py-2.5", selected === v.version && "bg-muted/40")}>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelected(v.version)}>
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    v{v.version} {v.version === activeVersion && <Pill tone="allow">active</Pill>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{v.changeNote || "—"}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">{v.createdBy} · #{v.hash.slice(0, 8)}</div>
                </button>
                {canEdit && v.version !== activeVersion && (
                  <Button size="xs" variant="outline" onClick={() => activate(v.version)}>Activate</Button>
                )}
              </li>
            ))}
          </ul>
        </Panel>
        <Simulator doc={parsed.ok ? parsed.doc : null} />
      </div>
    </div>
  );
}
