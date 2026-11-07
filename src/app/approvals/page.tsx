import { Inbox } from "lucide-react";
import { EmptyState, PageHeader, Panel } from "@/components/primitives";
import { getCurrentUser } from "@/server/app-context";
import { listApprovals } from "@/server/queries";
import { ApprovalCard, type ApprovalView } from "./approval-card";

export const metadata = { title: "Approval Inbox" };

export default async function ApprovalsPage() {
  const [rows, user] = await Promise.all([listApprovals(), getCurrentUser()]);
  const views: ApprovalView[] = rows.map(({ approval: a, call, session, expiredNow }) => {
    const expired = a.status === "pending" || a.status === "approved" ? Boolean(expiredNow) : a.status === "expired";
    return {
      id: a.id,
      status: expired && (a.status === "pending" || a.status === "approved") ? "expired" : a.status,
      tool: call.tool,
      // Exact arguments are shown only while pending (they are what the human approves).
      args: (call.pendingArgs ?? call.argsRedacted) as Record<string, unknown>,
      argsAreExact: !!call.pendingArgs,
      reasons: call.reasons as ApprovalView["reasons"],
      riskScore: call.riskScore,
      provenance: call.provenance as ApprovalView["provenance"],
      prompt: session.userPrompt,
      requestedFor: a.requestedFor,
      policyVersion: a.policyVersion,
      bindingHash: a.bindingHash,
      expiresAt: a.expiresAt.toISOString(),
      createdAt: a.createdAt.toISOString(),
      decidedBy: a.decidedBy,
      canDecide: user.id === a.requestedFor || user.role !== "member",
    };
  });
  const open = views.filter((v) => v.status === "pending" || v.status === "approved");
  const closed = views.filter((v) => !(v.status === "pending" || v.status === "approved"));
  return (
    <>
      <PageHeader
        title="Approval Inbox"
        description="Actions paused by policy. An approval is valid once, for these exact arguments, this user and agent, and the policy version shown — until it expires."
      />
      <Panel title={`Open (${open.length})`} bodyClassName={open.length ? "space-y-3" : "p-0"}>
        {open.length === 0 ? (
          <EmptyState icon={Inbox} title="Nothing waiting">Actions that need a human decision will appear here.</EmptyState>
        ) : (
          open.map((v) => <ApprovalCard key={v.id} v={v} />)
        )}
      </Panel>
      {closed.length > 0 && (
        <Panel title={`History (${closed.length})`} className="mt-4" bodyClassName="space-y-3">
          {closed.slice(0, 30).map((v) => (
            <ApprovalCard key={v.id} v={v} />
          ))}
        </Panel>
      )}
    </>
  );
}
