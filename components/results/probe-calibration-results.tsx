"use client";

import { useEffect, useState } from "react";

import {
  GATE2_ATTEMPT_1_LINEAGE,
  GATE2_CALIBRATION_BUNDLE_VERSION,
  GATE2_CALIBRATION_LANE,
  verifyGate2CalibrationBundle
} from "@/lib/evidence/gate2-calibration-bundle";
import {
  PROBE_CLIENT_RESULTS_KEY,
  parseProbeClientSessionMarker,
  type ProbeClientSessionMarker
} from "@/lib/probe/client-session";
import {
  PROBE_CALIBRATION_ATTEMPT,
  PROBE_CALIBRATION_PROTOCOL_VERSION
} from "@/lib/probe/service-contract";

const APP_COMMIT = process.env.NEXT_PUBLIC_TOOLPROOF_COMMIT_SHA?.trim() || "unversioned";

interface CalibrationCaseRow {
  readonly ordinal?: number;
  readonly evaluation?: {
    readonly observedTool?: string | null;
    readonly passed?: boolean;
    readonly failures?: readonly string[];
  };
}

interface CalibrationBundle {
  readonly version: typeof GATE2_CALIBRATION_BUNDLE_VERSION;
  readonly protocolVersion: typeof PROBE_CALIBRATION_PROTOCOL_VERSION;
  readonly attempt: typeof PROBE_CALIBRATION_ATTEMPT;
  readonly lane: typeof GATE2_CALIBRATION_LANE;
  readonly calibrationOnly: true;
  readonly includedInBenchmark: false;
  readonly appCommit: string;
  readonly caseCount: number;
  readonly passedCount: number;
  readonly cases: readonly CalibrationCaseRow[];
  readonly priorAttempt: typeof GATE2_ATTEMPT_1_LINEAGE;
  readonly policyMigration: {
    readonly migrationId: string;
    readonly previousPolicyHash: string;
    readonly nextPolicyHash: string;
    readonly receiptHash: string;
  };
  readonly attemptCost: {
    readonly priorCumulativeKnownAccountedNanoUsd: number;
    readonly attemptAccountedNanoUsd: number;
    readonly terminalCumulativeKnownAccountedNanoUsd: number;
  };
  readonly evidenceDigest: string;
}

async function parseBundle(value: unknown): Promise<CalibrationBundle> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_calibration_bundle");
  }
  const bundle = value as Partial<CalibrationBundle>;
  if (
    bundle.version !== GATE2_CALIBRATION_BUNDLE_VERSION ||
    bundle.protocolVersion !== PROBE_CALIBRATION_PROTOCOL_VERSION ||
    bundle.attempt !== PROBE_CALIBRATION_ATTEMPT ||
    bundle.lane !== GATE2_CALIBRATION_LANE ||
    bundle.calibrationOnly !== true ||
    bundle.includedInBenchmark !== false ||
    bundle.appCommit !== APP_COMMIT ||
    bundle.caseCount !== 4 ||
    !Array.isArray(bundle.cases) ||
    bundle.cases.length !== 4 ||
    !bundle.priorAttempt ||
    !bundle.policyMigration ||
    !bundle.attemptCost ||
    bundle.priorAttempt.rawSha256 !== GATE2_ATTEMPT_1_LINEAGE.rawSha256 ||
    bundle.priorAttempt.evidenceDigest !== GATE2_ATTEMPT_1_LINEAGE.evidenceDigest ||
    bundle.priorAttempt.appCommit !== GATE2_ATTEMPT_1_LINEAGE.appCommit ||
    bundle.priorAttempt.runId !== GATE2_ATTEMPT_1_LINEAGE.runId ||
    typeof bundle.policyMigration.receiptHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(bundle.policyMigration.receiptHash) ||
    typeof bundle.passedCount !== "number" ||
    typeof bundle.evidenceDigest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(bundle.evidenceDigest)
  ) {
    throw new Error("invalid_calibration_bundle");
  }
  if (process.env.NODE_ENV === "production") {
    await verifyGate2CalibrationBundle(value);
  }
  return bundle as CalibrationBundle;
}

function filename(): string {
  return `toolproof-gate2-calibration-attempt2-${APP_COMMIT.slice(0, 12)}-${new Date()
    .toISOString()
    .replaceAll(/[-:.]/gu, "")}.json`;
}

function downloadBundle(bundle: CalibrationBundle): string {
  const name = filename();
  const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], {
    type: "application/json;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return name;
}

