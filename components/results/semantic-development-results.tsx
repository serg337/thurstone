"use client";

import { useEffect, useMemo, useState } from "react";

import { StatusPill } from "@/components/status-pill";
import {
  createResultsMetaTools,
  type RevisionProposal,
  type ToolProofDevelopmentResultsProjection
} from "@/lib/results/meta-tools";
import type {
  SemanticDevelopmentResultRow,
  SemanticSupersededProtocolEvidence
} from "@/lib/results/semantic-results.server";
import { webMcpRegistryManager, type RegistryStatus } from "@/lib/webmcp/registry-manager";

export function SemanticDevelopmentResults(input: {
  readonly baselineRunId: string;
  readonly baselineEvidenceDigest: string;
  readonly rows: readonly SemanticDevelopmentResultRow[];
  readonly earned: number;
  readonly holdoutCommitmentDigest: string;
  readonly supersededEvidence: SemanticSupersededProtocolEvidence | null;
}) {
  const [proposal, setProposal] = useState<RevisionProposal | null>(null);
  const [registry, setRegistry] = useState<RegistryStatus>({ phase: "idle", toolNames: [] });
  const projection: ToolProofDevelopmentResultsProjection = useMemo(
    () => ({
      version: "toolproof-development-results-projection@1.0.0",
      evidenceLabel: "one-trial demonstration snapshot",
      baselineEvidenceDigest: input.baselineEvidenceDigest,
      development: {
        earned: input.earned,
        possible: 12,
        rows: input.rows.map((row) => ({
          caseId: row.caseId,
          family: row.family,
          request: row.request,
          expectedAction: row.expectedAction,
          observedAction: row.observedAction,
          passed: row.passed,
          failureCodes: row.failureCodes
        }))
      },
      holdout: {
        status: "sealed",
        caseCount: 12,
        commitmentDigest: input.holdoutCommitmentDigest
      }
    }),
    [input.baselineEvidenceDigest, input.earned, input.holdoutCommitmentDigest, input.rows]
  );
  const tools = useMemo(
    () => createResultsMetaTools({ results: projection, onProposal: setProposal }),
    [projection]
  );
  useEffect(() => {
    const context = document.modelContext;
    if (!context || typeof context.registerTool !== "function") return;
    return webMcpRegistryManager.acquire(context, tools, setRegistry);
  }, [tools]);

  return (
    <section className="panel semantic-results" aria-labelledby="semantic-results-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Gate 4 · development view</span>
          <h2 id="semantic-results-title">Frozen baseline · development only</h2>
        </div>
        <StatusPill state="neutral">{input.earned}/12 · one trial</StatusPill>
      </div>
      <p>
        This is a one-trial-per-case demonstration snapshot, not a stability estimate. Baseline
        holdout prompts and outcomes remain sealed from repair decisions until the v2 revision is
        frozen and the revised run terminates.
      </p>
      <p className="receipt-line">
        Results Site Tools:{" "}
        {registry.phase === "ready" ? registry.toolNames.join(", ") : registry.phase}
      </p>
      {input.supersededEvidence ? (
        <div className="runtime-receipt">
          <span>Permanent superseded-protocol evidence · not merged</span>
          <strong>{input.supersededEvidence.predecessorEvidenceDigest}</strong>
          <small>
            Baseline {input.supersededEvidence.predecessorRunId} · 24 calls · prior Repair{" "}
            {input.supersededEvidence.priorRepairReceiptHash}
          </small>
        </div>
      ) : null}
      <ul className="result-list" aria-label="Baseline development results">
        {input.rows.map((row) => (
          <li key={row.runnerCaseId}>
            <strong>{row.family}</strong>
            <span>{row.passed ? "Passed" : "Failed"}</span>
            <small>
              {row.expectedAction} → {row.observedAction} ·{" "}
              {row.failureCodes.join(", ") || "all checks passed"}
            </small>
          </li>
        ))}
      </ul>
      <div className="runtime-receipt">
        <span>Builder-blinded holdout</span>
        <strong>12 cases sealed · outcomes unavailable</strong>
        <small>
          Commitment {input.holdoutCommitmentDigest} · reveal only after v2 freeze and revised
          terminal receipt.
        </small>
      </div>
      <div className="runtime-receipt">
        <span>Baseline evidence</span>
        <strong>{input.baselineEvidenceDigest}</strong>
        <small>Run {input.baselineRunId}</small>
      </div>
      {proposal ? (
        <div className="studio-review-alert" role="status">
          <strong>Revision proposed—not approved.</strong>
          <span>{proposal.proposedDescription}</span>
        </div>
      ) : null}
    </section>
  );
}
