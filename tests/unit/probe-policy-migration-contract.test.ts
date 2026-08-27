import { describe, expect, it } from "vitest";

import { canonicalSha256 } from "@/lib/evidence/digest";
import {
  PROBE_MIGRATED_LEDGER_SCRIPT_HASH,
  PROBE_MIGRATED_POLICY_HASH,
  PROBE_POLICY_MIGRATION_ID,
  PROBE_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
  PROBE_POLICY_MIGRATION_PRIOR_APP_COMMIT,
  PROBE_POLICY_MIGRATION_PRIOR_EVIDENCE_DIGEST,
  PROBE_POLICY_MIGRATION_PRIOR_RECEIPT_VERSION,
  PROBE_PREVIOUS_LEDGER_SCRIPT_HASH,
  PROBE_PREVIOUS_POLICY_HASH,
  PROBE_PREVIOUS_POLICY_MANIFEST,
  PROBE_PREVIOUS_POLICY_VERSION,
  ProbePolicyMigrationContractError,
  createProbePolicyMigrationManifest,
  createProbePolicyMigrationReceipt,
  isExactProbePolicyMigrationSourceStatus,
  parseProbePolicyMigrationPriorReceipt,
  probePolicyMigrationDigest,
  probePolicyMigrationReceiptHash,
  type ProbePolicyMigrationPriorReceipt
} from "@/lib/probe/policy-migration-contract";
import {
  PROBE_CHALLENGE_CLOSES_AT,
  PROBE_GLOBAL_CALL_LIMIT,
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
  PROBE_MAX_CONCURRENCY,
  PROBE_MODEL,
  PROBE_PER_CALL_RESERVATION_NANO_USD
} from "@/lib/probe/policy";

export function migrationPriorReceiptFixture(): ProbePolicyMigrationPriorReceipt {
  return parseProbePolicyMigrationPriorReceipt({
    version: PROBE_POLICY_MIGRATION_PRIOR_RECEIPT_VERSION,
    migrationId: PROBE_POLICY_MIGRATION_ID,
    priorAppCommit: PROBE_POLICY_MIGRATION_PRIOR_APP_COMMIT,
    priorActivationHash: PROBE_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
    priorEvidenceDigest: PROBE_POLICY_MIGRATION_PRIOR_EVIDENCE_DIGEST,
    guardInstanceId: "guard_migration_0123456789abcdef",
    initializedCommit: "f".repeat(40),
    previousPolicyVersion: PROBE_PREVIOUS_POLICY_VERSION,
    previousPolicyHash: PROBE_PREVIOUS_POLICY_HASH,
    previousScriptHash: PROBE_PREVIOUS_LEDGER_SCRIPT_HASH,
    knownCalls: [
      {
        ordinal: 0,
        jti: "jti_migration_000000000000",
        dispatchSequence: 1,
        actualNanoUsd: 2_752_200,
        providerResponseHash: "1".repeat(64),
        settlementDigest: "2".repeat(64),
        usageHash: "3".repeat(64)
      },
      {
        ordinal: 1,
        jti: "jti_migration_111111111111",
        dispatchSequence: 2,
        actualNanoUsd: 2_745_600,
        providerResponseHash: "4".repeat(64),
        settlementDigest: "5".repeat(64),
        usageHash: "6".repeat(64)
      },
      {
        ordinal: 2,
        jti: "jti_migration_222222222222",
        dispatchSequence: 3,
        actualNanoUsd: 2_862_200,
        providerResponseHash: "7".repeat(64),
        settlementDigest: "8".repeat(64),
        usageHash: "9".repeat(64)
      },
      {
        ordinal: 3,
        jti: "jti_migration_333333333333",
        dispatchSequence: 4,
        actualNanoUsd: 3_000_800,
        providerResponseHash: "a".repeat(64),
        settlementDigest: "b".repeat(64),
        usageHash: "c".repeat(64)
      }
    ]
  });
}

