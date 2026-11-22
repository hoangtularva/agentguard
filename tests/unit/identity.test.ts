import { describe, expect, it } from "vitest";
import { canSeeAll, decodeIdentity, demoAuthEnabled, encodeIdentity } from "@/server/identity";

describe("demo identity (Phase 3 F1–F3)", () => {
  it("round-trips a signed identity and rejects tampering", () => {
    const c = encodeIdentity("u_alice");
    expect(decodeIdentity(c)).toBe("u_alice");
    expect(decodeIdentity(c.replace("u_alice", "u_bob"))).toBeNull(); // signature bound to the id
    expect(decodeIdentity("u_bob.0000000000000000000000000000dead")).toBeNull();
    expect(decodeIdentity("u_bob")).toBeNull();
    expect(decodeIdentity("")).toBeNull();
    expect(decodeIdentity(undefined)).toBeNull();
  });

  it("demo sign-in is off in production unless explicitly enabled", () => {
    expect(demoAuthEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(demoAuthEnabled({ NODE_ENV: "production", CALLWRIT_DEMO_AUTH: "1" })).toBe(true);
    expect(demoAuthEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(demoAuthEnabled({ NODE_ENV: "development", CALLWRIT_DEMO_AUTH: "0" })).toBe(false);
  });

  it("only approvers and admins see other users' data", () => {
    expect(canSeeAll("member")).toBe(false);
    expect(canSeeAll("approver")).toBe(true);
    expect(canSeeAll("admin")).toBe(true);
  });
});
