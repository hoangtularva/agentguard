"use client";

import { Loader2, ShieldHalf, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type User = { id: string; name: string; role: string };

const ROLE_HINT: Record<string, string> = {
  member: "runs agents, approves only their own actions, sees only their own data",
  approver: "can approve anyone's actions, edit policy, see all activity",
  admin: "full access",
};

/** Demo sign-in. There is no implicit identity: every request must carry a signed demo identity. */
export function SignIn({ users, demoAuth }: { users: User[]; demoAuth: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(id: string) {
    setBusy(id);
    setError(null);
    const r = await fetch("/api/identity", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: id }) });
    if (!r.ok) {
      setError((await r.json().catch(() => ({}))).message ?? "Sign-in failed");
      setBusy(null);
      return;
    }
    router.refresh();
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-6">
        <div className="mb-5 flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-md bg-brand text-white"><ShieldHalf className="size-4" /></span>
          <h1 className="text-lg font-semibold tracking-tight">AgentGuard</h1>
        </div>
        {demoAuth ? (
          <>
            <p className="text-sm text-muted-foreground">
              Choose a <b>demo identity</b>. This is not real authentication: it exists so you can see how roles change what you may do and see.
            </p>
            <ul className="mt-4 space-y-2">
              {users.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => choose(u.id)}
                    className="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left hover:bg-muted disabled:opacity-60"
                  >
                    {busy === u.id ? <Loader2 className="size-4 animate-spin" /> : <UserRound className="size-4 text-muted-foreground" />}
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{u.name} <span className="font-normal text-muted-foreground">· {u.role}</span></span>
                      <span className="block text-xs text-muted-foreground">{ROLE_HINT[u.role] ?? ""}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {error && <p className="mt-3 text-xs text-block" role="alert">{error}</p>}
          </>
        ) : (
          <p className="text-sm text-muted-foreground" role="status">
            Sign-in is not configured. Demo identities are disabled on this server (<code>AGENTGUARD_DEMO_AUTH</code> is off), and real authentication (OIDC) is not part of this demo.
          </p>
        )}
      </div>
    </main>
  );
}
