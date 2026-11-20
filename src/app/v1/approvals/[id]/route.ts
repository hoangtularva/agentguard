import { v1 } from "@/server/integration/http";
import { getApproval } from "@/server/integration/service";

export const runtime = "nodejs";

export const GET = v1("check", ({ db, principal, params }) => getApproval(db, principal, params.id));
