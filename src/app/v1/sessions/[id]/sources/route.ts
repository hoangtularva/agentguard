import { json } from "@/server/http";
import { body, v1 } from "@/server/integration/http";
import { AddSourceBody, addSource } from "@/server/integration/service";

export const runtime = "nodejs";

/** Register content the agent saw (untrusted). Privacy mode sends fingerprints, not text. */
export const POST = v1("check", async ({ req, db, principal, params }) => {
  const b = await body(req, AddSourceBody);
  return b instanceof Response ? b : json(await addSource(db, principal, params.id, b), 201);
});
