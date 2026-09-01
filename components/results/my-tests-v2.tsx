"use client";

import { useEffect, useState } from "react";

import { RegressionActionsV3 } from "@/components/demo/regression-actions-v3";
import { StatusPill } from "@/components/status-pill";
import { BYOA_RESULT_V3_STORAGE_KEY, readByoaResultV3 } from "@/lib/demo/byoa-result-storage-v3";
import {
  MY_TESTS_V2_STORAGE_KEY,
  readMyTestsV2,
  regressionEntryV2ExportJson,
  removeMyTestV2,
  type MyTestsV2,
  type SavedRegressionEntryV2
} from "@/lib/demo/regression-store-v2";
import type { ByoaDemoResultV3 } from "@/lib/demo/result-v3";

const CHANGE_EVENT = "thurstone:my-tests-v2-change";

function status(verdict: ByoaDemoResultV3["verdict"]) {
  if (verdict === "pass") return "ready" as const;
  if (verdict === "issue") return "blocked" as const;
  return "neutral" as const;
}

function download(filename: string, bytes: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function ResultCard({
  result,
  label,
  regressionCaseDigest = null
}: {
  readonly result: ByoaDemoResultV3;
  readonly label: string;
  readonly regressionCaseDigest?: string | null;
}) {
  const primary = result.diagnostic.findings.find(
    ({ findingId }) => findingId === result.diagnostic.primaryFindingId
  );
  return (
    <article className="my-test-card" data-verdict={result.verdict}>
      <header>
        <div>
          <p className="eyebrow">{label}</p>
          <h3>{result.contract.title}</h3>
        </div>
        <StatusPill state={status(result.verdict)}>{result.verdict.toUpperCase()}</StatusPill>
      </header>
      <blockquote>{result.contract.request}</blockquote>
      <div className="my-test-decision">
        <span>
          Required <code>{result.selectedExpectedTool}</code>
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
        <span>{result.ledgerDiff.eventCountDelta} native event(s)</span>
        <span>{result.ledgerDiff.stateTransitionCount} transition(s)</span>
        <span>{result.evidenceTier.replaceAll("-", " ")}</span>
      </div>
      <section className="my-test-diagnostic" aria-label={primary?.title ?? "Case passed"}>
        <strong>{primary?.title ?? "The selected Contract v3 case held."}</strong>
        <p>{primary?.verifiedSummary ?? "All measured assertions passed in this trial."}</p>
        {primary ? <small>{primary.nextStep.instruction}</small> : null}
      </section>
      <RegressionActionsV3 result={result} existingCaseDigest={regressionCaseDigest} />
    </article>
  );
}

export function MyTestsV2() {
  const [current, setCurrent] = useState<ByoaDemoResultV3 | null>(null);
  const [store, setStore] = useState<MyTestsV2 | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const [nextCurrent, nextStore] = await Promise.all([
          readByoaResultV3(window.sessionStorage),
          readMyTestsV2(window.sessionStorage)
        ]);
        if (!active) return;
        setCurrent(nextCurrent);
        setStore(nextStore);
        setInvalid(false);
      } catch {
        if (active) setInvalid(true);
      } finally {
        if (active) setLoaded(true);
      }
    }
    function onChange() {
      void refresh();
    }
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener("storage", onChange);
    void refresh();
    return () => {
      active = false;
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  function notify() {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  if (!loaded) {
    return (
      <section className="my-tests" data-results-level="session-v2" aria-busy="true">
        <p>Verifying this browser session&apos;s Result v3 evidence…</p>
      </section>
    );
  }

  if (invalid) {
    return (
      <section className="panel my-tests" data-results-level="session" role="alert">
        <p className="eyebrow">My Tests v2 · this browser</p>
        <h2>Stored Result v3 data could not be verified.</h2>
        <p>Thurstone rejected it instead of presenting unverified bytes as evidence.</p>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => {
            window.sessionStorage.removeItem(BYOA_RESULT_V3_STORAGE_KEY);
            window.sessionStorage.removeItem(MY_TESTS_V2_STORAGE_KEY);
            notify();
          }}
        >
          Clear only invalid Result v3 data
        </button>
      </section>
    );
  }

  const entries = store?.entries ?? [];
  return (
    <section
      className="my-tests"
      data-results-level="session-v2"
      aria-labelledby="my-tests-v2-title"
    >
      <div className="results-level-heading">
        <div>
          <p className="eyebrow">My Contract v3 tests · this browser session</p>
          <h2 id="my-tests-v2-title">Fresh-agent results and regression cases.</h2>
          <p>
            These exploratory results remain separate from immutable 24/24 and 3/3 reference
            evidence.
          </p>
        </div>
        <StatusPill state={entries.length > 0 || current ? "ready" : "neutral"}>
          {entries.length} saved v3 case{entries.length === 1 ? "" : "s"}
        </StatusPill>
      </div>

      {!current && entries.length === 0 ? (
        <div className="empty-results session-empty">
          <div>
            <h3>No Contract v3 result in this browser session yet.</h3>
            <p>
              Build a suite, send one selected case to a fresh agent, and inspect the verified
              effect.
            </p>
            <a className="button button-primary" href="/demo">
              Build a contract suite
            </a>
          </div>
        </div>
      ) : null}

      {current ? (
        <div className="my-tests-current">
          <ResultCard result={current} label="Current Result v3 run" />
          <button
            className="text-button"
            type="button"
            onClick={() => {
              window.sessionStorage.removeItem(BYOA_RESULT_V3_STORAGE_KEY);
              notify();
            }}
          >
            Clear current v3 run from this view
          </button>
        </div>
      ) : null}

      {entries.length > 0 ? (
        <div className="my-tests-saved" aria-label="Saved Contract v3 regression cases">
          {entries.map((entry: SavedRegressionEntryV2) => {
            const latest = entry.results.at(-1);
            if (!latest) return null;
            return (
              <div key={entry.case.regressionCaseDigest} className="my-tests-saved-entry">
                <ResultCard
                  result={latest}
                  label={`Saved v3 regression · ${entry.results.length} result${entry.results.length === 1 ? "" : "s"}`}
                  regressionCaseDigest={entry.case.regressionCaseDigest}
                />
                <div className="button-row">
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() =>
                      void regressionEntryV2ExportJson(
                        window.sessionStorage,
                        entry.case.regressionCaseDigest
                      ).then((bytes) =>
                        download(
                          `thurstone-regression-v2-${entry.case.regressionCaseDigest.slice(0, 12)}.json`,
                          bytes
                        )
                      )
                    }
                  >
                    Export v3 case JSON
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() =>
                      void removeMyTestV2(
                        window.sessionStorage,
                        entry.case.regressionCaseDigest
                      ).then(notify)
                    }
                  >
                    Clear saved v3 case
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
