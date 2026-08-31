export function SandboxPreview() {
  return (
    <section className="demo-mode-panel sandbox-preview" aria-labelledby="sandbox-preview-title">
      <div>
        <p className="eyebrow">Reference checkout environment</p>
        <h2 id="sandbox-preview-title">Use the live checkout sandbox.</h2>
        <p>
          Change the reference cart, invoke live WebMCP tools, test replay and rejected inputs,
          reset, and inspect trusted state.
        </p>
        <div className="sandbox-preview-cart" aria-label="Seeded checkout preview">
          <span>Field notebook × 1</span>
          <span>Stoneware mug × 2</span>
          <strong>$73.00 synthetic total</strong>
        </div>
        <div className="button-row">
          <a className="button button-primary" href="/lab">
            Open sandbox
          </a>
          <a className="button button-secondary" href="/results">
            View verified results
          </a>
        </div>
      </div>
    </section>
  );
}
