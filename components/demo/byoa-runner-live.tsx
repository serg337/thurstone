"use client";

import { useEffect, useRef, useState } from "react";

import { DiagnosticResult } from "@/components/demo/diagnostic-result";
import { RegressionActions } from "@/components/demo/regression-actions";
import { FixtureInspector } from "@/components/demo/fixture-inspector";
import type { ByoaAgentEnvironment } from "@/lib/demo/agent-environment";
import {
  createByoaAgentEnvironment,
  createByoaAgentEnvironmentFromProjection
} from "@/lib/demo/agent-environment";
import {
  BYOA_HANDOFF_REVEAL_VERSION,
  byoaHandoffBootstrapResponseSchema,
  byoaHandoffRevealResponseSchema,
  clearByoaHandoffUrl,
  clearRemoteByoaSession,
  hydrateRemoteByoaSession,
  readByoaHandoffUrl,
  readRemoteByoaSession,
  transitionRemoteByoaSession,
  writeRemoteByoaSession,
  type RemoteByoaSessionV1
} from "@/lib/demo/agent-handoff";
import {
  readAgentVisibleRunProjection,
  writeAgentVisibleRunProjection,
  type AgentVisibleRunProjection
} from "@/lib/demo/agent-projection";
import {
  readByoaAgentSession,
  transitionByoaSession,
  writeByoaAgentSession,
  type ByoaAgentSessionV1,
  type ByoaSessionState
} from "@/lib/demo/agent-session";
import { readByoaResult, writeByoaResult } from "@/lib/demo/byoa-result-storage";
import { byoaContractDigest, verifyByoaContract } from "@/lib/demo/contract-v2";
import { evaluateByoaEnvironment } from "@/lib/demo/evaluator";
import { createNoInvocationResult } from "@/lib/demo/no-invocation-result";
import type { ByoaDemoResultV2 } from "@/lib/demo/result-v2";
import {
  readRegressionRerun,
  writeRegressionRerun,
  type RegressionRerunV1
} from "@/lib/demo/regression-rerun";
import { detectWebMcpCapabilities } from "@/lib/webmcp/capabilities";
import { webMcpRegistryManager, type RegistryStatus } from "@/lib/webmcp/registry-manager";

const APP_COMMIT = process.env.NEXT_PUBLIC_TOOLPROOF_COMMIT_SHA?.trim() || "0".repeat(40);
const OBSERVATION_TIMEOUT_MS = 120_000;
const CONSUMER_DELIVERY_GRACE_MS = 50;

type ActiveByoaSession = ByoaAgentSessionV1 | RemoteByoaSessionV1;

function isRemoteSession(session: ActiveByoaSession): session is RemoteByoaSessionV1 {
  return session.version === "thurstone-byoa-remote-session@1";
}

function terminalState(verdict: ByoaDemoResultV2["verdict"]): ByoaSessionState {
  if (verdict === "pass") return "PASS";
  if (verdict === "fail") return "ISSUE";
  if (verdict === "unavailable") return "UNAVAILABLE";
  return "INCOMPLETE";
}

function verdictTitle(result: ByoaDemoResultV2): string {
  if (result.verdict === "pass") return "Your contract held in this trial.";
  if (result.verdict === "fail") return "Thurstone found a semantic mismatch before release.";
  if (result.verdict === "unavailable") return "Live agent testing is unavailable in this browser.";
  return "Thurstone could not verify an agent decision.";
}

