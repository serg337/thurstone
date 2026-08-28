import { describe, expect, it } from "vitest";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { fallbackRunnerContractHash } from "@/lib/fallback/runner-contract";
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
  PROBE_V04_PREDECESSOR_MIGRATION_ID,
  PROBE_V04_PREDECESSOR_MIGRATION_RECEIPT_HASH,
  PROBE_V04_PREVIOUS_LEDGER_SCRIPT_HASH,
  PROBE_V04_PREVIOUS_POLICY_HASH,
  PROBE_V04_PREVIOUS_POLICY_VERSION,
  PROBE_V04_PREVIOUS_PURPOSE_CALL_LIMITS,
  PROBE_V04_PREVIOUS_RUNNER_CONTRACT_HASH,
  PROBE_V04_PRIOR_ATTEMPT3_EVIDENCE_DIGEST,
  PROBE_V04_PRIOR_ATTEMPT3_RAW_SHA256,
  probeV04PolicyMigrationReceiptHash,
  type ProbeV04PolicyMigrationReceipt
} from "@/lib/probe/policy-v04-migration-contract";
import {
  PROBE_V05_AUTHORIZATION_INVENTORY,
  PROBE_V05_ACK_ANCHOR_FIXED,
  PROBE_V05_MIGRATED_POLICY_HASH,
  PROBE_V05_MIGRATED_POLICY_VERSION,
  PROBE_V05_MIGRATED_PURPOSE_CALL_LIMITS,
  PROBE_V05_MIGRATED_RUNNER_CONTRACT_HASH,
  PROBE_V05_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
  PROBE_V05_POLICY_MIGRATION_ID,
  PROBE_V05_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
  PROBE_V05_POLICY_MIGRATION_PRIOR_APP_COMMIT,
  PROBE_V05_POLICY_MIGRATION_SOURCE_VERSION,
  PROBE_V05_POLICY_MIGRATION_VERSION,
  PROBE_V05_PREDECESSOR_MIGRATION_RECEIPT_HASH,
  PROBE_V05_PRESERVED_KNOWN_CALLS,
  PROBE_V05_PRESERVED_KNOWN_CALLS_DIGEST,
  PROBE_V05_PREVIOUS_LEDGER_SCRIPT_HASH,
  PROBE_V05_PREVIOUS_POLICY_HASH,
  PROBE_V05_PREVIOUS_POLICY_VERSION,
  PROBE_V05_PREVIOUS_PURPOSE_CALL_LIMITS,
  PROBE_V05_PREVIOUS_RUNNER_CONTRACT_HASH,
  PROBE_V05_PRIOR_EVIDENCE_DIGEST,
  PROBE_V05_PRIOR_EVIDENCE_RAW_SHA256,
  PROBE_V05_PRIOR_REPRODUCER_EVIDENCE_DIGEST,
  PROBE_V05_PRIOR_REPRODUCER_RAW_SHA256,
  ProbeV05PolicyMigrationContractError,
  createProbeV05PolicyMigrationManifest,
  createProbeV05PolicyMigrationReceipt,
  isProbeV05PolicyMigrationSourceStatus,
  parseProbeV05PolicyMigrationSourceReceipt,
  probeV05PolicyMigrationDigest,
  probeV05PolicyMigrationReceiptHash,
  type ProbeV05PolicyMigrationSourceReceipt
} from "@/lib/probe/policy-v05-migration-contract";
import {
  PROBE_V05_POLICY_MIGRATION_PROGRAM_HASH,
  PROBE_V05_POLICY_MIGRATION_SCRIPTS,
  buildProbeV05PolicyMigrationArguments,
  decodeProbeV05StoredMigrationManifest,
  probeV05PreservedIssuedAuthorizationDigests,
  probeV05PolicyMigrationProgramHash,
  validateProbeV05PreservedIssuedAuthorization
} from "@/lib/probe/policy-v05-migration.server";
import { PROBE_V04_POLICY_MIGRATION_PROGRAM_HASH } from "@/lib/probe/policy-v04-migration.server";
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
import { probeLedgerScriptHash } from "@/lib/probe/ledger";

