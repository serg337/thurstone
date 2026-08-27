import { z } from "zod";

import {
  PROBE_MAX_CONTINUATION_CHARACTERS,
  probeSessionRecoveryResponseSchema
} from "@/lib/probe/service-contract";

export const PROBE_CLIENT_LAB_SESSION_KEY = "toolproof:probe-final-calibration-session@3";
export const PROBE_CLIENT_RESULTS_KEY = "toolproof:probe-final-calibration-results@3";
export const PROBE_CLIENT_LAUNCH_KEY = "toolproof:probe-final-calibration-launch@3";
export const PROBE_CLIENT_SESSION_VERSION = 3 as const;

const markerSchema = z
  .object({
    version: z.literal(PROBE_CLIENT_SESSION_VERSION),
    csrfToken: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/u),
    continuation: z.string().min(32).max(PROBE_MAX_CONTINUATION_CHARACTERS),
    buildCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    expiresAt: z.number().int().positive(),
    path: z.enum(["/lab", "/results"])
  })
  .strict();

export type ProbeClientSessionMarker = z.infer<typeof markerSchema>;

const launchSchema = z
  .object({
    version: z.literal(PROBE_CLIENT_SESSION_VERSION),
    launchId: z.string().regex(/^launch_[A-Za-z0-9_-]{22,64}$/u),
    buildCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    path: z.literal("/lab")
  })
  .strict();

export function probeDocumentId(): string {
  return `document_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
}

export function getOrCreateProbeLaunchId(buildCommit: string): string {
  const existing = globalThis.localStorage.getItem(PROBE_CLIENT_LAUNCH_KEY);
  if (existing) {
    try {
      const parsed = launchSchema.parse(JSON.parse(existing) as unknown);
      if (parsed.buildCommit === buildCommit) return parsed.launchId;
    } catch {
      // Replace malformed or cross-build launch state before any request is sent.
    }
  }
  const marker = launchSchema.parse({
    version: PROBE_CLIENT_SESSION_VERSION,
    launchId: `launch_${globalThis.crypto.randomUUID().replaceAll("-", "")}`,
    buildCommit,
    path: "/lab"
  });
  const serialized = JSON.stringify(marker);
  globalThis.localStorage.setItem(PROBE_CLIENT_LAUNCH_KEY, serialized);
  if (globalThis.localStorage.getItem(PROBE_CLIENT_LAUNCH_KEY) !== serialized) {
    throw new Error("calibration_launch_marker_write_failed");
  }
  return marker.launchId;
}

export function clearProbeLaunchMarker(): void {
  globalThis.localStorage.removeItem(PROBE_CLIENT_LAUNCH_KEY);
}

export function parseProbeClientSessionMarker(
  raw: string,
  expectedPath: "/lab" | "/results",
  expectedBuildCommit: string,
  nowMs: number = Date.now()
): ProbeClientSessionMarker {
  if (new TextEncoder().encode(raw).byteLength > PROBE_MAX_CONTINUATION_CHARACTERS * 2) {
    throw new Error("Probe marker is too large.");
  }
  const marker = markerSchema.parse(JSON.parse(raw) as unknown);
  if (
    marker.path !== expectedPath ||
    marker.buildCommit !== expectedBuildCommit ||
    marker.expiresAt <= Math.floor(nowMs / 1_000)
  ) {
    throw new Error("Probe marker is stale or bound to another build/path.");
  }
  return marker;
}

export function serializeProbeClientSessionMarker(marker: ProbeClientSessionMarker): string {
  return JSON.stringify(markerSchema.parse(marker));
}

export async function recoverProbeClientSession(
  expectedBuildCommit: string,
  documentId: string
): Promise<ProbeClientSessionMarker> {
  const response = await fetch("/api/probe/session", {
    method: "PUT",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent: "recover-final-four-case-calibration", documentId })
  });
  const value = (await response.json()) as unknown;
  if (!response.ok) {
    const code =
      value && typeof value === "object" && typeof (value as { error?: unknown }).error === "string"
        ? String((value as { error: string }).error)
        : "probe_session_recovery_failed";
    throw new Error(code);
  }
  const recovered = probeSessionRecoveryResponseSchema.parse(value);
  if (recovered.buildCommit !== expectedBuildCommit) {
    throw new Error("probe_session_recovery_build_mismatch");
  }
  const marker = markerSchema.parse({
    version: PROBE_CLIENT_SESSION_VERSION,
    csrfToken: recovered.csrfToken,
    continuation: recovered.continuation,
    buildCommit: recovered.buildCommit,
    expiresAt: recovered.expiresAt,
    path: recovered.path
  });
  const key = marker.path === "/results" ? PROBE_CLIENT_RESULTS_KEY : PROBE_CLIENT_LAB_SESSION_KEY;
  const otherKey =
    marker.path === "/results" ? PROBE_CLIENT_LAB_SESSION_KEY : PROBE_CLIENT_RESULTS_KEY;
  const serialized = serializeProbeClientSessionMarker(marker);
  globalThis.sessionStorage.setItem(key, serialized);
  globalThis.sessionStorage.removeItem(otherKey);
  if (globalThis.sessionStorage.getItem(key) !== serialized) {
    throw new Error("probe_session_recovery_marker_write_failed");
  }
  clearProbeLaunchMarker();
  return marker;
}
