import { StatusPill } from "@/components/status-pill";
import {
  INVOCATION_INTEGRITY_LIMITATIONS,
  INVOCATION_INTEGRITY_PENDING_ROWS,
  INVOCATION_INTEGRITY_SEMANTIC_RECORD,
  type InvocationIntegrityResultsState
} from "@/lib/results/invocation-integrity-evidence";

function compact(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function InvocationIntegrityResults({
  results
}: {
  readonly results: InvocationIntegrityResultsState;
}) {
  const complete = results.status === "complete";
  const failed = results.status === "failed";
  const terminal = complete || failed;
  const invalid = results.status === "invalid";
  const rows = complete
    ? results.evidencePackage.verifierReceipt.rows
    : failed
      ? results.evidencePackage.rows
      : INVOCATION_INTEGRITY_PENDING_ROWS;
  const earned = terminal ? results.evidencePackage.summary.earned : null;
  const limitations = terminal
    ? results.evidencePackage.limitations
    : INVOCATION_INTEGRITY_LIMITATIONS;
  const failureReceipt = failed ? results.evidencePackage.verifierFailureReceipt : null;

  return (
    <section
      className="panel invocation-integrity-results"
      aria-labelledby="invocation-integrity-title"
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Gate 8.5 · separate supplemental evidence</span>
          <h2 id="invocation-integrity-title">Invocation Integrity Matrix</h2>
        </div>
        <StatusPill state={complete ? "ready" : failed || invalid ? "blocked" : "pending"}>
          {complete
            ? `${earned}/3`
            : failed
              ? `${earned}/3 · failed`
              : invalid
                ? "Evidence invalid"
                : "Evidence pending"}
        </StatusPill>
      </div>

      <p>
        Three frozen cases and four deterministic calls exercise the deployed WebMCP
        discovery/execution adapter. Trusted outcomes come from the independent source-fixed server
        replay, not solely from tool responses. This score is never combined with semantic accuracy.
      </p>

      <div className="invocation-integrity-summary" aria-label="Invocation Integrity accounting">
        <div>
          <strong>{terminal ? `${earned}/3` : "Pending / 3"}</strong>
          <span>Invocation Integrity · separate denominator</span>
        </div>
        <div>
          <strong>0</strong>
          <span>Model calls · deterministic direct execution</span>
        </div>
        <div>
          <strong>
            {INVOCATION_INTEGRITY_SEMANTIC_RECORD.baselineEarned}/24 →{" "}
            {INVOCATION_INTEGRITY_SEMANTIC_RECORD.revisedEarned}/24
          </strong>
          <span>Meaning Matrix preserved · no measured improvement</span>
        </div>
      </div>

      {invalid ? (
        <div className="runtime-receipt invocation-integrity-blocked" role="alert">
          <span>Supplemental evidence rejected</span>
          <strong>Validation failed; no score is published.</strong>
          <small>
            The frozen contract and pending rows remain visible without measured claims.
          </small>
        </div>
      ) : null}

      {failed ? (
        <div className="runtime-receipt invocation-integrity-blocked" role="alert">
          <span>Measured terminal failure · preserved supplemental evidence</span>
          <strong>
            {results.evidencePackage.summary.earned}/{results.evidencePackage.summary.possible} ·
            success claim forbidden
          </strong>
          <small>
            This run is terminal, downloadable, and distinct from pending or complete 3/3 evidence.
          </small>
        </div>
      ) : null}

      <div
        className="matrix-table invocation-integrity-matrix"
        role="table"
        aria-label="Invocation Integrity Matrix"
      >
        <div className="matrix-row matrix-header" role="row">
          <span role="columnheader">Case</span>
          <span role="columnheader">Exact invocation</span>
          <span role="columnheader">Expected outcome</span>
          <span role="columnheader">Measured outcome</span>
        </div>
        {rows.map((row) => {
          const measured = "passed" in row ? row : null;
          const measuredFailure = "outcome" in row ? row : null;
          const exactArguments =
            "exactInvocations" in row ? row.exactInvocations : row.exactArguments;
          const expectedOutcome = row.expectedOutcome;
          const failureOutcome = measuredFailure
            ? measuredFailure.outcome === "pass"
              ? "Pass"
              : measuredFailure.outcome === "fail"
                ? "Fail"
                : "Not reached"
            : null;
          const outcome = measured ? (measured.passed ? "Pass" : "Fail") : failureOutcome;
          return (
            <div className="matrix-row" role="row" key={row.caseId}>
              <span role="cell">
                <strong>{row.caseId}</strong>
                <small>{row.title}</small>
              </span>
              <span role="cell">
                <strong>{row.toolName}</strong>
                <small>
                  {exactArguments.length} {exactArguments.length === 1 ? "call" : "calls"}
                </small>
                <details>
                  <summary>Inspect invocation</summary>
                  <pre tabIndex={0} aria-label={`${row.caseId} exact invocation`}>
                    {compact(exactArguments)}
                  </pre>
                </details>
              </span>
              <span role="cell">
                <strong>
                  {row.caseId === "II-03" ? "One transition; replay no-op" : "Rejection/no-op"}
                </strong>
                <details>
                  <summary>Inspect expectation</summary>
                  <pre tabIndex={0} aria-label={`${row.caseId} expected outcome`}>
                    {compact(expectedOutcome)}
                  </pre>
                </details>
              </span>
              <span
                role="cell"
                className={
                  outcome === "Pass"
                    ? "matrix-pass"
                    : outcome === "Fail"
                      ? "matrix-fail"
                      : undefined
                }
              >
                <strong>{outcome ?? "Pending"}</strong>
                {measured ? (
                  <>
                    <small>
                      Build {measured.buildSha} · {measured.timestamp}
                    </small>
                    <details>
                      <summary>Inspect measured evidence</summary>
                      <div className="invocation-integrity-detail-grid">
                        <div>
                          <h4>Actual outcome</h4>
                          <pre tabIndex={0} aria-label={`${row.caseId} actual outcome`}>
                            {compact(measured.actualOutcome)}
                          </pre>
                        </div>
                        <div>
                          <h4>Trusted state</h4>
                          <pre tabIndex={0} aria-label={`${row.caseId} trusted state`}>
                            {compact({
                              before: measured.trustedStateBefore,
                              after: measured.trustedStateAfter
                            })}
                          </pre>
                        </div>
                        <div>
                          <h4>Ledger diff</h4>
                          <pre tabIndex={0} aria-label={`${row.caseId} ledger diff`}>
                            {compact({
                              domainOperationLedger: measured.domainOperationLedgerDiff,
                              tombstones: measured.tombstoneDiff,
                              auditTrace: measured.auditTraceDiff,
                              subscriberCommitCount: measured.subscriberCommitCount
                            })}
                          </pre>
                        </div>
                        <div>
                          <h4>Assertions</h4>
                          <pre tabIndex={0} aria-label={`${row.caseId} assertions`}>
                            {compact(measured.assertions)}
                          </pre>
                        </div>
                      </div>
                    </details>
                  </>
                ) : measuredFailure && failureReceipt ? (
                  <>
                    <small>
                      Build {failureReceipt.buildSha} · {failureReceipt.failedAt}
                    </small>
                    <details>
                      <summary>Inspect measured failure evidence</summary>
                      <div className="invocation-integrity-detail-grid">
                        <div>
                          <h4>Completed native calls</h4>
                          <pre tabIndex={0} aria-label={`${row.caseId} completed failure calls`}>
                            {compact(measuredFailure.observedCalls)}
                          </pre>
                        </div>
                        <div>
                          <h4>Actual outcome</h4>
                          <pre tabIndex={0} aria-label={`${row.caseId} failure actual outcome`}>
                            {compact(measuredFailure.actualOutcome)}
                          </pre>
                        </div>
                        <div>
                          <h4>Trusted state and ledger evidence</h4>
                          <pre tabIndex={0} aria-label={`${row.caseId} failure trusted evidence`}>
                            {compact({
                              trustedState: measuredFailure.trustedState,
                              ledgerEvidence: measuredFailure.ledgerEvidence,
                              assertions: measuredFailure.assertions
                            })}
                          </pre>
                        </div>
                        {failureOutcome === "Fail" ? (
                          <div>
                            <h4>Terminal error</h4>
                            <pre tabIndex={0} aria-label={`${row.caseId} terminal error`}>
                              {compact(failureReceipt.error)}
                            </pre>
                          </div>
                        ) : null}
                      </div>
                    </details>
                  </>
                ) : (
                  <small>No measured production receipt is embedded.</small>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {terminal ? (
        <section className="gate6-section" aria-labelledby="invocation-integrity-browser-title">
          <span className="eyebrow">Measured browser evidence · retained in full</span>
          <h3 id="invocation-integrity-browser-title">
            Descriptors, preflight, compatibility/reset, and native traces
          </h3>
          <details>
            <summary>Inspect complete measured browser evidence</summary>
            <pre tabIndex={0} aria-label="Complete Invocation Integrity browser evidence">
              {compact(
                complete
                  ? results.evidencePackage.verifierReceipt.measuredTranscript
                  : results.evidencePackage.verifierFailureReceipt
              )}
            </pre>
          </details>
        </section>
      ) : null}

      {terminal ? (
        <div className="runtime-receipt invocation-integrity-provenance">
          <span>Supplemental immutable evidence · external release binding</span>
          <strong>{results.evidencePackage.packageDigest}</strong>
          <small>
            Execution {results.evidencePackage.execution.buildSha} · release{" "}
            {results.releaseBinding.releaseSha} · binding {results.releaseBinding.bindingDigest}
          </small>
        </div>
      ) : null}

      {complete && results.evidencePackage.position ? (
        <blockquote className="invocation-integrity-position">
          <strong>{results.evidencePackage.position}</strong>
        </blockquote>
      ) : null}

      <section className="gate6-section" aria-labelledby="invocation-integrity-export-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Separate supplemental artifact</span>
            <h3 id="invocation-integrity-export-title">Exports and limitations</h3>
          </div>
          <div className="button-row compact-buttons">
            {terminal ? (
              <>
                <a
                  className="button button-secondary"
                  href="/api/evidence/invocation-integrity"
                  download
                >
                  Download Invocation Integrity JSON
                </a>
                <a
                  className="button button-secondary"
                  href="/api/evidence/invocation-integrity/markdown"
                  download
                >
                  Download Invocation Integrity Markdown
                </a>
              </>
            ) : (
              <>
                <button type="button" className="button button-secondary" disabled>
                  Download Invocation Integrity JSON
                </button>
                <button type="button" className="button button-secondary" disabled>
                  Download Invocation Integrity Markdown
                </button>
              </>
            )}
          </div>
        </div>
        {terminal ? (
          <p className="export-hashes">
            JSON <code>{results.evidenceExports.jsonSha256}</code> · Markdown{" "}
            <code>{results.evidenceExports.markdownSha256}</code> · package{" "}
            <code>{results.evidencePackage.packageDigest}</code>
          </p>
        ) : (
          <p className="export-hashes">Downloads unlock only after strict evidence validation.</p>
        )}
        <ul className="limitations-list">
          {limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </section>
    </section>
  );
}
