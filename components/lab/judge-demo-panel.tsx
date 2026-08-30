"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  JUDGE_DEMO_RUN_INTENT,
  judgeDemoDecisionResponseSchema,
  judgeDemoStatusSchema,
  type JudgeDemoProjection,
  type JudgeDemoStatus
} from "@/lib/judge/contract";
import type { ExecuteArgumentMode, ExecuteOnceResult } from "@/lib/webmcp/runtime";

const JUDGE_BROWSER_PROOF_VERSION = "toolproof-judge-browser-proof@1.1.0";
const JUDGE_MODEL_EVIDENCE_VERSION = "toolproof-judge-model-evidence@1.0.0";
const JUDGE_STATUS_TIMEOUT_MS = 8_000;
const JUDGE_DECISION_TIMEOUT_MS = 28_000;

export interface JudgeBrowserRuntimeBinding {
  readonly appCommit: string;
  readonly readinessStatus: "consumer-ready";
  readonly manifestHash: string;
  readonly stateHash: string;
  readonly fixtureRevision: 0;
  readonly catalogState: "initial";
  readonly registrationGeneration: number;
  readonly argumentMode: ExecuteArgumentMode;
  readonly toolNames: readonly ["cart_get", "cart_update", "checkout_request", "order_review"];
  readonly haltFree: true;
}

interface JudgeModelEvidenceCore {
  readonly version: typeof JUDGE_MODEL_EVIDENCE_VERSION;
  readonly evidenceClass: "non-scored-model-selection";
  readonly decisionDisposition: "fresh" | "archived";
  readonly inferencePerformedByThisRequest: boolean;
  readonly providerProjection: JudgeDemoProjection;
  readonly observedAt: string;
}

interface JudgeModelEvidence extends JudgeModelEvidenceCore {
  readonly evidenceDigest: string;
}

interface JudgeBrowserProofCore {
  readonly version: typeof JUDGE_BROWSER_PROOF_VERSION;
  readonly evidenceClass: "non-scored-judge-path";
  readonly sourceFixed: true;
  readonly modelEvidenceDigest: string;
  readonly providerProjection: JudgeDemoProjection;
  readonly runtime: JudgeBrowserRuntimeBinding & {
    readonly origin: string;
    readonly userAgent: string;
    readonly secureContext: boolean;
  };
  readonly nativeExecution: ExecuteOnceResult;
  readonly observedAt: string;
}

interface JudgeBrowserProof extends JudgeBrowserProofCore {
  readonly proofDigest: string;
}

interface JudgeDemoPanelProps {
  readonly runtimeBinding: JudgeBrowserRuntimeBinding | null;
  readonly cleanFixture: boolean;
  readonly admissionReady: boolean;
  readonly beginSequence: () => boolean;
  readonly endSequence: () => void;
  readonly executeVerifiedDecision: (projection: JudgeDemoProjection) => Promise<ExecuteOnceResult>;
}

function safeError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "The bounded judge request timed out. No retry was sent; refresh status to recover the durable outcome.";
  }
  return error instanceof Error
    ? error.message.slice(0, 500)
    : "Judge demonstration failed safely.";
}

