import { type APIRequestContext, expect, request, test } from "@playwright/test";

/**
 * Phase 3 red-team regression tests (see docs/PHASE3_FINDINGS.md).
 * Each test reproduces a confirmed finding and asserts the fixed behaviour.
 */

async function as(baseURL: string, userId: string | null): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  if (userId) expect((await ctx.post("/api/identity", { data: { userId } })).ok()).toBeTruthy();
  return ctx;
}

const RUN = { prompt: "Summarize doc:public/handbook", tools: ["read_documents"], scope: ["doc:public/*"] };

test.describe("F1 — no implicit identity", () => {
  test("API mutations without a session are rejected (401)", async ({ baseURL }) => {
    const anon = await as(baseURL!, null);
    expect((await anon.post("/api/agent/run", { data: RUN })).status()).toBe(401);
    expect((await anon.post("/api/approvals/apr_x/decide", { data: { decision: "approve" } })).status()).toBe(401);
    expect((await anon.post("/api/policies/simulate", { data: { document: { rules: [] }, input: { tool: "send_email" } } })).status()).toBe(401);
  });

  test("pages without a session show the demo sign-in, not data", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto("/approvals");
    await expect(page.getByText("Choose a demo identity")).toBeVisible();
    await expect(page.getByText("Approval Inbox")).toHaveCount(0);
    await ctx.close();
  });
});

test.describe("F2 — forged identity", () => {
  test("a cookie with a bad signature is treated as unauthenticated", async ({ baseURL }) => {
    const forged = await request.newContext({
      baseURL,
      extraHTTPHeaders: { cookie: "ag_uid=u_bob.0000000000000000000000000000dead" },
      storageState: { cookies: [], origins: [] },
    });
    expect((await forged.post("/api/policies", { data: { document: { rules: [] }, changeNote: "forged" } })).status()).toBe(401);
  });
});

test.describe("F4 — members only see their own data", () => {
  test("another member cannot read Alice's pending action, session or events", async ({ baseURL, request: alice }) => {
    const marker = `idor-${Date.now()}@contoso.example`;
    const run = await alice.post("/api/agent/run", {
      data: { prompt: `Send doc:public/handbook to ${marker}`, tools: ["read_documents", "send_email"], scope: ["doc:public/*"] },
    });
    expect(run.ok()).toBeTruthy();
    const { sessionId } = await run.json();

    const mallory = await as(baseURL!, "u_mallory");
    expect(await (await mallory.get("/approvals")).text()).not.toContain(marker);
    const sess = await mallory.get(`/sessions/${sessionId}`);
    expect(sess.status()).toBe(404);
    expect(await sess.text()).not.toContain(marker);
    expect(await (await mallory.get(`/events?session=${sessionId}`)).text()).not.toContain("tool_call.evaluated");

    // An approver still sees everything (needed to do their job).
    const bob = await as(baseURL!, "u_bob");
    expect(await (await bob.get("/approvals")).text()).toContain(marker);
    // And Alice sees her own.
    expect(await (await alice.get(`/sessions/${sessionId}`)).text()).toContain(marker);
  });
});

test.describe("F5/F6/F7 — resource limits and headers", () => {
  test("oversized JSON bodies are refused with 413", async ({ request: alice }) => {
    const big = JSON.stringify({ ...RUN, prompt: "a".repeat(200_000) });
    const r = await alice.post("/api/agent/run", { data: big, headers: { "content-type": "application/json" } });
    expect(r.status()).toBe(413);
  });

  test("a Content-Security-Policy is sent", async ({ request: alice }) => {
    const csp = (await alice.get("/")).headers()["content-security-policy"] ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  test("members cannot start the CPU-heavy benchmark", async ({ request: alice }) => {
    const r = await alice.post("/api/bench/run", { data: { runs: 1, scenarioIds: ["L01"] } });
    expect(r.status()).toBe(403);
  });
});
