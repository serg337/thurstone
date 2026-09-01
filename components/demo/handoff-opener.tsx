"use client";

import { useEffect, useState } from "react";

import {
  byoaHandoffOpenRequestSchema,
  clearByoaHandoffUrl,
  clearRemoteByoaSession
} from "@/lib/demo/agent-handoff";
import { clearAgentVisibleRunProjection } from "@/lib/demo/agent-projection";
import { clearByoaAgentSession } from "@/lib/demo/agent-session";
import { clearByoaResult } from "@/lib/demo/byoa-result-storage";
import { clearRegressionRerun } from "@/lib/demo/regression-rerun";

export function HandoffOpener() {
  const [error, setError] = useState<string>();

  useEffect(() => {
    let disposed = false;
    async function open() {
      try {
        const token = window.location.hash.slice(1);
        const body = byoaHandoffOpenRequestSchema.parse({ token });
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
          clearAgentVisibleRunProjection(window.sessionStorage);
          clearByoaResult(window.sessionStorage);
          clearRegressionRerun(window.sessionStorage);
          clearRemoteByoaSession(window.sessionStorage);
          clearByoaHandoffUrl(window.sessionStorage);
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
        <a className="button button-primary" href="/demo">
          Return to Demo
        </a>
      ) : null}
    </section>
  );
}
