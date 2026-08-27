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
  const migrationManifest = createProbePolicyMigrationManifest({
    priorReceipt,
    migrationCommit: activeCommit,
    nextPolicyHash: hashes.policyHash,
    nextScriptHash: hashes.scriptHash
  });
  const migration = await createProbePolicyMigrationReceipt(
    migrationManifest,
    await probePolicyMigrationDigest(migrationManifest),
    nowMs - 1_000
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
    OPENAI_API_KEY: "configured",
    KV_REST_API_URL: "https://fixture.upstash.io",
    KV_REST_API_TOKEN: "configured"
  };
  const manifest = await createProbeActivationManifest(environment, hashes);
  environment.TOOLPROOF_PROBE_ACTIVATION_HASH = computeProbeActivationHash(
    manifest,
    activationSecret
  );
  const liveGuard = guard({
    policyHash: hashes.policyHash,
    scriptHash: hashes.scriptHash,
    claimedCalls: 4,
    committedNanoUsd: 250_000_000,
    knownCount: 4,
    knownActualNanoUsd: 11_360_800,
    purposeCounts: { calibration: 4, baseline: 0, repair: 0, revised: 0, judge: 0 },
    sequence: 4
  });
  return { environment, hashes, manifest, liveGuard, migration };
}

describe("Probe activation", () => {
  it("is disabled by default without reading durable state", async () => {
    const readGuard = vi.fn(async () => guard());
    const readMigration = vi.fn();
    await expect(
      requireProbeActivation({ environment: {}, readGuard, readMigration, nowMs })
    ).rejects.toEqual(
      expect.objectContaining<Partial<ProbeActivationError>>({ code: "activation_disabled" })
    );
    expect(readGuard).not.toHaveBeenCalled();
    expect(readMigration).not.toHaveBeenCalled();
  });

  it("binds exact production, project, build, guard, and frozen contract identities", async () => {
    const fixture = await validFixture();
    const readGuard = vi.fn(async () => fixture.liveGuard);
    const readMigration = vi.fn(async () => fixture.migration);
    const activation = await requireProbeActivation({
      environment: fixture.environment,
      readGuard,
      readMigration,
      nowMs
    });
    expect(readGuard).toHaveBeenCalledTimes(1);
    expect(readMigration).toHaveBeenCalledTimes(1);
    expect(activation).toMatchObject({
      enabled: true,
      mode: "calibration",
      activationHash: fixture.environment.TOOLPROOF_PROBE_ACTIVATION_HASH,
      manifest: {
        version: "toolproof-probe-activation@2.0.0",
        activeCommit,
        vercelProjectId: projectId,
        guardInstanceId,
        guardInitializedCommit: initializedCommit,
        policyHash: fixture.hashes.policyHash,
        scriptHash: fixture.hashes.scriptHash,
        runnerContractHash: fixture.hashes.runnerContractHash,
        continuationScriptHash: fixture.hashes.continuationScriptHash,
        policyMigrationReceiptHash: fixture.migration.receiptHash
      },
      guard: { phase: "idle", claimedCalls: 4, pendingCalls: 0 },
      migration: { receiptHash: fixture.migration.receiptHash }
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
    ["TOOLPROOF_PROBE_ACTIVATION_HASH", "c".repeat(64), "activation_hash_mismatch"]
  ])("fails closed when %s drifts", async (key, value, code) => {
    const fixture = await validFixture();
    fixture.environment[key] = value;
    await expect(
      requireProbeActivation({ environment: fixture.environment, guard: fixture.liveGuard, nowMs })
    ).rejects.toEqual(expect.objectContaining<Partial<ProbeActivationError>>({ code }));
  });

  it("requires a canonical separate 32-byte activation secret", async () => {
    const fixture = await validFixture();
    fixture.environment.TOOLPROOF_PROBE_ACTIVATION_SECRET = "weak";
    await expect(
      requireProbeActivation({
        environment: fixture.environment,
        guard: fixture.liveGuard,
        migration: fixture.migration,
        nowMs
      })
    ).rejects.toMatchObject({ code: "activation_secret_invalid" });

    const reused = await validFixture();
    reused.environment.TOOLPROOF_PROBE_ACTIVATION_SECRET = signingSecret;
    const reusedManifest = await createProbeActivationManifest(reused.environment, reused.hashes);
    reused.environment.TOOLPROOF_PROBE_ACTIVATION_HASH = computeProbeActivationHash(
      reusedManifest,
      signingSecret
    );
    await expect(
      requireProbeActivation({
        environment: reused.environment,
        guard: reused.liveGuard,
        migration: reused.migration,
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
        readMigration: async () => {
          throw new Error("missing");
        },
        nowMs
      })
    ).rejects.toMatchObject({ code: "activation_migration_invalid" });

    const tampered = await validFixture();
    await expect(
      requireProbeActivation({
        environment: tampered.environment,
        guard: tampered.liveGuard,
        migration: { ...tampered.migration, migratedAtMs: tampered.migration.migratedAtMs + 1 },
        nowMs
      })
    ).rejects.toMatchObject({ code: "activation_migration_invalid" });

    const reset = await validFixture();
    await expect(
      requireProbeActivation({
        environment: reset.environment,
        guard: guard({
          policyHash: reset.hashes.policyHash,
          scriptHash: reset.hashes.scriptHash
        }),
        migration: reset.migration,
        nowMs
      })
    ).rejects.toMatchObject({ code: "activation_migration_invalid" });

    const unpinned = await validFixture();
    delete unpinned.environment.TOOLPROOF_PROBE_POLICY_MIGRATION_RECEIPT_HASH;
    await expect(
      requireProbeActivation({
        environment: unpinned.environment,
        guard: unpinned.liveGuard,
        migration: unpinned.migration,
        nowMs
      })
    ).rejects.toMatchObject({ code: "activation_migration_receipt_hash_invalid" });
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
      claimedCalls: 2,
      committedNanoUsd: 2 * PROBE_PER_CALL_RESERVATION_NANO_USD,
      knownCount: 2,
      knownActualNanoUsd: 4_000_000,
      purposeCounts: { calibration: 2, baseline: 0, repair: 0, revised: 0, judge: 0 },
      sequence: 2
    });
    expect(validateProbeActivationGuard(idleProgress, expected, nowMs)).toMatchObject({
      phase: "idle",
      claimedCalls: 2,
      knownCalls: 2,
      pendingCalls: 0
    });

    const inflight = guard({
      policyHash: fixture.hashes.policyHash,
      scriptHash: fixture.hashes.scriptHash,
      claimedCalls: 3,
      committedNanoUsd: 3 * PROBE_PER_CALL_RESERVATION_NANO_USD,
      knownCount: 2,
      knownActualNanoUsd: 4_000_000,
      pendingCount: 1,
      inflightCount: 1,
      purposeCounts: { calibration: 3, baseline: 0, repair: 0, revised: 0, judge: 0 },
      sequence: 3
    });
    expect(validateProbeActivationGuard(inflight, expected, nowMs)).toMatchObject({
      phase: "single-inflight",
      claimedCalls: 3,
      knownCalls: 2,
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
      "0667313bddeb02f0f2987348c56f0ad022c9bb33cf500eb94ef2a1a5fe86f0a8"
    );
    await expect(probeLedgerScriptHash()).resolves.toBe(
      "34833e98044cee1472c9104ac70312f03c96e8d2707bee189631e2cf41ae9033"
    );
  });
});
