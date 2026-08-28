import { describe, expect, it, vi } from "vitest";

import { createPinnedFallbackLaunchPlan } from "@/lib/fallback/pinned-browser-runtime.server";
import {
  FALLBACK_UPSTREAM_PIN,
  fallbackBrowserRuntimeContractHash
} from "@/lib/fallback/runner-contract";
import { runPinnedFallbackTrial } from "@/lib/fallback/trial-runner";
import {
  FALLBACK_NATIVE_BRIDGE_VERSION,
  type FallbackNativeExecutionReceipt
} from "@/lib/fallback/native-webmcp-bridge";
import {
  PROBE_LIVE_MANIFEST_VERSION,
  type ProbeLiveManifest
} from "@/lib/probe/calibration-envelope";
import type { Page } from "puppeteer-core";

function liveManifest(): ProbeLiveManifest {
  return {
    version: PROBE_LIVE_MANIFEST_VERSION,
    manifestHash: "a".repeat(64),
    tools: [
      {
        name: "cart_get",
        title: "Read cart lines",
        description: "Return current cart line-item identities and quantities.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false }
      }
    ]
  };
}

function nativeReceipt(manifestHash: string): FallbackNativeExecutionReceipt {
  return {
    version: FALLBACK_NATIVE_BRIDGE_VERSION,
    toolName: "cart_get",
    manifestHash,
    registrationGeneration: 3,
    allowanceConsumed: true,
    nativeCallCount: 1,
    arguments: { value: {}, bytes: "{}", sha256: "b".repeat(64) },
    outcome: "Completed",
    rawResult: { ok: true },
    invokedEvents: [{ id: "invoke" }],
    respondedEvents: [{ id: "invoke", status: "Completed" }],
    error: null,
    startedAt: "2026-08-28T00:00:00.000Z",
    completedAt: "2026-08-28T00:00:00.010Z",
    durationMs: 10
  };
}

async function setup(decision: unknown) {
  const order: string[] = [];
  const manifest = liveManifest();
  const close = vi.fn(async () => {
    order.push("close");
  });
  const runtimeReceipt = {
    version: "toolproof-fallback-browser-runtime@1.0.0" as const,
    planHash: "c".repeat(64),
    runtimeContractHash: await fallbackBrowserRuntimeContractHash(),
    executableSha256: FALLBACK_UPSTREAM_PIN.chromeExecutableSha256,
    browserVersion: "Chrome/151.0.7922.47",
    puppeteerCore: "25.4.0" as const,
    chromeForTesting: "151.0.7922.47" as const,
    protocol: "cdp" as const,
    targetOrigin: "https://toolproof-rust.vercel.app",
    targetUrl: "https://toolproof-rust.vercel.app/lab",
    isolatedProcess: true as const,
    foreignRequestObserved: false,
    unexpectedTargetObserved: false,
    additionalTargetCount: 0
  };
  const page = {} as Page;
  const launchTrial = vi.fn(async () => ({
    browser: {} as never,
    page,
    runtimeReceipt,
    terminate: vi.fn(async () => undefined),
    close
  }));
  const receipt = nativeReceipt(manifest.manifestHash);
  let resetCount = 0;
  const resetAndVerify = vi.fn(async ({ stage }: { stage: "before" | "after" }) => {
    order.push(`reset:${stage}`);
    resetCount += 1;
    return {
      status: "verified" as const,
      catalogState: "initial" as const,
      fixtureId: "checkout-seed-v1",
      fixtureSeed: "toolproof-checkout-seed-001",
      stateRevision: 0 as const,
      stateHash: "e".repeat(64),
      manifestHash: manifest.manifestHash,
      registrationGeneration: 3,
      operationLedgerCount: 0 as const,
      currentTrajectoryCount: 0 as const,
      resetId: `reset_${String(resetCount).padStart(16, "0")}`,
      resetReceipt: { stage },
      expectedManifest: manifest
    };
  });
  const bridge = {
    catalog: {
      version: FALLBACK_NATIVE_BRIDGE_VERSION as typeof FALLBACK_NATIVE_BRIDGE_VERSION,
      targetOrigin: "https://toolproof-rust.vercel.app",
      pageUrl: "https://toolproof-rust.vercel.app/lab",
      manifestHash: manifest.manifestHash,
      registrationGeneration: 3,
      toolNames: ["cart_get"],
      catalogDigest: "f".repeat(64),
      upstreamCommit: "bcb6e93939d7fcf05747ccde913ed77a688e3b94" as const,
      puppeteerCore: "25.4.0" as const
    },
    liveManifest: manifest,
    verifyStillCurrent: vi.fn(async () => {
      order.push("reverify-native");
      return bridge.catalog;
    }),
    executeOnce: vi.fn(async () => {
      order.push("execute-native");
      return receipt;
    }),
    dispose: vi.fn()
  };
  const discoverBridge = vi.fn(async () => bridge);
  const issueOpaqueClaim = vi.fn(async () => {
    order.push("claim");
    return {
      runId: `run_${"r".repeat(22)}`,
      caseId: `case_${"c".repeat(22)}`,
      trialId: `trial_${"t".repeat(22)}`,
      authorization: "signed"
    };
  });
  const requestFreshDecision = vi.fn(async () => {
    order.push("decision");
    return {
      context: {
        kind: "fresh-stateless",
        previousResponseId: null,
        providerRequestCount: 1
      },
      rawModelResponse: JSON.stringify(decision),
      providerReceipt: { provider: "OpenAI", providerCallCount: 1 },
      decision
    };
  });
  const reverifyLive = vi.fn(async () => {
    order.push("reverify-page");
    return {
      status: "verified" as const,
      catalogState: "initial" as const,
      fixtureId: "checkout-seed-v1",
      fixtureSeed: "toolproof-checkout-seed-001",
      stateRevision: 0 as const,
      stateHash: "e".repeat(64),
      manifestHash: manifest.manifestHash,
      registrationGeneration: 3,
      operationLedgerCount: 0 as const,
      currentTrajectoryCount: 0 as const,
      expectedManifest: manifest
    };
  });
  const admitNative = vi.fn(async () => {
    order.push("admit-native");
  });
  const capture = vi.fn(async (input) => {
    order.push("capture");
    return { terminalStatus: input.capture.terminalStatus, nativeReceipt: input.nativeReceipt };
  });
  const completeAndSeal = vi.fn(async () => {
    order.push("complete");
    return { sealed: true };
  });
  const launchPlan = await createPinnedFallbackLaunchPlan({
    executablePath: "/var/tmp/toolproof-chrome/chrome",
    executableSha256: FALLBACK_UPSTREAM_PIN.chromeExecutableSha256,
    targetOrigin: "https://toolproof-rust.vercel.app/"
  });
  return {
    order,
    launchPlan,
    launchTrial,
    discoverBridge,
    pageAdapter: { resetAndVerify, reverifyLive, capture },
    serverAdapter: { issueOpaqueClaim, requestFreshDecision, admitNative, completeAndSeal },
    bridge,
    runtimeReceipt,
    close
  };
}

