import { describe, expect, it } from "vitest";

import {
  PROBE_CLIENT_SESSION_VERSION,
  parseProbeClientSessionMarker,
  serializeProbeClientSessionMarker
} from "@/lib/probe/client-session";

const marker = {
  version: PROBE_CLIENT_SESSION_VERSION,
  csrfToken: "a".repeat(43),
  continuation: `tpse1.${"x".repeat(48)}.encrypted.marker`,
  buildCommit: "b".repeat(40),
  expiresAt: 1_800_000_000,
  path: "/lab" as const
};

describe("Probe client session marker", () => {
  it("round-trips only opaque session controls", () => {
    const raw = serializeProbeClientSessionMarker(marker);
    expect(
      parseProbeClientSessionMarker(raw, "/lab", marker.buildCommit, 1_700_000_000_000)
    ).toEqual(marker);
    expect(raw).not.toMatch(/request|decision|result|expected|score|tool/iu);
  });

  it("rejects wrong paths, builds, expiry, extras, and malformed continuations", () => {
    const raw = serializeProbeClientSessionMarker(marker);
    expect(() =>
      parseProbeClientSessionMarker(raw, "/results", marker.buildCommit, 1_700_000_000_000)
    ).toThrowError(/stale/u);
    expect(() =>
      parseProbeClientSessionMarker(raw, "/lab", "c".repeat(40), 1_700_000_000_000)
    ).toThrowError(/stale/u);
    expect(() =>
      parseProbeClientSessionMarker(raw, "/lab", marker.buildCommit, marker.expiresAt * 1_000)
    ).toThrowError(/stale/u);
    expect(() =>
      parseProbeClientSessionMarker(
        JSON.stringify({ ...marker, expectedTool: "cart_get" }),
        "/lab",
        marker.buildCommit,
        1_700_000_000_000
      )
    ).toThrow();
    expect(() =>
      parseProbeClientSessionMarker(
        JSON.stringify({ ...marker, version: 1 }),
        "/lab",
        marker.buildCommit,
        1_700_000_000_000
      )
    ).toThrow();
  });
});
