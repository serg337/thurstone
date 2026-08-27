"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { cartGet } from "@/lib/domain/checkout";
import { verifyCheckoutReset } from "@/lib/domain/checkout-reset";
import { CheckoutSessionStore } from "@/lib/domain/checkout-session";
import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import { CheckoutTraceLedger } from "@/lib/evidence/checkout-trace-ledger";
import type { OperationTrace } from "@/lib/evidence/operation-trace";
import {
  PROBE_CLIENT_LAB_SESSION_KEY,
  PROBE_CLIENT_RESULTS_KEY,
  PROBE_CLIENT_SESSION_VERSION,
  parseProbeClientSessionMarker,
  serializeProbeClientSessionMarker,
  type ProbeClientSessionMarker
} from "@/lib/probe/client-session";
import {
  runProbeClientTrial,
  type ProbeBoundaryEvidence,
  type ProbeClientCompletionInput,
  type ProbeClientJsonValue,
  type ProbeClientTrialCapture,
  type ProbeOpaqueClaim,
  type ProbeVerifiedInitialBoundary
} from "@/lib/probe/client-runner";
import {
  PROBE_LIVE_MANIFEST_VERSION,
  createProbeFixtureSynopsis,
  probeLiveManifestSchema,
  type ProbeLiveManifest
} from "@/lib/probe/calibration-envelope";
import {
  probeCompleteResponseSchema,
  probeFreshDecisionResponseSchema,
  probeIssueResultSchema,
  probeNativeAdmissionResponseSchema,
  type ProbeCompleteResponse,
  type ProbeIssueResponse,
  type ProbeResetEvidence
} from "@/lib/probe/service-contract";
import { INITIAL_CHECKOUT_TOOL_NAMES } from "@/lib/webmcp/catalog";
import { createCheckoutTools } from "@/lib/webmcp/checkout-tools";
import { normalizeInputSchema } from "@/lib/webmcp/manifest-normalization";
import {
  createRegistryReadinessReceipt,
  type RegistryReadinessReceipt
} from "@/lib/webmcp/readiness";
import { webMcpRegistryManager, type RegistryStatus } from "@/lib/webmcp/registry-manager";
import {
  webMcpRuntime,
  type ExecuteOnceResult,
  type ExecuteTraceObservation,
  type RuntimeModelContext,
  type RuntimeObservation
} from "@/lib/webmcp/runtime";

const APP_COMMIT = process.env.NEXT_PUBLIC_TOOLPROOF_COMMIT_SHA?.trim() || "unversioned";
const READY_TIMEOUT_MS = 15_000;

interface ProbeEnvironment {
  readonly store: CheckoutSessionStore;
  readonly ledger: CheckoutTraceLedger;
  readonly tools: ReturnType<typeof createCheckoutTools>;
  readonly getRegistryHash: () => string;
  readonly setRegistryHash: (value: string) => void;
}

interface RuntimeView {
  readonly session: ReturnType<CheckoutSessionStore["getSnapshot"]>;
  readonly registry: RegistryStatus;
  readonly readiness: RegistryReadinessReceipt | null;
  readonly readinessError: string | null;
}

interface ProbeAuthorization {
  readonly version: 1;
  readonly probeToken: string;
  readonly envelope: ProbeIssueResponse["authorization"]["envelope"];
  readonly continuation: string;
}

interface ProbeExecutionResult {
  readonly receipt: ExecuteOnceResult;
  readonly trace: OperationTrace;
}

interface ProbeTrialEvidence {
  readonly version: "toolproof-probe-trial-evidence@1.0.0";
  readonly appCommit: string;
  readonly origin: string;
  readonly userAgent: string;
  readonly capturedAt: string;
  readonly capture: ProbeClientJsonValue;
  readonly currentTraces: ProbeClientJsonValue;
  readonly captureDigest: string;
}

