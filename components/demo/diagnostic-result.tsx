import type { ByoaDemoResultV2 } from "@/lib/demo/result-v2";

function releaseText(result: ByoaDemoResultV2): string {
  if (result.diagnostic.releaseGuidance === "case-passed") {
    return "This case passed. Whole-release readiness still requires every required case to pass.";
  }
  if (result.diagnostic.releaseGuidance === "block-recommended") {
    return "Do not release this WebMCP change until this case passes.";
  }
  if (result.diagnostic.releaseGuidance === "review-required") {
    return "Review this mismatch under your release policy.";
  }
  return "No semantic release conclusion is valid from this run. Rerun the unchanged case.";
}

export function DiagnosticResult({ result }: { readonly result: ByoaDemoResultV2 }) {
  const primary = result.diagnostic.findings.find(
    ({ findingId }) => findingId === result.diagnostic.primaryFindingId
  );
  return (
    <section className="diagnostic-result" aria-labelledby="diagnostic-result-title">
      <p className="eyebrow">What Thurstone verified</p>
      <h2 id="diagnostic-result-title">
        {primary?.title ?? "The declared action and trusted effect matched."}
      </h2>
      {primary ? (
        <ul className="diagnostic-facts">
          {primary.facts.map((fact) => (
            <li key={fact.factId}>{fact.message}</li>
          ))}
        </ul>
      ) : (
        <p>
          The native tool, canonical arguments, trusted state, and ledger satisfied every assertion
          measured in this trial.
        </p>
      )}

      <div className="diagnostic-investigation">
        <p className="eyebrow">Where to investigate</p>
        <h3>
          {primary?.hypothesis
            ? "Evidence-backed investigation area"
            : "No mismatch to investigate"}
        </h3>
        <p>
          {primary?.hypothesis?.message ??
            "Save this case and rerun it whenever the catalog, model, browser, or site behavior changes."}
        </p>
      </div>

      {primary ? (
        <div className="diagnostic-next-step">
          <span>Recommended next step</span>
          <strong>{primary.nextStep.instruction}</strong>
          <small>Pass criterion: {primary.nextStep.successCriterion}</small>
        </div>
      ) : null}

      <p className="diagnostic-release-guidance">{releaseText(result)}</p>
      <p className="diagnostic-replay-note">
        <strong>Replay qualification:</strong>{" "}
        {result.contract.replayPolicy === "exactly_once"
          ? "Replay was not measured inside this one-call BYOA trial. Thurstone’s separate Invocation Integrity matrix verifies the reference replay invariant."
          : "This read-only contract requires no mutating replay transition."}
      </p>
      <details>
        <summary>Limitations of this result</summary>
        <ul>
          {result.diagnostic.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
