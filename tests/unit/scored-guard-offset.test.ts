import type { ProbeGuardStatus } from "@/lib/probe/ledger";
import {
  ScoredGuardError,
  assertScoredPredecessorDisposition,
  assertScoredPhaseCanStart,
  assertScoredReplacementOffset
} from "@/lib/scored/guard.server";
import { assertScoredFrozenPhaseExecution } from "@/lib/scored/service.server";
import { describe, expect, it } from "vitest";

function guard(baseline: number, repair = 0, revised = 0): ProbeGuardStatus {
  const total = 17 + baseline + repair + revised;
  return {
    status: "open",
    guardInstanceId: "guard_test",
    policyHash: "1".repeat(64),
    scriptHash: "2".repeat(64),
    initializedCommit: "a".repeat(40),
    claimedCalls: total,
    committedNanoUsd: total * 62_500_000,
    pendingCount: 0,
    knownCount: total,
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
    purposeCounts: { calibration: 17, baseline, repair, revised, judge: 0 },
    inflightCount: 0,
    sequence: total,
    haltMarkerPresent: false,
    uncertainMarkerPresent: false
  };
}

describe("scored phase call offsets", () => {
  it("admits the first baseline only at offset zero", () => {
    expect(() =>
      assertScoredPhaseCanStart(guard(0), "baseline", {
        phaseCallOffset: 0,
        repairPhaseCallOffset: 0,
        predecessorProtocolHash: null,
        predecessorEvidenceDigest: null,
        predecessorRunId: null,
        predecessorDisposition: null
      })
    ).not.toThrow();
  });

  it("admits a preserved replacement offset with a predecessor commitment", () => {
    expect(() =>
      assertScoredPhaseCanStart(guard(7), "baseline", {
        phaseCallOffset: 7,
        repairPhaseCallOffset: 0,
        predecessorProtocolHash: "d".repeat(64),
        predecessorEvidenceDigest: "e".repeat(64),
        predecessorRunId: `run_${"r".repeat(22)}`,
        predecessorDisposition: "invalid-schedule"
      })
    ).not.toThrow();
    expect(() =>
      assertScoredPhaseCanStart(guard(0), "baseline", {
        phaseCallOffset: 0,
        repairPhaseCallOffset: 0,
        predecessorProtocolHash: "d".repeat(64),
        predecessorEvidenceDigest: "e".repeat(64),
        predecessorRunId: `run_${"r".repeat(22)}`,
        predecessorDisposition: "invalid-schedule"
      })
    ).not.toThrow();
  });

  it("admits the exact successor baseline and later revised topology", () => {
    expect(() =>
      assertScoredPhaseCanStart(guard(24, 1), "baseline", {
        phaseCallOffset: 24,
        repairPhaseCallOffset: 1,
        predecessorProtocolHash: "d".repeat(64),
        predecessorEvidenceDigest: "e".repeat(64),
        predecessorRunId: `run_${"r".repeat(22)}`,
        predecessorDisposition: "superseded-protocol"
      })
    ).not.toThrow();
    expect(() =>
      assertScoredPhaseCanStart(guard(48, 2), "revised", {
        phaseCallOffset: 0,
        repairPhaseCallOffset: 1,
        predecessorProtocolHash: null,
        predecessorEvidenceDigest: null,
        predecessorRunId: null,
        predecessorDisposition: null
      })
    ).not.toThrow();
    expect(() =>
      assertScoredPhaseCanStart(guard(34, 1), "baseline", {
        phaseCallOffset: 34,
        repairPhaseCallOffset: 1,
        predecessorProtocolHash: "d".repeat(64),
        predecessorEvidenceDigest: "e".repeat(64),
        predecessorRunId: `run_${"r".repeat(22)}`,
        predecessorDisposition: "invalid-schedule"
      })
    ).not.toThrow();
    expect(() =>
      assertScoredPhaseCanStart(guard(24, 2), "revised", {
        phaseCallOffset: 0,
        repairPhaseCallOffset: 1,
        predecessorProtocolHash: null,
        predecessorEvidenceDigest: null,
        predecessorRunId: null,
        predecessorDisposition: null
      })
    ).toThrow(/revised_phase_not_ready/u);
  });

  it("rejects hidden grants, missing predecessor evidence, and offsets that cannot fit 24 calls", () => {
    expect(() =>
      assertScoredPhaseCanStart(guard(7), "baseline", {
        phaseCallOffset: 6,
        repairPhaseCallOffset: 0,
        predecessorProtocolHash: "d".repeat(64),
        predecessorEvidenceDigest: "e".repeat(64),
        predecessorRunId: `run_${"r".repeat(22)}`,
        predecessorDisposition: "invalid-schedule"
      })
    ).toThrow(ScoredGuardError);
    expect(() =>
      assertScoredPhaseCanStart(guard(7), "baseline", {
        phaseCallOffset: 7,
        repairPhaseCallOffset: 0,
        predecessorProtocolHash: null,
        predecessorEvidenceDigest: null,
        predecessorRunId: null,
        predecessorDisposition: null
      })
    ).toThrow(ScoredGuardError);
    expect(() =>
      assertScoredPhaseCanStart(guard(47), "baseline", {
        phaseCallOffset: 47,
        repairPhaseCallOffset: 0,
        predecessorProtocolHash: "d".repeat(64),
        predecessorEvidenceDigest: "e".repeat(64),
        predecessorRunId: `run_${"r".repeat(22)}`,
        predecessorDisposition: "invalid-schedule"
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

  it("distinguishes invalid schedules from complete superseded protocols", () => {
    expect(() =>
      assertScoredPredecessorDisposition({
        disposition: "invalid-schedule",
        currentProtocolHash: "b".repeat(64),
        predecessorProtocolHash: "a".repeat(64),
        predecessorTerminalStatus: "terminal-invalid",
        predecessorCompletedCount: 11
      })
    ).not.toThrow();
    expect(() =>
      assertScoredPredecessorDisposition({
        disposition: "superseded-protocol",
        currentProtocolHash: "b".repeat(64),
        predecessorProtocolHash: "a".repeat(64),
        predecessorTerminalStatus: "terminal-complete",
        predecessorCompletedCount: 24
      })
    ).not.toThrow();
    for (const input of [
      {
        disposition: "invalid-schedule" as const,
        currentProtocolHash: "b".repeat(64),
        predecessorProtocolHash: "a".repeat(64),
        predecessorTerminalStatus: "terminal-complete" as const,
        predecessorCompletedCount: 24
      },
      {
        disposition: "superseded-protocol" as const,
        currentProtocolHash: "a".repeat(64),
        predecessorProtocolHash: "a".repeat(64),
        predecessorTerminalStatus: "terminal-complete" as const,
        predecessorCompletedCount: 24
      }
    ]) {
      expect(() => assertScoredPredecessorDisposition(input)).toThrow(
        /scored_predecessor_disposition_mismatch/u
      );
    }
  });

  it("binds successor offsets and predecessor identity to the frozen lineage", () => {
    const lineage = {
      lineageHash: "f".repeat(64),
      disposition: "superseded-protocol" as const,
      predecessor: {
        frozenProtocolHash: "d".repeat(64),
        evidenceDigest: "e".repeat(64),
        runId: `run_${"r".repeat(22)}`
      },
      phaseCallOffsets: { baseline: 24 as const, repair: 1 as const, revised: 0 as const }
    };
    const baseline = {
      phaseCallOffset: 24,
      repairPhaseCallOffset: 1 as const,
      predecessorProtocolHash: lineage.predecessor.frozenProtocolHash,
      predecessorEvidenceDigest: lineage.predecessor.evidenceDigest,
      predecessorRunId: lineage.predecessor.runId,
      predecessorDisposition: "superseded-protocol" as const
    };
    expect(() =>
      assertScoredFrozenPhaseExecution({
        lineage,
        frozenSuccessorLineageHash: lineage.lineageHash,
        phase: "baseline",
        execution: baseline
      })
    ).not.toThrow();
    expect(() =>
      assertScoredFrozenPhaseExecution({
        lineage,
        frozenSuccessorLineageHash: lineage.lineageHash,
        phase: "revised",
        execution: {
          phaseCallOffset: 0,
          repairPhaseCallOffset: 1,
          predecessorProtocolHash: null,
          predecessorEvidenceDigest: null,
          predecessorRunId: null,
          predecessorDisposition: null
        }
      })
    ).not.toThrow();
    for (const changed of [
      { frozenSuccessorLineageHash: "0".repeat(64), execution: baseline },
      {
        frozenSuccessorLineageHash: lineage.lineageHash,
        execution: { ...baseline, predecessorEvidenceDigest: "0".repeat(64) }
      }
    ]) {
      expect(() =>
        assertScoredFrozenPhaseExecution({
          lineage,
          phase: "baseline",
          ...changed
        })
      ).toThrow(/scored_execution_freeze_lineage_mismatch/u);
    }
  });
});
