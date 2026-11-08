import path from "node:path";
import { defineConfig } from "vitest/config";

/** Real PostgreSQL 16 suite (official binaries via embedded-postgres). Run: npm run test:pg */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "tests/server-only-stub.ts") } },
  test: {
    include: ["tests/postgres/**/*.test.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
