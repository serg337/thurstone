import { describe, expect, it } from "vitest";

import { canonicalSha256 } from "@/lib/evidence/digest";
import { fallbackRunnerContractHash } from "@/lib/fallback/runner-contract";
import {
  PROBE_V03_MIGRATED_LEDGER_SCRIPT_HASH,
  PROBE_V03_MIGRATED_POLICY_HASH,
  PROBE_V03_MIGRATED_POLICY_VERSION,
  probeV03PolicyMigrationReceiptHash,
  type ProbeV03PolicyMigrationReceipt
} from "@/lib/probe/policy-v03-migration-contract";
import {
  PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
  PROBE_V04_POLICY_MIGRATION_ID,
  PROBE_V04_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
  PROBE_V04_POLICY_MIGRATION_PRIOR_APP_COMMIT,
  PROBE_V04_POLICY_MIGRATION_SOURCE_VERSION,
  PROBE_V04_POLICY_MIGRATION_VERSION,
  PROBE_V04_PRIOR_ATTEMPT3_EVIDENCE_DIGEST,
  PROBE_V04_PRIOR_ATTEMPT3_RAW_SHA256,
  PROBE_V04_PREDECESSOR_MIGRATION_ID,
  PROBE_V04_PREDECESSOR_MIGRATION_RECEIPT_HASH,
  PROBE_V04_PRESERVED_KNOWN_CALLS_DIGEST,
  PROBE_V04_PREVIOUS_LEDGER_SCRIPT_HASH,
  PROBE_V04_PREVIOUS_POLICY_HASH,
  PROBE_V04_PREVIOUS_POLICY_VERSION,
  PROBE_V04_PREVIOUS_RUNNER_CONTRACT_HASH,
  ProbeV04PolicyMigrationContractError,
  createProbeV04PolicyMigrationManifest,
  createProbeV04PolicyMigrationReceipt,
  isProbeV04PolicyMigrationSourceStatus,
  parseProbeV04PolicyMigrationSourceReceipt,
  probeV04PolicyMigrationDigest,
  probeV04PolicyMigrationReceiptHash
} from "@/lib/probe/policy-v04-migration-contract";
import {
  PROBE_V04_POLICY_MIGRATION_PROGRAM_HASH,
  PROBE_V04_POLICY_MIGRATION_SCRIPTS,
  buildProbeV04PolicyMigrationArguments,
  probeV04PolicyMigrationProgramHash
} from "@/lib/probe/policy-v04-migration.server";
import {
  PROBE_CHALLENGE_CLOSES_AT,
  PROBE_GLOBAL_CALL_LIMIT,
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
  PROBE_MAX_CONCURRENCY,
  PROBE_MODEL,
  PROBE_PER_CALL_RESERVATION_NANO_USD,
  PROBE_POLICY_VERSION,
  probePolicyHash
} from "@/lib/probe/policy";
import { PROBE_LEDGER_SCRIPTS, probeLedgerScriptHash } from "@/lib/probe/ledger";

