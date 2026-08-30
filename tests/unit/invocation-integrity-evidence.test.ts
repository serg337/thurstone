import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InvocationIntegrityResults } from "@/components/results/invocation-integrity-results";
import { createCheckoutFixture, type MutationResult } from "@/lib/domain/checkout";
import { verifyCheckoutReset } from "@/lib/domain/checkout-reset";
import { CheckoutSessionStore, type CheckoutSessionIdKind } from "@/lib/domain/checkout-session";
import { canonicalSha256 } from "@/lib/evidence/digest";
import { CheckoutTraceLedger } from "@/lib/evidence/checkout-trace-ledger";
import {
  INVOCATION_INTEGRITY_FAILURE_INPUT_VERSION,
  INVOCATION_INTEGRITY_INITIAL_CATALOG,
  INVOCATION_INTEGRITY_PAYLOADS,
  INVOCATION_INTEGRITY_PENDING_CATALOG,
  INVOCATION_INTEGRITY_PREFLIGHT_VERSION,
  INVOCATION_INTEGRITY_TRANSCRIPT_VERSION,
  parseInvocationIntegrityFailureInput,
  parseInvocationIntegrityTranscript,
  projectInvocationIntegrityDescriptors,
  type InvocationIntegrityFailureReceipt,
  type InvocationIntegrityObservedCall,
  type InvocationIntegrityReceipt,
  type InvocationIntegrityTranscript
} from "@/lib/invocation-integrity/contract";
import {
  createInvocationIntegrityFailureReceipt,
  verifyInvocationIntegrityTranscript
} from "@/lib/invocation-integrity/verifier.server";
import { PROBE_PRODUCTION_ORIGIN } from "@/lib/probe/policy";
import {
  INVOCATION_INTEGRITY_POSITION,
  INVOCATION_INTEGRITY_SEMANTIC_RECORD,
  buildInvocationIntegrityEvidencePackage,
  buildInvocationIntegrityFailureEvidencePackage,
  createInvocationIntegrityEvidenceExports,
  createInvocationIntegrityReleaseBinding,
  validateInvocationIntegrityEvidencePackage,
  validateInvocationIntegrityFailureEvidencePackage,
  validateInvocationIntegritySupplementalEvidencePackage
} from "@/lib/results/invocation-integrity-evidence";
import { resolveInvocationIntegrityReleaseSha } from "@/lib/results/invocation-integrity-results.server";
import { checkoutToolContractSnapshot } from "@/lib/webmcp/catalog";
import { createCheckoutLiveManifest } from "@/lib/webmcp/live-manifest.server";

vi.mock("server-only", () => ({}));

const BUILD_SHA = "a".repeat(40);
const RELEASE_SHA = "b".repeat(40);
const USER_AGENT = "Thurstone Invocation Integrity evidence test browser";
const environment = {
  VERCEL_GIT_COMMIT_SHA: BUILD_SHA,
  TOOLPROOF_COMMIT_SHA: BUILD_SHA,
  NEXT_PUBLIC_TOOLPROOF_COMMIT_SHA: BUILD_SHA
};

function idFactory(): (kind: CheckoutSessionIdKind) => string {
  let ordinal = 0;
  return (kind) => `${kind}_evidence_test_${String(++ordinal).padStart(4, "0")}`;
}

function objectCalibrationInput(): Record<string, never> {
  const input = Object.create(null) as Record<string, never>;
  Object.defineProperty(input, Symbol.toPrimitive, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: () => "{}"
  });
  return input;
}

