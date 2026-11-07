import { expect, test } from "@playwright/test";

for (const path of ["/", "/playground", "/attack-lab", "/approvals", "/events", "/policies"]) {
  test(`no horizontal page scroll on ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test("mobile navigation opens", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Attack Lab" }).click();
  await expect(page).toHaveURL(/attack-lab/);
});
