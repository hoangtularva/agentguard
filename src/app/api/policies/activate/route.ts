import { z } from "zod";
import { getCurrentUser } from "@/server/app-context";
import { getDb } from "@/server/db/client";
import { DEFAULT_POLICY_ID } from "@/server/db/seed";
import { PolicyNotFoundError, activatePolicyVersion } from "@/server/enforcement/policy-store";
import { json, parseBody, sameOrigin } from "@/server/http";

export const runtime = "nodejs";

const Body = z.object({ version: z.number().int().min(1) });

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "forbidden_origin" }, 403);
  const user = await getCurrentUser();
  if (user.role === "member") return json({ error: "forbidden", message: "Only approvers or admins can change policy." }, 403);
  const body = await parseBody(req, Body);
  if (!body.ok) return body.res;
  try {
    await activatePolicyVersion(await getDb(), DEFAULT_POLICY_ID, body.data.version, user.id);
  } catch (e) {
    if (e instanceof PolicyNotFoundError) return json({ error: "not_found" }, 404);
    throw e;
  }
  return json({ ok: true });
}
