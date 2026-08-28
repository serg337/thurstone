import { describe, expect, it } from "vitest";

import {
  FallbackBrowserRuntimeError,
  createPinnedFallbackLaunchPlan
} from "@/lib/fallback/pinned-browser-runtime.server";
import { FALLBACK_UPSTREAM_PIN } from "@/lib/fallback/runner-contract";

describe("pinned fallback browser launch contract", () => {
  it("uses only an explicit binary, CDP, and the WebMCP feature flag", async () => {
    const plan = await createPinnedFallbackLaunchPlan({
      executablePath: "/var/tmp/toolproof-chrome/151.0.7922.47/chrome",
      executableSha256: FALLBACK_UPSTREAM_PIN.chromeExecutableSha256,
      targetOrigin: "https://toolproof-rust.vercel.app/"
    });
    expect(plan).toMatchObject({
      targetOrigin: "https://toolproof-rust.vercel.app",
      targetUrl: "https://toolproof-rust.vercel.app/lab",
      launchOptions: {
        executablePath: "/var/tmp/toolproof-chrome/151.0.7922.47/chrome",
        headless: true,
        protocol: "cdp",
        args: ["--enable-features=WebMCP"]
      }
    });
    expect(plan.planHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(plan)).not.toMatch(/channel|no-sandbox|disable-setuid|expected/iu);
  });

  it("rejects relative binaries, mutable origins, credentials, and loose timeouts", async () => {
    const base = {
      executablePath: "/var/tmp/toolproof-chrome/chrome",
      executableSha256: FALLBACK_UPSTREAM_PIN.chromeExecutableSha256,
      targetOrigin: "https://toolproof-rust.vercel.app/"
    };
    for (const candidate of [
      { ...base, executablePath: "chrome" },
      { ...base, executableSha256: "not-a-hash" },
      { ...base, targetOrigin: "http://toolproof-rust.vercel.app/" },
      { ...base, targetOrigin: "https://user:pass@toolproof-rust.vercel.app/" },
      { ...base, targetOrigin: "https://toolproof-rust.vercel.app/lab" },
      { ...base, targetOrigin: "https://example.com/" },
      { ...base, executableSha256: "b".repeat(64) },
      { ...base, navigationTimeoutMs: 60_000 }
    ]) {
      await expect(createPinnedFallbackLaunchPlan(candidate)).rejects.toBeInstanceOf(
        FallbackBrowserRuntimeError
      );
    }
  });
});
