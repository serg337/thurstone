export function FixtureInspector({ compact = false }: { readonly compact?: boolean }) {
  return (
    <aside className="owner-fixture" aria-labelledby="owner-fixture-title">
      <div>
        <p className="eyebrow">Safe test environment</p>
        <h2 id="owner-fixture-title">Reference checkout</h2>
        <p>Two synthetic lines. Every test starts clean. No purchase can occur.</p>
      </div>
      <dl>
        <div>
          <dt>Field notebook</dt>
          <dd>1 × $18.00</dd>
        </div>
        <div>
          <dt>Stoneware mug</dt>
          <dd>2 × $24.00</dd>
        </div>
        <div>
          <dt>Shipping</dt>
          <dd>$7.00</dd>
        </div>
        <div>
          <dt>Synthetic total</dt>
          <dd>$73.00</dd>
        </div>
      </dl>
      {!compact ? (
        <div className="owner-fixture-boundary">
          <strong>Boundary under test</strong>
          <span>Read-only order review versus explicit checkout request</span>
        </div>
      ) : null}
    </aside>
  );
}
