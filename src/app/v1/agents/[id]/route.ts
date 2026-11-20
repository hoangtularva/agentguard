import { body, v1 } from "@/server/integration/http";
import { PutAgentBody, putAgent } from "@/server/integration/service";

export const runtime = "nodejs";

/** Create or update an agent identity and the upper bound of tools it may ever request. */
export const PUT = v1("admin", async ({ req, db, principal, params }) => {
  const b = await body(req, PutAgentBody);
  return b instanceof Response ? b : putAgent(db, principal, params.id, b);
});
