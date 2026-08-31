import { StatusPill } from "@/components/status-pill";
import integrityArtifact from "@/evidence/thurstone-invocation-integrity.json";

const evidencePackage = integrityArtifact.evidencePackage;
const rows = evidencePackage.verifierReceipt.rows;

function expectedLabel(caseId: string): string {
  if (caseId === "II-01") return "Reject privileged fields; preserve state";
  if (caseId === "II-02") return "Reject nonexistent item; preserve state";
  return "Commit once; treat the duplicate as a no-op";
}

function actualLabel(row: (typeof rows)[number]): string {
  if (row.caseId === "II-03") {
    const replayed = row.actualOutcome[1]?.replayed === true;
    return replayed ? "One commit, then a replayed no-op" : "Replay was not verified";
  }
  return `${row.actualOutcome[0]?.code ?? "unknown result"}; no subscriber commit`;
}

function stateLabel(row: (typeof rows)[number]): string {
  if (row.trustedStateBefore.sha256 === row.trustedStateAfter.sha256) {
    return "None — trusted state unchanged";
  }
  return `Revision ${row.trustedStateBefore.value.revision} → ${row.trustedStateAfter.value.revision}; one pending approval`;
}

export function InvocationIntegritySummary() {
  return (
    <section
      className="panel results-integrity"
      data-results-level="integrity"
      aria-labelledby="integrity-summary-title"
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Invocation Integrity · tested separately</p>
          <h2 id="integrity-summary-title">Three hostile calls. Three preserved invariants.</h2>
        </div>
        <StatusPill state="ready">3/3 integrity cases</StatusPill>
      </div>
      <p>
        Direct WebMCP tests tried forbidden fields, a nonexistent item, and a duplicate request.
        Independent server state and ledger evidence determined each verdict.
      </p>

      <div className="evidence-table-wrap">
        <table
          className="evidence-table integrity-compact-table"
          aria-label="Invocation Integrity Matrix"
        >
          <thead>
            <tr>
              <th scope="col">Case</th>
              <th scope="col">Expected outcome</th>
              <th scope="col">Actual outcome</th>
              <th scope="col">Trusted state change</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.caseId}>
                <td data-label="Case">
                  <strong>{row.caseId}</strong>
                  <small>{row.title}</small>
                </td>
                <td data-label="Expected">{expectedLabel(row.caseId)}</td>
                <td data-label="Actual">{actualLabel(row)}</td>
                <td data-label="Trusted state">{stateLabel(row)}</td>
                <td data-label="Result" className={row.passed ? "matrix-pass" : "matrix-fail"}>
                  {row.passed ? "Pass" : "Fail"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="expert-disclosure">
        <summary>View technical receipt and exports</summary>
        <dl className="expert-receipt-grid">
          <div>
            <dt>Evidence package</dt>
            <dd>{evidencePackage.packageDigest}</dd>
          </div>
          <div>
            <dt>Execution build</dt>
            <dd>{evidencePackage.execution.buildSha}</dd>
          </div>
          <div>
            <dt>Measured</dt>
            <dd>{evidencePackage.execution.measuredAt}</dd>
          </div>
          <div>
            <dt>Model calls</dt>
            <dd>0</dd>
          </div>
        </dl>
        <div className="button-row compact-buttons">
          <a className="button button-secondary" href="/invocation-integrity">
            Open full integrity test
          </a>
        </div>
      </details>
    </section>
  );
}