async function readError(response: Response): Promise<string> {
  try {
    const value = (await response.json()) as { readonly error?: unknown };
    return typeof value.error === "string" ? value.error.slice(0, 500) : `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function boundedFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Bounded judge request timed out.", "AbortError")),
    timeoutMs
  );
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function verifiedProjection(value: JudgeDemoProjection): Promise<JudgeDemoProjection> {
  const { receiptDigest, ...core } = value;
  if ((await canonicalSha256(core)) !== receiptDigest) {
    throw new Error("The judge projection digest does not verify.");
  }
  return value;
}

async function createModelEvidence(input: {
  readonly disposition: "fresh" | "archived";
  readonly inferencePerformed: boolean;
  readonly projection: JudgeDemoProjection;
}): Promise<JudgeModelEvidence> {
  const core: JudgeModelEvidenceCore = Object.freeze({
    version: JUDGE_MODEL_EVIDENCE_VERSION,
    evidenceClass: "non-scored-model-selection",
    decisionDisposition: input.disposition,
    inferencePerformedByThisRequest: input.inferencePerformed,
    providerProjection: await verifiedProjection(input.projection),
    observedAt: new Date().toISOString()
  });
  return Object.freeze({ ...core, evidenceDigest: await canonicalSha256(core) });
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([`${canonicalJson(value)}\n`], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  queueMicrotask(() => URL.revokeObjectURL(href));
}

function timestampSlug(timestamp: string): string {
  return timestamp.replace(/[-:.]/gu, "");
}

function projectionSelectsCartGet(projection: JudgeDemoProjection): boolean {
  return (
    projection.decisionError === null &&
    projection.decision?.kind === "call" &&
    projection.decision.tool === "cart_get" &&
    Object.keys(projection.decision.arguments).length === 0
  );
}

export function JudgeDemoPanel({
  runtimeBinding,
  cleanFixture,
  admissionReady,
  beginSequence,
  endSequence,
  executeVerifiedDecision
}: JudgeDemoPanelProps) {
  const [status, setStatus] = useState<JudgeDemoStatus>();
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState("Checking the durable judge allocation…");
  const [error, setError] = useState<string>();
  const [modelEvidence, setModelEvidence] = useState<JudgeModelEvidence>();
  const [proof, setProof] = useState<JudgeBrowserProof>();
  const statusFocus = useRef<HTMLDivElement>(null);
  const portalTarget = useSyncExternalStore(
    () => () => undefined,
    () => document.getElementById("impact-execution-judge-action"),
    () => null
  );

  const refresh = useCallback(async (fresh = false): Promise<JudgeDemoStatus | undefined> => {
    setLoading(true);
    try {
      const response = await boundedFetch(
        fresh ? "/api/judge-demo?fresh=1" : "/api/judge-demo",
        {
          method: "GET",
          credentials: "same-origin",
          headers: { Accept: "application/json" }
        },
        JUDGE_STATUS_TIMEOUT_MS
      );
      if (!response.ok) throw new Error(await readError(response));
      const next = judgeDemoStatusSchema.parse(await response.json());
      setStatus(next);
      setError(undefined);
      if (next.projection) {
        const archived = await createModelEvidence({
          disposition: "archived",
          inferencePerformed: false,
          projection: next.projection
        });
        setModelEvidence((current) =>
          current?.providerProjection.receiptDigest === next.projection?.receiptDigest
            ? current
            : archived
        );
      }
      return next;
    } catch (cause) {
      setStatus(undefined);
      setError(safeError(cause));
      return undefined;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      void refresh().then((next) => {
        if (active) setPhase(next?.reason ?? "Judge status is unavailable.");
      });
    });
    return () => {
      active = false;
    };
  }, [refresh]);

  async function run(): Promise<void> {
    if (running || !runtimeBinding || !cleanFixture || !admissionReady || !beginSequence()) {
      return;
    }
    setRunning(true);
    setProof(undefined);
    setError(undefined);
    setPhase("Requesting the one source-fixed model decision…");
    let failure: string | undefined;
    try {
      const response = await boundedFetch(
        "/api/judge-demo",
        {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ intent: JUDGE_DEMO_RUN_INTENT })
        },
        JUDGE_DECISION_TIMEOUT_MS
      );
      if (!response.ok) throw new Error(await readError(response));
      const decision = judgeDemoDecisionResponseSchema.parse(await response.json());
      const nextModelEvidence = await createModelEvidence({
        disposition: decision.status,
        inferencePerformed: decision.inferencePerformed,
        projection: decision.projection
      });
      setModelEvidence(nextModelEvidence);
      setPhase("Model decision sealed. Verifying it through the current native catalog…");
      if (!projectionSelectsCartGet(decision.projection)) {
        setPhase(
          "The model decision is sealed without cart_get. Provider evidence is retained; no native call was attempted."
        );
        return;
      }
      const nativeExecution = await executeVerifiedDecision(decision.projection);
      const observedAt = new Date().toISOString();
      const core: JudgeBrowserProofCore = Object.freeze({
        version: JUDGE_BROWSER_PROOF_VERSION,
        evidenceClass: "non-scored-judge-path",
        sourceFixed: true,
        modelEvidenceDigest: nextModelEvidence.evidenceDigest,
        providerProjection: decision.projection,
        runtime: Object.freeze({
          ...runtimeBinding,
          origin: globalThis.location.origin,
          userAgent: globalThis.navigator.userAgent,
          secureContext: globalThis.isSecureContext
        }),
        nativeExecution,
        observedAt
      });
      setProof(Object.freeze({ ...core, proofDigest: await canonicalSha256(core) }));
      setPhase("Model selection and native cart_get verification completed.");
    } catch (cause) {
      failure = safeError(cause);
      setPhase("The sequence stopped safely. Durable model status was rechecked without retry.");
    } finally {
      const next = await refresh(true);
      if (failure) setError(failure);
      else if (next) setError(undefined);
      endSequence();
      setRunning(false);
      queueMicrotask(() => statusFocus.current?.focus());
    }
  }

  const sealedProjection = status?.status === "sealed" ? status.projection : null;
  const replayable = sealedProjection !== null && projectionSelectsCartGet(sealedProjection);
  const terminalNoCall = sealedProjection !== null && !projectionSelectsCartGet(sealedProjection);
  const recoverable = status?.status === "recoverable";
  const available = status?.status === "available" || replayable || recoverable;
  const ready =
    runtimeBinding !== null && cleanFixture && admissionReady && available && !loading && !running;
  const allocationLabel = loading
    ? "Checking allocation…"
    : `${status?.remainingModelCalls ?? 0} model call remaining`;

  const panel = (
    <section className="panel trace-panel" aria-labelledby="judge-demo-title" aria-busy={running}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Gate 7 · no-key model-backed judge lane</span>
          <h2 id="judge-demo-title">One fixed decision, one verified native read</h2>
        </div>
        <span className="fixture-id">{allocationLabel}</span>
      </div>

      {/* thurstone-impact-execution:judge-diagnostics */}
      <div className="button-row judge-primary-action">
        <button className="button button-primary" disabled={!ready} onClick={() => void run()}>
          {running
            ? "Running bounded judge proof…"
            : terminalNoCall
              ? "Sealed model decision has no native replay"
              : recoverable
                ? "Recover sealed decision and verify native cart_get"
                : replayable
                  ? "Replay sealed decision through native cart_get"
                  : "Run bounded model decision + native cart_get"}
        </button>
      </div>

      {!runtimeBinding ? (
        <p className="pending-notice" role="status">
          Open this page in a supported Chrome/WebMCP consumer and wait for consumer-ready native
          discovery.
        </p>
      ) : !cleanFixture ? (
        <p className="pending-notice" role="status">
          Hard reset the halt-free fixture before running the source-fixed judge demonstration.
        </p>
      ) : !admissionReady ? (
        <p className="pending-notice" role="status">
          Wait for the current Lab operation to finish.
        </p>
      ) : null}

      {terminalNoCall ? (
        <p className="pending-notice" role="status">
          The sealed model outcome did not select cart_get. Its separate provider evidence remains
          available, and Thurstone will not fabricate or repeatedly retry a native call.
        </p>
      ) : null}

      <div
        ref={statusFocus}
        className={error ? "judge-status-summary error-text" : "judge-status-summary"}
        role={error ? "alert" : "status"}
        aria-live={error ? "assertive" : "polite"}
        tabIndex={-1}
      >
        <strong>
          {running ? "running" : loading ? "checking" : (status?.status ?? "unavailable")}
        </strong>
        <span>{error ?? status?.reason ?? phase}</span>
      </div>

      <details className="judge-diagnostics">
        <summary>Judge diagnostics</summary>
        <div className="judge-diagnostics-content">
          <p>
            The server accepts no prompt, model, schema, URL, or tool choice from this page. Its
            only request is: <q>Which current cart lines have a quantity greater than one?</q>
          </p>
          <p className="trace-note">
            This is a separate, non-scored demonstration. A fresh decision can consume the single
            challenge-lifetime judge allocation. Afterward, the sealed decision remains available
            for local native replay without another model call.
          </p>

          <div className="button-row">
            <button
              className="button button-secondary"
              disabled={loading || running}
              onClick={() => void refresh(true).then((next) => setPhase(next?.reason ?? phase))}
            >
              Refresh judge status
            </button>
            {modelEvidence ? (
              <button
                className="button button-secondary"
                onClick={() =>
                  downloadJson(
                    `toolproof-judge-model-${modelEvidence.providerProjection.appCommit.slice(0, 12)}-${timestampSlug(modelEvidence.observedAt)}.json`,
                    modelEvidence
                  )
                }
              >
                Download model decision JSON
              </button>
            ) : null}
            {proof ? (
              <button
                className="button button-secondary"
                onClick={() =>
                  downloadJson(
                    `toolproof-judge-native-${proof.providerProjection.appCommit.slice(0, 12)}-${timestampSlug(proof.observedAt)}.json`,
                    proof
                  )
                }
              >
                Download complete judge proof JSON
              </button>
            ) : null}
          </div>

          <div className="runtime-receipt" role="group">
            <span>Judge lane</span>
            <strong>
              {running ? "running" : loading ? "checking" : (status?.status ?? "unavailable")}
            </strong>
            <small>{phase}</small>
            <small>{status?.reason ?? "Judge status is not available."}</small>
            <small>
              {status?.projection
                ? `Sealed receipt ${status.projection.receiptDigest.slice(0, 16)}…`
                : "No sealed judge decision is exposed."}
            </small>
          </div>

          {modelEvidence ? (
            <article className="receipt-line">
              <h3>Sealed model-selection evidence</h3>
              <pre tabIndex={0}>{JSON.stringify(modelEvidence, null, 2)}</pre>
            </article>
          ) : null}
          {proof ? (
            <article className="receipt-line">
              <h3>Current browser judge proof</h3>
              <pre tabIndex={0}>{JSON.stringify(proof, null, 2)}</pre>
            </article>
          ) : null}
          {error ? (
            <p className="error-text" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </details>
    </section>
  );
  return portalTarget ? createPortal(panel, portalTarget) : panel;
}
