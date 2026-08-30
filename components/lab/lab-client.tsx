"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore
} from "react";
import { flushSync } from "react-dom";

import { JudgeDemoPanel, type JudgeBrowserRuntimeBinding } from "@/components/lab/judge-demo-panel";
import {
  cartGet,
  orderReview,
  type CartGetResult,
  type CheckoutErrorResult,
  type MutationResult,
  type OrderReviewResult
} from "@/lib/domain/checkout";
import {
  CHECKOUT_FIXTURE_STATE_HASH,
  verifyCheckoutReset,
  type CheckoutResetReceipt as VerifiedResetReceipt
} from "@/lib/domain/checkout-reset";
import {
  CheckoutSessionStore,
  type CheckoutResetReceipt as DomainResetReceipt
} from "@/lib/domain/checkout-session";
import { canonicalSha256 } from "@/lib/evidence/digest";
import {
  CheckoutTraceLedger,
  type CheckoutTraceLedgerSnapshot
} from "@/lib/evidence/checkout-trace-ledger";
import {
  createGate1ProofBundle,
  downloadGate1ProofBundle,
  GATE1_AUTOMATED_PROOF_MIN_STEP_MS,
  GATE1_AUTOMATED_PROOF_READY_TIMEOUT_MS,
  GATE1_AUTOMATED_PROOF_SEQUENCE_VERSION,
  GATE1_AUTOMATED_PROOF_STEP_NAMES,
  Gate1EvidenceJournal,
  verifyGate1NativeProofSequence,
  type Gate1ProofBundle
} from "@/lib/evidence/gate1-proof-bundle";
import type { OperationTrace } from "@/lib/evidence/operation-trace";
import type { JudgeDemoProjection } from "@/lib/judge/contract";
import { detectWebMcpCapabilities, type WebMcpCapabilities } from "@/lib/webmcp/capabilities";
import {
  INITIAL_CHECKOUT_TOOL_NAMES,
  PENDING_CHECKOUT_TOOL_NAMES,
  type CheckoutToolName
} from "@/lib/webmcp/catalog";
import { createCheckoutTools, type CheckoutToolSet } from "@/lib/webmcp/checkout-tools";
import {
  createRegistryReadinessReceipt,
  type RegistryReadinessReceipt
} from "@/lib/webmcp/readiness";
import { webMcpRegistryManager, type RegistryStatus } from "@/lib/webmcp/registry-manager";
import {
  WebMcpRuntimeError,
  webMcpRuntime,
  type ExecuteOnceResult,
  type ExecuteTraceObservation,
  type RuntimeModelContext,
  type RuntimeObservation
} from "@/lib/webmcp/runtime";

const APP_COMMIT = process.env.NEXT_PUBLIC_TOOLPROOF_COMMIT_SHA?.trim() || "unversioned";
const initialRegistryStatus: RegistryStatus = { phase: "idle", toolNames: [] };
const initialCapabilities: WebMcpCapabilities = {
  secureContext: false,
  providerRegistration: false,
  inPageDiscovery: false,
  inPageExecution: false
};
const AUTOMATED_PROOF_REQUEST_KEY = "toolproof:gate1-auto-request@1";
const AUTOMATED_PROOF_SEQUENCE_VERSION = GATE1_AUTOMATED_PROOF_SEQUENCE_VERSION;
const AUTOMATED_PROOF_MIN_STEP_MS = GATE1_AUTOMATED_PROOF_MIN_STEP_MS;
const AUTOMATED_PROOF_READY_TIMEOUT_MS = GATE1_AUTOMATED_PROOF_READY_TIMEOUT_MS;
const AUTOMATED_PROOF_REQUEST_TTL_MS = 5 * 60_000;
const AUTOMATED_PROOF_REQUEST_MAX_BYTES = 512;
const AUTOMATED_PROOF_STEP_NAMES = GATE1_AUTOMATED_PROOF_STEP_NAMES;

type LabReceipt =
  CartGetResult | OrderReviewResult | MutationResult | CheckoutErrorResult | DomainResetReceipt;

interface EvidenceBinding {
  readonly getRegistryHash: () => string;
  readonly setRegistryHash: (value: string) => void;
}

interface LabEnvironment {
  readonly binding: EvidenceBinding;
  readonly store: CheckoutSessionStore;
  readonly ledger: CheckoutTraceLedger;
  readonly proofJournal: Gate1EvidenceJournal;
  readonly tools: CheckoutToolSet;
  readonly nativeConsumerHolds: {
    acquire(toolName: string, registrationGeneration: number): string;
    release(holdId: string): boolean;
  };
}

const automatedProofClaims = new WeakSet<LabEnvironment>();
const verifiedAutomatedProofs = new WeakMap<
  LabEnvironment,
  { readonly bundle: Gate1ProofBundle; readonly filename: string }
>();

function claimAutomatedProof(environment: LabEnvironment): boolean {
  if (automatedProofClaims.has(environment)) return false;
  automatedProofClaims.add(environment);
  return true;
}

function clearVerifiedAutomatedProof(environment: LabEnvironment): void {
  verifiedAutomatedProofs.delete(environment);
}

function storeVerifiedAutomatedProof(
  environment: LabEnvironment,
  bundle: Gate1ProofBundle,
  filename: string
): void {
  verifiedAutomatedProofs.set(environment, Object.freeze({ bundle, filename }));
}

function verifiedAutomatedProof(environment: LabEnvironment) {
  return verifiedAutomatedProofs.get(environment);
}

interface LastNativeMutation {
  readonly toolName: "cart_update" | "checkout_request" | "checkout_cancel";
  readonly input: Readonly<Record<string, unknown>>;
}

type CheckoutSessionSnapshot = ReturnType<CheckoutSessionStore["getSnapshot"]>;

type NativeRunOutcome =
  | { readonly status: "receipt"; readonly receipt: ExecuteOnceResult }
  | {
      readonly status: "error";
      readonly error: Readonly<Record<string, unknown>>;
      readonly executionId?: string;
    };

interface LabRuntimeView {
  readonly capabilities: WebMcpCapabilities;
  readonly capabilitiesChecked: boolean;
  readonly registryStatus: RegistryStatus;
  readonly readiness: RegistryReadinessReceipt | undefined;
  readonly readinessError: Readonly<Record<string, unknown>> | undefined;
  readonly session: CheckoutSessionSnapshot;
  readonly uiReceipt: LabReceipt | undefined;
  readonly uiError: Readonly<Record<string, unknown>> | undefined;
  readonly nativeReceipt: ExecuteOnceResult | undefined;
  readonly nativeError: Readonly<Record<string, unknown>> | undefined;
  readonly verifiedReset: VerifiedResetReceipt | undefined;
  readonly pendingDomainReset: DomainResetReceipt | undefined;
  readonly lastNativeMutation: LastNativeMutation | undefined;
  readonly busy: boolean;
  readonly resetting: boolean;
  readonly proofExporting: boolean;
}

interface AutomatedProofRequest {
  readonly version: typeof AUTOMATED_PROOF_SEQUENCE_VERSION;
  readonly sequenceId: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly appCommit: string;
  readonly path: "/lab";
}

interface AutomatedProofStatus {
  readonly phase: "idle" | "reloading" | "running" | "download-requested" | "error";
  readonly stepIndex: number;
  readonly stepName: string;
  readonly message: string;
  readonly startedAt: string | null;
  readonly updatedAt: string;
}

interface AutomatedStepResult {
  readonly binding: "executionId" | "resetId";
  readonly boundId: string;
  readonly outcome: string;
}

export function subscribeToCurrentCheckoutSnapshot(
  store: CheckoutSessionStore,
  onSnapshot: (snapshot: CheckoutSessionSnapshot) => void
): () => void {
  const unsubscribe = store.subscribe((_commit, snapshot) => {
    onSnapshot(snapshot);
  });
  onSnapshot(store.getSnapshot());
  return unsubscribe;
}

function createEnvironment(): LabEnvironment {
  let registryHash = "registry-unverified";
  const binding: EvidenceBinding = Object.freeze({
    getRegistryHash: () => registryHash,
    setRegistryHash: (value: string) => {
      registryHash = value;
    }
  });
  const ledger = new CheckoutTraceLedger({
    getRegistryHash: binding.getRegistryHash,
    getArgumentMode: () => webMcpRuntime.argumentMode ?? "unverified",
    appCommit: APP_COMMIT
  });
  const proofJournal = new Gate1EvidenceJournal();
  const store = new CheckoutSessionStore({ traceSink: ledger });
  const consumerHoldReleases = new Map<string, () => void>();
  const nativeConsumerHolds = Object.freeze({
    acquire(toolName: string, registrationGeneration: number): string {
      const release = webMcpRegistryManager.holdConsumerCall(toolName, registrationGeneration);
      const holdId = globalThis.crypto.randomUUID();
      if (consumerHoldReleases.has(holdId)) {
        release();
        throw new Error("Native consumer hold identifier collision.");
      }
      consumerHoldReleases.set(holdId, release);
      return holdId;
    },
    release(holdId: string): boolean {
      const release = consumerHoldReleases.get(holdId);
      if (!release) return false;
      consumerHoldReleases.delete(holdId);
      release();
      return true;
    }
  });
  return Object.freeze({
    binding,
    store,
    ledger,
    proofJournal,
    tools: createCheckoutTools(store),
    nativeConsumerHolds
  });
}

function documentEnvironment(): LabEnvironment {
  if (typeof window === "undefined") return createEnvironment();
  const owner = window as typeof window & { __toolProofLabEnvironment?: LabEnvironment };
  if (!owner.__toolProofLabEnvironment) {
    Object.defineProperty(owner, "__toolProofLabEnvironment", {
      value: createEnvironment(),
      configurable: false,
      enumerable: false,
      writable: false
    });
  }
  return owner.__toolProofLabEnvironment as LabEnvironment;
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function capabilityLabel(value: boolean, ready: string, unavailable: string): string {
  return value ? ready : unavailable;
}

function sameNames(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((name, index) => name === expected[index])
  );
}

function operationId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function exactIsoTimestamp(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`${label} is not an exact UTC timestamp.`);
  }
  return value;
}

