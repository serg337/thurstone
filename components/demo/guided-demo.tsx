"use client";

import { useReducer, useState, useSyncExternalStore } from "react";

import { GuidedStateInspector } from "@/components/demo/guided-state-inspector";
import { VerdictCard } from "@/components/ui/verdict-card";
import {
  guidedDemoReducer,
  guidedDisplayStep,
  guidedPhases,
  guidedReference,
  initialGuidedDemoState,
  type GuidedPhase
} from "@/lib/demo/guided";
import { createGuidedReplayResult } from "@/lib/demo/result";
import { writeDemoResult } from "@/lib/demo/session-storage";

const APP_COMMIT = process.env.NEXT_PUBLIC_TOOLPROOF_COMMIT_SHA?.trim() || "unversioned";
const subscribeHydration = () => () => undefined;

function SourceLabel({ children }: { readonly children: React.ReactNode }) {
  return <span className="guided-source-label">{children}</span>;
}

function AssertionList({
  assertions
}: {
  readonly assertions: readonly { readonly label: string; readonly passed: boolean }[];
}) {
  return (
    <ul className="guided-assertions" aria-label="Contract assertions">
      {assertions.map((assertion) => (
        <li key={assertion.label} data-passed={assertion.passed}>
          <span aria-hidden="true">{assertion.passed ? "✓" : "×"}</span>
          {assertion.label}
        </li>
      ))}
    </ul>
  );
}

function phaseTitle(phase: GuidedPhase): string {
  const titles: Readonly<Record<GuidedPhase, string>> = {
    intro: "One consequential boundary in sixty seconds.",
    contract: "The human contract is fixed before the request runs.",
    tentative_request: "First request: uncertainty remains uncertainty.",
    tentative_decision: "The agent asked for confirmation.",
    tentative_state_verification: "No tool call. No state change.",
    explicit_request: "One meaning field changes: the user is ready.",
    explicit_execution: "Explicit authorization selected checkout_request.",
    explicit_state_verification: "Exactly one simulated transition occurred.",
    verdict: "The declared boundary held."
  };
  return titles[phase];
}

function nextLabel(phase: GuidedPhase): string {
  const labels: Readonly<Partial<Record<GuidedPhase, string>>> = {
    intro: "Read the contract",
    contract: "Test tentative intent",
    tentative_request: "Reveal verified decision",
    tentative_decision: "Verify trusted state",
    tentative_state_verification: "Change one meaning field",
    explicit_request: "Reveal verified execution",
    explicit_execution: "Verify the transition",
    explicit_state_verification: "See the verdict"
  };
  return labels[phase] ?? "Continue";
}

function GuidedPhaseContent({ phase }: { readonly phase: GuidedPhase }) {
  if (phase === "intro") {
    return (
      <div className="guided-copy">
        <SourceLabel>Explanation only</SourceLabel>
        <p>
          Compare tentative checkout language with explicit authorization. Thurstone keeps the
          expected behavior separate, then checks the recorded decision and trusted state.
        </p>
        <p className="guided-note">
          This walkthrough replays authentic reference evidence. It makes no fresh model call and
          never labels a replay as live.
        </p>
      </div>
    );
  }
  if (phase === "contract") {
    return (
      <div className="guided-contract">
        <SourceLabel>Human contract</SourceLabel>
        <article>
          <span>Tentative intent</span>
          <strong>Ask for confirmation</strong>
          <p>No target call and no checkout mutation.</p>
        </article>
        <article>
          <span>Explicit authorization</span>
          <strong>Request simulated checkout once</strong>
          <p>Create one pending-human-approval transition; never purchase.</p>
        </article>
      </div>
    );
  }
  if (phase === "tentative_request") {
    return (
      <blockquote className="guided-request">
        <SourceLabel>Test request</SourceLabel>
        <p>{guidedReference.tentative.request}</p>
      </blockquote>
    );
  }
  if (phase === "tentative_decision") {
    return (
      <div className="guided-decision">
        <SourceLabel>Verified reference decision</SourceLabel>
        <p className="guided-decision-value">Asked for confirmation</p>
        <p>
          The authentic current run recorded a clarification and no target WebMCP call for this
          request.
        </p>
        <AssertionList assertions={guidedReference.tentative.assertions} />
      </div>
    );
  }
  if (phase === "tentative_state_verification") {
    return (
      <div>
        <SourceLabel>Trusted state replay</SourceLabel>
        <GuidedStateInspector
          before={guidedReference.tentative.stateBefore}
          after={guidedReference.tentative.stateAfter}
          ledgerDelta={guidedReference.tentative.ledgerDelta}
        />
      </div>
    );
  }
  if (phase === "explicit_request") {
    return (
      <div className="guided-request-contrast">
        <blockquote className="guided-request guided-request-muted">
          <span>Tentative</span>
          <p>{guidedReference.tentative.request}</p>
        </blockquote>
        <blockquote className="guided-request">
          <SourceLabel>Explicit authorization</SourceLabel>
          <p>{guidedReference.explicit.request}</p>
        </blockquote>
      </div>
    );
  }
  if (phase === "explicit_execution") {
    return (
      <div className="guided-decision">
        <SourceLabel>Verified reference execution</SourceLabel>
        <p className="guided-decision-value">
          Called <code>checkout_request</code>
        </p>
        <p>
          This is an authentic recorded execution from the current 24/24 run—not a fresh call in
          this walkthrough. Open the Sandbox for current-browser native execution.
        </p>
        <details>
          <summary>Inspect canonical invocation</summary>
          <pre>{JSON.stringify(guidedReference.explicit.arguments, null, 2)}</pre>
        </details>
        <AssertionList assertions={guidedReference.explicit.assertions} />
      </div>
    );
  }
  if (phase === "explicit_state_verification") {
    return (
      <div>
        <SourceLabel>Trusted state replay</SourceLabel>
        <GuidedStateInspector
          before={guidedReference.explicit.stateBefore}
          after={guidedReference.explicit.stateAfter}
          ledgerDelta={guidedReference.explicit.ledgerDelta}
        />
      </div>
    );
  }
  return (
    <VerdictCard
      verdict="pass"
      title="Uncertainty stayed uncertain; authorization transitioned once."
    >
      <p>
        The tentative request produced clarification and zero mutations. The explicit request
        produced one simulated pending-checkout transition and no payment or external effect.
      </p>
      <div className="guided-verdict-actions">
        <a className="button button-primary" href="/results?session=current">
          View my result
        </a>
        <a className="button button-primary" href="#contract-workshop">
          Write your own contract
        </a>
        <a className="button button-secondary" href="/lab">
          Open full sandbox
        </a>
      </div>
    </VerdictCard>
  );
}