describe("Probe policy migration contract", () => {
  it("binds the exact prior receipt, policy transition, and four known calls", async () => {
    await expect(canonicalSha256(PROBE_PREVIOUS_POLICY_MANIFEST)).resolves.toBe(
      PROBE_PREVIOUS_POLICY_HASH
    );
    const manifest = createProbePolicyMigrationManifest({
      priorReceipt: migrationPriorReceiptFixture(),
      migrationCommit: "e".repeat(40),
      nextPolicyHash: PROBE_MIGRATED_POLICY_HASH,
      nextScriptHash: PROBE_MIGRATED_LEDGER_SCRIPT_HASH
    });
    expect(manifest.previousPurposeLimits).toEqual({
      calibration: 4,
      baseline: 72,
      repair: 2,
      revised: 72,
      judge: 10
    });
    expect(manifest.nextPurposeLimits).toEqual({
      calibration: 8,
      baseline: 72,
      repair: 2,
      revised: 72,
      judge: 6
    });
    expect(manifest.preserved).toMatchObject({
      claimedCalls: 4,
      knownCalls: 4,
      committedNanoUsd: 250_000_000,
      knownActualNanoUsd: 11_360_800,
      sequence: 4
    });
    await expect(probePolicyMigrationDigest(manifest)).resolves.toMatch(/^[a-f0-9]{64}$/u);
  });

  it("defines a stable receipt hash over every core field but not replay disposition", async () => {
    const manifest = createProbePolicyMigrationManifest({
      priorReceipt: migrationPriorReceiptFixture(),
      migrationCommit: "e".repeat(40),
      nextPolicyHash: PROBE_MIGRATED_POLICY_HASH,
      nextScriptHash: PROBE_MIGRATED_LEDGER_SCRIPT_HASH
    });
    const digest = await probePolicyMigrationDigest(manifest);
    const receipt = await createProbePolicyMigrationReceipt(manifest, digest, 1_800_000_000_000);
    await expect(probePolicyMigrationReceiptHash(receipt)).resolves.toBe(receipt.receiptHash);
    const repeated = await createProbePolicyMigrationReceipt(manifest, digest, 1_800_000_000_000);
    expect(repeated).toEqual(receipt);
  });

  it("rejects extra fields, reordered calls, duplicate records, cost drift, and digest tampering", async () => {
    const valid = migrationPriorReceiptFixture();
    expect(() => parseProbePolicyMigrationPriorReceipt({ ...valid, unexpected: true })).toThrow(
      ProbePolicyMigrationContractError
    );
    expect(() =>
      parseProbePolicyMigrationPriorReceipt({
        ...valid,
        knownCalls: [valid.knownCalls[1], valid.knownCalls[0], ...valid.knownCalls.slice(2)]
      })
    ).toThrow(/known_call_order_mismatch/u);
    expect(() =>
      parseProbePolicyMigrationPriorReceipt({
        ...valid,
        knownCalls: valid.knownCalls.map((call, index) =>
          index === 1 ? { ...call, jti: valid.knownCalls[0]!.jti } : call
        )
      })
    ).toThrow(/duplicate_known_call/u);
    expect(() =>
      parseProbePolicyMigrationPriorReceipt({
        ...valid,
        knownCalls: valid.knownCalls.map((call, index) =>
          index === 3 ? { ...call, actualNanoUsd: call.actualNanoUsd + 1 } : call
        )
      })
    ).toThrow(/known_call_cost_sum_mismatch/u);

    const manifest = createProbePolicyMigrationManifest({
      priorReceipt: valid,
      migrationCommit: "e".repeat(40),
      nextPolicyHash: PROBE_MIGRATED_POLICY_HASH,
      nextScriptHash: PROBE_MIGRATED_LEDGER_SCRIPT_HASH
    });
    await expect(
      createProbePolicyMigrationReceipt(manifest, "0".repeat(64), 1_800_000_000_000)
    ).rejects.toThrow(/migration_digest_mismatch/u);
  });

  it("recognizes only the exact disabled pre-migration source state", () => {
    const guardInstanceId = "guard_migration_0123456789abcdef";
    const initializedCommit = "f".repeat(40);
    const source = {
      status: "open",
      guardInstanceId,
      initializedCommit,
      policyVersion: PROBE_PREVIOUS_POLICY_VERSION,
      policyHash: PROBE_PREVIOUS_POLICY_HASH,
      scriptHash: PROBE_PREVIOUS_LEDGER_SCRIPT_HASH,
      model: PROBE_MODEL,
      globalCallLimit: PROBE_GLOBAL_CALL_LIMIT,
      spendCeilingNanoUsd: PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
      perCallReservationNanoUsd: PROBE_PER_CALL_RESERVATION_NANO_USD,
      maxConcurrency: PROBE_MAX_CONCURRENCY,
      challengeClosesAtMs: Date.parse(PROBE_CHALLENGE_CLOSES_AT),
      claimedCalls: 4,
      committedNanoUsd: 250_000_000,
      pendingCount: 0,
      knownCount: 4,
      uncertainCount: 0,
      knownActualNanoUsd: 11_360_800,
      uncertainUpperNanoUsd: 0,
      purposeLimits: { calibration: 4, baseline: 72, repair: 2, revised: 72, judge: 10 },
      purposeCounts: { calibration: 4, baseline: 0, repair: 0, revised: 0, judge: 0 },
      inflightCount: 0,
      sequence: 4,
      haltMarkerPresent: false,
      uncertainMarkerPresent: false
    };
    const expected = { guardInstanceId, initializedCommit };
    const nowMs = Date.parse("2026-08-27T12:00:00.000Z");
    expect(isExactProbePolicyMigrationSourceStatus(source, expected, nowMs)).toBe(true);
    for (const drift of [
      { knownCount: 3 },
      { pendingCount: 1 },
      { knownActualNanoUsd: 11_360_801 },
      { policyHash: "0".repeat(64) },
      { haltMarkerPresent: true }
    ]) {
      expect(
        isExactProbePolicyMigrationSourceStatus({ ...source, ...drift }, expected, nowMs)
      ).toBe(false);
    }
    expect(
      isExactProbePolicyMigrationSourceStatus(
        { ...source, purposeLimits: { ...source.purposeLimits, judge: 9 } },
        expected,
        nowMs
      )
    ).toBe(false);
  });
});
