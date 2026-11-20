import { z } from "zod";
import { requireUser } from "@/server/app-context";
import { getDb } from "@/server/db/client";
import { json, parseBody, sameOrigin } from "@/server/http";
import { APP_ID_RE, createApp } from "@/server/integration/apps";

export const runtime = "nodejs";

const Body = z.object({ id: z.string().regex(APP_ID_RE, "3–32 chars: a-z, 0-9, '-'"), name: z.string().min(1).max(80) });

/** Register an integrated app (approver/admin). It starts with the tool-agnostic starter policy. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "forbidden_origin" }, 403);
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  if (auth.user.role === "member") return json({ error: "forbidden", message: "Only approvers or admins manage apps." }, 403);
  const body = await parseBody(req, Body);
  if (!body.ok) return body.res;
  try {
    const app = await createApp(await getDb(), { ...body.data, createdBy: auth.user.id });
    return json({ id: app.id, policyId: app.defaultPolicyId }, 201);
  } catch (e) {
    const dup = /duplicate|unique/i.test(String((e as Error).message) + String((e as { cause?: unknown }).cause ?? ""));
    return json({ error: dup ? "app_exists" : "invalid_app", message: dup ? "An app with this id already exists." : (e as Error).message }, dup ? 409 : 400);
  }
}
