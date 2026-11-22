/**
 * /v1 latency benchmark over real HTTP (the route handlers behind a Node HTTP server).
 *   npx tsx scripts/bench-v1.ts            embedded PGlite (in-memory)
 *   npx tsx scripts/bench-v1.ts --pg       real PostgreSQL 16 (embedded-postgres, throw-away cluster)
 * Writes docs/results/v1-latency-<mode>.json and prints a table. Numbers are measured, never edited.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PG = process.argv.includes("--pg");
const N = Number(process.env.N ?? 300);
process.env.CALLWRIT_V1_RATE = "100000"; // measure latency, not the rate limiter

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const round = (x: number) => Math.round(x * 100) / 100;

async function main() {
  let stopPg: (() => Promise<void>) | undefined;
  if (PG) {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    const pg = new EmbeddedPostgres({
      databaseDir: path.resolve(`.data/pg-bench-${Date.now()}`),
      user: "callwrit",
      password: "bench-only",
      port: 54331,
      persistent: false,
      onLog: () => {},
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase("callwrit_bench");
    process.env.DATABASE_URL = "postgres://callwrit:bench-only@127.0.0.1:54331/callwrit_bench";
    stopPg = () => pg.stop();
  } else process.env.PGLITE_DIR = "memory";

  const { getDb } = await import("@/server/db/client");
  const { setupExamples } = await import("../examples/setup");
  const { startV1Server } = await import("../tests/v1-server");
  const db = await getDb();
  const { CALLWRIT_API_KEY: key } = await setupExamples(db, "bench");
  const server = await startV1Server();
  const post = async (p: string, body: unknown) => {
    const r = await fetch(server.url + p, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    return r.json() as Promise<Record<string, string>>;
  };
  const { sessionId } = await post("/v1/sessions", {
    userRef: "bench",
    agentId: "researcher",
    agents: ["writer"],
    prompt: "Read my inbox and email a summary to cfo@corp.test",
    mandate: { tools: ["read_inbox", "send_email"] },
  });
  await post(`/v1/sessions/${sessionId}/sources`, { type: "email", label: "inbox", fingerprints: ["payroll@evil.test"], signals: ["injection_suspected"] });

  const cases = {
    "ALLOW (read, issues token)": { agentId: "researcher", tool: "read_inbox", args: { folder: "inbox" }, expect: "ALLOW" },
    "BLOCK (injected destination)": { agentId: "writer", tool: "send_email", args: { to: "payroll@evil.test", body: "x" }, expect: "BLOCK" },
    "REVIEW (creates approval)": { agentId: "writer", tool: "send_email", args: { to: "cfo@corp.test", body: "x" }, expect: "REVIEW" },
  };
  const rows: Record<string, { p50: number; p95: number; p99: number; n: number }> = {};
  for (const [name, c] of Object.entries(cases)) {
    for (let i = 0; i < 20; i++) await post("/v1/check", { sessionId, ...c, expect: undefined }); // warm-up
    const times: number[] = [];
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      const r = await post("/v1/check", { sessionId, agentId: c.agentId, tool: c.tool, args: c.args });
      times.push(performance.now() - t0);
      if (r.decision !== c.expect) throw new Error(`${name}: expected ${c.expect}, got ${r.decision}`);
    }
    rows[name] = { n: N, p50: round(pct(times, 50)), p95: round(pct(times, 95)), p99: round(pct(times, 99)) };
  }
  // Throughput with 8 concurrent clients on the ALLOW path.
  const C = 8;
  const per = Math.floor(N / 2);
  const t0 = performance.now();
  await Promise.all(Array.from({ length: C }, async () => {
    for (let i = 0; i < per; i++) await post("/v1/check", { sessionId, agentId: "researcher", tool: "read_inbox", args: { folder: "inbox" } });
  }));
  const throughput = Math.round((C * per) / ((performance.now() - t0) / 1000));

  const result = {
    mode: PG ? "postgres16" : "pglite",
    machine: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, ramGb: Math.round(os.totalmem() / 2 ** 30), node: process.version, platform: process.platform },
    measuredAt: new Date().toISOString(),
    note: "Client-observed HTTP latency on localhost, sequential requests, one session with 2 sources and a growing call history.",
    latencyMs: rows,
    throughputRps: { concurrency: C, requests: C * per, value: throughput },
  };
  fs.mkdirSync("docs/results", { recursive: true });
  fs.writeFileSync(`docs/results/v1-latency-${result.mode}.json`, `${JSON.stringify(result, null, 2)}\n`);
  console.table(rows);
  console.log(`throughput (${C} concurrent clients): ${throughput} checks/s`);
  await server.close();
  await (db as unknown as { $client?: { end?: () => Promise<void> } }).$client?.end?.();
  await stopPg?.();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
