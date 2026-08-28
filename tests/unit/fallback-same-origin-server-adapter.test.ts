import { describe, expect, it, vi } from "vitest";

import {
  FALLBACK_CALIBRATION_ENVELOPE_VERSION,
  type FallbackCalibrationEnvelope
} from "@/lib/fallback/calibration-envelope";
import { fallbackRunnerImplementationHash } from "@/lib/fallback/implementation-contract";
import {
  ToolProofFallbackSameOriginServerAdapter,
  armAndStartFallbackBrowserSession
} from "@/lib/fallback/same-origin-server-adapter.server";
import {
  FALLBACK_IMPLEMENTATION,
  FALLBACK_RUNNER_PROMPT_VERSION,
  FALLBACK_RUNNER_SETTINGS_VERSION,
  FALLBACK_UPSTREAM_PIN
} from "@/lib/fallback/runner-contract";
import {
  PROBE_FIXTURE_SYNOPSIS_VERSION,
  PROBE_LIVE_MANIFEST_VERSION,
  createProbeTransportBinding
} from "@/lib/probe/calibration-envelope";
import type { Page } from "puppeteer-core";

function pageWith(values: readonly unknown[]) {
  const evaluate = vi.fn();
  for (const value of values) {
    evaluate.mockResolvedValueOnce({ ok: true, status: 200, value });
  }
  return { page: { evaluate } as unknown as Page, evaluate };
}

async function envelope(): Promise<FallbackCalibrationEnvelope> {
  const identity = {
    runId: `run_${"r".repeat(22)}`,
    caseId: `case_${"c".repeat(22)}`,
    trialId: `trial_${"t".repeat(22)}`
  };
  return {
    version: FALLBACK_CALIBRATION_ENVELOPE_VERSION,
    purpose: "calibration",
    buildCommit: "b".repeat(40),
    ...identity,
    naturalLanguageRequest: "What is in my cart?",
    fixture: {
      version: PROBE_FIXTURE_SYNOPSIS_VERSION,
      simulated: true,
      fixtureId: "checkout-seed-v1",
      fixtureVersion: "checkout-fixture@1.0.0",
      stateRevision: 0,
      items: [
        { itemId: "field-notebook", name: "Field notebook" },
        { itemId: "stoneware-mug", name: "Stoneware mug" }
      ],
      pendingCheckout: false
    },
    liveManifest: {
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
    },
    runner: {
      implementation: FALLBACK_IMPLEMENTATION,
      implementationHash: await fallbackRunnerImplementationHash(),
      upstreamCommit: FALLBACK_UPSTREAM_PIN.commit,
      upstreamSubtree: FALLBACK_UPSTREAM_PIN.subtree,
      promptVersion: FALLBACK_RUNNER_PROMPT_VERSION,
      promptHash: "1".repeat(64),
      settingsVersion: FALLBACK_RUNNER_SETTINGS_VERSION,
      settingsHash: "2".repeat(64),
      browserRuntimeHash: "3".repeat(64),
      toolDefinitionsHash: "4".repeat(64),
      noCallSchemaHash: "5".repeat(64),
      transport: await createProbeTransportBinding(identity)
    }
  };
}

