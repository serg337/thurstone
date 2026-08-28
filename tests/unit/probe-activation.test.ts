import { describe, expect, it, vi } from "vitest";

import {
  PROBE_ACTIVATION_MODE,
  ProbeActivationError,
  computeProbeActivationHash,
  createProbeActivationManifest,
  probeActivationFrozenHashes,
  requireProbeActivation,
  validateProbeActivationGuard
} from "@/lib/probe/activation";
import { probeLedgerScriptHash, type ProbeGuardStatus } from "@/lib/probe/ledger";
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
  probePolicyMigrationDigest
} from "@/lib/probe/policy-migration-contract";
import {
  PROBE_V03_MIGRATED_LEDGER_SCRIPT_HASH,
  PROBE_V03_MIGRATED_POLICY_HASH,
  PROBE_V03_MIGRATED_POLICY_VERSION,
  PROBE_V03_MIGRATED_PURPOSE_CALL_LIMITS,
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
  PROBE_V03_PREVIOUS_PURPOSE_CALL_LIMITS,
  createProbeV03PolicyMigrationReceipt,
  parseProbeV03PolicyMigrationSourceReceipt,
  probeV03PolicyMigrationDigest,
  type ProbeV03PolicyMigrationManifest
} from "@/lib/probe/policy-v03-migration-contract";
import {
  PROBE_V04_MIGRATED_LEDGER_SCRIPT_HASH,
  PROBE_V04_MIGRATED_POLICY_HASH,
  PROBE_V04_MIGRATED_POLICY_VERSION,
  PROBE_V04_MIGRATED_PURPOSE_CALL_LIMITS,
  PROBE_V04_MIGRATED_RUNNER_CONTRACT_HASH,
  PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
  PROBE_V04_POLICY_MIGRATION_ID,
  PROBE_V04_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
  PROBE_V04_POLICY_MIGRATION_PRIOR_APP_COMMIT,
  PROBE_V04_POLICY_MIGRATION_VERSION,
  PROBE_V04_PRIOR_ATTEMPT3_EVIDENCE_DIGEST,
  PROBE_V04_PRIOR_ATTEMPT3_RAW_SHA256,
  PROBE_V04_PREVIOUS_LEDGER_SCRIPT_HASH,
  PROBE_V04_PREVIOUS_POLICY_HASH,
  PROBE_V04_PREVIOUS_POLICY_VERSION,
  PROBE_V04_PREVIOUS_PURPOSE_CALL_LIMITS,
  PROBE_V04_PREVIOUS_RUNNER_CONTRACT_HASH,
  createProbeV04PolicyMigrationReceipt,
  probeV04PolicyMigrationDigest,
  probeV04PolicyMigrationReceiptHash,
  type ProbeV04PolicyMigrationReceipt,
  type ProbeV04PolicyMigrationManifest
} from "@/lib/probe/policy-v04-migration-contract";
import { PROBE_V04_POLICY_MIGRATION_PROGRAM_HASH } from "@/lib/probe/policy-v04-migration.server";
import {
  PROBE_V05_ACK_ANCHOR_FIXED,
  PROBE_V05_MIGRATED_POLICY_VERSION,
  PROBE_V05_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
  PROBE_V05_POLICY_MIGRATION_ID,
  PROBE_V05_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
  PROBE_V05_POLICY_MIGRATION_PRIOR_APP_COMMIT,
  PROBE_V05_POLICY_MIGRATION_VERSION,
  PROBE_V05_PREVIOUS_LEDGER_SCRIPT_HASH,
  PROBE_V05_PREVIOUS_POLICY_HASH,
  PROBE_V05_PREVIOUS_POLICY_VERSION,
  PROBE_V05_PREVIOUS_PURPOSE_CALL_LIMITS,
  PROBE_V05_PREVIOUS_RUNNER_CONTRACT_HASH,
  PROBE_V05_PRIOR_EVIDENCE_DIGEST,
  PROBE_V05_PRIOR_EVIDENCE_RAW_SHA256,
  PROBE_V05_PRIOR_REPRODUCER_EVIDENCE_DIGEST,
  PROBE_V05_PRIOR_REPRODUCER_RAW_SHA256,
  createProbeV05PolicyMigrationReceipt,
  probeV05PolicyMigrationDigest,
  probeV05PolicyMigrationReceiptHash,
  type ProbeV05PolicyMigrationManifest,
  type ProbeV05PolicyMigrationReceipt
} from "@/lib/probe/policy-v05-migration-contract";
import { PROBE_V05_POLICY_MIGRATION_PROGRAM_HASH } from "@/lib/probe/policy-v05-migration.server";
import {
  PROBE_CHALLENGE_CLOSES_AT,
  PROBE_GLOBAL_CALL_LIMIT,
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
  PROBE_MAX_CONCURRENCY,
  PROBE_MODEL,
  PROBE_PER_CALL_RESERVATION_NANO_USD,
  PROBE_POLICY_VERSION,
  PROBE_PURPOSE_CALL_LIMITS,
  probePolicyHash
} from "@/lib/probe/policy";

