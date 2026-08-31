import type { Metadata } from "next";

import { StatusPill } from "@/components/status-pill";
import currentResult from "@/evidence/thurstone-current-result.json";

export const metadata: Metadata = { title: "Results" };

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
    <div className="page-shell route-page">
      <header className="route-hero" aria-labelledby="current-results-title">
        <div>
          <p className="eyebrow">Current verified run</p>
          <h1 id="current-results-title">Every approved behavior passed.</h1>
          <p>
            Thurstone sent 24 different checkout requests through the live WebMCP catalog, then
            compared the agent&apos;s decision and the resulting page state with the human-approved
            contract.
          </p>
          <div className="button-row">
            <a className="button button-primary" href="/lab">
              Try the live sandbox
            </a>
            <a className="button button-secondary" href="/studio">
              See the example contract
            </a>
          </div>
        </div>
        <StatusPill state="ready">Verified</StatusPill>
      </header>

      <section className="panel" aria-labelledby="result-score-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">What Thurstone checked</p>
            <h2 id="result-score-title">Intent, tool choice, arguments, and real page effects.</h2>
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
          <h2 id="clarification-result-title">
            Uncertainty did not become an unintended checkout.
          </h2>
          <div className="trace-inspector-grid impact-boundary-grid">
            <article>
              <span className="eyebrow">The request</span>
              <h3>{uncertainCheckout.request}</h3>
            </article>
            <article>
              <span className="eyebrow">The approved behavior</span>
              <h3>{actionLabel(uncertainCheckout.expectedAction)}</h3>
              <p>No checkout request and no page mutation were permitted.</p>
            </article>
            <article>
              <span className="eyebrow">What happened</span>
              <h3>{actionLabel(uncertainCheckout.observedAction)}</h3>
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
        <h2 id="case-coverage-title">Twenty-four ways intent can change an action.</h2>
        <p>
          The run covers equivalent wording, missing arguments, explicit versus tentative checkout,
          negation, read-only review, cart updates, and consequential-action boundaries.
        </p>
        <details>
          <summary>See the 24 case outcomes</summary>
          <div className="evidence-table-wrap">
            <table className="evidence-table">
              <thead>
                <tr>
                  <th scope="col">Request</th>
                  <th scope="col">Approved</th>
                  <th scope="col">Observed</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {currentResult.rows.map((row) => (
                  <tr key={row.runnerCaseId}>
                    <td>{row.request}</td>
                    <td>{actionLabel(row.expectedAction)}</td>
                    <td>{actionLabel(row.observedAction)}</td>
                    <td>{row.passed ? "Pass" : "Issue found"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className="panel" aria-labelledby="result-scope-title">
        <p className="eyebrow">Scope</p>
        <h2 id="result-scope-title">A real product check, not a universal guarantee.</h2>
        <p>
          This run used one provider model, one synthetic checkout domain, and one trial per case.
          Thurstone verifies the declared contract and observed effects of this tested WebMCP build;
          it is not security certification or proof about arbitrary websites.
        </p>
        <small>
          Evaluated build <code>{currentResult.evaluatedBuild.slice(0, 12)}</code> · completed{" "}
          {new Date(currentResult.completedAt).toLocaleString("en", { timeZone: "UTC" })} UTC
        </small>
      </section>
    </div>
  );
}