export function ByoaRunner() {
  const [projection, setProjection] = useState<AgentVisibleRunProjection>();
  const [sessionState, setSessionState] = useState<ByoaSessionState>("NAVIGATING");
  const [progress, setProgress] = useState("Preparing clean fixture");
  const [result, setResult] = useState<ByoaDemoResultV2>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [handoffSourceUrl, setHandoffSourceUrl] = useState<string>();
  const [handoffCopied, setHandoffCopied] = useState(false);
  const [rerunCaseDigest, setRerunCaseDigest] = useState<string | null>(null);
  const sessionRef = useRef<ActiveByoaSession | undefined>(undefined);
  const environmentPromiseRef = useRef<Promise<ByoaAgentEnvironment> | undefined>(undefined);
  const releaseRef = useRef<{ release: () => void }>({ release: () => undefined });
  const terminalRef = useRef(false);
  const armedAtRef = useRef<string | undefined>(undefined);

  const rerunRef = useRef<RegressionRerunV1 | null>(null);
  function persistSession(session: ActiveByoaSession): void {
    sessionRef.current = session;
    setSessionState(session.state);
    if (isRemoteSession(session)) writeRemoteByoaSession(window.sessionStorage, session);
    else writeByoaAgentSession(window.sessionStorage, session);
  }

  function move(to: ByoaSessionState, reasonCode: string): ActiveByoaSession {
    const current = sessionRef.current;
    if (!current) throw new Error("The BYOA session is not loaded.");
    const transition = { at: new Date().toISOString(), reasonCode };
    const next = isRemoteSession(current)
      ? transitionRemoteByoaSession(current, to, transition)
      : transitionByoaSession(current, to, transition);
    persistSession(next);
    return next;
  }

  async function revealSession(session: ActiveByoaSession): Promise<ByoaAgentSessionV1> {
    if (!isRemoteSession(session)) return session;
    const response = await fetch("/api/demo/handoff/reveal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Thurstone-Request": "byoa-handoff"
      },
      body: JSON.stringify({
        version: BYOA_HANDOFF_REVEAL_VERSION,
        runId: session.runId,
        contractDigest: session.contractDigest
      }),
      cache: "no-store"
    });
    if (!response.ok)
      throw new Error("The hidden owner contract could not be revealed after observation.");
    const revealed = byoaHandoffRevealResponseSchema.parse(await response.json());
    return hydrateRemoteByoaSession(session, revealed.contract);
  }

  async function persistTerminal(
    terminalResult: ByoaDemoResultV2,
    fromSession = sessionRef.current
  ): Promise<void> {
    if (terminalRef.current || !fromSession) return;
    terminalRef.current = true;
    await writeByoaResult(window.sessionStorage, terminalResult);
    const transition = {
      at: terminalResult.completedAt,
      reasonCode: `result_${terminalResult.verdict}`,
      resultDigest: terminalResult.resultDigest
    };
    const terminal = isRemoteSession(fromSession)
      ? transitionRemoteByoaSession(fromSession, terminalState(terminalResult.verdict), transition)
      : transitionByoaSession(fromSession, terminalState(terminalResult.verdict), transition);
    persistSession(terminal);
    setTimeout(() => {
      releaseRef.current.release();
    }, CONSUMER_DELIVERY_GRACE_MS);
    setResult(terminalResult);
    setProgress("Result ready");
  }

  useEffect(() => {
    let disposed = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let unsubscribeGate: () => void = () => undefined;
    const releaseHolder = releaseRef.current;

    async function finalizeObserved(environment: ByoaAgentEnvironment): Promise<void> {
      if (terminalRef.current || disposed) return;
      const current = sessionRef.current;
      if (!current || current.state !== "OBSERVING") return;
      setProgress("Verifying trusted state");
      const evaluating = move("EVALUATING", "native_handler_settled");
      const revealedSession = await revealSession(evaluating);
      const terminalResult = await evaluateByoaEnvironment({
        session: revealedSession,
        environment,
        armedAt: armedAtRef.current ?? evaluating.updatedAt,
        completedAt: new Date().toISOString(),
        previousResultDigest: rerunRef.current?.previousResultDigest ?? null
      });
      await persistTerminal(terminalResult, evaluating);
    }

    async function finalizeNoInvocation(
      environment: ByoaAgentEnvironment,
      verdict: "incomplete" | "unavailable",
      detail: string
    ): Promise<void> {
      if (terminalRef.current || disposed) return;
      const current = sessionRef.current;
      if (!current) return;
      const revealedSession = await revealSession(current);
      const terminalResult = await createNoInvocationResult({
        session: revealedSession,
        environment,
        verdict,
        armedAt: armedAtRef.current ?? current.updatedAt,
        completedAt: new Date().toISOString(),
        detail,
        previousResultDigest: rerunRef.current?.previousResultDigest ?? null
      });
      await persistTerminal(terminalResult, current);
    }

    async function start(): Promise<void> {
      try {
        if (window.location.hash === "#handoff-source") {
          const sourceUrl = readByoaHandoffUrl(window.sessionStorage);
          if (!sourceUrl) throw new Error("No fresh-agent handoff exists in this tab.");
          setHandoffSourceUrl(sourceUrl);
          return;
        }

        const [storedSession, initialProjection, storedResult, initialRerun, storedRemoteSession] =
          await Promise.all([
            Promise.resolve(readByoaAgentSession(window.sessionStorage)),
            Promise.resolve(readAgentVisibleRunProjection(window.sessionStorage)),
            readByoaResult(window.sessionStorage),
            Promise.resolve(readRegressionRerun(window.sessionStorage)),
            Promise.resolve(readRemoteByoaSession(window.sessionStorage))
          ]);
        let storedProjection = initialProjection;
        let storedRerun = initialRerun;
        let activeSession: ActiveByoaSession | null = storedSession ?? storedRemoteSession;
        if (!activeSession || !storedProjection) {
          const response = await fetch("/api/demo/handoff/bootstrap", {
            cache: "no-store"
          });
          if (response.ok) {
            const bootstrap = byoaHandoffBootstrapResponseSchema.parse(await response.json());
            activeSession = bootstrap.session;
            storedProjection = bootstrap.projection;
            storedRerun = bootstrap.rerun;
            writeRemoteByoaSession(window.sessionStorage, bootstrap.session);
            writeAgentVisibleRunProjection(window.sessionStorage, bootstrap.projection);
            if (bootstrap.rerun) writeRegressionRerun(window.sessionStorage, bootstrap.rerun);
          }
        }
        if (disposed) return;
        if (!activeSession || !storedProjection) {
          throw new Error("No armed test exists in this tab.");
        }
        sessionRef.current = activeSession;
        rerunRef.current = storedRerun;
        setRerunCaseDigest(storedRerun?.caseDigest ?? null);
        setSessionState(activeSession.state);
        setProjection(storedProjection);
        if (Date.parse(storedProjection.expiresAt) <= Date.now()) {
          throw new Error("This armed test expired. Return to Demo and arm a fresh contract.");
        }
        if (["PASS", "ISSUE", "INCOMPLETE", "UNAVAILABLE"].includes(activeSession.state)) {
          if (!storedResult || storedResult.resultDigest !== activeSession.terminalResultDigest) {
            throw new Error("The terminal session result could not be verified.");
          }
          terminalRef.current = true;
          setResult(storedResult);
          setProgress("Result ready");
          return;
        }
        let contract = null;
        if (!isRemoteSession(activeSession)) {
          contract = await verifyByoaContract(activeSession.contract);
          if ((await byoaContractDigest(contract)) !== activeSession.contractDigest) {
            throw new Error("The armed contract digest does not verify.");
          }
        }
        if (!environmentPromiseRef.current) {
          environmentPromiseRef.current = contract
            ? createByoaAgentEnvironment(contract, APP_COMMIT)
            : createByoaAgentEnvironmentFromProjection(storedProjection, APP_COMMIT);
        }
        const environment = await environmentPromiseRef.current;
        if (disposed) return;
        if (activeSession.state === "NAVIGATING") {
          persistSession(
            isRemoteSession(activeSession)
              ? transitionRemoteByoaSession(activeSession, "PREPARING", {
                  at: new Date().toISOString(),
                  reasonCode: "isolated_document_loaded"
                })
              : transitionByoaSession(activeSession, "PREPARING", {
                  at: new Date().toISOString(),
                  reasonCode: "isolated_document_loaded"
                })
          );
        } else if (activeSession.state !== "PREPARING") {
          await finalizeNoInvocation(
            environment,
            "incomplete",
            "The prior run document ended before a terminal trace could be recovered."
          );
          return;
        }
        const capabilities = detectWebMcpCapabilities();
        if (!capabilities.providerRegistration || !document.modelContext) {
          await finalizeNoInvocation(
            environment,
            "unavailable",
            "This document does not expose a supported WebMCP provider registration API."
          );
          return;
        }
        setProgress("Registering frozen tools");
        unsubscribeGate = environment.gate.subscribe(() => {
          const claim = environment.gate.snapshot().claim;
          const current = sessionRef.current;
          if (!claim || !current || terminalRef.current) return;
          if (claim.disposition === "in-flight" && current.state === "ARMED") {
            setProgress("Native invocation observed");
            move("OBSERVING", "first_native_invocation_claimed");
          }
          if (claim.disposition !== "in-flight") void finalizeObserved(environment);
        });
        let readyHandled = false;
        const release = webMcpRegistryManager.acquire(
          document.modelContext,
          environment.tools,
          (status: RegistryStatus) => {
            if (disposed || terminalRef.current) return;
            if (status.phase === "error") {
              void finalizeNoInvocation(
                environment,
                "unavailable",
                status.error ?? "The frozen WebMCP catalog could not be registered."
              );
              return;
            }
            if (status.phase !== "ready" || readyHandled) return;
            readyHandled = true;
            try {
              const current = sessionRef.current;
              if (!current || current.state !== "PREPARING") return;
              setProgress("Tools ready");
              move("PROVIDER_READY", "frozen_catalog_registered");
              const armed = move("ARMED", "observation_boundary_armed");
              armedAtRef.current = armed.updatedAt;
              setProgress("Waiting for agent");
              timeout = setTimeout(() => {
                void finalizeNoInvocation(
                  environment,
                  "incomplete",
                  "No native WebMCP invocation was observed before the bounded timeout."
                );
              }, OBSERVATION_TIMEOUT_MS);
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : "The run could not be armed.");
            }
          }
        );
        releaseHolder.release = release;
      } catch (caught) {
        if (!disposed) {
          setError(caught instanceof Error ? caught.message : "The isolated test could not start.");
        }
      }
    }

    void start();
    return () => {
      disposed = true;
      if (timeout) clearTimeout(timeout);
      unsubscribeGate();
      releaseHolder.release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one document owns one run lifecycle
  }, []);

  async function copyRequest() {
    if (!projection) return;
    await navigator.clipboard.writeText(projection.request);
    setCopied(true);
  }

  async function copyHandoffUrl() {
    if (!handoffSourceUrl) return;
    await navigator.clipboard.writeText(handoffSourceUrl);
    setHandoffCopied(true);
  }

  function runInThisTab() {
    clearByoaHandoffUrl(window.sessionStorage);
    window.location.replace("/demo/run");
  }

  function clearUnfinishedSession() {
    if (terminalRef.current) return;
    window.sessionStorage.removeItem("thurstone:byoa-session@1");
    window.sessionStorage.removeItem("thurstone:byoa-agent-projection@1");
    window.sessionStorage.removeItem("thurstone:byoa-result@2");
    clearRemoteByoaSession(window.sessionStorage);
    clearByoaHandoffUrl(window.sessionStorage);
  }

  if (handoffSourceUrl) {
    return (
      <section
        className="agent-runner-empty agent-handoff-source"
        aria-labelledby="agent-handoff-source-title"
        data-byoa-state="HANDOFF_SOURCE"
      >
        <p className="eyebrow">Step 5 of 6 · fresh-agent handoff</p>
        <h1 id="agent-handoff-source-title">Open this test in a fresh agent task.</h1>
        <p>
          Copy the opaque link, start a fresh GPT-5.6 Sol or Terra ChatGPT Work or Codex task, and
          open it with @Browser. Before the agent acts, the fresh run receives only the request and
          frozen two-tool catalog—not the owner&apos;s expected tool, allowed effects, or forbidden
          effects.
        </p>
        <div className="button-row">
          <button
            className="button button-primary"
            type="button"
            onClick={() => void copyHandoffUrl()}
          >
            {handoffCopied ? "Fresh-agent URL copied" : "Copy fresh-agent test URL"}
          </button>
          <button className="button button-secondary" type="button" onClick={runInThisTab}>
            Run in this tab instead
          </button>
        </div>
        <p className="intro-microcopy">
          The handoff expires in ten minutes. Do not paste the link into public messages or evidence
          exports.
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="agent-runner-empty" aria-labelledby="agent-runner-empty-title">
        <p className="eyebrow">Test stopped safely</p>
        <h1 id="agent-runner-empty-title">Build and arm a fresh contract.</h1>
        <p>{error}</p>
        <a className="button button-primary" href="/demo">
          Return to Demo
        </a>
      </section>
    );
  }

  if (!projection) {
    return (
      <section className="agent-runner-loading" aria-live="polite">
        <p className="eyebrow">Preparing isolated run</p>
        <h1>Opening your frozen test…</h1>
      </section>
    );
  }

  if (result) {
    return (
      <section
        className="byoa-terminal-result"
        aria-labelledby="byoa-terminal-title"
        data-byoa-state={sessionState}
      >
        <p className="eyebrow">Step 6 of 6 · deterministic verdict</p>
        <h1 id="byoa-terminal-title">{verdictTitle(result)}</h1>
        <p>
          Expected <code>{result.expectedTool}</code>; observed{" "}
          <code>{result.observedTool ?? "no native invocation"}</code>.
        </p>
        <ul className="byoa-terminal-assertions">
          {result.assertions.map((item) => (
            <li key={item.assertionId} data-passed={item.passed}>
              <span aria-hidden="true">{item.passed ? "✓" : "×"}</span>
              <div>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </div>
            </li>
          ))}
        </ul>
        <div className="byoa-terminal-state">
          <article>
            <span>Before</span>
            <strong>Revision {result.trustedStateBefore.value.revision}</strong>
            <small>
              {result.trustedStateBefore.value.pendingCheckout?.status ?? "no pending checkout"}
            </small>
          </article>
          <article>
            <span>After</span>
            <strong>Revision {result.trustedStateAfter.value.revision}</strong>
            <small>
              {result.trustedStateAfter.value.pendingCheckout?.status ?? "no pending checkout"}
            </small>
          </article>
          <article>
            <span>Ledger</span>
            <strong>{result.ledgerDiff.eventCountDelta} event(s)</strong>
            <small>{result.ledgerDiff.stateTransitionCount} state transition(s)</small>
          </article>
        </div>
        <DiagnosticResult result={result} />
        <RegressionActions result={result} existingCaseDigest={rerunCaseDigest} />
        <details>
          <summary>View terminal evidence</summary>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </details>
        <div className="button-row">
          <a className="button button-primary" href="/demo">
            Build another contract
          </a>
          <a className="button button-secondary" href="/results">
            View Results
          </a>
        </div>
      </section>
    );
  }

  return (
    <section
      className="agent-runner-shell"
      aria-labelledby="agent-runner-title"
      data-byoa-state={sessionState}
    >
      <div className="agent-runner-heading">
        <div>
          <p className="eyebrow">Step 5 of 6 · isolated live test</p>
          <h1 id="agent-runner-title">Your test is armed.</h1>
          <p>
            In the latest ChatGPT desktop app, use its built-in Browser with a fresh GPT-5.6 Sol or
            Terra ChatGPT Work or Codex agent, then send the exact synthetic request below. Keep
            this page open while Thurstone waits for one native invocation.
          </p>
        </div>
        <a className="button button-secondary" href="/demo" onClick={clearUnfinishedSession}>
          Cancel test
        </a>
      </div>
      <aside className="agent-consumer-note" aria-label="Required ChatGPT consumer">
        <strong>Use ChatGPT desktop&apos;s built-in Browser.</strong>
        <span>
          Choose @Browser with GPT-5.6 Sol or Terra. Do not use the Chrome extension side chat for
          this Site Tools proof.
        </span>
      </aside>
      <div className="agent-runner-grid">
        <div className="agent-runner-content">
          <section className="agent-request-card" aria-labelledby="agent-request-title">
            <span>Exact synthetic request</span>
            <h2 id="agent-request-title">{projection.request}</h2>
            <button
              className="button button-primary"
              type="button"
              onClick={() => void copyRequest()}
            >
              {copied ? "Copied" : "Copy request"}
            </button>
          </section>
          <section className="agent-catalog-preview" aria-labelledby="agent-catalog-title">
            <p className="eyebrow">Frozen two-tool catalog</p>
            <h2 id="agent-catalog-title">What the agent can use</h2>
            <div>
              {projection.descriptors.map((descriptor) => (
                <article key={descriptor.name}>
                  <strong>{descriptor.title}</strong>
                  <code>{descriptor.name}</code>
                  <p>{descriptor.description}</p>
                </article>
              ))}
            </div>
          </section>
          <p className="agent-runner-status" role="status" aria-live="polite">
            {progress}
          </p>
          <details className="agent-setup-disclosure">
            <summary>Browser setup and test boundary</summary>
            <p>
              Site Tools run in the built-in Browser of the latest ChatGPT desktop app with GPT-5.6
              Sol or Terra. Use @Browser—not the Chrome extension side chat—for this ChatGPT proof.
              Chrome 149+ with WebMCP testing enabled is a separate native compatibility path.
              Thurstone admits the first native call; later attempts are rejected before domain
              execution. The prompt binding remains user-attested.
            </p>
          </details>
        </div>
        <FixtureInspector />
      </div>
    </section>
  );
}
