import { z } from "zod";
import { body, v1 } from "@/server/integration/http";
import { putTool } from "@/server/integration/service";

export const runtime = "nodejs";

/** Register a new version of a ToolSpec (JSON Schema + kind/risk/argument roles). */
export const PUT = v1("admin", async ({ req, db, principal, params }) => {
  const b = await body(req, z.unknown());
  return b instanceof Response ? b : putTool(db, principal, params.name, b);
});
