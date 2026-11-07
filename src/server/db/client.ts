import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { seedDatabase } from "./seed";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

const MIGRATIONS = path.join(/* turbopackIgnore: true */ process.cwd(), "drizzle");

/**
 * Database selection:
 *  - DATABASE_URL set  -> real PostgreSQL via node-postgres (Docker Compose / production-like).
 *  - otherwise         -> embedded PGlite (PostgreSQL compiled to WASM) persisted in PGLITE_DIR,
 *                         or in-memory when PGLITE_DIR=memory (tests).
 * Both run the same Drizzle migrations, so SQL semantics (transactions, row locks,
 * unique constraints) are PostgreSQL's in every mode.
 */
export async function createDatabase(opts: { url?: string; pgliteDir?: string; seed?: boolean } = {}): Promise<DB> {
  const url = opts.url ?? process.env.DATABASE_URL;
  let db: DB;
  if (url) {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pg = await import("pg");
    const pool = new pg.default.Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
    // An idle client killed by the server (restart, pg_terminate_backend, network) emits
    // 'error' on the pool. Without a listener Node treats it as uncaught and crashes the
    // process. The pool drops the dead client and reconnects on the next query.
    pool.on("error", (err) => {
      console.error("[db] idle client error (will reconnect):", err.message);
    });
    const d = drizzle(pool, { schema });
    await migrate(d, { migrationsFolder: MIGRATIONS });
    db = d as unknown as DB;
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const dir = opts.pgliteDir ?? process.env.PGLITE_DIR ?? ".data/pglite";
    if (dir !== "memory") (await import("node:fs")).mkdirSync(path.resolve(/* turbopackIgnore: true */ dir), { recursive: true });
    const client = dir === "memory" ? new PGlite() : new PGlite(path.resolve(/* turbopackIgnore: true */ dir));
    const d = drizzle(client, { schema });
    await migrate(d, { migrationsFolder: MIGRATIONS });
    db = d as unknown as DB;
  }
  if (opts.seed !== false) await seedDatabase(db);
  return db;
}

const g = globalThis as unknown as { __agentguardDb?: Promise<DB> };

/** Process-wide database handle (survives Next.js dev hot reloads). */
export function getDb(): Promise<DB> {
  if (!g.__agentguardDb) {
    g.__agentguardDb = createDatabase().catch((e) => {
      g.__agentguardDb = undefined;
      throw e;
    });
  }
  return g.__agentguardDb;
}

export { schema };
