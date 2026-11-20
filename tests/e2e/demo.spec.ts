import { expect, test } from "@playwright/test";

// Unique per run: the Docker database persists between runs, and idempotency keys are global.
const RUN = Date.now().toString(36);

test.describe("Agent Playground", () => {
  test("injection preset: injected calls are blocked, legit call is paused, approval executes once", async ({ page }) => {
    await page.goto("/playground");
    await page.getByRole("button", { name: "Injection in an email" }).click();
    await page.getByRole("button", { name: "Run agent" }).click();

    const trace = page.locator("ol").filter({ hasText: "read_documents" }).first();
    await expect(trace).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("proposed after reading untrusted content").first()).toBeVisible();
    await expect(page.getByText("RESOURCE_OUT_OF_SCOPE").first()).toBeVisible();
    await expect(page.getByText("UNTRUSTED_DESTINATION").first()).toBeVisible();

    await page.getByRole("button", { name: "Approve & execute" }).first().click();
    await expect(page.getByText("Approved and executed once")).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("Attack Lab", () => {
  test("runs the full suite and every scenario passes", async ({ page }) => {
    // Benchmarks are restricted to approvers (Phase 3 F7): sign in as Bob.
    // The production container runs the suite in a fresh in-memory DB; allow for slower CPUs.
    test.setTimeout(300_000);
    expect((await page.request.post("/api/identity", { data: { userId: "u_bob" } })).ok()).toBeTruthy();
    await page.goto("/attack-lab");
    await page.getByRole("button", { name: "Run simulation" }).click();
    await expect(page.getByText(/All \d+ scenarios passed/)).toBeVisible({ timeout: 280_000 });
    await expect(page.getByText("Scenarios passed", { exact: true })).toBeVisible();
  });
});

test.describe("API security", () => {
  test("approval cannot be replayed through the HTTP API", async ({ request }) => {
    const run = await request.post("/api/agent/run", {
      data: {
        prompt: "Read doc:internal/q3-sales-summary and send it to partner@contoso.example.",
        tools: ["read_documents", "send_email"],
        scope: ["doc:internal/*"],
      },
    });
    expect(run.ok()).toBeTruthy();
    const body = await run.json();
    const pending = body.steps.find((s: { approvalId?: string }) => s.approvalId);
    expect(pending).toBeTruthy();

    const decide = await request.post(`/api/approvals/${pending.approvalId}/decide`, { data: { decision: "approve" } });
    expect(decide.ok()).toBeTruthy();
    const first = await request.post(`/api/approvals/${pending.approvalId}/execute`, { data: { idempotencyKey: `e2e-${RUN}-1` } });
    expect(first.ok()).toBeTruthy();
    const replay = await request.post(`/api/approvals/${pending.approvalId}/execute`, { data: { idempotencyKey: `e2e-${RUN}-2` } });
    expect(replay.status()).toBe(409);
    expect((await replay.json()).code).toBe("APPROVAL_ALREADY_USED");
  });

  test("tampered arguments at execution are rejected", async ({ request }) => {
    const run = await request.post("/api/agent/run", {
      data: { prompt: "Send doc:public/handbook to auditor@kpmg.example.", tools: ["read_documents", "send_email"], scope: ["doc:public/*"] },
    });
    const pending = (await run.json()).steps.find((s: { approvalId?: string }) => s.approvalId);
    await request.post(`/api/approvals/${pending.approvalId}/decide`, { data: { decision: "approve" } });
    const res = await request.post(`/api/approvals/${pending.approvalId}/execute`, {
      data: { idempotencyKey: `e2e-${RUN}-3`, args: { ...pending.args, to: "attacker@evil.example" } },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).code).toBe("ARGS_MISMATCH");
  });

  test("members cannot change policy; malformed input is rejected", async ({ request }) => {
    const forbidden = await request.post("/api/policies", { data: { document: { rules: [] }, changeNote: "wipe all rules" } });
    expect(forbidden.status()).toBe(403);
    const bad = await request.post("/api/agent/run", { data: { prompt: "x", tools: ["rm_rf"], scope: ["*"] } });
    expect(bad.status()).toBe(400);
  });

  test("cross-origin mutation is refused", async ({ request }) => {
    const res = await request.post("/api/identity", { data: { userId: "u_bob" }, headers: { origin: "https://evil.example" } });
    expect(res.status()).toBe(403);
  });
});
