import type { Metadata } from "next";
import semanticReferenceArtifact from "@/evidence/toolproof-reference-evidence.json";
import invocationIntegrityArtifact from "@/evidence/thurstone-invocation-integrity.json";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ProbeCalibrationResults } from "@/components/results/probe-calibration-results";
import { InvocationIntegrityResults } from "@/components/results/invocation-integrity-results";
import { SemanticDevelopmentResults } from "@/components/results/semantic-development-results";
import {
  PairedResultsToolBridge,
  SemanticPairedResults
} from "@/components/results/semantic-paired-results";
import { StatusPill } from "@/components/status-pill";
import {
  PROBE_RECOVERY_COOKIE,
  PROBE_RESULTS_COOKIE,
  PROBE_SESSION_COOKIE
} from "@/lib/probe/session";
import {
  createGate6EvidenceExports,
  type Gate6EvidencePackage
} from "@/lib/results/evidence-package";
import { readInvocationIntegrityResults } from "@/lib/results/invocation-integrity-results.server";
import {
  readSemanticResults,
  type SemanticResultsState
} from "@/lib/results/semantic-results.server";
import { SCORED_RESULTS_COOKIE, SCORED_SESSION_COOKIE } from "@/lib/scored/session.server";

export const metadata: Metadata = { title: "Results" };

