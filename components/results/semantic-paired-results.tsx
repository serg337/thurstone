"use client";

import { useEffect, useMemo, useState } from "react";

import { StatusPill } from "@/components/status-pill";
import {
  createPairedResultsMetaTool,
  type ToolProofPairedResultsProjection
} from "@/lib/results/meta-tools";
import type { SemanticResultsState } from "@/lib/results/semantic-results.server";
import { webMcpRegistryManager, type RegistryStatus } from "@/lib/webmcp/registry-manager";

type Paired = Extract<SemanticResultsState, { status: "paired-comparison" }>;

export function SemanticPairedResults({ results }: { readonly results: Paired }) {
  const [registry, setRegistry] = useState<RegistryStatus>({ phase: "idle", toolNames: [] });
  const projection: ToolProofPairedResultsProjection = useMemo(
    () => ({
      version: "toolproof-paired-results-projection@1.0.0",
      evidenceLabel: "one-trial demonstration snapshot",
      baselineEvidenceDigest: results.baselineEvidenceDigest,
      revisedEvidenceDigest: results.revisedEvidenceDigest,
      development: results.development,
      holdout: results.holdout,
      rows: results.rows
    }),
    [results]
  );
  const tool = useMemo(() => createPairedResultsMetaTool(projection), [projection]);
  useEffect(() => {
    const context = document.modelContext;
    if (!context || typeof context.registerTool !== "function") return;
    return webMcpRegistryManager.acquire(context, [tool], setRegistry);
  }, [tool]);
  return (
    <section className="panel semantic-results" aria-labelledby="paired-results-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Gate 6 · trace-derived Meaning Matrix</span>
          <h2 id="paired-results-title">Baseline versus revised</h2>
        </div>
        <StatusPill state="ready">24 / 24 paired</StatusPill>
      </div>
      <p>
        One trial per case and version: a demonstration snapshot, not a stability estimate. Both
        subsets are visible only after the v2 revision freeze and terminal revised run.
      </p>
      <p className="receipt-line">
        Results Site Tools:{" "}
        {registry.phase === "ready" ? registry.toolNames.join(", ") : registry.phase}
      </p>
      {results.supersededEvidence ? (
        <div className="runtime-receipt">
          <span>Permanent predecessor evidence · excluded from this Matrix</span>
          <strong>{results.supersededEvidence.predecessorEvidenceDigest}</strong>
          <small>
            {results.supersededEvidence.disposition} · run{" "}
            {results.supersededEvidence.predecessorRunId} · prior Repair{" "}
            {results.supersededEvidence.priorRepairReceiptHash}
          </small>
        </div>
      ) : null}
      <div className="studio-allocation" aria-label="Paired result counts">
        <div>
          <strong>
            {results.development.baselineEarned} → {results.development.revisedEarned}
          </strong>
          <span>Development / 12</span>
        </div>
        <div>
          <strong>
            {results.holdout.baselineEarned} → {results.holdout.revisedEarned}
          </strong>
          <span>Builder-blinded holdout / 12</span>
        </div>
        <div>
          <strong>1</strong>
          <span>Trial per case and version</span>
        </div>
      </div>
      <div className="matrix-table" role="table" aria-label="Meaning Matrix">
        {results.rows.map((row) => (
          <div className="matrix-row" role="row" key={row.runnerCaseId}>
            <span role="cell">{row.subset}</span>
            <strong role="cell">{row.family}</strong>
            <span role="cell">
              {row.baselinePassed ? "Pass" : "Fail"} → {row.revisedPassed ? "Pass" : "Fail"}
            </span>
            <small role="cell">
              {row.baselineObservedAction} → {row.revisedObservedAction}
            </small>
          </div>
        ))}
      </div>
      <div className="runtime-receipt">
        <span>Revision freeze</span>
        <strong>{results.revisionFreezeHash}</strong>
        <small>
          Baseline {results.baselineEvidenceDigest} · revised {results.revisedEvidenceDigest}
        </small>
      </div>
    </section>
  );
}