const guardInstanceId = "guard_3323051706a8384028e97a60f0c0b868";
const initializedCommit = "86584fe4fa308980bfb7d60f9722cc8b49b78644";

const predecessor: ProbeV04PolicyMigrationReceipt = {
  version: PROBE_V04_POLICY_MIGRATION_VERSION,
  migrationId: PROBE_V04_POLICY_MIGRATION_ID,
  priorAppCommit: PROBE_V04_POLICY_MIGRATION_PRIOR_APP_COMMIT,
  priorActivationHash: PROBE_V04_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
  priorEvidenceRawSha256: PROBE_V04_PRIOR_ATTEMPT3_RAW_SHA256,
  priorEvidenceDigest: PROBE_V04_PRIOR_ATTEMPT3_EVIDENCE_DIGEST,
  predecessorMigrationId: PROBE_V04_PREDECESSOR_MIGRATION_ID,
  predecessorMigrationReceiptHash: PROBE_V04_PREDECESSOR_MIGRATION_RECEIPT_HASH,
  guardInstanceId,
  initializedCommit,
  previousPolicyVersion: PROBE_V04_PREVIOUS_POLICY_VERSION,
  previousPolicyHash: PROBE_V04_PREVIOUS_POLICY_HASH,
  previousScriptHash: PROBE_V04_PREVIOUS_LEDGER_SCRIPT_HASH,
  previousRunnerHash: PROBE_V04_PREVIOUS_RUNNER_CONTRACT_HASH,
  preserved: PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
  knownCalls: PROBE_V05_PRESERVED_KNOWN_CALLS.slice(0, 9),
  migrationCommit: PROBE_V05_POLICY_MIGRATION_PRIOR_APP_COMMIT,
  nextPolicyVersion: PROBE_V04_MIGRATED_POLICY_VERSION,
  nextPolicyHash: PROBE_V04_MIGRATED_POLICY_HASH,
  nextScriptHash: PROBE_V04_MIGRATED_LEDGER_SCRIPT_HASH,
  nextRunnerHash: PROBE_V04_MIGRATED_RUNNER_CONTRACT_HASH,
  migrationProgramHash: PROBE_V04_POLICY_MIGRATION_PROGRAM_HASH,
  previousPurposeLimits: PROBE_V04_PREVIOUS_PURPOSE_CALL_LIMITS,
  nextPurposeLimits: PROBE_V04_MIGRATED_PURPOSE_CALL_LIMITS,
  globalCallLimit: 160,
  lifetimeSpendCeilingNanoUsd: 10_000_000_000,
  perCallReservationNanoUsd: 62_500_000,
  migrationDigest: "607666ccb962f0c795efc9aa7fc69718abc3cc82313d3797b0b8d10b81773ba4",
  migratedAtMs: 1_787_914_040_602,
  receiptHash: PROBE_V05_PREDECESSOR_MIGRATION_RECEIPT_HASH
};

const ackAnchor = Object.freeze({
  ...PROBE_V05_ACK_ANCHOR_FIXED,
  recoveryHash: "1".repeat(64),
  sessionHash: "2".repeat(64),
  runHash: "3".repeat(64),
  actorHash: "4".repeat(64),
  launchHash: "5".repeat(64),
  payloadBinding: "6".repeat(64),
  encryptedDataPresent: false as const
});

const issuedAuthorization = Object.freeze({
  jti: "jti_v05_preserved_issued_fixture",
  claimsHash: "7".repeat(64),
  subjectHash: "8".repeat(64),
  actorHash: "9".repeat(64),
  issuedAt: 1_700_000_000,
  expiresAt: 1_700_000_120,
  issueRateBucket: Math.floor(1_700_000_000 / 3_600),
  issueRateCount: 5
});

