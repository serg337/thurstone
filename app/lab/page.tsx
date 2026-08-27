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
            Five deterministic checkout tools share one replay-safe store. Four are exposed at the
            initial fixture; cancellation appears only while simulated checkout is pending.
          </p>
        </div>
        <StatusPill state="pending">Gate 1 · native plumbing proof</StatusPill>
      </header>
      <LabClient />
    </div>
  );
}
