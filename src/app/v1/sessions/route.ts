import { json } from "@/server/http";
import { body, v1 } from "@/server/integration/http";
import { OpenSessionBody, openSession } from "@/server/integration/service";

export const runtime = "nodejs";

/** Open an agent session. `prompt` is the trusted channel: destinations the user typed there are authorized. */
export const POST = v1("check", async ({ req, db, principal }) => {
  const b = await body(req, OpenSessionBody);
  return b instanceof Response ? b : json(await openSession(db, principal, b), 201);
});
