"use client";

import {
  PROBE_CLIENT_LAB_SESSION_KEY,
  PROBE_CLIENT_LAUNCH_KEY,
  PROBE_CLIENT_RESULTS_KEY
} from "@/lib/probe/client-session";

export const RETIRED_PROBE_CLIENT_MARKER_KEYS = Object.freeze([
  "toolproof:probe-calibration-session@1",
  "toolproof:probe-calibration-results@1",
  "toolproof:probe-final-calibration-session@2",
  "toolproof:probe-final-calibration-results@2"
]);

const ALL_PROBE_CLIENT_MARKER_KEYS = Object.freeze([
  ...RETIRED_PROBE_CLIENT_MARKER_KEYS,
  PROBE_CLIENT_LAB_SESSION_KEY,
  PROBE_CLIENT_RESULTS_KEY
]);

export type ProbeSessionCleanupResult =
  | { readonly status: "cleared" }
  | { readonly status: "recovery-required"; readonly code: string }
  | { readonly status: "failed"; readonly code: string };

export function clearProbeClientMarkers(): void {
  for (const key of ALL_PROBE_CLIENT_MARKER_KEYS) globalThis.sessionStorage.removeItem(key);
  globalThis.localStorage.removeItem(PROBE_CLIENT_LAUNCH_KEY);
}

function responseCode(value: unknown, fallback: string): string {
  return value &&
    typeof value === "object" &&
    typeof (value as { error?: unknown }).error === "string"
    ? String((value as { error: string }).error)
    : fallback;
}

/**
 * Requests cleanup from the server-held guard. Client state is removed only after the server proves
 * that cleanup is safe; every rejection and transport failure preserves all markers.
 */
export async function requestProbeSessionCleanup(): Promise<ProbeSessionCleanupResult> {
  let response: Response;
  try {
    response = await fetch("/api/probe/session", {
      method: "DELETE",
      credentials: "same-origin",
      cache: "no-store"
    });
  } catch {
    return { status: "failed", code: "session_cleanup_unavailable" };
  }

  let value: unknown;
  try {
    value = (await response.json()) as unknown;
  } catch {
    value = null;
  }
  if (!response.ok) {
    const code = responseCode(value, "session_cleanup_failed");
    return response.status === 409
      ? { status: "recovery-required", code }
      : { status: "failed", code };
  }

  clearProbeClientMarkers();
  globalThis.location.reload();
  return { status: "cleared" };
}
