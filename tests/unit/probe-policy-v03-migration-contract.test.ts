import { describe, expect, it } from "vitest";
import { vi } from "vitest";

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
  PROBE_PREVIOUS_POLICY_VERSION,
  createProbePolicyMigrationManifest,
  createProbePolicyMigrationReceipt,
  parseProbePolicyMigrationPriorReceipt,
  probePolicyMigrationDigest,
  type ProbePolicyMigrationReceipt
} from "@/lib/probe/policy-migration-contract";
import {
  PROBE_V03_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
  PROBE_V03_POLICY_MIGRATION_ID,
  PROBE_V03_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
  PROBE_V03_POLICY_MIGRATION_PRIOR_APP_COMMIT,
  PROBE_V03_POLICY_MIGRATION_SOURCE_VERSION,
  PROBE_V03_POLICY_MIGRATION_VERSION,
  PROBE_V03_PREDECESSOR_MIGRATION_ID,
  PROBE_V03_PREVIOUS_LEDGER_SCRIPT_HASH,
  PROBE_V03_PREVIOUS_POLICY_HASH,
  PROBE_V03_PREVIOUS_POLICY_VERSION,
  ProbeV03PolicyMigrationContractError,
  createProbeV03PolicyMigrationManifest,
  createProbeV03PolicyMigrationReceipt,
  isProbeV03PolicyMigrationSourceStatus,
  parseProbeV03PolicyMigrationSourceReceipt,
  probeV03PolicyMigrationDigest,
  probeV03PolicyMigrationReceiptHash
} from "@/lib/probe/policy-v03-migration-contract";
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
import {
  PROBE_LEDGER_SCRIPTS,
  discoverProbeV03PolicyMigrationSource,
  migrateProbeGuardPolicyV03,
  probeLedgerScriptHash,
  type ProbeRedisDiscoveryClient,
  type ProbeRedisClient
} from "@/lib/probe/ledger";

const guardInstanceId = "guard_v03_0123456789abcdef";
const initializedCommit = "f".repeat(40);

async function predecessorReceipt(): Promise<ProbePolicyMigrationReceipt> {
  const prior = parseProbePolicyMigrationPriorReceipt({
    version: PROBE_POLICY_MIGRATION_PRIOR_RECEIPT_VERSION,
    migrationId: PROBE_POLICY_MIGRATION_ID,
    priorAppCommit: PROBE_POLICY_MIGRATION_PRIOR_APP_COMMIT,
    priorActivationHash: PROBE_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
    priorEvidenceDigest: PROBE_POLICY_MIGRATION_PRIOR_EVIDENCE_DIGEST,
    guardInstanceId,
    initializedCommit,
    previousPolicyVersion: PROBE_PREVIOUS_POLICY_VERSION,
    previousPolicyHash: PROBE_PREVIOUS_POLICY_HASH,
    previousScriptHash: PROBE_PREVIOUS_LEDGER_SCRIPT_HASH,
    knownCalls: [
      [0, "jti_v03_0000000000000000", 1, 2_752_200, "1", "2", "3"],
      [1, "jti_v03_1111111111111111", 2, 2_745_600, "4", "5", "6"],
      [2, "jti_v03_2222222222222222", 3, 2_862_200, "7", "8", "9"],
      [3, "jti_v03_3333333333333333", 4, 3_000_800, "a", "b", "c"]
    ].map(([ordinal, jti, dispatchSequence, actualNanoUsd, response, settlement, usage]) => ({
      ordinal,
      jti,
      dispatchSequence,
      actualNanoUsd,
      providerResponseHash: String(response).repeat(64),
      settlementDigest: String(settlement).repeat(64),
      usageHash: String(usage).repeat(64)
    }))
  });
  const manifest = createProbePolicyMigrationManifest({
    priorReceipt: prior,
    migrationCommit: "e".repeat(40),
    nextPolicyHash: PROBE_MIGRATED_POLICY_HASH,
    nextScriptHash: PROBE_MIGRATED_LEDGER_SCRIPT_HASH
  });
  return createProbePolicyMigrationReceipt(
    manifest,
    await probePolicyMigrationDigest(manifest),
    1_800_000_000_000
  );
}

