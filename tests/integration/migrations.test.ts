import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";

/**
 * Upgrade path: a database created by the Phase 1–3 schema (0000) must migrate to the
 * multi-tenant schema without losing rows, and existing rows must land in app "demo".
 */
describe("migration 0001_external_apps", () => {
  it("upgrades a 0000 database in place and assigns existing rows to the demo app", async () => {
    const src = path.resolve(__dirname, "../../drizzle");
    const v0 = fs.mkdtempSync(path.join(os.tmpdir(), "ag-mig-"));
    fs.mkdirSync(path.join(v0, "meta"));
    fs.copyFileSync(path.join(src, "0000_init.sql"), path.join(v0, "0000_init.sql"));
    const journal = JSON.parse(fs.readFileSync(path.join(src, "meta/_journal.json"), "utf8"));
    fs.writeFileSync(path.join(v0, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, 1) }));

    const client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: v0 });
    await client.exec(`
      INSERT INTO users (id, name, email, role) VALUES ('u1', 'U', 'u@x.example', 'member');
      INSERT INTO agents (id, name, allowed_tools) VALUES ('a1', 'A', '["read_documents"]');
      INSERT INTO audit_events (id, type, severity, payload) VALUES ('e1', 'x', 'info', '{}');
    `);

    await migrate(db, { migrationsFolder: src });
    const agents = await client.query<{ id: string; app_id: string }>("SELECT id, app_id FROM agents");
    const audit = await client.query<{ app_id: string }>("SELECT app_id FROM audit_events");
    const apps = await client.query<{ id: string; default_policy_id: string }>("SELECT id, default_policy_id FROM apps");
    expect(agents.rows).toEqual([{ id: "a1", app_id: "demo" }]);
    expect(audit.rows).toEqual([{ app_id: "demo" }]);
    expect(apps.rows).toEqual([{ id: "demo", default_policy_id: "default" }]);

    // Migrating again is a no-op.
    await migrate(db, { migrationsFolder: src });
    await client.close();
    fs.rmSync(v0, { recursive: true, force: true });
  });
});
