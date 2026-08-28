/*
 * Copyright 2026 Google LLC
 * Modifications Copyright 2026 Sergio Valencia
 * SPDX-License-Identifier: Apache-2.0
 *
 * Derived from the explicit Puppeteer launch pattern in GoogleChromeLabs/webmcp-tools
 * webmcp-evals/src/evaluator/browser.ts at commit
 * bcb6e93939d7fcf05747ccde913ed77a688e3b94. ToolProof removes channel lookup and
 * --no-sandbox flags, pins CDP and an executable hash, isolates every trial profile, and enforces
 * a single-origin request boundary.
 */

import "server-only";

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { canonicalSha256 } from "@/lib/evidence/digest";
import { FALLBACK_BROWSER_RUNTIME_VERSION } from "@/lib/fallback/implementation-contract";
import {
  FALLBACK_BROWSER_RUNTIME_CONTRACT,
  FALLBACK_UPSTREAM_PIN,
  fallbackBrowserRuntimeContractHash
} from "@/lib/fallback/runner-contract";
import { PROBE_PRODUCTION_ORIGIN } from "@/lib/probe/policy";
import puppeteer, {
  type Browser,
  type BrowserContext,
  type Page,
  type Target
} from "puppeteer-core";

export { FALLBACK_BROWSER_RUNTIME_VERSION } from "@/lib/fallback/implementation-contract";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export class FallbackBrowserRuntimeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "FallbackBrowserRuntimeError";
  }
}

export interface FallbackBrowserLaunchPlan {
  readonly version: typeof FALLBACK_BROWSER_RUNTIME_VERSION;
  readonly executablePath: string;
  readonly executableSha256: string;
  readonly targetOrigin: string;
  readonly targetUrl: string;
  readonly navigationTimeoutMs: number;
  readonly runtimeContractHash: string;
  readonly launchOptions: Readonly<{
    readonly executablePath: string;
    readonly headless: true;
    readonly protocol: "cdp";
    readonly args: readonly string[];
  }>;
  readonly planHash: string;
}

function productionOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new FallbackBrowserRuntimeError("invalid_target_origin");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new FallbackBrowserRuntimeError("invalid_target_origin");
  }
  return parsed.origin;
}

export async function createPinnedFallbackLaunchPlan(input: {
  readonly executablePath: string;
  readonly executableSha256: string;
  readonly targetOrigin: string;
  readonly navigationTimeoutMs?: number;
}): Promise<FallbackBrowserLaunchPlan> {
  if (!path.isAbsolute(input.executablePath) || !SHA256_PATTERN.test(input.executableSha256)) {
    throw new FallbackBrowserRuntimeError("invalid_browser_pin");
  }
  const targetOrigin = productionOrigin(input.targetOrigin);
  if (
    input.executableSha256 !== FALLBACK_UPSTREAM_PIN.chromeExecutableSha256 ||
    targetOrigin !== PROBE_PRODUCTION_ORIGIN
  ) {
    throw new FallbackBrowserRuntimeError("browser_launch_pin_mismatch");
  }
  const navigationTimeoutMs =
    input.navigationTimeoutMs ?? FALLBACK_BROWSER_RUNTIME_CONTRACT.navigationTimeoutMs;
  if (navigationTimeoutMs !== FALLBACK_BROWSER_RUNTIME_CONTRACT.navigationTimeoutMs) {
    throw new FallbackBrowserRuntimeError("invalid_navigation_timeout");
  }
  const launchOptions = Object.freeze({
    executablePath: input.executablePath,
    headless: FALLBACK_BROWSER_RUNTIME_CONTRACT.headless,
    protocol: FALLBACK_BROWSER_RUNTIME_CONTRACT.protocol,
    args: FALLBACK_BROWSER_RUNTIME_CONTRACT.args
  });
  const base: Omit<FallbackBrowserLaunchPlan, "planHash"> = {
    version: FALLBACK_BROWSER_RUNTIME_VERSION,
    executablePath: input.executablePath,
    executableSha256: input.executableSha256,
    targetOrigin,
    targetUrl: `${targetOrigin}${FALLBACK_BROWSER_RUNTIME_CONTRACT.targetPath}`,
    navigationTimeoutMs,
    runtimeContractHash: await fallbackBrowserRuntimeContractHash(),
    launchOptions
  };
  return Object.freeze({ ...base, planHash: await canonicalSha256(base) });
}

async function fileSha256(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function verifiedExecutable(plan: FallbackBrowserLaunchPlan): Promise<void> {
  const metadata = await lstat(plan.executablePath).catch(() => null);
  if (
    !metadata?.isFile() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o111) === 0 ||
    (await realpath(plan.executablePath)) !== plan.executablePath ||
    (await fileSha256(plan.executablePath)) !== plan.executableSha256
  ) {
    throw new FallbackBrowserRuntimeError("browser_binary_mismatch");
  }
}

function permittedRequest(targetOrigin: string, requestUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "data:" || parsed.protocol === "blob:" || parsed.origin === targetOrigin
  );
}

