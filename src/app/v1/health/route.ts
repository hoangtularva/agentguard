import { json } from "@/server/http";

export const runtime = "nodejs";

export function GET() {
  return json({ ok: true, api: "v1", service: "callwrit" });
}
