"use client";

import { useEffect, useState } from "react";

import { StatusPill } from "@/components/status-pill";
import { cartGet } from "@/lib/domain/checkout";
import { verifyCheckoutReset } from "@/lib/domain/checkout-reset";
import { CheckoutSessionStore } from "@/lib/domain/checkout-session";
import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import { CheckoutTraceLedger } from "@/lib/evidence/checkout-trace-ledger";
import type { OperationTrace } from "@/lib/evidence/operation-trace";
import {
  INVOCATION_INTEGRITY_CASES,
  INVOCATION_INTEGRITY_FAILURE_INPUT_VERSION,
  INVOCATION_INTEGRITY_INITIAL_CATALOG,
  INVOCATION_INTEGRITY_INITIAL_STATE_SHA256,
  INVOCATION_INTEGRITY_PREFLIGHT_VERSION,
  INVOCATION_INTEGRITY_PAYLOADS,
  INVOCATION_INTEGRITY_PENDING_CATALOG,
  INVOCATION_INTEGRITY_RECEIPT_VERSION,
  INVOCATION_INTEGRITY_TRANSCRIPT_VERSION,
  parseInvocationIntegrityFailureInput,
  parseInvocationIntegrityFailureReceipt,
  parseInvocationIntegrityTranscript,
  projectInvocationIntegrityDescriptors,
  verifyInvocationIntegrityFailureReceipt,
  verifyInvocationIntegrityReceipt,
  type InvocationIntegrityCaseId,
  type InvocationIntegrityDescriptorProjection,
  type InvocationIntegrityFailurePreflight,
  type InvocationIntegrityFailureInput,
  type InvocationIntegrityFailureReceipt,
  type InvocationIntegrityFailureRuntimeBoundary,
  type InvocationIntegrityObservedCall,
  type InvocationIntegrityReceipt,
  type InvocationIntegritySafeFailureError,
  type InvocationIntegrityTerminalInspection,
  type InvocationIntegrityTranscript
} from "@/lib/invocation-integrity/contract";
import { detectWebMcpCapabilities, type WebMcpCapabilities } from "@/lib/webmcp/capabilities";
import { createCheckoutTools, type CheckoutToolSet } from "@/lib/webmcp/checkout-tools";
import { createRegistryReadinessReceipt } from "@/lib/webmcp/readiness";
import { WebMcpRegistryManager, type RegistryStatus } from "@/lib/webmcp/registry-manager";
import {
  WebMcpRuntime,
  WebMcpRuntimeError,
  type ExecuteOnceResult,
  type RuntimeCatalogSnapshot,
  type RuntimeCompatibilityReceipt,
  type RuntimeModelContext
} from "@/lib/webmcp/runtime";

const APP_COMMIT = process.env.NEXT_PUBLIC_TOOLPROOF_COMMIT_SHA?.trim() || "unversioned";
const BUILD_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const VERIFY_ROUTE = "/api/invocation-integrity/verify";
const FAILURE_VERIFY_ROUTE = "/api/invocation-integrity/failure";
const RUN_LOCK_VERSION = "thurstone-invocation-integrity-run-lock@1";
const RUN_LOCK_KEY = `${RUN_LOCK_VERSION}:${APP_COMMIT}`;
const RUN_OWNER_LOCK_KEY = `${RUN_LOCK_KEY}:owner`;
const RUN_LOCK_CLAIM_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const LIMITATIONS = Object.freeze([
  "This is a deterministic native WebMCP plumbing check, not a model-behavior measurement.",
  "It is outside the Meaning Matrix denominator and does not establish generality or safety.",
  "It does not validate, replace, or imply human approval of any semantic or revision artifact.",
  "The compatibility cart_get and verified reset are disclosed but excluded from II-01–II-03.",
  "One browser observation is compared with one source-fixed server replay; it is not a stability estimate."
]);

type Phase = "preparing" | "ready" | "running" | "verifying" | "verified" | "live" | "failed";
type CatalogKind = "initial" | "pending";

interface VerifiedCatalog {
  readonly kind: CatalogKind;
  readonly names: readonly string[];
  readonly manifestHash: string;
  readonly generation: number;
  readonly snapshot: RuntimeCatalogSnapshot;
}

interface PreparedRuntime {
  readonly capabilities: WebMcpCapabilities;
  readonly context: RuntimeModelContext;
  readonly initialCatalog: VerifiedCatalog;
  readonly initialDescriptors: readonly InvocationIntegrityDescriptorProjection[];
  readonly compatibilityReceipt: RuntimeCompatibilityReceipt;
  readonly compatibilityTrace: OperationTrace;
  readonly preparationBoundary: {
    readonly stateHash: string;
    readonly currentOperationCount: number;
    readonly retainedTombstoneCount: number;
    readonly currentTraceCount: number;
    readonly totalTraceCount: number;
    readonly lastTraceEventId: string;
  };
}

interface InvocationIntegrityEnvironment {
  readonly runtime: WebMcpRuntime;
  readonly registry: WebMcpRegistryManager;
  readonly ledger: CheckoutTraceLedger;
  readonly store: CheckoutSessionStore;
  readonly tools: CheckoutToolSet;
  readonly getRegistryHash: () => string;
  readonly setRegistryHash: (value: string) => void;
  readonly registerCatalog: (
    context: RuntimeModelContext,
    kind: CatalogKind,
    onStatus: (status: RegistryStatus) => void
  ) => Promise<RegistryStatus>;
  readonly disposeRegistration: () => void;
}

interface FailureContext {
  readonly stage: "native" | "verification";
  readonly label: string;
  readonly traceCountBefore: number;
}

interface InProgressRunLock {
  readonly version: typeof RUN_LOCK_VERSION;
  readonly appCommit: string;
  readonly origin: string;
  readonly claimId: string;
  readonly state: "in-progress";
  readonly startedAt: string;
}

interface TerminalRunLock {
  readonly version: typeof RUN_LOCK_VERSION;
  readonly appCommit: string;
  readonly origin: string;
  readonly claimId: string;
  readonly state: "terminal";
  readonly terminalPhase: "verified" | "failed";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly artifact: Readonly<Record<string, unknown>>;
}

type InvocationIntegrityRunLock = InProgressRunLock | TerminalRunLock;
type RunLockRecovery =
  | { readonly kind: "live" }
  | { readonly kind: "disposed" }
  | { readonly kind: "terminal"; readonly marker: TerminalRunLock };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function getRunLockManager(): LockManager {
  const manager = globalThis.navigator?.locks;
  if (!manager || typeof manager.request !== "function") {
    throw new Error("invocation_integrity_browser_lock_manager_unavailable");
  }
  return manager;
}

function getRunLockStorage(): Storage {
  try {
    const storage = globalThis.localStorage;
    storage.getItem(RUN_LOCK_KEY);
    return storage;
  } catch {
    throw new Error("invocation_integrity_browser_run_storage_unavailable");
  }
}