export function ProbeCalibrationResults() {
  const [bundle, setBundle] = useState<CalibrationBundle>();
  const [downloaded, setDownloaded] = useState<string>();
  const [error, setError] = useState<string>();
  const [marker, setMarker] = useState<ProbeClientSessionMarker>();

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const raw = globalThis.sessionStorage.getItem(PROBE_CLIENT_RESULTS_KEY);
        if (!raw) return;
        const marker = parseProbeClientSessionMarker(raw, "/results", APP_COMMIT);
        if (!disposed) setMarker(marker);
        const response = await fetch("/api/probe/reveal", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "X-ToolProof-CSRF": marker.csrfToken
          },
          body: JSON.stringify({ continuation: marker.continuation })
        });
        const value = (await response.json()) as unknown;
        if (!response.ok) {
          const code =
            value &&
            typeof value === "object" &&
            typeof (value as { error?: unknown }).error === "string"
              ? String((value as { error: string }).error)
              : "calibration_reveal_failed";
          throw new Error(code);
        }
        const parsed = await parseBundle(value);
        if (disposed) return;
        setBundle(parsed);
        setDownloaded(downloadBundle(parsed));
      } catch (failure) {
        if (!disposed) {
          setError(failure instanceof Error ? failure.message : "calibration_reveal_failed");
        }
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);

  async function finishSecureRun(): Promise<void> {
    if (!marker) return;
    const response = await fetch("/api/probe/reveal", {
      method: "DELETE",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "X-ToolProof-CSRF": marker.csrfToken }
    });
    if (!response.ok) {
      setError("calibration_acknowledgement_failed");
      return;
    }
    globalThis.sessionStorage.removeItem(PROBE_CLIENT_RESULTS_KEY);
    setMarker(undefined);
  }

  if (bundle) {
    return (
      <section className="panel calibration-results" aria-labelledby="calibration-results-title">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Gate 2 · final attempt terminal evidence</span>
            <h2 id="calibration-results-title">Final four fresh-context trials sealed</h2>
          </div>
          <span className="status-pill status-ready">
            {bundle.passedCount}/{bundle.caseCount} verified
          </span>
        </div>
        <p>
          This final four-case attempt is calibration-only and permanently excluded from the scored
          benchmark. It has its own denominator; the retained first attempt remains separate rather
          than being merged or relabeled.
        </p>
        <ul className="result-list" aria-label="Calibration case results">
          {bundle.cases.map((row, index) => (
            <li key={row.ordinal ?? index}>
              <strong>Final-attempt trial {index + 1}</strong>
              <span>{row.evaluation?.passed ? "Verified" : "Failed"}</span>
              <small>Observed action: {row.evaluation?.observedTool ?? "no native call"}</small>
            </li>
          ))}
        </ul>
        <div className="runtime-receipt">
          <span>Retained first attempt · separate evidence</span>
          <strong>
            {bundle.priorAttempt.passedCount}/{bundle.priorAttempt.caseCount} verified · no native
            dispatch
          </strong>
          <small>
            Raw SHA-256 {bundle.priorAttempt.rawSha256} · evidence digest{" "}
            {bundle.priorAttempt.evidenceDigest}
          </small>
        </div>
        <div className="runtime-receipt">
          <span>Bound policy migration</span>
          <strong>{bundle.policyMigration.receiptHash}</strong>
          <small>
            Four previously unused reference grants were reallocated without changing the 160-call
            or USD $10 lifetime ceilings.
          </small>
        </div>
        <div className="runtime-receipt">
          <span>Attempt-only accounted cost</span>
          <strong>{bundle.attemptCost.attemptAccountedNanoUsd} nano-USD</strong>
          <small>
            Cumulative known cost {bundle.attemptCost.terminalCumulativeKnownAccountedNanoUsd}
            nano-USD, less retained prior cost{" "}
            {bundle.attemptCost.priorCumulativeKnownAccountedNanoUsd} nano-USD.
          </small>
        </div>
        <div className="runtime-receipt">
          <span>Evidence digest</span>
          <strong>{bundle.evidenceDigest}</strong>
          <small>{downloaded ? `Download requested: ${downloaded}` : "Preparing download…"}</small>
        </div>
        <div className="button-row">
          <button
            className="button button-secondary"
            onClick={() => setDownloaded(downloadBundle(bundle))}
          >
            Download verified calibration evidence again
          </button>
          <button
            className="button button-secondary"
            disabled={!marker}
            onClick={() => void finishSecureRun()}
          >
            Evidence saved — finish secure run
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="empty-results" aria-labelledby="empty-results-title">
      <div className="empty-glyph" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div>
        <h2 id="empty-results-title">
          {error ? "Calibration evidence could not be revealed." : "No terminal evidence yet."}
        </h2>
        <p>
          {error
            ? `The sealed result remains unrevealed (${error}). Return to the Lab only after preserving this state.`
            : "Complete the isolated final four-case calibration in the Lab. Scored benchmark results remain locked until the later freeze gate."}
        </p>
      </div>
    </section>
  );
}
