import { randomBytes } from "node:crypto";

import { canonicalJson, sha256Hex } from "../lib/evidence/digest";
import {
  PROBE_LEDGER_SCRIPTS,
  ProbeLedgerError,
  beginProbeCall,
  createProbeLedgerKeyspace,
  createProbeRedis,
  initializeProbeGuard,
  issueProbeAuthorization,
  migrateProbeGuardPolicy,
  probeLedgerScriptHash,
  probePolicyMigrationKey,
  readProbeGuardStatus,
  reapExpiredProbeCall,
  settleProbeCallKnown,
  type ProbeGuardIdentity
} from "../lib/probe/ledger";
import {
  PROBE_POLICY_MIGRATION_ID,
  PROBE_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
  PROBE_POLICY_MIGRATION_PRIOR_APP_COMMIT,
  PROBE_POLICY_MIGRATION_PRIOR_EVIDENCE_DIGEST,
  PROBE_POLICY_MIGRATION_PRIOR_RECEIPT_VERSION,
  PROBE_PREVIOUS_LEDGER_SCRIPT_HASH,
  PROBE_PREVIOUS_POLICY_HASH,
  PROBE_PREVIOUS_POLICY_VERSION,
  PROBE_PREVIOUS_PURPOSE_CALL_LIMITS,
  createProbePolicyMigrationManifest,
  isExactProbePolicyMigrationSourceStatus,
  parseProbePolicyMigrationPriorReceipt,
  probePolicyMigrationDigest,
  type ProbePolicyMigrationPriorReceipt
} from "../lib/probe/policy-migration-contract";
import {
  PROBE_CHALLENGE_CLOSES_AT,
  PROBE_GLOBAL_CALL_LIMIT,
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
  PROBE_MAX_CONCURRENCY,
  PROBE_MODEL,
  PROBE_PER_CALL_RESERVATION_NANO_USD,
  PROBE_PURPOSE_CALL_LIMITS,
  probePolicyHash,
  type ProbePurpose
} from "../lib/probe/policy";
import { isProbeGuardStatusConsistent } from "../lib/probe/status";

function hasExpectedVercelProjectIdentity(): boolean {
  const expectedProjectId = process.env.TOOLPROOF_EXPECTED_VERCEL_PROJECT_ID;
  return (
    typeof expectedProjectId === "string" &&
    /^prj_[A-Za-z0-9]{20,}$/u.test(expectedProjectId) &&
    process.env.VERCEL_PROJECT_ID === expectedProjectId
  );
}

