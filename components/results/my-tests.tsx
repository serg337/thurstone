"use client";

import { useSyncExternalStore } from "react";

import { RegressionActions } from "@/components/demo/regression-actions";
import { StatusPill } from "@/components/status-pill";
import { BYOA_RESULT_STORAGE_KEY } from "@/lib/demo/byoa-result-storage";
import {
  MY_TESTS_STORAGE_KEY,
  myTestsSchema,
  removeMyTest,
  type SavedRegressionEntry
} from "@/lib/demo/regression-store";
import { byoaDemoResultSchema, type ByoaDemoResultV2 } from "@/lib/demo/result-v2";

const MY_TESTS_CHANGE_EVENT = "thurstone:my-tests-change";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(MY_TESTS_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(MY_TESTS_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function snapshot(): string {
  return JSON.stringify([
    window.sessionStorage.getItem(BYOA_RESULT_STORAGE_KEY),
    window.sessionStorage.getItem(MY_TESTS_STORAGE_KEY)
  ]);
}

function serverSnapshot(): string {
  return "[null,null]";
}

function verdictState(verdict: ByoaDemoResultV2["verdict"]) {
  if (verdict === "pass") return "ready" as const;
  if (verdict === "fail") return "blocked" as const;
  return "neutral" as const;
}

function verdictLabel(verdict: ByoaDemoResultV2["verdict"]): string {
  if (verdict === "fail") return "Issue";
  return verdict[0]?.toUpperCase() + verdict.slice(1);
}

function downloadEntry(entry: SavedRegressionEntry): void {
  const bytes = JSON.stringify(entry, null, 2);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `thurstone-regression-${entry.case.caseDigest.slice(0, 12)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function TestSummary({
  result,
  caseDigest = null,
  label
}: {
  readonly result: ByoaDemoResultV2;
  readonly caseDigest?: string | null;
  readonly label: string;
}) {
  const primary = result.diagnostic.findings.find(
    ({ findingId }) => findingId === result.diagnostic.primaryFindingId
  );
  return (
    <article className="my-test-card" data-verdict={result.verdict}>
      <header>
        <div>
          <p className="eyebrow">{label}</p>
          <h3>{result.contract.title ?? result.contract.request}</h3>
        </div>
        <StatusPill state={verdictState(result.verdict)}>{verdictLabel(result.verdict)}</StatusPill>
      </header>
      <blockquote>{result.contract.request}</blockquote>
      <div className="my-test-decision">
        <span>
          Required <code>{result.expectedTool}</code>
        </span>
        <span>
          Observed <code>{result.observedTool ?? "no native invocation"}</code>
        </span>
      </div>
      <div className="my-test-state">
        <span>
          Revision {result.trustedStateBefore.value.revision} →{" "}
          {result.trustedStateAfter.value.revision}
        </span>
        <span>{result.ledgerDiff.eventCountDelta} ledger event(s)</span>
        <span>{result.ledgerDiff.stateTransitionCount} transition(s)</span>
      </div>
      <section className="my-test-diagnostic" aria-label={primary?.title ?? "Case passed"}>
        <strong>{primary?.title ?? "The contract held in this trial."}</strong>
        <p>
          {primary?.hypothesis?.message ??
            "Save and rerun this case when the catalog, agent, browser, or tested build changes."}
        </p>
        {primary ? <small>{primary.nextStep.instruction}</small> : null}
      </section>
      <RegressionActions result={result} existingCaseDigest={caseDigest} />
    </article>
  );
}

export function MyTests() {
  const encoded = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  let current: ByoaDemoResultV2 | null = null;
  let entries: readonly SavedRegressionEntry[] = [];
  let invalid = false;
  try {
    const [currentEncoded, testsEncoded] = JSON.parse(encoded) as [string | null, string | null];
    current = currentEncoded
      ? byoaDemoResultSchema.parse(JSON.parse(currentEncoded) as unknown)
      : null;
    entries = testsEncoded ? myTestsSchema.parse(JSON.parse(testsEncoded) as unknown).entries : [];
  } catch {
    invalid = true;
  }

  function notify(): void {
    window.dispatchEvent(new Event(MY_TESTS_CHANGE_EVENT));
  }

  function clearCurrent(): void {
    window.sessionStorage.removeItem(BYOA_RESULT_STORAGE_KEY);
    notify();
  }

  async function remove(entry: SavedRegressionEntry): Promise<void> {
    await removeMyTest(window.sessionStorage, entry.case.caseDigest);
    notify();
  }

  if (invalid) {
    return (
      <section className="panel my-tests" data-results-level="session" role="alert">
        <p className="eyebrow">My Tests · this browser</p>
        <h2>Stored local test data could not be verified.</h2>
        <p>
          Thurstone rejected it instead of presenting it as evidence. Reference Results are
          unchanged.
        </p>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => {
            window.sessionStorage.removeItem(BYOA_RESULT_STORAGE_KEY);
            window.sessionStorage.removeItem(MY_TESTS_STORAGE_KEY);
            notify();
          }}
        >
          Clear invalid local data
        </button>
      </section>
    );
  }

  return (
    <section className="my-tests" data-results-level="session" aria-labelledby="my-tests-title">
      <div className="results-level-heading">
        <div>
          <p className="eyebrow">My Tests · this browser session</p>
          <h2 id="my-tests-title">The cases you ran with your agent.</h2>
          <p>
            These local exploratory results are separate from Thurstone’s immutable 24/24 and 3/3
            reference evidence.
          </p>
        </div>
        <StatusPill state={entries.length > 0 || current ? "ready" : "neutral"}>
          {entries.length} saved case{entries.length === 1 ? "" : "s"}
        </StatusPill>
      </div>

      {!current && entries.length === 0 ? (
        <div className="empty-results session-empty">
          <div>
            <h3>No local test yet.</h3>
            <p>Build a bounded contract, ask your agent to act, and return here to inspect it.</p>
            <a className="button button-primary" href="/demo">
              Test with your agent
            </a>
          </div>
        </div>
      ) : null}

      {current ? (
        <div className="my-tests-current">
          <TestSummary result={current} label="Current run" />
          <button className="text-button" type="button" onClick={clearCurrent}>
            Clear current run from this view
          </button>
        </div>
      ) : null}

      {entries.length > 0 ? (
        <div className="my-tests-saved" aria-label="Saved regression cases">
          {entries.map((entry) => {
            const latest = entry.results.at(-1);
            if (!latest) return null;
            return (
              <div key={entry.case.caseDigest} className="my-tests-saved-entry">
                <TestSummary
                  result={latest}
                  caseDigest={entry.case.caseDigest}
                  label={`Saved regression · ${entry.results.length} result${entry.results.length === 1 ? "" : "s"}`}
                />
                <div className="button-row">
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => downloadEntry(entry)}
                  >
                    Export case JSON
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => void remove(entry)}
                  >
                    Clear saved case
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
