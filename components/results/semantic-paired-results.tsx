"use client";

import { useEffect, useMemo, useState } from "react";

import { StatusPill } from "@/components/status-pill";
import type {
  EvidenceSubset,
  EvidenceVersion,
  Gate6TraceRecord
} from "@/lib/results/evidence-package";
import {
  createLazyPairedResultsMetaTool,
  createPairedResultsMetaTool
} from "@/lib/results/meta-tools";
import type { SemanticResultsState } from "@/lib/results/semantic-results.server";
import { webMcpRegistryManager, type RegistryStatus } from "@/lib/webmcp/registry-manager";

type Paired = Extract<SemanticResultsState, { status: "paired-comparison" }>;
type VersionFilter = "both" | EvidenceVersion;
type OutcomeFilter = "all" | "pass" | "fail";

function percent(numerator: number, denominator: number): string {
  return denominator === 0 ? "n/a" : `${Math.round((numerator / denominator) * 100)}%`;
}

function saveExport(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function compact(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

// thurstone-impact-execution:paired-results-bridge
async function impactExecutionSha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

export function PairedResultsToolBridge({
  expectedPackageDigest,
  expectedJsonSha256
}: {
  readonly expectedPackageDigest: string;
  readonly expectedJsonSha256: string;
}) {
  const tool = useMemo(
    () =>
      createLazyPairedResultsMetaTool(async (signal) => {
        const response = await fetch("/api/evidence/reference", {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: signal ?? null
        });
        if (!response.ok) throw new Error("paired_results_evidence_unavailable");
        const text = await response.text();
        if (
          response.headers.get("X-ToolProof-Evidence-SHA256") !== expectedJsonSha256 ||
          (await impactExecutionSha256(text)) !== expectedJsonSha256
        ) {
          throw new Error("paired_results_evidence_digest_mismatch");
        }
        const evidence = JSON.parse(
          text
        ) as import("@/lib/results/evidence-package").Gate6EvidencePackage;
        if (evidence.packageDigest !== expectedPackageDigest) {
          throw new Error("paired_results_package_digest_mismatch");
        }
        return evidence;
      }),
    [expectedJsonSha256, expectedPackageDigest]
  );
  useEffect(() => {
    const context = document.modelContext;
    if (!context || typeof context.registerTool !== "function") return;
    return webMcpRegistryManager.acquire(context, [tool], () => undefined);
  }, [tool]);
  return null;
}

export function SemanticPairedResults({ results }: { readonly results: Paired }) {
  const [registry, setRegistry] = useState<RegistryStatus>({ phase: "idle", toolNames: [] });
  const [subset, setSubset] = useState<EvidenceSubset>("development");
  const [family, setFamily] = useState("all");
  const [caseId, setCaseId] = useState("all");
  const [version, setVersion] = useState<VersionFilter>("both");
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");
  const [errorClass, setErrorClass] = useState("all");
  const [selectedTrace, setSelectedTrace] = useState("");
  const evidence = results.evidencePackage;
  const records = evidence.records;
  const residualFailure = records.find(
    ({ version: itemVersion, passed }) => itemVersion === "revised" && !passed
  );
  const baselineInfrastructure = evidence.infrastructure.baseline;
  const revisedInfrastructure = evidence.infrastructure.revised;
  const tool = useMemo(() => createPairedResultsMetaTool(evidence), [evidence]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context || typeof context.registerTool !== "function") return;
    return webMcpRegistryManager.acquire(context, [tool], setRegistry);
  }, [tool]);

  const recordByKey = useMemo(
    () => new Map(records.map((record) => [`${record.caseId}:${record.version}`, record])),
    [records]
  );
  const subsetRows = useMemo(
    () => results.rows.filter((row) => row.subset === subset),
    [results.rows, subset]
  );
  const families = useMemo(
    () => [...new Set(subsetRows.map(({ family: value }) => value))].sort(),
    [subsetRows]
  );
  const cases = useMemo(
    () =>
      subsetRows
        .filter((row) => family === "all" || row.family === family)
        .map(({ caseId: value }) => value),
    [family, subsetRows]
  );
  const filteredRows = useMemo(
    () =>
      subsetRows.filter((row) => {
        if (family !== "all" && row.family !== family) return false;
        if (caseId !== "all" && row.caseId !== caseId) return false;
        const selectedVersions: readonly EvidenceVersion[] =
          version === "both" ? ["baseline", "revised"] : [version];
        const selectedRecords = selectedVersions
          .map((item) => recordByKey.get(`${row.caseId}:${item}`))
          .filter((item): item is Gate6TraceRecord => Boolean(item));
        if (
          outcome !== "all" &&
          !selectedRecords.some(({ passed }) => (outcome === "pass" ? passed : !passed))
        ) {
          return false;
        }
        if (
          errorClass !== "all" &&
          !selectedRecords.some(({ errorClass: value }) => value === errorClass)
        ) {
          return false;
        }
        return true;
      }),
    [caseId, errorClass, family, outcome, recordByKey, subsetRows, version]
  );
  const visibleRecords = useMemo(
    () =>
      filteredRows.flatMap((row) =>
        (version === "both" ? (["baseline", "revised"] as const) : ([version] as const))
          .map((item) => recordByKey.get(`${row.caseId}:${item}`))
          .filter((item): item is Gate6TraceRecord => Boolean(item))
      ),
    [filteredRows, recordByKey, version]
  );
  const effectiveTraceKey = visibleRecords.some(
    (record) => `${record.caseId}:${record.version}` === selectedTrace
  )
    ? selectedTrace
    : visibleRecords[0]
      ? `${visibleRecords[0].caseId}:${visibleRecords[0].version}`
      : "";
  const trace = effectiveTraceKey ? (recordByKey.get(effectiveTraceKey) ?? null) : null;
  const metricIds = evidence.metrics.baseline.map(({ id }) => id);
  const errorClasses = [...new Set(records.map(({ errorClass: value }) => value))].sort();

  const changeSubset = (value: EvidenceSubset) => {
    setSubset(value);
    setFamily("all");
    setCaseId("all");
    setOutcome("all");
    setErrorClass("all");
  };

  return (
    <section
      className="panel semantic-results gate6-results"
      aria-labelledby="paired-results-title"
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Gate 6 · authentic Custom Probe reference</span>
          <h2 id="paired-results-title">Baseline versus revised</h2>
        </div>
        <StatusPill state="ready">
          {evidence.summary.baselinePassed} / {evidence.summary.possible} →{" "}
          {evidence.summary.revisedPassed} / {evidence.summary.possible}
        </StatusPill>
      </div>

      <div className="result-verdict" role="status">
        <strong>
          {evidence.summary.noMeasuredImprovement
            ? "No measured improvement."
            : "Measured outcome changed."}
        </strong>
        <span>
          Development {results.development.baselineEarned}/{results.development.possible} →{" "}
          {results.development.revisedEarned}/{results.development.possible}; Builder-blinded
          holdout {results.holdout.baselineEarned}/{results.holdout.possible} →{" "}
          {results.holdout.revisedEarned}/{results.holdout.possible}.{" "}
          {residualFailure
            ? `Residual failure: ${residualFailure.caseId} expected ${residualFailure.expectedAction} but observed ${residualFailure.observedAction} (${residualFailure.failureCodes.join(", ")}).`
            : "No residual semantic failure."}
        </span>
      </div>
      <p>
        One trial per case and version: a demonstration snapshot, not a stability estimate. Repair
        received zero holdout prompts or results; that blinding is operational, not cryptographic.
      </p>
      <p className="receipt-line">
        Results Site Tools:{" "}
        {registry.phase === "ready" ? registry.toolNames.join(", ") : registry.phase}
      </p>

      <div className="studio-allocation" aria-label="Paired result counts">
        <div>
          <strong>
            {results.development.baselineEarned}/{results.development.possible} →{" "}
            {results.development.revisedEarned}/{results.development.possible}
          </strong>
          <span>Development · one trial/case/version</span>
        </div>
        <div>
          <strong>
            {results.holdout.baselineEarned}/{results.holdout.possible} →{" "}
            {results.holdout.revisedEarned}/{results.holdout.possible}
          </strong>
          <span>Builder-blinded holdout · one trial/case/version</span>
        </div>
        <div>
          <strong>
            {baselineInfrastructure.transportFailures + revisedInfrastructure.transportFailures} /{" "}
            {baselineInfrastructure.attempts + revisedInfrastructure.attempts}
          </strong>
          <span>Transport failures across both versions</span>
        </div>
      </div>
      <div className="runtime-receipt">
        <span>Infrastructure accounting · never counted green</span>
        <strong>
          Baseline {baselineInfrastructure.scoredOutcomes}/{baselineInfrastructure.logicalCases}{" "}
          scored · revised {revisedInfrastructure.scoredOutcomes}/
          {revisedInfrastructure.logicalCases} scored
        </strong>
        <small>
          Attempts {baselineInfrastructure.attempts} + {revisedInfrastructure.attempts} · retries{" "}
          {baselineInfrastructure.retries} + {revisedInfrastructure.retries} · transport failures{" "}
          {baselineInfrastructure.transportFailures} + {revisedInfrastructure.transportFailures} ·
          incomplete {baselineInfrastructure.incomplete} + {revisedInfrastructure.incomplete} ·
          indeterminate {baselineInfrastructure.indeterminate} +{" "}
          {revisedInfrastructure.indeterminate}
        </small>
      </div>

      <section className="gate6-section" aria-labelledby="metric-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Separate denominators</span>
            <h3 id="metric-title">Meaning metrics</h3>
          </div>
        </div>
        <div className="metric-grid">
          {metricIds.map((id) => {
            const baseline = evidence.metrics.baseline.find((metric) => metric.id === id)!;
            const revised = evidence.metrics.revised.find((metric) => metric.id === id)!;
            return (
              <article key={id} className="metric-card">
                <span>{baseline.label}</span>
                <strong>
                  {baseline.overall.numerator}/{baseline.overall.denominator} →{" "}
                  {revised.overall.numerator}/{revised.overall.denominator}
                </strong>
                <small>
                  {percent(baseline.overall.numerator, baseline.overall.denominator)} →{" "}
                  {percent(revised.overall.numerator, revised.overall.denominator)} · Dev{" "}
                  {baseline.development.numerator}/{baseline.development.denominator} · Holdout{" "}
                  {baseline.holdout.numerator}/{baseline.holdout.denominator}
                </small>
                <p>{baseline.definition}</p>
                {baseline.humanReviewStatus !== "not-applicable" ? (
                  <em>Usefulness awaits Sergio’s final human claims review.</em>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="gate6-section" aria-labelledby="matrix-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">48 scored traces · 24 paired cases</span>
            <h3 id="matrix-title">Meaning Matrix</h3>
          </div>
          <div className="subset-tabs" aria-label="Evidence subset">
            <button
              type="button"
              aria-pressed={subset === "development"}
              onClick={() => changeSubset("development")}
            >
              Development
            </button>
            <button
              type="button"
              aria-pressed={subset === "builder-blinded-holdout"}
              onClick={() => changeSubset("builder-blinded-holdout")}
            >
              Builder-blinded holdout
            </button>
          </div>
        </div>
        <div className="result-filters" aria-label="Meaning Matrix filters">
          <label>
            <span>Family</span>
            <select
              value={family}
              onChange={(event) => {
                setFamily(event.target.value);
                setCaseId("all");
              }}
            >
              <option value="all">All families</option>
              {families.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Case</span>
            <select value={caseId} onChange={(event) => setCaseId(event.target.value)}>
              <option value="all">All cases</option>
              {cases.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Version</span>
            <select
              value={version}
              onChange={(event) => setVersion(event.target.value as VersionFilter)}
            >
              <option value="both">Baseline + revised</option>
              <option value="baseline">Baseline</option>
              <option value="revised">Revised</option>
            </select>
          </label>
          <label>
            <span>Outcome</span>
            <select
              value={outcome}
              onChange={(event) => setOutcome(event.target.value as OutcomeFilter)}
            >
              <option value="all">All outcomes</option>
              <option value="pass">Pass</option>
              <option value="fail">Fail</option>
            </select>
          </label>
          <label>
            <span>Error class</span>
            <select value={errorClass} onChange={(event) => setErrorClass(event.target.value)}>
              <option value="all">All error classes</option>
              {errorClasses.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div
          className="matrix-table gate6-matrix"
          role="table"
          aria-label={`${subset} Meaning Matrix`}
        >
          <div
            className={`matrix-row matrix-header ${version === "both" ? "" : "matrix-one-version"}`}
            role="row"
          >
            <span role="columnheader">Case and family</span>
            <span role="columnheader">Request and approved action</span>
            {version !== "revised" ? <span role="columnheader">Baseline outcome</span> : null}
            {version !== "baseline" ? <span role="columnheader">Revised outcome</span> : null}
          </div>
          {filteredRows.map((row) => {
            const baseline = recordByKey.get(`${row.caseId}:baseline`)!;
            const revised = recordByKey.get(`${row.caseId}:revised`)!;
            return (
              <div
                className={`matrix-row ${version === "both" ? "" : "matrix-one-version"}`}
                role="row"
                key={row.runnerCaseId}
              >
                <span role="cell">
                  <strong>{row.caseId}</strong>
                  <small>{row.family}</small>
                </span>
                <span role="cell">
                  <strong>{row.request}</strong>
                  <small>Expected: {row.expectedAction}</small>
                </span>
                {version !== "revised" ? (
                  <span role="cell" className={baseline.passed ? "matrix-pass" : "matrix-fail"}>
                    Baseline {baseline.passed ? "Pass" : "Fail"}
                    <small>{baseline.observedAction}</small>
                    <button
                      type="button"
                      onClick={() => setSelectedTrace(`${row.caseId}:baseline`)}
                    >
                      Inspect baseline
                    </button>
                  </span>
                ) : null}
                {version !== "baseline" ? (
                  <span role="cell" className={revised.passed ? "matrix-pass" : "matrix-fail"}>
                    Revised {revised.passed ? "Pass" : "Fail"}
                    <small>{revised.observedAction}</small>
                    <button type="button" onClick={() => setSelectedTrace(`${row.caseId}:revised`)}>
                      Inspect revised
                    </button>
                  </span>
                ) : null}
              </div>
            );
          })}
          {filteredRows.length === 0 ? (
            <p className="empty-filter">No trace matches these filters.</p>
          ) : null}
        </div>
      </section>

      <section className="gate6-section trace-inspector" aria-labelledby="trace-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Raw-derived safe projection</span>
            <h3 id="trace-title">Trace inspector</h3>
          </div>
          {trace ? (
            <StatusPill state={trace.passed ? "ready" : "blocked"}>
              {trace.version} · {trace.passed ? "pass" : "fail"}
            </StatusPill>
          ) : null}
        </div>
        {trace ? (
          <div className="trace-inspector-grid">
            <article>
              <h4>Request and decision</h4>
              <p>{trace.request}</p>
              <dl>
                <div>
                  <dt>Expected</dt>
                  <dd>{trace.expectedAction}</dd>
                </div>
                <div>
                  <dt>Observed</dt>
                  <dd>{trace.observedAction}</dd>
                </div>
                <div>
                  <dt>Score</dt>
                  <dd>{trace.score}/1</dd>
                </div>
                <div>
                  <dt>Error</dt>
                  <dd>{trace.failureCodes.join(", ") || "none"}</dd>
                </div>
              </dl>
              <pre tabIndex={0} aria-label="Model decision JSON">
                {compact(trace.model.decision)}
              </pre>
            </article>
            <article>
              <h4>Live catalog and native execution</h4>
              <dl>
                <div>
                  <dt>Manifest</dt>
                  <dd>{trace.liveCatalog.manifestHash}</dd>
                </div>
                <div>
                  <dt>Tools</dt>
                  <dd>{trace.liveCatalog.toolNames.join(", ")}</dd>
                </div>
                <div>
                  <dt>Canonical arguments</dt>
                  <dd>{trace.hashes.traceArgumentsHash ?? "no native call"}</dd>
                </div>
                <div>
                  <dt>Native result</dt>
                  <dd>{trace.hashes.traceResultHash ?? "no native call"}</dd>
                </div>
              </dl>
              <pre tabIndex={0} aria-label="Canonical arguments and native result JSON">
                {compact({
                  arguments: trace.execution.canonicalArguments,
                  result: trace.execution.nativeResult
                })}
              </pre>
            </article>
            <article>
              <h4>State and effect</h4>
              <pre tabIndex={0} aria-label="State and effect JSON">
                {compact({
                  before: trace.execution.stateBefore,
                  after: trace.execution.stateAfter,
                  effect: trace.execution.effect
                })}
              </pre>
            </article>
            <article>
              <h4>Runtime and artifact hashes</h4>
              <dl>
                <div>
                  <dt>Browser</dt>
                  <dd>{trace.runtime.browserVersion}</dd>
                </div>
                <div>
                  <dt>Provider/model</dt>
                  <dd>
                    {trace.model.provider} · {trace.model.model}
                  </dd>
                </div>
                <div>
                  <dt>Provider timing</dt>
                  <dd>
                    {trace.model.dispatchedAt} → {trace.model.completedAt} ·{" "}
                    {trace.model.durationMs}ms
                  </dd>
                </div>
                <div>
                  <dt>Row</dt>
                  <dd>{trace.hashes.rowDigest}</dd>
                </div>
                <div>
                  <dt>Envelope</dt>
                  <dd>{trace.hashes.envelopeHash}</dd>
                </div>
                <div>
                  <dt>Provider response</dt>
                  <dd>{trace.model.rawResponseHash}</dd>
                </div>
                <div>
                  <dt>Capture</dt>
                  <dd>{trace.hashes.captureDigest}</dd>
                </div>
              </dl>
            </article>
          </div>
        ) : (
          <p>Select a Matrix trace.</p>
        )}
      </section>

      <section className="gate6-section contract-diff" aria-labelledby="diff-title">
        <span className="eyebrow">One controlled intervention</span>
        <h3 id="diff-title">Contract version diff</h3>
        <div className="diff-grid">
          <blockquote>
            <small>Baseline</small>
            {evidence.contractDiff.oldDescription}
          </blockquote>
          <blockquote>
            <small>Revised</small>
            {evidence.contractDiff.newDescription}
          </blockquote>
        </div>
        <p>
          Exactly one line in <code>{evidence.contractDiff.path}</code> · proof{" "}
          <code>{evidence.contractDiff.sourceDiffProofHash}</code>
        </p>
        <div className="runtime-receipt" aria-label="Sanitized human revision approval receipt">
          <span>Human-approved revision · Sergio Valencia</span>
          <strong>One-description revision frozen before the revised run</strong>
          <small>Sanitized freeze receipt {evidence.contractDiff.revisionFreezeHash}</small>
        </div>
      </section>

      <section className="gate6-section" aria-labelledby="provenance-title">
        <span className="eyebrow">Evidence provenance</span>
        <h3 id="provenance-title">One truthful identity chain</h3>
        <div className="provenance-grid">
          {Object.entries(evidence.provenance).map(([key, value]) => (
            <div key={key}>
              <span>{key}</span>
              <strong>{value}</strong>
            </div>
          ))}
          <div>
            <span>presentationCommit</span>
            <strong>{results.presentation.commit}</strong>
          </div>
          <div>
            <span>presentationDeployment</span>
            <strong>{results.presentation.deploymentIdentity}</strong>
          </div>
        </div>
        <div className="namespace-grid">
          {evidence.namespaces.map((item) => (
            <article key={item.id}>
              <strong>{item.id}</strong>
              <span>{item.status}</span>
              <small>
                {item.includedInPrimaryDenominator ? "Primary denominator" : "Separate denominator"}
              </small>
            </article>
          ))}
        </div>
      </section>

      <section className="gate6-section" aria-labelledby="export-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Same canonical evidence object</span>
            <h3 id="export-title">Exports and limitations</h3>
          </div>
          <div className="button-row compact-buttons">
            <button
              type="button"
              className="button button-secondary"
              onClick={() =>
                saveExport(
                  "toolproof-reference-evidence.json",
                  results.evidenceExports.json,
                  "application/json"
                )
              }
            >
              Download JSON
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() =>
                saveExport(
                  "toolproof-reference-evidence.md",
                  results.evidenceExports.markdown,
                  "text/markdown"
                )
              }
            >
              Download Markdown
            </button>
          </div>
        </div>
        <p className="export-hashes">
          JSON <code>{results.evidenceExports.jsonSha256}</code> · Markdown{" "}
          <code>{results.evidenceExports.markdownSha256}</code> · Package{" "}
          <code>{evidence.packageDigest}</code>
        </p>
        <ul className="limitations-list">
          {evidence.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </section>

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
    </section>
  );
}