function safeReceipt(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function identity(
  guardInstanceId: string,
  initializedCommit: string
): Promise<ProbeGuardIdentity> {
  return {
    guardInstanceId,
    policyHash: await probePolicyHash(),
    scriptHash: await probeLedgerScriptHash(),
    initializedCommit
  };
}

async function printHashes(): Promise<void> {
  safeReceipt({
    ok: true,
    mode: "hashes",
    policyHash: await probePolicyHash(),
    scriptHash: await probeLedgerScriptHash()
  });
}

async function productionStatus(): Promise<void> {
  const guardInstanceId = process.env.TOOLPROOF_GUARD_INSTANCE_ID;
  const initializedCommit = process.env.TOOLPROOF_GUARD_INITIALIZED_COMMIT;
  if (!guardInstanceId || !initializedCommit) {
    throw new ProbeLedgerError("MISSING_GUARD_IDENTITY");
  }
  const expected = await identity(guardInstanceId, initializedCommit);
  const status = await readProbeGuardStatus(createProbeRedis());
  const current = isProbeGuardStatusConsistent(status, expected);
  const migrationRequired =
    !process.env.TOOLPROOF_PROBE_ACTIVATION_MODE &&
    isExactProbePolicyMigrationSourceStatus(status, { guardInstanceId, initializedCommit });
  if (!current && !migrationRequired) {
    throw new ProbeLedgerError("GUARD_IDENTITY_MISMATCH");
  }
  safeReceipt({
    ok: true,
    mode: migrationRequired ? "migration-required" : "status",
    status: status.status,
    policyHash: status.policyHash,
    scriptHash: status.scriptHash,
    claimedCalls: status.claimedCalls,
    committedNanoUsd: status.committedNanoUsd,
    pendingCount: status.pendingCount,
    knownCount: status.knownCount,
    uncertainCount: status.uncertainCount
  });
}

async function initializeProduction(): Promise<void> {
  const guardInstanceId = process.env.TOOLPROOF_GUARD_INSTANCE_ID;
  if (!guardInstanceId) throw new ProbeLedgerError("MISSING_GUARD_INSTANCE");
  const sourceCommit = process.env.VERCEL_GIT_COMMIT_SHA;
  const approvedCommit = process.env.TOOLPROOF_PROBE_APPROVED_COMMIT;
  if (
    !sourceCommit ||
    !/^[a-f0-9]{40}$/u.test(sourceCommit) ||
    approvedCommit !== sourceCommit ||
    process.env.TOOLPROOF_GUARD_INITIALIZED_COMMIT !== sourceCommit
  ) {
    throw new ProbeLedgerError("APPROVED_COMMIT_REQUIRED");
  }
  const expected = await identity(guardInstanceId, sourceCommit);
  const expectedConfirmation = `${sourceCommit}:${expected.guardInstanceId}:${expected.policyHash}:${expected.scriptHash}`;
  if (
    process.env.VERCEL !== "1" ||
    process.env.VERCEL_ENV !== "production" ||
    !hasExpectedVercelProjectIdentity()
  ) {
    throw new ProbeLedgerError("PRODUCTION_INIT_CONTEXT_REQUIRED");
  }
  if (process.env.TOOLPROOF_PROBE_INIT_CONFIRM !== expectedConfirmation) {
    throw new ProbeLedgerError("PRODUCTION_INIT_CONFIRMATION_REQUIRED");
  }
  const redis = createProbeRedis();
  const disposition = await initializeProbeGuard(redis, expected);
  const status = await readProbeGuardStatus(redis);
  if (
    !isProbeGuardStatusConsistent(status, expected) ||
    status.claimedCalls !== 0 ||
    status.committedNanoUsd !== 0
  ) {
    throw new ProbeLedgerError("INITIALIZATION_RECEIPT_MISMATCH");
  }
  safeReceipt({
    ok: true,
    mode: "init",
    disposition,
    policyHash: status.policyHash,
    scriptHash: status.scriptHash,
    claimedCalls: status.claimedCalls,
    committedNanoUsd: status.committedNanoUsd
  });
}

async function reapProduction(): Promise<void> {
  const guardInstanceId = process.env.TOOLPROOF_GUARD_INSTANCE_ID;
  const jti = process.env.TOOLPROOF_PROBE_REAP_JTI;
  const settlementDigest = process.env.TOOLPROOF_PROBE_REAP_DIGEST;
  const initializedCommit = process.env.TOOLPROOF_GUARD_INITIALIZED_COMMIT;
  if (!guardInstanceId || !jti || !settlementDigest || !initializedCommit) {
    throw new ProbeLedgerError("REAP_INPUT_REQUIRED");
  }
  const expected = await identity(guardInstanceId, initializedCommit);
  const sourceCommit = process.env.VERCEL_GIT_COMMIT_SHA;
  if (
    !sourceCommit ||
    !/^[a-f0-9]{40}$/u.test(sourceCommit) ||
    process.env.TOOLPROOF_PROBE_APPROVED_COMMIT !== sourceCommit ||
    process.env.VERCEL !== "1" ||
    process.env.VERCEL_ENV !== "production" ||
    !hasExpectedVercelProjectIdentity()
  ) {
    throw new ProbeLedgerError("PRODUCTION_REAP_CONTEXT_REQUIRED");
  }
  const expectedConfirmation = `${sourceCommit}:${guardInstanceId}:${jti}:${settlementDigest}:${expected.policyHash}:${expected.scriptHash}`;
  if (process.env.TOOLPROOF_PROBE_REAP_CONFIRM !== expectedConfirmation) {
    throw new ProbeLedgerError("PRODUCTION_REAP_CONFIRMATION_REQUIRED");
  }

  const redis = createProbeRedis();
  const result = await reapExpiredProbeCall(redis, { ...expected, jti, settlementDigest });
  const status = await readProbeGuardStatus(redis);
  if (
    status.status !== "quarantined" ||
    status.guardInstanceId !== expected.guardInstanceId ||
    status.policyHash !== expected.policyHash ||
    status.scriptHash !== expected.scriptHash ||
    status.pendingCount !== 0 ||
    status.uncertainCount < 1 ||
    status.inflightCount !== 0
  ) {
    throw new ProbeLedgerError("REAP_RECEIPT_MISMATCH");
  }
  safeReceipt({
    ok: true,
    mode: "reap",
    disposition: result.disposition,
    status: status.status,
    claimedCalls: status.claimedCalls,
    committedNanoUsd: status.committedNanoUsd,
    uncertainCount: status.uncertainCount
  });
}

function migrationPriorReceiptFromEnvironment(): ProbePolicyMigrationPriorReceipt {
  const encoded = process.env.TOOLPROOF_PROBE_POLICY_MIGRATION_RECEIPT;
  if (!encoded || encoded.length > 32_768 || !/^[A-Za-z0-9_-]+$/u.test(encoded)) {
    throw new ProbeLedgerError("MIGRATION_RECEIPT_REQUIRED");
  }
  const decoded = Buffer.from(encoded, "base64url");
  if (decoded.toString("base64url") !== encoded) {
    throw new ProbeLedgerError("MIGRATION_RECEIPT_NOT_CANONICAL");
  }
  const source = decoded.toString("utf8");
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw new ProbeLedgerError("MIGRATION_RECEIPT_INVALID_JSON");
  }
  if (canonicalJson(value) !== source) {
    throw new ProbeLedgerError("MIGRATION_RECEIPT_NOT_CANONICAL");
  }
  try {
    return parseProbePolicyMigrationPriorReceipt(value);
  } catch {
    throw new ProbeLedgerError("MIGRATION_RECEIPT_INVALID");
  }
}