export interface PinnedFallbackTrialBrowser {
  readonly browser: Browser;
  readonly page: Page;
  readonly runtimeReceipt: {
    readonly version: typeof FALLBACK_BROWSER_RUNTIME_VERSION;
    readonly planHash: string;
    readonly runtimeContractHash: string;
    readonly executableSha256: string;
    readonly browserVersion: string;
    readonly puppeteerCore: "25.4.0";
    readonly chromeForTesting: "151.0.7922.47";
    readonly protocol: "cdp";
    readonly targetOrigin: string;
    readonly targetUrl: string;
    readonly isolatedProcess: true;
    readonly foreignRequestObserved: boolean;
    readonly unexpectedTargetObserved: boolean;
    readonly additionalTargetCount: number;
  };
  terminate(reason: string): Promise<void>;
  close(): Promise<void>;
}

export async function launchPinnedFallbackTrial(
  plan: FallbackBrowserLaunchPlan,
  dependencies: {
    readonly launch?: typeof puppeteer.launch;
    readonly temporaryRoot?: string;
  } = {}
): Promise<PinnedFallbackTrialBrowser> {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    throw new FallbackBrowserRuntimeError("root_browser_forbidden");
  }
  await verifiedExecutable(plan);
  const temporaryRoot = dependencies.temporaryRoot ?? tmpdir();
  if (!path.isAbsolute(temporaryRoot)) {
    throw new FallbackBrowserRuntimeError("invalid_temporary_root");
  }
  const profilePath = await mkdtemp(path.join(temporaryRoot, "toolproof-fallback-"));
  const launch = dependencies.launch ?? puppeteer.launch.bind(puppeteer);
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let onTargetCreated: ((target: Target) => void) | null = null;
  let allowedTargets: ReadonlySet<Target> = new Set();
  let closed = false;
  let foreignRequestObserved = false;
  let unexpectedTargetObserved = false;
  const cleanup = async () => {
    if (closed) return;
    closed = true;
    if (context && onTargetCreated) context.off("targetcreated", onTargetCreated);
    await browser?.close().catch(() => undefined);
    await rm(profilePath, { recursive: true, force: true });
  };
  try {
    browser = await launch({
      ...plan.launchOptions,
      args: [...plan.launchOptions.args],
      userDataDir: profilePath
    });
    const pages = await browser.pages();
    const page = pages[0] ?? (await browser.newPage());
    context = page.browserContext();
    const initialTargets = context.targets();
    const initialPageTargets = initialTargets.filter((target) => target.type() === "page");
    if (
      initialPageTargets.length !== 1 ||
      initialPageTargets[0] !== page.target() ||
      initialTargets.some((target) => target.type() !== "page" && target.type() !== "browser")
    ) {
      throw new FallbackBrowserRuntimeError("unexpected_initial_browser_target");
    }
    allowedTargets = new Set(initialTargets);
    onTargetCreated = (target) => {
      if (allowedTargets.has(target)) return;
      unexpectedTargetObserved = true;
      void cleanup();
    };
    context.on("targetcreated", onTargetCreated);
    await page.setCacheEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (permittedRequest(plan.targetOrigin, request.url())) {
        void request.continue().catch(() => undefined);
      } else {
        foreignRequestObserved = true;
        void request.abort("blockedbyclient").catch(() => undefined);
      }
    });
    await page.goto(plan.targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: plan.navigationTimeoutMs
    });
    if (new URL(page.url()).origin !== plan.targetOrigin) {
      throw new FallbackBrowserRuntimeError("target_navigation_drift");
    }
    const browserVersion = await browser.version();
    if (browserVersion !== `Chrome/${FALLBACK_UPSTREAM_PIN.chromeForTesting}`) {
      throw new FallbackBrowserRuntimeError("browser_version_mismatch");
    }
    const runtimeReceipt: PinnedFallbackTrialBrowser["runtimeReceipt"] = {
      version: FALLBACK_BROWSER_RUNTIME_VERSION,
      planHash: plan.planHash,
      runtimeContractHash: plan.runtimeContractHash,
      executableSha256: plan.executableSha256,
      browserVersion,
      puppeteerCore: FALLBACK_UPSTREAM_PIN.puppeteerCore,
      chromeForTesting: FALLBACK_UPSTREAM_PIN.chromeForTesting,
      protocol: FALLBACK_UPSTREAM_PIN.protocol,
      targetOrigin: plan.targetOrigin,
      targetUrl: plan.targetUrl,
      isolatedProcess: true as const,
      get foreignRequestObserved() {
        return foreignRequestObserved;
      },
      get unexpectedTargetObserved() {
        return unexpectedTargetObserved;
      },
      get additionalTargetCount() {
        return context
          ? context.targets().filter((target) => !allowedTargets.has(target)).length
          : 0;
      }
    };
    return Object.freeze({
      browser,
      page,
      runtimeReceipt,
      terminate: async (reason: string) => {
        if (!reason.trim()) throw new FallbackBrowserRuntimeError("invalid_termination_reason");
        await cleanup();
      },
      close: cleanup
    });
  } catch (error) {
    await cleanup();
    throw error;
  }
}