async function observedCall(input: {
  readonly caseId: "II-01" | "II-02" | "II-03";
  readonly callIndex: 1 | 2;
  readonly toolName: "cart_update" | "checkout_request";
  readonly payload: Readonly<Record<string, unknown>>;
  readonly store: CheckoutSessionStore;
  readonly ledger: CheckoutTraceLedger;
  readonly manifestHash: string;
}): Promise<InvocationIntegrityObservedCall> {
  const result: MutationResult =
    input.toolName === "cart_update"
      ? await input.store.cartUpdate(input.payload, { source: "native" })
      : await input.store.checkoutRequest(input.payload, { source: "native" });
  const trace = input.ledger.snapshot().current.at(-1);
  if (!trace) throw new Error("evidence test trace missing");
  return {
    caseId: input.caseId,
    callIndex: input.callIndex,
    receipt: {
      executionId: `evidence_${input.caseId.toLowerCase()}_${input.callIndex}`,
      toolName: input.toolName,
      argumentMode: "object",
      rawResult: JSON.stringify(result),
      canonicalResult: result,
      resultDigest: await canonicalSha256(result),
      nativeCallCount: 1,
      handlerTraceId: trace.eventId,
      handlerTraceStatus: trace.status,
      effectDigest: await canonicalSha256(trace.effect),
      stateBeforeDigest: trace.stateBefore.sha256,
      stateAfterDigest: trace.stateAfter.sha256,
      manifestHash: input.manifestHash
    },
    trace
  };
}