async function migrateProductionPolicy(): Promise<void> {
  const sourceCommit = process.env.VERCEL_GIT_COMMIT_SHA;
  const priorReceipt = migrationPriorReceiptFromEnvironment();
  if (
    !sourceCommit ||
    !/^[a-f0-9]{40}$/u.test(sourceCommit) ||
    process.env.TOOLPROOF_PROBE_APPROVED_COMMIT !== sourceCommit ||
    process.env.TOOLPROOF_GUARD_INSTANCE_ID !== priorReceipt.guardInstanceId ||
    process.env.TOOLPROOF_GUARD_INITIALIZED_COMMIT !== priorReceipt.initializedCommit ||
    process.env.VERCEL !== "1" ||
    process.env.VERCEL_ENV !== "production" ||
    !hasExpectedVercelProjectIdentity()
  ) {
    throw new ProbeLedgerError("PRODUCTION_MIGRATION_CONTEXT_REQUIRED");
  }
  const nextPolicyHash = await probePolicyHash();
  const nextScriptHash = await probeLedgerScriptHash();
  const manifest = createProbePolicyMigrationManifest({
    priorReceipt,
    migrationCommit: sourceCommit,
    nextPolicyHash,
    nextScriptHash
  });
  const migrationDigest = await probePolicyMigrationDigest(manifest);
  const expectedConfirmation = [
    sourceCommit,
    priorReceipt.guardInstanceId,
    priorReceipt.initializedCommit,
    PROBE_POLICY_MIGRATION_ID,
    priorReceipt.priorEvidenceDigest,
    migrationDigest,
    nextPolicyHash,
    nextScriptHash
  ].join(":");
  if (process.env.TOOLPROOF_PROBE_POLICY_MIGRATION_CONFIRM !== expectedConfirmation) {
    throw new ProbeLedgerError("PRODUCTION_MIGRATION_CONFIRMATION_REQUIRED");
  }

  const redis = createProbeRedis();
  const result = await migrateProbeGuardPolicy(redis, {
    priorReceipt,
    migrationCommit: sourceCommit
  });
  const status = await readProbeGuardStatus(redis);
  const expected: ProbeGuardIdentity = {
    guardInstanceId: priorReceipt.guardInstanceId,
    initializedCommit: priorReceipt.initializedCommit,
    policyHash: nextPolicyHash,
    scriptHash: nextScriptHash
  };
  if (
    !isProbeGuardStatusConsistent(status, expected) ||
    status.claimedCalls !== 4 ||
    status.knownCount !== 4 ||
    status.pendingCount !== 0 ||
    status.uncertainCount !== 0 ||
    status.inflightCount !== 0 ||
    status.committedNanoUsd !== 250_000_000 ||
    status.knownActualNanoUsd !== 11_360_800 ||
    status.uncertainUpperNanoUsd !== 0 ||
    status.sequence !== 4 ||
    status.purposeCounts.calibration !== 4 ||
    status.purposeCounts.baseline !== 0 ||
    status.purposeCounts.repair !== 0 ||
    status.purposeCounts.revised !== 0 ||
    status.purposeCounts.judge !== 0
  ) {
    throw new ProbeLedgerError("MIGRATION_RECEIPT_MISMATCH");
  }
  safeReceipt({
    ok: true,
    mode: "migrate-policy",
    disposition: result.disposition,
    migrationId: result.receipt.migrationId,
    migrationDigest: result.receipt.migrationDigest,
    receiptHash: result.receipt.receiptHash,
    priorEvidenceDigest: result.receipt.priorEvidenceDigest,
    policyHash: status.policyHash,
    scriptHash: status.scriptHash,
    claimedCalls: status.claimedCalls,
    knownCalls: status.knownCount,
    committedNanoUsd: status.committedNanoUsd,
    knownActualNanoUsd: status.knownActualNanoUsd,
    sequence: status.sequence
  });
}