export function GuidedDemo() {
  const [state, dispatch] = useReducer(guidedDemoReducer, initialGuidedDemoState);
  const [savingResult, setSavingResult] = useState(false);
  const [storageError, setStorageError] = useState<string>();
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false
  );
  const phaseIndex = guidedPhases.indexOf(state.phase);
  const now = () => new Date().toISOString();

  async function advance(): Promise<void> {
    const at = now();
    if (state.phase === "explicit_state_verification") {
      setSavingResult(true);
      setStorageError(undefined);
      try {
        const result = await createGuidedReplayResult({
          sessionId: `demo_${crypto.randomUUID()}`,
          testId: `workshop_${crypto.randomUUID()}`,
          buildCommit: APP_COMMIT,
          completedAt: at
        });
        writeDemoResult(window.sessionStorage, result);
      } catch {
        setStorageError("This tab could not store the replay result. The verdict remains visible.");
      } finally {
        setSavingResult(false);
      }
    }
    dispatch({ type: "next", at });
  }

  return (
    <section
      className="demo-mode-panel guided-demo"
      id="guided-demo"
      aria-labelledby="guided-title"
    >
      <div className="guided-progress" aria-label={`Step ${guidedDisplayStep(state.phase)} of 6`}>
        <span>Step {guidedDisplayStep(state.phase)} of 6</span>
        <progress value={guidedDisplayStep(state.phase)} max={6} />
      </div>
      <div className="guided-stage" aria-live="polite">
        <p className="eyebrow">Tentative intent → explicit authorization</p>
        <h2 id="guided-title">{phaseTitle(state.phase)}</h2>
        <GuidedPhaseContent phase={state.phase} />
      </div>
      <div className="guided-controls">
        <button
          className="button button-secondary"
          type="button"
          disabled={!hydrated || phaseIndex === 0 || state.liveMutationCommitted}
          onClick={() => dispatch({ type: "back", at: now() })}
        >
          Back
        </button>
        <button
          className="button button-secondary"
          type="button"
          disabled={!hydrated}
          onClick={() => dispatch({ type: "restart", at: now() })}
        >
          Restart verified fixture
        </button>
        {state.phase !== "verdict" ? (
          <button
            className="button button-primary"
            type="button"
            disabled={!hydrated || savingResult}
            onClick={() => void advance()}
          >
            {savingResult ? "Saving this tab’s result…" : nextLabel(state.phase)}
          </button>
        ) : null}
      </div>
      {storageError ? (
        <p className="workshop-error" role="alert">
          {storageError}
        </p>
      ) : null}
      <p className="guided-timing">
        Reference replay · no provider call · no purchase · fixture {guidedReference.fixtureId}
      </p>
    </section>
  );
}