describe("fallback same-origin server adapter", () => {
  it("arms, starts, and immediately claims one recovered document without exposing cookies", async () => {
    const start = {
      version: 1,
      protocolVersion: "toolproof-pinned-googlechromelabs-fallback-calibration@2.0.0",
      lane: "pinned-googlechromelabs-webmcp-fallback-calibration",
      csrfToken: "c".repeat(32),
      continuation: "s".repeat(32),
      buildCommit: "b".repeat(40),
      expiresAt: 1_800_000_100,
      recoveryExpiresAt: 1_800_010_000,
      inferencePerformed: false
    };
    const recovered = {
      ...start,
      status: "recovered",
      csrfToken: "d".repeat(32),
      continuation: "r".repeat(32),
      path: "/lab"
    };
    const source = pageWith([
      { ok: true, status: "armed", inferencePerformed: false },
      start,
      recovered
    ]);
    const state = await armAndStartFallbackBrowserSession({
      page: source.page,
      capability: "x".repeat(43),
      launchId: `launch_${"l".repeat(22)}`,
      documentId: `document_${"d".repeat(22)}`
    });
    expect(state).toMatchObject({
      csrfToken: "d".repeat(32),
      continuation: "r".repeat(32),
      documentId: `document_${"d".repeat(22)}`,
      path: "/lab"
    });
    expect(source.evaluate.mock.calls.map((call) => call[1].path)).toEqual([
      "/api/probe/arm",
      "/api/probe/fallback/session",
      "/api/probe/fallback/session"
    ]);
  });

  it("carries one issued claim through decision, native admission, and sealing", async () => {
    const authorizationEnvelope = await envelope();
    const issue = {
      version: "toolproof-pinned-googlechromelabs-fallback-service@1.1.0",
      protocolVersion: "toolproof-pinned-googlechromelabs-fallback-calibration@2.0.0",
      lane: "pinned-googlechromelabs-webmcp-fallback-calibration",
      status: "issued",
      runId: authorizationEnvelope.runId,
      caseId: authorizationEnvelope.caseId,
      trialId: authorizationEnvelope.trialId,
      authorization: {
        version: 1,
        probeToken: "p".repeat(32),
        envelope: authorizationEnvelope,
        continuation: "s".repeat(32)
      }
    };
    const decision = {
      context: { kind: "fresh-stateless", previousResponseId: null, providerRequestCount: 1 },
      rawModelResponse: "{}",
      providerReceipt: { signed: true },
      decision: { kind: "call", tool: "cart_get", arguments: {} }
    };
    const completed = {
      version: "toolproof-pinned-googlechromelabs-fallback-service@1.1.0",
      protocolVersion: "toolproof-pinned-googlechromelabs-fallback-calibration@2.0.0",
      lane: "pinned-googlechromelabs-webmcp-fallback-calibration",
      status: "sealed",
      continuation: "n".repeat(32),
      completedCount: 1,
      terminal: false
    };
    const source = pageWith([
      issue,
      decision,
      { status: "admitted", jti: `jti_${"j".repeat(22)}`, inferencePerformed: false },
      completed
    ]);
    const adapter = new ToolProofFallbackSameOriginServerAdapter(source.page, {
      csrfToken: "c".repeat(32),
      continuation: "s".repeat(32),
      buildCommit: "b".repeat(40),
      expiresAt: 1_800_000_100,
      recoveryExpiresAt: 1_800_010_000,
      documentId: `document_${"d".repeat(22)}`,
      path: "/lab"
    });
    const initialBoundary = {
      status: "verified" as const,
      catalogState: "initial" as const,
      fixtureId: "checkout-seed-v1",
      fixtureSeed: "toolproof-checkout-seed-001",
      stateRevision: 0 as const,
      stateHash: "6".repeat(64),
      manifestHash: authorizationEnvelope.liveManifest.manifestHash,
      registrationGeneration: 1,
      operationLedgerCount: 0 as const,
      currentTrajectoryCount: 0 as const,
      resetId: `reset_${"z".repeat(22)}`,
      resetReceipt: {},
      registeredToolNames: ["cart_get"]
    };
    const claim = await adapter.issueOpaqueClaim({
      initialBoundary,
      liveManifest: authorizationEnvelope.liveManifest
    });
    await adapter.requestFreshDecision({ claim });
    await adapter.admitNative({
      claim,
      toolName: "cart_get",
      manifestHash: authorizationEnvelope.liveManifest.manifestHash,
      registrationGeneration: 1
    });
    const seal = await adapter.completeAndSeal({
      runnerVersion: "toolproof-probe-client-runner@2.0.0",
      claim,
      terminalStatus: "call_completed",
      nativeDispatchCount: 1,
      evidence: {},
      postResetBoundary: initialBoundary
    });
    expect(seal).toEqual(completed);
    expect(adapter.sessionState().continuation).toBe("n".repeat(32));
    expect(source.evaluate.mock.calls[2]?.[1].body.initialBoundary).toEqual(initialBoundary);
    expect(source.evaluate).toHaveBeenCalledTimes(4);
  });

  it("preserves a known null decision for deterministic failed-row sealing", async () => {
    const authorizationEnvelope = await envelope();
    const issue = {
      version: "toolproof-pinned-googlechromelabs-fallback-service@1.1.0",
      protocolVersion: "toolproof-pinned-googlechromelabs-fallback-calibration@2.0.0",
      lane: "pinned-googlechromelabs-webmcp-fallback-calibration",
      status: "issued",
      runId: authorizationEnvelope.runId,
      caseId: authorizationEnvelope.caseId,
      trialId: authorizationEnvelope.trialId,
      authorization: {
        version: 1,
        probeToken: "p".repeat(32),
        envelope: authorizationEnvelope,
        continuation: "s".repeat(32)
      }
    };
    const knownFailure = {
      context: { kind: "fresh-stateless", previousResponseId: null, providerRequestCount: 1 },
      rawModelResponse: "{}",
      providerReceipt: { signed: true },
      decision: null
    };
    const source = pageWith([issue, knownFailure]);
    const adapter = new ToolProofFallbackSameOriginServerAdapter(source.page, {
      csrfToken: "c".repeat(32),
      continuation: "s".repeat(32),
      buildCommit: "b".repeat(40),
      expiresAt: 1_800_000_100,
      recoveryExpiresAt: 1_800_010_000,
      documentId: `document_${"d".repeat(22)}`,
      path: "/lab"
    });
    const claim = await adapter.issueOpaqueClaim({
      initialBoundary: {
        status: "verified",
        catalogState: "initial",
        fixtureId: "checkout-seed-v1",
        fixtureSeed: "toolproof-checkout-seed-001",
        stateRevision: 0,
        stateHash: "6".repeat(64),
        manifestHash: authorizationEnvelope.liveManifest.manifestHash,
        registrationGeneration: 1,
        operationLedgerCount: 0,
        currentTrajectoryCount: 0,
        resetId: `reset_${"z".repeat(22)}`,
        resetReceipt: {},
        registeredToolNames: ["cart_get"]
      },
      liveManifest: authorizationEnvelope.liveManifest
    });
    await expect(adapter.requestFreshDecision({ claim })).resolves.toMatchObject({
      decision: null,
      providerReceipt: { signed: true }
    });
  });
});
