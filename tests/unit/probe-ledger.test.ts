import { describe, expect, it, vi } from "vitest";

import {
  PROBE_LEDGER_SCRIPTS,
  ProbeLedgerError,
  beginProbeCall,
  createProbeLedgerKeyspace,
  initializeProbeGuard,
  issueProbeAuthorization,
  migrateProbeGuardPolicy,
  probeLedgerScriptHash,
  probeAuthorizationKey,
  readProbeGuardStatus,
  readProbePolicyMigrationReceipt,
  reapExpiredProbeCall,
  settleProbeCallKnown,
  settleProbeCallUncertain,
  type ProbeGuardIdentity,
  type ProbeRedisClient
} from "@/lib/probe/ledger";
import {
  PROBE_MIGRATED_LEDGER_SCRIPT_HASH,
  PROBE_MIGRATED_POLICY_HASH,
  PROBE_MIGRATED_POLICY_VERSION,
  PROBE_POLICY_MIGRATION_ID,
  PROBE_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
  PROBE_POLICY_MIGRATION_PRIOR_APP_COMMIT,
  PROBE_POLICY_MIGRATION_PRIOR_EVIDENCE_DIGEST,
  PROBE_POLICY_MIGRATION_PRIOR_RECEIPT_VERSION,
  PROBE_PREVIOUS_LEDGER_SCRIPT_HASH,
  PROBE_PREVIOUS_POLICY_HASH,
  PROBE_PREVIOUS_POLICY_VERSION,
  createProbePolicyMigrationManifest,
  parseProbePolicyMigrationPriorReceipt,
  probePolicyMigrationDigest,
  type ProbePolicyMigrationPriorReceipt
} from "@/lib/probe/policy-migration-contract";

const identity: ProbeGuardIdentity = {
  guardInstanceId: "guard_0123456789abcdef",
  policyHash: "a".repeat(64),
  scriptHash: "b".repeat(64),
  initializedCommit: "f".repeat(40)
};

function fakeRedis(reply: unknown): {
  readonly client: ProbeRedisClient;
  readonly evalMock: ReturnType<typeof vi.fn>;
} {
  const evalMock = vi.fn(async () => reply);
  return {
    client: { eval: evalMock, evalRo: evalMock } as unknown as ProbeRedisClient,
    evalMock
  };
}

function migrationPriorReceipt(): ProbePolicyMigrationPriorReceipt {
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
      [0, "jti_migration_000000000000", 1, 2_752_200, "1", "2", "3"],
      [1, "jti_migration_111111111111", 2, 2_745_600, "4", "5", "6"],
      [2, "jti_migration_222222222222", 3, 2_862_200, "7", "8", "9"],
      [3, "jti_migration_333333333333", 4, 3_000_800, "a", "b", "c"]
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
}

