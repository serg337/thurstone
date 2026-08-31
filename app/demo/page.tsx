import type { Metadata } from "next";

import { DemoClient } from "@/components/demo/demo-client";
import { StatusPill } from "@/components/status-pill";

export const metadata: Metadata = {
  title: "Demo",
  description:
    "Walk through a verified WebMCP intent boundary, author a reference contract, or open Thurstone’s native sandbox."
};

export default function DemoPage() {
  return (
    <div className="page-shell demo-page">
      <header className="demo-hero" aria-labelledby="demo-title">
        <div>
          <p className="eyebrow">Guided proof · reference checkout environment</p>
          <h1 id="demo-title">
            Test the boundary between what a user said and what a site allows.
          </h1>
          <p>
            Start with a verified sixty-second walkthrough. Then write a bounded contract or use the
            live checkout catalog directly.
          </p>
        </div>
        <div className="demo-readiness" aria-label="Demo availability">
          <StatusPill state="ready">Guided demo ready</StatusPill>
          <StatusPill state="neutral">Native runtime checks in Sandbox</StatusPill>
          <StatusPill state="neutral">Live agent test unavailable</StatusPill>
        </div>
      </header>
      <DemoClient />
    </div>
  );
}