type VerifiedProbeBoundary = ProbeVerifiedInitialBoundary<
  WebMCP.RegisteredTool,
  ProbeResetEvidence
>;

function createEnvironment(): ProbeEnvironment {
  let registryHash = "registry-unverified";
  const ledger = new CheckoutTraceLedger({
    getRegistryHash: () => registryHash,
    getArgumentMode: () => webMcpRuntime.argumentMode ?? "unverified",
    appCommit: APP_COMMIT
  });
  const store = new CheckoutSessionStore({ traceSink: ledger });
  return Object.freeze({
    store,
    ledger,
    tools: createCheckoutTools(store),
    getRegistryHash: () => registryHash,
    setRegistryHash: (value: string) => {
      registryHash = value;
    }
  });
}

function sameNames(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((name, index) => name === expected[index])
  );
}

function latestTrace(environment: ProbeEnvironment): OperationTrace | undefined {
  const snapshot = environment.ledger.snapshot();
  return [...snapshot.archives.flatMap(({ traces }) => traces), ...snapshot.current]
    .sort((left, right) => left.sequence - right.sequence)
    .at(-1);
}

async function observeRuntime(environment: ProbeEnvironment): Promise<RuntimeObservation> {
  const state = environment.store.getSnapshot().state;
  const snapshot = environment.ledger.snapshot();
  const trace = latestTrace(environment);
  return {
    stateHash: await canonicalSha256(state),
    manifestHash: environment.getRegistryHash(),
    handlerTraceCount: snapshot.totalTraceCount,
    ...(trace ? { lastHandlerTraceId: trace.eventId } : {}),
    ...(trace ? { lastEffectDigest: await canonicalSha256(trace.effect) } : {}),
    ...(trace
      ? {
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
        }
      : {})
  };
}

async function observeTrace(environment: ProbeEnvironment): Promise<ExecuteTraceObservation> {
  const snapshot = environment.ledger.snapshot();
  const trace = latestTrace(environment);
  return {
    stateHash: await canonicalSha256(environment.store.getSnapshot().state),
    handlerTraceCount: snapshot.totalTraceCount,
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

function jsonSnapshot(value: unknown): ProbeClientJsonValue {
  return JSON.parse(canonicalJson(value)) as ProbeClientJsonValue;
}

function liveManifest(readiness: RegistryReadinessReceipt): ProbeLiveManifest {
  if (!readiness.runtimeCatalog) throw new Error("runtime_catalog_missing");
  return probeLiveManifestSchema.parse({
    version: PROBE_LIVE_MANIFEST_VERSION,
    manifestHash: readiness.manifestHash,
    tools: [...readiness.runtimeCatalog.tools]
      .map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: normalizeInputSchema(tool.inputSchema),
        annotations: {
          readOnlyHint: tool.annotations?.readOnlyHint ?? false,
          untrustedContentHint: tool.annotations?.untrustedContentHint ?? false
        }
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
  });
}

async function fetchJson(
  path: string,
  csrfToken: string,
  body: unknown
): Promise<{ readonly response: Response; readonly value: unknown }> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-ToolProof-CSRF": csrfToken
    },
    body: JSON.stringify(body)
  });
  const value = (await response.json()) as unknown;
  if (!response.ok) {
    const code =
      value && typeof value === "object" && typeof (value as { error?: unknown }).error === "string"
        ? String((value as { error: string }).error)
        : "probe_request_failed";
    const inferencePerformed = Boolean(
      value &&
      typeof value === "object" &&
      (value as { inferencePerformed?: unknown }).inferencePerformed === true
    );
    const requestError = new Error(code) as Error & {
      code: string;
      httpStatus: number;
      inferencePerformed: boolean;
    };
    requestError.code = code;
    requestError.httpStatus = response.status;
    requestError.inferencePerformed = inferencePerformed;
    throw requestError;
  }
  return { response, value };
}

