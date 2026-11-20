import { requireUser } from "@/server/app-context";
import { getDb } from "@/server/db/client";
import { sealAuditChain, verifyAuditChain } from "@/server/enforcement/audit-chain";
import { json, sameOrigin } from "@/server/http";

export const runtime = "nodejs";

/** Seal pending events, then recompute the audit hash chain (approver/admin). */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "forbidden_origin" }, 403);
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  if (auth.user.role === "member") return json({ error: "forbidden", message: "Only approvers or admins verify the audit log." }, 403);
  const db = await getDb();
  while ((await sealAuditChain(db)) === 1000);
  return json(await verifyAuditChain(db));
}
