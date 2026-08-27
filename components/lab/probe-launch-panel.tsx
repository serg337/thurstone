"use client";

import { useEffect, useState } from "react";

import {
  PROBE_CLIENT_LAB_SESSION_KEY,
  PROBE_CLIENT_SESSION_VERSION,
  serializeProbeClientSessionMarker
} from "@/lib/probe/client-session";

const APP_COMMIT = process.env.NEXT_PUBLIC_TOOLPROOF_COMMIT_SHA?.trim() || "unversioned";

interface PublicProbeStatus {
  readonly status?: string;
  readonly enabled?: boolean;
  readonly activation?: string;
  readonly reason?: string;
}

interface StartReceipt {
  readonly version: 1;
  readonly csrfToken: string;
  readonly continuation: string;
  readonly buildCommit: string;
  readonly expiresAt: number;
  readonly inferencePerformed: false;
}

export function ProbeLaunchPanel() {
  const [status, setStatus] = useState<PublicProbeStatus>();
  const [statusError, setStatusError] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/probe/status", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal
    })
      .then(async (response) => {
        const body = (await response.json()) as PublicProbeStatus;
        setStatus(body);
        setStatusError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatusError(true);
      });
    return () => controller.abort();
  }, []);

  async function start(): Promise<void> {
    if (starting || status?.enabled !== true) return;
    setStarting(true);
    setStartError(undefined);
    try {
      const response = await fetch("/api/probe/session", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "start-four-case-calibration" })
      });
      const body = (await response.json()) as StartReceipt | { error?: unknown };
      if (!response.ok || !("version" in body) || body.version !== 1) {
        throw new Error(
          typeof (body as { error?: unknown }).error === "string"
            ? String((body as { error: string }).error)
            : "calibration_start_failed"
        );
      }
      if (body.buildCommit !== APP_COMMIT) throw new Error("calibration_build_mismatch");
      const marker = serializeProbeClientSessionMarker({
        version: PROBE_CLIENT_SESSION_VERSION,
        csrfToken: body.csrfToken,
        continuation: body.continuation,
        buildCommit: body.buildCommit,
        expiresAt: body.expiresAt,
        path: "/lab"
      });
      globalThis.sessionStorage.setItem(PROBE_CLIENT_LAB_SESSION_KEY, marker);
      if (globalThis.sessionStorage.getItem(PROBE_CLIENT_LAB_SESSION_KEY) !== marker) {
        throw new Error("calibration_marker_write_failed");
      }
      globalThis.location.reload();
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "calibration_start_failed");
      setStarting(false);
    }
  }

  const enabled = status?.enabled === true && status.activation === "calibration";
  return (
    <section className="panel probe-launch-panel" aria-labelledby="probe-launch-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Gate 2 · model selection</span>
          <h2 id="probe-launch-title">Fresh-context Probe calibration</h2>
        </div>
        <span className={`status-pill ${enabled ? "status-ready" : "status-neutral"}`}>
          {enabled ? "Ready" : "Inactive"}
        </span>
      </div>
      <p>
        The bounded lane runs four explicitly non-scored synthetic requests. Each uses a fresh Lab
        document, one stateless model decision, at most one native WebMCP call, verified resets, and
        sealed evidence.
      </p>
      <div className="button-row">
        <button
          className="button button-primary"
          disabled={!enabled || starting}
          onClick={() => void start()}
        >
          {starting ? "Starting secure calibration…" : "Run four-case calibration"}
        </button>
      </div>
      <small aria-live="polite">
        {statusError
          ? "Probe status is unavailable."
          : (status?.reason ?? "Checking the server-held guard and activation…")}
      </small>
      {startError ? (
        <p className="error-text" role="alert">
          Calibration did not start ({startError}). No model call was made by this action.
        </p>
      ) : null}
    </section>
  );
}