async function integrationMigrationPriorReceipt(
  testId: string
): Promise<ProbePolicyMigrationPriorReceipt> {
  const costs = [2_752_200, 2_745_600, 2_862_200, 3_000_800] as const;
  const knownCalls = await Promise.all(
    costs.map(async (actualNanoUsd, ordinal) => ({
      ordinal,
      jti: `jti_migration_${testId}_${ordinal}`,
      dispatchSequence: ordinal + 1,
      actualNanoUsd,
      providerResponseHash: await sha256Hex(`migration-response:${testId}:${ordinal}`),
      settlementDigest: await sha256Hex(`migration-settlement:${testId}:${ordinal}`),
      usageHash: await sha256Hex(`migration-usage:${testId}:${ordinal}`)
    }))
  );
  return parseProbePolicyMigrationPriorReceipt({
    version: PROBE_POLICY_MIGRATION_PRIOR_RECEIPT_VERSION,
    migrationId: PROBE_POLICY_MIGRATION_ID,
    priorAppCommit: PROBE_POLICY_MIGRATION_PRIOR_APP_COMMIT,
    priorActivationHash: PROBE_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
    priorEvidenceDigest: PROBE_POLICY_MIGRATION_PRIOR_EVIDENCE_DIGEST,
    guardInstanceId: `guard_migration_${testId}`,
    initializedCommit: "f".repeat(40),
    previousPolicyVersion: PROBE_PREVIOUS_POLICY_VERSION,
    previousPolicyHash: PROBE_PREVIOUS_POLICY_HASH,
    previousScriptHash: PROBE_PREVIOUS_LEDGER_SCRIPT_HASH,
    knownCalls
  });
}

async function seedIntegrationMigrationGuard(
  redis: ReturnType<typeof createProbeRedis>,
  keyspace: ReturnType<typeof createProbeLedgerKeyspace>,
  prior: ProbePolicyMigrationPriorReceipt
): Promise<void> {
  const reply = await redis.eval<string[], unknown>(
    PROBE_LEDGER_SCRIPTS.init,
    [
      keyspace.config,
      keyspace.totals,
      keyspace.purposeLimits,
      keyspace.purposeCounts,
      keyspace.inflight
    ],
    [
      prior.guardInstanceId,
      PROBE_PREVIOUS_POLICY_HASH,
      PROBE_PREVIOUS_LEDGER_SCRIPT_HASH,
      String(PROBE_GLOBAL_CALL_LIMIT),
      String(PROBE_LIFETIME_SPEND_CEILING_NANO_USD),
      String(PROBE_PER_CALL_RESERVATION_NANO_USD),
      String(Date.parse(PROBE_CHALLENGE_CLOSES_AT)),
      PROBE_PREVIOUS_POLICY_VERSION,
      PROBE_MODEL,
      String(PROBE_MAX_CONCURRENCY),
      String(Date.now()),
      String(PROBE_PREVIOUS_PURPOSE_CALL_LIMITS.calibration),
      String(PROBE_PREVIOUS_PURPOSE_CALL_LIMITS.baseline),
      String(PROBE_PREVIOUS_PURPOSE_CALL_LIMITS.repair),
      String(PROBE_PREVIOUS_PURPOSE_CALL_LIMITS.revised),
      String(PROBE_PREVIOUS_PURPOSE_CALL_LIMITS.judge),
      prior.initializedCommit
    ]
  );
  if (!Array.isArray(reply) || Number(reply[0]) !== 1) {
    throw new ProbeLedgerError("MIGRATION_TEST_INIT_FAILED");
  }
  await redis.hset(keyspace.totals, {
    claimed_calls: 4,
    committed_nusd: 250_000_000,
    pending_count: 0,
    known_count: 4,
    uncertain_count: 0,
    known_actual_nusd: 11_360_800,
    uncertain_upper_nusd: 0,
    sequence: 4
  });
  await redis.hset(keyspace.purposeCounts, {
    calibration: 4,
    baseline: 0,
    repair: 0,
    revised: 0,
    judge: 0
  });
  for (const call of prior.knownCalls) {
    const auth = `${keyspace.namespace}:auth:${call.jti}`;
    await redis.hset(auth, {
      state: "KNOWN",
      jti: call.jti,
      claims_hash: await sha256Hex(`migration-claims:${call.jti}`),
      purpose: "calibration",
      subject_hash: await sha256Hex(`migration-subject:${call.jti}`),
      actor_hash: await sha256Hex(`migration-actor:${call.jti}`),
      issued_at: 1,
      expires_at: 2,
      guard_instance_id: prior.guardInstanceId,
      policy_hash: PROBE_PREVIOUS_POLICY_HASH,
      script_hash: PROBE_PREVIOUS_LEDGER_SCRIPT_HASH,
      reservation_nusd: PROBE_PER_CALL_RESERVATION_NANO_USD,
      dispatch_sequence: call.dispatchSequence,
      dispatch_at: 1,
      lease_expires_at: 2,
      actual_nusd: call.actualNanoUsd,
      provider_response_hash: call.providerResponseHash,
      settlement_digest: call.settlementDigest,
      usage_hash: call.usageHash,
      settled_at_ms: 3
    });
    await redis.set(`${keyspace.namespace}:provider:${call.providerResponseHash}`, call.jti);
  }
}

