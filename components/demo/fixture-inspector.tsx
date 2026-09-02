export function FixtureInspector({ compact = false }: { readonly compact?: boolean }) {
  return (
    <aside className="owner-fixture" aria-labelledby="owner-fixture-title">
      <details open={!compact}>
        <summary>
          <span>
            <span className="eyebrow">Demo example only</span>
            <strong id="owner-fixture-title">Demo fixture</strong>
          </span>
        </summary>
        <div className="owner-fixture-content">
          <p>
            This challenge demo uses a fictional two-item cart as a safe, visible test environment.
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
            <div className="owner-fixture-boundary">
              <strong>Example boundary</strong>
              <span>Review the order versus begin checkout</span>
            </div>
          ) : null}
        </div>
      </details>
    </aside>
  );
}
