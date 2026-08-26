import type { Metadata } from "next";

import { LabClient } from "@/components/lab/lab-client";
import { StatusPill } from "@/components/status-pill";

export const metadata: Metadata = { title: "Lab" };

export default function LabPage() {
  return (
    <div className="page-shell route-page">
      <header className="route-hero">
        <div>
          <p className="eyebrow">Lab · execution trust surface</p>
          <h1>One live tool catalog. No expected answers.</h1>
          <p>
            The initial Gate 0 slice registers one harmless read-only tool. Source, mocks, and
            ordinary function calls remain explicitly separate from supported-runtime proof.
          </p>
        </div>
        <StatusPill state="pending">Native observation pending</StatusPill>
      </header>
      <LabClient />
    </div>
  );
}