const signingSecret = Buffer.alloc(32, 3).toString("base64url");
const activationSecret = Buffer.alloc(32, 4).toString("base64url");
const activeCommit = "a".repeat(40);
const initializedCommit = "b".repeat(40);
const guardInstanceId = "guard_0123456789abcdef";
const projectId = `prj_${"p".repeat(24)}`;
const operatorCapabilityHash = "d".repeat(64);
const nowMs = Date.parse("2026-08-27T12:00:00.000Z");

function guard(overrides: Partial<ProbeGuardStatus> = {}): ProbeGuardStatus {
  return {
    status: "open",
    guardInstanceId,
    policyHash: "",
    scriptHash: "",
    initializedCommit,
    claimedCalls: 0,
    committedNanoUsd: 0,
    pendingCount: 0,
    knownCount: 0,
    uncertainCount: 0,
    knownActualNanoUsd: 0,
    uncertainUpperNanoUsd: 0,
    policyVersion: PROBE_POLICY_VERSION,
    model: PROBE_MODEL,
    globalCallLimit: PROBE_GLOBAL_CALL_LIMIT,
    spendCeilingNanoUsd: PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
    perCallReservationNanoUsd: PROBE_PER_CALL_RESERVATION_NANO_USD,
    maxConcurrency: PROBE_MAX_CONCURRENCY,
    challengeClosesAtMs: Date.parse(PROBE_CHALLENGE_CLOSES_AT),
    purposeLimits: PROBE_PURPOSE_CALL_LIMITS,
    purposeCounts: { calibration: 0, baseline: 0, repair: 0, revised: 0, judge: 0 },
    inflightCount: 0,
    sequence: 0,
    haltMarkerPresent: false,
    uncertainMarkerPresent: false,
    ...overrides
  };
}