function source(): ProbeV05PolicyMigrationSourceReceipt {
  return {
    version: PROBE_V05_POLICY_MIGRATION_SOURCE_VERSION,
    migrationId: PROBE_V05_POLICY_MIGRATION_ID,
    priorAppCommit: PROBE_V05_POLICY_MIGRATION_PRIOR_APP_COMMIT,
    priorActivationHash: PROBE_V05_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
    priorEvidenceRawSha256: PROBE_V05_PRIOR_EVIDENCE_RAW_SHA256,
    priorEvidenceDigest: PROBE_V05_PRIOR_EVIDENCE_DIGEST,
    priorReproducerRawSha256: PROBE_V05_PRIOR_REPRODUCER_RAW_SHA256,
    priorReproducerEvidenceDigest: PROBE_V05_PRIOR_REPRODUCER_EVIDENCE_DIGEST,
    predecessorMigrationId: PROBE_V04_POLICY_MIGRATION_ID,
    predecessorMigrationReceiptHash: predecessor.receiptHash,
    guardInstanceId,
    initializedCommit,
    previousPolicyVersion: PROBE_V05_PREVIOUS_POLICY_VERSION,
    previousPolicyHash: PROBE_V05_PREVIOUS_POLICY_HASH,
    previousScriptHash: PROBE_V05_PREVIOUS_LEDGER_SCRIPT_HASH,
    previousRunnerHash: PROBE_V05_PREVIOUS_RUNNER_CONTRACT_HASH,
    preserved: PROBE_V05_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
    knownCalls: PROBE_V05_PRESERVED_KNOWN_CALLS,
    authorizationInventory: PROBE_V05_AUTHORIZATION_INVENTORY,
    ackAnchor
  };
}

async function manifest() {
  return createProbeV05PolicyMigrationManifest({
    sourceReceipt: source(),
    predecessorReceipt: predecessor,
    migrationCommit: "a".repeat(40),
    nextPolicyHash: await probePolicyHash(),
    nextScriptHash: await probeLedgerScriptHash(),
    nextRunnerHash: await fallbackRunnerContractHash(),
    migrationProgramHash: await probeV05PolicyMigrationProgramHash()
  });
}

