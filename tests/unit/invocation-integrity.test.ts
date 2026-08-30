import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as verifyInvocationIntegrityRoute } from "@/app/api/invocation-integrity/verify/route";
import { POST as createInvocationIntegrityFailureRoute } from "@/app/api/invocation-integrity/failure/route";
import { createCheckoutFixture, type MutationResult } from "@/lib/domain/checkout";
import { verifyCheckoutReset } from "@/lib/domain/checkout-reset";
import { CheckoutSessionStore, type CheckoutSessionIdKind } from "@/lib/domain/checkout-session";
import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import { CheckoutTraceLedger } from "@/lib/evidence/checkout-trace-ledger";
import {
  INVOCATION_INTEGRITY_EXPECTED_RESULTS,
  INVOCATION_INTEGRITY_FAILURE_INPUT_VERSION,
  INVOCATION_INTEGRITY_FROZEN_CALLS,
  INVOCATION_INTEGRITY_INITIAL_CATALOG,
  INVOCATION_INTEGRITY_OBJECT_CALIBRATION_RAW_ARGUMENTS,
  INVOCATION_INTEGRITY_PAYLOADS,
  INVOCATION_INTEGRITY_PENDING_CATALOG,
  INVOCATION_INTEGRITY_PREFLIGHT_VERSION,
  INVOCATION_INTEGRITY_TRANSCRIPT_VERSION,
  parseInvocationIntegrityFailureInput,
  parseInvocationIntegrityTranscript,
  projectInvocationIntegrityDescriptors,
  verifyInvocationIntegrityFailureReceipt,
  verifyInvocationIntegrityReceipt,
  type InvocationIntegrityObservedCall,
  type InvocationIntegrityFailureInput,
  type InvocationIntegrityReceipt,
  type InvocationIntegrityTranscript
} from "@/lib/invocation-integrity/contract";
import { runSourceFixedInvocationIntegritySequence } from "@/lib/invocation-integrity/trusted-ledger.server";
import {
  InvocationIntegrityVerificationError,
  createInvocationIntegrityFailureReceipt,
  verifyInvocationIntegrityTranscript
} from "@/lib/invocation-integrity/verifier.server";
import { PROBE_PRODUCTION_ORIGIN } from "@/lib/probe/policy";
import { checkoutToolContractSnapshot } from "@/lib/webmcp/catalog";
import { createCheckoutLiveManifest } from "@/lib/webmcp/live-manifest.server";

const APP_COMMIT = "1".repeat(40);
const USER_AGENT = "Thurstone invocation-integrity test browser";