function parseAutomatedProofRequest(raw: string, now: number): AutomatedProofRequest {
  if (new TextEncoder().encode(raw).byteLength > AUTOMATED_PROOF_REQUEST_MAX_BYTES) {
    throw new Error("Automated proof request exceeds its bounded size.");
  }
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const expectedKeys = ["appCommit", "expiresAt", "path", "requestedAt", "sequenceId", "version"];
  if (
    !parsed ||
    typeof parsed !== "object" ||
    JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify(expectedKeys)
  ) {
    throw new Error("Automated proof request has an invalid shape.");
  }
  const requestedAt = exactIsoTimestamp(parsed.requestedAt, "requestedAt");
  const expiresAt = exactIsoTimestamp(parsed.expiresAt, "expiresAt");
  const requestedMs = Date.parse(requestedAt);
  const expiresMs = Date.parse(expiresAt);
  if (
    parsed.version !== AUTOMATED_PROOF_SEQUENCE_VERSION ||
    parsed.appCommit !== APP_COMMIT ||
    parsed.path !== "/lab" ||
    typeof parsed.sequenceId !== "string" ||
    !/^sequence_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      parsed.sequenceId
    ) ||
    requestedMs > now + 30_000 ||
    expiresMs <= now ||
    expiresMs - requestedMs !== AUTOMATED_PROOF_REQUEST_TTL_MS
  ) {
    throw new Error("Automated proof request is stale or does not match this build and path.");
  }
  return Object.freeze({
    version: AUTOMATED_PROOF_SEQUENCE_VERSION,
    sequenceId: parsed.sequenceId,
    requestedAt,
    expiresAt,
    appCommit: APP_COMMIT,
    path: "/lab"
  });
}

function errorReceipt(error: unknown): Readonly<Record<string, unknown>> {
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
  return Object.freeze({ name: "Error", message: "Unknown Lab operation failure." });
}

function everyTrace(snapshot: CheckoutTraceLedgerSnapshot): readonly OperationTrace[] {
  return [
    ...snapshot.archives.flatMap(({ traces }) => traces),
    ...snapshot.resetTraces,
    ...snapshot.current
  ].sort((left, right) => left.sequence - right.sequence);
}

function latestTrace(snapshot: CheckoutTraceLedgerSnapshot): OperationTrace | undefined {
  return everyTrace(snapshot).at(-1);
}

function latestNativeTrace(snapshot: CheckoutTraceLedgerSnapshot): OperationTrace | undefined {
  return everyTrace(snapshot)
    .filter(({ source }) => source === "native")
    .at(-1);
}