function schedule(): ProbePurpose[] {
  return Object.entries(PROBE_PURPOSE_CALL_LIMITS).flatMap(([purpose, count]) =>
    Array.from({ length: count }, () => purpose as ProbePurpose)
  );
}

async function cleanup(
  redis: ReturnType<typeof createProbeRedis>,
  keys: Set<string>
): Promise<void> {
  const values = [...keys];
  for (let offset = 0; offset < values.length; offset += 100) {
    const batch = values.slice(offset, offset + 100);
    if (batch.length > 0) await redis.unlink(...batch);
  }
  for (let offset = 0; offset < values.length; offset += 100) {
    const batch = values.slice(offset, offset + 100);
    if (batch.length > 0 && (await redis.exists(...batch)) !== 0) {
      throw new ProbeLedgerError("TEST_NAMESPACE_CLEANUP_FAILED");
    }
  }
}

async function integrationTest(): Promise<void> {
  const redis = createProbeRedis();
  const testId = randomBytes(8).toString("hex");
  const keyspace = createProbeLedgerKeyspace(`tp:{webmcp26}:integration_${testId}`);
  const concurrencyKeyspace = createProbeLedgerKeyspace(`tp:{webmcp26}:concurrency_${testId}`);
  const migrationKeyspace = createProbeLedgerKeyspace(`tp:{webmcp26}:migration_${testId}`);
  const tamperKeyspace = createProbeLedgerKeyspace(`tp:{webmcp26}:migration_tamper_${testId}`);
  const migrationPrior = await integrationMigrationPriorReceipt(testId);
  const tamperPrior = await integrationMigrationPriorReceipt(`${testId}_tamper`);
  const guard = await identity(`guard_integration_${testId}`, "f".repeat(40));
  const concurrencyGuard: ProbeGuardIdentity = {
    ...guard,
    guardInstanceId: `guard_concurrency_${testId}`
  };
  const actorHash = await sha256Hex(`actor:${testId}`);
  const keys = new Set<string>([
    keyspace.config,
    keyspace.totals,
    keyspace.purposeLimits,
    keyspace.purposeCounts,
    keyspace.inflight,
    concurrencyKeyspace.config,
    concurrencyKeyspace.totals,
    concurrencyKeyspace.purposeLimits,
    concurrencyKeyspace.purposeCounts,
    concurrencyKeyspace.inflight,
    migrationKeyspace.config,
    migrationKeyspace.totals,
    migrationKeyspace.purposeLimits,
    migrationKeyspace.purposeCounts,
    migrationKeyspace.inflight,
    probePolicyMigrationKey(migrationKeyspace),
    tamperKeyspace.config,
    tamperKeyspace.totals,
    tamperKeyspace.purposeLimits,
    tamperKeyspace.purposeCounts,
    tamperKeyspace.inflight,
    probePolicyMigrationKey(tamperKeyspace),
    `${concurrencyKeyspace.namespace}:issue-rate:calibration:${actorHash}`,
    ...Object.keys(PROBE_PURPOSE_CALL_LIMITS).map(
      (purpose) => `${keyspace.namespace}:issue-rate:${purpose}:${actorHash}`
    ),
    ...migrationPrior.knownCalls.flatMap((call) => [
      `${migrationKeyspace.namespace}:auth:${call.jti}`,
      `${migrationKeyspace.namespace}:provider:${call.providerResponseHash}`
    ]),
    ...tamperPrior.knownCalls.flatMap((call) => [
      `${tamperKeyspace.namespace}:auth:${call.jti}`,
      `${tamperKeyspace.namespace}:provider:${call.providerResponseHash}`
    ])
  ]);
  let terminalReceipt: Record<string, unknown> | undefined;

  try {
    await seedIntegrationMigrationGuard(redis, migrationKeyspace, migrationPrior);
    const oldMigrationStatus = await readProbeGuardStatus(redis, migrationKeyspace);
    if (
      oldMigrationStatus.policyVersion !== PROBE_PREVIOUS_POLICY_VERSION ||
      oldMigrationStatus.policyHash !== PROBE_PREVIOUS_POLICY_HASH ||
      oldMigrationStatus.scriptHash !== PROBE_PREVIOUS_LEDGER_SCRIPT_HASH ||
      oldMigrationStatus.purposeLimits.calibration !== 4 ||
      oldMigrationStatus.purposeLimits.judge !== 10 ||
      oldMigrationStatus.claimedCalls !== 4 ||
      oldMigrationStatus.knownCount !== 4 ||
      oldMigrationStatus.knownActualNanoUsd !== 11_360_800 ||
      oldMigrationStatus.sequence !== 4
    ) {
      throw new ProbeLedgerError("MIGRATION_TEST_OLD_STATUS_MISMATCH");
    }
    const migrated = await migrateProbeGuardPolicy(
      redis,
      { priorReceipt: migrationPrior, migrationCommit: "e".repeat(40) },
      migrationKeyspace
    );
    const replayedMigration = await migrateProbeGuardPolicy(
      redis,
      { priorReceipt: migrationPrior, migrationCommit: "e".repeat(40) },
      migrationKeyspace
    );
    const migratedStatus = await readProbeGuardStatus(redis, migrationKeyspace);
    if (
      migrated.disposition !== "new" ||
      replayedMigration.disposition !== "existing" ||
      migrated.receipt.receiptHash !== replayedMigration.receipt.receiptHash ||
      !isProbeGuardStatusConsistent(migratedStatus, {
        guardInstanceId: migrationPrior.guardInstanceId,
        initializedCommit: migrationPrior.initializedCommit,
        policyHash: await probePolicyHash(),
        scriptHash: await probeLedgerScriptHash()
      }) ||
      migratedStatus.claimedCalls !== 4 ||
      migratedStatus.knownCount !== 4 ||
      migratedStatus.committedNanoUsd !== 250_000_000 ||
      migratedStatus.knownActualNanoUsd !== 11_360_800 ||
      migratedStatus.sequence !== 4 ||
      migratedStatus.purposeLimits.calibration !== 8 ||
      migratedStatus.purposeLimits.judge !== 6
    ) {
      throw new ProbeLedgerError("MIGRATION_TEST_NEW_STATUS_MISMATCH");
    }
    const conflictPrior = parseProbePolicyMigrationPriorReceipt({
      ...migrationPrior,
      knownCalls: migrationPrior.knownCalls.map((call, index) =>
        index === 0 ? { ...call, jti: `${call.jti}_conflict` } : call
      )
    });
    await migrateProbeGuardPolicy(
      redis,
      { priorReceipt: conflictPrior, migrationCommit: "e".repeat(40) },
      migrationKeyspace
    ).then(
      () => {
        throw new ProbeLedgerError("MIGRATION_TEST_CONFLICT_ACCEPTED");
      },
      (error: unknown) => {
        if (!(error instanceof ProbeLedgerError) || error.code !== "MIGRATION_RECEIPT_CONFLICT") {
          throw error;
        }
      }
    );

    await seedIntegrationMigrationGuard(redis, tamperKeyspace, tamperPrior);
    const tamperedCall = tamperPrior.knownCalls[0];
    if (!tamperedCall) throw new ProbeLedgerError("MIGRATION_TEST_CALL_MISSING");
    await redis.hset(`${tamperKeyspace.namespace}:auth:${tamperedCall.jti}`, {
      actual_nusd: tamperedCall.actualNanoUsd + 1
    });
    await migrateProbeGuardPolicy(
      redis,
      { priorReceipt: tamperPrior, migrationCommit: "e".repeat(40) },
      tamperKeyspace
    ).then(
      () => {
        throw new ProbeLedgerError("MIGRATION_TEST_TAMPER_ACCEPTED");
      },
      (error: unknown) => {
        if (
          !(error instanceof ProbeLedgerError) ||
          error.code !== "MIGRATION_KNOWN_CALL_MISMATCH"
        ) {
          throw error;
        }
      }
    );
    const tamperedStatus = await readProbeGuardStatus(redis, tamperKeyspace);
    if (
      tamperedStatus.policyHash !== PROBE_PREVIOUS_POLICY_HASH ||
      tamperedStatus.scriptHash !== PROBE_PREVIOUS_LEDGER_SCRIPT_HASH ||
      tamperedStatus.purposeLimits.calibration !== 4 ||
      tamperedStatus.purposeLimits.judge !== 10 ||
      (await redis.exists(probePolicyMigrationKey(tamperKeyspace))) !== 0
    ) {
      throw new ProbeLedgerError("MIGRATION_TEST_TAMPER_MUTATED_STATE");
    }

    await initializeProbeGuard(redis, concurrencyGuard, Date.now(), concurrencyKeyspace);
    const concurrentTokens = await Promise.all(
      [0, 1].map(async (index) => {
        const jti = `jti_concurrent_${testId}_${index}`;
        const subjectHash = await sha256Hex(`concurrent-subject:${testId}:${index}`);
        const claimsHash = await sha256Hex(`concurrent-claims:${testId}:${index}`);
        keys.add(`${concurrencyKeyspace.namespace}:subject:${subjectHash}`);
        keys.add(`${concurrencyKeyspace.namespace}:auth:${jti}`);
        await issueProbeAuthorization(
          redis,
          {
            ...concurrencyGuard,
            jti,
            claimsHash,
            purpose: "calibration",
            subjectHash,
            actorHash
          },
          concurrencyKeyspace
        );
        return { jti, claimsHash };
      })
    );
    const concurrentAttempts = await Promise.allSettled(
      concurrentTokens.map(({ jti, claimsHash }) =>
        beginProbeCall(
          redis,
          { ...concurrencyGuard, jti, claimsHash, purpose: "calibration" },
          concurrencyKeyspace
        )
      )
    );
    const concurrentWinner = concurrentAttempts.findIndex(({ status }) => status === "fulfilled");
    const concurrentLoser = concurrentAttempts.findIndex(({ status }) => status === "rejected");
    if (concurrentWinner < 0 || concurrentLoser < 0) {
      throw new Error("distinct_concurrency_grant_mismatch");
    }
    const loserReason = concurrentAttempts[concurrentLoser];
    if (
      loserReason?.status !== "rejected" ||
      !(loserReason.reason instanceof ProbeLedgerError) ||
      loserReason.reason.code !== "CONCURRENCY_LIMIT"
    ) {
      throw new Error("distinct_concurrency_rejection_mismatch");
    }
    const winner = concurrentTokens[concurrentWinner];
    if (!winner) throw new Error("missing_concurrent_winner");
    const concurrentResponseHash = await sha256Hex(`concurrent-response:${testId}`);
    keys.add(`${concurrencyKeyspace.namespace}:provider:${concurrentResponseHash}`);
    await settleProbeCallKnown(
      redis,
      {
        ...concurrencyGuard,
        jti: winner.jti,
        actualNanoUsd: 0,
        providerResponseHash: concurrentResponseHash,
        settlementDigest: await sha256Hex(`concurrent-settlement:${testId}`),
        usageHash: await sha256Hex(`concurrent-usage:${testId}`)
      },
      concurrencyKeyspace
    );

    await initializeProbeGuard(redis, guard, Date.now(), keyspace);
    const purposes = schedule();
    if (purposes.length !== PROBE_GLOBAL_CALL_LIMIT) throw new Error("invalid_test_schedule");

    for (const [index, purpose] of purposes.entries()) {
      const suffix = `${testId}_${String(index).padStart(3, "0")}`;
      const jti = `jti_${suffix}`;
      const subjectHash = await sha256Hex(`subject:${suffix}`);
      const claimsHash = await sha256Hex(`claims:${suffix}`);
      const responseHash = await sha256Hex(`response:${suffix}`);
      const settlementDigest = await sha256Hex(`settlement:${suffix}`);
      const usageHash = await sha256Hex(`usage:${suffix}`);
      keys.add(`${keyspace.namespace}:subject:${subjectHash}`);
      keys.add(`${keyspace.namespace}:auth:${jti}`);
      keys.add(`${keyspace.namespace}:provider:${responseHash}`);

      await issueProbeAuthorization(
        redis,
        { ...guard, jti, claimsHash, purpose, subjectHash, actorHash },
        keyspace
      );

      if (index === 0) {
        const attempts = await Promise.allSettled([
          beginProbeCall(redis, { ...guard, jti, claimsHash, purpose }, keyspace),
          beginProbeCall(redis, { ...guard, jti, claimsHash, purpose }, keyspace)
        ]);
        if (attempts.filter(({ status }) => status === "fulfilled").length !== 1) {
          throw new Error("concurrent_token_grant_mismatch");
        }
      } else {
        await beginProbeCall(redis, { ...guard, jti, claimsHash, purpose }, keyspace);
      }

      await settleProbeCallKnown(
        redis,
        {
          ...guard,
          jti,
          actualNanoUsd: 0,
          providerResponseHash: responseHash,
          settlementDigest,
          usageHash
        },
        keyspace
      );
    }

    const status = await readProbeGuardStatus(redis, keyspace);
    if (
      status.status !== "open" ||
      status.claimedCalls !== PROBE_GLOBAL_CALL_LIMIT ||
      status.committedNanoUsd !== PROBE_LIFETIME_SPEND_CEILING_NANO_USD ||
      status.pendingCount !== 0 ||
      status.knownCount !== PROBE_GLOBAL_CALL_LIMIT ||
      status.uncertainCount !== 0
    ) {
      throw new Error("integration_totals_mismatch");
    }

    const overflowJti = `jti_${testId}_overflow`;
    const overflowSubject = await sha256Hex(`subject:${testId}:overflow`);
    const overflowClaims = await sha256Hex(`claims:${testId}:overflow`);
    const overflowActor = await sha256Hex(`actor:${testId}:overflow`);
    keys.add(`${keyspace.namespace}:subject:${overflowSubject}`);
    keys.add(`${keyspace.namespace}:auth:${overflowJti}`);
    keys.add(`${keyspace.namespace}:issue-rate:judge:${overflowActor}`);
    await issueProbeAuthorization(
      redis,
      {
        ...guard,
        jti: overflowJti,
        claimsHash: overflowClaims,
        purpose: "judge",
        subjectHash: overflowSubject,
        actorHash: overflowActor
      },
      keyspace
    );
    await beginProbeCall(
      redis,
      { ...guard, jti: overflowJti, claimsHash: overflowClaims, purpose: "judge" },
      keyspace
    ).then(
      () => {
        throw new Error("overflow_call_was_granted");
      },
      (error: unknown) => {
        if (!(error instanceof ProbeLedgerError) || error.code !== "GLOBAL_CALL_LIMIT") throw error;
      }
    );

    terminalReceipt = {
      ok: true,
      mode: "integration-test",
      calls: status.claimedCalls,
      committedNanoUsd: status.committedNanoUsd,
      expectedCommittedNanoUsd: PROBE_GLOBAL_CALL_LIMIT * PROBE_PER_CALL_RESERVATION_NANO_USD,
      concurrentReplayRejected: true,
      distinctConcurrencyRejected: true,
      overflowRejected: true,
      policyMigrationVerified: true,
      policyMigrationReplayVerified: true,
      policyMigrationConflictRejected: true,
      policyMigrationTamperRejected: true
    };
  } finally {
    await cleanup(redis, keys);
  }
  if (!terminalReceipt) throw new ProbeLedgerError("MISSING_INTEGRATION_RECEIPT");
  safeReceipt(terminalReceipt);
}

