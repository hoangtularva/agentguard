import { requireUser } from "@/server/app-context";
import { z } from "zod";
import { llmConfigured } from "@/server/agent/claude-planner";
import { runBenchmark } from "@/server/bench/harness";
import { createDatabase } from "@/server/db/client";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { exclusive, json, parseBody, sameOrigin } from "@/server/http";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({
  runs: z.number().int().min(1).max(5).default(1),
  scenarioIds: z.array(z.string().regex(/^[A-Z]\d{2}$/)).max(50).optional(),
  planner: z.enum(["simulated", "claude"]).default("simulated"),
});

/**
 * Runs the security benchmark in an ISOLATED in-memory database, so attack
 * scenarios never pollute the workspace audit log; the summary is then stored
 * in the main database for the Attack Lab history.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "forbidden_origin" }, 403);
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  // Benchmarks are CPU-heavy: restricted to approvers/admins (Phase 3 finding F7).
  if (auth.user.role === "member") return json({ error: "forbidden", message: "Only approvers or admins can run the benchmark." }, 403);
  const body = await parseBody(req, Body);
  if (!body.ok) return body.res;
  if (body.data.planner === "claude" && !llmConfigured()) return json({ error: "llm_not_configured" }, 400);
  const run = await exclusive("benchmark", async () => {
    const isolated = await createDatabase({ url: "", pgliteDir: "memory" });
    return runBenchmark(isolated, body.data);
  });
  if (!run.ok) return run.res;
  const report = run.value;
  const db = await getDb();
  await db.insert(s.benchmarkRuns).values({
    id: report.id,
    config: report.config,
    metrics: report.metrics,
    results: report.scenarios,
    durationMs: report.durationMs,
  });
  return json(report);
}
