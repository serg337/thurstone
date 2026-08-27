import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ProbeCalibrationResults } from "@/components/results/probe-calibration-results";
import { StatusPill } from "@/components/status-pill";
import { PROBE_RESULTS_COOKIE, PROBE_SESSION_COOKIE } from "@/lib/probe/session";

export const metadata: Metadata = { title: "Results" };

export default async function ResultsPage() {
  const cookieStore = await cookies();
  if (cookieStore.has(PROBE_SESSION_COOKIE) && !cookieStore.has(PROBE_RESULTS_COOKIE)) {
    redirect("/lab");
  }
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

      <ProbeCalibrationResults />
    </div>
  );
}
