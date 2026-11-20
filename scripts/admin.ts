/**
 * App & API key administration (uses DATABASE_URL, else the local PGlite dir).
 *
 *   npm run admin -- create-app <id> "<name>"
 *   npm run admin -- create-key <appId> <name> [--scopes check,verify,admin] [--agent <agentRef>]
 *   npm run admin -- revoke-key <appId> <keyId>
 *   npm run admin -- list
 *
 * With PGlite, stop `npm run dev` first (the embedded database allows one process).
 */
import { createDatabase } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { API_SCOPES, type ApiScope, createApiKey, createApp, revokeApiKey } from "@/server/integration/apps";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const ACTOR = "cli";

async function main() {
  const db = await createDatabase();
  switch (cmd) {
    case "create-app": {
      const [id, name] = rest;
      const app = await createApp(db, { id, name: name ?? id, createdBy: ACTOR });
      console.log(`App "${app.id}" created with starter policy "${app.defaultPolicyId}".`);
      break;
    }
    case "create-key": {
      const [appId, name] = rest;
      const scopes = (flag("scopes") ?? "check").split(",").map((x) => x.trim()) as ApiScope[];
      const bad = scopes.filter((x) => !API_SCOPES.includes(x));
      if (bad.length) throw new Error(`Unknown scope(s): ${bad.join(", ")} (valid: ${API_SCOPES.join(", ")})`);
      const k = await createApiKey(db, { appId, name, scopes, agentRef: flag("agent"), createdBy: ACTOR });
      console.log(`Key ${k.id} (${scopes.join(",")}) — shown once, store it as a secret:\n${k.key}`);
      break;
    }
    case "revoke-key": {
      const [appId, keyId] = rest;
      console.log((await revokeApiKey(db, appId, keyId, ACTOR)) ? "Revoked." : "No active key with that id in this app.");
      break;
    }
    case "list": {
      const apps = await db.select().from(s.apps);
      const keys = await db.select({ id: s.apiKeys.id, appId: s.apiKeys.appId, name: s.apiKeys.name, prefix: s.apiKeys.prefix, scopes: s.apiKeys.scopes, revokedAt: s.apiKeys.revokedAt }).from(s.apiKeys);
      for (const a of apps) {
        console.log(`${a.id}  ${a.name}  policy=${a.defaultPolicyId}`);
        for (const k of keys.filter((x) => x.appId === a.id)) console.log(`   ${k.id}  ${k.prefix}…  ${k.name}  [${k.scopes.join(",")}]${k.revokedAt ? "  REVOKED" : ""}`);
      }
      break;
    }
    default:
      console.log("Commands: create-app <id> <name> | create-key <appId> <name> [--scopes a,b] [--agent ref] | revoke-key <appId> <keyId> | list");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