async function migrationReadReply(migratedAtMs = 1_800_000_000_000): Promise<unknown[]> {
  const prior = migrationPriorReceipt();
  const manifest = createProbePolicyMigrationManifest({
    priorReceipt: prior,
    migrationCommit: "e".repeat(40),
    nextPolicyHash: PROBE_MIGRATED_POLICY_HASH,
    nextScriptHash: PROBE_MIGRATED_LEDGER_SCRIPT_HASH
  });
  return [
    1,
    manifest.version,
    manifest.migrationId,
    await probePolicyMigrationDigest(manifest),
    manifest.priorAppCommit,
    manifest.priorActivationHash,
    manifest.priorEvidenceDigest,
    manifest.guardInstanceId,
    manifest.initializedCommit,
    manifest.previousPolicyVersion,
    manifest.previousPolicyHash,
    manifest.previousScriptHash,
    manifest.nextPolicyVersion,
    manifest.nextPolicyHash,
    manifest.nextScriptHash,
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
}

function migrationRedis(evalReply: unknown, evalRoReply: unknown) {
  const evalMock = vi.fn(async () => evalReply);
  const evalRoMock = vi.fn(async () => evalRoReply);
  return {
    client: { eval: evalMock, evalRo: evalRoMock } as unknown as ProbeRedisClient,
    evalMock,
    evalRoMock
  };
}

describe("durable Probe guard adapter", () => {
  it("freezes the reviewed Lua bundle hash", async () => {
    expect(PROBE_PREVIOUS_LEDGER_SCRIPT_HASH).toBe(
      "41d351ad5d1adb81b0c6a90aa930cf1ae932b053d58b097c0283846728b798d2"
    );
    await expect(probeLedgerScriptHash()).resolves.toBe(
      "c25d90f7e060662867925e83c6d33dc7636f22b18cbcd94c3ffc6880eb907779"
    );
  });

  it("initializes only through the explicit operator transition", async () => {
    const { client } = fakeRedis([1, "INITIALIZED", identity.guardInstanceId]);
    await expect(initializeProbeGuard(client, identity, 1_000)).resolves.toBe("INITIALIZED");
    expect(PROBE_LEDGER_SCRIPTS.init).toContain('return {0, "CONFIG_MISMATCH"}');
    expect(PROBE_LEDGER_SCRIPTS.init).toContain(
      'if config_exists > 0 or redis.call("EXISTS", KEYS[2], KEYS[3], KEYS[4], KEYS[5]) > 0'
    );
  });

  it("issues one permanent subject authorization without consuming budget", async () => {
    const { client, evalMock } = fakeRedis([1, "ISSUED_NEW", "jti_0123456789abcdef", 1_000, 1_120]);
    await expect(
      issueProbeAuthorization(client, {
        ...identity,
        jti: "jti_0123456789abcdef",
        claimsHash: "c".repeat(64),
        purpose: "judge",
        subjectHash: "d".repeat(64),
        actorHash: "e".repeat(64)
      })
    ).resolves.toEqual({ disposition: "new", issuedAt: 1_000, expiresAt: 1_120 });
    expect(String(evalMock.mock.calls[0]?.[0])).not.toContain('claimed_calls", 1');
  });

  it("authorizes a provider call only on explicit GRANTED_NEW", async () => {
    const { client } = fakeRedis([1, "GRANTED_NEW", 1, 1, 62_500_000, 1_045]);
    await expect(
      beginProbeCall(client, {
        ...identity,
        jti: "jti_0123456789abcdef",
        claimsHash: "c".repeat(64),
        purpose: "calibration"
      })
    ).resolves.toEqual({
      sequence: 1,
      claimedCalls: 1,
      committedNanoUsd: 62_500_000,
      leaseExpiresAt: 1_045
    });

    const ambiguous = fakeRedis([2, "GRANTED_EXISTING", 1, 1, 62_500_000, 1_045]);
    await expect(
      beginProbeCall(ambiguous.client, {
        ...identity,
        jti: "jti_0123456789abcdef",
        claimsHash: "c".repeat(64),
        purpose: "calibration"
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<ProbeLedgerError>>({ code: "AMBIGUOUS_GRANT" })
    );
    expect(PROBE_LEDGER_SCRIPTS.begin).toContain('"halt_reason", "CONFIG_DRIFT"');
    expect(PROBE_LEDGER_SCRIPTS.begin).toContain('"halt_reason", "MISSING_COUNTER"');
    expect(PROBE_LEDGER_SCRIPTS.begin).toContain('"halt_reason", "COUNTER_DRIFT"');
    expect(PROBE_LEDGER_SCRIPTS.begin).toContain("value == math.floor(value)");
    expect(PROBE_LEDGER_SCRIPTS.begin).toContain("sequence_value ~= claimed");
    expect(PROBE_LEDGER_SCRIPTS.issue).toContain('return {0, "COMMIT_MISMATCH"}');
    expect(PROBE_LEDGER_SCRIPTS.settleKnown).toContain('return {0, "COMMIT_MISMATCH"}');
    expect(PROBE_LEDGER_SCRIPTS.settleUncertain).toContain('return {0, "COMMIT_MISMATCH"}');
    expect(PROBE_LEDGER_SCRIPTS.reap).toContain('return {0, "COMMIT_MISMATCH"}');
    expect(PROBE_LEDGER_SCRIPTS.begin).toContain('return {0, "CHALLENGE_CLOSED"}');
  });

  it("binds ISSUE and BEGIN to the exact active run-index document owner", async () => {
    const activationHash = "a".repeat(64);
    const base = `tp:{webmcp26}:run-index:test_admission`;
    const runAdmission = {
      anchorKey: `${base}:${activationHash}:anchor`,
      dataKey: `${base}:${activationHash}:data`,
      activationHash,
      buildCommit: "b".repeat(40),
      ownerHash: "c".repeat(64),
      ownerRevision: 0,
      ordinal: 0
    };
    const issued = fakeRedis([1, "ISSUED_NEW", "jti_0123456789abcdef", 1_000, 1_120]);
    await issueProbeAuthorization(issued.client, {
      ...identity,
      jti: "jti_0123456789abcdef",
      claimsHash: "c".repeat(64),
      purpose: "calibration",
      subjectHash: "d".repeat(64),
      actorHash: "e".repeat(64),
      runAdmission
    });
    const issueKeys = issued.evalMock.mock.calls[0]?.[1] as string[];
    const issueArguments = issued.evalMock.mock.calls[0]?.[2] as string[];
    expect(issueKeys.slice(-2)).toEqual([runAdmission.anchorKey, runAdmission.dataKey]);
    expect(issueArguments.slice(-6)).toEqual([
      "1",
      activationHash,
      runAdmission.buildCommit,
      runAdmission.ownerHash,
      "0",
      "0"
    ]);

    const begun = fakeRedis([1, "GRANTED_NEW", 6, 6, 375_000_000, 1_045]);
    await beginProbeCall(begun.client, {
      ...identity,
      jti: "jti_0123456789abcdef",
      claimsHash: "c".repeat(64),
      purpose: "calibration",
      runAdmission
    });
    const beginKeys = begun.evalMock.mock.calls[0]?.[1] as string[];
    const beginArguments = begun.evalMock.mock.calls[0]?.[2] as string[];
    expect(beginKeys.slice(-2)).toEqual([runAdmission.anchorKey, runAdmission.dataKey]);
    expect(beginArguments.slice(-6)).toEqual(issueArguments.slice(-6));
    expect(PROBE_LEDGER_SCRIPTS.issue).toContain('return {0, "RUN_ADMISSION_INVALID"}');
    expect(PROBE_LEDGER_SCRIPTS.begin).toContain('return {0, "RUN_ADMISSION_INVALID"}');
    expect(PROBE_LEDGER_SCRIPTS.begin).toContain('"run_owner_hash", ARGV[24]');
    expect(PROBE_LEDGER_SCRIPTS.begin).toContain('"run_owner_revision", ARGV[25]');

    const keyspace = createProbeLedgerKeyspace();
    const fixtureJti = ["jti", "0123456789abcdef"].join("_");
    expect(probeAuthorizationKey(keyspace, fixtureJti)).toBe(
      ["tp", "{webmcp26}", "auth", fixtureJti].join(":")
    );
    await expect(
      beginProbeCall(begun.client, {
        ...identity,
        jti: "jti_0123456789abcdef",
        claimsHash: "c".repeat(64),
        purpose: "calibration",
        runAdmission: { ...runAdmission, dataKey: `${base}:${activationHash}:wrong` }
      })
    ).rejects.toMatchObject({ code: "INVALID_RUN_ADMISSION_KEY" });
  });

  it("retains the stale JTI needed by the confirmed operator reap path", async () => {
    const { client } = fakeRedis([0, "STALE_INFLIGHT_REQUIRES_REAP", "jti_stale_0123456789"]);
    await beginProbeCall(client, {
      ...identity,
      jti: "jti_0123456789abcdef",
      claimsHash: "c".repeat(64),
      purpose: "calibration"
    }).then(
      () => {
        throw new Error("stale lease was not rejected");
      },
      (error: unknown) => {
        expect(error).toEqual(
          expect.objectContaining<Partial<ProbeLedgerError>>({
            code: "STALE_INFLIGHT_REQUIRES_REAP",
            details: ["jti_stale_0123456789"]
          })
        );
      }
    );
  });

  it("records known and uncertain terminal outcomes without restoring admission capacity", async () => {
    const known = fakeRedis([1, "KNOWN_NEW", 10_000_000, 1, 62_500_000]);
    await expect(
      settleProbeCallKnown(known.client, {
        ...identity,
        jti: "jti_0123456789abcdef",
        actualNanoUsd: 10_000_000,
        providerResponseHash: "c".repeat(64),
        settlementDigest: "d".repeat(64),
        usageHash: "e".repeat(64),
        settledAtMs: 2_000
      })
    ).resolves.toEqual({ disposition: "new", actualNanoUsd: 10_000_000 });

    const uncertain = fakeRedis([1, "UNCERTAIN_NEW", 62_500_000, 1, 62_500_000]);
    await expect(
      settleProbeCallUncertain(uncertain.client, {
        ...identity,
        jti: "jti_0123456789abcdef",
        settlementDigest: "f".repeat(64),
        reason: "provider_timeout",
        settledAtMs: 2_000
      })
    ).resolves.toEqual({ disposition: "new", upperBoundNanoUsd: 62_500_000 });

    expect(PROBE_LEDGER_SCRIPTS.settleKnown).not.toContain('"committed_nusd", -');
    expect(PROBE_LEDGER_SCRIPTS.settleKnown).toContain('redis.call("ZREM", KEYS[3], jti)');
    expect(PROBE_LEDGER_SCRIPTS.settleKnown).toContain('"halt_reason", "MISSING_INFLIGHT_LEASE"');
    expect(PROBE_LEDGER_SCRIPTS.settleUncertain).toContain('"status", "quarantined"');
    expect(PROBE_LEDGER_SCRIPTS.settleUncertain).toContain(
      'if config_status == "halted" then return {0, "GUARD_HALTED"} end'
    );
  });

  it("reaps an expired lease into uncertainty rather than reopening concurrency", async () => {
    const { client } = fakeRedis([1, "UNCERTAIN_NEW", 62_500_000]);
    await expect(
      reapExpiredProbeCall(client, {
        ...identity,
        jti: "jti_0123456789abcdef",
        settlementDigest: "a".repeat(64)
      })
    ).resolves.toEqual({ disposition: "new", upperBoundNanoUsd: 62_500_000 });
    expect(PROBE_LEDGER_SCRIPTS.reap).toContain('"uncertain_reason", "lease_expired"');
  });

  it("keeps subject, authorization, policy, and counter records free of TTL resets", () => {
    expect(PROBE_LEDGER_SCRIPTS.issue).not.toContain('redis.call("EXPIRE"');
    expect(PROBE_LEDGER_SCRIPTS.begin).not.toContain('redis.call("EXPIRE"');
  });

  it("atomically migrates the exact four-call guard and returns a durable self-verifying receipt", async () => {
    const migratedAtMs = 1_800_000_000_000;
    const redis = migrationRedis(
      [1, "MIGRATED_NEW", migratedAtMs],
      await migrationReadReply(migratedAtMs)
    );
    const result = await migrateProbeGuardPolicy(redis.client, {
      priorReceipt: migrationPriorReceipt(),
      migrationCommit: "e".repeat(40)
    });
    expect(result.disposition).toBe("new");
    expect(result.receipt).toMatchObject({
      migrationId: PROBE_POLICY_MIGRATION_ID,
      previousPolicyVersion: PROBE_PREVIOUS_POLICY_VERSION,
      nextPolicyVersion: PROBE_MIGRATED_POLICY_VERSION,
      migratedAtMs,
      preserved: {
        claimedCalls: 4,
        knownCalls: 4,
        committedNanoUsd: 250_000_000,
        knownActualNanoUsd: 11_360_800,
        sequence: 4
      }
    });
    expect(result.receipt.receiptHash).toMatch(/^[a-f0-9]{64}$/u);
    const firstEvalCall = redis.evalMock.mock.calls[0] as unknown[] | undefined;
    const keys = firstEvalCall?.[1] as string[];
    const args = firstEvalCall?.[2] as string[];
    expect(keys).toHaveLength(14);
    expect(keys[5]).toContain(`:policy-migration:${PROBE_POLICY_MIGRATION_ID}`);
    expect(args[30]).toBe("4");
    expect(args[31]).toBe("250000000");
    expect(args[32]).toBe("4");
    expect(args[33]).toBe("11360800");
    expect(args[34]).toBe("4");
    expect(args[35]).toBe("4");
    expect(args[64]).toBe("e".repeat(40));
    expect(redis.evalRoMock).toHaveBeenCalledTimes(1);
  });

  it("returns the identical immutable receipt on an exact migration replay", async () => {
    const migratedAtMs = 1_800_000_000_000;
    const reply = await migrationReadReply(migratedAtMs);
    const redis = migrationRedis([2, "MIGRATED_EXISTING", migratedAtMs], reply);
    const result = await migrateProbeGuardPolicy(redis.client, {
      priorReceipt: migrationPriorReceipt(),
      migrationCommit: "e".repeat(40)
    });
    const read = await readProbePolicyMigrationReceipt(redis.client);
    expect(result.disposition).toBe("existing");
    expect(result.receipt).toEqual(read);
  });

  it.each([
    "MIGRATION_RECEIPT_CONFLICT",
    "MIGRATION_STATE_MISMATCH",
    "MIGRATION_OLD_CONFIG_MISMATCH",
    "MIGRATION_KNOWN_CALL_MISMATCH",
    "MIGRATION_REPLAY_STATE_MISMATCH",
    "CHALLENGE_CLOSED"
  ])("rejects %s without accepting a receipt", async (code) => {
    const redis = migrationRedis([0, code], await migrationReadReply());
    await expect(
      migrateProbeGuardPolicy(redis.client, {
        priorReceipt: migrationPriorReceipt(),
        migrationCommit: "e".repeat(40)
      })
    ).rejects.toMatchObject({ code });
    expect(redis.evalRoMock).not.toHaveBeenCalled();
  });

  it("keeps migration Lua free of reset/counter mutations and binds every old/new invariant", () => {
    expect(PROBE_LEDGER_SCRIPTS.migratePolicy).toContain('return {0, "MIGRATION_STATE_MISMATCH"}');
    expect(PROBE_LEDGER_SCRIPTS.migratePolicy).toContain(
      'return {0, "MIGRATION_KNOWN_CALL_MISMATCH"}'
    );
    expect(PROBE_LEDGER_SCRIPTS.migratePolicy).toContain('return {0, "CHALLENGE_CLOSED"}');
    expect(PROBE_LEDGER_SCRIPTS.migratePolicy).toContain('redis.call("PTTL", auth_key) ~= -1');
    expect(PROBE_LEDGER_SCRIPTS.migratePolicy).toContain('redis.call("GET", provider_key) ~= jti');
    expect(PROBE_LEDGER_SCRIPTS.migratePolicy).not.toContain("HINCRBY");
    expect(PROBE_LEDGER_SCRIPTS.migratePolicy).not.toContain('redis.call("DEL"');
    expect(PROBE_LEDGER_SCRIPTS.migratePolicy).not.toContain('redis.call("EXPIRE"');
    expect(PROBE_LEDGER_SCRIPTS.migratePolicy).not.toContain('redis.call("ZADD"');
    expect(PROBE_LEDGER_SCRIPTS.migratePolicy).not.toContain('redis.call("ZREM"');
  });

  it("parses the preserved old status and the exact migrated vNext status without conflation", async () => {
    const prior = migrationPriorReceipt();
    const oldStatus = fakeRedis([
      1,
      "open",
      prior.guardInstanceId,
      PROBE_PREVIOUS_POLICY_HASH,
      PROBE_PREVIOUS_LEDGER_SCRIPT_HASH,
      4,
      250_000_000,
      0,
      4,
      0,
      11_360_800,
      0,
      PROBE_PREVIOUS_POLICY_VERSION,
      "gpt-5.6-terra",
      160,
      10_000_000_000,
      62_500_000,
      1,
      1_790_000_000_000,
      prior.initializedCommit,
      4,
      72,
      2,
      72,
      10,
      4,
      0,
      0,
      0,
      0,
      0,
      4,
      0,
      0
    ]);
    const nextPolicyHash = PROBE_MIGRATED_POLICY_HASH;
    const nextScriptHash = PROBE_MIGRATED_LEDGER_SCRIPT_HASH;
    const newStatus = fakeRedis([
      1,
      "open",
      prior.guardInstanceId,
      nextPolicyHash,
      nextScriptHash,
      4,
      250_000_000,
      0,
      4,
      0,
      11_360_800,
      0,
      PROBE_MIGRATED_POLICY_VERSION,
      "gpt-5.6-terra",
      160,
      10_000_000_000,
      62_500_000,
      1,
      1_790_000_000_000,
      prior.initializedCommit,
      8,
      72,
      2,
      72,
      6,
      4,
      0,
      0,
      0,
      0,
      0,
      4,
      0,
      0
    ]);
    await expect(readProbeGuardStatus(oldStatus.client)).resolves.toMatchObject({
      policyVersion: PROBE_PREVIOUS_POLICY_VERSION,
      purposeLimits: { calibration: 4, judge: 10 }
    });
    await expect(readProbeGuardStatus(newStatus.client)).resolves.toMatchObject({
      policyVersion: PROBE_MIGRATED_POLICY_VERSION,
      purposeLimits: { calibration: 8, judge: 6 },
      claimedCalls: 4,
      knownCount: 4,
      sequence: 4
    });
  });
});
