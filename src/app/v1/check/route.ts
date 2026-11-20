import { body, v1 } from "@/server/integration/http";
import { CheckBody, check } from "@/server/integration/service";

export const runtime = "nodejs";

/** Decide one proposed tool call: ALLOW (+ decision token) · REVIEW (+ approval id) · BLOCK (+ reasons). */
export const POST = v1("check", async ({ req, db, principal }) => {
  const b = await body(req, CheckBody);
  return b instanceof Response ? b : check(db, principal, b);
});
