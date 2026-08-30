import type { Metadata } from "next";

import { InvocationIntegrityClient } from "@/components/invocation-integrity/invocation-integrity-client";
import { StatusPill } from "@/components/status-pill";

export const metadata: Metadata = { title: "Invocation integrity" };

export default function InvocationIntegrityPage() {
  return (
    <div className="page-shell route-page">
      <header className="route-hero">
        <div>
          <p className="eyebrow">Gate 8.5 · provider-free native verification</p>
          <h1>Fixed browser-native calls, checked by a source-fixed verifier.</h1>
          <p>
            This isolated route discovers the same-origin checkout catalog, invokes only the frozen
            II-01 → II-02 → II-03 sequence through WebMCP, and compares the browser observations
            with a fresh server-side replay.
          </p>
        </div>
        <StatusPill state="ready">Outside the Meaning Matrix</StatusPill>
      </header>

      <InvocationIntegrityClient />
    </div>
  );
}