async function sourceFixture() {
  const predecessor = await predecessorReceipt();
  const knownCalls = [
    ...predecessor.knownCalls,
    {
      ordinal: 4,
      jti: "jti_v03_4444444444444444",
      dispatchSequence: 5,
      actualNanoUsd: 2_500_000,
      providerResponseHash: "d".repeat(64),
      settlementDigest: "e".repeat(64),
      usageHash: "f".repeat(64)
    }
  ];
  const source = await parseProbeV03PolicyMigrationSourceReceipt(
    {
      version: PROBE_V03_POLICY_MIGRATION_SOURCE_VERSION,
      migrationId: PROBE_V03_POLICY_MIGRATION_ID,
      priorAppCommit: PROBE_V03_POLICY_MIGRATION_PRIOR_APP_COMMIT,
      priorActivationHash: PROBE_V03_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
      predecessorMigrationId: PROBE_V03_PREDECESSOR_MIGRATION_ID,
      predecessorMigrationReceiptHash: predecessor.receiptHash,
      guardInstanceId,
      initializedCommit,
      previousPolicyVersion: PROBE_V03_PREVIOUS_POLICY_VERSION,
      previousPolicyHash: PROBE_V03_PREVIOUS_POLICY_HASH,
      previousScriptHash: PROBE_V03_PREVIOUS_LEDGER_SCRIPT_HASH,
      preserved: {
        ...PROBE_V03_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
        knownActualNanoUsd: 13_860_800
      },
      knownCalls
    },
    predecessor
  );
  return { predecessor, source };
}

