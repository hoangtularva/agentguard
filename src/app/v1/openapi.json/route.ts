import { json } from "@/server/http";
import { openApiDocument } from "@/server/integration/openapi";

export const runtime = "nodejs";

export function GET() {
  return json(openApiDocument());
}
