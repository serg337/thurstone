import type { Metadata } from "next";

import { InvocationIntegrityClient } from "@/components/invocation-integrity/invocation-integrity-client";
import { StatusPill } from "@/components/status-pill";

export const metadata: Metadata = { title: "Invocation integrity" };

export default function InvocationIntegrityPage() {
  return (
    <div className="page-shell route-page">
      <header className="route-hero">
        <div>
          <p className="eyebrow">Three hostile-invocation tests</p>
          <h1>Test whether hostile WebMCP calls preserve site rules.</h1>
          <p>
            Thurstone directly tests forbidden fields, a nonexistent item, and a replayed checkout
            request—then verifies the outcome against independent server state.
          </p>
          <p>
            These three synthetic cases audit the tested build. They are not runtime enforcement,
            certification, or a universal security guarantee.
          </p>
          <details className="expert-disclosure route-setup">
            <summary>Native browser setup</summary>
            <p>
              Use the official ChatGPT in-app browser. In Chrome 149+, enable{" "}
              <code>chrome://flags/#enable-webmcp-testing</code> and relaunch. If discovery reports
              a mismatch, close other Thurstone tabs and reload this one.
            </p>
          </details>
          <a className="button button-secondary" href="/results">
            View verified integrity results
          </a>
        </div>
        <StatusPill state="ready">3/3 tested · no model calls</StatusPill>
      </header>

      <InvocationIntegrityClient />
    </div>
  );
}