export function ProbeCalibrationRunner() {
  const [environment] = useState(createEnvironment);
  const session = useSyncExternalStore(
    environment.store.subscribe.bind(environment.store),
    environment.store.getSnapshot,
    environment.store.getSnapshot
  );
  const desiredTools = environment.tools.forState(session.state);
  const [registry, setRegistry] = useState<RegistryStatus>({ phase: "idle", toolNames: [] });
  const [readiness, setReadiness] = useState<RegistryReadinessReceipt | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [phase, setPhase] = useState("Preparing a fresh native runtime…");
  const [error, setError] = useState<string>();
  const [uncertain, setUncertain] = useState(false);
  const runtimeRef = useRef<RuntimeView>({
    session,
    registry,
    readiness,
    readinessError
  });
  const readinessEpoch = useRef(0);
  const started = useRef(false);
  const markerRef = useRef<ProbeClientSessionMarker | undefined>(undefined);
  const authorizationRef = useRef<ProbeAuthorization | undefined>(undefined);
  const providerReceiptRef = useRef<ProbeClientJsonValue | undefined>(undefined);
  const initialBoundaryRef = useRef<ProbeBoundaryEvidence<ProbeResetEvidence> | undefined>(
    undefined
  );
  const inferenceUncertainRef = useRef(false);

  useEffect(() => {
    runtimeRef.current = { session, registry, readiness, readinessError };
  }, [readiness, readinessError, registry, session]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context || typeof context.registerTool !== "function") {
      queueMicrotask(() => setReadinessError("webmcp_provider_unavailable"));
      return;
    }
    return webMcpRegistryManager.acquire(context, desiredTools, (status) => {
      setRegistry(status);
      if (status.phase !== "ready") setReadiness(null);
    });
  }, [desiredTools, environment]);

  useEffect(() => {
    const context = document.modelContext;
    const generation = registry.generation ?? 0;
    const expectedNames = session.state.pendingCheckout
      ? environment.tools.pending.map(({ name }) => name)
      : INITIAL_CHECKOUT_TOOL_NAMES;
    if (
      !context ||
      registry.phase !== "ready" ||
      generation < 1 ||
      !sameNames(registry.toolNames, expectedNames)
    ) {
      return;
    }
    const epoch = ++readinessEpoch.current;
    let disposed = false;
    void (async () => {
      try {
        let receipt = await createRegistryReadinessReceipt(context, {
          state: environment.store.getSnapshot().state,
          appCommit: APP_COMMIT,
          registrationGeneration: generation,
          ...(webMcpRuntime.compatibilityReceipt
            ? { compatibilityReceipt: webMcpRuntime.compatibilityReceipt }
            : {})
        });
        if (disposed || epoch !== readinessEpoch.current) return;
        environment.setRegistryHash(receipt.manifestHash);
        const consumer = context as RuntimeModelContext;
        if (
          !webMcpRuntime.compatibilityReceipt &&
          receipt.status === "consumer-discovered" &&
          receipt.runtimeCatalog &&
          typeof consumer.executeTool === "function"
        ) {
          const cartTool = receipt.runtimeCatalog.tools.find(({ name }) => name === "cart_get");
          if (!cartTool) throw new Error("compatibility_tool_missing");
          const compatibility = await webMcpRuntime.initializeWithCartGet({
            context: consumer,
            catalog: receipt.runtimeCatalog,
            cartTool,
            expectedCartResult: cartGet(environment.store.getSnapshot().state),
            observe: () => observeRuntime(environment)
          });
          receipt = await createRegistryReadinessReceipt(context, {
            state: environment.store.getSnapshot().state,
            appCommit: APP_COMMIT,
            registrationGeneration: generation,
            compatibilityReceipt: compatibility
          });
        }
        if (
          !disposed &&
          epoch === readinessEpoch.current &&
          receipt.status === "consumer-ready" &&
          receipt.runtimeCatalog
        ) {
          webMcpRuntime.verifyRegistry(receipt.runtimeCatalog);
          environment.setRegistryHash(receipt.manifestHash);
          setReadiness(receipt);
          setReadinessError(null);
        }
      } catch (failure) {
        if (!disposed && epoch === readinessEpoch.current) {
          setReadiness(null);
          setReadinessError(failure instanceof Error ? failure.message : "readiness_failed");
        }
      }
    })();
    return () => {
      disposed = true;
    };
  }, [environment, registry, session.state]);

  async function waitForRuntime(predicate: (view: RuntimeView) => boolean): Promise<RuntimeView> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const view = runtimeRef.current;
      if (predicate(view)) return view;
      if (view.readinessError) throw new Error(view.readinessError);
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("runtime_readiness_timeout");
  }

  async function verifiedResetBoundary(stage: "before" | "after"): Promise<VerifiedProbeBoundary> {
    setPhase(
      stage === "before"
        ? "Verifying a clean pre-trial fixture…"
        : "Destroying trial state and verifying reset…"
    );
    await waitForRuntime(
      (view) =>
        view.readiness?.status === "consumer-ready" &&
        view.registry.phase === "ready" &&
        Boolean(view.readiness.runtimeCatalog)
    );
    readinessEpoch.current += 1;
    setReadiness(null);
    const domainReceipt = await environment.store.hardReset({
      source: "ui",
      holdForVerification: true
    });
    const view = await waitForRuntime(
      (candidate) =>
        candidate.session.trajectoryId === domainReceipt.trajectoryId &&
        candidate.session.state.revision === 0 &&
        candidate.session.state.pendingCheckout === null &&
        candidate.registry.phase === "ready" &&
        sameNames(candidate.registry.toolNames, INITIAL_CHECKOUT_TOOL_NAMES) &&
        candidate.readiness?.status === "consumer-ready" &&
        candidate.readiness.fixtureRevision === 0 &&
        candidate.readiness.manifest.catalogState === "initial" &&
        Boolean(candidate.readiness.runtimeCatalog)
    );
    const receipt = await verifyCheckoutReset({
      domainReceipt,
      inspection: environment.store.inspect(),
      archives: environment.store.archivedTrajectories(),
      traceLedger: environment.ledger.snapshot(),
      registry: {
        verified: true,
        registryHash: view.readiness!.manifestHash,
        registeredToolNames: view.registry.toolNames
      },
      checkedAt: new Date().toISOString()
    });
    if (receipt.status !== "verified") throw new Error("reset_verification_failed");
    if (!environment.store.releaseResetAdmission(receipt.resetId)) {
      throw new Error("reset_admission_release_failed");
    }
    const domainArchives = environment.store.archivedTrajectories();
    const traceLedger = environment.ledger.snapshot();
    if (!domainArchives.at(-1) || !traceLedger.archives.at(-1) || !traceLedger.lastResetTrace) {
      throw new Error("reset_lineage_missing");
    }
    const resetEvidence: ProbeResetEvidence = {
      verification: JSON.parse(canonicalJson(receipt)),
      domainReceipt: JSON.parse(canonicalJson(domainReceipt)),
      inspection: JSON.parse(canonicalJson(environment.store.inspect())),
      domainArchives: JSON.parse(canonicalJson(domainArchives)),
      traceLedger: JSON.parse(canonicalJson(traceLedger))
    };
    const tools = view.readiness!.runtimeCatalog!.tools;
    return Object.freeze({
      status: "verified",
      catalogState: "initial",
      fixtureId: receipt.fixtureId,
      fixtureSeed: receipt.seed,
      stateRevision: 0,
      stateHash: receipt.stateHash,
      manifestHash: receipt.registryHash,
      registrationGeneration: view.readiness!.runtimeCatalog!.generation,
      operationLedgerCount: 0,
      currentTrajectoryCount: 0,
      resetId: receipt.resetId,
      resetReceipt: resetEvidence,
      tools
    });
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let marker: ProbeClientSessionMarker;
    try {
      const raw = globalThis.sessionStorage.getItem(PROBE_CLIENT_LAB_SESSION_KEY);
      if (!raw) throw new Error("probe_session_marker_missing");
      marker = parseProbeClientSessionMarker(raw, "/lab", APP_COMMIT);
      markerRef.current = marker;
    } catch (failure) {
      queueMicrotask(() =>
        setError(failure instanceof Error ? failure.message : "probe_session_marker_invalid")
      );
      return;
    }

    void runProbeClientTrial({
      waitAndVerifyCleanInitial: ({ stage }) => verifiedResetBoundary(stage),
      issueOpaqueClaim: async ({ initialBoundary }) => {
        setPhase("Acquiring an exclusive opaque trial claim…");
        const activeMarker = markerRef.current;
        const current = runtimeRef.current;
        if (!activeMarker || !current.readiness) throw new Error("probe_session_unavailable");
        const response = probeIssueResultSchema.parse(
          (
            await fetchJson("/api/probe/issue", activeMarker.csrfToken, {
              continuation: activeMarker.continuation,
              initialBoundary,
              fixture: createProbeFixtureSynopsis(environment.store.getSnapshot().state),
              liveManifest: liveManifest(current.readiness)
            })
          ).value
        );
        if (response.status === "already-sealed") {
          const destination = response.terminal ? "/results" : "/lab";
          const recoveredMarker = serializeProbeClientSessionMarker({
            version: PROBE_CLIENT_SESSION_VERSION,
            csrfToken: activeMarker.csrfToken,
            continuation: response.continuation,
            buildCommit: activeMarker.buildCommit,
            expiresAt: activeMarker.expiresAt,
            path: destination
          });
          const key = response.terminal ? PROBE_CLIENT_RESULTS_KEY : PROBE_CLIENT_LAB_SESSION_KEY;
          globalThis.sessionStorage.setItem(key, recoveredMarker);
          if (response.terminal) {
            globalThis.sessionStorage.removeItem(PROBE_CLIENT_LAB_SESSION_KEY);
          }
          setTimeout(() => {
            if (response.terminal) {
              globalThis.location.assign(new URL("/results", globalThis.location.href).href);
            } else {
              globalThis.location.reload();
            }
          }, 0);
          return await new Promise<never>(() => undefined);
        }
        initialBoundaryRef.current = initialBoundary;
        authorizationRef.current = response.authorization;
        return {
          runId: response.runId,
          caseId: response.caseId,
          trialId: response.trialId,
          authorization: response.authorization
        } satisfies ProbeOpaqueClaim<ProbeAuthorization>;
      },
      requestFreshDecision: async ({ claim }) => {
        setPhase("Requesting one fresh stateless model decision…");
        const marker = markerRef.current;
        const authorization = claim.authorization;
        if (!marker) throw new Error("probe_session_unavailable");
        let rawResponse: unknown;
        try {
          rawResponse = (
            await fetchJson("/api/probe/decide", marker.csrfToken, {
              probeToken: authorization.probeToken,
              envelope: authorization.envelope
            })
          ).value;
        } catch (failure) {
          if (
            failure &&
            typeof failure === "object" &&
            (failure as { inferencePerformed?: unknown }).inferencePerformed === true
          ) {
            inferenceUncertainRef.current = true;
          }
          throw failure;
        }
        const response = probeFreshDecisionResponseSchema.parse(rawResponse);
        providerReceiptRef.current = jsonSnapshot(response.providerReceipt);
        return response;
      },
      reverifyLiveInitial: async () => {
        setPhase("Re-verifying the live registered catalog…");
        const context = document.modelContext;
        const current = runtimeRef.current;
        if (
          !context ||
          current.registry.phase !== "ready" ||
          !current.registry.generation ||
          !webMcpRuntime.compatibilityReceipt
        ) {
          throw new Error("live_registry_unavailable");
        }
        const receipt = await createRegistryReadinessReceipt(context, {
          state: environment.store.getSnapshot().state,
          appCommit: APP_COMMIT,
          registrationGeneration: current.registry.generation,
          compatibilityReceipt: webMcpRuntime.compatibilityReceipt
        });
        if (receipt.status !== "consumer-ready" || !receipt.runtimeCatalog) {
          throw new Error("live_registry_unverified");
        }
        webMcpRuntime.verifyRegistry(receipt.runtimeCatalog);
        environment.setRegistryHash(receipt.manifestHash);
        const inspection = environment.store.inspect();
        const traceLedger = environment.ledger.snapshot();
        if (inspection.currentOperationCount !== 0 || traceLedger.current.length !== 0) {
          throw new Error("live_trajectory_not_clean");
        }
        return {
          status: "verified" as const,
          catalogState: "initial" as const,
          fixtureId: receipt.fixtureId,
          fixtureSeed: environment.store.getSnapshot().state.seed,
          stateRevision: 0 as const,
          stateHash: receipt.stateHash,
          manifestHash: receipt.manifestHash,
          registrationGeneration: receipt.runtimeCatalog.generation,
          operationLedgerCount: inspection.currentOperationCount,
          currentTrajectoryCount: traceLedger.current.length,
          tools: receipt.runtimeCatalog.tools
        };
      },
      executeOnce: async ({
        claim,
        tool,
        arguments: input,
        manifestHash,
        registrationGeneration
      }) => {
        setPhase("Executing the selected action once through native WebMCP…");
        const marker = markerRef.current;
        const authorization = authorizationRef.current;
        if (!marker || !authorization) throw new Error("native_admission_binding_missing");
        const admission = probeNativeAdmissionResponseSchema.parse(
          (
            await fetchJson("/api/probe/native", marker.csrfToken, {
              probeToken: authorization.probeToken,
              envelope: authorization.envelope,
              initialBoundary: initialBoundaryRef.current
            })
          ).value
        );
        if (admission.status !== "admitted") {
          const recoveryError = new Error(
            "The native allowance was already consumed in an earlier document."
          ) as Error & { code: string };
          recoveryError.code = "native_allowance_already_consumed";
          throw recoveryError;
        }
        const release = webMcpRegistryManager.holdConsumerCall(tool.name, registrationGeneration);
        try {
          const receipt = await webMcpRuntime.executeOnce({
            executionId: `probe_${claim.trialId}_${globalThis.crypto.randomUUID()}`,
            manifestHash,
            tool,
            input,
            observe: () => observeTrace(environment)
          });
          const trace = latestTrace(environment);
          if (!trace || trace.eventId !== receipt.handlerTraceId) {
            throw new Error("handler_trace_binding_failed");
          }
          return Object.freeze({ receipt, trace });
        } finally {
          release();
        }
      },
      captureCurrentTrialEvidence: async (
        capture: ProbeClientTrialCapture<ProbeResetEvidence, ProbeExecutionResult>
      ): Promise<ProbeTrialEvidence> => {
        setPhase("Capturing this trial’s raw and canonical evidence…");
        const { rawDecisionEnvelope, rawModelResponse, providerReceipt, ...captureCore } = capture;
        const captured = jsonSnapshot({
          ...captureCore,
          rawDecisionEnvelopeHash: await canonicalSha256(rawDecisionEnvelope),
          rawModelResponseHash:
            rawModelResponse === null ? null : await sha256Hex(rawModelResponse),
          providerReceiptHash: await canonicalSha256(providerReceipt)
        });
        const currentTraces = jsonSnapshot(environment.ledger.snapshot().current);
        return Object.freeze({
          version: "toolproof-probe-trial-evidence@1.0.0",
          appCommit: APP_COMMIT,
          origin: globalThis.location.origin,
          userAgent: globalThis.navigator.userAgent,
          capturedAt: new Date().toISOString(),
          capture: captured,
          currentTraces,
          captureDigest: await canonicalSha256(captured)
        });
      },
      completeAndSeal: async (
        completion: ProbeClientCompletionInput<ProbeResetEvidence, ProbeTrialEvidence>
      ): Promise<ProbeCompleteResponse> => {
        setPhase("Scoring outside the model context and sealing the terminal row…");
        const marker = markerRef.current;
        const authorization = authorizationRef.current;
        const providerReceipt = providerReceiptRef.current;
        if (!marker || !authorization || !providerReceipt) {
          throw new Error("probe_completion_binding_missing");
        }
        const response = probeCompleteResponseSchema.parse(
          (
            await fetchJson("/api/probe/complete", marker.csrfToken, {
              probeToken: authorization.probeToken,
              envelope: authorization.envelope,
              providerReceipt,
              continuation: marker.continuation,
              completion
            })
          ).value
        );
        const destination = response.terminal ? "/results" : "/lab";
        const nextMarker = serializeProbeClientSessionMarker({
          version: PROBE_CLIENT_SESSION_VERSION,
          csrfToken: marker.csrfToken,
          continuation: response.continuation,
          buildCommit: marker.buildCommit,
          expiresAt: marker.expiresAt,
          path: destination
        });
        const key = response.terminal ? PROBE_CLIENT_RESULTS_KEY : PROBE_CLIENT_LAB_SESSION_KEY;
        globalThis.sessionStorage.setItem(key, nextMarker);
        if (globalThis.sessionStorage.getItem(key) !== nextMarker) {
          throw new Error("probe_continuation_write_failed");
        }
        if (response.terminal) {
          globalThis.sessionStorage.removeItem(PROBE_CLIENT_LAB_SESSION_KEY);
        }
        setTimeout(() => {
          if (response.terminal) {
            globalThis.location.assign(new URL("/results", globalThis.location.href).href);
          } else {
            globalThis.location.reload();
          }
        }, 0);
        return response;
      },
      discardTransientReferences: () => {
        authorizationRef.current = undefined;
        providerReceiptRef.current = undefined;
        initialBoundaryRef.current = undefined;
      }
    })
      .then(() => {
        setPhase("Trial sealed. Opening the next fresh document…");
      })
      .catch((failure: unknown) => {
        environment.store.abandonResetAdmission();
        setUncertain(inferenceUncertainRef.current);
        setError(
          inferenceUncertainRef.current
            ? "provider_uncertain_stop_and_preserve"
            : failure instanceof Error
              ? failure.message
              : "probe_trial_failed"
        );
      });
    // The document-owned runner is deliberately claimed once. Dynamic runtime state is read from
    // runtimeRef so re-renders cannot start another trial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environment]);

  return (
    <section className="panel probe-runner-panel" aria-labelledby="probe-runner-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Gate 2 · isolated evaluation document</span>
          <h2 id="probe-runner-title">Fresh-context calibration in progress</h2>
        </div>
        <span className="status-pill status-pending">Running</span>
      </div>
      <p>
        This document exposes only the current checkout fixture and target Site Tools. Case truth,
        prior requests, prior results, scores, and repair information are not loaded here.
      </p>
      <div className="runtime-receipt" role="status" aria-live="polite">
        <span>Current boundary</span>
        <strong>{error ? "Stopped" : "Active"}</strong>
        <small>{error ? `The trial stopped safely (${error}).` : phase}</small>
      </div>
      {error ? (
        <div>
          <p className="error-text" role="alert">
            {uncertain
              ? "The provider dispatch is uncertain. Do not retry or clear this session; preserve the durable guard for operator recovery."
              : "Refresh this page to recover the same opaque trial without requesting another model decision."}
          </p>
          <small>
            Keep this tab and its opaque continuation intact. Session cleanup is available only
            before the first provider grant or after terminal evidence acknowledgement.
          </small>
        </div>
      ) : null}
    </section>
  );
}
