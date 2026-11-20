import { describe, expect, it } from "vitest";
import { DecisionVerifier } from "../../packages/sdk-ts/src/verify";
import { deriveTokenKey, signDecisionToken } from "../../packages/core/src/decision-token";
import { hashCanonical } from "@/server/core/canonical";

const key = deriveTokenKey("s3cret-for-tests-only", "acme", 1);
const args = { to: "boss@corp.test", body: "hi" };
const now = Math.floor(Date.now() / 1000);
const token = (jti: string, a = args) =>
  signDecisionToken(key, { jti, app: "acme", agent: "acme.w", call: `tc_${jti}`, tool: "send_email", ah: hashCanonical(a), iat: now, exp: now + 60 });

describe("tool-side DecisionVerifier (offline)", () => {
  it("accepts once, then refuses replays, other args, other apps and missing tokens", async () => {
    const v = new DecisionVerifier({ key, appId: "acme" });
    expect(await v.verify(token("a"), "send_email", args)).toMatchObject({ valid: true, callId: "tc_a" });
    expect(await v.verify(token("a"), "send_email", args)).toMatchObject({ valid: false, code: "REPLAYED" });
    expect(await v.verify(token("b"), "send_email", { ...args, to: "eve@evil.test" })).toMatchObject({ code: "ARGS_MISMATCH" });
    expect(await new DecisionVerifier({ key, appId: "globex" }).verify(token("c"), "send_email", args)).toMatchObject({ code: "WRONG_APP" });
    expect(await v.verify(undefined, "send_email", args)).toMatchObject({ code: "MISSING" });
  });

  it("protects an HTTP handler: 403 without a matching token, handler runs with one", async () => {
    const v = new DecisionVerifier({ key });
    let ran = 0;
    const handler = v.protect("send_email", async (_req, a) => {
      ran++;
      return Response.json({ sent: a.to });
    });
    const req = (t?: string, body: unknown = args) =>
      new Request("http://tool/send", { method: "POST", headers: t ? { "x-agentguard-token": t } : {}, body: JSON.stringify(body) });
    expect((await handler(req())).status).toBe(403);
    expect((await handler(req(token("d"), { ...args, body: "changed" }))).status).toBe(403);
    const ok = await handler(req(token("e")));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ sent: "boss@corp.test" });
    expect(ran).toBe(1);
  });

  it("fails closed when the online verifier is unreachable", async () => {
    const v = new DecisionVerifier({ server: { baseUrl: "http://127.0.0.1:9", apiKey: "agk_x", timeoutMs: 300 } });
    expect(await v.verify(token("f"), "send_email", args)).toMatchObject({ valid: false, code: "UNAVAILABLE" });
  });
});