function writeRunLock(storage: Storage, marker: InvocationIntegrityRunLock): void {
  const serialized = JSON.stringify(marker);
  storage.setItem(RUN_LOCK_KEY, serialized);
  if (storage.getItem(RUN_LOCK_KEY) !== serialized) {
    throw new Error("invocation_integrity_browser_run_lock_write_failed");
  }
}

function parseRunLock(raw: string): InvocationIntegrityRunLock {
  const parsed = JSON.parse(raw) as unknown;
  if (
    !isRecord(parsed) ||
    parsed.version !== RUN_LOCK_VERSION ||
    parsed.appCommit !== APP_COMMIT ||
    parsed.origin !== globalThis.location.origin ||
    typeof parsed.claimId !== "string" ||
    !RUN_LOCK_CLAIM_PATTERN.test(parsed.claimId) ||
    !isIsoTimestamp(parsed.startedAt)
  ) {
    throw new Error("invocation_integrity_browser_run_lock_invalid");
  }
  if (
    parsed.state === "in-progress" &&
    hasExactKeys(parsed, ["version", "appCommit", "origin", "claimId", "state", "startedAt"])
  ) {
    return parsed as unknown as InProgressRunLock;
  }
  if (
    parsed.state === "terminal" &&
    (parsed.terminalPhase === "verified" || parsed.terminalPhase === "failed") &&
    isIsoTimestamp(parsed.completedAt) &&
    isRecord(parsed.artifact) &&
    hasExactKeys(parsed, [
      "version",
      "appCommit",
      "origin",
      "claimId",
      "state",
      "terminalPhase",
      "startedAt",
      "completedAt",
      "artifact"
    ])
  ) {
    return parsed as unknown as TerminalRunLock;
  }
  throw new Error("invocation_integrity_browser_run_lock_invalid");
}

async function armRunLock(): Promise<InProgressRunLock> {
  const manager = getRunLockManager();
  const storage = getRunLockStorage();
  return manager.request(RUN_LOCK_KEY, { mode: "exclusive" }, () => {
    if (storage.getItem(RUN_LOCK_KEY) !== null) {
      throw new Error("invocation_integrity_browser_run_already_consumed");
    }
    if (typeof globalThis.crypto?.randomUUID !== "function") {
      throw new Error("invocation_integrity_browser_run_claim_unavailable");
    }
    const marker: InProgressRunLock = Object.freeze({
      version: RUN_LOCK_VERSION,
      appCommit: APP_COMMIT,
      origin: globalThis.location.origin,
      claimId: globalThis.crypto.randomUUID(),
      state: "in-progress",
      startedAt: new Date().toISOString()
    });
    writeRunLock(storage, marker);
    return marker;
  });
}

async function sealRunLock(
  claim: InProgressRunLock,
  terminalPhase: TerminalRunLock["terminalPhase"],
  artifact: Readonly<Record<string, unknown>>
): Promise<void> {
  const manager = getRunLockManager();
  const storage = getRunLockStorage();
  await manager.request(RUN_LOCK_KEY, { mode: "exclusive" }, () => {
    const retained = storage.getItem(RUN_LOCK_KEY);
    if (retained === null) {
      throw new Error("invocation_integrity_browser_run_lock_missing");
    }
    const current = parseRunLock(retained);
    if (
      current.state !== "in-progress" ||
      current.origin !== claim.origin ||
      current.claimId !== claim.claimId ||
      current.startedAt !== claim.startedAt
    ) {
      throw new Error("invocation_integrity_browser_run_lock_claim_mismatch");
    }
    const terminal: TerminalRunLock = Object.freeze({
      version: RUN_LOCK_VERSION,
      appCommit: APP_COMMIT,
      origin: claim.origin,
      claimId: claim.claimId,
      state: "terminal",
      terminalPhase,
      startedAt: claim.startedAt,
      completedAt: new Date().toISOString(),
      artifact
    });
    writeRunLock(storage, terminal);
  });
}

function createEnvironment(): InvocationIntegrityEnvironment {
  const runtime = new WebMcpRuntime();
  const registry = new WebMcpRegistryManager();
  let registryHash = "registry-unverified";
  let registrationEpoch = 0;
  let releaseRegistration: (() => void) | null = null;
  const ledger = new CheckoutTraceLedger({
    getRegistryHash: () => registryHash,
    getArgumentMode: () => runtime.argumentMode ?? "unverified",
    appCommit: APP_COMMIT
  });
  const store = new CheckoutSessionStore({ traceSink: ledger });
  const tools = createCheckoutTools(store);
  return {
    runtime,
    registry,
    ledger,
    store,
    tools,
    getRegistryHash: () => registryHash,
    setRegistryHash: (value) => {
      registryHash = value;
    },
    registerCatalog: async (context, kind, onStatus) => {
      const expected =
        kind === "initial"
          ? INVOCATION_INTEGRITY_INITIAL_CATALOG
          : INVOCATION_INTEGRITY_PENDING_CATALOG;
      const desiredTools = kind === "initial" ? tools.initial : tools.pending;
      const epoch = ++registrationEpoch;
      releaseRegistration?.();
      releaseRegistration = null;
      let latestStatus: RegistryStatus = { phase: "idle", toolNames: [] };
      const release = registry.acquire(context, desiredTools, (status) => {
        if (registrationEpoch !== epoch) return;
        latestStatus = status;
        onStatus(status);
      });
      releaseRegistration = release;
      await registry.settled();
      if (
        registrationEpoch !== epoch ||
        latestStatus.phase !== "ready" ||
        !sameNames(latestStatus.toolNames, expected) ||
        !latestStatus.generation
      ) {
        throw new Error(`invocation_integrity_${kind}_provider_registration_failed`);
      }
      return latestStatus;
    },
    disposeRegistration: () => {
      registrationEpoch += 1;
      releaseRegistration?.();
      releaseRegistration = null;
    }
  };
}

function sameNames(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((name, index) => name === expected[index])
  );
}

function latestTrace(environment: InvocationIntegrityEnvironment): OperationTrace | null {
  return environment.ledger.snapshot().current.at(-1) ?? null;
}

