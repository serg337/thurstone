import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.TOOLPROOF_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure"
  },
  ...(process.env.TOOLPROOF_BASE_URL
    ? {}
    : {
        webServer: {
          command: "npm run dev",
          url: "http://127.0.0.1:3000/api/health",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000
        }
      }),
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "chromium-mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } }
    }
  ]
});