describe("Probe v0.2 -> v0.3 policy migration contract", () => {
  it("chains the frozen predecessor receipt and exact five-call base", async () => {
    const fixture = await sourceFixture();
    const manifest = await createProbeV03PolicyMigrationManifest({
      sourceReceipt: fixture.source,
      predecessorReceipt: fixture.predecessor,
      migrationCommit: "d".repeat(40),
      nextPolicyHash: await probePolicyHash(),
      nextScriptHash: "9".repeat(64)
    });
    expect(manifest).toMatchObject({
      version: PROBE_V03_POLICY_MIGRATION_VERSION,
      nextPolicyVersion: PROBE_POLICY_VERSION,
      predecessorMigrationReceiptHash: fixture.predecessor.receiptHash,
      previousPurposeLimits: { calibration: 8, judge: 6 },
      nextPurposeLimits: { calibration: 9, judge: 5 },
      preserved: {
        claimedCalls: 5,
        knownCalls: 5,
        committedNanoUsd: 312_500_000,
        knownActualNanoUsd: 13_860_800,
        sequence: 5
      }
    });
    expect(manifest.knownCalls).toHaveLength(5);
    const digest = await probeV03PolicyMigrationDigest(manifest);
    const receipt = await createProbeV03PolicyMigrationReceipt(manifest, digest, 1_800_000_001_000);
    await expect(probeV03PolicyMigrationReceiptHash(receipt)).resolves.toBe(receipt.receiptHash);
  });

  it("rejects predecessor, order, uniqueness, and aggregate-cost tampering", async () => {
    const fixture = await sourceFixture();
    const source = fixture.source;
    await expect(
      parseProbeV03PolicyMigrationSourceReceipt(
        { ...source, predecessorMigrationReceiptHash: "0".repeat(64) },
        fixture.predecessor
      )
    ).rejects.toBeInstanceOf(ProbeV03PolicyMigrationContractError);
    await expect(
      parseProbeV03PolicyMigrationSourceReceipt(
        {
          ...source,
          knownCalls: [source.knownCalls[1], source.knownCalls[0], ...source.knownCalls.slice(2)]
        },
        fixture.predecessor
      )
    ).rejects.toThrow(/known_call/u);
    await expect(
      parseProbeV03PolicyMigrationSourceReceipt(
        {
          ...source,
          knownCalls: source.knownCalls.map((call, index) =>
            index === 4 ? { ...call, jti: source.knownCalls[0]!.jti } : call
          )
        },
        fixture.predecessor
      )
    ).rejects.toThrow(/duplicate_known_call/u);
    await expect(
      parseProbeV03PolicyMigrationSourceReceipt(
        {
          ...source,
          preserved: { ...source.preserved, knownActualNanoUsd: 13_860_801 }
        },
        fixture.predecessor
      )
    ).rejects.toThrow(/known_call_lineage_mismatch/u);
  });

  it("admits only the exact idle five-call v0.2 source boundary", () => {
    const source = {
      status: "open",
      guardInstanceId,
      initializedCommit,
      policyVersion: PROBE_V03_PREVIOUS_POLICY_VERSION,
      policyHash: PROBE_V03_PREVIOUS_POLICY_HASH,
      scriptHash: PROBE_V03_PREVIOUS_LEDGER_SCRIPT_HASH,
      model: PROBE_MODEL,
      globalCallLimit: PROBE_GLOBAL_CALL_LIMIT,
      spendCeilingNanoUsd: PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
      perCallReservationNanoUsd: PROBE_PER_CALL_RESERVATION_NANO_USD,
      maxConcurrency: PROBE_MAX_CONCURRENCY,
      challengeClosesAtMs: Date.parse(PROBE_CHALLENGE_CLOSES_AT),
      claimedCalls: 5,
      committedNanoUsd: 312_500_000,
      pendingCount: 0,
      knownCount: 5,
      uncertainCount: 0,
      knownActualNanoUsd: 13_860_800,
      uncertainUpperNanoUsd: 0,
      purposeLimits: { calibration: 8, baseline: 72, repair: 2, revised: 72, judge: 6 },
      purposeCounts: { calibration: 5, baseline: 0, repair: 0, revised: 0, judge: 0 },
      inflightCount: 0,
      sequence: 5,
      haltMarkerPresent: false,
      uncertainMarkerPresent: false
    };
    const expected = { guardInstanceId, initializedCommit, knownActualNanoUsd: 13_860_800 };
    const nowMs = Date.parse("2026-08-27T12:00:00.000Z");
    expect(isProbeV03PolicyMigrationSourceStatus(source, expected, nowMs)).toBe(true);
    for (const drift of [
      { knownCount: 4 },
      { pendingCount: 1, inflightCount: 1 },
      { knownActualNanoUsd: 13_860_801 },
      { policyHash: "0".repeat(64) },
      { haltMarkerPresent: true }
    ]) {
      expect(isProbeV03PolicyMigrationSourceStatus({ ...source, ...drift }, expected, nowMs)).toBe(
        false
      );
    }
  });

  it("passes the exact atomic key/argument set and reconstructs the chained durable receipt", async () => {
    const fixture = await sourceFixture();
    const migratedAtMs = 1_800_000_001_000;
    const nextPolicyHash = await probePolicyHash();
    const nextScriptHash = await probeLedgerScriptHash();
    const manifest = await createProbeV03PolicyMigrationManifest({
      sourceReceipt: fixture.source,
      predecessorReceipt: fixture.predecessor,
      migrationCommit: "d".repeat(40),
      nextPolicyHash,
      nextScriptHash
    });
    const migrationDigest = await probeV03PolicyMigrationDigest(manifest);
    const predecessorReply = [
      1,
      fixture.predecessor.version,
      fixture.predecessor.migrationId,
      fixture.predecessor.migrationDigest,
      fixture.predecessor.priorAppCommit,
      fixture.predecessor.priorActivationHash,
      fixture.predecessor.priorEvidenceDigest,
      fixture.predecessor.guardInstanceId,
      fixture.predecessor.initializedCommit,
      fixture.predecessor.previousPolicyVersion,
      fixture.predecessor.previousPolicyHash,
      fixture.predecessor.previousScriptHash,
      fixture.predecessor.nextPolicyVersion,
      fixture.predecessor.nextPolicyHash,
      fixture.predecessor.nextScriptHash,
      fixture.predecessor.migratedAtMs,
      fixture.predecessor.migrationCommit,
      ...fixture.predecessor.knownCalls.flatMap((call) => [
        call.ordinal,
        call.jti,
        call.dispatchSequence,
        call.actualNanoUsd,
        call.providerResponseHash,
        call.settlementDigest,
        call.usageHash
      ])
    ];
    const v03Reply = [
      1,
      manifest.version,
      manifest.migrationId,
      migrationDigest,
      manifest.priorAppCommit,
      manifest.priorActivationHash,
      manifest.predecessorMigrationId,
      manifest.predecessorMigrationReceiptHash,
      manifest.guardInstanceId,
      manifest.initializedCommit,
      manifest.previousPolicyVersion,
      manifest.previousPolicyHash,
      manifest.previousScriptHash,
      manifest.nextPolicyVersion,
      manifest.nextPolicyHash,
      manifest.nextScriptHash,
      manifest.preserved.knownActualNanoUsd,
      migratedAtMs,
      manifest.migrationCommit,
      ...manifest.knownCalls.flatMap((call) => [
        call.ordinal,
        call.jti,
        call.dispatchSequence,
        call.actualNanoUsd,
        call.providerResponseHash,
        call.settlementDigest,
        call.usageHash
      ])
    ];
    const evalMock = vi.fn(async () => [1, "V03_MIGRATED_NEW", migratedAtMs]);
    const evalRoMock = vi
      .fn()
      .mockResolvedValueOnce(predecessorReply)
      .mockResolvedValueOnce(v03Reply);
    const client = { eval: evalMock, evalRo: evalRoMock } as unknown as ProbeRedisClient;
    const result = await migrateProbeGuardPolicyV03(client, {
      sourceReceipt: fixture.source,
      predecessorReceipt: fixture.predecessor,
      migrationCommit: "d".repeat(40)
    });
    expect(result.disposition).toBe("new");
    expect(result.receipt.predecessorMigrationReceiptHash).toBe(fixture.predecessor.receiptHash);
    const call = evalMock.mock.calls[0] as unknown[] | undefined;
    expect(call?.[1]).toHaveLength(17);
    expect(call?.[2]).toHaveLength(86);
    expect((call?.[2] as string[])[31]).toBe("5");
    expect((call?.[2] as string[])[36]).toBe("5");
    expect((call?.[2] as string[])[72]).toBe("d".repeat(40));
    expect(evalRoMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the v0.3 Lua transition free of counter resets and destructive commands", () => {
    const script = PROBE_LEDGER_SCRIPTS.migratePolicyV03;
    expect(script).toContain("if ordinal == 4 then");
    expect(script).toContain('"predecessor_receipt_hash", ARGV[7]');
    expect(script).toContain(
      'redis.call("HSET", KEYS[3], "calibration", ARGV[27], "judge", ARGV[31])'
    );
    expect(script).not.toContain('redis.call("DEL"');
    expect(script).not.toContain('redis.call("UNLINK"');
    expect(script).not.toContain('redis.call("EXPIRE"');
    expect(script).not.toContain('redis.call("HINCRBY"');
  });

  it("discovers the exact five-record KNOWN set and rejects orphan durable lineage", async () => {
    const fixture = await sourceFixture();
    const predecessor = fixture.predecessor;
    const predecessorReply = [
      1,
      predecessor.version,
      predecessor.migrationId,
      predecessor.migrationDigest,
      predecessor.priorAppCommit,
      predecessor.priorActivationHash,
      predecessor.priorEvidenceDigest,
      predecessor.guardInstanceId,
      predecessor.initializedCommit,
      predecessor.previousPolicyVersion,
      predecessor.previousPolicyHash,
      predecessor.previousScriptHash,
      predecessor.nextPolicyVersion,
      predecessor.nextPolicyHash,
      predecessor.nextScriptHash,
      predecessor.migratedAtMs,
      predecessor.migrationCommit,
      ...predecessor.knownCalls.flatMap((call) => [
        call.ordinal,
        call.jti,
        call.dispatchSequence,
        call.actualNanoUsd,
        call.providerResponseHash,
        call.settlementDigest,
        call.usageHash
      ])
    ];
    const fifth = fixture.source.knownCalls[4]!;
    const authKeys = fixture.source.knownCalls.map((call) => `tp:{webmcp26}:auth:${call.jti}`);
    const providerKeys = fixture.source.knownCalls.map(
      (call) => `tp:{webmcp26}:provider:${call.providerResponseHash}`
    );
    let extraProviderKey: string | undefined;
    // Assigned after the first orphan-provider scenario so the same mock can model both branches.
    // eslint-disable-next-line prefer-const
    let extraKnownCall:
      | {
          readonly jti: string;
          readonly providerResponseHash: string;
        }
      | undefined;
    const statusReply = [
      1,
      "open",
      guardInstanceId,
      PROBE_V03_PREVIOUS_POLICY_HASH,
      PROBE_V03_PREVIOUS_LEDGER_SCRIPT_HASH,
      5,
      312_500_000,
      0,
      5,
      0,
      13_860_800,
      0,
      PROBE_V03_PREVIOUS_POLICY_VERSION,
      PROBE_MODEL,
      PROBE_GLOBAL_CALL_LIMIT,
      PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
      PROBE_PER_CALL_RESERVATION_NANO_USD,
      PROBE_MAX_CONCURRENCY,
      Date.parse(PROBE_CHALLENGE_CLOSES_AT),
      initializedCommit,
      8,
      72,
      2,
      72,
      6,
      5,
      0,
      0,
      0,
      0,
      0,
      5,
      0,
      0
    ];
    const evalRo = vi
      .fn()
      .mockResolvedValueOnce(predecessorReply)
      .mockResolvedValueOnce(statusReply);
    const scan = vi.fn(
      async (_cursor: string, options: { match?: string }) =>
        [
          "0",
          options.match?.includes(":auth:")
            ? [...authKeys, ...(extraKnownCall ? [`tp:{webmcp26}:auth:${extraKnownCall.jti}`] : [])]
            : [...providerKeys, ...(extraProviderKey ? [extraProviderKey] : [])]
        ] as [string, string[]]
    );
    const hgetall = vi.fn(async (key: string) => {
      if (extraKnownCall && key.endsWith(`:${extraKnownCall.jti}`)) {
        return {
          state: "KNOWN",
          jti: extraKnownCall.jti,
          purpose: "calibration",
          guard_instance_id: guardInstanceId,
          policy_hash: PROBE_V03_PREVIOUS_POLICY_HASH,
          script_hash: PROBE_V03_PREVIOUS_LEDGER_SCRIPT_HASH,
          reservation_nusd: PROBE_PER_CALL_RESERVATION_NANO_USD,
          dispatch_sequence: 5,
          actual_nusd: 1,
          provider_response_hash: extraKnownCall.providerResponseHash,
          settlement_digest: "8".repeat(64),
          usage_hash: "9".repeat(64),
          settled_at_ms: 4
        };
      }
      const call = fixture.source.knownCalls.find((entry) => key.endsWith(`:${entry.jti}`));
      if (!call) return null;
      const historical = call.dispatchSequence <= 4;
      return {
        state: "KNOWN",
        jti: call.jti,
        purpose: "calibration",
        guard_instance_id: guardInstanceId,
        policy_hash: historical ? PROBE_PREVIOUS_POLICY_HASH : PROBE_V03_PREVIOUS_POLICY_HASH,
        script_hash: historical
          ? PROBE_PREVIOUS_LEDGER_SCRIPT_HASH
          : PROBE_V03_PREVIOUS_LEDGER_SCRIPT_HASH,
        reservation_nusd: PROBE_PER_CALL_RESERVATION_NANO_USD,
        dispatch_sequence: call.dispatchSequence,
        actual_nusd: call.actualNanoUsd,
        provider_response_hash: call.providerResponseHash,
        settlement_digest: call.settlementDigest,
        usage_hash: call.usageHash,
        settled_at_ms: 3
      };
    });
    const client = {
      eval: vi.fn(),
      evalRo,
      scan,
      hgetall,
      pttl: vi.fn(async () => -1),
      get: vi.fn(
        async (key: string) =>
          fixture.source.knownCalls.find((entry) => key.endsWith(`:${entry.providerResponseHash}`))
            ?.jti
      )
    } as unknown as ProbeRedisDiscoveryClient;
    const discovered = await discoverProbeV03PolicyMigrationSource(client, {
      guardInstanceId,
      initializedCommit,
      expectedPredecessorReceiptHash: predecessor.receiptHash
    });
    expect(discovered.sourceReceipt.knownCalls).toHaveLength(5);
    expect(discovered.sourceReceipt.knownCalls[4]).toEqual(fifth);
    expect(scan).toHaveBeenCalledTimes(2);
    expect(hgetall).toHaveBeenCalledTimes(5);

    evalRo.mockResolvedValueOnce(predecessorReply).mockResolvedValueOnce(statusReply);
    extraProviderKey = `tp:{webmcp26}:provider:${"0".repeat(64)}`;
    await expect(
      discoverProbeV03PolicyMigrationSource(client, {
        guardInstanceId,
        initializedCommit,
        expectedPredecessorReceiptHash: predecessor.receiptHash
      })
    ).rejects.toThrow(/V03_DISCOVERY_ORPHAN_PROVIDER_RECORD/u);

    evalRo.mockResolvedValueOnce(predecessorReply).mockResolvedValueOnce(statusReply);
    extraProviderKey = undefined;
    extraKnownCall = {
      jti: "jti_v03_orphan_555555555",
      providerResponseHash: "0".repeat(64)
    };
    await expect(
      discoverProbeV03PolicyMigrationSource(client, {
        guardInstanceId,
        initializedCommit,
        expectedPredecessorReceiptHash: predecessor.receiptHash
      })
    ).rejects.toThrow(/V03_DISCOVERY_ORPHAN_KNOWN_CALL/u);
  });
});
