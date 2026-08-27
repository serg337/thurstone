import { describe, expect, it } from "vitest";

import {
  GATE2_ATTEMPT_1_LINEAGE,
  createGate2PriorAttemptsLineage,
  verifyGate2PriorAttemptsLineage,
  type Gate2PriorMigrationLineageSource
} from "@/lib/evidence/gate2-attempt-lineage";

function source(): Gate2PriorMigrationLineageSource {
  const costs = [2_000_000, 3_000_000, 3_000_000, 3_360_800, 2_750_000] as const;
  const providerHashes = ["1", "2", "3", "4", "5"] as const;
  const settlementHashes = ["6", "7", "8", "9", "a"] as const;
  const usageHashes = ["b", "c", "d", "e", "f"] as const;
  return {
    preserved: { knownActualNanoUsd: costs.reduce((sum, cost) => sum + cost, 0) },
    knownCalls: costs.map((actualNanoUsd, ordinal) => ({
      ordinal,
      jti: `jti_attempt_lineage_${ordinal}`,
      dispatchSequence: ordinal + 1,
      actualNanoUsd,
      providerResponseHash: providerHashes[ordinal]!.repeat(64),
      settlementDigest: settlementHashes[ordinal]!.repeat(64),
      usageHash: usageHashes[ordinal]!.repeat(64)
    }))
  };
}

describe("Gate 2 prior-attempt lineage", () => {
  it("keeps the authentic semantic failure and invalid infrastructure attempt separate", () => {
    const input = source();
    const lineage = createGate2PriorAttemptsLineage(input);

    expect(lineage).toMatchObject({
      mergedIntoCurrentAttempt: false,
      attempt1: GATE2_ATTEMPT_1_LINEAGE,
      attempt2: {
        attempt: 2,
        disposition: "terminal-invalid-infrastructure",
        knownProviderCallCount: 1,
        retainedSemanticRowCount: 0,
        nativeDispatchCount: null,
        runId: null,
        rawSha256: null,
        evidenceDigest: null,
        score: null,
        failure: {
          semanticOutcomeInspected: false,
          reconstructionPermitted: false
        },
        durableCall: input.knownCalls[4],
        knownAccountedNanoUsd: 2_750_000
      },
      cumulative: {
        knownProviderCallCount: 5,
        retainedSemanticRowCount: 4,
        unavailableSemanticRowCount: 1,
        knownAccountedNanoUsd: 14_110_800
      }
    });
    expect("cases" in lineage.attempt2).toBe(false);
    expect("passedCount" in lineage.attempt2).toBe(false);
  });

  it("derives the attempt-2 cost from the exact fifth durable call", () => {
    const input = source();
    const changed = {
      ...input,
      preserved: { knownActualNanoUsd: input.preserved.knownActualNanoUsd + 125_000 },
      knownCalls: input.knownCalls.map((call, index) =>
        index === 4 ? { ...call, actualNanoUsd: call.actualNanoUsd + 125_000 } : call
      )
    };

    expect(createGate2PriorAttemptsLineage(changed).attempt2.knownAccountedNanoUsd).toBe(2_875_000);
  });

  it("rejects missing, duplicated, or cost-inconsistent durable lineage", () => {
    const input = source();
    expect(() =>
      createGate2PriorAttemptsLineage({ ...input, knownCalls: input.knownCalls.slice(0, 4) })
    ).toThrowError(/invalid_prior_attempt_migration_source/u);
    expect(() =>
      createGate2PriorAttemptsLineage({
        ...input,
        knownCalls: input.knownCalls.map((call, index) =>
          index === 4 ? { ...call, jti: input.knownCalls[0]!.jti } : call
        )
      })
    ).toThrowError(/invalid_prior_attempt_known_call/u);
    expect(() =>
      createGate2PriorAttemptsLineage({
        ...input,
        preserved: { knownActualNanoUsd: input.preserved.knownActualNanoUsd + 1 }
      })
    ).toThrowError(/prior_attempt_cost_mismatch/u);
  });

  it("rejects any fabricated attempt-2 run, semantic artifact, or score", () => {
    const input = source();
    const lineage = createGate2PriorAttemptsLineage(input);
    for (const mutation of [
      { runId: `run_${"x".repeat(22)}` },
      { rawSha256: "0".repeat(64) },
      { evidenceDigest: "1".repeat(64) },
      { score: { passedCount: 0, caseCount: 4 } }
    ]) {
      const tampered = structuredClone(lineage) as unknown as {
        attempt2: Record<string, unknown>;
      };
      Object.assign(tampered.attempt2, mutation);
      expect(() => verifyGate2PriorAttemptsLineage(tampered, input)).toThrowError(
        /prior_attempts_lineage_mismatch/u
      );
    }
  });
});
