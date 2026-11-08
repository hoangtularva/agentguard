/**
 * Portfolio screenshots (reproducible). Requires a running app:
 *   npm run dev            (or the Docker stack)
 *   npx tsx scripts/screenshots.ts [baseURL]
 * Writes docs/screenshots/*.png. Uses the deterministic simulated agent so images are stable.
 */
import fs from "node:fs";
import path from "node:path";
import { type Browser, type Page, chromium, devices } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = path.join(process.cwd(), "docs", "screenshots");

async function signIn(page: Page, userId: string) {
  const r = await page.request.post(`${BASE}/api/identity`, { data: { userId } });
  if (!r.ok()) throw new Error(`sign-in failed: ${r.status()}`);
}

async function shot(browser: Browser, name: string, opts: { user: string; url: string; scheme: "light" | "dark"; mobile?: boolean; act?: (p: Page) => Promise<void> }) {
  const ctx = await browser.newContext({
    ...(opts.mobile ? devices["Pixel 7"] : { viewport: { width: 1440, height: 900 } }),
    colorScheme: opts.scheme,
  });
  const page = await ctx.newPage();
  await signIn(page, opts.user);
  await page.goto(`${BASE}${opts.url}`, { waitUntil: "networkidle" });
  if (opts.act) await opts.act(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: !opts.mobile });
  await ctx.close();
  console.log("saved", name);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const runInjection = async (p: Page) => {
    await p.getByRole("button", { name: "Injection in an email" }).click();
    await p.getByRole("button", { name: "Run agent" }).click();
    await p.getByText("proposed after reading untrusted content").first().waitFor({ timeout: 120_000 });
  };
  await shot(browser, "playground-injection-dark", { user: "u_alice", url: "/playground", scheme: "dark", act: runInjection });
  await shot(browser, "playground-injection-light", { user: "u_alice", url: "/playground", scheme: "light", act: runInjection });
  await shot(browser, "approvals-light", { user: "u_alice", url: "/approvals", scheme: "light" });
  await shot(browser, "overview-dark", { user: "u_bob", url: "/", scheme: "dark" });
  await shot(browser, "attack-lab-dark", {
    user: "u_bob",
    url: "/attack-lab",
    scheme: "dark",
    act: async (p) => {
      await p.getByRole("button", { name: "Run simulation" }).click();
      await p.getByText(/All \d+ scenarios passed|scenario\(s\) failed/).first().waitFor({ timeout: 300_000 });
    },
  });
  await shot(browser, "policy-studio-light", { user: "u_bob", url: "/policies", scheme: "light" });
  await shot(browser, "events-dark", { user: "u_bob", url: "/events", scheme: "dark" });
  await shot(browser, "sign-in-light", { user: "u_alice", url: "/", scheme: "light", act: async (p) => {
    await p.context().clearCookies();
    await p.reload({ waitUntil: "networkidle" });
  } });
  await shot(browser, "mobile-playground-dark", { user: "u_alice", url: "/playground", scheme: "dark", mobile: true });
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
