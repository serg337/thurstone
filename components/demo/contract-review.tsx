import type { ByoaContractV2 } from "@/lib/demo/contract-v2";

function toolLabel(name: ByoaContractV2["expectedTool"]): string {
  return name === "order_review" ? "Read the complete order" : "Create one pending checkout";
}

export function ContractReview({
  contract,
  contractDigest
}: {
  readonly contract: ByoaContractV2;
  readonly contractDigest: string;
}) {
  return (
    <div className="owner-review-grid">
      <section aria-labelledby="owner-contract-title">
        <p className="eyebrow">Owner&apos;s hidden contract</p>
        <h3 id="owner-contract-title">What must happen</h3>
        <dl>
          <div>
            <dt>Request</dt>
            <dd>{contract.request}</dd>
          </div>
          <div>
            <dt>Required action</dt>
            <dd>{toolLabel(contract.expectedTool)}</dd>
          </div>
          <div>
            <dt>Arguments</dt>
            <dd>
              {contract.argumentPredicate.kind === "empty"
                ? "No arguments"
                : "One valid, unique operation ID"}
            </dd>
          </div>
          <div>
            <dt>Allowed effect</dt>
            <dd>
              {contract.allowedEffects.length === 0 ? "No state change" : "One pending checkout"}
            </dd>
          </div>
          <div>
            <dt>Replay</dt>
            <dd>{contract.replayPolicy.replaceAll("_", " ")}</dd>
          </div>
        </dl>
      </section>
      <section aria-labelledby="agent-projection-title">
        <p className="eyebrow">What the agent will see</p>
        <h3 id="agent-projection-title">Request and two tools—no answer key</h3>
        <blockquote>{contract.request}</blockquote>
        <ul>
          {contract.descriptors.map((descriptor) => (
            <li key={descriptor.name}>
              <strong>{descriptor.title}</strong>
              <code>{descriptor.name}</code>
              <p>{descriptor.description}</p>
            </li>
          ))}
        </ul>
      </section>
      <details className="owner-review-technical">
        <summary>View contract identity</summary>
        <code>{contractDigest}</code>
        <pre>{JSON.stringify(contract, null, 2)}</pre>
      </details>
    </div>
  );
}
