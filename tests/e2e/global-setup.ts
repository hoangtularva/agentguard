import fs from "node:fs";
import path from "node:path";
import { type FullConfig, request } from "@playwright/test";

/** Signs in once as the demo user Alice and stores the cookie for all tests. */
export const AUTH_FILE = path.join(process.cwd(), ".data", "e2e-auth-alice.json");

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL as string;
  const ctx = await request.newContext({ baseURL });
  // The dev server may still be compiling the route on the first call.
  for (let i = 0; i < 30; i++) {
    const r = await ctx.post("/api/identity", { data: { userId: "u_alice" } });
    if (r.ok()) break;
    await new Promise((res) => setTimeout(res, 2000));
  }
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  await ctx.storageState({ path: AUTH_FILE });
  await ctx.dispose();
}
