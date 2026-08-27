import { describe, expect, it } from "vitest";

import { createCheckoutFixture, type CheckoutState } from "@/lib/domain/checkout";
import { verifyCheckoutReset } from "@/lib/domain/checkout-reset";
import { CheckoutSessionStore } from "@/lib/domain/checkout-session";
import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import { CheckoutTraceLedger } from "@/lib/evidence/checkout-trace-ledger";
import {
  assertSafeGate1ProofJson,
  createGate1ProofBundle,
  Gate1EvidenceJournal,
  gate1ProofFilename,
  projectReadinessReceipt,
  serializeGate1ProofBundle,
  verifyGate1ProofBundle,
  type CreateGate1ProofBundleInput,
  type Gate1ProofBundle
} from "@/lib/evidence/gate1-proof-bundle";
import type { RegistryReadinessReceipt } from "@/lib/webmcp/readiness";
import type { ExecuteOnceResult, RuntimeCompatibilityReceipt } from "@/lib/webmcp/runtime";
import { checkoutToolContractSnapshot } from "@/lib/webmcp/catalog";

const APP_COMMIT = "a".repeat(40);
const ORIGIN = "https://toolproof.example";
const CAPABILITIES = {
  secureContext: true,
  providerRegistration: true,
  inPageDiscovery: true,
  inPageExecution: true
};

function timestamps(): () => string {
  let index = 0;
  return () => `2026-08-27T07:00:${String(index++).padStart(2, "0")}.000Z`;
}

