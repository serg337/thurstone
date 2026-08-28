import { canonicalJson } from "@/lib/evidence/digest";
import type {
  FallbackNativeCatalogReceipt,
  FallbackNativeExecutionReceipt
} from "@/lib/fallback/native-webmcp-bridge";
import { FallbackNativeWebMcpBridge } from "@/lib/fallback/native-webmcp-bridge";
import {
  launchPinnedFallbackTrial,
  type FallbackBrowserLaunchPlan,
  type PinnedFallbackTrialBrowser
} from "@/lib/fallback/pinned-browser-runtime.server";
import type { ProbeLiveManifest } from "@/lib/probe/calibration-envelope";
import {
  runProbeClientTrial,
  type ProbeBoundaryEvidence,
  type ProbeClientCompletionInput,
  type ProbeClientTrialCapture,
  type ProbeClientTrialResult,
  type ProbeInitialBoundaryBinding,
  type ProbeLiveInitialBoundary,
  type ProbeOpaqueClaim,
  type ProbePublicClaim,
  type ProbeVerifiedInitialBoundary
} from "@/lib/probe/client-runner";
import type { Page } from "puppeteer-core";

export const FALLBACK_TRIAL_RUNNER_VERSION = "toolproof-fallback-trial-runner@1.0.0";

export interface FallbackBoundarySource<TResetReceipt> extends ProbeInitialBoundaryBinding {
  readonly resetId: string;
  readonly resetReceipt: TResetReceipt;
  readonly expectedManifest: ProbeLiveManifest;
}

export interface FallbackLiveBoundarySource extends ProbeInitialBoundaryBinding {
  readonly expectedManifest: ProbeLiveManifest;
}

export interface FallbackPageAdapter<TResetReceipt, TEvidence> {
  resetAndVerify(input: {
    readonly page: Page;
    readonly stage: "before" | "after";
  }): Promise<FallbackBoundarySource<TResetReceipt>>;
  reverifyLive(input: {
    readonly page: Page;
    readonly claim: ProbePublicClaim;
    readonly initialBoundary: ProbeInitialBoundaryBinding;
  }): Promise<FallbackLiveBoundarySource>;
  holdConsumerCall(input: {
    readonly page: Page;
    readonly toolName: string;
    readonly registrationGeneration: number;
  }): Promise<() => Promise<void>>;
  capture(input: {
    readonly page: Page;
    readonly capture: ProbeClientTrialCapture<TResetReceipt, FallbackNativeExecutionReceipt>;
    readonly nativeReceipt: FallbackNativeExecutionReceipt | null;
    readonly catalog: FallbackNativeCatalogReceipt;
    readonly runtime: PinnedFallbackTrialBrowser["runtimeReceipt"];
  }): Promise<TEvidence>;
}

export interface FallbackServerAdapter<TAuthorization, TResetReceipt, TEvidence, TSeal> {
  issueOpaqueClaim(input: {
    readonly initialBoundary: ProbeBoundaryEvidence<TResetReceipt>;
    readonly liveManifest: ProbeLiveManifest;
  }): Promise<ProbeOpaqueClaim<TAuthorization>>;
  requestFreshDecision(input: {
    readonly claim: ProbeOpaqueClaim<TAuthorization>;
    readonly initialBoundary: ProbeBoundaryEvidence<TResetReceipt>;
  }): Promise<unknown>;
  admitNative(input: {
    readonly claim: ProbePublicClaim;
    readonly toolName: string;
    readonly manifestHash: string;
    readonly registrationGeneration: number;
  }): Promise<void>;
  completeAndSeal(input: ProbeClientCompletionInput<TResetReceipt, TEvidence>): Promise<TSeal>;
}

interface NativeBridgeLike {
  readonly catalog: FallbackNativeCatalogReceipt;
  readonly liveManifest: ProbeLiveManifest;
  verifyStillCurrent(): Promise<FallbackNativeCatalogReceipt>;
  executeOnce(
    input: Parameters<FallbackNativeWebMcpBridge["executeOnce"]>[0]
  ): Promise<FallbackNativeExecutionReceipt>;
  dispose(): void;
}

export class FallbackNativeTrialError extends Error {
  readonly code: string;
  readonly nativeCallMade = true;
  readonly rawResult: string;

  constructor(readonly receipt: FallbackNativeExecutionReceipt) {
    super(`Native fallback execution ended with ${receipt.outcome}.`);
    this.name = "FallbackNativeTrialError";
    this.code = `native_${receipt.outcome.toLowerCase()}`;
    this.rawResult = canonicalJson(receipt);
  }
}

function publicTools(manifest: ProbeLiveManifest) {
  return Object.freeze(manifest.tools.map(({ name }) => Object.freeze({ name })));
}

function sameBoundary(source: FallbackLiveBoundarySource, catalog: FallbackNativeCatalogReceipt) {
  return (
    source.manifestHash === catalog.manifestHash &&
    source.registrationGeneration === catalog.registrationGeneration &&
    source.expectedManifest.manifestHash === catalog.manifestHash
  );
}

export async function runPinnedFallbackTrial<
  TAuthorization,
  TResetReceipt,
  TEvidence,
  TSeal