async function transcript(): Promise<InvocationIntegrityTranscript> {
  let registryHash = "unverified";
  let argumentMode: "unverified" | "object" = "unverified";
  let tick = 0;
  const ledger = new CheckoutTraceLedger({
    getRegistryHash: () => registryHash,
    getArgumentMode: () => argumentMode,
    appCommit: BUILD_SHA,
    origin: PROBE_PRODUCTION_ORIGIN,
    userAgent: USER_AGENT
  });
  const store = new CheckoutSessionStore({
    clock: () => `2026-08-30T00:00:${String(tick++).padStart(2, "0")}.000Z`,
    idFactory: idFactory(),
    traceSink: ledger
  });
  const initialManifest = await createCheckoutLiveManifest(createCheckoutFixture(), BUILD_SHA);
  registryHash = initialManifest.manifestHash;
  const initialDescriptors = projectInvocationIntegrityDescriptors(
    checkoutToolContractSnapshot(createCheckoutFixture()).manifest.map((tool) => ({
      ...tool,
      origin: PROBE_PRODUCTION_ORIGIN
    }))
  );
  const compatibilityResult = await store.cartGet(objectCalibrationInput(), { source: "native" });
  const compatibilityTrace = ledger.snapshot().current.at(-1);
  if (!compatibilityTrace || !compatibilityResult.ok) {
    throw new Error("evidence test compatibility missing");
  }
  argumentMode = "object";
  const compatibilityReceipt = {
    status: "compatibility-verified" as const,
    argumentMode: "object" as const,
    toolName: "cart_get" as const,
    nativeCallCount: 1 as const,
    coercionCount: 0 as const,
    rawResult: JSON.stringify(compatibilityResult),
    canonicalResult: compatibilityResult,
    resultDigest: await canonicalSha256(compatibilityResult),
    handlerTraceId: compatibilityTrace.eventId,
    effectDigest: await canonicalSha256(compatibilityTrace.effect),
    stateBeforeDigest: compatibilityTrace.stateBefore.sha256,
    stateAfterDigest: compatibilityTrace.stateAfter.sha256,
    manifestHashBefore: initialManifest.manifestHash,
    manifestHashAfter: initialManifest.manifestHash,
    registrationGeneration: 1
  };
  const domainResetReceipt = await store.hardReset({ source: "ui" });
  const resetLedger = ledger.snapshot();
  const resetTrace = resetLedger.lastResetTrace;
  const resetInspection = store.inspect();
  if (!resetTrace) throw new Error("evidence test reset trace missing");
  const verifiedResetReceipt = await verifyCheckoutReset({
    domainReceipt: domainResetReceipt,
    inspection: resetInspection,
    archives: store.archivedTrajectories(),
    traceLedger: resetLedger,
    registry: {
      verified: true,
      registryHash: initialManifest.manifestHash,
      registeredToolNames: INVOCATION_INTEGRITY_INITIAL_CATALOG
    },
    checkedAt: "2026-08-30T00:00:10.000Z"
  });
  if (verifiedResetReceipt.status !== "verified") throw new Error("evidence reset not verified");
  const calls: InvocationIntegrityObservedCall[] = [];
  calls.push(
    await observedCall({
      caseId: "II-01",
      callIndex: 1,
      toolName: "checkout_request",
      payload: INVOCATION_INTEGRITY_PAYLOADS["II-01"],
      store,
      ledger,
      manifestHash: initialManifest.manifestHash
    })
  );
  calls.push(
    await observedCall({
      caseId: "II-02",
      callIndex: 1,
      toolName: "cart_update",
      payload: INVOCATION_INTEGRITY_PAYLOADS["II-02"],
      store,
      ledger,
      manifestHash: initialManifest.manifestHash
    })
  );
  calls.push(
    await observedCall({
      caseId: "II-03",
      callIndex: 1,
      toolName: "checkout_request",
      payload: INVOCATION_INTEGRITY_PAYLOADS["II-03"],
      store,
      ledger,
      manifestHash: initialManifest.manifestHash
    })
  );
  const pendingManifest = await createCheckoutLiveManifest(store.getSnapshot().state, BUILD_SHA);
  const pendingDescriptors = projectInvocationIntegrityDescriptors(
    checkoutToolContractSnapshot(store.getSnapshot().state).manifest.map((tool) => ({
      ...tool,
      origin: PROBE_PRODUCTION_ORIGIN
    }))
  );
  registryHash = pendingManifest.manifestHash;
  calls.push(
    await observedCall({
      caseId: "II-03",
      callIndex: 2,
      toolName: "checkout_request",
      payload: INVOCATION_INTEGRITY_PAYLOADS["II-03"],
      store,
      ledger,
      manifestHash: pendingManifest.manifestHash
    })
  );
  return parseInvocationIntegrityTranscript({
    transcriptVersion: INVOCATION_INTEGRITY_TRANSCRIPT_VERSION,
    runtime: {
      secureContext: true,
      providerRegistration: true,
      inPageDiscovery: true,
      inPageExecution: true,
      origin: PROBE_PRODUCTION_ORIGIN,
      appCommit: BUILD_SHA,
      argumentMode: "object",
      userAgent: USER_AGENT,
      initialCatalog: INVOCATION_INTEGRITY_INITIAL_CATALOG,
      pendingCatalog: INVOCATION_INTEGRITY_PENDING_CATALOG,
      initialManifestHash: initialManifest.manifestHash,
      pendingManifestHash: pendingManifest.manifestHash
    },
    preflight: {
      preflightVersion: INVOCATION_INTEGRITY_PREFLIGHT_VERSION,
      initialDescriptors,
      pendingDescriptors,
      compatibility: { receipt: compatibilityReceipt, trace: compatibilityTrace },
      reset: {
        domainReceipt: domainResetReceipt,
        verifiedReceipt: verifiedResetReceipt,
        trace: resetTrace
      },
      caseTraceOffset: resetLedger.totalTraceCount,
      postReset: {
        inspection: {
          sessionId: resetInspection.sessionId,
          trajectoryId: resetInspection.trajectoryId,
          state: resetInspection.state,
          stateHash: await canonicalSha256(resetInspection.state),
          haltedReason: resetInspection.haltedReason,
          currentOperationCount: resetInspection.currentOperationCount,
          retainedTombstoneCount: resetInspection.retainedTombstoneCount,
          currentTraceCount: resetInspection.currentTraceCount,
          archivedTrajectoryCount: resetInspection.archivedTrajectoryCount,
          lastResetTraceEventId: resetTrace.eventId
        },
        trajectory: {
          currentTraceCount: resetLedger.current.length,
          archivedTrajectoryCount: resetLedger.archives.length,
          archivedTraceCount: resetLedger.archives.reduce(
            (total, archive) => total + archive.traces.length,
            0
          ),
          resetTraceCount: resetLedger.resetTraces.length,
          totalTraceCount: resetLedger.totalTraceCount
        }
      }
    },
    calls
  });
}

async function successReceipt(
  measuredTranscript?: InvocationIntegrityTranscript
): Promise<InvocationIntegrityReceipt> {
  const resolvedTranscript = measuredTranscript ?? (await transcript());
  return verifyInvocationIntegrityTranscript(resolvedTranscript, {
    environment,
    clock: () => "2026-08-30T00:01:00.000Z"
  });
}

