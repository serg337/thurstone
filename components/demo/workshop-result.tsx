import { VerdictCard } from "@/components/ui/verdict-card";
import type { ThurstoneDemoResultV1 } from "@/lib/demo/result";

const sourceLabels: Readonly<Record<ThurstoneDemoResultV1["source"], string>> = Object.freeze({
  contract_validation: "Contract validation",
  native_direct: "Live native invocation",
  live_agent: "Live agent decision",
  verified_replay: "Verified reference replay"
});

export function WorkshopResult({ result }: { readonly result: ThurstoneDemoResultV1 }) {
  return (
    <section className="workshop-result" aria-labelledby="workshop-result-title">
      <VerdictCard
        verdict={result.verdict}
        title={result.verdict === "pass" ? "Contract passed." : "Contract mismatch found."}
      >
        <p id="workshop-result-title">
          <strong>{sourceLabels[result.source]}.</strong>{" "}
          {result.source === "contract_validation"
            ? "The contract is coherent; no agent decision or native call occurred."
            : "The native call and trusted state were checked against the contract."}
        </p>
        <ul className="workshop-result-assertions" aria-label="Workshop result assertions">
          {result.assertions.map((assertion) => (
            <li key={assertion.label} data-passed={assertion.passed}>
              <span aria-hidden="true">{assertion.passed ? "✓" : "×"}</span>
              <div>
                <strong>{assertion.label}</strong>
                <small>{assertion.detail}</small>
              </div>
            </li>
          ))}
        </ul>
      </VerdictCard>
      <div className="workshop-result-state" aria-label="Workshop trusted state result">
        <article>
          <span>Before</span>
          <strong>Revision {result.trustedStateBefore.revision}</strong>
          <small>{result.trustedStateBefore.pendingCheckout ?? "no pending checkout"}</small>
        </article>
        <article>
          <span>After</span>
          <strong>Revision {result.trustedStateAfter.revision}</strong>
          <small>{result.trustedStateAfter.pendingCheckout ?? "no pending checkout"}</small>
        </article>
        <article>
          <span>Ledger</span>
          <strong>{result.ledgerDiff.eventCount} event(s)</strong>
          <small>
            {result.ledgerDiff.replayObserved ? "replay observed" : "no replay required"}
          </small>
        </article>
      </div>
      <details>
        <summary>View complete synthetic result</summary>
        <pre>{JSON.stringify(result, null, 2)}</pre>
      </details>
    </section>
  );
}
