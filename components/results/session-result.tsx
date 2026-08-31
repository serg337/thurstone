"use client";

import { useSyncExternalStore } from "react";

import { StatusPill } from "@/components/status-pill";
import type { WorkshopDecision } from "@/lib/demo/contract";
import type { ThurstoneDemoResultV1 } from "@/lib/demo/result";
import {
  DEMO_RESULT_STORAGE_KEY,
  clearDemoResult,
  readDemoResult
} from "@/lib/demo/session-storage";

type SessionResultState =
  | { readonly kind: "empty" }
  | { readonly kind: "invalid" }
  | { readonly kind: "ready"; readonly result: ThurstoneDemoResultV1 };

const SESSION_RESULT_CHANGE_EVENT = "thurstone:demo-result-change";

function subscribeSessionResult(onStoreChange: () => void): () => void {
  window.addEventListener(SESSION_RESULT_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(SESSION_RESULT_CHANGE_EVENT, onStoreChange);
}

function getSessionResultSnapshot(): string | null {
  return window.sessionStorage.getItem(DEMO_RESULT_STORAGE_KEY);
}

function getServerSessionResultSnapshot(): null {
  return null;
}

const sourceLabels: Readonly<Record<ThurstoneDemoResultV1["source"], string>> = Object.freeze({
  contract_validation: "Provider-free contract validation",
  native_direct: "Live native WebMCP invocation",
  live_agent: "Live agent decision",
  verified_replay: "Verified reference replay"
});

function decisionLabel(decision: WorkshopDecision | null): string {
  if (decision === null) return "No live decision was claimed";
  if (decision.kind === "clarify") return "Ask for clarification";
  if (decision.kind === "no_action") return "Take no action";
  return `Call ${decision.toolName}`;
}

function downloadResult(result: ThurstoneDemoResultV1): void {
  const bytes = JSON.stringify(result, null, 2);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `thurstone-session-${result.sessionId.slice(-12)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function SessionResult() {
  const encoded = useSyncExternalStore(
    subscribeSessionResult,
    getSessionResultSnapshot,
    getServerSessionResultSnapshot
  );
  let state: SessionResultState;
  if (encoded === null) {
    state = { kind: "empty" };
  } else {
    try {
      const result = readDemoResult(window.sessionStorage);
      state = result === null ? { kind: "empty" } : { kind: "ready", result };
    } catch {
      state = { kind: "invalid" };
    }
  }

  function clearCurrentResult(): void {
    clearDemoResult(window.sessionStorage);
    window.dispatchEvent(new Event(SESSION_RESULT_CHANGE_EVENT));
  }

  if (state.kind === "empty") {
    return (
      <section className="empty-results session-empty" data-results-level="session">
        <div className="empty-glyph" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div>
          <p className="eyebrow">Your test · this browser session</p>
          <h2>Run a test to see its result here.</h2>
          <p>
            Complete the guided demo or define a contract. Only this tab’s synthetic result appears
            here.
          </p>
          <a className="button button-primary" href="/demo">
            Test Thurstone
          </a>
        </div>
      </section>
    );
  }

  if (state.kind === "invalid") {
    return (
      <section className="panel session-result-section" data-results-level="session" role="alert">
        <p className="eyebrow">Your test · this browser session</p>
        <h2>This tab’s stored result could not be verified.</h2>
        <p>
          Thurstone rejected the local value instead of presenting it as evidence. The verified
          reference results below are unaffected.
        </p>
        <div className="button-row">
          <button className="button button-secondary" type="button" onClick={clearCurrentResult}>
            Clear invalid session value
          </button>
          <a className="button button-primary" href="/demo">
            Start a fresh test
          </a>
        </div>
      </section>
    );
  }

  const { result } = state;
  const passedAssertions = result.assertions.filter(({ passed }) => passed).length;
  return (
    <section
      className="panel session-result-section"
      data-results-level="session"
      aria-labelledby="session-result-title"
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Your test · this browser session</p>
          <h2 id="session-result-title">{result.contract.title ?? result.contract.request}</h2>
        </div>
        <StatusPill state={result.verdict === "pass" ? "ready" : "blocked"}>
          {result.verdict === "pass" ? "Pass" : result.verdict}
        </StatusPill>
      </div>
      <p className="session-source-label">{sourceLabels[result.source]}</p>
      <blockquote className="session-request">“{result.contract.request}”</blockquote>

      <div className="session-decision-grid" aria-label="Expected and observed behavior">
        <article>
          <span>Contract required</span>
          <strong>{decisionLabel(result.expected)}</strong>
        </article>
        <article>
          <span>Observed</span>
          <strong>{decisionLabel(result.actual)}</strong>
        </article>
      </div>

      <div className="session-state-grid" aria-label="Trusted state and ledger result">
        <article>
          <span>Before</span>
          <strong>Revision {result.trustedStateBefore.revision}</strong>
          <small>{result.trustedStateBefore.pendingCheckout ?? "no pending checkout"}</small>
        </article>
        <article>
          <span>After</span>
          <strong>Revision {result.trustedStateAfter.revision}</strong>
          <small>{result.trustedStateAfter.pendingCheckout ?? "no pending checkout"}</small>
        </article>
        <article>
          <span>Ledger</span>
          <strong>{result.ledgerDiff.stateTransitionCount} transition(s)</strong>
          <small>{result.ledgerDiff.eventCount} event(s)</small>
        </article>
        <article>
          <span>Assertions</span>
          <strong>
            {passedAssertions}/{result.assertions.length} passed
          </strong>
          <small>
            {result.ledgerDiff.replayObserved ? "replay observed" : "no replay observed"}
          </small>
        </article>
      </div>

      <ul className="session-assertions" aria-label="Current session assertions">
        {result.assertions.map((assertion) => (
          <li key={assertion.label} data-passed={assertion.passed}>
            <span aria-hidden="true">{assertion.passed ? "✓" : "×"}</span>
            <div>
              <strong>{assertion.label}</strong>
              <small>{assertion.detail}</small>
            </div>
          </li>
        ))}
      </ul>

      <details className="expert-disclosure">
        <summary>Inspect this synthetic session receipt</summary>
        <pre>{JSON.stringify(result, null, 2)}</pre>
      </details>
      <div className="button-row">
        <button
          className="button button-secondary"
          type="button"
          onClick={() => downloadResult(result)}
        >
          Download my result JSON
        </button>
        <button className="button button-secondary" type="button" onClick={clearCurrentResult}>
          Clear my session result
        </button>
        <a className="button button-primary" href="/demo">
          Test another contract
        </a>
      </div>
      <small className="session-provenance">
        Build <code>{result.buildCommit.slice(0, 12)}</code> · completed{" "}
        {new Date(result.completedAt).toLocaleString("en", { timeZone: "UTC" })} UTC
      </small>
    </section>
  );
}