const mode = process.argv[2];

try {
  if (mode === "hashes") await printHashes();
  else if (mode === "status") await productionStatus();
  else if (mode === "init") await initializeProduction();
  else if (mode === "reap") await reapProduction();
  else if (mode === "migrate-policy") await migrateProductionPolicy();
  else if (mode === "bootstrap") {
    const operatorIntentCount = [
      process.env.TOOLPROOF_PROBE_POLICY_MIGRATION_CONFIRM,
      process.env.TOOLPROOF_PROBE_REAP_CONFIRM,
      process.env.TOOLPROOF_PROBE_INIT_CONFIRM
    ].filter(Boolean).length;
    if (operatorIntentCount > 1) throw new ProbeLedgerError("AMBIGUOUS_OPERATOR_INTENT");
    if (process.env.TOOLPROOF_PROBE_POLICY_MIGRATION_CONFIRM) await migrateProductionPolicy();
    else if (process.env.TOOLPROOF_PROBE_REAP_CONFIRM) await reapProduction();
    else if (process.env.TOOLPROOF_PROBE_INIT_CONFIRM) await initializeProduction();
    else await productionStatus();
  } else if (mode === "integration-test") await integrationTest();
  else
    throw new Error(
      "usage: probe-controls.ts <hashes|status|init|reap|migrate-policy|bootstrap|integration-test>"
    );
} catch (error) {
  const code =
    error instanceof ProbeLedgerError
      ? error.code
      : error instanceof Error
        ? error.name
        : "unknown";
  process.stderr.write(`${JSON.stringify({ ok: false, mode: mode ?? null, error: code })}\n`);
  process.exit(1);
}
