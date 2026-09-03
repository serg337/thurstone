"use client";

import { useEffect, useState } from "react";

import {
  byoaHandoffOpenRequestSchema,
  clearByoaHandoffUrl,
  clearRemoteByoaSession
} from "@/lib/demo/agent-handoff";
import {
  BYOA_RUNNER_V2_MARKER_KEY,
  byoaHandoffOpenRequestV2Schema,
  clearRemoteByoaSessionV2,
  handoffClaimFailureReasonSchema,
  handoffClaimFailureReceiptSchema,
  type HandoffClaimFailureReceiptV1,
  type HandoffClaimFailureReasonV1
} from "@/lib/demo/agent-handoff-v2";
import { freshContextForByoaHandoffV2 } from "@/lib/demo/handoff-context-v2";
import {
  clearAgentVisibleRunProjection,
  clearAgentVisibleRunProjectionV2
} from "@/lib/demo/agent-projection";
import { clearByoaAgentSession } from "@/lib/demo/agent-session";
import { clearByoaAgentSessionV2 } from "@/lib/demo/agent-session-v2";
import { clearByoaResult } from "@/lib/demo/byoa-result-storage";
import { clearByoaResultV3 } from "@/lib/demo/byoa-result-storage-v3";
import { clearRegressionRerun } from "@/lib/demo/regression-rerun";
import { THURSTONE_SUITE_STORAGE_KEY } from "@/lib/demo/suite-storage";

export function HandoffOpener() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [contaminated, setContaminated] = useState(false);
  const [claimFailure, setClaimFailure] = useState<HandoffClaimFailureReceiptV1 | null>(null);

  function failureMessage(reason: HandoffClaimFailureReasonV1): string {
    if (reason === "expired") return "This handoff expired before it was received.";
    if (reason === "already_claimed")
      return "This handoff was already claimed by another browser context.";
    if (reason === "binding_mismatch")
      return "This handoff did not match its durable claim binding.";
    if (reason === "ledger_record_missing") return "The durable handoff record was missing.";
    if (reason === "revoked") return "The owner revoked this handoff before receipt.";
    if (reason === "invalid_token")
      return "This handoff token was malformed or failed integrity verification.";
    return "The durable handoff ledger was unavailable.";
  }

  useEffect(() => {
    queueMicrotask(() =>
      setContaminated(window.sessionStorage.getItem(THURSTONE_SUITE_STORAGE_KEY) !== null)
    );
  }, []);

  async function receive() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      if (window.sessionStorage.getItem(THURSTONE_SUITE_STORAGE_KEY) !== null) {
        throw new Error(
          "This task inherited owner-side contract data. Close it and open the opaque link in a genuinely fresh task."
        );
      }
      const token = window.location.hash.slice(1);
      const usesV2 = token.startsWith("tbh2.");
      const body = usesV2
        ? byoaHandoffOpenRequestV2Schema.parse({
            token,
            freshContextId: await freshContextForByoaHandoffV2(window.sessionStorage, token)
          })
        : byoaHandoffOpenRequestSchema.parse({ token });
      const response = await fetch("/api/demo/handoff/open", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Thurstone-Request": "byoa-handoff"
        },
        body: JSON.stringify(body),
        cache: "no-store"
      });
      if (!response.ok) {
        const raw = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        const reasonResult = handoffClaimFailureReasonSchema.safeParse(raw?.reason);
        const receiptResult = handoffClaimFailureReceiptSchema.safeParse(raw?.claimFailure);
        const reason = reasonResult.success ? reasonResult.data : "ledger_unavailable";
        setClaimFailure(receiptResult.success ? receiptResult.data : null);
        throw new Error(failureMessage(reason));
      }

      clearByoaAgentSession(window.sessionStorage);
      clearByoaAgentSessionV2(window.sessionStorage);
      clearAgentVisibleRunProjection(window.sessionStorage);
      clearAgentVisibleRunProjectionV2(window.sessionStorage);
      clearByoaResult(window.sessionStorage);
      clearByoaResultV3(window.sessionStorage);
      clearRegressionRerun(window.sessionStorage);
      clearRemoteByoaSession(window.sessionStorage);
      clearRemoteByoaSessionV2(window.sessionStorage);
      clearByoaHandoffUrl(window.sessionStorage);
      if (usesV2) window.sessionStorage.setItem(BYOA_RUNNER_V2_MARKER_KEY, "2");
      else window.sessionStorage.removeItem(BYOA_RUNNER_V2_MARKER_KEY);
      window.history.replaceState(null, "", "/demo/handoff");
      window.location.replace("/demo/run");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The handoff could not be opened.");
      setBusy(false);
    }
  }

  return (
    <section className="agent-runner-loading" aria-live="polite">
      <p className="eyebrow">Fresh-agent handoff · not yet claimed</p>
      <h1>
        {error || contaminated
          ? "Open a genuinely fresh handoff."
          : "Receive this test in ChatGPT's Browser."}
      </h1>
      <p>
        Opening this page does not consume the one-time test. In ChatGPT desktop&apos;s built-in
        Browser, explicitly receive it below. The agent-visible request and frozen catalog enter
        only after that action.
      </p>
      <strong className="agent-runner-recovery">
        Do not receive this link in ordinary Chrome or Chrome extension side chat. Close that tab
        and use a fresh ChatGPT task: select <code>Browser</code> from the <code>@</code> menu, then
        paste the complete <code>Open</code> command after that mention.
      </strong>
      {error || contaminated ? (
        <div className="agent-runner-recovery">
          <p>
            {error ??
              "This task contains owner-side suite data. It cannot qualify as an answer-isolated fresh context."}{" "}
            Close this task and return to the owner tab; this page does not link to the builder.
          </p>
          {claimFailure ? (
            <dl aria-label="Handoff claim failure receipt">
              <div>
                <dt>Verified category</dt>
                <dd>{claimFailure.reason.replaceAll("_", " ")}</dd>
              </div>
              <div>
                <dt>Observed</dt>
                <dd>{new Date(claimFailure.observedAtMs).toLocaleTimeString()}</dd>
              </div>
              <div>
                <dt>Exposure</dt>
                <dd>No request, tools, or invocation</dd>
              </div>
            </dl>
          ) : null}
        </div>
      ) : (
        <button
          className="button button-primary"
          type="button"
          disabled={busy}
          onClick={() => void receive()}
        >
          {busy ? "Claiming one fresh context…" : "Receive isolated test"}
        </button>
      )}
    </section>
  );
}