const predecessor = {
  globalCallLimit: 160,
  guardInstanceId: "guard_3323051706a8384028e97a60f0c0b868",
  initializedCommit: "86584fe4fa308980bfb7d60f9722cc8b49b78644",
  knownCalls: [
    [
      0,
      "jti_3ttNKoeU_37eePWqlaQTAd",
      1,
      2_752_200,
      "6ad2354dd698c3485acdf764436d2e006fca921dbcf816e21838726e66e08a34",
      "79d59941177121ee14813c652e4042ab73797c4952477c70301cbaf76a73f730",
      "4575531a0117bcba5679e0c8926ef35a51301ab65dd71ff8b8217ba3d0340ed3"
    ],
    [
      1,
      "jti_KbzmhiHJVFITzY_LutQLsW",
      2,
      2_745_600,
      "72ff841d0b8a0b77ea42b97a082215571bf048a13ad29cfb3015b5fc433ce4b8",
      "f006918f47aafc8b9c57321ec16c7a6360bdabeb397d5782175f94d23de30c32",
      "ac6cc9b1fedc07839fd21592c38233be6023cd152820a2e0ef297f362903a3d8"
    ],
    [
      2,
      "jti_-NVfSckdMZ9ZBaB3lR6Shd",
      3,
      2_862_200,
      "80230a2a6d04d5493b7d3116cbad1459891c0151b2306de2427b662fb54cf03e",
      "24d5c889e87d9301b7fe19b0c618e3b2252092cd4d48a3077ebe284cc93750f7",
      "be54b40921ff0e395f0a92ee21b530926ddfaf49b589a5d12ebf24730b5d2675"
    ],
    [
      3,
      "jti_fnoZqfzfBTsmlgSYJGJtjm",
      4,
      3_000_800,
      "b7c53214faf520268872b3d17eba17a4e65260e50d754e1acbc5915f80672ed6",
      "f727dc2f1f439a085ec6fce8d3c822d656b495e6ee025562bc3478868bec6938",
      "961a4ecb2a7f083f83c4afa520836716289af392c65ac722c0c433945e239d1a"
    ],
    [
      4,
      "jti_k3jaZ-FMU0962MmGl7Gtoy",
      5,
      3_216_400,
      "22eec2222d3b8cb73451df90f6af52ecc13df4080d4b44c5f26d9e48370b8e02",
      "606dea43a57488f28c43edf02d4c58fdf6910755f381c69d3a8d05d4a5d80c1c",
      "0756f7467db7984f1141aa5dd356198aa26963776d403a5fe507951fec8b27af"
    ]
  ].map(([ordinal, jti, dispatchSequence, actualNanoUsd, response, settlement, usage]) => ({
    ordinal: Number(ordinal),
    jti: String(jti),
    dispatchSequence: Number(dispatchSequence),
    actualNanoUsd: Number(actualNanoUsd),
    providerResponseHash: String(response),
    settlementDigest: String(settlement),
    usageHash: String(usage)
  })),
  lifetimeSpendCeilingNanoUsd: 10_000_000_000,
  migratedAtMs: 1_787_865_869_990,
  migrationCommit: "2ca1f277b27b727c4a336b83b12bca77be1cc938",
  migrationDigest: "4ff1c50bd17bbe56645f7aceb4a0019b502c0a3034bccd9b3818c6e6fb445925",
  migrationId: "migration_gate2_calibration_attempt_3",
  nextPolicyHash: PROBE_V03_MIGRATED_POLICY_HASH,
  nextPolicyVersion: PROBE_V03_MIGRATED_POLICY_VERSION,
  nextPurposeLimits: { baseline: 72, calibration: 9, judge: 5, repair: 2, revised: 72 },
  nextScriptHash: PROBE_V03_MIGRATED_LEDGER_SCRIPT_HASH,
  perCallReservationNanoUsd: 62_500_000,
  predecessorMigrationId: "migration_gate2_calibration_attempt_2",
  predecessorMigrationReceiptHash:
    "4ee25981212e67324bda5ec21a67912eddacec622b20850035ca855574f43b84",
  preserved: {
    claimedCalls: 5,
    committedNanoUsd: 312_500_000,
    inflightCalls: 0,
    knownActualNanoUsd: 14_577_200,
    knownCalls: 5,
    pendingCalls: 0,
    purposeCounts: { baseline: 0, calibration: 5, judge: 0, repair: 0, revised: 0 },
    sequence: 5,
    uncertainCalls: 0,
    uncertainUpperNanoUsd: 0
  },
  previousPolicyHash: "0667313bddeb02f0f2987348c56f0ad022c9bb33cf500eb94ef2a1a5fe86f0a8",
  previousPolicyVersion: "toolproof-probe-policy@0.2.0",
  previousPurposeLimits: { baseline: 72, calibration: 8, judge: 6, repair: 2, revised: 72 },
  previousScriptHash: "34833e98044cee1472c9104ac70312f03c96e8d2707bee189631e2cf41ae9033",
  priorActivationHash: "41f8363c74f7b277c239689194069d80749d3f33342779662009f8c47e5348d6",
  priorAppCommit: "191f7885eeb062de4bfe4effd9468ef648aef600",
  receiptHash: PROBE_V04_PREDECESSOR_MIGRATION_RECEIPT_HASH,
  version: "toolproof-probe-policy-migration-v03@1.0.0"
} satisfies ProbeV03PolicyMigrationReceipt;

