import type { ProbeGuardStatus } from "@/lib/probe/ledger";
import {
  ScoredGuardError,
  assertScoredPhaseCanStart,
  assertScoredReplacementOffset
} from "@/lib/scored/guard.server";
import { describe, expect, it } from "vitest";

function guard(baseline: number): ProbeGuardStatus {
  return {
    status: "open",
    guardInstanceId: "guard_test",
    policyHash: "1".repeat(64),
    scriptHash: "2".repeat(64),
    initializedCommit: "a".repeat(40),
    claimedCalls: 17 + baseline,
    committedNanoUsd: (17 + baseline) * 62_500_000,
    pendingCount: 0,
    knownCount: 17 + baseline,
    uncertainCount: 0,
    knownActualNanoUsd: 0,
    uncertainUpperNanoUsd: 0,
    policyVersion: "toolproof-probe-policy@0.5.0",
    model: "gpt-5.6-terra",
    globalCallLimit: 160,
    spendCeilingNanoUsd: 10_000_000_000,
    perCallReservationNanoUsd: 62_500_000,
    maxConcurrency: 1,
    challengeClosesAtMs: Date.parse("2026-09-24T00:00:00.000Z"),
    purposeLimits: { calibration: 17, baseline: 70, repair: 2, revised: 70, judge: 1 },
    purposeCounts: { calibration: 17, baseline, repair: 0, revised: 0, judge: 0 },
    inflightCount: 0,
    sequence: 17 + baseline,
    haltMarkerPresent: false,
    uncertainMarkerPresent: false
  };
}

describe("scored phase call offsets", () => {
  it("admits the first baseline only at offset zero", () => {
    expect(() =>
      assertScoredPhaseCanStart(guard(0), "baseline", {
        phaseCallOffset: 0,
        predecessorProtocolHash: null,
        predecessorEvidenceDigest: null,
        predecessorRunId: null
      })
    ).not.toThrow();
  });

  it("admits a preserved replacement offset with a predecessor commitment", () => {
    expect(() =>
      assertScoredPhaseCanStart(guard(7), "baseline", {
        phaseCallOffset: 7,
        predecessorProtocolHash: "d".repeat(64),
        predecessorEvidenceDigest: "e".repeat(64),
        predecessorRunId: `run_${"r".repeat(22)}`
      })
    ).not.toThrow();
    expect(() =>
      assertScoredPhaseCanStart(guard(0), "baseline", {
        phaseCallOffset: 0,
        predecessorProtocolHash: "d".repeat(64),
        predecessorEvidenceDigest: "e".repeat(64),
        predecessorRunId: `run_${"r".repeat(22)}`
      })
    ).not.toThrow();
  });

  it("rejects hidden grants, missing predecessor evidence, and offsets that cannot fit 24 calls", () => {
    expect(() =>
      assertScoredPhaseCanStart(guard(7), "baseline", {
        phaseCallOffset: 6,
        predecessorProtocolHash: "d".repeat(64),
        predecessorEvidenceDigest: "e".repeat(64),
        predecessorRunId: `run_${"r".repeat(22)}`
      })
    ).toThrow(ScoredGuardError);
    expect(() =>
      assertScoredPhaseCanStart(guard(7), "baseline", {
        phaseCallOffset: 7,
        predecessorProtocolHash: null,
        predecessorEvidenceDigest: null,
        predecessorRunId: null
      })
    ).toThrow(ScoredGuardError);
    expect(() =>
      assertScoredPhaseCanStart(guard(47), "baseline", {
        phaseCallOffset: 47,
        predecessorProtocolHash: "d".repeat(64),
        predecessorEvidenceDigest: "e".repeat(64),
        predecessorRunId: `run_${"r".repeat(22)}`
      })
    ).toThrow(ScoredGuardError);
  });

  it("requires the replacement offset to equal predecessor offset plus exact grants", () => {
    expect(() =>
      assertScoredReplacementOffset({
        phaseCallOffset: 11,
        predecessorPhaseCallOffset: 7,
        predecessorProviderGrants: 4
      })
    ).not.toThrow();
    expect(() =>
      assertScoredReplacementOffset({
        phaseCallOffset: 0,
        predecessorPhaseCallOffset: 0,
        predecessorProviderGrants: 0
      })
    ).not.toThrow();
    for (const phaseCallOffset of [10, 12]) {
      expect(() =>
        assertScoredReplacementOffset({
          phaseCallOffset,
          predecessorPhaseCallOffset: 7,
          predecessorProviderGrants: 4
        })
      ).toThrow(/scored_predecessor_call_delta_mismatch/u);
    }
  });
});
