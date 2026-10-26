import { defineConfig } from "@playwright/test";
if (process.env.CI)
  throw new Error("E2E tests run locally only, by owner policy.");
export default defineConfig({
  testDir: "tests/browser",
  ...(process.env.NORMAL_ACCOUNTS_TEST
    ? { testMatch: "normal-accounts.spec.ts" }
    : { testIgnore: "normal-accounts.spec.ts" }),
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4322",
    viewport: { width: 1440, height: 1050 },
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH ?? "/usr/local/bin/chromium",
    },
  },
  webServer: {
    command: "node ../scripts/e2e-server.mjs",
    url: "http://127.0.0.1:4322",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
