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
  clearRemoteByoaSessionV2
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
  const [error, setError] = useState<string>();

  useEffect(() => {
    let disposed = false;
    async function open() {
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
        if (!response.ok) throw new Error("This handoff link is invalid or expired.");
        if (!disposed) {
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
        }
      } catch (caught) {
        if (!disposed) {
          setError(caught instanceof Error ? caught.message : "The handoff could not be opened.");
        }
      }
    }
    void open();
    return () => {
      disposed = true;
    };
  }, []);

  return (
    <section className="agent-runner-loading" aria-live="polite">
      <p className="eyebrow">Fresh-agent handoff</p>
      <h1>{error ? "Open a fresh handoff link." : "Opening the isolated test…"}</h1>
      <p>
        {error ??
          "Only the agent-visible request and frozen tool catalog will enter this browser task."}
      </p>
      {error ? (
        <p className="agent-runner-recovery">
          Close this fresh task and return to the owner tab. Create a new handoff there; this
          isolated page does not link back to the answer-bearing builder.
        </p>
      ) : null}
    </section>
  );
}