describe("isolated pinned fallback trial orchestrator", () => {
  it("enforces reset, claim, decision, native admission/execution, capture, reset, seal, close", async () => {
    const source = await setup({ kind: "call", tool: "cart_get", arguments: {} });
    const result = await runPinnedFallbackTrial({
      launchPlan: source.launchPlan,
      pageAdapter: source.pageAdapter,
      serverAdapter: source.serverAdapter,
      launchTrial: source.launchTrial,
      discoverBridge: source.discoverBridge
    });
    expect(result).toMatchObject({
      status: "sealed",
      terminalStatus: "call_completed",
      nativeDispatchCount: 1,
      seal: { sealed: true }
    });
    expect(source.order).toEqual([
      "reset:before",
      "claim",
      "decision",
      "reverify-page",
      "reverify-native",
      "admit-native",
      "execute-native",
      "capture",
      "reset:after",
      "complete",
      "close"
    ]);
    expect(source.serverAdapter.admitNative).toHaveBeenCalledTimes(1);
    expect(source.bridge.executeOnce).toHaveBeenCalledTimes(1);
    expect(source.close).toHaveBeenCalledTimes(1);
  });

  it("seals clarification without native admission or execution and still resets/closes", async () => {
    const source = await setup({ kind: "clarify", text: "Which item?" });
    const result = await runPinnedFallbackTrial({
      launchPlan: source.launchPlan,
      pageAdapter: source.pageAdapter,
      serverAdapter: source.serverAdapter,
      launchTrial: source.launchTrial,
      discoverBridge: source.discoverBridge
    });
    expect(result).toMatchObject({
      status: "sealed",
      terminalStatus: "clarified",
      nativeDispatchCount: 0
    });
    expect(source.serverAdapter.admitNative).not.toHaveBeenCalled();
    expect(source.bridge.executeOnce).not.toHaveBeenCalled();
    expect(source.order).toEqual([
      "reset:before",
      "claim",
      "decision",
      "reverify-page",
      "reverify-native",
      "capture",
      "reset:after",
      "complete",
      "close"
    ]);
  });

  it("refuses to seal when the isolated runtime boundary changes after capture", async () => {
    const source = await setup({ kind: "clarify", text: "Which item?" });
    source.runtimeReceipt.foreignRequestObserved = true;
    await expect(
      runPinnedFallbackTrial({
        launchPlan: source.launchPlan,
        pageAdapter: source.pageAdapter,
        serverAdapter: source.serverAdapter,
        launchTrial: source.launchTrial,
        discoverBridge: source.discoverBridge
      })
    ).rejects.toThrowError(/completion:completion_failed/u);
    expect(source.serverAdapter.completeAndSeal).not.toHaveBeenCalled();
    expect(source.close).toHaveBeenCalledTimes(1);
  });

  it("preserves the server-adapter receiver through decision dispatch", async () => {
    const source = await setup({ kind: "clarify", text: "Which item?" });
    const contextBound = {
      receiver: "retained",
      issueOpaqueClaim(input: unknown) {
        void input;
        return source.serverAdapter.issueOpaqueClaim();
      },
      requestFreshDecision(input: unknown) {
        void input;
        if (this.receiver !== "retained") throw new Error("server_adapter_receiver_lost");
        return source.serverAdapter.requestFreshDecision();
      },
      admitNative(input: unknown) {
        void input;
        return source.serverAdapter.admitNative();
      },
      completeAndSeal(input: unknown) {
        void input;
        return source.serverAdapter.completeAndSeal();
      }
    };
    await expect(
      runPinnedFallbackTrial({
        launchPlan: source.launchPlan,
        pageAdapter: source.pageAdapter,
        serverAdapter: contextBound,
        launchTrial: source.launchTrial,
        discoverBridge: source.discoverBridge
      })
    ).resolves.toMatchObject({ status: "sealed", terminalStatus: "clarified" });
  });
});
