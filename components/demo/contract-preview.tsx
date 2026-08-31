import type { WorkshopContractV1 } from "@/lib/demo/contract";

export function ContractPreview({
  contract,
  digest
}: {
  readonly contract: WorkshopContractV1;
  readonly digest: string;
}) {
  return (
    <section className="contract-preview" aria-labelledby="contract-preview-title">
      <p className="eyebrow">Compiled contract</p>
      <h3 id="contract-preview-title">Contract ready.</h3>
      <dl>
        <div>
          <dt>Request</dt>
          <dd>{contract.request}</dd>
        </div>
        <div>
          <dt>Expected behavior</dt>
          <dd>
            {contract.expectedDecision.kind === "call"
              ? `Call ${contract.expectedDecision.toolName}`
              : contract.expectedDecision.kind === "clarify"
                ? "Ask for clarification"
                : "Take no action"}
          </dd>
        </div>
        <div>
          <dt>Replay policy</dt>
          <dd>{contract.replayPolicy.replaceAll("_", " ")}</dd>
        </div>
        <div>
          <dt>Trusted state</dt>
          <dd>Thurstone reference checkout ledger</dd>
        </div>
      </dl>
      <details>
        <summary>View canonical contract and digest</summary>
        <code>{digest}</code>
        <pre>{JSON.stringify(contract, null, 2)}</pre>
      </details>
    </section>
  );
}
