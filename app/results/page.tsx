import type { Metadata } from "next";

import { InvocationIntegritySummary } from "@/components/results/invocation-integrity-summary";
import { SessionResult } from "@/components/results/session-result";
import { StatusPill } from "@/components/status-pill";
import currentResult from "@/evidence/thurstone-current-result.json";

export const metadata: Metadata = {
  title: "Results",
  description:
    "See your current Thurstone test, the verified 24/24 semantic evaluation, and the separate 3/3 Invocation Integrity Matrix."
};

function actionLabel(value: string) {
  if (value === "clarify") return "Asked for confirmation";
  if (value === "no_action") return "Took no action";
  return value.replace("call:", "Called ").replaceAll("_", " ");
}

export default function ResultsPage() {
  const uncertainCheckout = currentResult.rows.find(
    ({ caseId }) => caseId === "commitment_holdout_anchor"
  );
  const clarificationCount = currentResult.rows.filter(
    ({ observedAction }) => observedAction === "clarify"
  ).length;

  return (
    <div className="page-shell route-page results-page">
      <header className="route-hero" aria-labelledby="results-title">
        <div>
          <p className="eyebrow">What happened, what was allowed, what changed</p>
          <h1 id="results-title">Results that begin with your test.</h1>
          <p>
            Thurstone shows this tab&apos;s synthetic result first, then the verified reference
            evaluation and a separate hostile-invocation matrix. Expected behavior never replaces
            observed evidence.
          </p>
        </div>
        <StatusPill state="ready">Verified reference available</StatusPill>
      </header>

      <SessionResult />

      <section
        className="results-reference"
        data-results-level="reference"
        aria-labelledby="current-results-title"
      >
        <div className="results-level-heading">
          <div>
            <p className="eyebrow">Verified reference evaluation</p>
            <h2 id="current-results-title">Every approved reference behavior passed.</h2>
            <p>
              Thurstone sent 24 checkout requests through the live WebMCP catalog, then compared
              tool choice, arguments, and resulting page state with the human-approved contract.
            </p>
          </div>
          <StatusPill state="ready">24/24 semantic behaviors</StatusPill>
        </div>

        <section className="panel" aria-labelledby="result-score-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">What Thurstone checked</p>
              <h3 id="result-score-title">
                Intent, tool choice, arguments, and real page effects.
              </h3>
            </div>
          </div>
          <div className="invocation-integrity-summary" aria-label="Current evaluation summary">
            <div>
              <strong>{currentResult.summary.passed}</strong>
              <span>Approved behaviors passed</span>
            </div>
            <div>
              <strong>{currentResult.summary.failed}</strong>
              <span>Contract mismatches</span>
            </div>
            <div>
              <strong>{currentResult.summary.nativeCalls}</strong>
              <span>Native WebMCP calls verified</span>
            </div>
            <div>
              <strong>{clarificationCount}</strong>
              <span>Requests correctly clarified</span>
            </div>
          </div>
        </section>

        {uncertainCheckout ? (
          <section className="panel" aria-labelledby="clarification-result-title">
            <p className="eyebrow">A consequential boundary</p>
            <h3 id="clarification-result-title">
              Uncertainty did not become an unintended checkout.
            </h3>
            <div className="trace-inspector-grid impact-boundary-grid">
              <article>
                <span className="eyebrow">The request</span>
                <h4>{uncertainCheckout.request}</h4>
              </article>
              <article>
                <span className="eyebrow">The approved behavior</span>
                <h4>{actionLabel(uncertainCheckout.expectedAction)}</h4>
                <p>No checkout request and no page mutation were permitted.</p>
              </article>
              <article>
                <span className="eyebrow">What happened</span>
                <h4>{actionLabel(uncertainCheckout.observedAction)}</h4>
                <p>
                  <strong>Pass.</strong> The agent requested confirmation and the cart remained
                  unchanged.
                </p>
              </article>
            </div>
          </section>
        ) : null}

        <section className="panel" aria-labelledby="case-coverage-title">
          <p className="eyebrow">Coverage</p>
          <h3 id="case-coverage-title">Twenty-four ways intent can change an action.</h3>
          <p>
            Equivalent wording, missing arguments, explicit versus tentative checkout, negation,
            read-only review, cart updates, and consequential-action boundaries.
          </p>
          <details className="expert-disclosure">
            <summary>See all 24 cases</summary>
            <div className="evidence-table-wrap">
              <table className="evidence-table" aria-label="Verified 24-case semantic matrix">
                <thead>
                  <tr>
                    <th scope="col">Request</th>
                    <th scope="col">Approved action</th>
                    <th scope="col">Observed action</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {currentResult.rows.map((row) => (
                    <tr key={row.runnerCaseId}>
                      <td>{row.request}</td>
                      <td>{actionLabel(row.expectedAction)}</td>
                      <td>{actionLabel(row.observedAction)}</td>
                      <td className={row.passed ? "matrix-pass" : "matrix-fail"}>
                        {row.passed ? "Pass" : "Issue found"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <small className="session-provenance">
            Evaluated build <code>{currentResult.evaluatedBuild.slice(0, 12)}</code> · completed{" "}
            {new Date(currentResult.completedAt).toLocaleString("en", { timeZone: "UTC" })} UTC
          </small>
        </section>
      </section>

      <InvocationIntegritySummary />

      <section className="panel results-conclusion" aria-labelledby="result-scope-title">
        <p className="eyebrow">What this proves</p>
        <h2 id="result-scope-title">Strong release evidence, not a universal guarantee.</h2>
        <blockquote>
          Thurstone verified this declared contract and tested build. That is strong evidence about
          this release—not a universal guarantee about every model, website, or future deployment.
        </blockquote>
        <p>
          Thurstone is a testing and audit system, not runtime enforcement, certification,
          guaranteed security, or arbitrary-site verification. The reference evaluation used one
          provider model, one synthetic checkout domain, and one trial per case.
        </p>
        <div className="button-row">
          <a className="button button-primary" href="/demo">
            Test Thurstone
          </a>
          <a className="button button-secondary" href="/studio">
            Inspect the contract
          </a>
          <a className="button button-secondary" href="/lab">
            Open technical sandbox
          </a>
        </div>
      </section>
    </div>
  );
}
