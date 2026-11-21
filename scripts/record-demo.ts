/**
 * Records a short walkthrough video of the running app (docs/media/demo.webm).
 *   npx tsx scripts/record-demo.ts [baseURL]
 * Uses the deterministic simulated agent, so the video is reproducible.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = path.join(process.cwd(), "docs", "media");

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(OUT, ".rec-"));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 }, colorScheme: "dark", recordVideo: { dir: tmp, size: { width: 1280, height: 760 } } });
  const page = await ctx.newPage();
  const pause = (ms: number) => page.waitForTimeout(ms);
  await page.request.post(`${BASE}/api/identity`, { data: { userId: "u_alice" } });

  // 1. Alice runs an agent on an inbox with an injected instruction.
  await page.goto(`${BASE}/playground`, { waitUntil: "networkidle" });
  await pause(1200);
  await page.getByRole("button", { name: "Injection in an email" }).click();
  await pause(1000);
  await page.getByRole("button", { name: "Run agent" }).click();
  await page.getByText("proposed after reading untrusted content").first().waitFor({ timeout: 120_000 });
  await pause(1500);
  await page.mouse.wheel(0, 500);
  await pause(2500);
  await page.mouse.wheel(0, 600);
  await pause(2500);

  // 2. The held action waits in the Approval Inbox with its exact arguments and provenance.
  await page.goto(`${BASE}/approvals`, { waitUntil: "networkidle" });
  await pause(3500);

  // 3. Security events: every decision, hash-chained; Bob verifies the chain.
  await page.request.post(`${BASE}/api/identity`, { data: { userId: "u_bob" } });
  await page.goto(`${BASE}/events`, { waitUntil: "networkidle" });
  await pause(1500);
  await page.getByRole("button", { name: "Verify audit chain" }).click();
  await page.getByText(/Chain intact|Broken at/).waitFor({ timeout: 30_000 });
  await pause(2500);

  // 4. External apps: agents from other codebases with their own tools, keys and kill switch.
  await page.goto(`${BASE}/apps`, { waitUntil: "networkidle" });
  await pause(3500);

  await ctx.close();
  await browser.close();
  const [file] = fs.readdirSync(tmp).filter((f) => f.endsWith(".webm"));
  fs.renameSync(path.join(tmp, file), path.join(OUT, "demo.webm"));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`docs/media/demo.webm (${Math.round(fs.statSync(path.join(OUT, "demo.webm")).size / 1024)} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