// thurstone-impact-execution:artifact-summary
function createImpactExecutionResultsSummary(
  semantic: typeof semanticReferenceArtifact,
  integrity: typeof invocationIntegrityArtifact
) {
  const residual = semantic.records.find(
    (record) => record.version === "revised" && !record.passed
  );
  const baselineTentative = semantic.records.find(
    (record) =>
      record.version === "baseline" &&
      record.relationship.kind === "matched_boundary" &&
      record.relationship.id === "pair_commitment_holdout" &&
      record.relationship.side === "anchor"
  );
  const tentative = semantic.records.find(
    (record) =>
      record.version === "revised" &&
      record.relationship.kind === "matched_boundary" &&
      record.relationship.id === "pair_commitment_holdout" &&
      record.relationship.side === "anchor"
  );
  const explicit = semantic.records.find(
    (record) =>
      record.version === "revised" &&
      record.relationship.kind === "matched_boundary" &&
      record.relationship.id === "pair_commitment_holdout" &&
      record.relationship.side === "contrast"
  );
  if (
    !residual ||
    !baselineTentative ||
    !tentative ||
    !explicit ||
    residual.caseId !== tentative.caseId ||
    baselineTentative.caseId !== tentative.caseId ||
    baselineTentative.request !== tentative.request ||
    baselineTentative.expectedAction !== "clarify" ||
    baselineTentative.observedAction !== "no_action" ||
    baselineTentative.passed ||
    baselineTentative.failureCodes.length !== 1 ||
    baselineTentative.failureCodes[0] !== "decision_action_class" ||
    baselineTentative.execution.canonicalArguments !== null ||
    baselineTentative.execution.stateBefore.revision !== 0 ||
    baselineTentative.execution.stateAfter.revision !== 0 ||
    baselineTentative.execution.stateBefore.pendingCheckout !== null ||
    baselineTentative.execution.stateAfter.pendingCheckout !== null ||
    baselineTentative.execution.effect.stateChanged ||
    baselineTentative.execution.effect.quantities.some((quantity) => quantity.changed) ||
    baselineTentative.execution.effect.unmodeledStateChanged ||
    baselineTentative.execution.traceStatus !== null ||
    tentative.expectedAction !== "clarify" ||
    tentative.observedAction !== "no_action" ||
    tentative.passed ||
    tentative.failureCodes.length !== 1 ||
    tentative.failureCodes[0] !== "decision_action_class" ||
    tentative.execution.canonicalArguments !== null ||
    tentative.execution.stateBefore.revision !== 0 ||
    tentative.execution.stateAfter.revision !== 0 ||
    tentative.execution.stateBefore.pendingCheckout !== null ||
    tentative.execution.stateAfter.pendingCheckout !== null ||
    tentative.execution.effect.stateChanged ||
    tentative.execution.effect.quantities.some((quantity) => quantity.changed) ||
    tentative.execution.effect.unmodeledStateChanged ||
    tentative.execution.traceStatus !== null ||
    explicit.expectedAction !== "call:checkout_request" ||
    explicit.observedAction !== "call:checkout_request" ||
    explicit.execution.canonicalArguments === null ||
    explicit.execution.stateBefore.revision !== 0 ||
    explicit.execution.stateAfter.revision !== 1 ||
    explicit.execution.stateBefore.pendingCheckout !== null ||
    explicit.execution.stateAfter.pendingCheckout?.status !== "pending_human_approval" ||
    !explicit.execution.effect.stateChanged ||
    explicit.execution.effect.quantities.some((quantity) => quantity.changed) ||
    explicit.execution.effect.unmodeledStateChanged ||
    explicit.execution.traceStatus !== "completed" ||
    typeof explicit.execution.traceEventId !== "string" ||
    explicit.execution.traceEventId.length === 0 ||
    semantic.summary.baselinePassed !== 23 ||
    semantic.summary.revisedPassed !== 23 ||
    semantic.summary.possible !== 24 ||
    integrity.evidencePackage.packageDigest !== integrity.packageDigest
  ) {
    throw new Error("impact_execution_summary_artifact_invalid");
  }
  return Object.freeze({
    semantic: Object.freeze({
      packageDigest: semantic.packageDigest,
      summary: semantic.summary,
      metrics: semantic.metrics,
      residual: Object.freeze({
        caseId: residual.caseId,
        request: residual.request,
        expectedAction: residual.expectedAction,
        observedAction: residual.observedAction,
        failureCodes: residual.failureCodes
      }),
      boundary: Object.freeze({
        tentative: Object.freeze({
          request: tentative.request,
          expectedAction: tentative.expectedAction,
          observedAction: tentative.observedAction,
          canonicalArguments: tentative.execution.canonicalArguments,
          lifecycle: tentative.execution.traceStatus,
          stateBefore: Object.freeze({
            revision: tentative.execution.stateBefore.revision,
            pendingCheckoutStatus: "none"
          }),
          stateAfter: Object.freeze({
            revision: tentative.execution.stateAfter.revision,
            pendingCheckoutStatus: "none"
          }),
          effect: Object.freeze({
            stateChanged: tentative.execution.effect.stateChanged,
            quantityChangeCount: tentative.execution.effect.quantities.filter(
              (quantity) => quantity.changed
            ).length,
            unmodeledStateChanged: tentative.execution.effect.unmodeledStateChanged
          }),
          descriptionComparison: Object.freeze({
            baseline: Object.freeze({
              observedAction: baselineTentative.observedAction,
              passed: baselineTentative.passed
            }),
            revised: Object.freeze({
              observedAction: tentative.observedAction,
              passed: tentative.passed
            })
          }),
          failureCode: tentative.failureCodes[0]
        }),
        explicit: Object.freeze({
          request: explicit.request,
          expectedAction: explicit.expectedAction,
          observedAction: explicit.observedAction,
          canonicalArguments: explicit.execution.canonicalArguments,
          lifecycle: explicit.execution.traceStatus,
          stateBefore: Object.freeze({
            revision: explicit.execution.stateBefore.revision,
            pendingCheckoutStatus: "none"
          }),
          stateAfter: Object.freeze({
            revision: explicit.execution.stateAfter.revision,
            pendingCheckoutStatus:
              explicit.execution.stateAfter.pendingCheckout?.status ?? "invalid"
          }),
          effect: Object.freeze({
            stateChanged: explicit.execution.effect.stateChanged,
            quantityChangeCount: explicit.execution.effect.quantities.filter(
              (quantity) => quantity.changed
            ).length,
            unmodeledStateChanged: explicit.execution.effect.unmodeledStateChanged
          }),
          traceEventId: explicit.execution.traceEventId,
          liveCatalog: explicit.liveCatalog,
          runtime: explicit.runtime
        })
      }),
      limitations: semantic.limitations
    }),
    integrity: Object.freeze({
      packageDigest: integrity.packageDigest,
      score: integrity.score,
      modelCallCount: integrity.modelCallCount,
      includedInSemanticDenominator: integrity.includedInSemanticDenominator,
      limitations: integrity.evidencePackage.limitations
    })
  });
}

type PairedSemanticResults = Extract<SemanticResultsState, { status: "paired-comparison" }>;
type NonEmptySemanticResults = Exclude<SemanticResultsState, { status: "no-scored-run" }>;

