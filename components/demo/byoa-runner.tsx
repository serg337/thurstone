"use client";

import { useEffect, useRef, useState } from "react";

import { FixtureInspector } from "@/components/demo/fixture-inspector";
import type { ByoaAgentEnvironment } from "@/lib/demo/agent-environment";
import { createByoaAgentEnvironment } from "@/lib/demo/agent-environment";
import {
  readAgentVisibleRunProjection,
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
import { detectWebMcpCapabilities } from "@/lib/webmcp/capabilities";
import { webMcpRegistryManager, type RegistryStatus } from "@/lib/webmcp/registry-manager";

const APP_COMMIT = process.env.NEXT_PUBLIC_TOOLPROOF_COMMIT_SHA?.trim() || "0".repeat(40);
const OBSERVATION_TIMEOUT_MS = 120_000;
const CONSUMER_DELIVERY_GRACE_MS = 50;

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
  const sessionRef = useRef<ByoaAgentSessionV1 | undefined>(undefined);
  const environmentPromiseRef = useRef<Promise<ByoaAgentEnvironment> | undefined>(undefined);
  const releaseRef = useRef<{ release: () => void }>({ release: () => undefined });
  const terminalRef = useRef(false);
  const armedAtRef = useRef<string | undefined>(undefined);

  function persistSession(session: ByoaAgentSessionV1): void {
    sessionRef.current = session;
    setSessionState(session.state);
    writeByoaAgentSession(window.sessionStorage, session);
  }

  function move(to: ByoaSessionState, reasonCode: string): ByoaAgentSessionV1 {
    const current = sessionRef.current;
    if (!current) throw new Error("The BYOA session is not loaded.");
    const next = transitionByoaSession(current, to, {
      at: new Date().toISOString(),
      reasonCode
    });
    persistSession(next);
    return next;
  }

  async function persistTerminal(
    terminalResult: ByoaDemoResultV2,
    fromSession = sessionRef.current
  ): Promise<void> {
    if (terminalRef.current || !fromSession) return;
    terminalRef.current = true;
    await writeByoaResult(window.sessionStorage, terminalResult);
    const terminal = transitionByoaSession(fromSession, terminalState(terminalResult.verdict), {
      at: terminalResult.completedAt,
      reasonCode: `result_${terminalResult.verdict}`,
      resultDigest: terminalResult.resultDigest
    });
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
      const terminalResult = await evaluateByoaEnvironment({
        session: evaluating,
        environment,
        armedAt: armedAtRef.current ?? evaluating.updatedAt,
        completedAt: new Date().toISOString()
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
      const terminalResult = await createNoInvocationResult({
        session: current,
        environment,
        verdict,
        armedAt: armedAtRef.current ?? current.updatedAt,
        completedAt: new Date().toISOString(),
        detail
      });
      await persistTerminal(terminalResult, current);
    }

    async function start(): Promise<void> {
      try {
        const [storedSession, storedProjection, storedResult] = await Promise.all([
          Promise.resolve(readByoaAgentSession(window.sessionStorage)),
          Promise.resolve(readAgentVisibleRunProjection(window.sessionStorage)),
          readByoaResult(window.sessionStorage)
        ]);
        if (disposed) return;
        if (!storedSession || !storedProjection) {
          throw new Error("No armed test exists in this tab.");
        }
        sessionRef.current = storedSession;
        setSessionState(storedSession.state);
        setProjection(storedProjection);
        if (Date.parse(storedProjection.expiresAt) <= Date.now()) {
          throw new Error("This armed test expired. Return to Demo and arm a fresh contract.");
        }
        if (["PASS", "ISSUE", "INCOMPLETE", "UNAVAILABLE"].includes(storedSession.state)) {
          if (!storedResult || storedResult.resultDigest !== storedSession.terminalResultDigest) {
            throw new Error("The terminal session result could not be verified.");
          }
          terminalRef.current = true;
          setResult(storedResult);
          setProgress("Result ready");
          return;
        }
        const contract = await verifyByoaContract(storedSession.contract);
        if ((await byoaContractDigest(contract)) !== storedSession.contractDigest) {
          throw new Error("The armed contract digest does not verify.");
        }
        if (!environmentPromiseRef.current) {
          environmentPromiseRef.current = createByoaAgentEnvironment(contract, APP_COMMIT);
        }
        const environment = await environmentPromiseRef.current;
        if (disposed) return;
        if (storedSession.state === "NAVIGATING") {
          persistSession(
            transitionByoaSession(storedSession, "PREPARING", {
              at: new Date().toISOString(),
              reasonCode: "isolated_document_loaded"
            })
          );
        } else if (storedSession.state !== "PREPARING") {
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
              const providerReady = move("PROVIDER_READY", "frozen_catalog_registered");
              const armed = transitionByoaSession(providerReady, "ARMED", {
                at: new Date().toISOString(),
                reasonCode: "observation_boundary_armed"
              });
              armedAtRef.current = armed.updatedAt;
              persistSession(armed);
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

  function clearUnfinishedSession() {
    if (terminalRef.current) return;
    window.sessionStorage.removeItem("thurstone:byoa-session@1");
    window.sessionStorage.removeItem("thurstone:byoa-agent-projection@1");
    window.sessionStorage.removeItem("thurstone:byoa-result@2");
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
            Ask a fresh supported ChatGPT agent to use this page, then send the exact synthetic
            request below. Keep this page open while Thurstone waits for one native invocation.
          </p>
        </div>
        <a className="button button-secondary" href="/demo" onClick={clearUnfinishedSession}>
          Cancel test
        </a>
      </div>
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
              Use ChatGPT&apos;s in-app browser with GPT-5.6 Sol or Terra, or Chrome 149+ with
              WebMCP testing enabled. Thurstone admits the first native call; later attempts are
              rejected before domain execution. The prompt binding remains user-attested.
            </p>
          </details>
        </div>
        <FixtureInspector />
      </div>
    </section>
  );
}
