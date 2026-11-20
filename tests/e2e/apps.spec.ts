import { expect, test } from "@playwright/test";

const RUN = Date.now().toString(36);

test.describe("Apps & API keys", () => {
  test("members cannot manage apps", async ({ page }) => {
    await page.goto("/apps");
    await expect(page.getByText("Approvers and admins manage apps")).toBeVisible();
    const r = await page.request.post("/api/apps", { data: { id: `m-${RUN}`, name: "x" } });
    expect(r.status()).toBe(403);
  });

  test("an approver creates an app and a key (shown once), the key works on /v1, then is revoked", async ({ page }) => {
    expect((await page.request.post("/api/identity", { data: { userId: "u_bob" } })).ok()).toBeTruthy();
    const appId = `e2e-${RUN}`;
    await page.goto("/apps");
    await page.getByPlaceholder("my-app").fill(appId);
    await page.getByRole("button", { name: "Create app" }).click();
    const card = page.locator("article", { has: page.getByRole("heading", { name: appId }) });
    await expect(card).toBeVisible();
    await expect(card.getByText(`policy ${appId}.default`)).toBeVisible();

    await card.getByPlaceholder("runtime").fill("e2e-runtime");
    await card.getByRole("button", { name: "Create key" }).click();
    const shown = card.getByRole("status").locator("code");
    await expect(shown).toHaveText(/^agk_/);
    const key = (await shown.textContent())!;

    // The key authenticates on the decision API (no tools registered yet, so a session for an unknown agent is a 404).
    const ok = await page.request.post("/v1/sessions", {
      headers: { authorization: `Bearer ${key}` },
      data: { userRef: "u", agentId: "nobody", prompt: "hi", mandate: { tools: [] } },
    });
    expect(ok.status()).toBe(404);

    await card.getByRole("button", { name: "Done" }).click();
    await expect(card.getByRole("status")).toHaveCount(0); // never shown again
    await card.getByRole("button", { name: "Revoke e2e-runtime" }).click();
    await card.getByRole("button", { name: "Revoke now" }).click();
    await expect(card.getByText("revoked")).toBeVisible();
    const after = await page.request.post("/v1/sessions", {
      headers: { authorization: `Bearer ${key}` },
      data: { userRef: "u", agentId: "nobody", prompt: "hi", mandate: { tools: [] } },
    });
    expect(after.status()).toBe(401);
  });
});
