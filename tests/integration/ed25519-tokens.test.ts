import { describe, expect, it } from "vitest";
import { DecisionVerifier } from "../../packages/sdk-ts/src/verify";
import { GET as keysRoute } from "@/app/v1/keys/[appId]/route";
import { getDb } from "@/server/db/client";
import { createApp } from "@/server/integration/apps";
import * as v1 from "@/server/integration/service";

/** An app that issues Ed25519 (agt2) tokens: tool services verify with the public key only. */
describe("Ed25519 decision tokens end to end", () => {
  it("issues agt2 tokens, publishes the public key, verifies offline (no secret) and online", async () => {
    const db = await getDb();
    const app = await createApp(db, { id: "edapp", name: "Ed app", createdBy: "u_bob", tokenAlg: "ed25519" });
    const p = { keyId: "setup", app, agentId: null, scopes: ["admin" as const, "check" as const, "verify" as const] };
    await v1.putTool(db, p, "lookup", { name: "lookup", kind: "source", risk: "low", inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } });
    await v1.putAgent(db, p, "bot", { name: "bot", allowedTools: ["lookup"], active: true });
    const { sessionId } = await v1.openSession(db, p, { userRef: "u", agentId: "bot", agents: [], prompt: "look things up", mandate: { tools: ["lookup"], resources: [], destinations: [] } });
    const r = await v1.check(db, p, { sessionId, agentId: "bot", tool: "lookup", args: { q: "x" } });
    expect(r.decisionToken).toMatch(/^agt2\./);

    const keys = await (await keysRoute(new Request("http://x/v1/keys/edapp"), { params: Promise.resolve({ appId: "edapp" }) })).json();
    expect(keys).toMatchObject({ app: "edapp", alg: "Ed25519", issuing: "ed25519" });
    expect((await keysRoute(new Request("http://x"), { params: Promise.resolve({ appId: "nope" }) })).status).toBe(404);

    const offline = new DecisionVerifier({ publicKey: keys.publicKey, appId: "edapp" });
    expect(await offline.verify(r.decisionToken, "lookup", { q: "x" })).toMatchObject({ valid: true });
    expect(await offline.verify(r.decisionToken, "lookup", { q: "x" })).toMatchObject({ code: "REPLAYED" });
    expect(await offline.verify(r.decisionToken!.replace(/.$/, (c) => (c === "A" ? "B" : "A")), "lookup", { q: "x" })).toMatchObject({ valid: false });

    // Online verification consumes it server-side (the offline cache above is per process).
    expect(await v1.verifyToken(db, p, { token: r.decisionToken!, tool: "lookup", args: { q: "x" }, consume: true })).toMatchObject({ valid: true });
    expect(await v1.verifyToken(db, p, { token: r.decisionToken!, tool: "lookup", args: { q: "x" }, consume: true })).toMatchObject({ code: "REPLAYED" });
  });
});
