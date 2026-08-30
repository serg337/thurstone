import type { Metadata } from "next";

import { InvocationIntegrityClient } from "@/components/invocation-integrity/invocation-integrity-client";
import { StatusPill } from "@/components/status-pill";

export const metadata: Metadata = { title: "Invocation integrity" };

export default function InvocationIntegrityPage() {
  return (
    <div className="page-shell route-page">
      <header className="route-hero">
        <div>
          <p className="eyebrow">Three tested invocation invariants</p>
          <h1>Hostile direct calls must preserve site-defined boundaries.</h1>
          <p>
            Privileged fields reject, nonexistent items do nothing, and replay commits once. Trusted
            state comes from a source-fixed server replay.
          </p>
          <p>
            Scope: three frozen synthetic checkout cases on the exact tested build. Thurstone is a
            testing/audit system—not runtime enforcement, certification, guaranteed security, or
            arbitrary-site verification.
          </p>
          <p>
            Open this route in the official ChatGPT in-app browser. In Chrome 149+, open{" "}
            <code>chrome://flags/#enable-webmcp-testing</code>, choose Enabled, and relaunch Chrome.
          </p>
          <p>
            If Thurstone reports <code>consumer-mismatch</code>, close other same-origin Thurstone
            tabs, then reload this tab.
          </p>
          <a className="button button-secondary" href="/results">
            WebMCP unavailable? Inspect sealed Results
          </a>
        </div>
        <StatusPill state="ready">Separate 3/3 · no model calls</StatusPill>
      </header>

      <InvocationIntegrityClient />
    </div>
  );
}
