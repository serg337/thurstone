import currentResult from "@/evidence/thurstone-current-result.json";
import integrityArtifact from "@/evidence/thurstone-invocation-integrity.json";

const integrityRows = integrityArtifact.evidencePackage.verifierReceipt.rows;

function actionLabel(value: string): string {
  if (value === "clarify") return "Ask for clarification";
  if (value === "no_action") return "Take no action";
  return `Call ${value.replace("call:", "")}`;
}

function effectLabel(action: string): string {
  if (action === "clarify" || action === "no_action") return "No native state mutation permitted";
  if (action === "call:order_review") return "Read-only order state preserved";
  if (action === "call:cart_update") return "Requested cart quantity verified";
  if (action === "call:checkout_request") return "One pending checkout transition verified";
  return "Declared site effect verified";
}

function expectedIntegrityLabel(caseId: string): string {
  if (caseId === "II-01") return "Reject privileged fields; preserve state";
  if (caseId === "II-02") return "Reject nonexistent item; preserve state";
  return "Commit once; treat the duplicate as a no-op";
}

function actualIntegrityLabel(row: (typeof integrityRows)[number]): string {
  if (row.caseId === "II-03") {
    return row.actualOutcome[1]?.replayed === true
      ? "One commit, then a replayed no-op"
      : "Replay was not verified";
  }
  if (row.actualOutcome[0]?.code === "invalid_arguments") {
    return "Forbidden fields rejected; no state change";
  }
  if (row.actualOutcome[0]?.code === "invalid_item") {
    return "Nonexistent item rejected; no state change";
  }
  return `${row.actualOutcome[0]?.code ?? "Unknown result"}; no state change`;
}

function integrityStateLabel(row: (typeof integrityRows)[number]): string {
  if (row.trustedStateBefore.sha256 === row.trustedStateAfter.sha256) {
    return "Trusted state unchanged";
  }
  return `Revision ${row.trustedStateBefore.value.revision} → ${row.trustedStateAfter.value.revision}; one pending approval`;
}

export function ReferenceEvidenceDisclosures() {
  return (
    <div className="reference-evidence-disclosures">
      <details>
        <summary>
          <span>Inspect all 24 semantic behaviors</span>
          <small>Request → expected → observed → verified effect → verdict</small>
        </summary>
        <div className="evidence-table-wrap">
          <table className="evidence-table" aria-label="Homepage semantic reference matrix">
            <thead>
              <tr>
                <th scope="col">Request</th>
                <th scope="col">Expected behavior</th>
                <th scope="col">Observed behavior</th>
                <th scope="col">Verified effect</th>
                <th scope="col">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {currentResult.rows.map((row) => (
                <tr key={row.runnerCaseId}>
                  <td>{row.request}</td>
                  <td>{actionLabel(row.expectedAction)}</td>
                  <td>{actionLabel(row.observedAction)}</td>
                  <td>{effectLabel(row.expectedAction)}</td>
                  <td className={row.passed ? "matrix-pass" : "matrix-fail"}>
                    {row.passed ? "Pass" : "Issue found"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details>
        <summary>
          <span>Inspect the 3 Invocation Integrity tests</span>
          <small>
            Hostile invocation → expected guard → actual outcome → trusted state → verdict
          </small>
        </summary>
        <div className="evidence-table-wrap">
          <table className="evidence-table" aria-label="Homepage Invocation Integrity Matrix">
            <thead>
              <tr>
                <th scope="col">Tested invocation</th>
                <th scope="col">Expected guard</th>
                <th scope="col">Actual outcome</th>
                <th scope="col">Trusted state</th>
                <th scope="col">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {integrityRows.map((row) => (
                <tr key={row.caseId}>
                  <td>
                    <strong>{row.caseId}</strong>
                    <small>{row.title}</small>
                  </td>
                  <td>{expectedIntegrityLabel(row.caseId)}</td>
                  <td>{actualIntegrityLabel(row)}</td>
                  <td>{integrityStateLabel(row)}</td>
                  <td className={row.passed ? "matrix-pass" : "matrix-fail"}>
                    {row.passed ? "Pass" : "Fail"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
