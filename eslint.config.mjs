import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // SECURITY: tool executors are reachable only through the Policy Enforcement Point.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/server/enforcement/pep.ts", "src/server/bench/baseline.ts", "src/server/tools/executors.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/tools/executors", "@/server/tools/executors"],
              message: "Executors may only be called through the Policy Enforcement Point (src/server/enforcement/pep.ts).",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "drizzle/**", "playwright-report/**", "test-results/**", ".data/**", "packages/*/dist/**", "sdk/python/**"]),
]);

export default eslintConfig;
