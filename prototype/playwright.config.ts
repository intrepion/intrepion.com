import { defineConfig } from "@playwright/test";

if (process.env.CI) throw new Error("Prototype E2E checks are local-only, per the agreed test policy.");

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4321",
    browserName: "chromium",
    launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? "/usr/local/bin/chromium" },
    viewport: { width: 1440, height: 1050 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run preview -- --ignore-lock",
    url: "http://127.0.0.1:4321",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
