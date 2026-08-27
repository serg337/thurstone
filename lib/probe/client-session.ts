import { z } from "zod";

import { PROBE_MAX_CONTINUATION_CHARACTERS } from "@/lib/probe/service-contract";

export const PROBE_CLIENT_LAB_SESSION_KEY = "toolproof:probe-calibration-session@1";
export const PROBE_CLIENT_RESULTS_KEY = "toolproof:probe-calibration-results@1";
export const PROBE_CLIENT_SESSION_VERSION = 1 as const;

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
