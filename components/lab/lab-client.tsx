"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

import {
  cartGet,
  orderReview,
  type CartGetResult,
  type CheckoutErrorResult,
  type MutationResult,
  type OrderReviewResult
} from "@/lib/domain/checkout";
import {
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
import type { OperationTrace } from "@/lib/evidence/operation-trace";
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
  readonly tools: CheckoutToolSet;
}

interface LastNativeMutation {
  readonly toolName: "cart_update" | "checkout_request" | "checkout_cancel";
  readonly input: Readonly<Record<string, unknown>>;
}

type CheckoutSessionSnapshot = ReturnType<CheckoutSessionStore["getSnapshot"]>;

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
  const store = new CheckoutSessionStore({ traceSink: ledger });
  return Object.freeze({ binding, store, ledger, tools: createCheckoutTools(store) });
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

  useEffect(() => {
    const detected = detectWebMcpCapabilities();
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) {
        setCapabilities(detected);
        setCapabilitiesChecked(true);
      }
    });
    return () => {
      disposed = true;
    };
  }, []);

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
      setRegistryStatus(status);
      if (status.phase !== "ready") setReadiness(undefined);
    });
  }, [desiredTools]);

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
          setReadiness(receipt);
          setReadinessError(undefined);
        }
      } catch (error) {
        if (!disposed && epoch === readinessEpoch.current) {
          setReadiness(undefined);
          setReadinessError(errorReceipt(error));
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
        if (!disposed) {
          if (!released) {
            setVerifiedReset(undefined);
            setUiError(
              Object.freeze({
                name: "ResetAdmissionMismatch",
                message: "Reset verification could not release the matching admission lock."
              })
            );
          } else {
            setVerifiedReset(receipt);
          }
          setResetting(false);
        }
      })
      .catch((error: unknown) => {
        environment.store.releaseResetAdmission(pendingDomainReset.resetId);
        if (!disposed) {
          setVerifiedReset(undefined);
          setUiError(errorReceipt(error));
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
              environment.store.releaseResetAdmission(receipt.resetId);
              setVerifiedReset(receipt);
              setResetting(false);
            }
          })
          .catch((error: unknown) => {
            environment.store.releaseResetAdmission(pendingDomainReset.resetId);
            setUiError(errorReceipt(error));
            setResetting(false);
          });
      },
      readinessError ? 0 : 3_000
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
    if (busy || resetting || !capabilitiesChecked) return;
    setBusy(true);
    setUiReceipt(undefined);
    setUiError(undefined);
    try {
      setUiReceipt(await operation());
    } catch (error) {
      setUiError(errorReceipt(error));
    } finally {
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

  async function hardReset(): Promise<void> {
    if (busy || resetting || !capabilitiesChecked) return;
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
        environment.store.releaseResetAdmission(receipt.resetId);
        setVerifiedReset(receipt);
        setResetting(false);
      }
    } catch (error) {
      environment.store.abandonResetAdmission();
      setUiError(errorReceipt(error));
      setResetting(false);
    }
  }

  async function runNative(
    toolName: CheckoutToolName,
    input: Readonly<Record<string, unknown>>
  ): Promise<void> {
    if (busy || resetting || !capabilitiesChecked) return;
    const catalogState = session.state.pendingCheckout ? "pending" : "initial";
    if (
      !readiness?.runtimeCatalog ||
      readiness.status !== "consumer-ready" ||
      readinessError ||
      registryStatus.phase !== "ready" ||
      !sameNames(registryStatus.toolNames, desiredNames) ||
      readiness.runtimeCatalog.generation !== (registryStatus.generation ?? 0) ||
      readiness.fixtureRevision !== session.state.revision ||
      readiness.manifest.catalogState !== catalogState
    ) {
      setNativeError(
        Object.freeze({
          name: "RuntimeNotReady",
          message: "Native plumbing controls require a consumer-ready WebMCP receipt."
        })
      );
      return;
    }
    const tool = readiness.runtimeCatalog.tools.find(({ name }) => name === toolName);
    if (!tool) {
      setNativeError(
        Object.freeze({
          name: "ToolUnavailable",
          message: `${toolName} is not present in the current verified catalog.`
        })
      );
      return;
    }

    setBusy(true);
    setNativeError(undefined);
    setNativeReceipt(undefined);
    try {
      const result = await webMcpRuntime.executeOnce({
        executionId: operationId("plumbing"),
        manifestHash: readiness.manifestHash,
        tool,
        input,
        observe: async (): Promise<ExecuteTraceObservation> => {
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
    } catch (error) {
      setNativeError(errorReceipt(error));
    } finally {
      setBusy(false);
    }
  }

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
  const controlsDisabled = busy || resetting || runtimeSetupPending || !!session.haltedReason;
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

  return (
    <div className="lab-layout" aria-busy={busy || resetting}>
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
            disabled={busy || resetting || !capabilitiesChecked}
            onClick={() => void hardReset()}
          >
            Hard reset fixture
          </button>
        </div>

        <div className="receipt-line">
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

        <div className="receipt-grid">
          <article>
            <h3>Native adapter receipt</h3>
            {nativeReceipt ? (
              <pre tabIndex={0}>{JSON.stringify(nativeReceipt, null, 2)}</pre>
            ) : (
              <p>
                No operator-triggered executeOnce call yet. Automatic compatibility calibration is
                shown in the readiness receipt and is not model-selection evidence.
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
          UI and native handlers share one serialized checkout store. Direct expected calls above
          are plumbing evidence only and are never counted as semantic model-selection evidence.
        </p>
      </section>
    </div>
  );
}
