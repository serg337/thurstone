"use client";

import { useState } from "react";

import {
  BYOA_HANDOFF_PREPARE_V2_VERSION,
  BYOA_RUNNER_V2_MARKER_KEY,
  byoaHandoffPrepareResponseV2Schema
} from "@/lib/demo/agent-handoff-v2";
import { writeByoaHandoffUrl } from "@/lib/demo/agent-handoff";
import { writeAgentVisibleRunProjectionV2 } from "@/lib/demo/agent-projection";
import { writeByoaAgentSessionV2 } from "@/lib/demo/agent-session-v2";
import {
  createEditableSuiteCopyFromResultV3,
  prepareRegressionRerunV2
} from "@/lib/demo/regression-rerun-v2";
import {
  resultV3ExportJson,
  saveRegressionResultAcrossFreshContextV2,
  type SavedRegressionEntryV2
} from "@/lib/demo/regression-store-v2";
import type { ByoaDemoResultV3 } from "@/lib/demo/result-v3";
import { saveThurstoneContractSuite } from "@/lib/demo/suite-storage";

const APP_COMMIT = process.env.NEXT_PUBLIC_TOOLPROOF_COMMIT_SHA?.trim() || "0".repeat(40);
const HANDOFF_TTL_MS = 10 * 60 * 1000;

function downloadJson(filename: string, bytes: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : "The Result v3 action could not finish safely.";
}

export function RegressionActionsV3({
  result,
  existingCaseDigest = null
}: {
  readonly result: ByoaDemoResultV3;
  readonly existingCaseDigest?: string | null;
}) {
  const [saved, setSaved] = useState<SavedRegressionEntryV2>();
  const [saveDisposition, setSaveDisposition] = useState<
    "new-case" | "appended" | "independent-linked-successor"
  >();
  const [busy, setBusy] = useState<"save" | "export" | "rerun" | "edit">();
  const [error, setError] = useState<string>();
  const eligible = result.verdict === "pass" || result.verdict === "issue";

  async function save(): Promise<SavedRegressionEntryV2> {
    if (saved) return saved;
    const savedResult = await saveRegressionResultAcrossFreshContextV2({
      storage: window.sessionStorage,
      result,
      predecessorCaseDigest: existingCaseDigest,
      createdAt: new Date().toISOString()
    });
    setSaved(savedResult.entry);
    setSaveDisposition(savedResult.disposition);
    window.dispatchEvent(new Event("thurstone:my-tests-v2-change"));
    return savedResult.entry;
  }

  async function saveOnly() {
    setBusy("save");
    setError(undefined);
    try {
      await save();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(undefined);
    }
  }

  async function exportResult() {
    setBusy("export");
    setError(undefined);
    try {
      const bytes = await resultV3ExportJson(result);
      downloadJson(`thurstone-result-v3-${result.runId.slice(-12)}.json`, bytes);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(undefined);
    }
  }

  async function rerun() {
    setBusy("rerun");
    setError(undefined);
    try {
      if (!/^[a-f0-9]{40}$/u.test(APP_COMMIT) || /^0{40}$/u.test(APP_COMMIT)) {
        throw new Error("The deployed build identity is unavailable; a linked rerun cannot arm.");
      }
      const entry = eligible ? await save() : null;
      const created = new Date();
      const preparedRerun = await prepareRegressionRerunV2({
        sourceResult: result,
        regressionCaseDigest: entry?.case.regressionCaseDigest ?? null,
        contractId: `byoa_${globalThis.crypto.randomUUID()}`,
        runId: `byoa_run_${globalThis.crypto.randomUUID()}`,
        buildCommit: APP_COMMIT,
        createdAt: created.toISOString(),
        expiresAt: new Date(created.getTime() + HANDOFF_TTL_MS).toISOString()
      });
      const response = await fetch("/api/demo/handoff/prepare", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Thurstone-Request": "byoa-handoff",
          "X-Thurstone-Origin": window.location.origin
        },
        body: JSON.stringify({
          version: BYOA_HANDOFF_PREPARE_V2_VERSION,
          session: preparedRerun.session,
          projection: preparedRerun.projection
        }),
        cache: "no-store"
      });
      if (!response.ok) throw new Error("The fresh linked handoff could not be prepared.");
      const prepared = byoaHandoffPrepareResponseV2Schema.parse(await response.json());
      writeByoaAgentSessionV2(window.sessionStorage, preparedRerun.session);
      writeAgentVisibleRunProjectionV2(window.sessionStorage, preparedRerun.projection);
      writeByoaHandoffUrl(window.sessionStorage, prepared.handoffUrl);
      window.sessionStorage.setItem(BYOA_RUNNER_V2_MARKER_KEY, "2");
      window.location.replace(
        `/demo/run?source=${encodeURIComponent(preparedRerun.session.runId)}#handoff-source-v2`
      );
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(undefined);
    }
  }

  async function editCopy() {
    setBusy("edit");
    setError(undefined);
    try {
      const suite = await createEditableSuiteCopyFromResultV3({
        sourceResult: result,
        suiteId: `suite_${globalThis.crypto.randomUUID()}`,
        caseId: `case_${globalThis.crypto.randomUUID()}`,
        createdAt: new Date().toISOString()
      });
      await saveThurstoneContractSuite(window.sessionStorage, suite);
      window.location.replace("/demo");
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(undefined);
    }
  }

  return (
    <section
      className="regression-actions regression-actions-v3"
      aria-labelledby="v3-actions-title"
    >
      <p className="eyebrow">Preserve and continue</p>
      <h2 id="v3-actions-title">Keep this evidence, then test the next deliberate change.</h2>
      <p>
        Export is always available. A verified PASS or ISSUE can also become an immutable,
        browser-session regression case; inconclusive or unavailable trials cannot.
      </p>
      <div className="button-row">
        {eligible ? (
          <button
            className="button button-primary"
            type="button"
            disabled={busy !== undefined}
            onClick={() => void saveOnly()}
          >
            {saved ? "Saved as regression" : busy === "save" ? "Saving…" : "Save as regression"}
          </button>
        ) : null}
        <button
          className={eligible ? "button button-secondary" : "button button-primary"}
          type="button"
          disabled={busy !== undefined}
          onClick={() => void exportResult()}
        >
          {busy === "export" ? "Preparing export…" : "Export Result v3 JSON"}
        </button>
        <button
          className="button button-secondary"
          type="button"
          disabled={busy !== undefined}
          onClick={() => void rerun()}
        >
          {busy === "rerun" ? "Preparing fresh handoff…" : "Rerun in a fresh agent"}
        </button>
        <button
          className="button button-secondary"
          type="button"
          disabled={busy !== undefined}
          onClick={() => void editCopy()}
        >
          {busy === "edit" ? "Creating editable copy…" : "Edit a copy"}
        </button>
      </div>
      {!eligible ? (
        <p className="agent-runner-recovery">
          This {result.verdict.toUpperCase()} result cannot be saved as a verified regression case.
          Export it or prepare a genuinely fresh rerun.
        </p>
      ) : null}
      {saved ? (
        <div>
          <code className="regression-case-id">
            Regression case {saved.case.regressionCaseDigest}
          </code>
          {saveDisposition === "independent-linked-successor" ? (
            <p className="agent-runner-recovery">
              This fresh task did not contain the predecessor&apos;s local store. Thurstone saved an
              independent successor entry that retains the verified previous-result digest instead
              of pretending it appended to unavailable browser data.
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="agent-runner-recovery">
        To continue the complete contract suite, return to the original owner task you kept open.
        This isolated result does not link back to that answer-bearing task.
      </p>
      {error ? (
        <p className="workshop-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
