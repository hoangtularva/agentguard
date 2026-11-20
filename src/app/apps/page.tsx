import { Plug } from "lucide-react";
import { EmptyState, PageHeader, Panel } from "@/components/primitives";
import { getCurrentUser } from "@/server/app-context";
import { tokenAlgOf } from "@/server/integration/apps";
import { listApps } from "@/server/queries";
import { AppCard, type AppView, CreateApp } from "./apps-manager";

export const metadata = { title: "Apps & API keys" };

export default async function AppsPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const header = (
    <PageHeader
      title="Apps & API keys"
      description="Integrate agents that live in other codebases: each app gets its own tools, agents, policy and keys, and calls /v1 (SDKs, MCP gateway). Its decisions appear in the Approval Inbox and Security Events."
    />
  );
  if (user.role === "member")
    return (
      <>
        {header}
        <EmptyState icon={Plug} title="Approvers and admins manage apps">
          Sign in as Bob (approver) to create apps and API keys.
        </EmptyState>
      </>
    );

  const apps: AppView[] = (await listApps()).map((a) => ({
    id: a.id,
    name: a.name,
    defaultPolicyId: a.defaultPolicyId,
    tokenAlg: tokenAlgOf(a),
    maxSinkCallsPerSession: Number(a.settings.maxSinkCallsPerSession) || undefined,
    calls: Number(a.calls),
    keys: a.keys.map((k) => ({
      ...k,
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      revokedAt: k.revokedAt?.toISOString() ?? null,
    })),
    tools: a.tools.map((t) => {
      const spec = t.spec as { kind: string; risk: string; destinationArg?: string };
      return { name: t.name, version: t.version, kind: spec.kind, risk: spec.risk, destinationArg: spec.destinationArg };
    }),
    agents: a.agents.map((g) => ({ ref: g.ref, name: g.name, allowedTools: g.allowedTools, active: g.active })),
  }));

  return (
    <>
      {header}
      <Panel title="New app" description="Starts with the tool-agnostic starter policy: reads allowed, sends only to destinations the user gave, approvals for high risk or confidential data.">
        <CreateApp />
      </Panel>
      <div className="mt-4 space-y-3">
        {apps.length === 0 ? (
          <EmptyState icon={Plug} title="No apps yet">
            Create one above, or run <code>npm run examples:setup</code>.
          </EmptyState>
        ) : (
          apps.map((a) => <AppCard key={a.id} app={a} />)
        )}
      </div>
    </>
  );
}
