import { z } from "zod";
import { getCurrentUser } from "@/server/app-context";
import { PolicyDocumentSchema } from "@/server/core/policy-schema";
import { getDb } from "@/server/db/client";
import { DEFAULT_POLICY_ID } from "@/server/db/seed";
import { createPolicyVersion } from "@/server/enforcement/policy-store";
import { json, parseBody, sameOrigin } from "@/server/http";

export const runtime = "nodejs";

const Body = z.object({
  document: PolicyDocumentSchema,
  changeNote: z.string().trim().min(3).max(300),
  activate: z.boolean().default(true),
});

/** Create a new immutable policy version. Only approvers/admins may change policy. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "forbidden_origin" }, 403);
  const user = await getCurrentUser();
  if (user.role === "member") return json({ error: "forbidden", message: "Only approvers or admins can change policy." }, 403);
  const body = await parseBody(req, Body);
  if (!body.ok) return body.res;
  const ref = await createPolicyVersion(await getDb(), {
    policyId: DEFAULT_POLICY_ID,
    name: "Workspace default policy",
    document: body.data.document,
    changeNote: body.data.changeNote,
    actorId: user.id,
    activate: body.data.activate,
  });
  return json({ ok: true, version: ref.version });
}
