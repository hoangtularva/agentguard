"use client";

import { Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Pill, timeAgo } from "@/components/primitives";
import { Button } from "@/components/ui/button";

export interface AppView {
  id: string;
  name: string;
  defaultPolicyId: string;
  tokenAlg: "hmac" | "ed25519";
  calls: number;
  keys: { id: string; name: string; prefix: string; scopes: string[]; agentId: string | null; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }[];
  tools: { name: string; version: number; kind: string; risk: string; destinationArg?: string }[];
  agents: { ref: string; name: string; allowedTools: string[]; active: boolean }[];
}

const field = "h-8 rounded-md border bg-background px-2 text-xs";
const SCOPES = ["check", "verify", "admin"] as const;

async function post(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message ?? j.error ?? `HTTP ${r.status}`);
  return j;
}

export function CreateApp() {
  const router = useRouter();
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await post("/api/apps", "POST", { id, name: name || id });
          toast.success(`App ${id} created with the starter policy`);
          setId("");
          setName("");
          router.refresh();
        } catch (err) {
          toast.error((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="grid gap-1 text-xs">
        App id
        <input className={field} value={id} onChange={(e) => setId(e.target.value.toLowerCase())} placeholder="my-app" pattern="[a-z][a-z0-9\-]{2,31}" required />
      </label>
      <label className="grid gap-1 text-xs">
        Name
        <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="My App" maxLength={80} />
      </label>
      <Button size="sm" type="submit" disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Plus />} Create app
      </Button>
    </form>
  );
}

export function AppCard({ app }: { app: AppView }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["check"]);
  const [agentRef, setAgentRef] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const k = await post(`/api/apps/${app.id}/keys`, "POST", { name, scopes, agentRef: agentRef || undefined });
      setCreated(k.key);
      setName("");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(keyId: string) {
    setConfirming(null);
    try {
      await post(`/api/apps/${app.id}/keys/${keyId}`, "DELETE");
      toast("Key revoked");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <article className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-mono text-sm font-medium">{app.id}</h3>
        <span className="text-sm text-muted-foreground">{app.name}</span>
        <Pill>policy {app.defaultPolicyId}</Pill>
        <Pill>{app.calls} checked calls</Pill>
        <Pill tone={app.tokenAlg === "ed25519" ? "allow" : "neutral"}>
          tokens: {app.tokenAlg === "ed25519" ? `Ed25519 (public key: /v1/keys/${app.id})` : "HMAC"}
        </Pill>
      </div>

      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <section>
          <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">Tools ({app.tools.length})</h4>
          {app.tools.length === 0 ? (
            <p className="text-xs text-muted-foreground">None yet. Register with <code>PUT /v1/tools/:name</code> (admin key) or the MCP gateway.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {app.tools.map((t) => (
                <li key={t.name}>
                  <Pill tone={t.kind === "sink" ? "review" : "neutral"}>
                    {t.name} v{t.version} · {t.kind} · {t.risk}
                    {t.destinationArg ? ` · dest=${t.destinationArg}` : ""}
                  </Pill>
                </li>
              ))}
            </ul>
          )}
          <h4 className="mb-1.5 mt-3 text-xs font-medium text-muted-foreground">Agents ({app.agents.length})</h4>
          <ul className="space-y-1 text-xs">
            {app.agents.map((g) => (
              <li key={g.ref}>
                <span className="font-mono">{g.ref}</span> <span className="text-muted-foreground">→ {g.allowedTools.join(", ") || "no tools"}</span>
                {!g.active && <Pill tone="block">inactive</Pill>}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">API keys</h4>
          <ul className="divide-y rounded-lg border text-xs">
            {app.keys.length === 0 && <li className="px-3 py-2 text-muted-foreground">No keys.</li>}
            {app.keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <KeyRound className="size-3.5 text-muted-foreground" />
                <span className="font-mono">{k.prefix}…</span>
                <span>{k.name}</span>
                {k.scopes.map((s) => (
                  <Pill key={s} tone={s === "admin" ? "review" : "neutral"}>{s}</Pill>
                ))}
                {k.agentId && <Pill tone="brand">agent {k.agentId.slice(app.id.length + 1)}</Pill>}
                <span className="ml-auto text-muted-foreground">{k.revokedAt ? "revoked" : k.lastUsedAt ? `used ${timeAgo(k.lastUsedAt)}` : "never used"}</span>
                {!k.revokedAt &&
                  (confirming === k.id ? (
                    // Two-step, in place: agents using this key stop working immediately.
                    <span className="inline-flex items-center gap-1">
                      <Button variant="destructive" size="sm" onClick={() => revoke(k.id)}>
                        Revoke now
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <Button variant="ghost" size="icon-sm" aria-label={`Revoke ${k.name}`} onClick={() => setConfirming(k.id)}>
                      <Trash2 />
                    </Button>
                  ))}
              </li>
            ))}
          </ul>

          {created && (
            <div className="mt-2 rounded-lg border border-review/40 bg-review/10 p-2 text-xs" role="status">
              <p className="mb-1 font-medium">Copy this key now. It is shown once; AgentGuard stores only its hash.</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all font-mono">{created}</code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(created);
                    toast.success("Copied");
                  }}
                >
                  <Copy /> Copy
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setCreated(null)}>
                  Done
                </Button>
              </div>
            </div>
          )}

          <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={createKey}>
            <label className="grid gap-1 text-xs">
              Key name
              <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="runtime" required maxLength={80} />
            </label>
            <fieldset className="flex items-center gap-2 text-xs">
              <legend className="sr-only">Scopes</legend>
              {SCOPES.map((s) => (
                <label key={s} className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={scopes.includes(s)}
                    onChange={(e) => setScopes((cur) => (e.target.checked ? [...cur, s] : cur.filter((x) => x !== s)))}
                  />
                  {s}
                </label>
              ))}
            </fieldset>
            <label className="grid gap-1 text-xs">
              Bind to agent (optional)
              <input className={field} value={agentRef} onChange={(e) => setAgentRef(e.target.value)} placeholder="writer" />
            </label>
            <Button size="sm" type="submit" disabled={busy || scopes.length === 0}>
              {busy ? <Loader2 className="animate-spin" /> : <KeyRound />} Create key
            </Button>
          </form>
        </section>
      </div>
    </article>
  );
}
