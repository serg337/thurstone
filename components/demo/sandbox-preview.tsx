import { StatusPill } from "@/components/status-pill";

export function SandboxPreview() {
  return (
    <section className="demo-mode-panel sandbox-preview" aria-labelledby="sandbox-preview-title">
      <div>
        <p className="eyebrow">Reference checkout environment</p>
        <h2 id="sandbox-preview-title">Open the complete native WebMCP sandbox.</h2>
        <p>
          Read the cart, review the order, change quantities, request simulated checkout, test
          replay, reject hostile inputs, reset the fixture, and inspect native receipts.
        </p>
        <div className="sandbox-preview-cart" aria-label="Seeded checkout preview">
          <span>Field notebook × 1</span>
          <span>Stoneware mug × 2</span>
          <strong>$73.00 including simulated shipping</strong>
        </div>
        <div className="button-row">
          <a className="button button-primary" href="/lab">
            Open full technical sandbox
          </a>
          <a className="button button-secondary" href="/results">
            View verified results
          </a>
        </div>
      </div>
      <StatusPill state="neutral">Runtime checks after opening</StatusPill>
    </section>
  );
}
