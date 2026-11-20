import { v1 } from "@/server/integration/http";
import { consume } from "@/server/integration/service";

export const runtime = "nodejs";

/** After a human approved: atomically claim the approval and receive a single-use decision token. */
export const POST = v1("check", ({ db, principal, params }) => consume(db, principal, params.id));
