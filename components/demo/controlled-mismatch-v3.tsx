"use client";

import { useState } from "react";

import styles from "@/components/demo/controlled-mismatch-v3.module.css";
import {
  CONTROLLED_MISMATCH_LABEL,
  runControlledMismatchV3,
  type ControlledMismatchRunV3
} from "@/lib/demo/controlled-mismatch-v3";
import type { RuntimeModelContext } from "@/lib/webmcp/runtime";

function pendingLabel(
  value: ControlledMismatchRunV3["result"]["trustedStateAfter"]["value"]["pendingCheckout"]
): string {
  return value === null ? "No pending checkout" : `Pending · ${value.status}`;
}

function downloadControlledEvidence(run: ControlledMismatchRunV3): void {
  const url = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          {
            classification: CONTROLLED_MISMATCH_LABEL,
            rawConsumerResult: run.rawConsumerResult,
            result: run.result
          },
          null,
          2
        )
      ],
      { type: "application/json" }
    )
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `thurstone-controlled-mismatch-${run.result.resultDigest.slice(0, 12)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ControlledMismatchV3({ buildCommit }: { readonly buildCommit: string }) {
  const [run, setRun] = useState<ControlledMismatchRunV3>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function runExample() {
    setBusy(true);
    setError(undefined);
    setRun(undefined);
    try {
      const context = document.modelContext as RuntimeModelContext | undefined;
      if (!context) {
        throw new Error(
          "This browser does not expose the in-page native WebMCP getTools/executeTool consumer."
        );
      }
      setRun(await runControlledMismatchV3({ context, buildCommit }));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The controlled native comparison could not be verified."
      );
    } finally {
      setBusy(false);
    }
  }

  const failedAssertions = run?.result.assertions.filter(({ passed }) => !passed) ?? [];
  const finding = run?.result.diagnostic.findings.find(
    ({ findingId }) => findingId === run.result.diagnostic.primaryFindingId
  );

  return (
    <section className={styles.root} aria-labelledby="controlled-mismatch-v3-title">
      <p className="eyebrow">{CONTROLLED_MISMATCH_LABEL}</p>
      <h2 id="controlled-mismatch-v3-title">See how Thurstone catches a mismatch</h2>
      <p className={styles.intro}>
        Run one deliberately wrong real WebMCP invocation against a fresh checkout contract. This
        deterministic comparison uses no LLM and stays separate from your live result and every
        reference score.
      </p>
      <p className={styles.boundary}>
        Thurstone did not change the behavior. It measured the same native action against the
        owner&apos;s contract, trusted state, and append-only ledger.
      </p>
      <div className={styles.actions}>
        <button
          className="button button-primary"
          type="button"
          disabled={busy}
          onClick={() => void runExample()}
        >
          {busy
            ? "Running one native call…"
            : run
              ? "Run a fresh controlled example"
              : "Run controlled mismatch"}
        </button>
      </div>
      {busy ? (
        <p className={styles.status} role="status" aria-live="polite">
          Registering the exact two-tool catalog, invoking <code>order_review</code> once, and
          evaluating trusted state…
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error} No controlled verdict was created; the live result and scores are unchanged.
        </p>
      ) : null}

      {run ? (
        <div className={styles.columns} data-controlled-verdict={run.result.verdict}>
          <article className={styles.without}>
            <h3>Without verification</h3>
            <p>
              The raw action and result look plausible in isolation: <code>order_review</code>
              completed and returned a valid order summary.
            </p>
            <div className={styles.factBlock}>
              <span>Observed native action</span>
              <strong>
                <code>{run.result.observedTool}</code> · {run.result.handlerOutcome?.status}
              </strong>
            </div>
            <span>Raw consumer result</span>
            <pre className={styles.raw}>{run.rawConsumerResult ?? "null"}</pre>
          </article>

          <article className={styles.with}>
            <h3>With Thurstone</h3>
            <p>
              The same successful-looking response is checked against what the website owner
              required and what the site-owned state actually proves.
            </p>
            <div className={styles.comparison}>
              <div>
                <span>Expected</span>
                <strong>
                  <code>{run.result.selectedExpectedTool}</code>
                </strong>
              </div>
              <div>
                <span>Observed</span>
                <strong>
                  <code>{run.result.observedTool}</code>
                </strong>
              </div>
            </div>

            <strong>{failedAssertions.length} failed contract assertions</strong>
            <ul className={styles.failed}>
              {failedAssertions.map((assertion) => (
                <li key={assertion.assertionId}>
                  <strong>{assertion.label}</strong>
                  <br />
                  <small>{assertion.detail}</small>
                </li>
              ))}
            </ul>

            <div className={styles.facts}>
              <div className={styles.factBlock}>
                <span>Trusted state · before → after</span>
                <strong>
                  Revision {run.result.trustedStateBefore.value.revision} → Revision{" "}
                  {run.result.trustedStateAfter.value.revision}
                </strong>
                <small>{pendingLabel(run.result.trustedStateAfter.value.pendingCheckout)}</small>
              </div>
              <div className={styles.factBlock}>
                <span>Ledger diff</span>
                <strong>
                  {run.result.ledgerDiff.eventCountDelta} native event ·{" "}
                  {run.result.ledgerDiff.stateTransitionCount} state transitions
                </strong>
                <small>The required pending-checkout transition is absent.</small>
              </div>
            </div>

            <div className={styles.nextStep}>
              <strong>Investigation path</strong>
              <p>{finding?.verifiedSummary ?? "Review the measured tool-selection boundary."}</p>
              <p>
                {finding?.nextStep.instruction ??
                  "Compare the expected and observed tool descriptions, then rerun the unchanged case."}
              </p>
              <small>
                Release guidance: {run.result.diagnostic.releaseGuidance.replaceAll("-", " ")}
              </small>
            </div>

            <div className={styles.regression}>
              <strong>Regression preservation</strong>
              <p>
                Preserve this exact Contract v3 case and Result v3 digest, correct the WebMCP
                boundary, then rerun as a linked successor instead of overwriting the mismatch.
              </p>
              <code className={styles.digest}>{run.result.resultDigest}</code>
              <div className={styles.download}>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => downloadControlledEvidence(run)}
                >
                  Export controlled evidence JSON
                </button>
              </div>
            </div>
          </article>
        </div>
      ) : null}
    </section>
  );
}
