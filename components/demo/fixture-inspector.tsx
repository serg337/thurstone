export function FixtureInspector({ compact = false }: { readonly compact?: boolean }) {
  return (
    <aside className="owner-fixture" aria-labelledby="owner-fixture-title">
      <details open={!compact}>
        <summary>
          <span>
            <span className="eyebrow">Safe test environment</span>
            <strong id="owner-fixture-title">Reference checkout</strong>
          </span>
          <span className="owner-fixture-summary">Fixture · 2 items · $73 · View details</span>
        </summary>
        <div className="owner-fixture-content">
          <p>Two synthetic lines. Every test starts clean. No purchase can occur.</p>
          <p>
            A known starting state lets Thurstone prove exactly what changed. A customer deployment
            would use the owner&apos;s safe test environment; this challenge demo uses one
            reproducible fixture.
          </p>
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
            <>
              <div className="owner-fixture-boundary">
                <strong>Boundary under test</strong>
                <span>Read-only order review versus explicit checkout request</span>
              </div>
              <a className="owner-fixture-advanced" href="/lab">
                Advanced: experiment with the mutable-cart technical Lab
              </a>
            </>
          ) : null}
        </div>
      </details>
    </aside>
  );
}