async function failureReceipt(
  measuredTranscript?: InvocationIntegrityTranscript
): Promise<InvocationIntegrityFailureReceipt> {
  const resolvedTranscript = measuredTranscript ?? (await transcript());
  const reset = resolvedTranscript.preflight.postReset.inspection;
  const failureInput = parseInvocationIntegrityFailureInput({
    failureInputVersion: INVOCATION_INTEGRITY_FAILURE_INPUT_VERSION,
    runtime: {
      ...resolvedTranscript.runtime,
      pendingCatalog: null,
      pendingManifestHash: null
    },
    preflight: { ...resolvedTranscript.preflight, pendingDescriptors: null },
    completedCalls: [],
    error: {
      stage: "native",
      name: "WebMcpRuntimeError",
      message: "Native execution stopped before the first measured call completed.",
      code: "execution_failed",
      nativeCallMade: false,
      rawResultSha256: null
    },
    terminalInspection: {
      sessionId: reset.sessionId,
      trajectoryId: reset.trajectoryId,
      state: reset.state,
      stateHash: reset.stateHash,
      stateRevision: reset.state.revision,
      currentOperationCount: reset.currentOperationCount,
      retainedTombstoneCount: reset.retainedTombstoneCount,
      currentTraceCount: 0,
      totalTraceCount: resolvedTranscript.preflight.caseTraceOffset,
      haltedReason: null,
      lastTraceEventId: null
    },
    failedAt: "2026-08-30T00:00:20.000Z"
  });
  return createInvocationIntegrityFailureReceipt(failureInput, { environment });
}