function idFactory(): (kind: CheckoutSessionIdKind) => string {
  let ordinal = 0;
  return (kind) => `${kind}_browser_test_${String(++ordinal).padStart(4, "0")}`;
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

async function buildObservedCall(input: {
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
  if (!trace) throw new Error("test trace missing");
  return {
    caseId: input.caseId,
    callIndex: input.callIndex,
    receipt: {
      executionId: `browser_${input.caseId.toLowerCase()}_${input.callIndex}`,
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

async function validTranscript(): Promise<InvocationIntegrityTranscript> {
  let registryHash = "unverified";
  let argumentMode: "unverified" | "object" = "unverified";
  let tick = 0;
  const ledger = new CheckoutTraceLedger({
    getRegistryHash: () => registryHash,
    getArgumentMode: () => argumentMode,
    appCommit: APP_COMMIT,
    origin: PROBE_PRODUCTION_ORIGIN,
    userAgent: USER_AGENT
  });
  const store = new CheckoutSessionStore({
    clock: () => `2026-08-29T13:00:${String(tick++).padStart(2, "0")}.000Z`,
    idFactory: idFactory(),
    traceSink: ledger
  });
  const initialManifest = await createCheckoutLiveManifest(createCheckoutFixture(), APP_COMMIT);
  registryHash = initialManifest.manifestHash;
  const initialDescriptors = projectInvocationIntegrityDescriptors(
    checkoutToolContractSnapshot(createCheckoutFixture()).manifest.map((tool) => ({
      ...tool,
      origin: PROBE_PRODUCTION_ORIGIN
    }))
  );
  const compatibilityResult = await store.cartGet(objectCalibrationInput(), { source: "native" });
  const compatibilityTrace = ledger.snapshot().current.at(-1);
  if (!compatibilityTrace || !compatibilityResult.ok) throw new Error("test compatibility missing");
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
  if (!resetTrace) throw new Error("test reset trace missing");
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
    checkedAt: "2026-08-29T13:00:10.000Z"
  });
  if (verifiedResetReceipt.status !== "verified") throw new Error("test reset not verified");
  const caseTraceOffset = resetLedger.totalTraceCount;
  const calls: InvocationIntegrityObservedCall[] = [];
  calls.push(
    await buildObservedCall({
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
    await buildObservedCall({
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
    await buildObservedCall({
      caseId: "II-03",
      callIndex: 1,
      toolName: "checkout_request",
      payload: INVOCATION_INTEGRITY_PAYLOADS["II-03"],
      store,
      ledger,
      manifestHash: initialManifest.manifestHash
    })
  );
  const pendingManifest = await createCheckoutLiveManifest(store.getSnapshot().state, APP_COMMIT);
  const pendingDescriptors = projectInvocationIntegrityDescriptors(
    checkoutToolContractSnapshot(store.getSnapshot().state).manifest.map((tool) => ({
      ...tool,
      origin: PROBE_PRODUCTION_ORIGIN
    }))
  );
  registryHash = pendingManifest.manifestHash;
  calls.push(
    await buildObservedCall({
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
      appCommit: APP_COMMIT,
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
      caseTraceOffset,
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

async function validFailureInput(): Promise<InvocationIntegrityFailureInput> {
  const transcript = await validTranscript();
  const secondTrace = transcript.calls[1].trace;
  return parseInvocationIntegrityFailureInput({
    failureInputVersion: INVOCATION_INTEGRITY_FAILURE_INPUT_VERSION,
    runtime: { ...transcript.runtime, pendingCatalog: null, pendingManifestHash: null },
    preflight: { ...transcript.preflight, pendingDescriptors: null },
    completedCalls: transcript.calls.slice(0, 2),
    error: {
      stage: "native",
      name: "WebMcpRuntimeError",
      message: "The next native call failed after dispatch.",
      code: "native_execution_failure",
      nativeCallMade: true,
      rawResultSha256: null
    },
    terminalInspection: {
      sessionId: secondTrace.sessionId,
      trajectoryId: secondTrace.runId,
      state: secondTrace.stateAfter.value,
      stateHash: secondTrace.stateAfter.sha256,
      stateRevision: 0,
      currentOperationCount: 1,
      retainedTombstoneCount: 1,
      currentTraceCount: 2,
      totalTraceCount: 4,
      haltedReason: null,
      lastTraceEventId: secondTrace.eventId
    },
    failedAt: "2026-08-29T14:01:00.000Z"
  });
}

const environment = {
  VERCEL_GIT_COMMIT_SHA: APP_COMMIT,
  TOOLPROOF_COMMIT_SHA: APP_COMMIT,
  NEXT_PUBLIC_TOOLPROOF_COMMIT_SHA: APP_COMMIT
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Gate 8.5 invocation integrity", () => {
  it("independently executes only the frozen sequence and preserves exact ledger invariants", async () => {
    const run = await runSourceFixedInvocationIntegritySequence();

    expect(run.cases.map(({ caseId }) => caseId)).toEqual(["II-01", "II-02", "II-03"]);
    expect(run.cases.map(({ observations }) => observations.map(({ result }) => result))).toEqual([
      INVOCATION_INTEGRITY_EXPECTED_RESULTS["II-01"],
      INVOCATION_INTEGRITY_EXPECTED_RESULTS["II-02"],
      INVOCATION_INTEGRITY_EXPECTED_RESULTS["II-03"]
    ]);
    expect(run.cases.map(({ domainOperationLedgerDiff }) => domainOperationLedgerDiff)).toEqual([
      { before: 0, after: 0, delta: 0 },
      { before: 0, after: 1, delta: 1 },
      { before: 1, after: 2, delta: 1 }
    ]);
    expect(run.cases.map(({ auditTraceDiff }) => auditTraceDiff)).toEqual([
      { before: 0, after: 1, delta: 1 },
      { before: 1, after: 2, delta: 1 },
      { before: 2, after: 4, delta: 2 }
    ]);
    expect(run.cases.map(({ subscriberCommitCount }) => subscriberCommitCount)).toEqual([0, 0, 1]);
    expect(run.totalSubscriberCommitCount).toBe(1);
    expect(
      run.cases.flatMap(({ observations }) =>
        observations.map((observation) => ({
          caseId: observation.caseId,
          callIndex: observation.callIndex,
          toolName: observation.toolName,
          input: observation.input,
          result: observation.result,
          status: observation.trace.outcome,
          commitDisposition: observation.trace.commitDisposition,
          effectApplied: observation.trace.effectApplied,
          operationId: observation.trace.operationId,
          canonicalInput: observation.trace.canonicalInput,
          canonicalCommand: observation.trace.canonicalCommand
        }))
      )
    ).toEqual(
      INVOCATION_INTEGRITY_FROZEN_CALLS.map((call) => ({
        caseId: call.caseId,
        callIndex: call.callIndex,
        toolName: call.toolName,
        input: call.payload,
        result: call.result,
        status: call.trace.status,
        commitDisposition: call.trace.commitDisposition,
        effectApplied: call.trace.effectApplied,
        operationId: call.trace.operationId,
        canonicalInput: call.trace.canonicalInput,
        canonicalCommand: call.trace.canonicalCommand
      }))
    );
  });

  it("binds four native observations to a separate digest-verified 3/3 receipt", async () => {
    const transcript = await validTranscript();
    const receipt = await verifyInvocationIntegrityTranscript(transcript, {
      environment,
      clock: () => "2026-08-29T14:00:00.000Z"
    });

    expect(receipt.status).toBe("verified");
    expect(receipt.score).toEqual({ earned: 3, possible: 3, label: "3/3" });
    expect(receipt.modelCallCount).toBe(0);
    expect(receipt.includedInSemanticDenominator).toBe(false);
    expect(receipt.browserEvidenceBoundary).toBe(
      "self-reported-browser-transcript-verified-against-source-fixed-server-replay"
    );
    expect(receipt.measuredTranscript).toEqual(transcript);
    expect(receipt.measuredTranscriptDigest).toBe(await canonicalSha256(transcript));
    expect(transcript.preflight.compatibility.trace.runtime.argumentMode).toBe("unverified");
    expect(transcript.preflight.compatibility.trace.rawArguments).toEqual({
      value: INVOCATION_INTEGRITY_OBJECT_CALIBRATION_RAW_ARGUMENTS,
      bytes: canonicalJson(INVOCATION_INTEGRITY_OBJECT_CALIBRATION_RAW_ARGUMENTS),
      sha256: await canonicalSha256(INVOCATION_INTEGRITY_OBJECT_CALIBRATION_RAW_ARGUMENTS)
    });
    expect(transcript.preflight.compatibility.trace.rawArguments.sha256).toBe(
      "84d665dd9476aba6d0c5b8b0fa54d40d0e116d8aec8b21c7e146c10924200d37"
    );
    expect(transcript.calls.map(({ trace }) => trace.runtime.argumentMode)).toEqual([
      "object",
      "object",
      "object",
      "object"
    ]);
    expect(receipt.rows.map(({ caseId, passed }) => ({ caseId, passed }))).toEqual([
      { caseId: "II-01", passed: true },
      { caseId: "II-02", passed: true },
      { caseId: "II-03", passed: true }
    ]);
    await expect(verifyInvocationIntegrityReceipt(receipt)).resolves.toEqual(receipt);
  });

  it("rejects re-digested portable evidence when call or trusted trace bindings drift", async () => {
    async function resign(
      receipt: InvocationIntegrityReceipt
    ): Promise<InvocationIntegrityReceipt> {
      const mutable = receipt as unknown as {
        measuredTranscript: InvocationIntegrityTranscript;
        measuredTranscriptDigest: string;
        rows: Array<
          Record<string, unknown> & {
            caseId: "II-01" | "II-02" | "II-03";
            browserObservationDigests: string[];
            trustedObservationDigests: string[];
            rowDigest: string;
          }
        >;
        receiptDigest: string;
        [key: string]: unknown;
      };
      mutable.measuredTranscriptDigest = await canonicalSha256(mutable.measuredTranscript);
      for (const row of mutable.rows) {
        row.browserObservationDigests = await Promise.all(
          mutable.measuredTranscript.calls
            .filter(({ caseId }) => caseId === row.caseId)
            .map((call) => canonicalSha256(call))
        );
        const rowCore: Record<string, unknown> = { ...row };
        delete rowCore.rowDigest;
        row.rowDigest = await canonicalSha256(rowCore);
      }
      const receiptCore: Record<string, unknown> = { ...mutable };
      delete receiptCore.receiptDigest;
      mutable.receiptDigest = await canonicalSha256(receiptCore);
      return mutable as unknown as InvocationIntegrityReceipt;
    }

    const verified = await verifyInvocationIntegrityTranscript(await validTranscript(), {
      environment,
      clock: () => "2026-08-29T14:00:00.000Z"
    });

    const descriptorDrift = structuredClone(verified);
    (
      descriptorDrift.measuredTranscript.preflight.initialDescriptors[0] as {
        title: string;
      }
    ).title = "Re-digested substituted descriptor";
    await expect(verifyInvocationIntegrityReceipt(await resign(descriptorDrift))).rejects.toThrow(
      "invocation_integrity_receipt_preflight_descriptor_mismatch"
    );

    const toolDrift = structuredClone(verified);
    (toolDrift.measuredTranscript.calls[0].receipt as unknown as { toolName: string }).toolName =
      "cart_update";
    await expect(verifyInvocationIntegrityReceipt(await resign(toolDrift))).rejects.toThrow(
      "invocation_integrity_receipt_native_call_binding_mismatch"
    );

    const dispositionDrift = structuredClone(verified);
    (
      dispositionDrift.measuredTranscript.calls[0].trace as unknown as {
        status: string;
        commitDisposition: string;
      }
    ).status = "expected_error";
    (
      dispositionDrift.measuredTranscript.calls[0].receipt as unknown as {
        handlerTraceStatus: string;
      }
    ).handlerTraceStatus = "expected_error";
    await expect(verifyInvocationIntegrityReceipt(await resign(dispositionDrift))).rejects.toThrow(
      "invocation_integrity_receipt_native_call_binding_mismatch"
    );

    const versionDrift = structuredClone(verified);
    (
      versionDrift.measuredTranscript.calls[0].trace as unknown as { handlerVersion: string }
    ).handlerVersion = "checkout_request@forged";
    await expect(verifyInvocationIntegrityReceipt(await resign(versionDrift))).rejects.toThrow(
      "invocation_integrity_receipt_trace_binding_mismatch"
    );

    const trustedProjectionDrift = structuredClone(verified);
    (trustedProjectionDrift.rows[0]!.trustedObservationDigests as string[])[0] = "f".repeat(64);
    await expect(
      verifyInvocationIntegrityReceipt(await resign(trustedProjectionDrift))
    ).rejects.toThrow("invocation_integrity_receipt_trusted_observation_mismatch");
  });

  it("rejects caller-selected protocol fields before verification", async () => {
    const transcript = await validTranscript();
    expect(() =>
      parseInvocationIntegrityTranscript({
        ...transcript,
        expectedOutcome: { ok: true },
        toolSchema: {},
        targetUrl: "https://attacker.invalid"
      })
    ).toThrow();
  });

  it("rejects a canonically re-digested replacement payload and tool binding", async () => {
    const transcript = structuredClone(await validTranscript());
    const call = transcript.calls[1] as unknown as {
      trace: { rawArguments: unknown };
      receipt: { toolName: string };
    };
    const replacement = { ...INVOCATION_INTEGRITY_PAYLOADS["II-02"], itemId: "other-item" };
    const bytes = canonicalJson(replacement);
    call.trace.rawArguments = {
      value: replacement,
      bytes,
      sha256: await sha256Hex(bytes)
    };
    call.receipt.toolName = "checkout_request";

    await expect(
      verifyInvocationIntegrityTranscript(transcript, { environment })
    ).rejects.toBeInstanceOf(InvocationIntegrityVerificationError);
  });

  it("rejects a caller build that is not the exact deployed SHA", async () => {
    const transcript = structuredClone(await validTranscript());
    (transcript.runtime as { appCommit: string }).appCommit = "2".repeat(40);

    await expect(
      verifyInvocationIntegrityTranscript(transcript, { environment })
    ).rejects.toMatchObject({ code: "invocation_integrity_runtime_boundary_mismatch" });
  });

  it("rejects forged reset evidence, descriptor substitution, contamination, and trace omission", async () => {
    const forgedReset = structuredClone(await validTranscript());
    (
      forgedReset.preflight.reset as {
        trace: typeof forgedReset.preflight.compatibility.trace;
      }
    ).trace = forgedReset.preflight.compatibility.trace;
    await expect(
      verifyInvocationIntegrityTranscript(forgedReset, { environment })
    ).rejects.toMatchObject({ code: "invocation_integrity_preflight_reset_binding_mismatch" });

    const descriptorSubstitution = structuredClone(await validTranscript());
    (
      descriptorSubstitution.preflight.initialDescriptors[0] as {
        title: string;
      }
    ).title = "Substituted descriptor";
    await expect(
      verifyInvocationIntegrityTranscript(descriptorSubstitution, { environment })
    ).rejects.toMatchObject({ code: "invocation_integrity_preflight_descriptor_mismatch" });

    const contaminated = structuredClone(await validTranscript());
    (
      contaminated.calls[0].trace as { parentEventId: string | null; sequence: number }
    ).parentEventId = "event_intervening_contamination";
    (contaminated.calls[0].trace as { parentEventId: string | null; sequence: number }).sequence +=
      1;
    await expect(
      verifyInvocationIntegrityTranscript(contaminated, { environment })
    ).rejects.toMatchObject({ code: "invocation_integrity_preflight_case_trace_handoff_mismatch" });

    const omitted = structuredClone(await validTranscript()) as unknown as Record<string, unknown>;
    delete (omitted.preflight as { compatibility: Record<string, unknown> }).compatibility.trace;
    expect(() => parseInvocationIntegrityTranscript(omitted)).toThrow();
  });

  it("rejects a source-fixed invariant change even when an attacker recomputes every digest", async () => {
    const receipt = await verifyInvocationIntegrityTranscript(await validTranscript(), {
      environment,
      clock: () => "2026-08-29T14:00:00.000Z"
    });
    const tampered = structuredClone(receipt) as unknown as {
      rows: Array<Record<string, unknown> & { subscriberCommitCount: number; rowDigest: string }>;
      receiptDigest: string;
      [key: string]: unknown;
    };
    const replayRow = tampered.rows[2]!;
    replayRow.subscriberCommitCount = 0;
    const rowCore: Record<string, unknown> = { ...replayRow };
    delete rowCore.rowDigest;
    replayRow.rowDigest = await canonicalSha256(rowCore);
    const receiptCore: Record<string, unknown> = { ...tampered };
    delete receiptCore.receiptDigest;
    tampered.receiptDigest = await canonicalSha256(receiptCore);

    await expect(verifyInvocationIntegrityReceipt(tampered)).rejects.toThrow(
      "invocation_integrity_receipt_ledger_mismatch"
    );
  });

  it("creates a digest-bound failed prefix that cannot claim success or survive tampering", async () => {
    const failureInput = await validFailureInput();
    const receipt = await createInvocationIntegrityFailureReceipt(failureInput, { environment });
    expect(receipt).toMatchObject({
      status: "failed",
      score: { earned: 2, possible: 3, label: "2/3" },
      claimPosition: "forbidden",
      claimAllowed: false,
      modelCallCount: 0
    });
    await expect(verifyInvocationIntegrityFailureReceipt(receipt)).resolves.toEqual(receipt);

    const tampered = structuredClone(receipt) as unknown as Record<string, unknown>;
    tampered.claimAllowed = true;
    const receiptCore = { ...tampered };
    delete receiptCore.receiptDigest;
    tampered.receiptDigest = await canonicalSha256(receiptCore);
    await expect(verifyInvocationIntegrityFailureReceipt(tampered)).rejects.toThrow();
  });
});

describe("Gate 8.5 fixed verification route", () => {
  function routeRequest(body: unknown, origin = PROBE_PRODUCTION_ORIGIN): Request {
    return new Request(`${PROBE_PRODUCTION_ORIGIN}/api/invocation-integrity/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty"
      },
      body: JSON.stringify(body)
    });
  }

  function bindRouteBuild(): void {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", APP_COMMIT);
    vi.stubEnv("TOOLPROOF_COMMIT_SHA", APP_COMMIT);
    vi.stubEnv("NEXT_PUBLIC_TOOLPROOF_COMMIT_SHA", APP_COMMIT);
  }

  it("accepts only a production same-origin exact transcript and performs no inference", async () => {
    bindRouteBuild();
    const response = await verifyInvocationIntegrityRoute(routeRequest(await validTranscript()));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      status: "verified",
      modelCallCount: 0,
      includedInSemanticDenominator: false,
      score: { earned: 3, possible: 3, label: "3/3" }
    });
    await expect(verifyInvocationIntegrityReceipt(body)).resolves.toEqual(body);
  });

  it("rejects a foreign origin before reading the transcript", async () => {
    bindRouteBuild();
    const response = await verifyInvocationIntegrityRoute(
      routeRequest(await validTranscript(), "https://attacker.invalid")
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "request_rejected",
      inferencePerformed: false
    });
  });

  it("rejects caller-selected expected values at the strict route schema", async () => {
    bindRouteBuild();
    const transcript = await validTranscript();
    const response = await verifyInvocationIntegrityRoute(
      routeRequest({ ...transcript, expectedOutcome: { ok: true } })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invocation_integrity_transcript_invalid",
      inferencePerformed: false
    });
  });

  it("returns a strict failed receipt through the dedicated provider-free route", async () => {
    bindRouteBuild();
    const response = await createInvocationIntegrityFailureRoute(
      routeRequest(await validFailureInput())
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    await expect(verifyInvocationIntegrityFailureReceipt(body)).resolves.toMatchObject({
      status: "failed",
      score: { earned: 2, possible: 3 },
      claimAllowed: false
    });
  });
});