export function LabClient() {
  const [environment] = useState(documentEnvironment);
  const subscribeStore = useCallback(
    (onStoreChange: () => void) =>
      environment.store.subscribe(() => {
        flushSync(onStoreChange);
      }),
    [environment]
  );
  const session = useSyncExternalStore(
    subscribeStore,
    environment.store.getSnapshot,
    environment.store.getSnapshot
  );
  const traces = useSyncExternalStore(
    environment.ledger.subscribe,
    environment.ledger.snapshot,
    environment.ledger.snapshot
  );
  const desiredTools = environment.tools.forState(session.state);
  const desiredNames = session.state.pendingCheckout
    ? PENDING_CHECKOUT_TOOL_NAMES
    : INITIAL_CHECKOUT_TOOL_NAMES;

  const [capabilities, setCapabilities] = useState(initialCapabilities);
  const [capabilitiesChecked, setCapabilitiesChecked] = useState(false);
  const [registryStatus, setRegistryStatus] = useState(initialRegistryStatus);
  const [readiness, setReadiness] = useState<RegistryReadinessReceipt>();
  const [readinessError, setReadinessError] = useState<Readonly<Record<string, unknown>>>();
  const [uiReceipt, setUiReceipt] = useState<LabReceipt>();
  const [uiError, setUiError] = useState<Readonly<Record<string, unknown>>>();
  const [nativeReceipt, setNativeReceipt] = useState<ExecuteOnceResult>();
  const [nativeError, setNativeError] = useState<Readonly<Record<string, unknown>>>();
  const [verifiedReset, setVerifiedReset] = useState<VerifiedResetReceipt>();
  const [pendingDomainReset, setPendingDomainReset] = useState<DomainResetReceipt>();
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [proofExporting, setProofExporting] = useState(false);
  const [judgeBusy, setJudgeBusy] = useState(false);
  const [proofExportStatus, setProofExportStatus] = useState<string>();
  const [proofExportError, setProofExportError] = useState<Readonly<Record<string, unknown>>>();
  const [automatedProofStatus, setAutomatedProofStatus] = useState<AutomatedProofStatus>(() => ({
    phase: "idle",
    stepIndex: 0,
    stepName: "idle",
    message: "Ready to start a clean one-button proof run.",
    startedAt: null,
    updatedAt: "not started"
  }));
  const [verifiedProofAvailable, setVerifiedProofAvailable] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      environment.store
        .getSnapshot()
        .state.lines.map(({ itemId, quantity }) => [itemId, String(quantity)])
    )
  );
  const [nativeUpdateId, setNativeUpdateId] = useState("native_update_0001");
  const [nativeRequestId, setNativeRequestId] = useState("native_request_001");
  const [nativeCancelId, setNativeCancelId] = useState("native_cancel_0001");
  const [lastNativeMutation, setLastNativeMutation] = useState<LastNativeMutation>();
  const readinessEpoch = useRef(0);
  const operationAdmission = useRef<
    "idle" | "ui" | "native" | "reset" | "export" | "automation" | "judge"
  >("idle");
  const automatedProofStarted = useRef(false);
  const automatedStepInFlight = useRef(false);
  const runtimeView = useRef<LabRuntimeView | null>(null);
  useEffect(() => {
    runtimeView.current = {
      capabilities,
      capabilitiesChecked,
      registryStatus,
      readiness,
      readinessError,
      session,
      uiReceipt,
      uiError,
      nativeReceipt,
      nativeError,
      verifiedReset,
      pendingDomainReset,
      lastNativeMutation,
      busy,
      resetting,
      proofExporting
    };
  }, [
    busy,
    capabilities,
    capabilitiesChecked,
    lastNativeMutation,
    nativeError,
    nativeReceipt,
    pendingDomainReset,
    proofExporting,
    readiness,
    readinessError,
    registryStatus,
    resetting,
    session,
    uiError,
    uiReceipt,
    verifiedReset
  ]);

  useEffect(() => {
    const detected = detectWebMcpCapabilities();
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) {
        environment.proofJournal.recordCapabilities(detected);
        setCapabilities(detected);
        setCapabilitiesChecked(true);
      }
    });
    return () => {
      disposed = true;
    };
  }, [environment]);

  useEffect(
    () => () => {
      environment.store.abandonResetAdmission();
    },
    [environment]
  );

  useEffect(() => {
    // A same-document route remount can restore the server-rendered seed draft after the
    // document-owned store has already advanced. Subscriptions only observe future commits, so
    // synchronize the current snapshot after subscribing as part of mount admission.
    return subscribeToCurrentCheckoutSnapshot(environment.store, (snapshot) => {
      setQuantities(
        Object.fromEntries(
          snapshot.state.lines.map(({ itemId, quantity }) => [itemId, String(quantity)])
        )
      );
    });
  }, [environment]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context || typeof context.registerTool !== "function") {
      return;
    }

    return webMcpRegistryManager.acquire(context, desiredTools, (status) => {
      environment.proofJournal.recordRegistryStatus(status);
      setRegistryStatus(status);
      if (status.phase !== "ready") setReadiness(undefined);
    });
  }, [desiredTools, environment]);

  useEffect(() => {
    const context = document.modelContext;
    const generation = registryStatus.generation ?? 0;
    if (
      !context ||
      registryStatus.phase !== "ready" ||
      generation < 1 ||
      !sameNames(registryStatus.toolNames, desiredNames)
    ) {
      return;
    }

    const epoch = ++readinessEpoch.current;
    let disposed = false;
    void (async () => {
      try {
        let receipt = await createRegistryReadinessReceipt(context, {
          state: session.state,
          appCommit: APP_COMMIT,
          registrationGeneration: generation,
          ...(webMcpRuntime.compatibilityReceipt
            ? { compatibilityReceipt: webMcpRuntime.compatibilityReceipt }
            : {})
        });
        if (disposed || epoch !== readinessEpoch.current) return;
        environment.binding.setRegistryHash(receipt.manifestHash);

        const consumer = context as RuntimeModelContext;
        if (
          !webMcpRuntime.compatibilityReceipt &&
          receipt.status === "consumer-discovered" &&
          receipt.runtimeCatalog &&
          typeof consumer.executeTool === "function"
        ) {
          environment.proofJournal.recordReadinessReceipt(
            receipt,
            globalThis.window,
            globalThis.location?.origin
          );
          const cartTool = receipt.runtimeCatalog.tools.find(({ name }) => name === "cart_get");
          if (!cartTool) throw new Error("The verified runtime catalog has no cart_get tool.");
          const observe = async (): Promise<RuntimeObservation> => {
            const observedState = environment.store.getSnapshot().state;
            const liveReadiness = await createRegistryReadinessReceipt(context, {
              state: observedState,
              appCommit: APP_COMMIT,
              registrationGeneration: generation
            });
            const traceSnapshot = environment.ledger.snapshot();
            const trace = latestTrace(traceSnapshot);
            const effectDigest = trace ? await canonicalSha256(trace.effect) : undefined;
            return {
              stateHash: await canonicalSha256(observedState),
              manifestHash: liveReadiness.manifestHash,
              handlerTraceCount: traceSnapshot.totalTraceCount,
              ...(trace ? { lastHandlerTraceId: trace.eventId } : {}),
              ...(effectDigest ? { lastEffectDigest: effectDigest } : {}),
              ...(trace
                ? {
                    lastTrace: {
                      eventId: trace.eventId,
                      source: trace.source,
                      toolName: trace.toolName,
                      status: trace.status,
                      registryHash: trace.registryHash,
                      resultDigest: trace.canonicalResult?.sha256 ?? null,
                      effectDigest: effectDigest as string,
                      stateBeforeDigest: trace.stateBefore.sha256,
                      stateAfterDigest: trace.stateAfter.sha256
                    }
                  }
                : {})
            };
          };
          const compatibilityReceipt = await webMcpRuntime.initializeWithCartGet({
            context: consumer,
            catalog: receipt.runtimeCatalog,
            cartTool,
            expectedCartResult: cartGet(session.state),
            observe
          });
          receipt = await createRegistryReadinessReceipt(context, {
            state: session.state,
            appCommit: APP_COMMIT,
            registrationGeneration: generation,
            compatibilityReceipt
          });
        }

        if (!disposed && epoch === readinessEpoch.current) {
          if (
            receipt.runtimeCatalog &&
            receipt.compatibilityBinding === "verified" &&
            webMcpRuntime.compatibilityReceipt
          ) {
            webMcpRuntime.verifyRegistry(receipt.runtimeCatalog);
          }
          environment.binding.setRegistryHash(receipt.manifestHash);
          environment.proofJournal.recordReadinessReceipt(
            receipt,
            globalThis.window,
            globalThis.location?.origin
          );
          setReadiness(receipt);
          setReadinessError(undefined);
        }
      } catch (error) {
        if (!disposed && epoch === readinessEpoch.current) {
          const receipt = errorReceipt(error);
          environment.proofJournal.recordReadinessError(receipt);
          setReadiness(undefined);
          setReadinessError(receipt);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [desiredNames, environment, registryStatus, session.state]);

  useEffect(() => {
    if (!pendingDomainReset || !readiness) return;
    if (
      session.trajectoryId !== pendingDomainReset.trajectoryId ||
      readiness.stateHash !== pendingDomainReset.core.stateHash ||
      readiness.manifest.catalogState !== "initial" ||
      !sameNames(registryStatus.toolNames, INITIAL_CHECKOUT_TOOL_NAMES)
    ) {
      return;
    }

    let disposed = false;
    void verifyCheckoutReset({
      domainReceipt: pendingDomainReset,
      inspection: environment.store.inspect(),
      archives: environment.store.archivedTrajectories(),
      traceLedger: environment.ledger.snapshot(),
      registry: {
        verified: registryStatus.phase === "ready" && readiness.consumerDiscovery !== "mismatch",
        registryHash: readiness.manifestHash,
        registeredToolNames: registryStatus.toolNames
      },
      checkedAt: new Date().toISOString()
    })
      .then((receipt) => {
        const released = environment.store.releaseResetAdmission(receipt.resetId);
        if (!released) {
          const error = Object.freeze({
            name: "ResetAdmissionMismatch",
            message: "Reset verification could not release the matching admission lock.",
            resetId: receipt.resetId
          });
          environment.proofJournal.recordResetError(error);
          if (!disposed) {
            setVerifiedReset(undefined);
            setUiError(error);
          }
        } else {
          environment.proofJournal.recordResetVerificationReceipt(receipt);
          if (!disposed) {
            setVerifiedReset(receipt);
          }
        }
        if (!disposed) {
          if (operationAdmission.current === "reset") operationAdmission.current = "idle";
          setResetting(false);
        }
      })
      .catch((error: unknown) => {
        environment.store.releaseResetAdmission(pendingDomainReset.resetId);
        const receipt = errorReceipt(error);
        environment.proofJournal.recordResetError({
          resetId: pendingDomainReset.resetId,
          error: receipt
        });
        if (!disposed) {
          setVerifiedReset(undefined);
          setUiError(receipt);
          if (operationAdmission.current === "reset") operationAdmission.current = "idle";
          setResetting(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, [environment, pendingDomainReset, readiness, registryStatus, session.trajectoryId]);

  useEffect(() => {
    if (!pendingDomainReset || !resetting) return;
    const timeout = setTimeout(
      () => {
        if (!environment.store.isResetAdmissionLocked()) return;
        void verifyCheckoutReset({
          domainReceipt: pendingDomainReset,
          inspection: environment.store.inspect(),
          archives: environment.store.archivedTrajectories(),
          traceLedger: environment.ledger.snapshot(),
          registry: {
            verified: false,
            registryHash: readiness?.manifestHash ?? "registry-verification-unavailable",
            registeredToolNames: registryStatus.toolNames
          },
          checkedAt: new Date().toISOString()
        })
          .then((receipt) => {
            if (environment.store.isResetAdmissionLocked()) {
              const released = environment.store.releaseResetAdmission(receipt.resetId);
              if (released) {
                environment.proofJournal.recordResetVerificationReceipt(receipt);
                setVerifiedReset(receipt);
              } else {
                const error = Object.freeze({
                  name: "ResetAdmissionMismatch",
                  message: "Fallback reset verification could not release admission.",
                  resetId: receipt.resetId
                });
                environment.proofJournal.recordResetError(error);
                setUiError(error);
              }
              if (operationAdmission.current === "reset") operationAdmission.current = "idle";
              setResetting(false);
            }
          })
          .catch((error: unknown) => {
            environment.store.releaseResetAdmission(pendingDomainReset.resetId);
            const receipt = errorReceipt(error);
            environment.proofJournal.recordResetError({
              resetId: pendingDomainReset.resetId,
              error: receipt
            });
            setUiError(receipt);
            if (operationAdmission.current === "reset") operationAdmission.current = "idle";
            setResetting(false);
          });
      },
      readinessError
        ? 0
        : operationAdmission.current === "automation"
          ? AUTOMATED_PROOF_READY_TIMEOUT_MS
          : 3_000
    );
    return () => clearTimeout(timeout);
  }, [
    environment,
    pendingDomainReset,
    readiness?.manifestHash,
    readinessError,
    registryStatus.toolNames,
    resetting
  ]);

  async function runUi(operation: () => Promise<LabReceipt>): Promise<void> {
    const view = runtimeView.current;
    if (
      operationAdmission.current !== "idle" ||
      !view?.capabilitiesChecked ||
      view.busy ||
      view.resetting ||
      view.proofExporting
    ) {
      return;
    }
    operationAdmission.current = "ui";
    setBusy(true);
    setUiReceipt(undefined);
    setUiError(undefined);
    try {
      setUiReceipt(await operation());
    } catch (error) {
      setUiError(errorReceipt(error));
    } finally {
      operationAdmission.current = "idle";
      setBusy(false);
    }
  }

  async function updateLine(itemId: "field-notebook" | "stoneware-mug"): Promise<void> {
    const quantity = Number(quantities[itemId]);
    await runUi(() =>
      environment.store.cartUpdate(
        {
          operationId: operationId("ui_update"),
          operation: "set_quantity",
          itemId,
          quantity
        },
        { source: "ui" }
      )
    );
  }

  async function hardReset(
    admission: "manual" | "automation" = "manual"
  ): Promise<DomainResetReceipt | undefined> {
    const view = runtimeView.current;
    if (
      !view?.capabilitiesChecked ||
      view.busy ||
      view.resetting ||
      view.proofExporting ||
      (admission === "manual"
        ? operationAdmission.current !== "idle"
        : operationAdmission.current !== "automation" || automatedStepInFlight.current)
    ) {
      return undefined;
    }
    if (admission === "manual") operationAdmission.current = "reset";
    else automatedStepInFlight.current = true;
    let attemptedResetId: string | null = null;
    setResetting(true);
    setVerifiedReset(undefined);
    setUiError(undefined);
    readinessEpoch.current += 1;
    setReadiness(undefined);
    setReadinessError(undefined);
    try {
      const domainReceipt = await environment.store.hardReset({
        source: "ui",
        holdForVerification: true
      });
      attemptedResetId = domainReceipt.resetId;
      environment.proofJournal.recordDomainResetReceipt(domainReceipt);
      setPendingDomainReset(domainReceipt);
      setUiReceipt(domainReceipt);
      setNativeReceipt(undefined);
      setNativeError(undefined);
      refreshNativeIds();
      setQuantities({ "field-notebook": "1", "stoneware-mug": "2" });

      if (!document.modelContext || typeof document.modelContext.registerTool !== "function") {
        const receipt = await verifyCheckoutReset({
          domainReceipt,
          inspection: environment.store.inspect(),
          archives: environment.store.archivedTrajectories(),
          traceLedger: environment.ledger.snapshot(),
          registry: {
            verified: false,
            registryHash: "registry-unavailable",
            registeredToolNames: []
          },
          checkedAt: new Date().toISOString()
        });
        const released = environment.store.releaseResetAdmission(receipt.resetId);
        if (!released) throw new Error("Reset verification could not release admission.");
        environment.proofJournal.recordResetVerificationReceipt(receipt);
        setVerifiedReset(receipt);
        if (operationAdmission.current === "reset") operationAdmission.current = "idle";
        setResetting(false);
      }
      if (admission === "automation") automatedStepInFlight.current = false;
      return domainReceipt;
    } catch (error) {
      environment.store.abandonResetAdmission();
      const receipt = errorReceipt(error);
      environment.proofJournal.recordResetError({ resetId: attemptedResetId, error: receipt });
      setUiError(receipt);
      if (operationAdmission.current === "reset") operationAdmission.current = "idle";
      if (admission === "automation") automatedStepInFlight.current = false;
      setResetting(false);
      return undefined;
    }
  }

  async function observeNativeTrace(): Promise<ExecuteTraceObservation> {
    const traceSnapshot = environment.ledger.snapshot();
    const trace = latestTrace(traceSnapshot);
    return {
      stateHash: await canonicalSha256(environment.store.getSnapshot().state),
      handlerTraceCount: traceSnapshot.totalTraceCount,
      lastTrace: trace
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
        : null
    };
  }

  async function recordNativeAttemptError(
    executionId: string,
    toolName: string,
    traceCountBefore: number,
    error: unknown
  ): Promise<Readonly<Record<string, unknown>>> {
    const receipt = errorReceipt(error);
    let traceObservation: ExecuteTraceObservation | null = null;
    let observationError: Readonly<Record<string, unknown>> | null = null;
    try {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        traceObservation = await observeNativeTrace();
        if (
          traceObservation.handlerTraceCount !== traceCountBefore ||
          receipt.nativeCallMade !== true
        ) {
          break;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
    } catch (observationFailure) {
      observationError = errorReceipt(observationFailure);
    }
    environment.proofJournal.recordNativeAttemptFinished({
      executionId,
      toolName,
      outcome: "error",
      error: receipt,
      traceObservation,
      observationError
    });
    return receipt;
  }

  async function runNative(
    toolName: CheckoutToolName,
    input: Readonly<Record<string, unknown>>,
    admission: "manual" | "automation" | "judge" = "manual"
  ): Promise<NativeRunOutcome> {
    const view = runtimeView.current;
    const admissionReady =
      admission === "manual"
        ? operationAdmission.current === "idle" &&
          !view?.busy &&
          !view?.resetting &&
          !view?.proofExporting
        : admission === "automation"
          ? operationAdmission.current === "automation" && !automatedStepInFlight.current
          : operationAdmission.current === "judge" &&
            !view?.busy &&
            !view?.resetting &&
            !view?.proofExporting;
    if (!view?.capabilitiesChecked || !admissionReady) {
      const error = Object.freeze({
        name: "OperationNotAdmitted",
        message: "Native execution is not admitted while another Lab operation is active."
      });
      environment.proofJournal.recordNativeControlError({ toolName, input, error });
      setNativeError(error);
      return { status: "error", error };
    }
    const liveReadiness = view.readiness;
    const liveRegistry = view.registryStatus;
    const catalogState = view.session.state.pendingCheckout ? "pending" : "initial";
    const expectedNames =
      catalogState === "pending" ? PENDING_CHECKOUT_TOOL_NAMES : INITIAL_CHECKOUT_TOOL_NAMES;
    if (
      !liveReadiness?.runtimeCatalog ||
      liveReadiness.status !== "consumer-ready" ||
      view.readinessError ||
      liveRegistry.phase !== "ready" ||
      !sameNames(liveRegistry.toolNames, expectedNames) ||
      liveReadiness.runtimeCatalog.generation !== (liveRegistry.generation ?? 0) ||
      liveReadiness.fixtureRevision !== view.session.state.revision ||
      liveReadiness.manifest.catalogState !== catalogState
    ) {
      const error = Object.freeze({
        name: "RuntimeNotReady",
        message: "Native plumbing controls require a consumer-ready WebMCP receipt."
      });
      environment.proofJournal.recordNativeControlError({ toolName, input, error });
      setNativeError(error);
      return { status: "error", error };
    }
    const tool = liveReadiness.runtimeCatalog.tools.find(({ name }) => name === toolName);
    if (!tool) {
      const error = Object.freeze({
        name: "ToolUnavailable",
        message: `${toolName} is not present in the current verified catalog.`
      });
      environment.proofJournal.recordNativeControlError({ toolName, input, error });
      setNativeError(error);
      return { status: "error", error };
    }
    if (admission === "manual") operationAdmission.current = "native";
    else if (admission === "automation") automatedStepInFlight.current = true;
    const executionId = operationId("plumbing");
    const traceCountBefore = environment.ledger.snapshot().totalTraceCount;
    let releaseConsumerCall: () => void;
    try {
      releaseConsumerCall = webMcpRegistryManager.holdConsumerCall(
        toolName,
        liveReadiness.runtimeCatalog.generation
      );
    } catch (error) {
      const receipt = errorReceipt(error);
      environment.proofJournal.recordNativeControlError({ toolName, input, error: receipt });
      setNativeError(receipt);
      if (admission === "manual") operationAdmission.current = "idle";
      else if (admission === "automation") automatedStepInFlight.current = false;
      return { status: "error", error: receipt };
    }

    environment.proofJournal.recordNativeAttemptStarted({
      executionId,
      toolName,
      input,
      manifestHash: liveReadiness.manifestHash,
      registrationGeneration: liveReadiness.runtimeCatalog.generation,
      catalogState,
      fixtureRevision: liveReadiness.fixtureRevision,
      stateHash: liveReadiness.stateHash,
      traceCount: traceCountBefore
    });
    setBusy(true);
    setNativeError(undefined);
    setNativeReceipt(undefined);
    try {
      const result = await webMcpRuntime.executeOnce({
        executionId,
        manifestHash: liveReadiness.manifestHash,
        tool,
        input,
        observe: observeNativeTrace
      });
      environment.proofJournal.recordNativeAttemptFinished({
        executionId,
        toolName,
        outcome: "receipt",
        receipt: result
      });
      setNativeReceipt(result);
      if (
        toolName === "cart_update" ||
        toolName === "checkout_request" ||
        toolName === "checkout_cancel"
      ) {
        setLastNativeMutation(Object.freeze({ toolName, input: Object.freeze({ ...input }) }));
        if (toolName === "cart_update") setNativeUpdateId(operationId("native_update"));
        if (toolName === "checkout_request") setNativeRequestId(operationId("native_request"));
        if (toolName === "checkout_cancel") setNativeCancelId(operationId("native_cancel"));
      }
      return { status: "receipt", receipt: result };
    } catch (error) {
      const receipt = await recordNativeAttemptError(
        executionId,
        toolName,
        traceCountBefore,
        error
      );
      setNativeError(receipt);
      return { status: "error", error: receipt, executionId };
    } finally {
      releaseConsumerCall();
      if (admission === "manual") operationAdmission.current = "idle";
      else if (admission === "automation") automatedStepInFlight.current = false;
      setBusy(false);
    }
  }

  function beginJudgeSequence(): boolean {
    const view = runtimeView.current;
    if (
      operationAdmission.current !== "idle" ||
      !view?.capabilitiesChecked ||
      view.busy ||
      view.resetting ||
      view.proofExporting ||
      view.session.haltedReason !== null ||
      judgeBusy
    ) {
      return false;
    }
    operationAdmission.current = "judge";
    setJudgeBusy(true);
    return true;
  }

  function endJudgeSequence(): void {
    if (operationAdmission.current === "judge") operationAdmission.current = "idle";
    setJudgeBusy(false);
  }

  async function executeVerifiedJudgeDecision(
    projection: JudgeDemoProjection
  ): Promise<ExecuteOnceResult> {
    const view = runtimeView.current;
    const decision = projection.decision;
    const { receiptDigest, ...projectionCore } = projection;
    if (
      operationAdmission.current !== "judge" ||
      !view?.readiness?.runtimeCatalog ||
      view.readiness.status !== "consumer-ready" ||
      view.readinessError ||
      view.registryStatus.phase !== "ready" ||
      !sameNames(view.registryStatus.toolNames, INITIAL_CHECKOUT_TOOL_NAMES) ||
      view.session.state.revision !== 0 ||
      view.session.state.pendingCheckout !== null ||
      view.session.haltedReason !== null ||
      view.readiness.stateHash !== CHECKOUT_FIXTURE_STATE_HASH ||
      view.readiness.fixtureRevision !== 0 ||
      view.readiness.manifest.catalogState !== "initial" ||
      projection.appCommit !== APP_COMMIT ||
      projection.fixtureHash !== CHECKOUT_FIXTURE_STATE_HASH ||
      projection.manifestHash !== view.readiness.manifestHash ||
      projection.nativeExecutionIncluded !== false ||
      (await canonicalSha256(projectionCore)) !== receiptDigest ||
      projection.decisionError !== null ||
      decision?.kind !== "call" ||
      decision.tool !== "cart_get" ||
      Object.keys(decision.arguments).length !== 0
    ) {
      throw new Error(
        "The sealed judge decision does not match this clean build, fixture, catalog, or cart_get contract."
      );
    }

    const outcome = await runNative("cart_get", {}, "judge");
    if (outcome.status !== "receipt") {
      throw new Error("The native cart_get verification failed after the sealed judge decision.");
    }
    const expectedResultDigest = await canonicalSha256(cartGet(view.session.state));
    if (
      outcome.receipt.toolName !== "cart_get" ||
      outcome.receipt.resultDigest !== expectedResultDigest ||
      outcome.receipt.stateBeforeDigest !== outcome.receipt.stateAfterDigest ||
      outcome.receipt.manifestHash !== projection.manifestHash
    ) {
      throw new Error("The native cart_get receipt did not preserve the declared fixture.");
    }
    return outcome.receipt;
  }

  async function runNativeCancellationProbe(
    admission: "manual" | "automation" = "manual"
  ): Promise<NativeRunOutcome> {
    const view = runtimeView.current;
    const admissionReady =
      admission === "manual"
        ? operationAdmission.current === "idle" &&
          !view?.busy &&
          !view?.resetting &&
          !view?.proofExporting
        : operationAdmission.current === "automation" && !automatedStepInFlight.current;
    if (!view?.capabilitiesChecked || !admissionReady) {
      const error = Object.freeze({
        name: "OperationNotAdmitted",
        message: "Native cancellation is not admitted while another Lab operation is active."
      });
      environment.proofJournal.recordNativeControlError({
        action: "cart_get_cancellation_probe",
        error
      });
      setNativeError(error);
      return { status: "error", error };
    }
    const liveReadiness = view.readiness;
    const liveRegistry = view.registryStatus;
    const catalogState = view.session.state.pendingCheckout ? "pending" : "initial";
    const expectedNames =
      catalogState === "pending" ? PENDING_CHECKOUT_TOOL_NAMES : INITIAL_CHECKOUT_TOOL_NAMES;
    if (
      !liveReadiness?.runtimeCatalog ||
      liveReadiness.status !== "consumer-ready" ||
      view.readinessError ||
      liveRegistry.phase !== "ready" ||
      !sameNames(liveRegistry.toolNames, expectedNames) ||
      liveReadiness.runtimeCatalog.generation !== (liveRegistry.generation ?? 0) ||
      liveReadiness.fixtureRevision !== view.session.state.revision ||
      liveReadiness.manifest.catalogState !== catalogState
    ) {
      const error = Object.freeze({
        name: "RuntimeNotReady",
        message: "Native cancellation requires a consumer-ready WebMCP receipt."
      });
      environment.proofJournal.recordNativeControlError({
        action: "cart_get_cancellation_probe",
        error
      });
      setNativeError(error);
      return { status: "error", error };
    }
    const tool = liveReadiness.runtimeCatalog.tools.find(({ name }) => name === "cart_get");
    if (!tool) {
      const error = Object.freeze({
        name: "ToolUnavailable",
        message: "The verified catalog has no cart_get cancellation probe tool."
      });
      environment.proofJournal.recordNativeControlError({
        action: "cart_get_cancellation_probe",
        error
      });
      setNativeError(error);
      return { status: "error", error };
    }
    if (admission === "manual") operationAdmission.current = "native";
    else automatedStepInFlight.current = true;
    const executionId = operationId("cancel_probe");
    const traceCountBefore = environment.ledger.snapshot().totalTraceCount;
    const input = Object.freeze({});
    const controller = new AbortController();
    let releaseConsumerCall: () => void;
    try {
      releaseConsumerCall = webMcpRegistryManager.holdConsumerCall(
        "cart_get",
        liveReadiness.runtimeCatalog.generation
      );
    } catch (error) {
      const receipt = errorReceipt(error);
      environment.proofJournal.recordNativeControlError({
        action: "cart_get_cancellation_probe",
        error: receipt
      });
      setNativeError(receipt);
      if (admission === "manual") operationAdmission.current = "idle";
      else automatedStepInFlight.current = false;
      return { status: "error", error: receipt };
    }

    environment.proofJournal.recordNativeAttemptStarted({
      executionId,
      toolName: "cart_get",
      input,
      manifestHash: liveReadiness.manifestHash,
      registrationGeneration: liveReadiness.runtimeCatalog.generation,
      catalogState,
      fixtureRevision: liveReadiness.fixtureRevision,
      stateHash: liveReadiness.stateHash,
      traceCount: traceCountBefore
    });
    setBusy(true);
    setNativeReceipt(undefined);
    setNativeError(undefined);
    try {
      const result = await webMcpRuntime.executeOnce({
        executionId,
        manifestHash: liveReadiness.manifestHash,
        tool,
        input,
        observe: observeNativeTrace,
        signal: controller.signal,
        onNativeDispatch: () =>
          controller.abort(new DOMException("Operator cancellation probe", "AbortError"))
      });
      environment.proofJournal.recordNativeAttemptFinished({
        executionId,
        toolName: "cart_get",
        outcome: "receipt",
        receipt: result
      });
      setNativeReceipt(result);
      return { status: "receipt", receipt: result };
    } catch (error) {
      const receipt = await recordNativeAttemptError(
        executionId,
        "cart_get",
        traceCountBefore,
        error
      );
      setNativeError(receipt);
      return { status: "error", error: receipt, executionId };
    } finally {
      releaseConsumerCall();
      if (admission === "manual") operationAdmission.current = "idle";
      else automatedStepInFlight.current = false;
      setBusy(false);
    }
  }

  async function buildCurrentGate1ProofBundle(): Promise<Gate1ProofBundle> {
    const view = runtimeView.current;
    if (!view?.capabilitiesChecked) throw new Error("Runtime capabilities are not ready.");
    return createGate1ProofBundle({
      exportedAt: new Date().toISOString(),
      appCommit: APP_COMMIT,
      origin: globalThis.location.origin,
      userAgent: globalThis.navigator.userAgent,
      capabilities: view.capabilities,
      registryStatus: view.registryStatus,
      readiness: view.readiness ?? null,
      readinessError: view.readinessError ?? null,
      ownerWindow: globalThis.window,
      session: environment.store.getSnapshot(),
      inspection: environment.store.inspect(),
      domainArchives: environment.store.archivedTrajectories(),
      traceLedger: environment.ledger.snapshot(),
      journal: environment.proofJournal.snapshot(),
      currentReceipts: {
        uiReceipt: view.uiReceipt ?? null,
        uiError: view.uiError ?? null,
        nativeReceipt: view.nativeReceipt ?? null,
        nativeError: view.nativeError ?? null,
        verifiedReset: view.verifiedReset ?? null,
        pendingDomainReset: view.pendingDomainReset ?? null,
        lastNativeMutation: view.lastNativeMutation ?? null
      }
    });
  }

  async function exportGate1Proof(
    admission: "manual" | "automation" = "manual",
    preparedBundle?: Gate1ProofBundle
  ): Promise<string | undefined> {
    const view = runtimeView.current;
    const admitted =
      admission === "manual"
        ? operationAdmission.current === "idle" &&
          !view?.busy &&
          !view?.resetting &&
          !view?.proofExporting
        : operationAdmission.current === "automation" && !automatedStepInFlight.current;
    if (!view?.capabilitiesChecked || !admitted) return undefined;
    if (admission === "manual") operationAdmission.current = "export";
    else automatedStepInFlight.current = true;
    setProofExporting(true);
    setProofExportStatus(undefined);
    setProofExportError(undefined);
    try {
      const bundle = preparedBundle ?? (await buildCurrentGate1ProofBundle());
      if (admission === "automation") await verifyGate1NativeProofSequence(bundle);
      const filename = downloadGate1ProofBundle(bundle);
      if (admission === "automation") {
        storeVerifiedAutomatedProof(environment, bundle, filename);
        setVerifiedProofAvailable(true);
      }
      setProofExportStatus(
        `Download requested for ${filename} · ${bundle.evidence.journal.eventCount} journal events · ${bundle.evidence.traceLedger.totalTraceCount} traces · evidence SHA-256 ${bundle.evidenceDigest}`
      );
      return filename;
    } catch (error) {
      setProofExportError(errorReceipt(error));
      return undefined;
    } finally {
      if (admission === "manual") operationAdmission.current = "idle";
      else automatedStepInFlight.current = false;
      setProofExporting(false);
    }
  }

  function retryVerifiedProofDownload(): void {
    const verified = verifiedAutomatedProof(environment);
    if (!verified) return;
    const filename = downloadGate1ProofBundle(verified.bundle);
    setProofExportStatus(`Verified proof download requested again for ${filename}.`);
  }

  function runtimeMatches(
    view: LabRuntimeView | null,
    catalogState: "initial" | "pending",
    revision: number,
    minimumGeneration = 1
  ): view is LabRuntimeView {
    if (!view?.readiness?.runtimeCatalog || view.readinessError) return false;
    const expectedNames =
      catalogState === "pending" ? PENDING_CHECKOUT_TOOL_NAMES : INITIAL_CHECKOUT_TOOL_NAMES;
    return (
      view.capabilitiesChecked &&
      view.registryStatus.phase === "ready" &&
      sameNames(view.registryStatus.toolNames, expectedNames) &&
      view.readiness.status === "consumer-ready" &&
      view.readiness.manifest.catalogState === catalogState &&
      view.readiness.fixtureRevision === revision &&
      view.readiness.runtimeCatalog.generation === view.registryStatus.generation &&
      view.readiness.runtimeCatalog.generation >= minimumGeneration &&
      view.session.state.revision === revision &&
      (catalogState === "pending") === (view.session.state.pendingCheckout !== null)
    );
  }

  async function waitForRuntime(
    label: string,
    predicate: (view: LabRuntimeView) => boolean
  ): Promise<LabRuntimeView> {
    const deadline = Date.now() + AUTOMATED_PROOF_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const view = runtimeView.current;
      if (view && predicate(view)) return view;
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`${label} did not reach its exact runtime boundary within 12 seconds.`);
  }

  function requireAutomatedReceipt(
    outcome: NativeRunOutcome,
    toolName: CheckoutToolName,
    expectedCode: string | "ok",
    replayed?: boolean
  ): ExecuteOnceResult {
    if (outcome.status !== "receipt") {
      throw new Error(`${toolName} failed: ${JSON.stringify(outcome.error)}`);
    }
    const result = outcome.receipt.canonicalResult as {
      readonly ok?: unknown;
      readonly code?: unknown;
      readonly replayed?: unknown;
    };
    const codeMatches = expectedCode === "ok" ? result.ok === true : result.code === expectedCode;
    if (
      outcome.receipt.toolName !== toolName ||
      outcome.receipt.nativeCallCount !== 1 ||
      !codeMatches ||
      (replayed !== undefined && result.replayed !== replayed)
    ) {
      throw new Error(`${toolName} returned an unexpected automated proof receipt.`);
    }
    return outcome.receipt;
  }

  const runAutomatedProofSequence = useEffectEvent(
    async (request: AutomatedProofRequest): Promise<void> => {
      const sequenceStartedAt = new Date().toISOString();
      const sequenceStartedMs = performance.now();
      let completedSteps = 0;
      let activeStepName = "initial_readiness";
      clearVerifiedAutomatedProof(environment);
      setVerifiedProofAvailable(false);
      setAutomatedProofStatus({
        phase: "running",
        stepIndex: 0,
        stepName: activeStepName,
        message: "Waiting for a fresh initial consumer-ready catalog…",
        startedAt: sequenceStartedAt,
        updatedAt: sequenceStartedAt
      });
      environment.proofJournal.recordAutomatedSequenceStarted({
        sequenceVersion: AUTOMATED_PROOF_SEQUENCE_VERSION,
        sequenceId: request.sequenceId,
        requestedAt: request.requestedAt,
        startedAt: sequenceStartedAt,
        appCommit: APP_COMMIT,
        navigation: "reload",
        stepCount: AUTOMATED_PROOF_STEP_NAMES.length,
        minimumStepMs: AUTOMATED_PROOF_MIN_STEP_MS,
        readinessTimeoutMs: AUTOMATED_PROOF_READY_TIMEOUT_MS
      });

      const runStep = async (
        stepIndex: number,
        stepName: (typeof AUTOMATED_PROOF_STEP_NAMES)[number],
        action: () => Promise<AutomatedStepResult>
      ): Promise<AutomatedStepResult> => {
        activeStepName = stepName;
        const startedAt = new Date().toISOString();
        const startedMs = performance.now();
        setAutomatedProofStatus({
          phase: "running",
          stepIndex,
          stepName,
          message: `Step ${stepIndex} of ${AUTOMATED_PROOF_STEP_NAMES.length}: ${stepName}…`,
          startedAt: sequenceStartedAt,
          updatedAt: startedAt
        });
        try {
          const result = await action();
          let elapsed = performance.now() - startedMs;
          while (elapsed < AUTOMATED_PROOF_MIN_STEP_MS) {
            await new Promise<void>((resolve) =>
              setTimeout(resolve, Math.ceil(AUTOMATED_PROOF_MIN_STEP_MS - elapsed))
            );
            elapsed = performance.now() - startedMs;
          }
          const completedAt = new Date().toISOString();
          const durationMs = Math.max(0, Math.floor(performance.now() - startedMs));
          completedSteps = stepIndex;
          environment.proofJournal.recordAutomatedSequenceStep({
            sequenceVersion: AUTOMATED_PROOF_SEQUENCE_VERSION,
            sequenceId: request.sequenceId,
            stepIndex,
            stepName,
            startedAt,
            completedAt,
            durationMs,
            status: "completed",
            binding: result.binding,
            boundId: result.boundId,
            outcome: result.outcome
          });
          return result;
        } catch (error) {
          const completedAt = new Date().toISOString();
          environment.proofJournal.recordAutomatedSequenceStep({
            sequenceVersion: AUTOMATED_PROOF_SEQUENCE_VERSION,
            sequenceId: request.sequenceId,
            stepIndex,
            stepName,
            startedAt,
            completedAt,
            durationMs: Math.max(0, Math.round(performance.now() - startedMs)),
            status: "error",
            error: errorReceipt(error)
          });
          throw error;
        }
      };

      try {
        const initialView = await waitForRuntime("Initial catalog", (view) =>
          runtimeMatches(view, "initial", 0)
        );
        if (
          (await canonicalSha256(initialView.session.state)) !== CHECKOUT_FIXTURE_STATE_HASH ||
          environment.proofJournal
            .snapshot()
            .entries.some(({ kind }) => kind === "native_attempt_started")
        ) {
          throw new Error("The automated proof document is not a fresh declared fixture.");
        }
        const initialGeneration = initialView.readiness!.runtimeCatalog!.generation;

        await runStep(1, "cart_get", async () => {
          const receipt = requireAutomatedReceipt(
            await runNative("cart_get", {}, "automation"),
            "cart_get",
            "ok"
          );
          return { binding: "executionId", boundId: receipt.executionId, outcome: "ok" };
        });
        await runStep(2, "order_review", async () => {
          const receipt = requireAutomatedReceipt(
            await runNative("order_review", {}, "automation"),
            "order_review",
            "ok"
          );
          return { binding: "executionId", boundId: receipt.executionId, outcome: "ok" };
        });
        await runStep(3, "cart_update_invalid", async () => {
          const receipt = requireAutomatedReceipt(
            await runNative(
              "cart_update",
              {
                operationId: "short",
                operation: "set_quantity",
                itemId: "stoneware-mug",
                quantity: 3
              },
              "automation"
            ),
            "cart_update",
            "invalid_operation_id",
            false
          );
          return {
            binding: "executionId",
            boundId: receipt.executionId,
            outcome: "invalid_operation_id"
          };
        });

        const updateInput = Object.freeze({
          operationId: operationId("auto_update"),
          operation: "set_quantity" as const,
          itemId: "stoneware-mug" as const,
          quantity: 3
        });
        await runStep(4, "cart_update_valid", async () => {
          const receipt = requireAutomatedReceipt(
            await runNative("cart_update", updateInput, "automation"),
            "cart_update",
            "updated",
            false
          );
          await waitForRuntime("Updated initial catalog", (view) =>
            runtimeMatches(view, "initial", 1, initialGeneration)
          );
          return { binding: "executionId", boundId: receipt.executionId, outcome: "updated" };
        });
        await runStep(5, "cart_update_replay", async () => {
          const receipt = requireAutomatedReceipt(
            await runNative("cart_update", updateInput, "automation"),
            "cart_update",
            "updated",
            true
          );
          return { binding: "executionId", boundId: receipt.executionId, outcome: "replayed" };
        });

        let resetId = "";
        await runStep(6, "verified_hard_reset", async () => {
          const reset = await hardReset("automation");
          if (!reset) throw new Error("Automated hard reset was not admitted.");
          resetId = reset.resetId;
          await waitForRuntime("Verified hard reset", (view) =>
            Boolean(
              runtimeMatches(view, "initial", 0, initialGeneration) &&
              view.verifiedReset?.resetId === reset.resetId &&
              view.verifiedReset.status === "verified" &&
              !view.resetting &&
              !environment.store.isResetAdmissionLocked()
            )
          );
          return { binding: "resetId", boundId: reset.resetId, outcome: "verified" };
        });

        const requestInput = Object.freeze({ operationId: operationId("auto_request") });
        let pendingGeneration = initialGeneration;
        await runStep(7, "checkout_request", async () => {
          const receipt = requireAutomatedReceipt(
            await runNative("checkout_request", requestInput, "automation"),
            "checkout_request",
            "pending_human_approval",
            false
          );
          const pendingView = await waitForRuntime("Pending catalog", (view) =>
            runtimeMatches(view, "pending", 1, initialGeneration + 1)
          );
          pendingGeneration = pendingView.readiness!.runtimeCatalog!.generation;
          return {
            binding: "executionId",
            boundId: receipt.executionId,
            outcome: "pending_human_approval"
          };
        });
        await runStep(8, "checkout_request_replay", async () => {
          const receipt = requireAutomatedReceipt(
            await runNative("checkout_request", requestInput, "automation"),
            "checkout_request",
            "pending_human_approval",
            true
          );
          return { binding: "executionId", boundId: receipt.executionId, outcome: "replayed" };
        });
        await runStep(9, "checkout_request_already_pending", async () => {
          const receipt = requireAutomatedReceipt(
            await runNative(
              "checkout_request",
              { operationId: operationId("auto_request_other") },
              "automation"
            ),
            "checkout_request",
            "already_pending",
            false
          );
          return {
            binding: "executionId",
            boundId: receipt.executionId,
            outcome: "already_pending"
          };
        });
        await runStep(10, "checkout_cancel", async () => {
          const receipt = requireAutomatedReceipt(
            await runNative(
              "checkout_cancel",
              { operationId: operationId("auto_cancel") },
              "automation"
            ),
            "checkout_cancel",
            "checkout_canceled",
            false
          );
          await waitForRuntime("Restored initial catalog", (view) =>
            runtimeMatches(view, "initial", 2, pendingGeneration + 1)
          );
          return {
            binding: "executionId",
            boundId: receipt.executionId,
            outcome: "checkout_canceled"
          };
        });
        await runStep(11, "cart_get_cancellation", async () => {
          const outcome = await runNativeCancellationProbe("automation");
          if (
            outcome.status !== "error" ||
            outcome.error.code !== "execution_canceled" ||
            outcome.error.nativeCallMade !== true ||
            !outcome.executionId
          ) {
            throw new Error("The harmless cancellation probe did not reach its exact boundary.");
          }
          return {
            binding: "executionId",
            boundId: outcome.executionId,
            outcome: "execution_canceled"
          };
        });

        const preliminaryBundle = await buildCurrentGate1ProofBundle();
        const preliminaryVerification = await verifyGate1NativeProofSequence(preliminaryBundle, {
          allowUnfinishedAutomation: true
        });
        const completedAt = new Date().toISOString();
        environment.proofJournal.recordAutomatedSequenceFinished({
          sequenceVersion: AUTOMATED_PROOF_SEQUENCE_VERSION,
          sequenceId: request.sequenceId,
          status: "verified",
          completedAt,
          durationMs: Math.max(0, Math.round(performance.now() - sequenceStartedMs)),
          completedSteps,
          nativeAttemptCount: preliminaryVerification.attemptCount,
          resetId,
          verificationStatus: preliminaryVerification.status,
          cancellationTraceStatus: preliminaryVerification.cancellationTraceStatus
        });
        const finalBundle = await buildCurrentGate1ProofBundle();
        await verifyGate1NativeProofSequence(finalBundle);
        const filename = await exportGate1Proof("automation", finalBundle);
        if (!filename) throw new Error("The verified proof download request could not be created.");
        setAutomatedProofStatus({
          phase: "download-requested",
          stepIndex: AUTOMATED_PROOF_STEP_NAMES.length,
          stepName: "complete",
          message: `Verified proof download requested: ${filename}`,
          startedAt: sequenceStartedAt,
          updatedAt: new Date().toISOString()
        });
      } catch (error) {
        const completedAt = new Date().toISOString();
        environment.store.abandonResetAdmission();
        environment.proofJournal.recordAutomatedSequenceFinished({
          sequenceVersion: AUTOMATED_PROOF_SEQUENCE_VERSION,
          sequenceId: request.sequenceId,
          status: "failed",
          completedAt,
          durationMs: Math.max(0, Math.round(performance.now() - sequenceStartedMs)),
          completedSteps,
          failedStep: activeStepName,
          error: errorReceipt(error)
        });
        setAutomatedProofStatus({
          phase: "error",
          stepIndex: completedSteps + 1,
          stepName: activeStepName,
          message: `Proof run stopped at ${activeStepName}; no verified file was downloaded.`,
          startedAt: sequenceStartedAt,
          updatedAt: completedAt
        });
        setProofExportError(errorReceipt(error));
      } finally {
        automatedStepInFlight.current = false;
        operationAdmission.current = "idle";
        setBusy(false);
        setResetting(false);
        setProofExporting(false);
      }
    }
  );

  function requestAutomatedProofRun(): void {
    if (operationAdmission.current !== "idle") return;
    const requestedAt = new Date();
    const request: AutomatedProofRequest = Object.freeze({
      version: AUTOMATED_PROOF_SEQUENCE_VERSION,
      sequenceId: operationId("sequence"),
      requestedAt: requestedAt.toISOString(),
      expiresAt: new Date(requestedAt.getTime() + AUTOMATED_PROOF_REQUEST_TTL_MS).toISOString(),
      appCommit: APP_COMMIT,
      path: "/lab"
    });
    try {
      operationAdmission.current = "automation";
      const serialized = JSON.stringify(request);
      globalThis.sessionStorage.setItem(AUTOMATED_PROOF_REQUEST_KEY, serialized);
      if (globalThis.sessionStorage.getItem(AUTOMATED_PROOF_REQUEST_KEY) !== serialized) {
        throw new Error("The one-shot proof request could not be verified in session storage.");
      }
      setAutomatedProofStatus({
        phase: "reloading",
        stepIndex: 0,
        stepName: "clean_reload",
        message: "Reloading once to create a clean proof document…",
        startedAt: null,
        updatedAt: new Date().toISOString()
      });
      globalThis.location.reload();
    } catch (error) {
      operationAdmission.current = "idle";
      setAutomatedProofStatus({
        phase: "error",
        stepIndex: 0,
        stepName: "request",
        message: "The clean proof reload could not be requested.",
        startedAt: null,
        updatedAt: new Date().toISOString()
      });
      setProofExportError(errorReceipt(error));
    }
  }

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = globalThis.sessionStorage.getItem(AUTOMATED_PROOF_REQUEST_KEY);
      if (raw === null) return;
      globalThis.sessionStorage.removeItem(AUTOMATED_PROOF_REQUEST_KEY);
      if (globalThis.sessionStorage.getItem(AUTOMATED_PROOF_REQUEST_KEY) !== null) {
        throw new Error("The one-shot proof request could not be consumed.");
      }
      const navigation = performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined;
      if (navigation?.type !== "reload" || globalThis.location.pathname !== "/lab") {
        throw new Error("Automated proof execution requires one clean same-path reload.");
      }
      const request = parseAutomatedProofRequest(raw, Date.now());
      if (
        automatedProofStarted.current ||
        operationAdmission.current !== "idle" ||
        !claimAutomatedProof(environment)
      ) {
        throw new Error("An automated proof run is already claimed by this document.");
      }
      automatedProofStarted.current = true;
      operationAdmission.current = "automation";
      queueMicrotask(() => void runAutomatedProofSequence(request));
    } catch (error) {
      operationAdmission.current = "idle";
      setAutomatedProofStatus({
        phase: "error",
        stepIndex: 0,
        stepName: "request_validation",
        message: "The one-shot proof request was rejected; no native calls were made.",
        startedAt: null,
        updatedAt: new Date().toISOString()
      });
      setProofExportError(errorReceipt(error));
    }
  }, [environment]);

  function refreshNativeIds(): void {
    setNativeUpdateId(operationId("native_update"));
    setNativeRequestId(operationId("native_request"));
    setNativeCancelId(operationId("native_cancel"));
    setLastNativeMutation(undefined);
  }

  const review = orderReview(session.state);
  const nativeTrace = latestNativeTrace(traces);
  const currentTrace = latestTrace(traces);
  const pending = session.state.pendingCheckout !== null;
  const providerPresent = capabilities.providerRegistration;
  const consumerPresent = capabilities.inPageExecution;
  const readinessCurrent =
    readiness?.fixtureRevision === session.state.revision &&
    readiness.manifest.catalogState === (pending ? "pending" : "initial");
  const runtimeSetupPending =
    !capabilitiesChecked ||
    (providerPresent &&
      !readinessError &&
      (registryStatus.phase === "registering" ||
        (registryStatus.phase === "idle" && !readiness) ||
        (registryStatus.phase === "ready" &&
          (!readinessCurrent ||
            (consumerPresent && readiness?.status === "consumer-discovered")))));
  const automatedProofActive =
    automatedProofStatus.phase === "reloading" || automatedProofStatus.phase === "running";
  const controlsDisabled =
    busy ||
    judgeBusy ||
    resetting ||
    proofExporting ||
    automatedProofActive ||
    runtimeSetupPending ||
    !!session.haltedReason;
  const nativeControlsReady =
    readiness?.status === "consumer-ready" &&
    !readinessError &&
    registryStatus.phase === "ready" &&
    sameNames(registryStatus.toolNames, desiredNames) &&
    readiness.runtimeCatalog?.generation === (registryStatus.generation ?? 0) &&
    readiness.fixtureRevision === session.state.revision &&
    readiness.manifest.catalogState === (pending ? "pending" : "initial");
  const replayAvailable =
    !!lastNativeMutation &&
    !!readiness?.runtimeCatalog?.tools.some(({ name }) => name === lastNativeMutation.toolName);
  const judgeRuntimeBinding: JudgeBrowserRuntimeBinding | null =
    nativeControlsReady &&
    readiness?.runtimeCatalog &&
    readiness.argumentMode !== "unverified" &&
    !pending &&
    session.haltedReason === null &&
    sameNames(registryStatus.toolNames, INITIAL_CHECKOUT_TOOL_NAMES)
      ? Object.freeze({
          appCommit: APP_COMMIT,
          readinessStatus: "consumer-ready",
          manifestHash: readiness.manifestHash,
          stateHash: readiness.stateHash,
          fixtureRevision: 0,
          catalogState: "initial",
          registrationGeneration: readiness.runtimeCatalog.generation,
          argumentMode: readiness.argumentMode,
          toolNames: INITIAL_CHECKOUT_TOOL_NAMES,
          haltFree: true
        })
      : null;

  return (
    <div
      className="lab-layout"
      aria-busy={busy || judgeBusy || resetting || proofExporting || automatedProofActive}
    >
      <section className="panel cart-panel" aria-labelledby="cart-title">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Declared fixture</span>
            <h2 id="cart-title">Seeded checkout sandbox</h2>
          </div>
          <span className="fixture-id">
            {session.state.fixtureId} · r{session.state.revision}
          </span>
        </div>

        {pending ? (
          <p className="pending-notice" role="status">
            Simulated checkout pending human approval. Cart changes are blocked until cancellation.
          </p>
        ) : null}
        {session.haltedReason ? (
          <p className="pending-notice" role="alert">
            Session halted after {session.haltedReason.code}. The committed state is preserved; hard
            reset is required before another operation.
          </p>
        ) : null}

        <ul className="cart-lines" aria-label="Cart items">
          {session.state.lines.map((line) => (
            <li key={line.itemId}>
              <div>
                <strong>{line.name}</strong>
                <span>{line.itemId}</span>
              </div>
              <div className="line-numbers">
                <span aria-label={`Current quantity ${line.quantity}`}>
                  Current × {line.quantity}
                </span>
                <label className="quantity-editor">
                  <span>Desired</span>
                  <input
                    aria-label={`${line.name} quantity`}
                    type="number"
                    min="1"
                    max="10"
                    step="1"
                    value={quantities[line.itemId] ?? String(line.quantity)}
                    disabled={controlsDisabled || pending}
                    onChange={(event) => {
                      const quantity = event.currentTarget.value;
                      setQuantities((current) => ({
                        ...current,
                        [line.itemId]: quantity
                      }));
                    }}
                  />
                </label>
                <button
                  className="button button-compact button-secondary"
                  disabled={
                    controlsDisabled ||
                    pending ||
                    !Number.isInteger(Number(quantities[line.itemId])) ||
                    Number(quantities[line.itemId]) < 1 ||
                    Number(quantities[line.itemId]) > 10
                  }
                  onClick={() => void updateLine(line.itemId)}
                >
                  Set
                </button>
                <strong>{formatCurrency(line.unitPriceCents * line.quantity)}</strong>
              </div>
            </li>
          ))}
        </ul>

        <div className="cart-summary">
          <span>Subtotal · standard shipping {formatCurrency(review.shipping.shippingCents)}</span>
          <strong>{formatCurrency(review.totalCents)}</strong>
        </div>

        <div className="button-row">
          <button
            className="button button-primary"
            disabled={controlsDisabled}
            onClick={() => void runUi(() => environment.store.cartGet({}, { source: "ui" }))}
          >
            Read cart in UI
          </button>
          <button
            className="button button-secondary"
            disabled={controlsDisabled}
            onClick={() => void runUi(() => environment.store.orderReview({}, { source: "ui" }))}
          >
            Review order in UI
          </button>
          {pending ? (
            <button
              className="button button-secondary"
              disabled={controlsDisabled}
              onClick={() =>
                void runUi(() =>
                  environment.store.checkoutCancel(
                    { operationId: operationId("ui_cancel") },
                    { source: "ui" }
                  )
                )
              }
            >
              Cancel simulated checkout
            </button>
          ) : (
            <button
              className="button button-secondary"
              disabled={controlsDisabled}
              onClick={() =>
                void runUi(() =>
                  environment.store.checkoutRequest(
                    { operationId: operationId("ui_request") },
                    { source: "ui" }
                  )
                )
              }
            >
              Request simulated checkout
            </button>
          )}
          <button
            className="button button-secondary"
            disabled={controlsDisabled}
            onClick={() => void hardReset()}
          >
            Hard reset fixture
          </button>
        </div>

        <div className="receipt-line" aria-live="polite">
          <span>UI receipt</span>
          {uiReceipt ? (
            <pre tabIndex={0}>{JSON.stringify(uiReceipt, null, 2)}</pre>
          ) : (
            <small>No UI operation yet.</small>
          )}
          {uiError ? (
            <pre className="error-text" role="alert" tabIndex={0}>
              {JSON.stringify(uiError, null, 2)}
            </pre>
          ) : null}
        </div>
      </section>

      <section className="panel capability-panel" aria-labelledby="capability-title">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Runtime truth</span>
            <h2 id="capability-title">WebMCP capability matrix</h2>
          </div>
        </div>

        <dl className="capability-list">
          <div>
            <dt>Secure context</dt>
            <dd>{capabilityLabel(capabilities.secureContext, "Ready", "Required")}</dd>
          </div>
          <div>
            <dt>Site Tools provider · registerTool()</dt>
            <dd>
              {capabilityLabel(capabilities.providerRegistration, "Available", "Unavailable")}
            </dd>
          </div>
          <div>
            <dt>In-page discovery · getTools()</dt>
            <dd>{capabilityLabel(capabilities.inPageDiscovery, "Available", "Unavailable")}</dd>
          </div>
          <div>
            <dt>In-page execution · executeTool()</dt>
            <dd>{capabilityLabel(capabilities.inPageExecution, "Available", "Unavailable")}</dd>
          </div>
          <div>
            <dt>Direct ChatGPT path</dt>
            <dd>
              {capabilities.providerRegistration
                ? "Provider API available; registry proof below"
                : "Unavailable"}
            </dd>
          </div>
          <div>
            <dt>Chrome model-selection path</dt>
            <dd>
              {capabilities.inPageDiscovery && capabilities.inPageExecution
                ? "Consumer APIs available; readiness below"
                : "Unavailable in this document"}
            </dd>
          </div>
        </dl>

        <div className="runtime-receipt" aria-live="polite">
          <span>Registry</span>
          <strong>{registryStatus.phase}</strong>
          <small>
            {registryStatus.toolNames.join(", ") || "No verified native tools detected."}
          </small>
          <small>Generation {registryStatus.generation ?? 0}</small>
          {registryStatus.error ? (
            <small className="error-text">{registryStatus.error}</small>
          ) : null}
        </div>

        {readiness ? (
          <div className="runtime-receipt" aria-live="polite">
            <span>Readiness receipt</span>
            <strong>{readiness.status}</strong>
            <small>Manifest {readiness.manifestHash.slice(0, 16)}…</small>
            <small>Discovery: {readiness.consumerDiscovery}</small>
            <small>Execution: {readiness.consumerExecution}</small>
            <small>Argument mode: {readiness.argumentMode}</small>
            <small>Catalog: {readiness.manifest.catalogState}</small>
            {readiness.compatibilityReceipt ? (
              <small>Calibration trace: {readiness.compatibilityReceipt.handlerTraceId}</small>
            ) : null}
          </div>
        ) : null}
        {readinessError ? (
          <pre className="error-text" role="alert" tabIndex={0}>
            {JSON.stringify(readinessError, null, 2)}
          </pre>
        ) : null}
      </section>

      <JudgeDemoPanel
        runtimeBinding={judgeRuntimeBinding}
        cleanFixture={
          !pending &&
          session.state.revision === 0 &&
          session.haltedReason === null &&
          readiness?.stateHash === CHECKOUT_FIXTURE_STATE_HASH &&
          readiness.manifest.catalogState === "initial"
        }
        admissionReady={!controlsDisabled}
        beginSequence={beginJudgeSequence}
        endSequence={endJudgeSequence}
        executeVerifiedDecision={executeVerifiedJudgeDecision}
      />

      {/* thurstone-impact-execution:lab-expert-diagnostics */}
      <details suppressHydrationWarning className="lab-expert-diagnostics">
        <summary>Lab plumbing, reset receipts, and Gate 1 proof</summary>
        <div className="lab-expert-diagnostics-content">
          <section className="panel trace-panel" aria-labelledby="native-title">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Gate 1 plumbing only · not model selection</span>
                <h2 id="native-title">Direct native WebMCP controls</h2>
              </div>
              <button
                className="button button-compact button-secondary"
                disabled={controlsDisabled}
                onClick={refreshNativeIds}
              >
                New operation IDs
              </button>
            </div>

            <div className="native-fields">
              <label>
                <span>cart_update operationId</span>
                <input
                  disabled={controlsDisabled}
                  value={nativeUpdateId}
                  onChange={(event) => setNativeUpdateId(event.currentTarget.value)}
                />
              </label>
              <label>
                <span>checkout_request operationId</span>
                <input
                  disabled={controlsDisabled}
                  value={nativeRequestId}
                  onChange={(event) => setNativeRequestId(event.currentTarget.value)}
                />
              </label>
              <label>
                <span>checkout_cancel operationId</span>
                <input
                  disabled={controlsDisabled}
                  value={nativeCancelId}
                  onChange={(event) => setNativeCancelId(event.currentTarget.value)}
                />
              </label>
            </div>

            <div className="button-row native-actions">
              <button
                className="button button-secondary"
                disabled={controlsDisabled || !nativeControlsReady}
                onClick={() => void runNative("cart_get", {})}
              >
                Native cart_get
              </button>
              <button
                className="button button-secondary"
                disabled={controlsDisabled || !nativeControlsReady}
                onClick={() => void runNativeCancellationProbe()}
              >
                Native cart_get cancellation probe
              </button>
              <button
                className="button button-secondary"
                disabled={controlsDisabled || !nativeControlsReady}
                onClick={() => void runNative("order_review", {})}
              >
                Native order_review
              </button>
              <button
                className="button button-secondary"
                disabled={controlsDisabled || !nativeControlsReady || pending}
                onClick={() =>
                  void runNative("cart_update", {
                    operationId: nativeUpdateId,
                    operation: "set_quantity",
                    itemId: "stoneware-mug",
                    quantity: 3
                  })
                }
              >
                Native cart_update
              </button>
              <button
                className="button button-secondary"
                disabled={controlsDisabled || !nativeControlsReady}
                onClick={() => void runNative("checkout_request", { operationId: nativeRequestId })}
              >
                Native checkout_request
              </button>
              <button
                className="button button-secondary"
                disabled={controlsDisabled || !nativeControlsReady || !pending}
                onClick={() => void runNative("checkout_cancel", { operationId: nativeCancelId })}
              >
                Native checkout_cancel
              </button>
              <button
                className="button button-secondary"
                disabled={controlsDisabled || !nativeControlsReady || !replayAvailable}
                onClick={() =>
                  lastNativeMutation
                    ? void runNative(lastNativeMutation.toolName, lastNativeMutation.input)
                    : undefined
                }
              >
                Replay last native mutation
              </button>
            </div>

            <p className="trace-note">
              Cancellation is recorded at both boundaries. Chrome may reject the consumer call after
              the harmless cart_get handler has already completed; the journal preserves that
              completed no-effect handler trace separately and never relabels it as handler
              cancellation.
            </p>

            <div className="receipt-grid">
              <article>
                <h3>Native adapter receipt</h3>
                {nativeReceipt ? (
                  <pre tabIndex={0}>{JSON.stringify(nativeReceipt, null, 2)}</pre>
                ) : (
                  <p>
                    No operator-triggered executeOnce call yet. Automatic compatibility calibration
                    is shown in the readiness receipt and is not model-selection evidence.
                  </p>
                )}
                {nativeError ? (
                  <pre className="error-text" role="alert" tabIndex={0}>
                    {JSON.stringify(nativeError, null, 2)}
                  </pre>
                ) : null}
              </article>
              <article>
                <h3>Latest native handler trace</h3>
                {nativeTrace ? (
                  <pre tabIndex={0}>{JSON.stringify(nativeTrace, null, 2)}</pre>
                ) : (
                  <p>No native handler trace yet.</p>
                )}
                {nativeError && nativeTrace ? (
                  <p>The latest handler trace may predate the current adapter error.</p>
                ) : null}
              </article>
            </div>
          </section>

          <section className="panel trace-panel" aria-labelledby="trace-title">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Append-only domain evidence</span>
                <h2 id="trace-title">Latest operation and reset receipt</h2>
              </div>
              <span className="fixture-id">{traces.totalTraceCount} events</span>
            </div>

            <div className="receipt-grid">
              <article>
                <h3>Latest canonical operation trace</h3>
                {currentTrace ? (
                  <pre tabIndex={0}>{JSON.stringify(currentTrace, null, 2)}</pre>
                ) : (
                  <p>No operation trace yet.</p>
                )}
              </article>
              <article>
                <h3>Reset verification receipt</h3>
                {verifiedReset ? (
                  <pre tabIndex={0}>{JSON.stringify(verifiedReset, null, 2)}</pre>
                ) : resetting ? (
                  <p>Reset committed; registry verification pending.</p>
                ) : (
                  <p>No hard reset receipt yet.</p>
                )}
              </article>
            </div>

            <p className="trace-note">
              UI and native handlers share one serialized checkout store. Direct expected calls
              above are plumbing evidence only and are never counted as semantic model-selection
              evidence.
            </p>
          </section>

          <section className="panel trace-panel" aria-labelledby="proof-export-title">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">One document · one attachment</span>
                <h2 id="proof-export-title">Gate 1 proof bundle</h2>
              </div>
            </div>
            <p>
              One click reloads into a clean document, waits for every exact runtime boundary, runs
              the fixed ten-call native sequence and one verified reset, records step timestamps and
              durations, validates the strict Gate 1 completion predicate, and requests one JSON
              download. It includes no cookies, browser history, account data, or automatic upload.
            </p>
            <div className="button-row">
              <button
                type="button"
                className="button button-primary"
                disabled={busy || resetting || proofExporting || automatedProofActive}
                onClick={requestAutomatedProofRun}
              >
                {automatedProofStatus.phase === "error"
                  ? "Restart clean Gate 1 proof run"
                  : automatedProofActive
                    ? "Running clean Gate 1 proof…"
                    : "Run clean Gate 1 proof and download"}
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={controlsDisabled}
                onClick={() => void exportGate1Proof()}
              >
                Download current diagnostic JSON
              </button>
              {verifiedProofAvailable ? (
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={automatedProofActive}
                  onClick={retryVerifiedProofDownload}
                >
                  Download verified proof again
                </button>
              ) : null}
            </div>
            <p
              className={
                automatedProofStatus.phase === "error"
                  ? "proof-export-status error-text"
                  : "proof-export-status"
              }
              role={automatedProofStatus.phase === "error" ? "alert" : "status"}
              aria-live="polite"
            >
              {automatedProofStatus.message} Updated {automatedProofStatus.updatedAt}
              {automatedProofStatus.startedAt ? ` · Started ${automatedProofStatus.startedAt}` : ""}
            </p>
            <p className="trace-note">
              This is native-plumbing evidence only. Its hashes prove internal consistency, not
              external attestation, model selection, semantic scoring, or Direct ChatGPT behavior.
              The automatic download is requested locally; the verified in-memory bytes remain
              available for retry if the browser blocks it.
            </p>
            {proofExportStatus ? (
              <p className="proof-export-status" role="status" aria-live="polite">
                {proofExportStatus}
              </p>
            ) : null}
            {proofExportError ? (
              <pre className="error-text" role="alert" tabIndex={0}>
                {JSON.stringify(proofExportError, null, 2)}
              </pre>
            ) : null}
          </section>
        </div>
      </details>
    </div>
  );
}