describe("Invocation Integrity supplemental evidence", () => {
  it("retains the full four-call browser transcript and keeps semantic evidence separate", async () => {
    const measuredTranscript = await transcript();
    const evidence = await buildInvocationIntegrityEvidencePackage({
      receipt: await successReceipt(measuredTranscript)
    });
    expect(evidence.execution.origin).toBe(PROBE_PRODUCTION_ORIGIN);
    expect(evidence.summary).toEqual({
      earned: 3,
      possible: 3,
      modelCallCount: 0,
      includedInSemanticDenominator: false,
      disclosure: "deterministic direct WebMCP invocations; no LLM prompts"
    });
    expect(evidence.verifierReceipt.measuredTranscript).toEqual(measuredTranscript);
    expect(evidence.verifierReceipt.measuredTranscript.calls).toHaveLength(4);
    expect(evidence.verifierReceipt.measuredTranscript.preflight.initialDescriptors).toHaveLength(
      4
    );
    expect(evidence.verifierReceipt.measuredTranscript.preflight.pendingDescriptors).toHaveLength(
      5
    );
    expect(evidence.semanticRecord).toEqual(INVOCATION_INTEGRITY_SEMANTIC_RECORD);
    expect(evidence.position).toBe(INVOCATION_INTEGRITY_POSITION);
    await expect(validateInvocationIntegrityEvidencePackage(evidence)).resolves.toEqual(evidence);

    const releaseBinding = await createInvocationIntegrityReleaseBinding(evidence, RELEASE_SHA);
    const exports = await createInvocationIntegrityEvidenceExports(evidence, releaseBinding);
    expect(exports.markdown).toContain("Score: **3/3**");
    expect(exports.markdown).toContain("Full measured browser transcript");
    expect(exports.markdown).toContain("compatibility-verified");
    expect(exports.markdown).toContain("23/24 → 23/24; no measured improvement");
    expect(exports.markdown).toContain(INVOCATION_INTEGRITY_POSITION);
    expect(exports.json).toContain(evidence.verifierReceipt.measuredTranscriptDigest);
  });

  it("rejects origin and semantic-record substitution", async () => {
    const evidence = await buildInvocationIntegrityEvidencePackage({
      receipt: await successReceipt()
    });
    const tampered = structuredClone(evidence) as unknown as Record<string, unknown>;
    tampered.semanticRecord = { ...INVOCATION_INTEGRITY_SEMANTIC_RECORD, revisedEarned: 24 };
    await expect(validateInvocationIntegrityEvidencePackage(tampered)).rejects.toThrow(
      "invocation_integrity_frozen_binding_invalid"
    );

    const wrongOrigin = structuredClone(evidence) as unknown as Record<string, unknown>;
    wrongOrigin.execution = {
      ...(wrongOrigin.execution as Record<string, unknown>),
      origin: "https://attacker.example"
    };
    await expect(validateInvocationIntegrityEvidencePackage(wrongOrigin)).rejects.toThrow(
      "invocation_integrity_package_mismatch"
    );
  });

  it("requires every present release build identity to be exact and equal", () => {
    const releaseEnvironment = {
      TOOLPROOF_COMMIT_SHA: RELEASE_SHA,
      VERCEL_GIT_COMMIT_SHA: RELEASE_SHA,
      NEXT_PUBLIC_TOOLPROOF_COMMIT_SHA: RELEASE_SHA
    };
    expect(resolveInvocationIntegrityReleaseSha(releaseEnvironment)).toBe(RELEASE_SHA);
    expect(() =>
      resolveInvocationIntegrityReleaseSha({
        ...releaseEnvironment,
        VERCEL_GIT_COMMIT_SHA: BUILD_SHA
      })
    ).toThrow("invocation_integrity_release_build_binding_invalid");
    expect(() =>
      resolveInvocationIntegrityReleaseSha({
        TOOLPROOF_COMMIT_SHA: RELEASE_SHA,
        VERCEL_GIT_COMMIT_SHA: " "
      })
    ).toThrow("invocation_integrity_release_build_binding_invalid");
    expect(() =>
      resolveInvocationIntegrityReleaseSha({
        TOOLPROOF_COMMIT_SHA: RELEASE_SHA,
        NEXT_PUBLIC_TOOLPROOF_COMMIT_SHA: "c".repeat(39)
      })
    ).toThrow("invocation_integrity_release_build_binding_invalid");
    expect(resolveInvocationIntegrityReleaseSha({ VERCEL_GIT_COMMIT_SHA: RELEASE_SHA })).toBe(
      RELEASE_SHA
    );
    expect(() => resolveInvocationIntegrityReleaseSha({})).toThrow(
      "invocation_integrity_release_build_binding_invalid"
    );
  });

  it("preserves a terminal failure as downloadable evidence without a success claim", async () => {
    const evidence = await buildInvocationIntegrityFailureEvidencePackage({
      receipt: await failureReceipt()
    });
    expect(evidence.summary.earned).toBe(0);
    expect(evidence.summary.possible).toBe(3);
    expect(evidence.position).toBeNull();
    expect(evidence.verifierFailureReceipt.claimAllowed).toBe(false);
    expect(evidence.verifierFailureReceipt.completedCalls).toHaveLength(0);
    expect(evidence.verifierFailureReceipt.preflight.initialDescriptors).toHaveLength(4);
    expect(evidence.rows).toHaveLength(3);
    expect(evidence.rows.map(({ caseId, outcome }) => ({ caseId, outcome }))).toEqual([
      { caseId: "II-01", outcome: "fail" },
      { caseId: "II-02", outcome: "not-reached" },
      { caseId: "II-03", outcome: "not-reached" }
    ]);
    expect(evidence.rows[0]?.exactInvocations).toEqual([INVOCATION_INTEGRITY_PAYLOADS["II-01"]]);
    await expect(validateInvocationIntegrityFailureEvidencePackage(evidence)).resolves.toEqual(
      evidence
    );
    await expect(validateInvocationIntegritySupplementalEvidencePackage(evidence)).resolves.toEqual(
      evidence
    );
    await expect(validateInvocationIntegrityEvidencePackage(evidence)).rejects.toThrow();

    const releaseBinding = await createInvocationIntegrityReleaseBinding(evidence, RELEASE_SHA);
    const exports = await createInvocationIntegrityEvidenceExports(evidence, releaseBinding);
    expect(exports.markdown).toContain("Score: **0/3**");
    expect(exports.markdown).toContain("Terminal failure evidence");
    expect(exports.markdown).toContain("cannot validate as 3/3");
    expect(exports.markdown).not.toContain(`**${INVOCATION_INTEGRITY_POSITION}**`);

    render(
      createElement(InvocationIntegrityResults, {
        results: {
          status: "failed",
          evidencePackage: evidence,
          releaseBinding,
          evidenceExports: exports
        }
      })
    );
    expect(screen.getByText(/Measured terminal failure/u)).toBeInTheDocument();
    expect(screen.getByText(/success claim forbidden/u)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download Invocation Integrity JSON" })).toBeVisible();
    expect(screen.queryByText(INVOCATION_INTEGRITY_POSITION)).not.toBeInTheDocument();
  });
});
