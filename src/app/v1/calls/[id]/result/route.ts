import { body, v1 } from "@/server/integration/http";
import { ResultBody, reportResult } from "@/server/integration/service";

export const runtime = "nodejs";

/** The host executed an allowed call: record the outcome; its output becomes untrusted provenance. */
export const POST = v1("check", async ({ req, db, principal, params }) => {
  const b = await body(req, ResultBody);
  return b instanceof Response ? b : reportResult(db, principal, params.id, b);
});