describe("Probe v0.4 -> v0.5 fallback attempt-2 policy migration", () => {
  it("binds the authentic thirteen-call, evidence, reproducer, receipt, and ACK lineages", async () => {
    await expect(probeV04PolicyMigrationReceiptHash(predecessor)).resolves.toBe(
      predecessor.receiptHash
    );
    await expect(canonicalSha256(PROBE_V05_PRESERVED_KNOWN_CALLS)).resolves.toBe(
      PROBE_V05_PRESERVED_KNOWN_CALLS_DIGEST
    );
    expect(PROBE_V05_PRESERVED_KNOWN_CALLS.reduce((sum, call) => sum + call.actualNanoUsd, 0)).toBe(
      42_165_200
    );
    const parsed = await parseProbeV05PolicyMigrationSourceReceipt(source(), predecessor);
    expect(parsed.knownCalls.slice(0, 9)).toEqual(predecessor.knownCalls);
    expect(parsed.ackAnchor).toMatchObject({
      ackStatus: "acknowledged",
      encryptedDataPresent: false
    });
    const next = await manifest();
    expect(next).toMatchObject({
      version: PROBE_V05_POLICY_MIGRATION_VERSION,
      nextPolicyVersion: PROBE_V05_MIGRATED_POLICY_VERSION,
      nextPolicyHash: PROBE_V05_MIGRATED_POLICY_HASH,
      nextRunnerHash: PROBE_V05_MIGRATED_RUNNER_CONTRACT_HASH,
      previousPurposeLimits: { calibration: 13, baseline: 72, repair: 2, revised: 72, judge: 1 },
      nextPurposeLimits: { calibration: 17, baseline: 70, repair: 2, revised: 70, judge: 1 },
      preserved: {
        claimedCalls: 13,
        knownCalls: 13,
        committedNanoUsd: 812_500_000,
        knownActualNanoUsd: 42_165_200
      }
    });
    const digest = await probeV05PolicyMigrationDigest(next);
    const args = buildProbeV05PolicyMigrationArguments(
      next,
      predecessor,
      digest,
      issuedAuthorization
    );
    expect(args).toHaveLength(177);
    expect(args[28]).toBe("13");
    expect(args[146]).toBe(PROBE_V04_POLICY_MIGRATION_VERSION);
    expect(args[151]).toBe(PROBE_V05_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH);
    expect(args[160]).toBe(String(PROBE_V05_ACK_ANCHOR_FIXED.acknowledgedAtMs));
    expect(args[169]).toBe(issuedAuthorization.jti);
    expect(args[176]).toBe(String(issuedAuthorization.issueRateCount));
    expect(PROBE_V05_POLICY_MIGRATION_SCRIPTS.migrate).toContain(
      'redis.call("HLEN", KEYS[36]) == 11'
    );
    expect(PROBE_V05_POLICY_MIGRATION_SCRIPTS.migrate).toContain(
      'redis.call("GET", KEYS[37]) == ARGV[170]'
    );
    expect(PROBE_V05_POLICY_MIGRATION_SCRIPTS.migrate).toContain(
      'redis.call("HGET", KEYS[38], ARGV[176]) == ARGV[177]'
    );
    expect(PROBE_V05_POLICY_MIGRATION_SCRIPTS.migrate).toContain(
      'scan_exact(namespace .. ":auth:*", expected_auth, 14)'
    );
    expect(PROBE_V05_POLICY_MIGRATION_SCRIPTS.migrate).toContain(
      'scan_exact(namespace .. ":provider:*", expected_provider, 13)'
    );
    expect(PROBE_V05_POLICY_MIGRATION_SCRIPTS.migrate).toContain("if not seen[key] then");
    expect(PROBE_V05_POLICY_MIGRATION_SCRIPTS.migrate).not.toMatch(
      /(?:HSET|DEL|UNLINK|EXPIRE|PEXPIRE|RENAME)", KEYS\[3[678]\]/u
    );
    const receipt = await createProbeV05PolicyMigrationReceipt(next, digest, 1_800_000_000_000);
    await expect(probeV05PolicyMigrationReceiptHash(receipt)).resolves.toBe(receipt.receiptHash);
  });

  it("rejects call, evidence, predecessor, ACK, policy, script, and runner substitution", async () => {
    const base = source();
    for (const changed of [
      { ...base, priorEvidenceDigest: "0".repeat(64) },
      { ...base, priorReproducerEvidenceDigest: "0".repeat(64) },
      {
        ...base,
        knownCalls: base.knownCalls.map((call, index) =>
          index === 12 ? { ...call, usageHash: "0".repeat(64) } : call
        )
      },
      { ...base, ackAnchor: { ...base.ackAnchor, confirmation: "0".repeat(64) } },
      { ...base, ackAnchor: { ...base.ackAnchor, encryptedDataPresent: true } },
      {
        ...base,
        authorizationInventory: {
          ...base.authorizationInventory,
          tombstone: { ...base.authorizationInventory.tombstone, countedAsCall: true }
        }
      }
    ]) {
      await expect(
        parseProbeV05PolicyMigrationSourceReceipt(
          changed as ProbeV05PolicyMigrationSourceReceipt,
          predecessor
        )
      ).rejects.toBeInstanceOf(ProbeV05PolicyMigrationContractError);
    }
    const forged = { ...predecessor, migratedAtMs: predecessor.migratedAtMs + 1 };
    await expect(parseProbeV05PolicyMigrationSourceReceipt(base, forged)).rejects.toThrow(
      /predecessor_receipt_invalid/u
    );
    const next = await manifest();
    for (const changed of [
      { nextPolicyHash: "0".repeat(64) },
      { nextScriptHash: "0".repeat(64) },
      { nextRunnerHash: "0".repeat(64) }
    ]) {
      await expect(
        createProbeV05PolicyMigrationManifest({
          sourceReceipt: base,
          predecessorReceipt: predecessor,
          migrationCommit: "a".repeat(40),
          nextPolicyHash: next.nextPolicyHash,
          nextScriptHash: next.nextScriptHash,
          nextRunnerHash: next.nextRunnerHash,
          migrationProgramHash: next.migrationProgramHash,
          ...changed
        })
      ).rejects.toThrow(/v05_next_policy_not_frozen/u);
    }
  });

  it("keeps private issued-authorization values behind stable record and footprint digests", async () => {
    const first = await probeV05PreservedIssuedAuthorizationDigests(
      issuedAuthorization,
      guardInstanceId
    );
    const changed = await probeV05PreservedIssuedAuthorizationDigests(
      { ...issuedAuthorization, issueRateCount: issuedAuthorization.issueRateCount + 1 },
      guardInstanceId
    );
    expect(first.recordDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.footprintDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(changed.recordDigest).toBe(first.recordDigest);
    expect(changed.footprintDigest).not.toBe(first.footprintDigest);
  });

  it("accepts both raw and Upstash-auto-decoded stored migration manifests", async () => {
    const next = await manifest();
    expect(decodeProbeV05StoredMigrationManifest(canonicalJson(next))).toEqual(next);
    expect(
      decodeProbeV05StoredMigrationManifest(JSON.parse(canonicalJson(next)) as typeof next)
    ).toEqual(next);
    for (const invalid of ["{", null, [], 1]) {
      expect(() => decodeProbeV05StoredMigrationManifest(invalid)).toThrow(
        /V05_MIGRATION_MANIFEST_INVALID/u
      );
    }
  });

  it("accepts only the exact expired permanent issuance footprint", async () => {
    const digests = await probeV05PreservedIssuedAuthorizationDigests(
      issuedAuthorization,
      guardInstanceId
    );
    const auth = {
      state: "ISSUED",
      jti: issuedAuthorization.jti,
      claims_hash: issuedAuthorization.claimsHash,
      purpose: "calibration",
      subject_hash: issuedAuthorization.subjectHash,
      actor_hash: issuedAuthorization.actorHash,
      issued_at: issuedAuthorization.issuedAt,
      expires_at: issuedAuthorization.expiresAt,
      guard_instance_id: guardInstanceId,
      policy_hash: PROBE_V05_PREVIOUS_POLICY_HASH,
      script_hash: PROBE_V05_PREVIOUS_LEDGER_SCRIPT_HASH
    };
    const base = {
      auth,
      authKey: `namespace:auth:${issuedAuthorization.jti}`,
      expectedAuthKey: `namespace:auth:${issuedAuthorization.jti}`,
      authTtl: -1,
      subjectTtl: -1,
      subjectJti: issuedAuthorization.jti,
      rateTtl: -1,
      rate: { [String(issuedAuthorization.issueRateBucket)]: issuedAuthorization.issueRateCount },
      guardInstanceId,
      nowMs: issuedAuthorization.expiresAt * 1000 + 1,
      expectedRecordDigest: digests.recordDigest,
      expectedFootprintDigest: digests.footprintDigest
    };
    await expect(validateProbeV05PreservedIssuedAuthorization(base)).resolves.toEqual(
      issuedAuthorization
    );
    for (const changed of [
      { auth: { ...auth, extra: "forbidden" } },
      { auth: { ...auth, state: "EXPIRED" } },
      { authTtl: 1 },
      { nowMs: issuedAuthorization.expiresAt * 1000 - 1 },
      { subjectTtl: 1 },
      { subjectJti: "jti_other_subject_pointer" },
      { rateTtl: 1 },
      { rate: null },
      { expectedRecordDigest: "0".repeat(64) },
      { expectedFootprintDigest: "0".repeat(64) }
    ]) {
      await expect(
        validateProbeV05PreservedIssuedAuthorization({ ...base, ...changed })
      ).rejects.toThrow(/V05_DISCOVERY_ISSUED_AUTHORIZATION/u);
    }
  });

  it("admits only the exact idle terminal-thirteen v0.4 source boundary", () => {
    const status = {
      status: "open",
      guardInstanceId,
      initializedCommit,
      policyVersion: PROBE_V05_PREVIOUS_POLICY_VERSION,
      policyHash: PROBE_V05_PREVIOUS_POLICY_HASH,
      scriptHash: PROBE_V05_PREVIOUS_LEDGER_SCRIPT_HASH,
      model: PROBE_MODEL,
      globalCallLimit: PROBE_GLOBAL_CALL_LIMIT,
      spendCeilingNanoUsd: PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
      perCallReservationNanoUsd: PROBE_PER_CALL_RESERVATION_NANO_USD,
      maxConcurrency: PROBE_MAX_CONCURRENCY,
      challengeClosesAtMs: Date.parse(PROBE_CHALLENGE_CLOSES_AT),
      claimedCalls: 13,
      committedNanoUsd: 812_500_000,
      pendingCount: 0,
      knownCount: 13,
      uncertainCount: 0,
      knownActualNanoUsd: 42_165_200,
      uncertainUpperNanoUsd: 0,
      purposeLimits: PROBE_V05_PREVIOUS_PURPOSE_CALL_LIMITS,
      purposeCounts: { calibration: 13, baseline: 0, repair: 0, revised: 0, judge: 0 },
      inflightCount: 0,
      sequence: 13,
      haltMarkerPresent: false,
      uncertainMarkerPresent: false
    };
    const expected = { guardInstanceId, initializedCommit };
    const now = Date.parse("2026-08-28T12:00:00.000Z");
    expect(isProbeV05PolicyMigrationSourceStatus(status, expected, now)).toBe(true);
    for (const drift of [
      { knownCount: 12 },
      { claimedCalls: 14 },
      { knownActualNanoUsd: 42_165_201 },
      { pendingCount: 1, inflightCount: 1 },
      { policyHash: "0".repeat(64) },
      { purposeLimits: { ...status.purposeLimits, baseline: 71 } },
      { haltMarkerPresent: true }
    ])
      expect(isProbeV05PolicyMigrationSourceStatus({ ...status, ...drift }, expected, now)).toBe(
        false
      );
  });

  it("keeps the candidate atomic, replay-safe, immutable-history preserving, and non-destructive", async () => {
    const script = PROBE_V05_POLICY_MIGRATION_SCRIPTS.migrate;
    expect(script).toContain("for ordinal = 0, 12 do");
    expect(script).toContain("V05_MIGRATED_EXISTING");
    expect(script).toContain("V05_MIGRATION_RECEIPT_CONFLICT");
    expect(script).toContain("V05_MIGRATION_REPLAY_STATE_MISMATCH");
    expect(script).toContain('redis.call("EXISTS", KEYS[9]) == 0');
    expect(script).toContain('redis.call("HSET", KEYS[1], "policy_version"');
    expect(script).toContain('redis.call("HSET", KEYS[3], "calibration"');
    expect(script).toContain('redis.call("HSET", KEYS[7]');
    expect(script).not.toContain('redis.call("DEL"');
    expect(script).not.toContain('redis.call("UNLINK"');
    expect(script).not.toContain('redis.call("EXPIRE"');
    expect(script).not.toContain('redis.call("RENAME"');
    await expect(probeV05PolicyMigrationProgramHash()).resolves.toBe(
      PROBE_V05_POLICY_MIGRATION_PROGRAM_HASH
    );
    await expect(probePolicyHash()).resolves.toBe(PROBE_V05_MIGRATED_POLICY_HASH);
    await expect(fallbackRunnerContractHash()).resolves.toBe(
      PROBE_V05_MIGRATED_RUNNER_CONTRACT_HASH
    );
    expect(PROBE_POLICY_VERSION).toBe(PROBE_V05_MIGRATED_POLICY_VERSION);
    expect(PROBE_PURPOSE_CALL_LIMITS).toEqual(PROBE_V05_MIGRATED_PURPOSE_CALL_LIMITS);
  });
});