async function resealBundle(bundle: Gate1ProofBundle): Promise<Gate1ProofBundle> {
  const mutable = bundle as unknown as {
    evidenceDigest: string;
    bundleDigest: string;
    evidence: {
      journal: {
        headHash: string | null;
        events: Array<{
          eventHash: string;
          previousEventHash: string | null;
          [key: string]: unknown;
        }>;
      };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  let previousEventHash: string | null = null;
  for (const event of mutable.evidence.journal.events) {
    event.previousEventHash = previousEventHash;
    const content = Object.fromEntries(
      Object.entries(event).filter(([key]) => key !== "eventHash")
    );
    event.eventHash = await sha256Hex(`toolproof-gate1-journal-event@1\n${canonicalJson(content)}`);
    previousEventHash = event.eventHash;
  }
  mutable.evidence.journal.headHash = previousEventHash;
  mutable.evidenceDigest = await sha256Hex(
    `toolproof-gate1-evidence@1\n${canonicalJson(mutable.evidence)}`
  );
  const unsigned = Object.fromEntries(
    Object.entries(mutable).filter(([key]) => key !== "bundleDigest")
  );
  mutable.bundleDigest = await sha256Hex(`toolproof-gate1-bundle@1\n${canonicalJson(unsigned)}`);
  return mutable as unknown as Gate1ProofBundle;
}

async function overwriteCanonicalEvidence(
  target: { value: unknown; bytes: string; sha256: string },
  value: unknown
): Promise<void> {
  const bytes = canonicalJson(value);
  target.value = value;
  target.bytes = bytes;
  target.sha256 = await sha256Hex(bytes);
}

function emptyBundleInput(
  journal: Gate1EvidenceJournal,
  store = new CheckoutSessionStore(),
  ledger = new CheckoutTraceLedger({
    appCommit: APP_COMMIT,
    getRegistryHash: () => "manifest-hash",
    getArgumentMode: () => "json-string",
    origin: ORIGIN,
    userAgent: "Synthetic Chrome"
  })
): CreateGate1ProofBundleInput {
  return {
    exportedAt: "2026-08-27T08:00:00.000Z",
    appCommit: APP_COMMIT,
    origin: ORIGIN,
    userAgent: "Synthetic Chrome",
    capabilities: CAPABILITIES,
    registryStatus: {
      phase: "ready",
      toolNames: ["cart_get", "cart_update", "checkout_request", "order_review"],
      generation: 1
    },
    readiness: null,
    readinessError: null,
    ownerWindow: window,
    session: store.getSnapshot(),
    inspection: store.inspect(),
    domainArchives: store.archivedTrajectories(),
    traceLedger: ledger.snapshot(),
    journal: journal.snapshot(),
    currentReceipts: {
      uiReceipt: null,
      uiError: null,
      nativeReceipt: null,
      nativeError: null,
      verifiedReset: null,
      pendingDomainReset: null,
      lastNativeMutation: null
    }
  };
}

async function initialReadiness(state: CheckoutState): Promise<RegistryReadinessReceipt> {
  const contract = checkoutToolContractSnapshot(state);
  const versions = new Map(contract.handlerVersions.map(({ name, version }) => [name, version]));
  const tools = [...contract.manifest]
    .map((tool) => ({
      ...tool,
      annotations: {
        readOnlyHint: tool.annotations.readOnlyHint ?? false,
        untrustedContentHint: tool.annotations.untrustedContentHint ?? false
      },
      handlerVersion: versions.get(tool.name) as string
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const manifest = {
    catalogState: contract.catalogState,
    toolsetVersion: contract.toolsetVersion,
    domainVersion: contract.domainVersion,
    appCommit: APP_COMMIT,
    tools
  } as const;
  const manifestHash = await canonicalSha256(manifest);
  const registeredTools = contract.manifest.map(
    (tool) =>
      ({
        ...tool,
        window,
        origin: ORIGIN
      }) as WebMCP.RegisteredTool
  );
  const names = tools.map(({ name }) => name);
  return {
    status: "consumer-discovered",
    providerRegistration: "ready",
    consumerDiscovery: "verified",
    consumerExecution: "unverified",
    compatibilityBinding: "unverified",
    registeredToolNames: names,
    visibleToolNames: names,
    rejectedToolNames: [],
    manifest,
    manifestHash,
    fixtureId: state.fixtureId,
    fixtureRevision: state.revision,
    stateHash: await canonicalSha256(state),
    argumentMode: "unverified",
    compatibilityReceipt: null,
    runtimeCatalog: { generation: 1, manifestHash, tools: registeredTools },
    mismatches: [],
    checkedAt: "2026-08-27T07:00:00.000Z"
  } as RegistryReadinessReceipt;
}

function readyReadiness(
  receipt: RegistryReadinessReceipt,
  compatibilityReceipt: RuntimeCompatibilityReceipt
): RegistryReadinessReceipt {
  return {
    ...receipt,
    status: "consumer-ready",
    consumerExecution: "verified",
    compatibilityBinding: "verified",
    argumentMode: compatibilityReceipt.argumentMode,
    compatibilityReceipt
  };
}

describe("Gate 1 proof journal and bundle", () => {
  it("owns append-only payload snapshots and rejects unfinished attempts", async () => {
    const journal = new Gate1EvidenceJournal({ clock: timestamps() });
    const mutable = { ...CAPABILITIES };
    journal.recordCapabilities(mutable);
    mutable.inPageExecution = false;
    journal.recordNativeAttemptStarted({
      executionId: "execution-0000001",
      toolName: "cart_get",
      input: {},
      manifestHash: "manifest-hash",
      registrationGeneration: 1,
      catalogState: "initial",
      fixtureRevision: 0,
      stateHash: "state-hash",
      traceCount: 0
    });

    const openSnapshot = journal.snapshot();
    expect(openSnapshot).toMatchObject({
      eventCount: 2,
      openNativeAttemptIds: ["execution-0000001"]
    });
    expect(openSnapshot.entries[0]?.payload).toMatchObject({ inPageExecution: true });
    await expect(createGate1ProofBundle(emptyBundleInput(journal))).rejects.toThrow(
      "unfinished native attempts"
    );

    journal.recordNativeAttemptFinished({
      executionId: "execution-0000001",
      toolName: "cart_get",
      outcome: "error",
      error: { name: "AbortError", message: "Synthetic cancellation" },
      traceObservation: null,
      observationError: { name: "ObservationUnavailable", message: "Synthetic test boundary" }
    });
    expect(journal.snapshot()).toMatchObject({ eventCount: 3, openNativeAttemptIds: [] });
    await expect(createGate1ProofBundle(emptyBundleInput(journal))).rejects.toThrow(
      "current consumer-ready catalog"
    );
  });

  it("binds a real native trace, receipt, chain, and top-level digests", async () => {
    const journal = new Gate1EvidenceJournal({ clock: timestamps() });
    const preliminaryReadiness = await initialReadiness(createCheckoutFixture());
    let registryHash = preliminaryReadiness.manifestHash;
    const ledger = new CheckoutTraceLedger({
      appCommit: APP_COMMIT,
      getRegistryHash: () => registryHash,
      getArgumentMode: () => "json-string",
      origin: ORIGIN,
      userAgent: "Synthetic Chrome"
    });
    const store = new CheckoutSessionStore({ traceSink: ledger });
    journal.recordCapabilities(CAPABILITIES);
    journal.recordReadinessReceipt(preliminaryReadiness, window, ORIGIN);
    const calibrationResult = await store.cartGet({}, { source: "native" });
    const calibrationTrace = ledger.snapshot().current[0]!;
    const compatibilityReceipt: RuntimeCompatibilityReceipt = {
      status: "compatibility-verified",
      argumentMode: "json-string",
      toolName: "cart_get",
      nativeCallCount: 1,
      coercionCount: 1,
      rawResult: JSON.stringify(calibrationResult),
      canonicalResult: calibrationResult,
      resultDigest: calibrationTrace.canonicalResult!.sha256,
      handlerTraceId: calibrationTrace.eventId,
      effectDigest: await canonicalSha256(calibrationTrace.effect),
      stateBeforeDigest: calibrationTrace.stateBefore.sha256,
      stateAfterDigest: calibrationTrace.stateAfter.sha256,
      manifestHashBefore: registryHash,
      manifestHashAfter: registryHash,
      registrationGeneration: 1
    };
    const readyAtRevisionZero = readyReadiness(preliminaryReadiness, compatibilityReceipt);
    journal.recordReadinessReceipt(readyAtRevisionZero, window, ORIGIN);

    const input = {
      operationId: "native_update_0001",
      operation: "set_quantity" as const,
      itemId: "stoneware-mug" as const,
      quantity: 3
    };
    journal.recordNativeAttemptStarted({
      executionId: "plumbing_execution_0001",
      toolName: "cart_update",
      input,
      manifestHash: registryHash,
      registrationGeneration: 1,
      catalogState: "initial",
      fixtureRevision: 0,
      stateHash: readyAtRevisionZero.stateHash,
      traceCount: 1
    });
    const result = await store.cartUpdate(input, { source: "native" });
    const trace = ledger.snapshot().current[1]!;
    const receipt: ExecuteOnceResult = {
      executionId: "plumbing_execution_0001",
      toolName: "cart_update",
      argumentMode: "json-string",
      rawResult: JSON.stringify(result),
      canonicalResult: result,
      resultDigest: trace.canonicalResult!.sha256,
      nativeCallCount: 1,
      handlerTraceId: trace.eventId,
      handlerTraceStatus: trace.status,
      effectDigest: await canonicalSha256(trace.effect),
      stateBeforeDigest: trace.stateBefore.sha256,
      stateAfterDigest: trace.stateAfter.sha256,
      manifestHash: trace.registryHash
    };
    journal.recordNativeAttemptFinished({
      executionId: receipt.executionId,
      toolName: receipt.toolName,
      outcome: "receipt",
      receipt
    });
    const readyAtRevisionOne = readyReadiness(
      await initialReadiness(store.getSnapshot().state),
      compatibilityReceipt
    );
    registryHash = readyAtRevisionOne.manifestHash;
    journal.recordReadinessReceipt(readyAtRevisionOne, window, ORIGIN);

    const base = emptyBundleInput(journal, store, ledger);
    const bundle = await createGate1ProofBundle({
      ...base,
      readiness: readyAtRevisionOne,
      journal: journal.snapshot(),
      session: store.getSnapshot(),
      inspection: store.inspect(),
      traceLedger: ledger.snapshot(),
      currentReceipts: {
        ...base.currentReceipts,
        nativeReceipt: receipt
      }
    });
    await expect(verifyGate1ProofBundle(bundle)).resolves.toMatchObject({
      status: "internally-consistent",
      journalEventCount: 6,
      traceCount: 2,
      nativeAttemptCount: 1,
      evidenceDigest: bundle.evidenceDigest,
      bundleDigest: bundle.bundleDigest
    });
    expect(serializeGate1ProofBundle(bundle)).toContain('"modelSelectionEvidence": false');
    expect(gate1ProofFilename(bundle)).toMatch(
      /^toolproof-gate1-native-a{12}-20260827T080000Z\.json$/u
    );

    const tampered = JSON.parse(JSON.stringify(bundle)) as Gate1ProofBundle;
    (tampered.evidence.inspection as { currentOperationCount: number }).currentOperationCount = 99;
    await expect(verifyGate1ProofBundle(tampered)).rejects.toThrow("evidence digest mismatch");

    const semanticTampering: Array<{
      label: string;
      expected: RegExp;
      mutate: (value: Gate1ProofBundle) => void;
    }> = [
      {
        label: "attempt tool",
        expected: /tool binding mismatch/u,
        mutate: (value) => {
          const events = value.evidence.journal.events as Array<{
            kind: string;
            payload: { toolName?: string };
          }>;
          events.find(({ kind }) => kind === "native_attempt_started")!.payload.toolName =
            "order_review";
        }
      },
      {
        label: "receipt raw result",
        expected: /receipt\/trace binding|raw result/u,
        mutate: (value) => {
          const events = value.evidence.journal.events as Array<{
            kind: string;
            payload: { outcome?: string; receipt?: { rawResult: string } };
          }>;
          events.find(
            ({ kind, payload }) =>
              kind === "native_attempt_finished" && payload.outcome === "receipt"
          )!.payload.receipt!.rawResult = JSON.stringify({ ok: false });
        }
      },
      {
        label: "trace effect",
        expected: /effect does not match/u,
        mutate: (value) => {
          const ledger = value.evidence.traceLedger as unknown as {
            current: Array<{ effect: { stateChanged: boolean } }>;
          };
          ledger.current[1]!.effect.stateChanged = false;
        }
      },
      {
        label: "trace commit",
        expected: /provenance mismatch/u,
        mutate: (value) => {
          const ledger = value.evidence.traceLedger as unknown as {
            current: Array<{ appCommit: string }>;
          };
          ledger.current[1]!.appCommit = "b".repeat(40);
        }
      },
      {
        label: "discovered descriptor",
        expected: /discovered descriptors/u,
        mutate: (value) => {
          const events = value.evidence.journal.events as Array<{
            kind: string;
            payload: { runtimeCatalog?: { tools: Array<{ description: string }> } };
          }>;
          const readiness = events.find(({ kind }) => kind === "readiness_receipt")!;
          readiness.payload.runtimeCatalog!.tools[0]!.description = "Tampered description";
        }
      },
      {
        label: "compatibility coercion",
        expected: /Compatibility receipt/u,
        mutate: (value) => {
          const events = value.evidence.journal.events as Array<{
            kind: string;
            payload: { compatibilityReceipt?: { coercionCount: number } | null };
          }>;
          const readiness = events.find(
            ({ kind, payload }) => kind === "readiness_receipt" && payload.compatibilityReceipt
          )!;
          readiness.payload.compatibilityReceipt!.coercionCount = 0;
        }
      }
    ];
    for (const testCase of semanticTampering) {
      const candidate = JSON.parse(JSON.stringify(bundle)) as Gate1ProofBundle;
      testCase.mutate(candidate);
      await resealBundle(candidate);
      await expect(verifyGate1ProofBundle(candidate), testCase.label).rejects.toThrow(
        testCase.expected
      );
    }
  });

  it("accepts only an exact completed cart_get when the native consumer cancels afterward", async () => {
    const journal = new Gate1EvidenceJournal({ clock: timestamps() });
    const preliminaryReadiness = await initialReadiness(createCheckoutFixture());
    const registryHash = preliminaryReadiness.manifestHash;
    const ledger = new CheckoutTraceLedger({
      appCommit: APP_COMMIT,
      getRegistryHash: () => registryHash,
      getArgumentMode: () => "json-string",
      origin: ORIGIN,
      userAgent: "Synthetic Chrome"
    });
    const store = new CheckoutSessionStore({ traceSink: ledger });
    journal.recordCapabilities(CAPABILITIES);
    journal.recordReadinessReceipt(preliminaryReadiness, window, ORIGIN);

    const calibrationResult = await store.cartGet({}, { source: "native" });
    const calibrationTrace = ledger.snapshot().current[0]!;
    const compatibilityReceipt: RuntimeCompatibilityReceipt = {
      status: "compatibility-verified",
      argumentMode: "json-string",
      toolName: "cart_get",
      nativeCallCount: 1,
      coercionCount: 1,
      rawResult: JSON.stringify(calibrationResult),
      canonicalResult: calibrationResult,
      resultDigest: calibrationTrace.canonicalResult!.sha256,
      handlerTraceId: calibrationTrace.eventId,
      effectDigest: await canonicalSha256(calibrationTrace.effect),
      stateBeforeDigest: calibrationTrace.stateBefore.sha256,
      stateAfterDigest: calibrationTrace.stateAfter.sha256,
      manifestHashBefore: registryHash,
      manifestHashAfter: registryHash,
      registrationGeneration: 1
    };
    const readiness = readyReadiness(preliminaryReadiness, compatibilityReceipt);
    journal.recordReadinessReceipt(readiness, window, ORIGIN);

    const executionId = "cancel_after_completed_read_0001";
    journal.recordNativeAttemptStarted({
      executionId,
      toolName: "cart_get",
      input: {},
      manifestHash: registryHash,
      registrationGeneration: 1,
      catalogState: "initial",
      fixtureRevision: 0,
      stateHash: readiness.stateHash,
      traceCount: 1
    });
    await store.cartGet({}, { source: "native" });
    const trace = ledger.snapshot().current[1]!;
    expect(trace).toMatchObject({
      toolName: "cart_get",
      status: "completed",
      commitDisposition: "none",
      cancellationObservedAfterCommit: false,
      cancellationObservedAfterCompletion: false,
      effect: { stateChanged: false }
    });
    const adapterError = {
      name: "WebMcpRuntimeError",
      message: "Native execution was canceled.",
      code: "execution_canceled",
      nativeCallMade: true,
      rawResult: null
    } as const;
    journal.recordNativeAttemptFinished({
      executionId,
      toolName: "cart_get",
      outcome: "error",
      error: adapterError,
      traceObservation: {
        stateHash: trace.stateAfter.sha256,
        handlerTraceCount: 2,
        lastTrace: {
          eventId: trace.eventId,
          source: trace.source,
          toolName: trace.toolName,
          status: trace.status,
          registryHash: trace.registryHash,
          resultDigest: trace.canonicalResult?.sha256 ?? null,
          effectDigest: await canonicalSha256(trace.effect),
          stateBeforeDigest: trace.stateBefore.sha256,
          stateAfterDigest: trace.stateAfter.sha256
        }
      },
      observationError: null
    });

    const base = emptyBundleInput(journal, store, ledger);
    const bundle = await createGate1ProofBundle({
      ...base,
      readiness,
      journal: journal.snapshot(),
      session: store.getSnapshot(),
      inspection: store.inspect(),
      traceLedger: ledger.snapshot(),
      currentReceipts: { ...base.currentReceipts, nativeError: adapterError }
    });
    await expect(verifyGate1ProofBundle(bundle)).resolves.toMatchObject({
      status: "internally-consistent",
      nativeAttemptCount: 1
    });

    const handlerObservedAfterCompletion = JSON.parse(JSON.stringify(bundle)) as Gate1ProofBundle;
    (
      handlerObservedAfterCompletion.evidence.traceLedger as unknown as {
        current: Array<{ cancellationObservedAfterCompletion: boolean }>;
      }
    ).current[1]!.cancellationObservedAfterCompletion = true;
    await resealBundle(handlerObservedAfterCompletion);
    await expect(verifyGate1ProofBundle(handlerObservedAfterCompletion)).resolves.toMatchObject({
      status: "internally-consistent"
    });

    const wrongTerminal = JSON.parse(JSON.stringify(bundle)) as Gate1ProofBundle;
    (
      wrongTerminal.evidence.traceLedger as unknown as {
        current: Array<{ status: string }>;
      }
    ).current[1]!.status = "expected_error";
    const finishEvents = wrongTerminal.evidence.journal.events as Array<{
      kind: string;
      payload: { traceObservation?: { lastTrace?: { status: string } } };
    }>;
    finishEvents.find(
      ({ kind }) => kind === "native_attempt_finished"
    )!.payload.traceObservation!.lastTrace!.status = "expected_error";
    await resealBundle(wrongTerminal);
    await expect(verifyGate1ProofBundle(wrongTerminal)).rejects.toThrow(
      "exact harmless completed-or-canceled cart_get"
    );

    const wrongResult = JSON.parse(JSON.stringify(bundle)) as Gate1ProofBundle;
    const wrongResultTrace = (
      wrongResult.evidence.traceLedger as unknown as {
        current: Array<{
          rawResult: { value: unknown; bytes: string; sha256: string };
          canonicalResult: { value: unknown; bytes: string; sha256: string };
        }>;
      }
    ).current[1]!;
    await overwriteCanonicalEvidence(wrongResultTrace.rawResult, { ok: false });
    await overwriteCanonicalEvidence(wrongResultTrace.canonicalResult, { ok: false });
    const wrongResultEvents = wrongResult.evidence.journal.events as Array<{
      kind: string;
      payload: { traceObservation?: { lastTrace?: { resultDigest: string } } };
    }>;
    wrongResultEvents.find(
      ({ kind }) => kind === "native_attempt_finished"
    )!.payload.traceObservation!.lastTrace!.resultDigest = wrongResultTrace.canonicalResult.sha256;
    await resealBundle(wrongResult);
    await expect(verifyGate1ProofBundle(wrongResult)).rejects.toThrow(
      "exact harmless completed-or-canceled cart_get"
    );

    const wrongInput = JSON.parse(JSON.stringify(bundle)) as Gate1ProofBundle;
    const wrongInputEvents = wrongInput.evidence.journal.events as Array<{
      kind: string;
      payload: { input?: Record<string, unknown> };
    }>;
    wrongInputEvents.find(({ kind }) => kind === "native_attempt_started")!.payload.input = {
      unexpected: true
    };
    const wrongInputTrace = (
      wrongInput.evidence.traceLedger as unknown as {
        current: Array<{
          rawArguments: { value: unknown; bytes: string; sha256: string };
          canonicalArguments: { value: unknown; bytes: string; sha256: string };
        }>;
      }
    ).current[1]!;
    await overwriteCanonicalEvidence(wrongInputTrace.rawArguments, { unexpected: true });
    await overwriteCanonicalEvidence(wrongInputTrace.canonicalArguments, { unexpected: true });
    await resealBundle(wrongInput);
    await expect(verifyGate1ProofBundle(wrongInput)).rejects.toThrow("native/read-only boundary");

    const handlerError = JSON.parse(JSON.stringify(bundle)) as Gate1ProofBundle;
    const handlerErrorEvidence = (
      handlerError.evidence.traceLedger as unknown as {
        current: Array<{ error: { value: unknown; bytes: string; sha256: string } }>;
      }
    ).current[1]!.error;
    await overwriteCanonicalEvidence(handlerErrorEvidence, {
      name: "Error",
      message: "Unexpected completed-handler error"
    });
    await resealBundle(handlerError);
    await expect(verifyGate1ProofBundle(handlerError)).rejects.toThrow(
      "exact harmless completed-or-canceled cart_get"
    );

    const wrongCommit = JSON.parse(JSON.stringify(bundle)) as Gate1ProofBundle;
    (
      wrongCommit.evidence.traceLedger as unknown as {
        current: Array<{ commitDisposition: string }>;
      }
    ).current[1]!.commitDisposition = "committed";
    await resealBundle(wrongCommit);
    await expect(verifyGate1ProofBundle(wrongCommit)).rejects.toThrow(
      "exact harmless completed-or-canceled cart_get"
    );

    const malformedAdapterError = JSON.parse(JSON.stringify(bundle)) as Gate1ProofBundle;
    const malformedEvents = malformedAdapterError.evidence.journal.events as Array<{
      kind: string;
      payload: { error?: Record<string, unknown> };
    }>;
    malformedEvents.find(
      ({ kind }) => kind === "native_attempt_finished"
    )!.payload.error!.unexpected = true;
    await resealBundle(malformedAdapterError);
    await expect(verifyGate1ProofBundle(malformedAdapterError)).rejects.toThrow(
      "native/read-only boundary"
    );

    const missingObservation = JSON.parse(JSON.stringify(bundle)) as Gate1ProofBundle;
    const missingObservationEvents = missingObservation.evidence.journal.events as Array<{
      kind: string;
      payload: { traceObservation?: unknown };
    }>;
    missingObservationEvents.find(
      ({ kind }) => kind === "native_attempt_finished"
    )!.payload.traceObservation = null;
    await resealBundle(missingObservation);
    await expect(verifyGate1ProofBundle(missingObservation)).rejects.toThrow(
      "native/read-only boundary"
    );
  });

  it("binds domain reset, archive, terminal verification, and current reset receipts", async () => {
    const journal = new Gate1EvidenceJournal({ clock: timestamps() });
    const preliminaryReadiness = await initialReadiness(createCheckoutFixture());
    const registryHash = preliminaryReadiness.manifestHash;
    const ledger = new CheckoutTraceLedger({
      appCommit: APP_COMMIT,
      getRegistryHash: () => registryHash,
      getArgumentMode: () => "json-string",
      origin: ORIGIN,
      userAgent: "Synthetic Chrome"
    });
    const store = new CheckoutSessionStore({ traceSink: ledger });
    journal.recordCapabilities(CAPABILITIES);
    journal.recordReadinessReceipt(preliminaryReadiness, window, ORIGIN);
    const calibrationResult = await store.cartGet({}, { source: "native" });
    const calibrationTrace = ledger.snapshot().current[0]!;
    const compatibilityReceipt: RuntimeCompatibilityReceipt = {
      status: "compatibility-verified",
      argumentMode: "json-string",
      toolName: "cart_get",
      nativeCallCount: 1,
      coercionCount: 1,
      rawResult: JSON.stringify(calibrationResult),
      canonicalResult: calibrationResult,
      resultDigest: calibrationTrace.canonicalResult!.sha256,
      handlerTraceId: calibrationTrace.eventId,
      effectDigest: await canonicalSha256(calibrationTrace.effect),
      stateBeforeDigest: calibrationTrace.stateBefore.sha256,
      stateAfterDigest: calibrationTrace.stateAfter.sha256,
      manifestHashBefore: registryHash,
      manifestHashAfter: registryHash,
      registrationGeneration: 1
    };
    journal.recordReadinessReceipt(
      readyReadiness(preliminaryReadiness, compatibilityReceipt),
      window,
      ORIGIN
    );

    const domainReset = await store.hardReset({ source: "ui", holdForVerification: true });
    journal.recordDomainResetReceipt(domainReset);
    const resetReadiness = readyReadiness(
      await initialReadiness(store.getSnapshot().state),
      compatibilityReceipt
    );
    journal.recordReadinessReceipt(resetReadiness, window, ORIGIN);
    const verifiedReset = await verifyCheckoutReset({
      domainReceipt: domainReset,
      inspection: store.inspect(),
      archives: store.archivedTrajectories(),
      traceLedger: ledger.snapshot(),
      registry: {
        verified: true,
        registryHash,
        registeredToolNames: ["cart_get", "cart_update", "checkout_request", "order_review"]
      },
      checkedAt: "2026-08-27T07:01:00.000Z"
    });
    expect(verifiedReset.status).toBe("verified");
    journal.recordResetVerificationReceipt(verifiedReset);
    expect(store.releaseResetAdmission(domainReset.resetId)).toBe(true);

    const base = emptyBundleInput(journal, store, ledger);
    const bundle = await createGate1ProofBundle({
      ...base,
      readiness: resetReadiness,
      journal: journal.snapshot(),
      session: store.getSnapshot(),
      inspection: store.inspect(),
      domainArchives: store.archivedTrajectories(),
      traceLedger: ledger.snapshot(),
      currentReceipts: {
        ...base.currentReceipts,
        uiReceipt: domainReset,
        verifiedReset,
        pendingDomainReset: domainReset
      }
    });
    await expect(verifyGate1ProofBundle(bundle)).resolves.toMatchObject({
      status: "internally-consistent",
      traceCount: 2
    });

    const terminalTamper = JSON.parse(JSON.stringify(bundle)) as Gate1ProofBundle;
    const terminalEvents = terminalTamper.evidence.journal.events as Array<{
      kind: string;
      payload: { seed?: string };
    }>;
    terminalEvents.find(({ kind }) => kind === "reset_verification_receipt")!.payload.seed =
      "wrong-seed";
    await resealBundle(terminalTamper);
    await expect(verifyGate1ProofBundle(terminalTamper)).rejects.toThrow("Verified reset receipt");

    const archiveTamper = JSON.parse(JSON.stringify(bundle)) as Gate1ProofBundle;
    (
      archiveTamper.evidence.domainArchives as unknown as Array<{ archivedAt: string }>
    )[0]!.archivedAt = "2026-08-27T09:00:00.000Z";
    await resealBundle(archiveTamper);
    await expect(verifyGate1ProofBundle(archiveTamper)).rejects.toThrow(
      "domain/full archive binding"
    );
  });

  it("projects readiness ownership without serializing Window or live tool objects", () => {
    const tool = {
      name: "cart_get",
      title: "Read cart lines",
      description: "Return cart lines.",
      inputSchema: JSON.stringify({
        type: "object",
        properties: {},
        additionalProperties: false
      }) as unknown as object,
      annotations: { readOnlyHint: true },
      origin: window.location.origin,
      window
    } as WebMCP.RegisteredTool;
    const receipt = {
      status: "consumer-ready",
      providerRegistration: "ready",
      consumerDiscovery: "verified",
      consumerExecution: "verified",
      compatibilityBinding: "verified",
      registeredToolNames: ["cart_get", "cart_update", "checkout_request", "order_review"],
      visibleToolNames: ["cart_get", "cart_update", "checkout_request", "order_review"],
      rejectedToolNames: [],
      manifest: {
        catalogState: "initial",
        toolsetVersion: "checkout-toolset-v1@1.0.0",
        domainVersion: "checkout-domain@1.0.0",
        appCommit: APP_COMMIT,
        tools: []
      },
      manifestHash: "manifest-hash",
      fixtureId: "checkout-seed-v1",
      fixtureRevision: 0,
      stateHash: "state-hash",
      argumentMode: "json-string",
      compatibilityReceipt: null,
      runtimeCatalog: { generation: 1, manifestHash: "manifest-hash", tools: [tool] },
      mismatches: [],
      checkedAt: "2026-08-27T07:00:00.000Z"
    } as unknown as RegistryReadinessReceipt;

    const projected = projectReadinessReceipt(receipt, window, window.location.origin) as {
      runtimeCatalog: {
        tools: readonly unknown[];
      };
    };
    expect(projected.runtimeCatalog).toEqual({
      generation: 1,
      manifestHash: "manifest-hash",
      tools: [
        {
          name: "cart_get",
          title: "Read cart lines",
          description: "Return cart lines.",
          inputSchemaRepresentation: "json-string",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          annotations: { readOnlyHint: true, untrustedContentHint: false },
          origin: window.location.origin,
          ownerMatchesCurrentDocument: true,
          originMatchesCurrentDocument: true
        }
      ]
    });
    expect(JSON.stringify(projected)).not.toContain('"window"');
    expect(JSON.stringify(projected)).not.toContain('"execute"');
  });

  it.each([
    '{"apiKey":"ordinary-secret-value"}',
    '{"openai_api_key":"ordinary-secret-value"}',
    '{"x-api-key":"ordinary-secret-value"}',
    '{"KV_REST_API_TOKEN":"ordinary-secret-value"}',
    '{"authorization":"Basic YWRtaW46cGFzc3dvcmQ="}',
    '{"cookie":"session=private-value"}',
    '{"url":"https://example.test/?access_token=private-value"}',
    '{"path":"/Users/example/private.txt"}',
    '{"path":"C:\\\\Users\\\\example\\\\private.txt"}',
    '{"email":"person@example.test"}'
  ])("fails closed on unsafe exported content %#", (value) => {
    expect(() => assertSafeGate1ProofJson(value)).toThrow("unsafe_export_content");
  });

  it("rejects an unsafe filename timestamp even on a typed bundle", () => {
    expect(() =>
      gate1ProofFilename({
        exportedAt: "../../unsafe",
        evidence: { provenance: { appCommit: APP_COMMIT } }
      } as unknown as Gate1ProofBundle)
    ).toThrow("exact millisecond ISO-8601 UTC timestamp");
  });
});
