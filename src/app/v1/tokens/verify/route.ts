import { body, v1 } from "@/server/integration/http";
import { VerifyBody, verifyToken } from "@/server/integration/service";

export const runtime = "nodejs";

/** For tool backends: is this token valid for exactly this tool + args, and unused? (Consumes it by default.) */
export const POST = v1("verify", async ({ req, db, principal }) => {
  const b = await body(req, VerifyBody);
  return b instanceof Response ? b : verifyToken(db, principal, b);
});
