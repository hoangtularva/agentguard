import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
/** Set E2E_BASE_URL to test an already-running deployment (e.g. the Docker Compose stack). */
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: external ?? `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /responsive.spec.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: external
    ? undefined
    : {
        command: `npx next dev --port ${PORT}`,
        url: `http://localhost:${PORT}`,
        timeout: 180_000,
        reuseExistingServer: false,
        env: { PGLITE_DIR: ".data/e2e", AUTH_SECRET: "e2e-only-not-a-secret-0123456789" },
      },
});