async function validFixture() {
  const hashes = await probeActivationFrozenHashes();
  const priorReceipt = parseProbePolicyMigrationPriorReceipt({
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
      [0, "jti_activation_000000000000", 1, 2_752_200, "1", "2", "3"],
      [1, "jti_activation_111111111111", 2, 2_745_600, "4", "5", "6"],
      [2, "jti_activation_222222222222", 3, 2_862_200, "7", "8", "9"],
      [3, "jti_activation_333333333333", 4, 3_000_800, "a", "b", "c"]
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
  const predecessorManifest = createProbePolicyMigrationManifest({
    priorReceipt,
    migrationCommit: activeCommit,
    nextPolicyHash: PROBE_MIGRATED_POLICY_HASH,
    nextScriptHash: PROBE_MIGRATED_LEDGER_SCRIPT_HASH
  });
  const legacyMigration = await createProbePolicyMigrationReceipt(
    predecessorManifest,
    await probePolicyMigrationDigest(predecessorManifest),
    nowMs - 3_000
  );
  const sourceReceipt = await parseProbeV03PolicyMigrationSourceReceipt(
    {
      version: PROBE_V03_POLICY_MIGRATION_SOURCE_VERSION,
      migrationId: PROBE_V03_POLICY_MIGRATION_ID,
      priorAppCommit: PROBE_V03_POLICY_MIGRATION_PRIOR_APP_COMMIT,
      priorActivationHash: PROBE_V03_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
      predecessorMigrationId: PROBE_V03_PREDECESSOR_MIGRATION_ID,
      predecessorMigrationReceiptHash: legacyMigration.receiptHash,
      guardInstanceId,
      initializedCommit,
      previousPolicyVersion: PROBE_V03_PREVIOUS_POLICY_VERSION,
      previousPolicyHash: PROBE_V03_PREVIOUS_POLICY_HASH,
      previousScriptHash: PROBE_V03_PREVIOUS_LEDGER_SCRIPT_HASH,
      preserved: {
        ...PROBE_V03_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
        knownActualNanoUsd: 13_860_800
      },
      knownCalls: [
        ...legacyMigration.knownCalls,
        {
          ordinal: 4,
          jti: "jti_activation_444444444444",
          dispatchSequence: 5,
          actualNanoUsd: 2_500_000,
          providerResponseHash: "d".repeat(64),
          settlementDigest: "e".repeat(64),
          usageHash: "f".repeat(64)
        }
      ]
    },
    legacyMigration
  );
  const predecessorManifestV03 = {
    ...sourceReceipt,
    version: PROBE_V03_POLICY_MIGRATION_VERSION,
    migrationCommit: activeCommit,
    nextPolicyVersion: PROBE_V03_MIGRATED_POLICY_VERSION,
    nextPolicyHash: PROBE_V03_MIGRATED_POLICY_HASH,
    nextScriptHash: PROBE_V03_MIGRATED_LEDGER_SCRIPT_HASH,
    previousPurposeLimits: PROBE_V03_PREVIOUS_PURPOSE_CALL_LIMITS,
    nextPurposeLimits: PROBE_V03_MIGRATED_PURPOSE_CALL_LIMITS,
    globalCallLimit: PROBE_GLOBAL_CALL_LIMIT,
    lifetimeSpendCeilingNanoUsd: PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
    perCallReservationNanoUsd: PROBE_PER_CALL_RESERVATION_NANO_USD
  } satisfies ProbeV03PolicyMigrationManifest;
  const predecessorMigration = await createProbeV03PolicyMigrationReceipt(
    predecessorManifestV03,
    await probeV03PolicyMigrationDigest(predecessorManifestV03),
    nowMs - 2_000
  );
  const knownCalls = [
    ...predecessorMigration.knownCalls,
    ...[
      [5, 3_000_000, "0", "1", "2"],
      [6, 3_100_000, "3", "4", "5"],
      [7, 3_200_000, "6", "7", "8"],
      [8, 4_832_000, "9", "a", "b"]
    ].map(([ordinal, actualNanoUsd, response, settlement, usage]) => ({
      ordinal: Number(ordinal),
      jti: `jti_activation_${String(ordinal).repeat(12)}`,
      dispatchSequence: Number(ordinal) + 1,
      actualNanoUsd: Number(actualNanoUsd),
      providerResponseHash: String(response).repeat(64),
      settlementDigest: String(settlement).repeat(64),
      usageHash: String(usage).repeat(64)
    }))
  ];
  const migrationManifest = {
    version: PROBE_V04_POLICY_MIGRATION_VERSION,
    migrationId: PROBE_V04_POLICY_MIGRATION_ID,
    priorAppCommit: PROBE_V04_POLICY_MIGRATION_PRIOR_APP_COMMIT,
    priorActivationHash: PROBE_V04_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
    priorEvidenceRawSha256: PROBE_V04_PRIOR_ATTEMPT3_RAW_SHA256,
    priorEvidenceDigest: PROBE_V04_PRIOR_ATTEMPT3_EVIDENCE_DIGEST,
    predecessorMigrationId: PROBE_V03_POLICY_MIGRATION_ID,
    predecessorMigrationReceiptHash: predecessorMigration.receiptHash,
    guardInstanceId,
    initializedCommit,
    previousPolicyVersion: PROBE_V04_PREVIOUS_POLICY_VERSION,
    previousPolicyHash: PROBE_V04_PREVIOUS_POLICY_HASH,
    previousScriptHash: PROBE_V04_PREVIOUS_LEDGER_SCRIPT_HASH,
    previousRunnerHash: PROBE_V04_PREVIOUS_RUNNER_CONTRACT_HASH,
    preserved: PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
    knownCalls,
    migrationCommit: activeCommit,
    nextPolicyVersion: PROBE_V04_MIGRATED_POLICY_VERSION,
    nextPolicyHash: PROBE_V04_MIGRATED_POLICY_HASH,
    nextScriptHash: PROBE_V04_MIGRATED_LEDGER_SCRIPT_HASH,
    nextRunnerHash: PROBE_V04_MIGRATED_RUNNER_CONTRACT_HASH,
    migrationProgramHash: PROBE_V04_POLICY_MIGRATION_PROGRAM_HASH,
    previousPurposeLimits: PROBE_V04_PREVIOUS_PURPOSE_CALL_LIMITS,
    nextPurposeLimits: PROBE_V04_MIGRATED_PURPOSE_CALL_LIMITS,
    globalCallLimit: PROBE_GLOBAL_CALL_LIMIT,
    lifetimeSpendCeilingNanoUsd: PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
    perCallReservationNanoUsd: PROBE_PER_CALL_RESERVATION_NANO_USD
  } satisfies ProbeV04PolicyMigrationManifest;
  const predecessorMigrationV04 = await createProbeV04PolicyMigrationReceipt(
    migrationManifest,
    await probeV04PolicyMigrationDigest(migrationManifest),
    nowMs - 1_000
  );
  const v05Calls = [
    ...predecessorMigrationV04.knownCalls,
    ...[9, 10, 11, 12].map((ordinal) => ({
      ordinal,
      jti: `jti_activation_v05_${String(ordinal).repeat(10)}`,
      dispatchSequence: ordinal + 1,
      actualNanoUsd: [3_192_200, 3_207_600, 3_971_000, 3_801_600][ordinal - 9]!,
      providerResponseHash: ["c", "d", "e", "f"][ordinal - 9]!.repeat(64),
      settlementDigest: ["1", "2", "3", "4"][ordinal - 9]!.repeat(64),
      usageHash: ["5", "6", "7", "8"][ordinal - 9]!.repeat(64)
    }))
  ];
  const ackAnchor = {
    ...PROBE_V05_ACK_ANCHOR_FIXED,
    recoveryHash: "1".repeat(64),
    sessionHash: "2".repeat(64),
    runHash: "3".repeat(64),
    actorHash: "4".repeat(64),
    launchHash: "5".repeat(64),
    payloadBinding: "6".repeat(64),
    encryptedDataPresent: false as const
  };
  const v05Manifest = {
    version: PROBE_V05_POLICY_MIGRATION_VERSION,
    migrationId: PROBE_V05_POLICY_MIGRATION_ID,
    priorAppCommit: PROBE_V05_POLICY_MIGRATION_PRIOR_APP_COMMIT,
    priorActivationHash: PROBE_V05_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
    priorEvidenceRawSha256: PROBE_V05_PRIOR_EVIDENCE_RAW_SHA256,
    priorEvidenceDigest: PROBE_V05_PRIOR_EVIDENCE_DIGEST,
    priorReproducerRawSha256: PROBE_V05_PRIOR_REPRODUCER_RAW_SHA256,
    priorReproducerEvidenceDigest: PROBE_V05_PRIOR_REPRODUCER_EVIDENCE_DIGEST,
    predecessorMigrationId: PROBE_V04_POLICY_MIGRATION_ID,
    predecessorMigrationReceiptHash: predecessorMigrationV04.receiptHash,
    guardInstanceId,
    initializedCommit,
    previousPolicyVersion: PROBE_V05_PREVIOUS_POLICY_VERSION,
    previousPolicyHash: PROBE_V05_PREVIOUS_POLICY_HASH,
    previousScriptHash: PROBE_V05_PREVIOUS_LEDGER_SCRIPT_HASH,
    previousRunnerHash: PROBE_V05_PREVIOUS_RUNNER_CONTRACT_HASH,
    preserved: PROBE_V05_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
    knownCalls: v05Calls,
    ackAnchor,
    migrationCommit: activeCommit,
    nextPolicyVersion: PROBE_V05_MIGRATED_POLICY_VERSION,
    nextPolicyHash: hashes.policyHash,
    nextScriptHash: hashes.scriptHash,
    nextRunnerHash: hashes.runnerContractHash,
    migrationProgramHash: PROBE_V05_POLICY_MIGRATION_PROGRAM_HASH,
    previousPurposeLimits: PROBE_V05_PREVIOUS_PURPOSE_CALL_LIMITS,
    nextPurposeLimits: PROBE_PURPOSE_CALL_LIMITS,
    globalCallLimit: PROBE_GLOBAL_CALL_LIMIT,
    lifetimeSpendCeilingNanoUsd: PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
    perCallReservationNanoUsd: PROBE_PER_CALL_RESERVATION_NANO_USD
  } satisfies ProbeV05PolicyMigrationManifest;
  const migration = await createProbeV05PolicyMigrationReceipt(
    v05Manifest,
    await probeV05PolicyMigrationDigest(v05Manifest),
    nowMs - 500
  );
  const environment: Record<string, string> = {
    VERCEL: "1",
    VERCEL_ENV: "production",
    NODE_ENV: "production",
    VERCEL_PROJECT_ID: projectId,
    TOOLPROOF_EXPECTED_VERCEL_PROJECT_ID: projectId,
    VERCEL_GIT_COMMIT_SHA: activeCommit,
    TOOLPROOF_COMMIT_SHA: activeCommit,
    TOOLPROOF_PROBE_ACTIVE_COMMIT: activeCommit,
    TOOLPROOF_PROBE_ACTIVATION_MODE: PROBE_ACTIVATION_MODE,
    TOOLPROOF_PROBE_ACTIVATION_SECRET: activationSecret,
    TOOLPROOF_SIGNING_SECRET: signingSecret,
    TOOLPROOF_GUARD_INSTANCE_ID: guardInstanceId,
    TOOLPROOF_GUARD_INITIALIZED_COMMIT: initializedCommit,
    TOOLPROOF_PROBE_ACTIVE_POLICY_HASH: hashes.policyHash,
    TOOLPROOF_PROBE_ACTIVE_SCRIPT_HASH: hashes.scriptHash,
    TOOLPROOF_PROBE_ACTIVE_RUNNER_HASH: hashes.runnerContractHash,
    TOOLPROOF_PROBE_ACTIVE_CONTINUATION_HASH: hashes.continuationScriptHash,
    TOOLPROOF_PROBE_POLICY_MIGRATION_RECEIPT_HASH: migration.receiptHash,
    TOOLPROOF_PROBE_OPERATOR_CAPABILITY_HASH: operatorCapabilityHash,
    OPENAI_API_KEY: "configured",
    KV_REST_API_URL: "https://fixture.upstash.io",
    KV_REST_API_TOKEN: "configured"
  };
  const manifest = await createProbeActivationManifest(
    environment,
    hashes,
    predecessorMigrationV04.receiptHash
  );
  environment.TOOLPROOF_PROBE_ACTIVATION_HASH = computeProbeActivationHash(
    manifest,
    activationSecret
  );
  const liveGuard = guard({
    policyHash: hashes.policyHash,
    scriptHash: hashes.scriptHash,
    claimedCalls: 13,
    committedNanoUsd: 812_500_000,
    knownCount: 13,
    knownActualNanoUsd: 42_165_200,
    purposeCounts: { calibration: 13, baseline: 0, repair: 0, revised: 0, judge: 0 },
    sequence: 13
  });
  return {
    environment,
    hashes,
    manifest,
    liveGuard,
    predecessorMigration: predecessorMigrationV04,
    migration
  };
}

async function repinMigration(
  fixture: Awaited<ReturnType<typeof validFixture>>,
  changed: Omit<ProbeV05PolicyMigrationReceipt, "receiptHash">
): Promise<ProbeV05PolicyMigrationReceipt> {
  const migration = { ...changed, receiptHash: await probeV05PolicyMigrationReceiptHash(changed) };
  fixture.environment.TOOLPROOF_PROBE_POLICY_MIGRATION_RECEIPT_HASH = migration.receiptHash;
  const manifest = await createProbeActivationManifest(
    fixture.environment,
    fixture.hashes,
    fixture.predecessorMigration.receiptHash
  );
  fixture.environment.TOOLPROOF_PROBE_ACTIVATION_HASH = computeProbeActivationHash(
    manifest,
    activationSecret
  );
  return migration;
}

describe("Probe activation", () => {
  it("is disabled by default without reading durable state", async () => {
    const readGuard = vi.fn(async () => guard());
    const readMigration = vi.fn();
    const readPredecessorMigration = vi.fn();
    await expect(
      requireProbeActivation({
        environment: {},
        readGuard,
        readMigration,
        readPredecessorMigration,
        nowMs
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<ProbeActivationError>>({ code: "activation_disabled" })
    );
    expect(readGuard).not.toHaveBeenCalled();
    expect(readMigration).not.toHaveBeenCalled();
    expect(readPredecessorMigration).not.toHaveBeenCalled();
  });

  it("binds exact production, project, build, guard, and frozen contract identities", async () => {
    const fixture = await validFixture();
    const readGuard = vi.fn(async () => fixture.liveGuard);
    const readPredecessorMigration = vi.fn(async () => fixture.predecessorMigration);
    const readMigration = vi.fn(async () => fixture.migration);
    const activation = await requireProbeActivation({
      environment: fixture.environment,
      readGuard,
      readPredecessorMigration,
      readMigration,
      expectedPredecessorMigrationReceiptHash: fixture.predecessorMigration.receiptHash,
      nowMs
    });
    expect(readGuard).toHaveBeenCalledTimes(1);
    expect(readPredecessorMigration).toHaveBeenCalledTimes(1);
    expect(readMigration).toHaveBeenCalledTimes(1);
    expect(activation).toMatchObject({
      enabled: true,
      mode: "calibration",
      activationHash: fixture.environment.TOOLPROOF_PROBE_ACTIVATION_HASH,
      manifest: {
        version: "toolproof-probe-activation@5.0.0",
        activeCommit,
        vercelProjectId: projectId,
        guardInstanceId,
        guardInitializedCommit: initializedCommit,
        policyHash: fixture.hashes.policyHash,
        scriptHash: fixture.hashes.scriptHash,
        runnerContractHash: fixture.hashes.runnerContractHash,
        continuationScriptHash: fixture.hashes.continuationScriptHash,
        predecessorPolicyMigrationReceiptHash: fixture.predecessorMigration.receiptHash,
        policyMigrationReceiptHash: fixture.migration.receiptHash,
        operatorCapabilityHash
      },
      guard: { phase: "idle", claimedCalls: 13, pendingCalls: 0 },
      predecessorMigration: { receiptHash: fixture.predecessorMigration.receiptHash },
      migration: {
        receiptHash: fixture.migration.receiptHash,
        nextRunnerHash: fixture.hashes.runnerContractHash,
        globalCallLimit: 160,
        lifetimeSpendCeilingNanoUsd: 10_000_000_000,
        preserved: {
          claimedCalls: 13,
          knownCalls: 13,
          committedNanoUsd: 812_500_000,
          knownActualNanoUsd: 42_165_200,
          sequence: 13
        }
      }
    });
    expect(Object.isFrozen(activation)).toBe(true);
    expect(Object.isFrozen(activation.manifest)).toBe(true);
    expect(Object.isFrozen(activation.migration)).toBe(true);
    expect(Object.isFrozen(activation.migration.knownCalls)).toBe(true);
  });

  it.each([
    ["VERCEL", "0", "activation_environment_mismatch"],
    ["VERCEL_ENV", "preview", "activation_environment_mismatch"],
    ["NODE_ENV", "development", "activation_environment_mismatch"],
    ["VERCEL_PROJECT_ID", `prj_${"x".repeat(24)}`, "activation_project_mismatch"],
    ["TOOLPROOF_PROBE_ACTIVE_COMMIT", "c".repeat(40), "activation_commit_mismatch"],
    ["VERCEL_GIT_COMMIT_SHA", "c".repeat(40), "activation_commit_mismatch"],
    ["TOOLPROOF_COMMIT_SHA", "c".repeat(40), "activation_commit_mismatch"],
    ["TOOLPROOF_PROBE_ACTIVE_POLICY_HASH", "c".repeat(64), "activation_frozen_hash_mismatch"],
    ["TOOLPROOF_PROBE_ACTIVE_SCRIPT_HASH", "c".repeat(64), "activation_frozen_hash_mismatch"],
    ["TOOLPROOF_PROBE_ACTIVE_RUNNER_HASH", "c".repeat(64), "activation_frozen_hash_mismatch"],
    ["TOOLPROOF_PROBE_ACTIVE_CONTINUATION_HASH", "d".repeat(64), "activation_frozen_hash_mismatch"],
    ["TOOLPROOF_PROBE_OPERATOR_CAPABILITY_HASH", "e".repeat(64), "activation_hash_mismatch"],
    ["TOOLPROOF_PROBE_ACTIVATION_HASH", "c".repeat(64), "activation_hash_mismatch"]
  ])("fails closed when %s drifts", async (key, value, code) => {
    const fixture = await validFixture();
    fixture.environment[key] = value;
    await expect(
      requireProbeActivation({
        environment: fixture.environment,
        guard: fixture.liveGuard,
        predecessorMigration: fixture.predecessorMigration,
        migration: fixture.migration,
        expectedPredecessorMigrationReceiptHash: fixture.predecessorMigration.receiptHash,
        nowMs
      })
    ).rejects.toEqual(expect.objectContaining<Partial<ProbeActivationError>>({ code }));
  });

  it("requires a canonical separate 32-byte activation secret", async () => {
    const fixture = await validFixture();
    fixture.environment.TOOLPROOF_PROBE_ACTIVATION_SECRET = "weak";
    await expect(
      requireProbeActivation({
        environment: fixture.environment,
        guard: fixture.liveGuard,
        predecessorMigration: fixture.predecessorMigration,
        migration: fixture.migration,
        expectedPredecessorMigrationReceiptHash: fixture.predecessorMigration.receiptHash,
        nowMs
      })
    ).rejects.toMatchObject({ code: "activation_secret_invalid" });

    const reused = await validFixture();
    reused.environment.TOOLPROOF_PROBE_ACTIVATION_SECRET = signingSecret;
    const reusedManifest = await createProbeActivationManifest(
      reused.environment,
      reused.hashes,
      reused.predecessorMigration.receiptHash
    );
    reused.environment.TOOLPROOF_PROBE_ACTIVATION_HASH = computeProbeActivationHash(
      reusedManifest,
      signingSecret
    );
    await expect(
      requireProbeActivation({
        environment: reused.environment,
        guard: reused.liveGuard,
        predecessorMigration: reused.predecessorMigration,
        migration: reused.migration,
        expectedPredecessorMigrationReceiptHash: reused.predecessorMigration.receiptHash,
        nowMs
      })
    ).rejects.toMatchObject({ code: "activation_secret_not_separate" });
  });

  it("requires the env-pinned durable migration receipt and rejects receipt or base-state drift", async () => {
    const missing = await validFixture();
    await expect(
      requireProbeActivation({
        environment: missing.environment,
        guard: missing.liveGuard,
        predecessorMigration: missing.predecessorMigration,
        readMigration: async () => {
          throw new Error("missing");
        },
        expectedPredecessorMigrationReceiptHash: missing.predecessorMigration.receiptHash,
        nowMs
      })
    ).rejects.toMatchObject({ code: "activation_migration_invalid" });

    const tampered = await validFixture();
    await expect(
      requireProbeActivation({
        environment: tampered.environment,
        guard: tampered.liveGuard,
        predecessorMigration: tampered.predecessorMigration,
        migration: { ...tampered.migration, migratedAtMs: tampered.migration.migratedAtMs + 1 },
        expectedPredecessorMigrationReceiptHash: tampered.predecessorMigration.receiptHash,
        nowMs
      })
    ).rejects.toMatchObject({ code: "activation_migration_invalid" });

    const reset = await validFixture();
    await expect(
      requireProbeActivation({
        environment: reset.environment,
        guard: guard({
          policyHash: reset.hashes.policyHash,
          scriptHash: reset.hashes.scriptHash,
          claimedCalls: 13,
          committedNanoUsd: 812_500_000,
          knownCount: 13,
          knownActualNanoUsd: 42_165_199,
          purposeCounts: { calibration: 13, baseline: 0, repair: 0, revised: 0, judge: 0 },
          sequence: 13
        }),
        predecessorMigration: reset.predecessorMigration,
        migration: reset.migration,
        expectedPredecessorMigrationReceiptHash: reset.predecessorMigration.receiptHash,
        nowMs
      })
    ).rejects.toMatchObject({ code: "activation_migration_invalid" });

    const unpinned = await validFixture();
    delete unpinned.environment.TOOLPROOF_PROBE_POLICY_MIGRATION_RECEIPT_HASH;
    await expect(
      requireProbeActivation({
        environment: unpinned.environment,
        guard: unpinned.liveGuard,
        predecessorMigration: unpinned.predecessorMigration,
        migration: unpinned.migration,
        expectedPredecessorMigrationReceiptHash: unpinned.predecessorMigration.receiptHash,
        nowMs
      })
    ).rejects.toMatchObject({ code: "activation_migration_receipt_hash_invalid" });
  });

  it("rejects a self-consistent receipt that substitutes the pinned fallback runner", async () => {
    const fixture = await validFixture();
    const { receiptHash: _receiptHash, ...core } = fixture.migration;
    void _receiptHash;
    const migration = await repinMigration(fixture, {
      ...core,
      nextRunnerHash: "c".repeat(64)
    });
    await expect(
      requireProbeActivation({
        environment: fixture.environment,
        guard: fixture.liveGuard,
        predecessorMigration: fixture.predecessorMigration,
        migration,
        expectedPredecessorMigrationReceiptHash: fixture.predecessorMigration.receiptHash,
        nowMs
      })
    ).rejects.toMatchObject({ code: "activation_migration_invalid" });
  });

  it("rejects a self-consistent substitution of the historical v0.4 predecessor", async () => {
    const fixture = await validFixture();
    const { receiptHash: _predecessorHash, ...predecessorCore } = fixture.predecessorMigration;
    void _predecessorHash;
    const changedPredecessorCore = {
      ...predecessorCore,
      nextPolicyHash: "c".repeat(64)
    } as Omit<ProbeV04PolicyMigrationReceipt, "receiptHash">;
    const predecessorMigration = {
      ...changedPredecessorCore,
      receiptHash: await probeV04PolicyMigrationReceiptHash(changedPredecessorCore)
    };
    const { receiptHash: _migrationHash, ...migrationCore } = fixture.migration;
    void _migrationHash;
    const migration = await repinMigration(fixture, {
      ...migrationCore,
      predecessorMigrationReceiptHash: predecessorMigration.receiptHash
    });
    const manifest = await createProbeActivationManifest(
      fixture.environment,
      fixture.hashes,
      predecessorMigration.receiptHash
    );
    fixture.environment.TOOLPROOF_PROBE_ACTIVATION_HASH = computeProbeActivationHash(
      manifest,
      activationSecret
    );
    await expect(
      requireProbeActivation({
        environment: fixture.environment,
        guard: fixture.liveGuard,
        predecessorMigration,
        migration,
        expectedPredecessorMigrationReceiptHash: predecessorMigration.receiptHash,
        nowMs
      })
    ).rejects.toMatchObject({ code: "activation_migration_invalid" });
  });

  it("accepts idle progress and exactly one in-flight calibration call", async () => {
    const fixture = await validFixture();
    const expected = {
      guardInstanceId,
      policyHash: fixture.hashes.policyHash,
      scriptHash: fixture.hashes.scriptHash,
      initializedCommit
    };
    const idleProgress = guard({
      policyHash: fixture.hashes.policyHash,
      scriptHash: fixture.hashes.scriptHash,
      claimedCalls: 13,
      committedNanoUsd: 13 * PROBE_PER_CALL_RESERVATION_NANO_USD,
      knownCount: 13,
      knownActualNanoUsd: 42_165_200,
      purposeCounts: { calibration: 13, baseline: 0, repair: 0, revised: 0, judge: 0 },
      sequence: 13
    });
    expect(validateProbeActivationGuard(idleProgress, expected, nowMs)).toMatchObject({
      phase: "idle",
      claimedCalls: 13,
      knownCalls: 13,
      pendingCalls: 0
    });

    const inflight = guard({
      policyHash: fixture.hashes.policyHash,
      scriptHash: fixture.hashes.scriptHash,
      claimedCalls: 14,
      committedNanoUsd: 14 * PROBE_PER_CALL_RESERVATION_NANO_USD,
      knownCount: 13,
      knownActualNanoUsd: 42_165_200,
      pendingCount: 1,
      inflightCount: 1,
      purposeCounts: { calibration: 14, baseline: 0, repair: 0, revised: 0, judge: 0 },
      sequence: 14
    });
    expect(validateProbeActivationGuard(inflight, expected, nowMs)).toMatchObject({
      phase: "single-inflight",
      claimedCalls: 14,
      knownCalls: 13,
      pendingCalls: 1
    });
  });

  it.each([
    { status: "quarantined" as const },
    { pendingCount: 2, inflightCount: 2 },
    { uncertainCount: 1, uncertainUpperNanoUsd: PROBE_PER_CALL_RESERVATION_NANO_USD },
    { pendingCount: 1, inflightCount: 0 },
    { claimedCalls: 1, knownCount: 0, purposeCounts: PROBE_PURPOSE_CALL_LIMITS },
    {
      claimedCalls: 1,
      knownCount: 1,
      committedNanoUsd: PROBE_PER_CALL_RESERVATION_NANO_USD,
      purposeCounts: { calibration: 0, baseline: 1, repair: 0, revised: 0, judge: 0 },
      sequence: 1
    },
    { sequence: 1 },
    { committedNanoUsd: 1 },
    { haltMarkerPresent: true },
    { uncertainMarkerPresent: true },
    { claimedCalls: Number.NaN },
    { challengeClosesAtMs: nowMs }
  ])("rejects malformed, drifted, unsafe, or non-calibration guard state %#", async (override) => {
    const fixture = await validFixture();
    const expected = {
      guardInstanceId,
      policyHash: fixture.hashes.policyHash,
      scriptHash: fixture.hashes.scriptHash,
      initializedCommit
    };
    expect(() =>
      validateProbeActivationGuard(
        guard({
          policyHash: fixture.hashes.policyHash,
          scriptHash: fixture.hashes.scriptHash,
          ...override
        }),
        expected,
        nowMs
      )
    ).toThrowError(expect.objectContaining({ code: "activation_guard_invalid" }));
  });

  it("freezes the migrated policy and Lua bundle hashes", async () => {
    await expect(probePolicyHash()).resolves.toBe(
      "61765daf8a620613e4b94946ac897211a3c977de7922970228788aec5d893281"
    );
    await expect(probeLedgerScriptHash()).resolves.toBe(
      "c25d90f7e060662867925e83c6d33dc7636f22b18cbcd94c3ffc6880eb907779"
    );
  });
});
