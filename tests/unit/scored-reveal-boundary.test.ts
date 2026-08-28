import { canonicalSha256 } from "@/lib/evidence/digest";
import { SCORED_RUN_ATTEMPT_VERSION, type ScoredRunAttempt } from "@/lib/scored/run-store.server";
import {
  GATE3_BASELINE_REVEAL_VERSION,
  verifyGate3BaselineRevealBundle
} from "@/lib/scored/service.server";
import { GATE3_ORDER_SEED, GATE3_SEMANTIC_SUITE } from "@/lib/semantic/checkout-candidate.server";
import { deriveSemanticCaseOrder } from "@/lib/semantic/protocol-freeze.server";
import { describe, expect, it } from "vitest";

function attempt(runnerCaseId: string, ordinal: number): ScoredRunAttempt {
  return {
    version: SCORED_RUN_ATTEMPT_VERSION,
    ordinal,
    attempt: 0,
    runnerCaseId,
    disposition: "infrastructure-invalid",
    infrastructureRetryEligible: false,
    usableModelDecisionMade: false,
    targetExecutionMade: false,
    capturedAt: "2026-08-28T22:00:00.000Z",
    evidence: {
      version: "toolproof-scored-provider-uncertain@1.0.0",
      code: "provider_dispatch_uncertain",
      inferencePerformed: true,
      authorizationJti: `jti_${"j".repeat(22)}`,
      envelopeHash: "9".repeat(64),
      httpStatus: null,
      rawModelResponse: null,
      rawModelResponseHash: null
    }
  };
}

async function reveal() {
  const ordered = await deriveSemanticCaseOrder(
    GATE3_ORDER_SEED,
    GATE3_SEMANTIC_SUITE.scoredCases.map(({ runnerCaseId }) => runnerCaseId)
  );
  const developmentIds = new Set(
    GATE3_SEMANTIC_SUITE.scoredCases
      .filter(({ subset }) => subset === "development")
      .map(({ runnerCaseId }) => runnerCaseId)
  );
  const firstDevelopmentOrdinal = ordered.findIndex((runnerCaseId) =>
    developmentIds.has(runnerCaseId)
  );
  const developmentAttempts = [attempt(ordered[firstDevelopmentOrdinal]!, firstDevelopmentOrdinal)];
  const payload = {
    version: GATE3_BASELINE_REVEAL_VERSION,
    phase: "baseline" as const,
    runId: `run_${"r".repeat(22)}`,
    appCommit: "a".repeat(40),
    reviewPackageHash: "1".repeat(64),
    frozenProtocolHash: "2".repeat(64),
    freezeCandidateHash: "3".repeat(64),
    phaseCallOffset: 0,
    repairPhaseCallOffset: 0,
    predecessorProtocolHash: null,
    predecessorEvidenceDigest: null,
    predecessorRunId: null,
    predecessorDisposition: null,
    status: "terminal-invalid" as const,
    completedCount: firstDevelopmentOrdinal,
    attemptCount: firstDevelopmentOrdinal + 1,
    transportFailureCount: 1,
    developmentAttempts,
    developmentDigest: await canonicalSha256(developmentAttempts),
    sealedHoldout: {
      caseCount: 12 as const,
      attemptCount: firstDevelopmentOrdinal,
      commitmentDigest: "4".repeat(64),
      disclosure: "sealed-until-v2-freeze-and-revised-terminal" as const
    },
    terminalEvidenceDigest: "5".repeat(64),
    guard: {
      claimedCalls: 41,
      knownCalls: 41,
      pendingCount: 0,
      uncertainCount: 0,
      baselineCalls: 24,
      revisedCalls: 0,
      committedNanoUsd: 2_562_500_000,
      knownActualNanoUsd: 100_000_000
    }
  };
  return { ...payload, revealDigest: await canonicalSha256(payload) };
}

describe("baseline development-only reveal", () => {
  it("verifies a legacy offset-zero bundle without rehashing new identity fields into it", async () => {
    const current = await reveal();
    const {
      repairPhaseCallOffset: _repairPhaseCallOffset,
      predecessorDisposition: _predecessorDisposition,
      revealDigest: _revealDigest,
      ...legacyPayload
    } = current;
    void _repairPhaseCallOffset;
    void _predecessorDisposition;
    void _revealDigest;
    const legacy = {
      ...legacyPayload,
      revealDigest: await canonicalSha256(legacyPayload)
    };
    const verified = await verifyGate3BaselineRevealBundle(legacy);
    expect(Object.hasOwn(verified, "repairPhaseCallOffset")).toBe(false);
    expect(Object.hasOwn(verified, "predecessorDisposition")).toBe(false);
    expect(verified.revealDigest).toBe(legacy.revealDigest);
  });

  it("exposes development attempts plus only a holdout commitment", async () => {
    const verified = await verifyGate3BaselineRevealBundle(await reveal());
    expect(verified.developmentAttempts).toHaveLength(1);
    expect(JSON.stringify(verified)).not.toContain("builder-blinded-holdout");
    expect(verified.sealedHoldout).toMatchObject({
      caseCount: 12,
      disclosure: "sealed-until-v2-freeze-and-revised-terminal"
    });
  });

  it("rejects a holdout row inserted into the development projection", async () => {
    const value = await reveal();
    const holdout = GATE3_SEMANTIC_SUITE.scoredCases.find(
      ({ subset }) => subset === "builder-blinded-holdout"
    );
    if (!holdout) throw new Error("Holdout case missing.");
    const developmentAttempts = [
      attempt(holdout.runnerCaseId, value.developmentAttempts[0]!.ordinal)
    ];
    const payload = {
      ...value,
      developmentAttempts,
      developmentDigest: await canonicalSha256(developmentAttempts)
    };
    const core = { ...payload } as Partial<typeof payload>;
    delete core.revealDigest;
    await expect(
      verifyGate3BaselineRevealBundle({
        ...core,
        revealDigest: await canonicalSha256(core)
      })
    ).rejects.toThrow(/baseline_reveal_holdout_leak/u);
  });
});
