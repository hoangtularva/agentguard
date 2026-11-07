import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Architectural security test: tool executors must only be reachable through the PEP.
 * The benchmark baseline (an intentionally UNGUARDED agent used for comparison) is the
 * single documented exception and lives outside the app's request paths.
 */
const ALLOWED = new Set(["src/server/enforcement/pep.ts", "src/server/bench/baseline.ts", "src/server/tools/executors.ts"]);

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

describe("enforcement boundary", () => {
  const root = path.resolve(__dirname, "../..");
  const files = walk(path.join(root, "src")).map((f) => path.relative(root, f).split(path.sep).join("/"));

  it("only the PEP (and the benchmark baseline) import tool executors", () => {
    const offenders = files.filter((f) => {
      if (ALLOWED.has(f)) return false;
      const src = fs.readFileSync(path.join(root, f), "utf8");
      return /from\s+["'][^"']*tools\/executors["']/.test(src) || /import\(\s*["'][^"']*tools\/executors["']\s*\)/.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it("client components never import server modules", () => {
    const offenders = files.filter((f) => {
      const src = fs.readFileSync(path.join(root, f), "utf8");
      return /^["']use client["']/m.test(src) && /from\s+["']@\/server\/(?!core\/(types|policy-schema|fixtures)\b)/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
