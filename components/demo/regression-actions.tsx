"use client";

import { useState } from "react";

import {
  agentVisibleRunProjection,
  createCompiledByoaSession,
  transitionByoaSession,
  writeByoaAgentSession
} from "@/lib/demo/agent-session";
import { writeAgentVisibleRunProjection } from "@/lib/demo/agent-projection";
import { clearByoaResult } from "@/lib/demo/byoa-result-storage";
import { writeContractDraftSeed } from "@/lib/demo/contract-draft-seed";
import { saveRegressionResult, type SavedRegressionEntry } from "@/lib/demo/regression-store";
import { REGRESSION_RERUN_VERSION, writeRegressionRerun } from "@/lib/demo/regression-rerun";
import type { ByoaDemoResultV2 } from "@/lib/demo/result-v2";

function downloadResult(result: ByoaDemoResultV2): void {
  const bytes = JSON.stringify(result, null, 2);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `thurstone-byoa-${result.runId.slice(-12)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function RegressionActions({
  result,
  existingCaseDigest = null
}: {
  readonly result: ByoaDemoResultV2;
  readonly existingCaseDigest?: string | null;
}) {
  const [saved, setSaved] = useState<SavedRegressionEntry>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const eligible = result.verdict === "pass" || result.verdict === "fail";

  async function save(): Promise<SavedRegressionEntry> {
    if (saved) return saved;
    const entry = await saveRegressionResult({
      storage: window.sessionStorage,
      result,
      existingCaseDigest,
      createdAt: new Date().toISOString()
    });
    setSaved(entry);
    window.dispatchEvent(new Event("thurstone:my-tests-change"));
    return entry;
  }

  async function rerun() {
    setBusy(true);
    setError(undefined);
    try {
      const entry = eligible ? await save() : null;
      const now = new Date();
      const session = createCompiledByoaSession({
        runId: `byoa_run_${globalThis.crypto.randomUUID()}`,
        contract: result.contract,
        contractDigest: result.contractDigest,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString()
      });
      const navigating = transitionByoaSession(session, "NAVIGATING", {
        at: new Date().toISOString(),
        reasonCode: "regression_case_rerun"
      });
      writeByoaAgentSession(window.sessionStorage, navigating);
      writeAgentVisibleRunProjection(window.sessionStorage, agentVisibleRunProjection(navigating));
      if (entry) {
        writeRegressionRerun(window.sessionStorage, {
          version: REGRESSION_RERUN_VERSION,
          caseDigest: entry.case.caseDigest,
          previousResultDigest: result.resultDigest
        });
      }
      clearByoaResult(window.sessionStorage);
      window.location.replace("/demo/run");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The regression case could not be rerun."
      );
      setBusy(false);
    }
  }

  function edit() {
    writeContractDraftSeed(window.sessionStorage, result.contract);
    window.location.replace("/demo");
  }

  return (
    <section className="regression-actions" aria-labelledby="regression-actions-title">
      <p className="eyebrow">Next action</p>
      <h2 id="regression-actions-title">Preserve the case, change deliberately, and rerun.</h2>
      <div className="button-row">
        {eligible ? (
          <button
            className="button button-primary"
            type="button"
            disabled={busy}
            onClick={() => void save()}
          >
            {saved ? "Saved in My Tests" : "Save as regression test"}
          </button>
        ) : null}
        <button className="button button-secondary" type="button" disabled={busy} onClick={edit}>
          Edit contract
        </button>
        <button
          className="button button-secondary"
          type="button"
          disabled={busy}
          onClick={() => void rerun()}
        >
          {busy ? "Preparing rerun…" : "Rerun this case"}
        </button>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => downloadResult(result)}
        >
          Export result JSON
        </button>
      </div>
      {saved ? <code className="regression-case-id">Case {saved.case.caseDigest}</code> : null}
      {error ? (
        <p className="workshop-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
