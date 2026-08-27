import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PROBE_CLIENT_LAB_SESSION_KEY,
  PROBE_CLIENT_RESULTS_KEY,
  PROBE_CLIENT_SESSION_VERSION,
  parseProbeClientSessionMarker,
  recoverProbeClientSession,
  serializeProbeClientSessionMarker
} from "@/lib/probe/client-session";
import {
  PROBE_CALIBRATION_ATTEMPT,
  PROBE_CALIBRATION_PROTOCOL_VERSION,
  PROBE_SESSION_RESPONSE_VERSION
} from "@/lib/probe/service-contract";

const marker = {
  version: PROBE_CLIENT_SESSION_VERSION,
  csrfToken: "a".repeat(43),
  continuation: `tpse1.${"x".repeat(48)}.encrypted.marker`,
  buildCommit: "b".repeat(40),
  expiresAt: 1_800_000_000,
  path: "/lab" as const
};

describe("Probe client session marker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.sessionStorage.clear();
  });
  it("round-trips only opaque session controls", () => {
    const raw = serializeProbeClientSessionMarker(marker);
    expect(
      parseProbeClientSessionMarker(raw, "/lab", marker.buildCommit, 1_700_000_000_000)
    ).toEqual(marker);
    expect(raw).not.toMatch(/request|decision|result|expected|score|tool/iu);
  });

  it("rehydrates only an opaque marker from the same-run recovery route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              version: PROBE_SESSION_RESPONSE_VERSION,
              protocolVersion: PROBE_CALIBRATION_PROTOCOL_VERSION,
              attempt: PROBE_CALIBRATION_ATTEMPT,
              status: "recovered",
              csrfToken: "r".repeat(43),
              continuation: `tpse1.${"q".repeat(48)}.opaque-recovery`,
              buildCommit: marker.buildCommit,
              expiresAt: 1_800_000_100,
              recoveryExpiresAt: 1_800_010_000,
              path: "/lab",
              inferencePerformed: false
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
      )
    );
    const recovered = await recoverProbeClientSession(
      marker.buildCommit,
      `document_${"d".repeat(32)}`
    );
    expect(recovered).toMatchObject({ path: "/lab", buildCommit: marker.buildCommit });
    expect(globalThis.sessionStorage.getItem(PROBE_CLIENT_LAB_SESSION_KEY)).toBe(
      serializeProbeClientSessionMarker(recovered)
    );
    expect(globalThis.sessionStorage.getItem(PROBE_CLIENT_RESULTS_KEY)).toBeNull();
    const wire = JSON.stringify((fetch as ReturnType<typeof vi.fn>).mock.calls);
    expect(wire).not.toMatch(/expectedTool|internalTruth|score|priorAttempt/iu);
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
