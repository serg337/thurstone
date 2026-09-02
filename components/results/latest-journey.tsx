"use client";

import { useEffect, useState } from "react";

import {
  OWNER_JOURNEY_REPORT_CHANGE_EVENT,
  clearOwnerJourneyReport,
  ownerJourneyReportJson,
  readOwnerJourneyReport,
  type OwnerJourneyReport
} from "@/lib/demo/owner-journey-report";

function download(filename: string, bytes: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function verdictLabel(verdict: OwnerJourneyReport["results"][number]["verdict"]): string {
  if (verdict === "pass") return "Pass";
  if (verdict === "issue") return "Fail";
  if (verdict === "incomplete") return "Incomplete";
  return "Unavailable";
}

export function LatestJourney({
  qaPreviewReport
}: {
  readonly qaPreviewReport?: OwnerJourneyReport;
}) {
  const [report, setReport] = useState<OwnerJourneyReport | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    let active = true;
    void (
      qaPreviewReport
        ? Promise.resolve(qaPreviewReport)
        : readOwnerJourneyReport(window.sessionStorage)
    )
      .then((value) => {
        if (active) setReport(value);
      })
      .catch(() => {
        if (active) setInvalid(true);
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [qaPreviewReport]);

  const qaPreview = qaPreviewReport !== undefined;

  if (!loaded) {
    return (
      <section className="latest-journey panel" aria-busy="true">
        <p>Loading the latest Demo results…</p>
      </section>
    );
  }
  if (invalid) {
    return (
      <section className="latest-journey panel" role="alert">
        <p className="eyebrow">Demo results unavailable</p>
        <h2>The saved Demo report could not be verified.</h2>
        <p>The local report was rejected because its stored data did not pass verification.</p>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => {
            clearOwnerJourneyReport(window.sessionStorage);
            setInvalid(false);
            setReport(null);
          }}
        >
          Clear invalid Demo report
        </button>
      </section>
    );
  }
  if (report === null) {
    return (
      <section className="latest-journey latest-journey-empty">
        <p className="eyebrow">No Demo results</p>
        <h2>Run a Demo test to create a results report.</h2>
        <p>
          Completed regression suites and continuous journeys will appear here in this browser tab.
        </p>
        <a className="button button-primary" href="/demo">
          Open the Demo
        </a>
      </section>
    );
  }

  const allPassed = report.counts.passed === report.total;
  const runLabel = report.mode === "continuous" ? "Continuous journey" : "Regression suite";
  return (
    <section
      className="latest-journey"
      data-results-level="owner-journey"
      data-qa-preview={qaPreview}
      aria-labelledby="latest-journey-title"
    >
      <div className="results-level-heading">
        <div>
          <p className="eyebrow">Latest Demo run · {runLabel}</p>
          <h2 id="latest-journey-title">
            {allPassed
              ? `${report.counts.passed} of ${report.total} tests passed.`
              : `${report.counts.passed} passed, ${report.counts.issues} failed, and ${report.counts.notRun} not run.`}
          </h2>
          <p>
            Results for each request are listed in execution order. Expected behavior comes from
            your Demo contract; observed behavior and effects come from the completed test.
          </p>
          {!qaPreview ? (
            <small className="latest-journey-retention">
              Saved in this browser tab until the session ends or you clear it.
            </small>
          ) : null}
        </div>
      </div>

      <div className="latest-journey-metrics" aria-label="Latest journey totals">
        <article>
          <strong>{report.counts.passed}</strong>
          <span>Passed</span>
        </article>
        <article>
          <strong>{report.counts.issues}</strong>
          <span>Failed</span>
        </article>
        <article>
          <strong>{report.counts.notRun}</strong>
          <span>Not run</span>
        </article>
        <article>
          <strong>{report.results.length}</strong>
          <span>Tests completed</span>
        </article>
      </div>

      <div
        className="latest-journey-table-wrap"
        role="region"
        aria-label="Scrollable latest journey results"
        tabIndex={0}
      >
        <table className="latest-journey-table" aria-label={`${runLabel} Demo results`}>
          <thead>
            <tr>
              <th scope="col">Test</th>
              <th scope="col">User request</th>
              <th scope="col">Expected tool</th>
              <th scope="col">Agent used</th>
              <th scope="col">Verified site effect</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {report.results.map((result) => (
              <tr key={result.caseId} data-verdict={result.verdict}>
                <td>{result.position}</td>
                <td>{result.ownerSummary.request}</td>
                <td>
                  <code>{result.ownerSummary.expectedTool}</code>
                </td>
                <td>
                  <code>{result.ownerSummary.observedTool ?? "no tool"}</code>
                </td>
                <td>{result.ownerSummary.verifiedEffect}</td>
                <td>
                  <strong>{verdictLabel(result.verdict)}</strong>
                  <p>{result.ownerSummary.resultExplanation}</p>
                </td>
              </tr>
            ))}
            {report.notRun.map((result) => (
              <tr key={result.caseId} data-verdict="not-run">
                <td>{result.position}</td>
                <td>{result.request}</td>
                <td>
                  <code>{result.expectedTool}</code>
                </td>
                <td>—</td>
                <td>Not evaluated</td>
                <td>
                  <strong>Not run</strong>
                  <p>{result.reason}</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="latest-journey-final" aria-labelledby="latest-final-state-title">
        <div>
          <p className="eyebrow">
            {report.mode === "continuous" ? "Final Demo state" : "Final test-case state"}
          </p>
          <h3 id="latest-final-state-title">
            {report.mode === "continuous"
              ? "State recorded after the final journey request."
              : "Clean fixture state recorded after the final independent case."}
          </h3>
        </div>
        <div>
          <span>Revision {report.finalTrustedState.revision}</span>
          {report.finalTrustedState.lines.map((line) => (
            <span key={line.itemId}>
              {line.name} × {line.quantity}
            </span>
          ))}
          <span>
            {report.finalTrustedState.pendingCheckoutStatus
              ? `Checkout: ${report.finalTrustedState.pendingCheckoutStatus.replaceAll("_", " ")}`
              : "No pending checkout"}
          </span>
        </div>
      </section>

      <div className="button-row latest-journey-actions">
        <a className="button button-primary" href="/demo">
          Run another Demo test
        </a>
        <a className="button button-secondary" href="/demo?contract-run=rerun">
          Edit Demo contract
        </a>
        <button
          className="button button-secondary"
          type="button"
          onClick={() =>
            download(
              `thurstone-${report.mode}-${report.reportDigest.slice(0, 12)}.json`,
              ownerJourneyReportJson(report)
            )
          }
        >
          Download results
        </button>
        {!qaPreview ? (
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              clearOwnerJourneyReport(window.sessionStorage);
              window.dispatchEvent(new Event(OWNER_JOURNEY_REPORT_CHANGE_EVENT));
              setReport(null);
            }}
          >
            Clear results
          </button>
        ) : null}
      </div>

      <details className="expert-disclosure latest-journey-receipts">
        <summary>Technical receipt digests</summary>
        <dl>
          <div>
            <dt>Journey report</dt>
            <dd>
              <code>{report.reportDigest}</code>
            </dd>
          </div>
          {report.results.map((result) => (
            <div key={result.caseId}>
              <dt>Step {result.position}</dt>
              <dd>
                <code>{result.resultDigest}</code>
              </dd>
            </div>
          ))}
          {report.notRun.map((result) => (
            <div key={result.caseId}>
              <dt>Step {result.position}</dt>
              <dd>No receipt — test not run</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