async function createImpactExecutionReferenceResults(): Promise<PairedSemanticResults> {
  const evidencePackage = semanticReferenceArtifact as unknown as Gate6EvidencePackage;
  const baselineByCase = new Map(
    evidencePackage.records
      .filter((record) => record.version === "baseline")
      .map((record) => [record.caseId, record])
  );
  const revised = evidencePackage.records.filter((record) => record.version === "revised");
  const rows = revised.map((record) => {
    const baseline = baselineByCase.get(record.caseId);
    if (!baseline || baseline.request !== record.request || baseline.subset !== record.subset) {
      throw new Error("impact_execution_reference_pair_invalid");
    }
    return Object.freeze({
      caseId: record.caseId,
      runnerCaseId: record.runnerCaseId,
      subset: record.subset,
      family: record.family,
      request: record.request,
      expectedAction: record.expectedAction,
      baselineObservedAction: baseline.observedAction,
      revisedObservedAction: record.observedAction,
      baselinePassed: baseline.passed,
      revisedPassed: record.passed
    });
  });
  if (
    baselineByCase.size !== 24 ||
    rows.length !== 24 ||
    evidencePackage.packageDigest !==
      "a449db4b1faacdbaab58777923d2ddbde75396b70fa4744b29d0eb8e97089a46"
  ) {
    throw new Error("impact_execution_reference_package_invalid");
  }
  const evidenceExports = await createGate6EvidenceExports(evidencePackage);
  if (
    evidenceExports.jsonSha256 !==
      "fb272a4a68d9c1d3d4542a668b86b23f293cd55e714c1b826af32c7fcac0be26" ||
    evidenceExports.markdownSha256 !==
      "8301efa790f193060296d68a78b0553cf30d0c207b15864cf13609c65f2931fa"
  ) {
    throw new Error("impact_execution_reference_export_invalid");
  }
  const development = rows.filter((row) => row.subset === "development");
  const holdout = rows.filter((row) => row.subset === "builder-blinded-holdout");
  return Object.freeze({
    status: "paired-comparison" as const,
    disclosure: "one-trial demonstration snapshot" as const,
    baselineRunId: evidencePackage.provenance.baselineRunId,
    baselineEvidenceDigest: evidencePackage.provenance.baselineEvidenceDigest,
    revisedRunId: evidencePackage.provenance.revisedRunId,
    revisedEvidenceDigest: evidencePackage.provenance.revisedEvidenceDigest,
    revisionFreezeHash: evidencePackage.provenance.revisionFreezeHash,
    supersededEvidence: null,
    rows: Object.freeze(rows),
    development: Object.freeze({
      baselineEarned: development.filter((row) => row.baselinePassed).length,
      revisedEarned: development.filter((row) => row.revisedPassed).length,
      possible: 12 as const
    }),
    holdout: Object.freeze({
      baselineEarned: holdout.filter((row) => row.baselinePassed).length,
      revisedEarned: holdout.filter((row) => row.revisedPassed).length,
      possible: 12 as const
    }),
    evidencePackage,
    evidenceExports,
    presentation: Object.freeze({
      commit: "reference-artifact",
      deploymentIdentity: "checked-in-sealed-projection"
    })
  });
}
export default async function ResultsPage({
  searchParams
}: {
  readonly searchParams?: Promise<{ readonly view?: string }>;
}) {
  const cookieStore = await cookies();
  if (cookieStore.has(PROBE_SESSION_COOKIE) && !cookieStore.has(PROBE_RESULTS_COOKIE)) {
    redirect("/lab");
  }
  if (cookieStore.has(SCORED_SESSION_COOKIE) && !cookieStore.has(SCORED_RESULTS_COOKIE)) {
    redirect("/lab");
  }
  const terminalEvidence = cookieStore.has(PROBE_RESULTS_COOKIE);
  const calibrationEvidenceAvailable = terminalEvidence || cookieStore.has(PROBE_RECOVERY_COOKIE);
  const fullEvidenceView = (await searchParams)?.view === "full" || calibrationEvidenceAvailable;
  // thurstone-impact-execution:compact-start
  if (!fullEvidenceView) {
    const impactExecutionSummary = createImpactExecutionResultsSummary(
      semanticReferenceArtifact,
      invocationIntegrityArtifact
    );
    return (
      <div className="page-shell route-page">
        <header className="route-hero" aria-labelledby="impact-execution-question">
          <div>
            <p className="eyebrow">The human question</p>
            <h1 id="impact-execution-question">
              Did the clearer checkout description improve the agent&apos;s measured behavior?
            </h1>
            <p className="metric-label">Meaning Matrix all-or-nothing case passes</p>
            <p className="metric-value">
              {[
                impactExecutionSummary.semantic.summary.baselinePassed,
                "/",
                impactExecutionSummary.semantic.summary.possible,
                " → ",
                impactExecutionSummary.semantic.summary.revisedPassed,
                "/",
                impactExecutionSummary.semantic.summary.possible
              ].join("")}
            </p>
            <p>
              {
                "The description looked better, but it did not fix the measured behavior. Thurstone caught that before anyone claimed success."
              }
            </p>
            <p>
              <strong>Residual:</strong> clarification was required; baseline{" "}
              {
                impactExecutionSummary.semantic.boundary.tentative.descriptionComparison.baseline
                  .observedAction
              }{" "}
              → revised{" "}
              {
                impactExecutionSummary.semantic.boundary.tentative.descriptionComparison.revised
                  .observedAction
              }
              , with state changed:{" "}
              {String(impactExecutionSummary.semantic.boundary.tentative.effect.stateChanged)}.
            </p>
            <p>
              Thurstone is a pre-release test: did the agent choose the action and page effect a
              human approved? WebMCP lets the agent discover and invoke tools registered by this
              live page, so the proof measures the shipped interface instead of a mock.
            </p>
            <p>
              {impactExecutionSummary.semantic.summary.disclosure} A case passes only when its
              complete approved decision, arguments, and effect pass. The seven diagnostic metrics
              below use their own denominators.
            </p>
          </div>
          <StatusPill state="ready">Authentic paired evidence</StatusPill>
        </header>

        <section className="panel" aria-labelledby="impact-execution-boundary">
          <p className="eyebrow">Featured authentic boundary</p>
          <h2 id="impact-execution-boundary">Considering is not deciding.</h2>
          <p>
            These two revised holdout rows differ only at the approved commitment boundary. Every
            request, action, argument, lifecycle state, and effect below comes from the sealed
            reference artifact.
          </p>
          <div className="trace-inspector-grid impact-boundary-grid">
            <article aria-labelledby="impact-execution-tentative">
              <p className="eyebrow">Residual failure · tentative</p>
              <h3 id="impact-execution-tentative">Clarification was required.</h3>
              <p>{impactExecutionSummary.semantic.boundary.tentative.request}</p>
              <p>
                <strong>Same case across the description change:</strong>{" "}
                {
                  impactExecutionSummary.semantic.boundary.tentative.descriptionComparison.baseline
                    .observedAction
                }{" "}
                (
                {impactExecutionSummary.semantic.boundary.tentative.descriptionComparison.baseline
                  .passed
                  ? "pass"
                  : "fail"}
                ) →{" "}
                {
                  impactExecutionSummary.semantic.boundary.tentative.descriptionComparison.revised
                    .observedAction
                }{" "}
                (
                {impactExecutionSummary.semantic.boundary.tentative.descriptionComparison.revised
                  .passed
                  ? "pass"
                  : "fail"}
                ). Failure: {impactExecutionSummary.semantic.boundary.tentative.failureCode}.
              </p>
              <dl>
                <div>
                  <dt>Approved action</dt>
                  <dd>{impactExecutionSummary.semantic.boundary.tentative.expectedAction}</dd>
                </div>
                <div>
                  <dt>Observed action</dt>
                  <dd>{impactExecutionSummary.semantic.boundary.tentative.observedAction}</dd>
                </div>
                <div>
                  <dt>Canonical arguments</dt>
                  <dd>none — no target call</dd>
                </div>
                <div>
                  <dt>Lifecycle</dt>
                  <dd>no native call</dd>
                </div>
                <div>
                  <dt>Trusted state before</dt>
                  <dd>
                    revision{" "}
                    {impactExecutionSummary.semantic.boundary.tentative.stateBefore.revision}
                    {" · pending checkout: "}
                    {
                      impactExecutionSummary.semantic.boundary.tentative.stateBefore
                        .pendingCheckoutStatus
                    }
                  </dd>
                </div>
                <div>
                  <dt>Trusted state after</dt>
                  <dd>
                    revision{" "}
                    {impactExecutionSummary.semantic.boundary.tentative.stateAfter.revision}
                    {" · pending checkout: "}
                    {
                      impactExecutionSummary.semantic.boundary.tentative.stateAfter
                        .pendingCheckoutStatus
                    }
                  </dd>
                </div>
                <div>
                  <dt>Observed effect</dt>
                  <dd>
                    state changed:{" "}
                    {String(impactExecutionSummary.semantic.boundary.tentative.effect.stateChanged)}
                    {" · cart quantity changes: "}
                    {impactExecutionSummary.semantic.boundary.tentative.effect.quantityChangeCount}
                    {" · unmodeled state changed: "}
                    {String(
                      impactExecutionSummary.semantic.boundary.tentative.effect
                        .unmodeledStateChanged
                    )}
                  </dd>
                </div>
              </dl>
            </article>

            <article aria-labelledby="impact-execution-explicit">
              <p className="eyebrow">Matched contrast · explicit</p>
              <h3 id="impact-execution-explicit">One pending request was permitted.</h3>
              <p>{impactExecutionSummary.semantic.boundary.explicit.request}</p>
              <dl>
                <div>
                  <dt>Approved action</dt>
                  <dd>{impactExecutionSummary.semantic.boundary.explicit.expectedAction}</dd>
                </div>
                <div>
                  <dt>Observed action</dt>
                  <dd>{impactExecutionSummary.semantic.boundary.explicit.observedAction}</dd>
                </div>
                <div>
                  <dt>Canonical arguments</dt>
                  <dd>
                    <details>
                      <summary>Inspect exact canonical arguments</summary>
                      <code>
                        {JSON.stringify(
                          impactExecutionSummary.semantic.boundary.explicit.canonicalArguments
                        )}
                      </code>
                    </details>
                  </dd>
                </div>
                <div>
                  <dt>Lifecycle</dt>
                  <dd>{impactExecutionSummary.semantic.boundary.explicit.lifecycle}</dd>
                </div>
                <div>
                  <dt>Trusted state before</dt>
                  <dd>
                    revision{" "}
                    {impactExecutionSummary.semantic.boundary.explicit.stateBefore.revision}
                    {" · pending checkout: "}
                    {
                      impactExecutionSummary.semantic.boundary.explicit.stateBefore
                        .pendingCheckoutStatus
                    }
                  </dd>
                </div>
                <div>
                  <dt>Trusted state after</dt>
                  <dd>
                    revision {impactExecutionSummary.semantic.boundary.explicit.stateAfter.revision}
                    {" · pending checkout: "}
                    {
                      impactExecutionSummary.semantic.boundary.explicit.stateAfter
                        .pendingCheckoutStatus
                    }
                  </dd>
                </div>
                <div>
                  <dt>Observed effect</dt>
                  <dd>
                    state changed:{" "}
                    {String(impactExecutionSummary.semantic.boundary.explicit.effect.stateChanged)}
                    {" · cart quantity changes: "}
                    {impactExecutionSummary.semantic.boundary.explicit.effect.quantityChangeCount}
                    {" · unmodeled state changed: "}
                    {String(
                      impactExecutionSummary.semantic.boundary.explicit.effect.unmodeledStateChanged
                    )}
                  </dd>
                </div>
              </dl>
            </article>
          </div>
        </section>

        <section className="panel" aria-labelledby="impact-execution-webmcp">
          <p className="eyebrow">Why real WebMCP matters</p>
          <h2 id="impact-execution-webmcp">Evidence follows the page, not a detached mock.</h2>
          <p>
            The agent chose from the live page catalog:{" "}
            {impactExecutionSummary.semantic.boundary.explicit.liveCatalog.toolNames.join(", ")}.
          </p>
          <p>
            Human controls and native Site Tools execute against the same serialized checkout store.
            Thurstone independently verifies tool choice, canonical arguments, handler lifecycle,
            and the trusted before/after effect.
          </p>
          <details className="evidence-identity">
            <summary>Inspect trace, manifest, and argument mode</summary>
            <p>
              Trace {impactExecutionSummary.semantic.boundary.explicit.traceEventId}
              {" · manifest "}
              {impactExecutionSummary.semantic.boundary.explicit.liveCatalog.manifestHash}
              {" · argument mode "}
              {impactExecutionSummary.semantic.boundary.explicit.runtime.argumentMode}
            </p>
          </details>
        </section>

        <section className="panel" aria-labelledby="impact-execution-metrics">
          <p className="eyebrow">Meaning Matrix</p>
          <h2 id="impact-execution-metrics">Seven semantic metrics</h2>
          <ul>
            {impactExecutionSummary.semantic.metrics.revised.map((metric) => (
              <li key={metric.id}>
                <strong>{metric.label}</strong>: {metric.overall.numerator}/
                {metric.overall.denominator} · {metric.direction}
              </li>
            ))}
          </ul>
          <p>{impactExecutionSummary.semantic.limitations[0]}</p>
        </section>

        <section className="panel" aria-labelledby="impact-execution-release">
          <p className="eyebrow">Release use</p>
          <h2 id="impact-execution-release">
            A release check before agent-callable behavior changes.
          </h2>
          <p>
            Product, QA, safety, and release teams use Thurstone before releasing or changing a
            site&apos;s agent-callable tools.
          </p>
          <p>
            <strong>Current evidence:</strong> {impactExecutionSummary.semantic.limitations[1]} One
            trial per case and version.
          </p>
          <p>
            <strong>Untested applications:</strong> account support, travel booking, content
            publication, and administrative workflows are high-consequence examples—not
            evidence-backed coverage.
          </p>
          <p>
            <strong>Restrained roadmap:</strong> bring-your-own human-approved contracts, CI gating,
            then separately validated domains. These are planned extensions, not current
            capabilities.
          </p>
        </section>

        <section className="panel" aria-labelledby="impact-execution-integrity">
          <p className="eyebrow">Separate audit lane</p>
          <h2 id="impact-execution-integrity">Invocation Integrity</h2>
          <p>
            {[
              impactExecutionSummary.integrity.score.earned,
              "/",
              impactExecutionSummary.integrity.score.possible,
              " · model",
              impactExecutionSummary.integrity.modelCallCount,
              " · "
            ].join("")}
            {impactExecutionSummary.integrity.includedInSemanticDenominator
              ? "included in the semantic denominator"
              : "separate denominator; not included in semantic accuracy"}
          </p>
          <ul>
            {impactExecutionSummary.integrity.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </section>

        <a className="button button-secondary" href="/results?view=full">
          Inspect complete expert evidence
        </a>
        <PairedResultsToolBridge
          expectedPackageDigest={impactExecutionSummary.semantic.packageDigest}
          expectedJsonSha256="fb272a4a68d9c1d3d4542a668b86b23f293cd55e714c1b826af32c7fcac0be26"
        />
      </div>
    );
  }
  // thurstone-impact-execution:compact-end

  const configuredSemanticResults = await readSemanticResults();
  const referenceFallback = configuredSemanticResults.status === "no-scored-run";
  const semanticResults: NonEmptySemanticResults = referenceFallback
    ? await createImpactExecutionReferenceResults()
    : configuredSemanticResults;
  const invocationIntegrityResults = await readInvocationIntegrityResults();
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
        <StatusPill state="ready">
          {semanticResults.status === "paired-comparison"
            ? "Paired reference evidence"
            : "Baseline development evidence"}
        </StatusPill>
      </header>

      {referenceFallback ? (
        <div className="runtime-receipt" role="status">
          <span>Deterministic review mode · checked-in sealed projection</span>
          <strong>Complete 48-row reference evidence remains available.</strong>
          <small>
            The store-only superseded-protocol receipt is unavailable in this mode; the primary
            package, traces, metrics, canonical exports, and limitations remain exact.
          </small>
        </div>
      ) : null}

      {semanticResults.status === "paired-comparison" ? (
        <SemanticPairedResults results={semanticResults} />
      ) : (
        <SemanticDevelopmentResults
          baselineRunId={semanticResults.baselineRunId}
          baselineEvidenceDigest={semanticResults.baselineEvidenceDigest}
          rows={semanticResults.rows}
          earned={semanticResults.development.earned}
          holdoutCommitmentDigest={semanticResults.holdout.commitmentDigest}
          supersededEvidence={semanticResults.supersededEvidence}
        />
      )}

      <InvocationIntegrityResults results={invocationIntegrityResults} />

      {calibrationEvidenceAvailable ? <ProbeCalibrationResults recoveryAvailable /> : null}
    </div>
  );
}
