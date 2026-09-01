"use client";

import { useEffect, useRef, useState } from "react";

import { DiagnosticResultV3 } from "@/components/demo/diagnostic-result-v3";
import { RegressionActionsV3 } from "@/components/demo/regression-actions-v3";
import {
  createByoaAgentEnvironmentV2FromProjection,
  type ByoaAgentEnvironmentV2
} from "@/lib/demo/agent-environment-v2";
import {
  BYOA_HANDOFF_BOOTSTRAP_V2_VERSION,
  BYOA_HANDOFF_REVOKE_V2_VERSION,
  BYOA_HANDOFF_REVEAL_V2_VERSION,
  BYOA_RUNNER_V2_MARKER_KEY,
  byoaHandoffBootstrapResponseV2Schema,
  byoaHandoffRevealResponseV2Schema,
  clearRemoteByoaSessionV2,
  hydrateRemoteByoaSessionV2,
  readRemoteByoaSessionV2,
  transitionRemoteByoaSessionV2,
  writeRemoteByoaSessionV2,
  type RemoteByoaSessionV2
} from "@/lib/demo/agent-handoff-v2";
import { clearByoaHandoffUrl, readByoaHandoffUrl } from "@/lib/demo/agent-handoff";
import {
  clearAgentVisibleRunProjectionV2,
  readAgentVisibleRunProjectionV2,
  writeAgentVisibleRunProjectionV2,
  type AgentVisibleRunProjectionV2
} from "@/lib/demo/agent-projection";
import {
  clearByoaAgentSessionV2,
  readByoaAgentSessionV2,
  type ByoaSessionV2State
} from "@/lib/demo/agent-session-v2";
import {
  clearByoaResultV3,
  readByoaResultV3,
  writeByoaResultV3
} from "@/lib/demo/byoa-result-storage-v3";
import { createNoInvocationResultV3, evaluateByoaEnvironmentV3 } from "@/lib/demo/evaluator-v3";
import {
  byoaHandoffV2ContextHeaders,
  controlByoaHandoffV2,
  readFreshContextForByoaHandoffV2
} from "@/lib/demo/handoff-context-v2";
import type { ByoaDemoResultV3 } from "@/lib/demo/result-v3";
import { detectWebMcpCapabilities } from "@/lib/webmcp/capabilities";
import { webMcpRegistryManager, type RegistryStatus } from "@/lib/webmcp/registry-manager";

const APP_COMMIT = process.env.NEXT_PUBLIC_TOOLPROOF_COMMIT_SHA?.trim() || "0".repeat(40);
const OBSERVATION_TIMEOUT_MS = 120_000;
const CONSUMER_DELIVERY_GRACE_MS = 50;

function nextTimestamp(after: string): string {
  return new Date(Math.max(Date.now(), Date.parse(after) + 1)).toISOString();
}

function terminalState(verdict: ByoaDemoResultV3["verdict"]): ByoaSessionV2State {
  if (verdict === "pass") return "PASS";
  if (verdict === "issue") return "ISSUE";
  if (verdict === "unavailable") return "UNAVAILABLE";
  return "INCOMPLETE";
}

interface HandoffSourceV2 {
  readonly url: string;
  readonly request: string;
  readonly toolNames: readonly string[];
  readonly caseName: string;
}

