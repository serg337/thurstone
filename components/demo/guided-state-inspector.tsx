interface TrustedStateProjection {
  readonly fixtureId: string;
  readonly revision: number;
  readonly pendingCheckout: string | null;
  readonly quantities: readonly { readonly itemId: string; readonly quantity: number }[];
}

function StateCard({
  label,
  state
}: {
  readonly label: string;
  readonly state: TrustedStateProjection;
}) {
  return (
    <article>
      <span className="eyebrow">{label}</span>
      <dl>
        <div>
          <dt>Revision</dt>
          <dd>{state.revision}</dd>
        </div>
        <div>
          <dt>Checkout</dt>
          <dd>{state.pendingCheckout ?? "none"}</dd>
        </div>
        {state.quantities.map((line) => (
          <div key={line.itemId}>
            <dt>{line.itemId}</dt>
            <dd>× {line.quantity}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export function GuidedStateInspector({
  before,
  after,
  ledgerDelta
}: {
  readonly before: TrustedStateProjection;
  readonly after: TrustedStateProjection;
  readonly ledgerDelta: number;
}) {
  return (
    <section className="guided-state" aria-label="Trusted state before and after">
      <div className="guided-state-grid">
        <StateCard label="Trusted state before" state={before} />
        <StateCard label="Trusted state after" state={after} />
      </div>
      <p className="guided-ledger-delta">
        Ledger delta <strong>{ledgerDelta}</strong>
      </p>
    </section>
  );
}
