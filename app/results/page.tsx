import type { Metadata } from "next";

import { LatestJourney } from "@/components/results/latest-journey";
import { MyTests } from "@/components/results/my-tests";
import { MyTestsV2 } from "@/components/results/my-tests-v2";
import { createOwnerJourneyQaPreview } from "@/lib/demo/owner-journey-preview.server";

export const metadata: Metadata = {
  title: "Demo Results",
  description:
    "Review the requests, expected behavior, agent actions, verified effects, and verdicts from your latest Thurstone Demo test."
};

export default async function ResultsPage({
  searchParams
}: {
  readonly searchParams: Promise<{ readonly qa?: string }>;
}) {
  const qaMode = (await searchParams).qa;
  const qaPreview =
    process.env.NODE_ENV === "development" && (qaMode === "journey" || qaMode === "issue");
  const qaPreviewReport = qaPreview
    ? await createOwnerJourneyQaPreview(qaMode === "issue" ? "issue" : "pass")
    : undefined;

  return (
    <div className="page-shell route-page results-page demo-results-page">
      <header className="route-hero" aria-labelledby="results-title">
        <div>
          <p className="eyebrow">Demo test results</p>
          <h1 id="results-title">Results from your latest Demo run.</h1>
          <p>
            Review every test request, the behavior your contract required, the action the agent
            took, and the site effect Thurstone verified.
          </p>
        </div>
      </header>

      <LatestJourney {...(qaPreviewReport ? { qaPreviewReport } : {})} />
      <MyTestsV2 hideWhenEmpty />
      <MyTests hideWhenEmpty />
    </div>
  );
}
