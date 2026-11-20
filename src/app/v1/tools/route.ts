import { v1 } from "@/server/integration/http";
import { listTools } from "@/server/integration/service";

export const runtime = "nodejs";

export const GET = v1("admin", ({ db, principal }) => listTools(db, principal));
