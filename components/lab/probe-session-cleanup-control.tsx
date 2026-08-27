"use client";

import { useState } from "react";

import { requestProbeSessionCleanup } from "@/lib/probe/client-session-cleanup";

export function ProbeSessionCleanupControl() {
  const [state, setState] = useState<"idle" | "working" | "recovery" | "failed">("idle");
  const [code, setCode] = useState<string>();

  async function cleanup(): Promise<void> {
    if (state === "working") return;
    setState("working");
    setCode(undefined);
    const result = await requestProbeSessionCleanup();
    if (result.status === "cleared") return;
    setCode(result.code);
    setState(result.status === "recovery-required" ? "recovery" : "failed");
  }

  return (
    <div className="probe-session-cleanup">
      <button
        className="button button-secondary"
        disabled={state === "working"}
        onClick={() => void cleanup()}
      >
        {state === "working" ? "Checking durable guard…" : "Clear unstarted session"}
      </button>
      <small>Cleanup succeeds only when the server proves that no grant is in flight.</small>
      {state === "recovery" ? (
        <p className="error-text" role="alert">
          Recovery is required ({code}). This tab, cookie, and every opaque marker were preserved.
        </p>
      ) : null}
      {state === "failed" ? (
        <p className="error-text" role="alert">
          Cleanup could not be verified ({code}). No local state was removed.
        </p>
      ) : null}
    </div>
  );
}