const knownCalls = [
  ...predecessor.knownCalls,
  [
    5,
    "jti_9Es4dLaTwzJKmw9l1pLAje",
    6,
    3_322_000,
    "65dcc98af9f86533c4b25f5401a9272713bfbfbd0552f4b283f6dd519862b3c2",
    "415f7e8fb84d6c1c4c079a16b88dcbe039e7f037a08cea813b5d56f497782e89",
    "56044e97681209511cb0d54a62307cf59db0e5c6b87c8b52283890ba33f1ab2c"
  ],
  [
    6,
    "jti_2CK2ZdwtY_ExNqGWBzFtZH",
    7,
    3_280_200,
    "9dc549c8a52388f5fd844c3999ba1b9183acde9ec5fd46dad190bf11c1fcce34",
    "ee141035305247d16e9765d6bef48b7fbdba344646eceb777bb533c3ffa4ee59",
    "fcacfaee765db8cc7a8f72fe2bcee82ea227a0c9424ed8a1ebb1c648cb4a93ec"
  ],
  [
    7,
    "jti_9W52PDxVkWy2YlOXfiMU7d",
    8,
    3_489_200,
    "d7defedf2e8e8ec1c7d1b504ad13349ee3c9546829e6e3d761687766f2b1b604",
    "45e667f18bbd7b4ae7648f8600dcb14aa39af5fb5950745d9fcbb825d56ecab6",
    "2b364c94b58f6049131fc697e5dc0db519d960f21291a8becbebc5c80b13729c"
  ],
  [
    8,
    "jti_W_dK9y1PGv1mAbigResi3t",
    9,
    3_324_200,
    "a5524d99801cc9e750b220849d3501bee4cfcc5487fe30e9df756db9e8c1667f",
    "b47ebbeccaf8f936015781a8556769019b68a8f568c0e6c6ae6881bf07a421b4",
    "235e69b9f50ba05f6682efdcc56bc2392639c2c15a453f6fe2aac9c7b551dd52"
  ]
].map((entry, index) =>
  Array.isArray(entry)
    ? {
        ordinal: Number(entry[0]),
        jti: String(entry[1]),
        dispatchSequence: Number(entry[2]),
        actualNanoUsd: Number(entry[3]),
        providerResponseHash: String(entry[4]),
        settlementDigest: String(entry[5]),
        usageHash: String(entry[6])
      }
    : { ...entry, ordinal: index, dispatchSequence: index + 1 }
);

async function sourceFixture() {
  return parseProbeV04PolicyMigrationSourceReceipt(
    {
      version: PROBE_V04_POLICY_MIGRATION_SOURCE_VERSION,
      migrationId: PROBE_V04_POLICY_MIGRATION_ID,
      priorAppCommit: PROBE_V04_POLICY_MIGRATION_PRIOR_APP_COMMIT,
      priorActivationHash: PROBE_V04_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
      priorEvidenceRawSha256: PROBE_V04_PRIOR_ATTEMPT3_RAW_SHA256,
      priorEvidenceDigest: PROBE_V04_PRIOR_ATTEMPT3_EVIDENCE_DIGEST,
      predecessorMigrationId: PROBE_V04_PREDECESSOR_MIGRATION_ID,
      predecessorMigrationReceiptHash: predecessor.receiptHash,
      guardInstanceId: predecessor.guardInstanceId,
      initializedCommit: predecessor.initializedCommit,
      previousPolicyVersion: PROBE_V04_PREVIOUS_POLICY_VERSION,
      previousPolicyHash: PROBE_V04_PREVIOUS_POLICY_HASH,
      previousScriptHash: PROBE_V04_PREVIOUS_LEDGER_SCRIPT_HASH,
      previousRunnerHash: PROBE_V04_PREVIOUS_RUNNER_CONTRACT_HASH,
      preserved: PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
      knownCalls
    },
    predecessor
  );
}

