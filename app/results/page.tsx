import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ProbeCalibrationResults } from "@/components/results/probe-calibration-results";
import { SemanticDevelopmentResults } from "@/components/results/semantic-development-results";
import { SemanticPairedResults } from "@/components/results/semantic-paired-results";
import { StatusPill } from "@/components/status-pill";
import {
  PROBE_RECOVERY_COOKIE,
  PROBE_RESULTS_COOKIE,
  PROBE_SESSION_COOKIE
} from "@/lib/probe/session";
import { readSemanticResults } from "@/lib/results/semantic-results.server";
import { SCORED_RESULTS_COOKIE, SCORED_SESSION_COOKIE } from "@/lib/scored/session.server";

export const metadata: Metadata = { title: "Results" };

export default async function ResultsPage() {
  const cookieStore = await cookies();
  if (cookieStore.has(PROBE_SESSION_COOKIE) && !cookieStore.has(PROBE_RESULTS_COOKIE)) {
    redirect("/lab");
  }
  if (cookieStore.has(SCORED_SESSION_COOKIE) && !cookieStore.has(SCORED_RESULTS_COOKIE)) {
    redirect("/lab");
  }
  const terminalEvidence = cookieStore.has(PROBE_RESULTS_COOKIE);
  const semanticResults = await readSemanticResults().catch(() => ({
    status: "no-scored-run" as const,
    disclosure: "No run yet" as const,
    supersededEvidence: null
  }));
  const scoredAvailable = semanticResults.status !== "no-scored-run";
  return (
    <div className="page-shell route-page">
      <header className="route-hero">
        <div>
          <p className="eyebrow">Results · post-unlock trust surface</p>
          <h1>Evidence appears only after authentic terminal runs.</h1>
          <p>
            The Meaning Matrix is derived from sealed traces—not prefilled labels, screenshots,
            direct expected calls, or hand-edited rows.
          </p>
        </div>
        <StatusPill state={scoredAvailable || terminalEvidence ? "ready" : "neutral"}>
          {semanticResults.status === "paired-comparison"
            ? "Paired reference evidence"
            : scoredAvailable
              ? "Baseline development evidence"
              : terminalEvidence
                ? "Final evidence ready"
                : "No run yet"}
        </StatusPill>
      </header>

      {semanticResults.status === "paired-comparison" ? (
        <SemanticPairedResults results={semanticResults} />
      ) : semanticResults.status === "baseline-development-only" ? (
        <SemanticDevelopmentResults
          baselineRunId={semanticResults.baselineRunId}
          baselineEvidenceDigest={semanticResults.baselineEvidenceDigest}
          rows={semanticResults.rows}
          earned={semanticResults.development.earned}
          holdoutCommitmentDigest={semanticResults.holdout.commitmentDigest}
          supersededEvidence={semanticResults.supersededEvidence}
        />
      ) : (
        <section className="empty-results" aria-label="Scored semantic results status">
          <div>
            <span className="eyebrow">Scored suite</span>
            <h2>No run yet</h2>
            <p>The Meaning Matrix stays empty until authentic frozen scored evidence exists.</p>
            {semanticResults.supersededEvidence ? (
              <div className="runtime-receipt">
                <span>Preserved earlier protocol · not merged</span>
                <strong>{semanticResults.supersededEvidence.predecessorEvidenceDigest}</strong>
                <small>
                  Run {semanticResults.supersededEvidence.predecessorRunId} and Repair{" "}
                  {semanticResults.supersededEvidence.priorRepairReceiptHash} remain permanent while
                  the complete successor baseline is pending.
                </small>
              </div>
            ) : null}
          </div>
        </section>
      )}

      {terminalEvidence || cookieStore.has(PROBE_RECOVERY_COOKIE) ? (
        <ProbeCalibrationResults recoveryAvailable />
      ) : null}
    </div>
  );
}
