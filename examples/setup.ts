/**
 * Register the example app (tools, agents, keys) directly in the Callwrit database.
 *   npm run examples:setup        (stop `npm run dev` first when using the embedded PGlite)
 * Prints the environment variables the examples read.
 */
import { eq } from "drizzle-orm";
import { type DB, createDatabase } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { type App, createApiKey, createApp } from "@/server/integration/apps";
import * as v1 from "@/server/integration/service";

export const EXAMPLE_TOOLS = {
  read_inbox: {
    name: "read_inbox",
    description: "Read the user's inbox",
    kind: "source",
    risk: "low",
    inputSchema: { type: "object", properties: { folder: { type: "string", enum: ["inbox", "archive"] } }, required: ["folder"] },
  },
  send_email: {
    name: "send_email",
    description: "Send an email",
    kind: "sink",
    risk: "medium",
    destinationArg: "to",
    contentArgs: ["body"],
    inputSchema: {
      type: "object",
      properties: { to: { type: "string", format: "email" }, body: { type: "string", maxLength: 5000 } },
      required: ["to", "body"],
    },
  },
} as const;

export async function setupExamples(db: DB, appId = "examples") {
  const [existing] = await db.select().from(s.apps).where(eq(s.apps.id, appId));
  const app: App = existing ?? (await createApp(db, { id: appId, name: "Callwrit examples", createdBy: "examples-setup" }));
  const principal = { keyId: "examples-setup", app, agentId: null, scopes: ["admin" as const] };
  for (const spec of Object.values(EXAMPLE_TOOLS)) await v1.putTool(db, principal, spec.name, spec);
  await v1.putAgent(db, principal, "researcher", { name: "Researcher", allowedTools: ["read_inbox"], active: true });
  await v1.putAgent(db, principal, "writer", { name: "Writer", allowedTools: ["send_email"], active: true });
  await v1.putAgent(db, principal, "mcp-desktop", { name: "MCP gateway", allowedTools: ["read_inbox", "send_email"], active: true });
  const key = (scopes: ("check" | "verify" | "admin")[], name: string) =>
    createApiKey(db, { appId, name, scopes, createdBy: "examples-setup" }).then((k) => k.key);
  return { CALLWRIT_API_KEY: await key(["check"], "examples-runtime"), CALLWRIT_VERIFY_KEY: await key(["verify"], "examples-tools") };
}

if (process.argv[1]?.endsWith("setup.ts")) {
  createDatabase()
    .then((db) => setupExamples(db))
    .then((env) => {
      console.log("# export these, then run an example (CALLWRIT_URL defaults to http://localhost:3000)");
      for (const [k, v] of Object.entries(env)) console.log(`${k}=${v}`);
      process.exit(0);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
