import { defineConfig, devices } from "@playwright/test";

// Browser tests run against the synthetic local demo (`npm run demo`), never a
// deployed site. Locally an already-running demo on this port is reused.
const origin = "http://127.0.0.1:8790";

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : "list",
  use: {
    baseURL: origin,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run demo",
    url: `${origin}/api/health`,
    reuseExistingServer: !process.env.CI,
    // Lets the demo stop wrangler and release its lock instead of being killed.
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