>(input: {
  readonly launchPlan: FallbackBrowserLaunchPlan;
  readonly pageAdapter: FallbackPageAdapter<TResetReceipt, TEvidence>;
  readonly serverAdapter: FallbackServerAdapter<TAuthorization, TResetReceipt, TEvidence, TSeal>;
  readonly launchTrial?: (plan: FallbackBrowserLaunchPlan) => Promise<PinnedFallbackTrialBrowser>;
  readonly discoverBridge?: (
    input: Parameters<typeof FallbackNativeWebMcpBridge.discover>[0]
  ) => Promise<NativeBridgeLike>;
  readonly nowMs?: () => number;
}): Promise<ProbeClientTrialResult<TSeal>> {
  const launchTrial = input.launchTrial ?? launchPinnedFallbackTrial;
  const discoverBridge = input.discoverBridge ?? FallbackNativeWebMcpBridge.discover;
  const trial = await launchTrial(input.launchPlan);
  const bridgeHolder: { current: NativeBridgeLike | null } = { current: null };
  let initialCatalog: FallbackNativeCatalogReceipt | null = null;
  let nativeReceipt: FallbackNativeExecutionReceipt | null = null;
  try {
    return await runProbeClientTrial({
      waitAndVerifyCleanInitial: async ({ stage }) => {
        const source = await input.pageAdapter.resetAndVerify({ page: trial.page, stage });
        bridgeHolder.current?.dispose();
        bridgeHolder.current = await discoverBridge({
          page: trial.page,
          targetOrigin: input.launchPlan.targetOrigin,
          expectedManifest: source.expectedManifest,
          readinessManifestHash: source.manifestHash,
          registrationGeneration: source.registrationGeneration
        });
        if (stage === "before") initialCatalog = bridgeHolder.current.catalog;
        return Object.freeze({
          ...source,
          tools: publicTools(source.expectedManifest)
        }) as ProbeVerifiedInitialBoundary<{ readonly name: string }, TResetReceipt>;
      },
      issueOpaqueClaim: async ({ initialBoundary }) => {
        const bridge = bridgeHolder.current;
        if (!bridge) throw new Error("fallback_bridge_unavailable");
        return input.serverAdapter.issueOpaqueClaim({
          initialBoundary,
          liveManifest: bridge.liveManifest
        });
      },
      requestFreshDecision: (request) => input.serverAdapter.requestFreshDecision(request),
      reverifyLiveInitial: async ({ claim, initialBoundary }) => {
        const bridge = bridgeHolder.current;
        if (!bridge || !initialCatalog) throw new Error("fallback_bridge_unavailable");
        const source = await input.pageAdapter.reverifyLive({
          page: trial.page,
          claim,
          initialBoundary
        });
        const catalog = await bridge.verifyStillCurrent();
        if (
          !sameBoundary(source, catalog) ||
          catalog.catalogDigest !== initialCatalog.catalogDigest
        ) {
          throw new Error("fallback_live_boundary_drift");
        }
        return Object.freeze({
          ...source,
          tools: publicTools(source.expectedManifest)
        }) as ProbeLiveInitialBoundary<{ readonly name: string }>;
      },
      executeOnce: async ({
        claim,
        tool,
        arguments: argumentsValue,
        manifestHash,
        registrationGeneration
      }) => {
        const bridge = bridgeHolder.current;
        if (!bridge) throw new Error("fallback_bridge_unavailable");
        await input.serverAdapter.admitNative({
          claim,
          toolName: tool.name,
          manifestHash,
          registrationGeneration
        });
        nativeReceipt = await bridge.executeOnce({
          toolName: tool.name,
          arguments: argumentsValue,
          manifestHash,
          registrationGeneration,
          timeoutMs: 20_000,
          holdConsumerCall: (hold) =>
            input.pageAdapter.holdConsumerCall({
              page: trial.page,
              toolName: hold.toolName,
              registrationGeneration: hold.registrationGeneration
            }),
          terminateTrial: async (reason) => trial.terminate(reason),
          ...(input.nowMs ? { nowMs: input.nowMs } : {})
        });
        if (nativeReceipt.outcome !== "Completed") {
          throw new FallbackNativeTrialError(nativeReceipt);
        }
        return nativeReceipt;
      },
      captureCurrentTrialEvidence: async (capture) => {
        if (!initialCatalog) throw new Error("fallback_catalog_unavailable");
        return input.pageAdapter.capture({
          page: trial.page,
          capture,
          nativeReceipt,
          catalog: initialCatalog,
          runtime: trial.runtimeReceipt
        });
      },
      completeAndSeal: async (completion) => {
        if (
          trial.runtimeReceipt.foreignRequestObserved ||
          trial.runtimeReceipt.unexpectedTargetObserved ||
          trial.runtimeReceipt.additionalTargetCount !== 0
        ) {
          throw new Error("fallback_runtime_boundary_changed_before_seal");
        }
        return input.serverAdapter.completeAndSeal(completion);
      },
      discardTransientReferences: () => bridgeHolder.current?.dispose(),
      ...(input.nowMs ? { nowMs: input.nowMs } : {})
    });
  } finally {
    bridgeHolder.current?.dispose();
    await trial.close();
  }
}
