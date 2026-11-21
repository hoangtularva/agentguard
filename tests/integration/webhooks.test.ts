import http from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { createApp } from "@/server/integration/apps";
import * as v1 from "@/server/integration/service";
import { notify, signWebhook } from "@/server/integration/webhooks";

/** Opt-in approval webhooks: nothing without configuration; signed payloads without arguments. */
const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
let server: http.Server;
let url: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      res.end("ok");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("approval webhooks", () => {
  it("sends nothing unless configured; then a signed event with ids only, no arguments", async () => {
    const db = await getDb();
    const app = await createApp(db, { id: "hooked", name: "hooked", createdBy: "u_bob" });
    const p = { keyId: "setup", app, agentId: null, scopes: ["admin" as const, "check" as const] };
    await v1.putTool(db, p, "wire", {
      name: "wire",
      kind: "sink",
      risk: "high",
      destinationArg: "account",
      inputSchema: { type: "object", properties: { account: { type: "string" }, amount: { type: "number" } }, required: ["account", "amount"] },
    });
    await v1.putAgent(db, p, "bot", { name: "bot", allowedTools: ["wire"], active: true });
    const event = { type: "approval.requested" as const, app: "hooked", approvalId: "apr_x", callId: "tc_x", tool: "wire", status: "pending", expiresAt: new Date().toISOString() };
    expect(await notify(db, event)).toBe("skipped");
    expect(received).toHaveLength(0);

    await db.update(s.apps).set({ settings: { webhookUrl: url } }).where(eq(s.apps.id, "hooked"));
    const configured = { ...p, app: { ...app, settings: { webhookUrl: url } } };
    const { sessionId } = await v1.openSession(db, configured, { userRef: "u", agentId: "bot", agents: [], prompt: "pay acct-7", mandate: { tools: ["wire"], resources: [], destinations: ["acct-7"] } });
    const r = await v1.check(db, configured, { sessionId, agentId: "bot", tool: "wire", args: { account: "acct-7", amount: 990 } });
    expect(r.decision).toBe("REVIEW");
    for (let i = 0; i < 50 && received.length === 0; i++) await new Promise((res) => setTimeout(res, 50));
    expect(received).toHaveLength(1);
    const { headers, body } = received[0];
    expect(JSON.parse(body)).toMatchObject({ type: "approval.requested", app: "hooked", approvalId: r.approvalId, callId: r.callId, tool: "wire" });
    expect(body).not.toContain("acct-7");
    expect(body).not.toContain("990");
    expect(headers["x-agentguard-signature"]).toBe(signWebhook("hooked", String(headers["x-agentguard-timestamp"]), body));
    expect(signWebhook("other-app", String(headers["x-agentguard-timestamp"]), body)).not.toBe(headers["x-agentguard-signature"]);
  });
});
