"use client";

import { useState } from "react";

export function ProbeOperatorArm() {
  const [capability, setCapability] = useState("");
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  const [error, setError] = useState<string>();

  async function arm(): Promise<void> {
    if (state === "working" || !capability) return;
    setState("working");
    setError(undefined);
    const submitted = capability;
    setCapability("");
    try {
      const response = await fetch("/api/probe/arm", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability: submitted })
      });
      const value = (await response.json()) as { error?: unknown };
      if (!response.ok) {
        throw new Error(typeof value.error === "string" ? value.error : "operator_arm_failed");
      }
      globalThis.location.replace(new URL("/lab", globalThis.location.href).href);
    } catch (failure) {
      setState("failed");
      setError(failure instanceof Error ? failure.message : "operator_arm_failed");
    }
  }

  return (
    <section className="panel probe-launch-panel" aria-labelledby="operator-arm-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Restricted operator control</span>
          <h1 id="operator-arm-title">Arm the one-time calibration launch</h1>
        </div>
        <span className="status-pill status-neutral">Local operator only</span>
      </div>
      <p>
        Enter the separately delivered one-time capability. It is exchanged in the request body,
        cleared from this document immediately, and never appears in the URL or public status.
      </p>
      <label>
        One-time capability
        <input
          type="password"
          autoComplete="off"
          value={capability}
          onChange={(event) => setCapability(event.currentTarget.value)}
        />
      </label>
      <div className="button-row">
        <button
          className="button button-primary"
          disabled={state === "working" || capability.length !== 43}
          onClick={() => void arm()}
        >
          {state === "working" ? "Arming…" : "Arm this browser"}
        </button>
      </div>
      {error ? (
        <p className="error-text" role="alert">
          The operator launch was not armed ({error}).
        </p>
      ) : null}
    </section>
  );
}
