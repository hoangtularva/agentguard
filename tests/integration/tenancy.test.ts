import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as s from "@/server/db/schema";
import { DEFAULT_POLICY_ID } from "@/server/db/seed";
import { setup } from "../helpers";

const mandate = { allowedTools: ["read_documents"], resourceScope: ["doc:*"] };

describe("tenant isolation (apps)", () => {
  it("seeds the demo app and stamps demo rows with app_id 'demo'", async () => {
    const { db, start, pep, agentId } = await setup();
    const [app] = await db.select().from(s.apps).where(eq(s.apps.id, "demo"));
    expect(app?.defaultPolicyId).toBe(DEFAULT_POLICY_ID);
    const state = await start("Summarize doc:roadmap", mandate);
    expect(state.appId).toBe("demo");
    const r = await pep.enforce(state, { tool: "read_documents", args: { documentIds: ["doc:roadmap"] }, agentId });
    const [tc] = await db.select().from(s.toolCalls).where(eq(s.toolCalls.id, r.toolCallId));
    expect(tc?.appId).toBe("demo");
    const events = await db.select().from(s.auditEvents).where(eq(s.auditEvents.toolCallId, r.toolCallId));
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.appId === "demo")).toBe(true);
  });

  it("refuses an agent that belongs to another app", async () => {
    const { db, pep } = await setup();
    await db.insert(s.apps).values({ id: "acme", name: "Acme", createdBy: "u_bob", defaultPolicyId: DEFAULT_POLICY_ID });
    await db.insert(s.agents).values({ id: "acme_agent", appId: "acme", name: "Acme bot", allowedTools: ["read_documents"] });
    const params = { userId: "u_alice", agentId: "acme_agent", prompt: "hi", planner: "t", policyId: DEFAULT_POLICY_ID, mandate };
    await expect(pep.startSession(params)).rejects.toThrow(/Unknown or inactive agent/);
    const acme = await pep.startSession({ ...params, appId: "acme" });
    expect(acme.appId).toBe("acme");
  });

  it("fails identity verification if a session is presented under another tenant", async () => {
    const { start, pep, agentId } = await setup();
    const state = await start("Summarize doc:roadmap", mandate);
    const r = await pep.enforce({ ...state, appId: "acme" }, { tool: "read_documents", args: { documentIds: ["doc:roadmap"] }, agentId });
    expect(r.decision.decision).toBe("BLOCK");
    expect(r.decision.reasons.map((x) => x.code)).toContain("IDENTITY_UNVERIFIED");
  });
});