export function ByoaRunnerV2() {
  const [projection, setProjection] = useState<AgentVisibleRunProjectionV2>();
  const [sessionState, setSessionState] = useState<ByoaSessionV2State>("RECEIVED");
  const [source, setSource] = useState<HandoffSourceV2>();
  const [result, setResult] = useState<ByoaDemoResultV3>();
  const [progress, setProgress] = useState("Receiving isolated test");
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState<"command" | "url" | "request">();
  const [existingRegressionCaseDigest, setExistingRegressionCaseDigest] = useState<string | null>(
    null
  );
  const sessionRef = useRef<RemoteByoaSessionV2 | undefined>(undefined);
  const releaseRef = useRef<() => void>(() => undefined);
  const unsubscribeGateRef = useRef<() => void>(() => undefined);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const terminalRef = useRef(false);
  const finalizationClaimedRef = useRef(false);
  const armedAtRef = useRef<string | null>(null);

  function freshContextId(): string {
    return readFreshContextForByoaHandoffV2(window.sessionStorage);
  }

  function reportFinalizationFailure(error: unknown): void {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    unsubscribeGateRef.current();
    releaseRef.current();
    setProgress("Evidence finalization stopped safely");
    setError(
      error instanceof Error
        ? `Evidence finalization failed: ${error.message}. No verdict is claimed; return to the owner task and create a fresh run.`
        : "Evidence finalization failed. No verdict is claimed; return to the owner task and create a fresh run."
    );
  }

  function runFinalizer(promise: Promise<void>): void {
    void promise.catch(reportFinalizationFailure);
  }

  function persistSession(session: RemoteByoaSessionV2): void {
    sessionRef.current = session;
    setSessionState(session.state);
    setExistingRegressionCaseDigest(session.regressionLink?.regressionCaseDigest ?? null);
    writeRemoteByoaSessionV2(window.sessionStorage, session);
  }

  function move(
    to: ByoaSessionV2State,
    reasonCode: string,
    options: { readonly explicitStart?: true; readonly resultDigest?: string } = {}
  ): RemoteByoaSessionV2 {
    const current = sessionRef.current;
    if (!current) throw new Error("The isolated BYOA session is not loaded.");
    const next = transitionRemoteByoaSessionV2(current, to, {
      at: nextTimestamp(current.updatedAt),
      reasonCode,
      ...options
    });
    persistSession(next);
    return next;
  }

  async function revealSession(remote: RemoteByoaSessionV2) {
    const response = await fetch("/api/demo/handoff/reveal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Thurstone-Request": "byoa-handoff",
        ...byoaHandoffV2ContextHeaders(freshContextId())
      },
      body: JSON.stringify({
        version: BYOA_HANDOFF_REVEAL_V2_VERSION,
        runId: remote.runId,
        contractDigest: remote.contractDigest
      }),
      cache: "no-store"
    });
    if (!response.ok) throw new Error("The hidden contract could not be revealed after the trial.");
    const revealed = byoaHandoffRevealResponseV2Schema.parse(await response.json());
    if (revealed.version !== BYOA_HANDOFF_REVEAL_V2_VERSION) {
      throw new Error("The hidden contract reveal used an unsupported version.");
    }
    return hydrateRemoteByoaSessionV2(remote, revealed.contract);
  }

  async function persistTerminal(
    terminalResult: ByoaDemoResultV3,
    from: RemoteByoaSessionV2
  ): Promise<void> {
    if (terminalRef.current) return;
    terminalRef.current = true;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    await writeByoaResultV3(window.sessionStorage, terminalResult);
    const terminal = transitionRemoteByoaSessionV2(from, terminalState(terminalResult.verdict), {
      at: terminalResult.completedAt,
      reasonCode: `result_${terminalResult.verdict}`,
      resultDigest: terminalResult.resultDigest
    });
    persistSession(terminal);
    setResult(terminalResult);
    setProgress("Result ready");
    setTimeout(() => releaseRef.current(), CONSUMER_DELIVERY_GRACE_MS);
  }

  async function finalizeObserved(environment: ByoaAgentEnvironmentV2): Promise<void> {
    if (terminalRef.current) return;
    const current = sessionRef.current;
    if (!current || current.state !== "OBSERVING") return;
    if (finalizationClaimedRef.current) return;
    finalizationClaimedRef.current = true;
    setProgress("Verifying independent state and ledger");
    const evaluating = move("EVALUATING", "native_handler_settled");
    await controlByoaHandoffV2({
      action: "settle",
      runId: evaluating.runId,
      contractDigest: evaluating.contractDigest,
      freshContextId: freshContextId()
    });
    const hydrated = await revealSession(evaluating);
    const completedAt = nextTimestamp(evaluating.updatedAt);
    if (armedAtRef.current === null) {
      throw new Error("An observed invocation cannot be evaluated before the arm boundary.");
    }
    const terminalResult = await evaluateByoaEnvironmentV3({
      session: hydrated,
      environment,
      launchMode: "fresh-agent-handoff",
      evidenceTier: "independent-agent-native",
      armedAt: armedAtRef.current,
      completedAt,
      previousResultDigest: hydrated.regressionLink?.previousResultDigest ?? null
    });
    await persistTerminal(terminalResult, evaluating);
  }

  async function finalizeNoInvocation(
    environment: ByoaAgentEnvironmentV2,
    verdict: "incomplete" | "unavailable",
    detail: string
  ): Promise<void> {
    if (terminalRef.current) return;
    const current = sessionRef.current;
    if (!current) return;
    if (finalizationClaimedRef.current) return;
    finalizationClaimedRef.current = true;
    await controlByoaHandoffV2({
      action: verdict === "incomplete" ? "timeout" : "unavailable",
      runId: current.runId,
      contractDigest: current.contractDigest,
      freshContextId: freshContextId()
    });
    const hydrated = await revealSession(current);
    const completedAt = nextTimestamp(current.updatedAt);
    const terminalResult = await createNoInvocationResultV3({
      session: hydrated,
      environment,
      verdict,
      detail,
      launchMode: "fresh-agent-handoff",
      evidenceTier: "independent-agent-native",
      armedAt: armedAtRef.current,
      completedAt,
      previousResultDigest: hydrated.regressionLink?.previousResultDigest ?? null
    });
    await persistTerminal(terminalResult, current);
  }

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const localSession = readByoaAgentSessionV2(window.sessionStorage);
        const localProjection = readAgentVisibleRunProjectionV2(window.sessionStorage);
        const sourceUrl = readByoaHandoffUrl(window.sessionStorage);
        if (
          (window.location.hash === "#handoff-source-v2" ||
            localSession?.state === "HANDOFF_ISSUED") &&
          localSession?.state === "HANDOFF_ISSUED" &&
          localProjection &&
          sourceUrl
        ) {
          setSource({
            url: sourceUrl,
            request: localProjection.request,
            toolNames: localProjection.descriptors.map(({ name }) => name),
            caseName: localSession.contract.title
          });
          setProjection(localProjection);
          return;
        }

        let remote = readRemoteByoaSessionV2(window.sessionStorage);
        let visible = localProjection;
        const storedResult = await readByoaResultV3(window.sessionStorage);
        if (!remote || !visible || remote.runId !== visible.runId) {
          const response = await fetch("/api/demo/handoff/bootstrap", {
            headers: byoaHandoffV2ContextHeaders(freshContextId()),
            cache: "no-store"
          });
          if (!response.ok) throw new Error("No valid fresh-agent handoff exists in this task.");
          const raw = await response.json();
          if (raw?.version !== BYOA_HANDOFF_BOOTSTRAP_V2_VERSION) {
            throw new Error("This task contains a legacy handoff. Reopen its original link.");
          }
          const bootstrap = byoaHandoffBootstrapResponseV2Schema.parse(raw);
          remote = bootstrap.session;
          visible = bootstrap.projection;
          writeRemoteByoaSessionV2(window.sessionStorage, remote);
          writeAgentVisibleRunProjectionV2(window.sessionStorage, visible);
        }
        if (disposed) return;
        sessionRef.current = remote;
        setSessionState(remote.state);
        setExistingRegressionCaseDigest(remote.regressionLink?.regressionCaseDigest ?? null);
        setProjection(visible);
        if (Date.parse(visible.expiresAt) <= Date.now()) {
          throw new Error("This opaque handoff expired. Close this task and create a fresh one.");
        }
        if (["PASS", "ISSUE", "INCOMPLETE", "UNAVAILABLE"].includes(remote.state)) {
          if (!storedResult || storedResult.resultDigest !== remote.terminalResultDigest) {
            throw new Error("The terminal result could not be verified after reload.");
          }
          terminalRef.current = true;
          setResult(storedResult);
          setProgress("Result ready");
          return;
        }
        if (remote.state === "RECEIVED") setProgress("Agent-visible test received");
        else if (remote.state === "READY_TO_ARM") setProgress("Ready for explicit start");
        else
          throw new Error(
            "The prior live document ended mid-observation. Open a new handoff for an honest rerun."
          );
      } catch (caught) {
        if (!disposed) {
          setError(caught instanceof Error ? caught.message : "The isolated test could not load.");
        }
      }
    })();
    return () => {
      disposed = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      unsubscribeGateRef.current();
      releaseRef.current();
    };
  }, []);

  function markReady() {
    if (sessionRef.current?.state !== "RECEIVED") return;
    move("READY_TO_ARM", "agent_reviewed_visible_test");
    setProgress("Ready for explicit start");
  }

  async function startLiveObservation() {
    if (!projection || sessionRef.current?.state !== "READY_TO_ARM") return;
    setError(undefined);
    try {
      if (Date.parse(projection.expiresAt) <= Date.now()) {
        throw new Error("This handoff expired before explicit start. No tools were registered.");
      }
      const current = sessionRef.current;
      if (!current) throw new Error("The isolated BYOA session is not loaded.");
      await controlByoaHandoffV2({
        action: "start",
        runId: current.runId,
        contractDigest: current.contractDigest,
        freshContextId: freshContextId()
      });
      move("PREPARING", "agent_explicit_start", { explicitStart: true });
      setProgress("Registering the selected native catalog");
      const environment = await createByoaAgentEnvironmentV2FromProjection(projection, APP_COMMIT);
      const capabilities = detectWebMcpCapabilities();
      if (!capabilities.providerRegistration || !document.modelContext) {
        await finalizeNoInvocation(
          environment,
          "unavailable",
          "This browser did not expose the supported native Site Tools provider after explicit start."
        );
        return;
      }
      unsubscribeGateRef.current = environment.gate.subscribe(() => {
        const claim = environment.gate.snapshot().claim;
        const current = sessionRef.current;
        if (!claim || !current || terminalRef.current) return;
        if (claim.disposition === "in-flight" && current.state === "ARMED") {
          setProgress("Native invocation observed");
          move("OBSERVING", "first_native_invocation_claimed");
        }
        if (claim.disposition !== "in-flight") runFinalizer(finalizeObserved(environment));
      });
      let readyHandled = false;
      releaseRef.current = webMcpRegistryManager.acquire(
        document.modelContext,
        environment.tools,
        (status: RegistryStatus) => {
          if (terminalRef.current) return;
          if (status.phase === "error") {
            runFinalizer(
              finalizeNoInvocation(
                environment,
                "unavailable",
                status.error ?? "The selected native catalog could not be registered."
              )
            );
            return;
          }
          if (status.phase !== "ready" || readyHandled) return;
          readyHandled = true;
          const current = sessionRef.current;
          if (!current || current.state !== "PREPARING") return;
          move("PROVIDER_READY", "selected_catalog_registered");
          const armed = move("ARMED", "observation_boundary_armed");
          armedAtRef.current = armed.updatedAt;
          setProgress("Waiting for one native agent invocation");
          timeoutRef.current = setTimeout(() => {
            runFinalizer(
              finalizeNoInvocation(
                environment,
                "incomplete",
                "No native WebMCP invocation was observed before the bounded 120-second timeout."
              )
            );
          }, OBSERVATION_TIMEOUT_MS);
        }
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Live observation could not start.");
    }
  }

  async function copy(kind: "command" | "url" | "request", value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
  }

  async function cancelSource() {
    const local = readByoaAgentSessionV2(window.sessionStorage);
    if (local?.state !== "HANDOFF_ISSUED") return;
    const handoffUrl = readByoaHandoffUrl(window.sessionStorage);
    const token = handoffUrl ? new URL(handoffUrl).hash.slice(1) : "";
    const response = await fetch("/api/demo/handoff/revoke", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Thurstone-Request": "byoa-handoff"
      },
      body: JSON.stringify({ version: BYOA_HANDOFF_REVOKE_V2_VERSION, token }),
      cache: "no-store"
    });
    if (!response.ok) {
      setError("The handoff could not be revoked safely. It was not cleared locally.");
      return;
    }
    clearByoaAgentSessionV2(window.sessionStorage);
    clearAgentVisibleRunProjectionV2(window.sessionStorage);
    clearByoaResultV3(window.sessionStorage);
    clearRemoteByoaSessionV2(window.sessionStorage);
    clearByoaHandoffUrl(window.sessionStorage);
    window.sessionStorage.removeItem(BYOA_RUNNER_V2_MARKER_KEY);
    window.location.replace("/demo");
  }

  if (source) {
    const command = `@Browser Open ${source.url}, then follow the request shown on the page.`;
    return (
      <section
        className="agent-runner-empty agent-handoff-source"
        data-byoa-v2-state="HANDOFF_SOURCE"
      >
        <p className="eyebrow">Stage 4 of 5 · selected live case prepared</p>
        <h1>Send this case to a genuinely fresh agent.</h1>
        <p>
          <strong>{source.caseName}</strong> is frozen with {source.toolNames.length} real tool
          {source.toolNames.length === 1 ? "" : "s"}: {source.toolNames.join(", ")}.
        </p>
        <label>
          Exact fresh-agent command
          <textarea readOnly rows={4} value={command} aria-label="Exact fresh-agent command" />
        </label>
        <div className="button-row">
          <button
            className="button button-primary"
            type="button"
            onClick={() => void copy("command", command)}
          >
            {copied === "command" ? "Command copied" : "Copy @Browser command"}
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void copy("url", source.url)}
          >
            {copied === "url" ? "URL copied" : "Copy opaque URL"}
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void copy("request", source.request)}
          >
            {copied === "request" ? "Request copied" : "Copy exact request"}
          </button>
          <button className="text-button" type="button" onClick={() => void cancelSource()}>
            Cancel unstarted handoff
          </button>
        </div>
        <p className="intro-microcopy">
          The opaque link expires in ten minutes. No native tools or countdown run in this owner
          task.
        </p>
        <p className="agent-runner-recovery">
          <strong>Do not open this link in ordinary Chrome or Chrome extension side chat.</strong>{" "}
          Opening is non-consuming, but only a fresh ChatGPT desktop built-in Browser task should
          claim and run the test.
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="agent-runner-empty" data-byoa-v2-state="ERROR">
        <p className="eyebrow">Isolated run stopped safely</p>
        <h1>This fresh-agent test cannot continue.</h1>
        <p>{error}</p>
        <p>
          Close this task and return to the owner&apos;s existing Demo task to create a new opaque
          handoff.
        </p>
      </section>
    );
  }

  if (!projection) {
    return (
      <section className="agent-runner-loading" aria-live="polite">
        <p className="eyebrow">Fresh-agent handoff</p>
        <h1>Receiving the answer-free test…</h1>
      </section>
    );
  }

  if (result) {
    return (
      <section className="byoa-terminal-result" data-byoa-v2-state={sessionState}>
        <DiagnosticResultV3
          result={result}
          actions={
            <RegressionActionsV3
              result={result}
              existingCaseDigest={existingRegressionCaseDigest}
            />
          }
        />
      </section>
    );
  }

  return (
    <section className="agent-runner-grid" data-byoa-v2-state={sessionState}>
      <div className="agent-runner-main">
        <p className="eyebrow">Stage 4 of 5 · isolated fresh-agent test</p>
        <h1>
          {sessionState === "RECEIVED"
            ? "Review what this agent receives."
            : sessionState === "READY_TO_ARM"
              ? "Start the bounded observation when ready."
              : "Your live test is armed."}
        </h1>
        <blockquote>{projection.request}</blockquote>
        <h2>Available native tools</h2>
        <ul>
          {projection.descriptors.map((tool) => (
            <li key={tool.name}>
              <strong>{tool.title}</strong> <code>{tool.name}</code>
              <p>{tool.description}</p>
            </li>
          ))}
        </ul>
        {sessionState === "RECEIVED" ? (
          <button className="button button-primary" type="button" onClick={markReady}>
            Continue to readiness
          </button>
        ) : null}
        {sessionState === "READY_TO_ARM" ? (
          <button
            className="button button-primary"
            type="button"
            onClick={() => void startLiveObservation()}
          >
            Start live observation
          </button>
        ) : null}
        {!["RECEIVED", "READY_TO_ARM"].includes(sessionState) ? (
          <p role="status" aria-live="polite">
            {progress}
          </p>
        ) : null}
      </div>
      <aside className="owner-fixture">
        <span className="owner-fixture-summary">Safe synthetic fixture</span>
        <strong>{projection.fixture.fixtureId}</strong>
        <p>{projection.fixture.summary}</p>
        <p>
          {projection.descriptors.length} selected real tool
          {projection.descriptors.length === 1 ? "" : "s"}. This isolated view contains only the
          request, catalog, and fixture.
        </p>
      </aside>
    </section>
  );
}
