import { defineConfig, devices } from "@playwright/test";

const browserCommit = "e".repeat(40);
const browserSigningSecret = Buffer.alloc(32, 11).toString("base64url");
const gate3SourceBinding = Buffer.from(
  JSON.stringify({
    source: {
      repositoryCommit: browserCommit,
      contractSourceSha256: "1".repeat(64),
      casesSourceSha256: "2".repeat(64),
      fixtureSourceSha256: "3".repeat(64),
      manifestSourceSha256: "4".repeat(64),
      runnerSourceSha256: "5".repeat(64),
      evaluatorSourceSha256: "6".repeat(64)
    },
    canonicalizerSourceSha256: "7".repeat(64)
  })
).toString("base64url");

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
          command: `TOOLPROOF_BROWSER_FAKE_PROBE=1 TOOLPROOF_COMMIT_SHA=${browserCommit} TOOLPROOF_SIGNING_SECRET=${browserSigningSecret} TOOLPROOF_GATE3_SOURCE_BINDING_B64=${gate3SourceBinding} npm run dev`,
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
