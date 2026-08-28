import { canonicalSha256 } from "@/lib/evidence/digest";
import {
  FALLBACK_RUNNER_IMPLEMENTATION_MANIFEST,
  fallbackRunnerImplementationHash
} from "@/lib/fallback/implementation-contract";
import { ToolProofFallbackLabPageAdapter } from "@/lib/fallback/lab-page-adapter.server";
import { FallbackNativeWebMcpBridge } from "@/lib/fallback/native-webmcp-bridge";
import {
  createPinnedFallbackLaunchPlan,
  launchPinnedFallbackTrial
} from "@/lib/fallback/pinned-browser-runtime.server";
import { FALLBACK_UPSTREAM_PIN, fallbackRunnerContractHash } from "@/lib/fallback/runner-contract";
import { PROBE_PRODUCTION_ORIGIN } from "@/lib/probe/policy";

const DEFAULT_EXECUTABLE = "/var/tmp/toolproof-cft-151.0.7922.47/chrome-linux64/chrome";

async function main(): Promise<void> {
  const launchPlan = await createPinnedFallbackLaunchPlan({
    executablePath: process.env.TOOLPROOF_FALLBACK_CHROME_PATH?.trim() || DEFAULT_EXECUTABLE,
    executableSha256: FALLBACK_UPSTREAM_PIN.chromeExecutableSha256,
    targetOrigin: `${PROBE_PRODUCTION_ORIGIN}/`
  });
  const trial = await launchPinnedFallbackTrial(launchPlan);
  try {
    const adapter = new ToolProofFallbackLabPageAdapter();
    const before = await adapter.resetAndVerify({ page: trial.page, stage: "before" });
    const bridge = await FallbackNativeWebMcpBridge.discover({
      page: trial.page,
      targetOrigin: launchPlan.targetOrigin,
      expectedManifest: before.expectedManifest,
      readinessManifestHash: before.manifestHash,
      registrationGeneration: before.registrationGeneration
    });
    try {
      const receipt = await bridge.executeOnce({
        toolName: "cart_get",
        arguments: {},
        manifestHash: before.manifestHash,
        registrationGeneration: before.registrationGeneration,
        timeoutMs: 20_000,
        holdConsumerCall: (hold) =>
          adapter.holdConsumerCall({
            page: trial.page,
            toolName: hold.toolName,
            registrationGeneration: hold.registrationGeneration
          }),
        terminateTrial: (reason) => trial.terminate(reason)
      });
      if (receipt.outcome !== "Completed") throw new Error("fallback_native_smoke_failed");
      const after = await adapter.resetAndVerify({ page: trial.page, stage: "after" });
      const evidence = Object.freeze({
        version: "toolproof-fallback-native-smoke@1.1.0",
        proofClass: "local-native-plumbing-only",
        providerCallCount: 0,
        implementation: FALLBACK_RUNNER_IMPLEMENTATION_MANIFEST,
        implementationHash: await fallbackRunnerImplementationHash(),
        runnerContractHash: await fallbackRunnerContractHash(),
        planHash: launchPlan.planHash,
        runtimeContractHash: launchPlan.runtimeContractHash,
        archiveSha256: FALLBACK_UPSTREAM_PIN.chromeArchiveSha256,
        executableSha256: trial.runtimeReceipt.executableSha256,
        browserVersion: trial.runtimeReceipt.browserVersion,
        manifestHash: before.manifestHash,
        catalogDigest: bridge.catalog.catalogDigest,
        toolNames: bridge.catalog.toolNames,
        outcome: receipt.outcome,
        nativeCallCount: receipt.nativeCallCount,
        argumentHash: receipt.arguments.sha256,
        rawResult: receipt.rawResult,
        resetBefore: before.resetId,
        resetAfter: after.resetId,
        foreignRequestObserved: trial.runtimeReceipt.foreignRequestObserved,
        unexpectedTargetObserved: trial.runtimeReceipt.unexpectedTargetObserved,
        additionalTargetCount: trial.runtimeReceipt.additionalTargetCount
      });
      process.stdout.write(
        `${JSON.stringify({ ...evidence, evidenceDigest: await canonicalSha256(evidence) })}\n`
      );
    } finally {
      bridge.dispose();
    }
  } finally {
    await trial.close();
  }
}

void main().catch((error: unknown) => {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : null;
  process.stderr.write(`${JSON.stringify({ error: code ?? "fallback_native_smoke_failed" })}\n`);
  process.exitCode = 1;
});