async function observeRuntime(environment: InvocationIntegrityEnvironment) {
  const snapshot = environment.ledger.snapshot();
  const trace = latestTrace(environment);
  const stateHash = await canonicalSha256(environment.store.getSnapshot().state);
  const lastTrace = trace
    ? {
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
    : null;
  return {
    stateHash,
    manifestHash: environment.getRegistryHash(),
    handlerTraceCount: snapshot.totalTraceCount,
    ...(trace ? { lastHandlerTraceId: trace.eventId } : {}),
    ...(lastTrace ? { lastEffectDigest: lastTrace.effectDigest } : {}),
    lastTrace
  };
}

async function discoverCatalog(
  environment: InvocationIntegrityEnvironment,
  context: RuntimeModelContext,
  kind: CatalogKind,
  registration: RegistryStatus,
  compatibilityReceipt?: RuntimeCompatibilityReceipt
): Promise<VerifiedCatalog> {
  const expected =
    kind === "initial"
      ? INVOCATION_INTEGRITY_INITIAL_CATALOG
      : INVOCATION_INTEGRITY_PENDING_CATALOG;
  const receipt = await createRegistryReadinessReceipt(context, {
    state: environment.store.getSnapshot().state,
    appCommit: APP_COMMIT,
    registrationGeneration: registration.generation as number,
    ...(compatibilityReceipt ? { compatibilityReceipt } : {})
  });
  const names = receipt.runtimeCatalog?.tools.map(({ name }) => name) ?? [];
  if (
    receipt.consumerDiscovery !== "verified" ||
    receipt.mismatches.length !== 0 ||
    !receipt.runtimeCatalog ||
    !sameNames(names, expected) ||
    receipt.manifest.catalogState !== kind
  ) {
    throw new Error(`invocation_integrity_${kind}_same_origin_catalog_mismatch`);
  }
  if (
    compatibilityReceipt &&
    (receipt.status !== "consumer-ready" ||
      receipt.consumerExecution !== "verified" ||
      receipt.compatibilityBinding !== "verified")
  ) {
    throw new Error(`invocation_integrity_${kind}_consumer_execution_unverified`);
  }
  return Object.freeze({
    kind,
    names: Object.freeze([...names]),
    manifestHash: receipt.manifestHash,
    generation: receipt.runtimeCatalog.generation,
    snapshot: receipt.runtimeCatalog
  });
}

function descriptorProjection(
  catalog: VerifiedCatalog
): readonly InvocationIntegrityDescriptorProjection[] {
  return projectInvocationIntegrityDescriptors(catalog.snapshot.tools);
}

function holdCatalogCalls(
  environment: InvocationIntegrityEnvironment,
  catalog: VerifiedCatalog,
  toolNames: readonly string[]
): () => void {
  const releases: Array<() => void> = [];
  try {
    for (const toolName of toolNames) {
      releases.push(environment.registry.holdConsumerCall(toolName, catalog.generation));
    }
  } catch (error) {
    releases.reverse().forEach((release) => release());
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releases.reverse().forEach((release) => release());
  };
}

async function terminalInspection(
  environment: InvocationIntegrityEnvironment
): Promise<InvocationIntegrityTerminalInspection> {
  const inspection = environment.store.inspect();
  const ledger = environment.ledger.snapshot();
  return {
    sessionId: inspection.sessionId,
    trajectoryId: inspection.trajectoryId,
    state: inspection.state,
    stateHash: await canonicalSha256(inspection.state),
    stateRevision: inspection.state.revision,
    currentOperationCount: inspection.currentOperationCount,
    retainedTombstoneCount: inspection.retainedTombstoneCount,
    currentTraceCount: inspection.currentTraceCount,
    totalTraceCount: ledger.totalTraceCount,
    haltedReason: inspection.haltedReason,
    lastTraceEventId: latestTrace(environment)?.eventId ?? null
  };
}

async function admitMeasuredSequence(
  environment: InvocationIntegrityEnvironment,
  prepared: PreparedRuntime,
  onStatus: (status: RegistryStatus) => void
): Promise<{
  readonly catalog: VerifiedCatalog;
  readonly preflight: InvocationIntegrityFailurePreflight;
  readonly resetEventId: string;
}> {
  const inspection = environment.store.inspect();
  const ledger = environment.ledger.snapshot();
  const stateHash = await canonicalSha256(inspection.state);
  const registration: RegistryStatus = {
    phase: "ready",
    toolNames: prepared.initialCatalog.names,
    generation: prepared.initialCatalog.generation
  };
  const liveCatalog = await discoverCatalog(
    environment,
    prepared.context,
    "initial",
    registration,
    prepared.compatibilityReceipt
  );
  if (
    stateHash !== prepared.preparationBoundary.stateHash ||
    inspection.currentOperationCount !== prepared.preparationBoundary.currentOperationCount ||
    inspection.retainedTombstoneCount !== prepared.preparationBoundary.retainedTombstoneCount ||
    inspection.currentTraceCount !== prepared.preparationBoundary.currentTraceCount ||
    ledger.totalTraceCount !== prepared.preparationBoundary.totalTraceCount ||
    latestTrace(environment)?.eventId !== prepared.preparationBoundary.lastTraceEventId ||
    liveCatalog.manifestHash !== prepared.initialCatalog.manifestHash ||
    canonicalJson(descriptorProjection(liveCatalog)) !== canonicalJson(prepared.initialDescriptors)
  ) {
    throw new Error("invocation_integrity_run_admission_contaminated");
  }

  const domainReceipt = await environment.store.hardReset({
    source: "ui",
    holdForVerification: true
  });
  try {
    const resetLedger = environment.ledger.snapshot();
    const resetTrace = resetLedger.lastResetTrace;
    if (
      !resetTrace ||
      resetTrace.toolName !== "fixture_reset" ||
      resetTrace.parentEventId !== prepared.compatibilityTrace.eventId
    ) {
      throw new Error("invocation_integrity_reset_trace_missing");
    }
    const verifiedReceipt = await verifyCheckoutReset({
      domainReceipt,
      inspection: environment.store.inspect(),
      archives: environment.store.archivedTrajectories(),
      traceLedger: resetLedger,
      registry: {
        verified: true,
        registryHash: liveCatalog.manifestHash,
        registeredToolNames: liveCatalog.names
      },
      checkedAt: new Date().toISOString()
    });
    if (verifiedReceipt.status !== "verified") {
      throw new Error("invocation_integrity_reset_verification_failed");
    }
    const postResetCatalog = await discoverCatalog(
      environment,
      prepared.context,
      "initial",
      registration,
      prepared.compatibilityReceipt
    );
    const postResetInspection = environment.store.inspect();
    const postResetLedger = environment.ledger.snapshot();
    const postResetStateHash = await canonicalSha256(postResetInspection.state);
    if (
      postResetStateHash !== INVOCATION_INTEGRITY_INITIAL_STATE_SHA256 ||
      postResetInspection.currentOperationCount !== 0 ||
      postResetInspection.retainedTombstoneCount !== 0 ||
      postResetInspection.currentTraceCount !== 0 ||
      postResetInspection.archivedTrajectoryCount !== 1 ||
      postResetInspection.haltedReason !== null ||
      postResetLedger.current.length !== 0 ||
      postResetLedger.archives.length !== 1 ||
      postResetLedger.archives[0]?.traces.length !== 1 ||
      postResetLedger.resetTraces.length !== 1 ||
      postResetLedger.totalTraceCount !== 2 ||
      postResetCatalog.manifestHash !== prepared.initialCatalog.manifestHash ||
      canonicalJson(descriptorProjection(postResetCatalog)) !==
        canonicalJson(prepared.initialDescriptors)
    ) {
      throw new Error("invocation_integrity_post_reset_boundary_invalid");
    }
    environment.runtime.verifyRegistry(postResetCatalog.snapshot);
    if (!environment.store.releaseResetAdmission(verifiedReceipt.resetId)) {
      throw new Error("invocation_integrity_reset_release_failed");
    }
    onStatus({
      phase: "ready",
      toolNames: postResetCatalog.names,
      generation: postResetCatalog.generation
    });
    return {
      catalog: postResetCatalog,
      resetEventId: resetTrace.eventId,
      preflight: {
        preflightVersion: INVOCATION_INTEGRITY_PREFLIGHT_VERSION,
        initialDescriptors: descriptorProjection(postResetCatalog),
        pendingDescriptors: null,
        compatibility: {
          receipt: prepared.compatibilityReceipt,
          trace: prepared.compatibilityTrace
        },
        reset: { domainReceipt, verifiedReceipt, trace: resetTrace },
        caseTraceOffset: 2,
        postReset: {
          inspection: {
            sessionId: postResetInspection.sessionId,
            trajectoryId: postResetInspection.trajectoryId,
            state: postResetInspection.state,
            stateHash: postResetStateHash,
            haltedReason: null,
            currentOperationCount: 0,
            retainedTombstoneCount: 0,
            currentTraceCount: 0,
            archivedTrajectoryCount: 1,
            lastResetTraceEventId: resetTrace.eventId
          },
          trajectory: {
            currentTraceCount: 0,
            archivedTrajectoryCount: 1,
            archivedTraceCount: 1,
            resetTraceCount: 1,
            totalTraceCount: 2
          }
        }
      }
    };
  } catch (error) {
    environment.store.abandonResetAdmission();
    throw error;
  }
}

async function safeFailureError(
  error: unknown,
  stage: "native" | "verification"
): Promise<InvocationIntegritySafeFailureError> {
  if (error instanceof WebMcpRuntimeError) {
    return {
      stage,
      name: error.name,
      message: error.message,
      code: error.code,
      nativeCallMade: error.nativeCallMade,
      rawResultSha256: typeof error.rawResult === "string" ? await sha256Hex(error.rawResult) : null
    };
  }
  const evidence = errorEvidence(error);
  const message = String(evidence.message ?? "The fixed run failed.").slice(0, 500);
  const fallbackCode = /^[A-Za-z0-9_.:-]{1,80}$/u.test(message) ? message : null;
  return {
    stage,
    name: String(evidence.name ?? "InvocationIntegrityError").slice(0, 80),
    message,
    code:
      typeof evidence.code === "string" && /^[A-Za-z0-9_.:-]{1,80}$/u.test(evidence.code)
        ? evidence.code
        : fallbackCode,
    nativeCallMade: evidence.nativeCallMade === true,
    rawResultSha256: null
  };
}

function errorEvidence(error: unknown): Readonly<Record<string, unknown>> {
  if (error instanceof WebMcpRuntimeError) {
    return Object.freeze({
      name: error.name,
      message: error.message,
      code: error.code,
      nativeCallMade: error.nativeCallMade,
      rawResult: error.rawResult ?? null
    });
  }
  if (error instanceof Error) {
    return Object.freeze({ name: error.name, message: error.message });
  }
  return Object.freeze({ name: "Error", message: "Unknown invocation-integrity failure." });
}

async function browserRunLockFailureArtifact(
  status: "failed-interrupted-browser-run" | "failed-browser-run-lock",
  message: string,
  startedAt: string | null
): Promise<Readonly<Record<string, unknown>>> {
  const core = Object.freeze({
    status,
    buildSha: APP_COMMIT,
    origin: globalThis.location.origin,
    browserRunLock: {
      version: RUN_LOCK_VERSION,
      storage: "same-origin-localStorage",
      scope: "this-browser-profile",
      ...(startedAt ? { startedAt } : {})
    },
    error: {
      name: "InvocationIntegrityBrowserRunLock",
      message
    },
    claimAllowed: false,
    modelCallCount: 0,
    includedInSemanticDenominator: false,
    failedAt: new Date().toISOString()
  });
  return Object.freeze({ ...core, artifactDigest: await canonicalSha256(core) });
}

function caseContract(caseId: InvocationIntegrityCaseId) {
  const contract = INVOCATION_INTEGRITY_CASES.find((entry) => entry.caseId === caseId);
  if (!contract) throw new Error(`invocation_integrity_case_${caseId}_missing`);
  return contract;
}

async function executeObservedCall(
  environment: InvocationIntegrityEnvironment,
  catalog: VerifiedCatalog,
  caseId: InvocationIntegrityCaseId,
  callIndex: 1 | 2,
  expectedTraceCountBefore: number,
  expectedParentEventId: string
): Promise<InvocationIntegrityObservedCall> {
  const contract = caseContract(caseId);
  const tool = catalog.snapshot.tools.find(({ name }) => name === contract.toolName);
  if (!tool) throw new Error(`invocation_integrity_${caseId}_tool_missing`);
  const traceBefore = environment.ledger.snapshot();
  const priorTrace = latestTrace(environment) ?? traceBefore.lastResetTrace;
  if (
    traceBefore.totalTraceCount !== expectedTraceCountBefore ||
    priorTrace?.eventId !== expectedParentEventId
  ) {
    throw new Error("invocation_integrity_sequence_admission_contaminated");
  }
  const releaseConsumer = environment.registry.holdConsumerCall(tool.name, catalog.generation);
  let receipt: ExecuteOnceResult;
  try {
    receipt = await environment.runtime.executeOnce({
      executionId: `invocation_integrity_${caseId.toLowerCase()}_${callIndex}`,
      manifestHash: catalog.manifestHash,
      tool,
      input: INVOCATION_INTEGRITY_PAYLOADS[caseId],
      observe: () => observeRuntime(environment)
    });
  } finally {
    releaseConsumer();
  }
  const snapshot = environment.ledger.snapshot();
  const trace = latestTrace(environment);
  if (
    snapshot.totalTraceCount !== expectedTraceCountBefore + 1 ||
    !trace ||
    trace.eventId !== receipt.handlerTraceId ||
    trace.parentEventId !== expectedParentEventId ||
    trace.sequence !== expectedTraceCountBefore + 1 ||
    trace.source !== "native" ||
    trace.toolName !== contract.toolName
  ) {
    throw new Error(`invocation_integrity_${caseId}_browser_trace_mismatch`);
  }
  return Object.freeze({ caseId, callIndex, receipt, trace });
}

function assertReceiptBinding(
  receipt: InvocationIntegrityReceipt,
  transcript: InvocationIntegrityTranscript
): void {
  if (
    receipt.receiptVersion !== INVOCATION_INTEGRITY_RECEIPT_VERSION ||
    receipt.status !== "verified" ||
    receipt.buildSha !== transcript.runtime.appCommit ||
    receipt.initialManifestHash !== transcript.runtime.initialManifestHash ||
    receipt.pendingManifestHash !== transcript.runtime.pendingManifestHash ||
    receipt.modelCallCount !== 0 ||
    receipt.includedInSemanticDenominator !== false ||
    receipt.score.earned !== 3 ||
    receipt.score.possible !== 3 ||
    !sameNames(
      receipt.rows.map(({ caseId }) => caseId),
      INVOCATION_INTEGRITY_CASES.map(({ caseId }) => caseId)
    )
  ) {
    throw new Error("invocation_integrity_verifier_receipt_binding_mismatch");
  }
}

function phaseLabel(phase: Phase): string {
  switch (phase) {
    case "preparing":
      return "Checking native APIs";
    case "ready":
      return "Fixed sequence ready";
    case "running":
      return "Native sequence running";
    case "verifying":
      return "Source-fixed replay running";
    case "verified":
      return "Verified · 3/3";
    case "live":
      return "Live run owns this build";
    case "failed":
      return "Failed closed";
  }
}

function statusState(phase: Phase): "ready" | "pending" | "blocked" | "neutral" {
  if (phase === "verified" || phase === "ready") return "ready";
  if (phase === "running" || phase === "verifying" || phase === "preparing") return "pending";
  if (phase === "live" || phase === "failed") return "blocked";
  return "neutral";
}

export function InvocationIntegrityClient() {
  const [environment] = useState(createEnvironment);
  const [phase, setPhase] = useState<Phase>("preparing");
  const [registryStatus, setRegistryStatus] = useState<RegistryStatus>({
    phase: "idle",
    toolNames: []
  });
  const [prepared, setPrepared] = useState<PreparedRuntime | null>(null);
  const [runConsumed, setRunConsumed] = useState(false);
  const [completedCallCount, setCompletedCallCount] = useState(0);
  const [receipt, setReceipt] = useState<InvocationIntegrityReceipt | null>(null);
  const [failureReceipt, setFailureReceipt] = useState<InvocationIntegrityFailureReceipt | null>(
    null
  );
  const [failure, setFailure] = useState<Readonly<Record<string, unknown>> | null>(null);
  const [artifact, setArtifact] = useState<Readonly<Record<string, unknown>> | null>(null);
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      let storedRunLock: string | null;
      try {
        getRunLockManager();
        storedRunLock = getRunLockStorage().getItem(RUN_LOCK_KEY);
      } catch {
        const message =
          "The browser LockManager or local one-run storage is unavailable; the fixed sequence remains blocked.";
        const lockedArtifact = await browserRunLockFailureArtifact(
          "failed-browser-run-lock",
          message,
          null
        );
        if (!disposed) {
          setRunConsumed(true);
          setFailure({ name: "InvocationIntegrityBrowserRunLock", message });
          setArtifact(lockedArtifact);
          setPhase("failed");
        }
        return;
      }
      if (storedRunLock !== null) {
        setRunConsumed(true);
        try {
          let marker = parseRunLock(storedRunLock);
          if (marker.state === "in-progress") {
            const abandonedClaim = marker;
            const attemptRecovery = async (): Promise<RunLockRecovery> =>
              getRunLockManager().request(
                RUN_OWNER_LOCK_KEY,
                { mode: "exclusive", ifAvailable: true },
                async (owner) => {
                  if (!owner) return { kind: "live" };
                  const retainedRaw = getRunLockStorage().getItem(RUN_LOCK_KEY);
                  if (retainedRaw === null) {
                    throw new Error("invocation_integrity_browser_run_lock_missing");
                  }
                  const retained = parseRunLock(retainedRaw);
                  if (retained.state === "terminal") {
                    return { kind: "terminal", marker: retained };
                  }
                  if (
                    retained.origin !== abandonedClaim.origin ||
                    retained.claimId !== abandonedClaim.claimId ||
                    retained.startedAt !== abandonedClaim.startedAt
                  ) {
                    throw new Error("invocation_integrity_browser_run_lock_claim_mismatch");
                  }
                  if (disposed) return { kind: "disposed" };
                  const message =
                    "A fixed sequence started for this build but did not save terminal evidence; it is treated as interrupted and cannot be rerun in this browser profile.";
                  const interruptedArtifact = await browserRunLockFailureArtifact(
                    "failed-interrupted-browser-run",
                    message,
                    retained.startedAt
                  );
                  await sealRunLock(retained, "failed", interruptedArtifact);
                  const terminalRaw = getRunLockStorage().getItem(RUN_LOCK_KEY);
                  if (terminalRaw === null) {
                    throw new Error("invocation_integrity_browser_run_lock_missing");
                  }
                  const terminal = parseRunLock(terminalRaw);
                  if (
                    terminal.state !== "terminal" ||
                    terminal.origin !== retained.origin ||
                    terminal.claimId !== retained.claimId ||
                    terminal.startedAt !== retained.startedAt
                  ) {
                    throw new Error("invocation_integrity_browser_run_lock_claim_mismatch");
                  }
                  return { kind: "terminal", marker: terminal };
                }
              );

            let recovery = await attemptRecovery();
            if (recovery.kind === "live") {
              await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 25));
              recovery = await attemptRecovery();
            }
            if (recovery.kind === "live") {
              const message =
                "A live fixed sequence owns this build in another tab. This tab made no native or verifier calls; reload after the owner finishes to restore its terminal artifact.";
              if (!disposed) {
                setFailure({ name: "InvocationIntegrityLiveRun", message });
                setArtifact(null);
                setPhase("live");
              }
              return;
            }
            if (recovery.kind === "disposed") return;
            marker = recovery.marker;
          }

          if (marker.terminalPhase === "verified") {
            const verifiedReceipt = await verifyInvocationIntegrityReceipt(marker.artifact);
            if (verifiedReceipt.buildSha !== APP_COMMIT) {
              throw new Error("invocation_integrity_browser_run_lock_build_mismatch");
            }
            if (!disposed) {
              setCompletedCallCount(4);
              setReceipt(verifiedReceipt);
              setArtifact(verifiedReceipt as unknown as Readonly<Record<string, unknown>>);
              setPhase("verified");
            }
            return;
          }

          if (marker.artifact.status === "failed") {
            const verifiedFailure = await verifyInvocationIntegrityFailureReceipt(
              parseInvocationIntegrityFailureReceipt(marker.artifact)
            );
            if (verifiedFailure.buildSha !== APP_COMMIT) {
              throw new Error("invocation_integrity_browser_run_lock_build_mismatch");
            }
            if (!disposed) {
              setCompletedCallCount(Math.min(4, verifiedFailure.completedCalls.length));
              setFailureReceipt(verifiedFailure);
              setFailure(verifiedFailure.error as unknown as Readonly<Record<string, unknown>>);
              setArtifact(verifiedFailure as unknown as Readonly<Record<string, unknown>>);
              setPhase("failed");
            }
            return;
          }

          if (!disposed) {
            const recoveredFailure = isRecord(marker.artifact.error)
              ? marker.artifact.error
              : {
                  name: "InvocationIntegrityBrowserRunLock",
                  message: "The retained fixed-run artifact records a terminal failure."
                };
            const completedCalls = Array.isArray(marker.artifact.completedCalls)
              ? marker.artifact.completedCalls.length
              : 0;
            setCompletedCallCount(Math.min(4, completedCalls));
            setFailure(recoveredFailure);
            setArtifact(marker.artifact);
            setPhase("failed");
          }
          return;
        } catch {
          const message =
            "The browser-local one-run record for this build is invalid; execution remains blocked.";
          const invalidArtifact = await browserRunLockFailureArtifact(
            "failed-browser-run-lock",
            message,
            null
          );
          if (!disposed) {
            setFailure({ name: "InvocationIntegrityBrowserRunLock", message });
            setArtifact(invalidArtifact);
            setPhase("failed");
          }
          return;
        }
      }

      try {
        const capabilities = detectWebMcpCapabilities();
        if (
          !capabilities.secureContext ||
          !capabilities.providerRegistration ||
          !capabilities.inPageDiscovery ||
          !capabilities.inPageExecution
        ) {
          throw new Error("invocation_integrity_secure_provider_consumer_apis_unavailable");
        }
        if (!BUILD_SHA_PATTERN.test(APP_COMMIT)) {
          throw new Error("invocation_integrity_build_sha_unavailable");
        }
        const context = document.modelContext as RuntimeModelContext;
        const registration = await environment.registerCatalog(
          context,
          "initial",
          setRegistryStatus
        );
        if (disposed) return;
        const discovered = await discoverCatalog(environment, context, "initial", registration);
        environment.setRegistryHash(discovered.manifestHash);
        const cartTool = discovered.snapshot.tools.find(({ name }) => name === "cart_get");
        if (!cartTool) throw new Error("invocation_integrity_compatibility_tool_missing");
        const compatibilityReceipt = await environment.runtime.initializeWithCartGet({
          context,
          catalog: discovered.snapshot,
          cartTool,
          expectedCartResult: cartGet(environment.store.getSnapshot().state),
          observe: () => observeRuntime(environment)
        });
        const compatibilityTrace = latestTrace(environment);
        if (!compatibilityTrace || compatibilityTrace.toolName !== "cart_get") {
          throw new Error("invocation_integrity_compatibility_trace_missing");
        }
        const initialCatalog = await discoverCatalog(
          environment,
          context,
          "initial",
          registration,
          compatibilityReceipt
        );
        const preparationInspection = environment.store.inspect();
        const preparationLedger = environment.ledger.snapshot();
        const stateHash = await canonicalSha256(preparationInspection.state);
        if (
          stateHash !== INVOCATION_INTEGRITY_INITIAL_STATE_SHA256 ||
          preparationInspection.currentOperationCount !== 0 ||
          preparationInspection.retainedTombstoneCount !== 0 ||
          preparationInspection.currentTraceCount !== 1 ||
          preparationInspection.archivedTrajectoryCount !== 0 ||
          preparationLedger.current.length !== 1 ||
          preparationLedger.archives.length !== 0 ||
          preparationLedger.resetTraces.length !== 0 ||
          preparationLedger.totalTraceCount !== 1 ||
          preparationLedger.current[0]?.eventId !== compatibilityTrace.eventId
        ) {
          throw new Error("invocation_integrity_preparation_boundary_invalid");
        }
        environment.runtime.verifyRegistry(initialCatalog.snapshot);
        if (!disposed) {
          setPrepared({
            capabilities,
            context,
            initialCatalog,
            initialDescriptors: descriptorProjection(initialCatalog),
            compatibilityReceipt,
            compatibilityTrace,
            preparationBoundary: {
              stateHash,
              currentOperationCount: preparationInspection.currentOperationCount,
              retainedTombstoneCount: preparationInspection.retainedTombstoneCount,
              currentTraceCount: preparationInspection.currentTraceCount,
              totalTraceCount: preparationLedger.totalTraceCount,
              lastTraceEventId: compatibilityTrace.eventId
            }
          });
          setPhase("ready");
        }
      } catch (error) {
        if (!disposed) {
          environment.store.abandonResetAdmission();
          setFailure(errorEvidence(error));
          setPhase("failed");
        }
      }
    })();
    return () => {
      disposed = true;
      environment.disposeRegistration();
    };
  }, [environment]);

  async function executeOwnedFixedSequence(): Promise<void> {
    if (!prepared) return;
    let runLock: InProgressRunLock;
    try {
      runLock = await armRunLock();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The browser-local one-run guard could not be armed.";
      const lockedArtifact = await browserRunLockFailureArtifact(
        "failed-browser-run-lock",
        message,
        null
      );
      setRunConsumed(true);
      setFailure(errorEvidence(error));
      setArtifact(lockedArtifact);
      setPhase("failed");
      return;
    }
    setRunConsumed(true);
    setFailure(null);
    setFailureReceipt(null);
    setPhase("running");
    const observedCalls: InvocationIntegrityObservedCall[] = [];
    let measuredPreflight: InvocationIntegrityFailurePreflight | null = null;
    let measuredInitialCatalog: VerifiedCatalog | null = null;
    let pendingCatalog: VerifiedCatalog | null = null;
    let releaseInitialSequenceHold: (() => void) | null = null;
    let releasePendingSequenceHold: (() => void) | null = null;
    let failureContext: FailureContext = {
      stage: "native",
      label: "run admission",
      traceCountBefore: environment.ledger.snapshot().totalTraceCount
    };
    try {
      const admission = await admitMeasuredSequence(environment, prepared, setRegistryStatus);
      measuredInitialCatalog = admission.catalog;
      measuredPreflight = admission.preflight;
      releaseInitialSequenceHold = holdCatalogCalls(environment, admission.catalog, [
        "cart_update",
        "checkout_request"
      ]);

      failureContext = {
        stage: "native",
        label: "II-01 call 1",
        traceCountBefore: environment.ledger.snapshot().totalTraceCount
      };
      observedCalls.push(
        await executeObservedCall(
          environment,
          admission.catalog,
          "II-01",
          1,
          admission.preflight.caseTraceOffset,
          admission.resetEventId
        )
      );
      setCompletedCallCount(1);

      failureContext = {
        stage: "native",
        label: "II-02 call 1",
        traceCountBefore: environment.ledger.snapshot().totalTraceCount
      };
      observedCalls.push(
        await executeObservedCall(
          environment,
          admission.catalog,
          "II-02",
          1,
          admission.preflight.caseTraceOffset + 1,
          observedCalls[0]!.trace.eventId
        )
      );
      setCompletedCallCount(2);

      failureContext = {
        stage: "native",
        label: "II-03 call 1",
        traceCountBefore: environment.ledger.snapshot().totalTraceCount
      };
      observedCalls.push(
        await executeObservedCall(
          environment,
          admission.catalog,
          "II-03",
          1,
          admission.preflight.caseTraceOffset + 2,
          observedCalls[1]!.trace.eventId
        )
      );
      setCompletedCallCount(3);

      failureContext = {
        stage: "native",
        label: "pending catalog discovery",
        traceCountBefore: environment.ledger.snapshot().totalTraceCount
      };
      releaseInitialSequenceHold();
      releaseInitialSequenceHold = null;
      const pendingRegistration = await environment.registerCatalog(
        prepared.context,
        "pending",
        setRegistryStatus
      );
      pendingCatalog = await discoverCatalog(
        environment,
        prepared.context,
        "pending",
        pendingRegistration,
        prepared.compatibilityReceipt
      );
      environment.setRegistryHash(pendingCatalog.manifestHash);
      environment.runtime.verifyRegistry(pendingCatalog.snapshot);
      const pendingDescriptors = descriptorProjection(pendingCatalog);
      measuredPreflight = {
        ...admission.preflight,
        pendingDescriptors
      };
      releasePendingSequenceHold = holdCatalogCalls(environment, pendingCatalog, [
        "checkout_request"
      ]);

      failureContext = {
        stage: "native",
        label: "II-03 call 2",
        traceCountBefore: environment.ledger.snapshot().totalTraceCount
      };
      observedCalls.push(
        await executeObservedCall(
          environment,
          pendingCatalog,
          "II-03",
          2,
          admission.preflight.caseTraceOffset + 3,
          observedCalls[2]!.trace.eventId
        )
      );
      setCompletedCallCount(4);
      releasePendingSequenceHold();
      releasePendingSequenceHold = null;

      const calls = observedCalls as unknown as InvocationIntegrityTranscript["calls"];
      const transcript = parseInvocationIntegrityTranscript({
        transcriptVersion: INVOCATION_INTEGRITY_TRANSCRIPT_VERSION,
        runtime: {
          secureContext: true,
          providerRegistration: true,
          inPageDiscovery: true,
          inPageExecution: true,
          origin: globalThis.location.origin,
          appCommit: APP_COMMIT,
          argumentMode: prepared.compatibilityReceipt.argumentMode,
          userAgent: globalThis.navigator.userAgent,
          initialCatalog: admission.catalog.names,
          pendingCatalog: pendingCatalog.names,
          initialManifestHash: admission.catalog.manifestHash,
          pendingManifestHash: pendingCatalog.manifestHash
        },
        preflight: measuredPreflight,
        calls
      });

      setPhase("verifying");
      failureContext = {
        stage: "verification",
        label: "source-fixed verifier",
        traceCountBefore: environment.ledger.snapshot().totalTraceCount
      };
      const response = await fetch(VERIFY_ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(transcript),
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error"
      });
      const responseBody = (await response.json()) as unknown;
      if (!response.ok) {
        const code =
          typeof responseBody === "object" &&
          responseBody !== null &&
          typeof (responseBody as { readonly error?: unknown }).error === "string"
            ? (responseBody as { readonly error: string }).error
            : "invocation_integrity_verifier_rejected";
        throw new Error(code);
      }
      const verifiedReceipt = await verifyInvocationIntegrityReceipt(responseBody);
      assertReceiptBinding(verifiedReceipt, transcript);
      await sealRunLock(
        runLock,
        "verified",
        verifiedReceipt as unknown as Readonly<Record<string, unknown>>
      );
      setReceipt(verifiedReceipt);
      setArtifact(verifiedReceipt as unknown as Readonly<Record<string, unknown>>);
      setPhase("verified");
    } catch (error) {
      releaseInitialSequenceHold?.();
      releasePendingSequenceHold?.();
      environment.store.abandonResetAdmission();
      const errorRecord = errorEvidence(error);
      setFailure(errorRecord);
      if (measuredPreflight && measuredInitialCatalog) {
        try {
          const pendingBoundaryVerified = measuredPreflight.pendingDescriptors !== null;
          const runtime: InvocationIntegrityFailureRuntimeBoundary = {
            secureContext: true,
            providerRegistration: true,
            inPageDiscovery: true,
            inPageExecution: true,
            origin: globalThis.location.origin,
            appCommit: APP_COMMIT,
            argumentMode: prepared.compatibilityReceipt.argumentMode,
            userAgent: globalThis.navigator.userAgent,
            initialCatalog: measuredInitialCatalog.names,
            pendingCatalog: pendingBoundaryVerified ? (pendingCatalog?.names ?? null) : null,
            initialManifestHash: measuredInitialCatalog.manifestHash,
            pendingManifestHash: pendingBoundaryVerified
              ? (pendingCatalog?.manifestHash ?? null)
              : null
          };
          const failedAt = new Date().toISOString();
          const failureInput: InvocationIntegrityFailureInput =
            parseInvocationIntegrityFailureInput({
              failureInputVersion: INVOCATION_INTEGRITY_FAILURE_INPUT_VERSION,
              runtime,
              preflight: measuredPreflight,
              completedCalls: observedCalls,
              error: await safeFailureError(error, failureContext.stage),
              terminalInspection: await terminalInspection(environment),
              failedAt
            });
          const response = await fetch(FAILURE_VERIFY_ROUTE, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(failureInput),
            credentials: "same-origin",
            cache: "no-store",
            redirect: "error"
          });
          const responseBody = (await response.json()) as unknown;
          if (!response.ok) throw new Error("invocation_integrity_failure_verifier_rejected");
          const verifiedFailure = await verifyInvocationIntegrityFailureReceipt(
            parseInvocationIntegrityFailureReceipt(responseBody)
          );
          setFailureReceipt(verifiedFailure);
          const terminalArtifact = verifiedFailure as unknown as Readonly<Record<string, unknown>>;
          try {
            await sealRunLock(runLock, "failed", terminalArtifact);
          } catch {
            // The in-progress marker remains the fail-closed record for this build.
          }
          setArtifact(terminalArtifact);
        } catch (failureReceiptError) {
          const localCore = {
            status: "failed-unverified",
            buildSha: APP_COMMIT,
            origin: globalThis.location.origin,
            completedCalls: observedCalls,
            failureContext,
            error: await safeFailureError(error, failureContext.stage),
            failureReceiptError: errorEvidence(failureReceiptError),
            terminalInspection: await terminalInspection(environment),
            claimAllowed: false,
            failedAt: new Date().toISOString()
          };
          const terminalArtifact = Object.freeze({
            ...localCore,
            artifactDigest: await canonicalSha256(localCore)
          });
          try {
            await sealRunLock(runLock, "failed", terminalArtifact);
          } catch {
            // The in-progress marker remains the fail-closed record for this build.
          }
          setArtifact(terminalArtifact);
        }
      } else {
        const localCore = {
          status: "failed-before-II-dispatch",
          buildSha: APP_COMMIT,
          origin: globalThis.location.origin,
          compatibility: {
            receipt: prepared.compatibilityReceipt,
            trace: prepared.compatibilityTrace
          },
          preparationBoundary: prepared.preparationBoundary,
          error: await safeFailureError(error, failureContext.stage),
          terminalInspection: await terminalInspection(environment),
          claimAllowed: false,
          failedAt: new Date().toISOString()
        };
        const terminalArtifact = Object.freeze({
          ...localCore,
          artifactDigest: await canonicalSha256(localCore)
        });
        try {
          await sealRunLock(runLock, "failed", terminalArtifact);
        } catch {
          // The in-progress marker remains the fail-closed record for this build.
        }
        setArtifact(terminalArtifact);
      }
      setPhase("failed");
    }
  }

  async function runFixedSequence(): Promise<void> {
    if (!prepared || runConsumed || phase !== "ready") return;
    setRunConsumed(true);
    setFailure(null);
    setFailureReceipt(null);
    setArtifact(null);
    setPhase("running");
    try {
      const acquired = await getRunLockManager().request(
        RUN_OWNER_LOCK_KEY,
        { mode: "exclusive", ifAvailable: true },
        async (owner) => {
          if (!owner) return false;
          await executeOwnedFixedSequence();
          return true;
        }
      );
      if (!acquired) {
        const message =
          "A live fixed sequence already owns this build in another tab. This tab made no native or verifier calls; reload after the owner finishes to restore its terminal artifact.";
        setFailure({ name: "InvocationIntegrityLiveRun", message });
        setPhase("live");
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The browser-local one-run owner lock could not be acquired.";
      const lockedArtifact = await browserRunLockFailureArtifact(
        "failed-browser-run-lock",
        message,
        null
      );
      setFailure(errorEvidence(error));
      setArtifact(lockedArtifact);
      setPhase("failed");
    }
  }

  function downloadCompleteJson(): void {
    if (!artifact || downloaded) return;
    setDownloaded(true);
    const blob = new Blob([`${JSON.stringify(artifact, null, 2)}\n`], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `thurstone-invocation-integrity-${APP_COMMIT.slice(0, 12)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <section className="panel" aria-labelledby="invocation-integrity-boundary">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Declared boundary</span>
            <h2 id="invocation-integrity-boundary">
              Zero model calls. Zero server durable-store writes.
            </h2>
          </div>
          <StatusPill state={statusState(phase)}>
            {phase === "failed" &&
            String(failure?.message ?? "") ===
              "invocation_integrity_secure_provider_consumer_apis_unavailable"
              ? "WebMCP unavailable in this browser"
              : phaseLabel(phase)}
          </StatusPill>
        </div>
        <p>
          The browser supplies only native receipts and traces from the source-fixed calls. The
          verifier accepts no caller-selected tool, payload, schema, expected value, target URL, or
          trusted state and replays the frozen sequence in a fresh server-only store.
        </p>
        <p>
          The one-run guard uses an exclusive browser LockManager claim keyed to this exact build in
          same-origin localStorage for this browser profile. Clearing site storage or using another
          browser or profile can bypass it; no in-app reset is provided, and the guard is not a
          security boundary.
        </p>
        <ul>
          {LIMITATIONS.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </section>

      <section className="panel" aria-labelledby="invocation-integrity-runtime">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Secure same-origin preflight</span>
            <h2 id="invocation-integrity-runtime">Provider registration and consumer execution</h2>
          </div>
          <span className="fixture-id">{APP_COMMIT.slice(0, 12)}</span>
        </div>
        <div className="receipt-grid">
          <article>
            <h3>Provider API</h3>
            <p>
              {prepared?.capabilities.providerRegistration ? "registerTool ready" : "Checking…"}
            </p>
          </article>
          <article>
            <h3>Consumer APIs</h3>
            <p>
              {prepared?.capabilities.inPageDiscovery && prepared.capabilities.inPageExecution
                ? "getTools + executeTool ready"
                : "Checking…"}
            </p>
          </article>
          <article>
            <h3>Initial catalog</h3>
            <p>
              {prepared
                ? prepared.initialCatalog.names.join(", ")
                : registryStatus.toolNames.join(", ") || "Discovering…"}
            </p>
          </article>
        </div>
        <p>
          Compatibility: {prepared ? prepared.compatibilityReceipt.argumentMode : "pending"} · one
          read-only cart_get completed; the measured reset runs atomically at one-shot admission.
        </p>
      </section>

      <section className="panel" aria-labelledby="invocation-integrity-cases">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Frozen sequence · no arbitrary inputs</span>
            <h2 id="invocation-integrity-cases">II-01 → II-02 → II-03</h2>
          </div>
          <span className="fixture-id">{completedCallCount} / 4 native calls</span>
        </div>
        <div className="receipt-grid">
          {INVOCATION_INTEGRITY_CASES.map((contractCase) => {
            const resultRow = receipt?.rows.find(({ caseId }) => caseId === contractCase.caseId);
            return (
              <article key={contractCase.caseId}>
                <h3>
                  {contractCase.caseId} · {contractCase.title}
                </h3>
                <p>
                  {contractCase.toolName} · {contractCase.expectedDisposition}
                </p>
                <p>
                  {resultRow
                    ? `Verified separately · ${resultRow.assertions.length} assertions`
                    : "Awaiting the one-shot run"}
                </p>
                {resultRow ? (
                  <small>
                    State {resultRow.trustedStateBefore.sha256.slice(0, 12)} →{" "}
                    {resultRow.trustedStateAfter.sha256.slice(0, 12)} · operations Δ
                    {resultRow.domainOperationLedgerDiff.delta} · tombstones Δ
                    {resultRow.tombstoneDiff.delta} · audit Δ{resultRow.auditTraceDiff.delta}
                  </small>
                ) : null}
              </article>
            );
          })}
        </div>

        <div className="button-row">
          <button
            className="button button-primary"
            type="button"
            disabled={phase !== "ready" || runConsumed}
            onClick={() => void runFixedSequence()}
          >
            {runConsumed ? "Fixed native run consumed" : "Run fixed native sequence once"}
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={!artifact || downloaded}
            onClick={downloadCompleteJson}
          >
            {downloaded ? "Complete JSON downloaded" : "Download complete JSON"}
          </button>
        </div>
        {receipt ? (
          <div className="runtime-receipt" role="status">
            <span>Source-fixed browser/server comparison</span>
            <strong>{receipt.score.label} verified separately</strong>
            <small>
              Receipt {receipt.receiptDigest} · model calls {receipt.modelCallCount} · semantic
              denominator excluded
            </small>
          </div>
        ) : null}
        {failure ? (
          <div className="runtime-receipt" role="alert">
            <span>
              {phase === "live"
                ? "Blocked · live run owns this build"
                : String(failure.message ?? "") ===
                    "invocation_integrity_secure_provider_consumer_apis_unavailable"
                  ? "WebMCP unavailable in this browser"
                  : "Failed closed · no rerun after dispatch"}
            </span>
            <strong>
              {failureReceipt
                ? `${failureReceipt.score.label} · claim forbidden`
                : String(failure.name ?? "InvocationIntegrityError")}
            </strong>
            <small>{String(failure.message ?? "The fixed run did not verify.")}</small>
          </div>
        ) : null}
      </section>
    </>
  );
}
