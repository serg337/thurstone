import type { Metadata } from "next";

import { StatusPill } from "@/components/status-pill";

export const metadata: Metadata = { title: "Results" };

export default function ResultsPage() {
  return (
    <div className="page-shell route-page">
      <header className="route-hero">
        <div>
          <p className="eyebrow">Results · post-unlock trust surface</p>
          <h1>Evidence appears only after authentic terminal runs.</h1>
          <p>
            The Meaning Matrix will be derived from sealed traces—not prefilled labels, screenshots,
            direct expected calls, or hand-edited rows.
          </p>
        </div>
        <StatusPill state="neutral">No run yet</StatusPill>
      </header>

      <section className="empty-results" aria-labelledby="empty-results-title">
        <div className="empty-glyph" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div>
          <h2 id="empty-results-title">No authentic evidence is available.</h2>
          <p>
            Gate 0 is still establishing native runtime proof. Calibration, scored baseline,
            revision, and exports remain unavailable until their required approvals and terminal
            receipts exist.
          </p>
        </div>
      </section>
    </div>
  );
}