describe("Probe v0.3 -> v0.4 fallback policy migration contract", () => {
  it("binds the exact nine-call lineage, same lifetime caps, and distinct fallback runner", async () => {
    await expect(canonicalSha256(knownCalls)).resolves.toBe(PROBE_V04_PRESERVED_KNOWN_CALLS_DIGEST);
    const source = await sourceFixture();
    const fallbackRunnerHash = await fallbackRunnerContractHash();
    const manifest = await createProbeV04PolicyMigrationManifest({
      sourceReceipt: source,
      predecessorReceipt: predecessor,
      migrationCommit: "d".repeat(40),
      nextPolicyHash: await probePolicyHash(),
      nextScriptHash: PROBE_V04_PREVIOUS_LEDGER_SCRIPT_HASH,
      nextRunnerHash: fallbackRunnerHash,
      migrationProgramHash: await probeV04PolicyMigrationProgramHash()
    });
    expect(manifest).toMatchObject({
      version: PROBE_V04_POLICY_MIGRATION_VERSION,
      nextPolicyVersion: PROBE_POLICY_VERSION,
      previousRunnerHash: PROBE_V04_PREVIOUS_RUNNER_CONTRACT_HASH,
      nextRunnerHash: fallbackRunnerHash,
      previousPurposeLimits: { calibration: 9, judge: 5 },
      nextPurposeLimits: { calibration: 13, judge: 1 },
      globalCallLimit: 160,
      lifetimeSpendCeilingNanoUsd: 10_000_000_000,
      preserved: {
        claimedCalls: 9,
        knownCalls: 9,
        committedNanoUsd: 562_500_000,
        knownActualNanoUsd: 27_992_800,
        sequence: 9
      }
    });
    expect(manifest.nextRunnerHash).not.toBe(manifest.previousRunnerHash);
    expect(manifest.knownCalls).toHaveLength(9);
    const digest = await probeV04PolicyMigrationDigest(manifest);
    const args = buildProbeV04PolicyMigrationArguments(manifest, predecessor, digest);
    expect(args).toHaveLength(160);
    expect(args[12]).toBe(PROBE_V04_PREVIOUS_RUNNER_CONTRACT_HASH);
    expect(args[16]).toBe(fallbackRunnerHash);
    expect(args[33]).toBe("9");
    expect(args[35]).toBe("9");
    expect(args[36]).toBe("27992800");
    expect(args[37]).toBe("9");
    expect(args[38]).toBe("9");
    expect(args[102]).toBe("d".repeat(40));
    expect(args[157]).toBe(PROBE_V04_POLICY_MIGRATION_PROGRAM_HASH);
    expect(args[158]).toBe(PROBE_V04_PRIOR_ATTEMPT3_RAW_SHA256);
    expect(args[159]).toBe(PROBE_V04_PRIOR_ATTEMPT3_EVIDENCE_DIGEST);
    const receipt = await createProbeV04PolicyMigrationReceipt(manifest, digest, 1_800_000_002_000);
    await expect(probeV04PolicyMigrationReceiptHash(receipt)).resolves.toBe(receipt.receiptHash);
  });

  it("rejects receipt, call, cost, policy, script, and runner substitution", async () => {
    const source = await sourceFixture();
    await expect(
      parseProbeV04PolicyMigrationSourceReceipt(
        { ...source, predecessorMigrationReceiptHash: "0".repeat(64) },
        predecessor
      )
    ).rejects.toBeInstanceOf(ProbeV04PolicyMigrationContractError);
    const forgedPredecessorCore = {
      ...predecessor,
      migratedAtMs: predecessor.migratedAtMs + 1
    } as ProbeV03PolicyMigrationReceipt;
    const forgedPredecessor = {
      ...forgedPredecessorCore,
      receiptHash: await probeV03PolicyMigrationReceiptHash(forgedPredecessorCore)
    };
    await expect(
      parseProbeV04PolicyMigrationSourceReceipt(
        { ...source, predecessorMigrationReceiptHash: forgedPredecessor.receiptHash },
        forgedPredecessor
      )
    ).rejects.toThrow(/predecessor_receipt_invalid/u);
    await expect(
      parseProbeV04PolicyMigrationSourceReceipt(
        {
          ...source,
          knownCalls: source.knownCalls.map((call, index) =>
            index === 8 ? { ...call, usageHash: "0".repeat(64) } : call
          )
        },
        predecessor
      )
    ).rejects.toThrow(/known_call_lineage_mismatch/u);
    await expect(
      parseProbeV04PolicyMigrationSourceReceipt(
        {
          ...source,
          preserved: { ...source.preserved, knownActualNanoUsd: 27_992_801 }
        },
        predecessor
      )
    ).rejects.toThrow(/preserved_state_mismatch/u);
    const base = {
      sourceReceipt: source,
      predecessorReceipt: predecessor,
      migrationCommit: "d".repeat(40),
      nextPolicyHash: await probePolicyHash(),
      nextScriptHash: PROBE_V04_PREVIOUS_LEDGER_SCRIPT_HASH,
      nextRunnerHash: await fallbackRunnerContractHash(),
      migrationProgramHash: await probeV04PolicyMigrationProgramHash()
    };
    await expect(
      createProbeV04PolicyMigrationManifest({ ...base, nextPolicyHash: "0".repeat(64) })
    ).rejects.toThrow(/v04_next_policy_not_frozen/u);
    await expect(
      createProbeV04PolicyMigrationManifest({ ...base, nextScriptHash: "0".repeat(64) })
    ).rejects.toThrow(/v04_next_policy_not_frozen/u);
    await expect(
      createProbeV04PolicyMigrationManifest({ ...base, nextRunnerHash: "0".repeat(64) })
    ).rejects.toThrow(/v04_next_policy_not_frozen/u);
  });

  it("admits only the exact idle terminal-nine v0.3 source boundary", () => {
    const status = {
      status: "open",
      guardInstanceId: predecessor.guardInstanceId,
      initializedCommit: predecessor.initializedCommit,
      policyVersion: PROBE_V04_PREVIOUS_POLICY_VERSION,
      policyHash: PROBE_V04_PREVIOUS_POLICY_HASH,
      scriptHash: PROBE_V04_PREVIOUS_LEDGER_SCRIPT_HASH,
      model: PROBE_MODEL,
      globalCallLimit: PROBE_GLOBAL_CALL_LIMIT,
      spendCeilingNanoUsd: PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
      perCallReservationNanoUsd: PROBE_PER_CALL_RESERVATION_NANO_USD,
      maxConcurrency: PROBE_MAX_CONCURRENCY,
      challengeClosesAtMs: Date.parse(PROBE_CHALLENGE_CLOSES_AT),
      claimedCalls: 9,
      committedNanoUsd: 562_500_000,
      pendingCount: 0,
      knownCount: 9,
      uncertainCount: 0,
      knownActualNanoUsd: 27_992_800,
      uncertainUpperNanoUsd: 0,
      purposeLimits: { calibration: 9, baseline: 72, repair: 2, revised: 72, judge: 5 },
      purposeCounts: { calibration: 9, baseline: 0, repair: 0, revised: 0, judge: 0 },
      inflightCount: 0,
      sequence: 9,
      haltMarkerPresent: false,
      uncertainMarkerPresent: false
    };
    const expected = {
      guardInstanceId: predecessor.guardInstanceId,
      initializedCommit: predecessor.initializedCommit,
      knownActualNanoUsd: 27_992_800
    };
    const now = Date.parse("2026-08-28T12:00:00.000Z");
    expect(isProbeV04PolicyMigrationSourceStatus(status, expected, now)).toBe(true);
    for (const drift of [
      { knownCount: 8 },
      { claimedCalls: 10 },
      { knownActualNanoUsd: 27_992_801 },
      { purposeLimits: { ...status.purposeLimits, judge: 4 } },
      { pendingCount: 1, inflightCount: 1 },
      { policyHash: "0".repeat(64) },
      { haltMarkerPresent: true }
    ]) {
      expect(isProbeV04PolicyMigrationSourceStatus({ ...status, ...drift }, expected, now)).toBe(
        false
      );
    }
  });

  it("keeps the dormant Lua candidate atomic, replay-safe, and non-destructive", () => {
    const script = PROBE_V04_POLICY_MIGRATION_SCRIPTS.migrate;
    expect(script).toContain("for ordinal = 0, 8 do");
    expect(script).toContain('"previous_runner_hash", ARGV[13]');
    expect(script).toContain('"next_runner_hash", ARGV[17]');
    expect(script).toContain(
      'redis.call("HSET", KEYS[3], "calibration", ARGV[29], "judge", ARGV[33])'
    );
    expect(script).toContain("V04_MIGRATED_EXISTING");
    expect(script).not.toContain('redis.call("DEL"');
    expect(script).not.toContain('redis.call("UNLINK"');
    expect(script).not.toContain('redis.call("EXPIRE"');
    expect(script).not.toContain('redis.call("HINCRBY"');
    expect(PROBE_LEDGER_SCRIPTS).not.toHaveProperty("migratePolicyV04");
  });

  it("does not alter the frozen core ledger identity before migration approval", async () => {
    await expect(probeLedgerScriptHash()).resolves.toBe(PROBE_V04_PREVIOUS_LEDGER_SCRIPT_HASH);
    await expect(probeV04PolicyMigrationProgramHash()).resolves.toBe(
      PROBE_V04_POLICY_MIGRATION_PROGRAM_HASH
    );
  });
});
