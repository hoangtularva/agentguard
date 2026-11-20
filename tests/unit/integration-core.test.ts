import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { deriveTokenKey, signDecisionToken, verifyDecisionToken } from "../../packages/core/src/decision-token";
import { STARTER_POLICY } from "../../packages/core/src/starter-policy";
import { hashCanonical } from "@/server/core/canonical";
import { type PolicyInput, evaluatePolicy } from "@/server/core/policy-engine";
import { extractFingerprints } from "@/server/core/provenance";
import { openApiDocument } from "@/server/integration/openapi";

const key = deriveTokenKey("server-secret-for-tests", "acme", 1);
const args = { to: "alice@acme.test", body: "hi" };
const payload = { jti: "dt_1", app: "acme", agent: "acme.bot", call: "tc_1", tool: "send_email", ah: hashCanonical(args), iat: 1000, exp: 1060 };

describe("decision tokens", () => {
  const token = signDecisionToken(key, payload);
  const verify = (o: Partial<Parameters<typeof verifyDecisionToken>[1]> = {}, t = token) =>
    verifyDecisionToken(t, { key, tool: "send_email", args, appId: "acme", nowSeconds: 1030, ...o });

  it("accepts the exact call and binds tool, args, app, key and expiry", () => {
    expect(verify()).toMatchObject({ ok: true, payload: { call: "tc_1" } });
    expect(verify({ args: { body: "hi", to: "alice@acme.test" } }).ok).toBe(true); // key order irrelevant
    expect(verify({ args: { ...args, to: "eve@evil.test" } })).toMatchObject({ code: "ARGS_MISMATCH" });
    expect(verify({ tool: "export_data" })).toMatchObject({ code: "WRONG_TOOL" });
    expect(verify({ appId: "globex" })).toMatchObject({ code: "WRONG_APP" });
    expect(verify({ nowSeconds: 1061 })).toMatchObject({ code: "EXPIRED" });
    expect(verify({ key: deriveTokenKey("server-secret-for-tests", "acme", 2) })).toMatchObject({ code: "BAD_SIGNATURE" });
    expect(verify({}, "garbage")).toMatchObject({ code: "MALFORMED" });
  });

  it("detects a payload edited without re-signing", () => {
    const [p, , sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, ah: hashCanonical({ ...args, to: "eve@evil.test" }) })).toString("base64url");
    expect(verify({ args: { ...args, to: "eve@evil.test" } }, `${p}.${forged}.${sig}`)).toMatchObject({ code: "BAD_SIGNATURE" });
  });
});

describe("starter policy (tool-agnostic)", () => {
  const base: PolicyInput = {
    tool: { name: "post_message", risk: "medium", kind: "sink", known: true },
    argsValid: true,
    identity: { userOk: true, agentOk: true, userRole: "member" },
    mandate: { allowedTools: ["post_message", "search"], resourceScope: ["*"], destinations: ["#team"] },
    resources: [],
    destination: { value: "#team", inMandate: true, origin: [{ origin: "trusted_user", evidence: [] }] },
    dataSensitivity: "internal",
    untrustedContext: false,
    signals: [],
  };
  const decide = (o: Partial<PolicyInput>) => evaluatePolicy({ ...base, ...o }, { policyId: "acme.default", version: 1, document: STARTER_POLICY }).decision;

  it("allows reads, gates sends by mandate, risk, sensitivity and injection signals", () => {
    const read = { tool: { name: "search", risk: "low", kind: "source", known: true }, destination: undefined } as const;
    expect(decide(read)).toBe("ALLOW");
    expect(decide({ ...read, dataSensitivity: "restricted" })).toBe("REVIEW");
    expect(decide({})).toBe("ALLOW");
    expect(decide({ tool: { ...base.tool, risk: "high" } })).toBe("REVIEW");
    expect(decide({ dataSensitivity: "confidential" })).toBe("REVIEW");
    expect(decide({ dataSensitivity: "restricted" })).toBe("BLOCK");
    expect(decide({ signals: ["injection_suspected"], untrustedContext: true })).toBe("REVIEW");
    expect(decide({ destination: { value: "#random", inMandate: false, origin: [{ origin: "trusted_user", evidence: [] }] } })).toBe("BLOCK");
  });
});

describe("integration helpers", () => {
  it("extracts normalized email/URL fingerprints", () => {
    expect(extractFingerprints("Mail Bob@Acme.test, see http://x.example/a/. or https://y.example")).toEqual([
      "bob@acme.test",
      "http://x.example/a",
      "https://y.example",
    ]);
  });

  it("docs/openapi.json matches the live schemas (run `npm run openapi` after API changes)", () => {
    const file = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../docs/openapi.json"), "utf8"));
    expect(file).toEqual(JSON.parse(JSON.stringify(openApiDocument())));
  });
});

describe("Ed25519 decision tokens (agt2)", () => {
  it("verify with the public key only; reject forgery, the HMAC key, and other apps' keys", async () => {
    const { deriveEd25519KeyPair, signDecisionTokenEd25519 } = await import("../../packages/core/src/decision-token");
    const acme = deriveEd25519KeyPair("server-secret-for-tests", "acme", 1);
    const other = deriveEd25519KeyPair("server-secret-for-tests", "globex", 1);
    expect(deriveEd25519KeyPair("server-secret-for-tests", "acme", 1).publicKey).toBe(acme.publicKey); // deterministic
    const t = signDecisionTokenEd25519(acme.privateKey, payload);
    expect(t.startsWith("agt2.")).toBe(true);
    const v = (o: Partial<Parameters<typeof verifyDecisionToken>[1]>, tok = t) =>
      verifyDecisionToken(tok, { tool: "send_email", args, appId: "acme", nowSeconds: 1030, ...o });
    expect(v({ publicKey: acme.publicKey }).ok).toBe(true);
    expect(v({ publicKey: other.publicKey })).toMatchObject({ code: "BAD_SIGNATURE" });
    expect(v({ key })).toMatchObject({ code: "BAD_SIGNATURE" });
    expect(v({ publicKey: acme.publicKey, args: { ...args, to: "eve@evil.test" } })).toMatchObject({ code: "ARGS_MISMATCH" });
    const [p, , sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, tool: "export_data" })).toString("base64url");
    expect(v({ publicKey: acme.publicKey, tool: "export_data" }, `${p}.${forged}.${sig}`)).toMatchObject({ code: "BAD_SIGNATURE" });
  });
});
