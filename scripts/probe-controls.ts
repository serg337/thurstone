import { randomBytes } from "node:crypto";

import { canonicalJson, canonicalSha256, sha256Hex } from "../lib/evidence/digest";
import {
  PROBE_LEDGER_SCRIPTS,
  ProbeLedgerError,
  beginProbeCall,
  createProbeLedgerKeyspace,
  createProbeRedis,
  discoverProbeV03PolicyMigrationSource,
  initializeProbeGuard,
  issueProbeAuthorization,
  migrateProbeGuardPolicy,
  migrateProbeGuardPolicyV03,
  probeLedgerScriptHash,
  probePolicyMigrationKey,
  probeV03PolicyMigrationKey,
  readProbeGuardStatus,
  reapExpiredProbeCall,
  settleProbeCallKnown,
  type ProbeGuardIdentity
} from "../lib/probe/ledger";
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
  PROBE_PREVIOUS_PURPOSE_CALL_LIMITS,
  parseProbePolicyMigrationPriorReceipt,
  type ProbePolicyMigrationPriorReceipt
} from "../lib/probe/policy-migration-contract";
import {
  PROBE_V03_POLICY_MIGRATION_ID,
  PROBE_V03_PREDECESSOR_MIGRATION_RECEIPT_HASH,
  createProbeV03PolicyMigrationManifest,
  isProbeV03PolicyMigrationSourceStatus,
  probeV03PolicyMigrationDigest
} from "../lib/probe/policy-v03-migration-contract";
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
import { probeContinuationScriptHash } from "../lib/probe/continuation-store";
import { probeRunnerContractHash } from "../lib/probe/runner-contract";

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
  const [policyHash, scriptHash, runnerHash, continuationHash] = await Promise.all([
    probePolicyHash(),
    probeLedgerScriptHash(),
    probeRunnerContractHash(),
    probeContinuationScriptHash()
  ]);
  safeReceipt({
    ok: true,
    mode: "hashes",
    policyHash,
    scriptHash,
    runnerHash,
    continuationHash
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
    isProbeV03PolicyMigrationSourceStatus(status, { guardInstanceId, initializedCommit });
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

function productionV03MigrationContext(): {
  readonly sourceCommit: string;
  readonly guardInstanceId: string;
  readonly initializedCommit: string;
} {
  const sourceCommit = process.env.VERCEL_GIT_COMMIT_SHA;
  const guardInstanceId = process.env.TOOLPROOF_GUARD_INSTANCE_ID;
  const initializedCommit = process.env.TOOLPROOF_GUARD_INITIALIZED_COMMIT;
  if (
    !sourceCommit ||
    !/^[a-f0-9]{40}$/u.test(sourceCommit) ||
    process.env.TOOLPROOF_PROBE_APPROVED_COMMIT !== sourceCommit ||
    !guardInstanceId ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(guardInstanceId) ||
    !initializedCommit ||
    !/^[a-f0-9]{40}$/u.test(initializedCommit) ||
    process.env.VERCEL !== "1" ||
    process.env.VERCEL_ENV !== "production" ||
    !hasExpectedVercelProjectIdentity()
  ) {
    throw new ProbeLedgerError("PRODUCTION_V03_MIGRATION_CONTEXT_REQUIRED");
  }
  return { sourceCommit, guardInstanceId, initializedCommit };
}

async function prepareProductionPolicyV03() {
  const { sourceCommit, guardInstanceId, initializedCommit } = productionV03MigrationContext();
  // The only discovery pass is read-only, bounded, and kept entirely in process memory.
  const redis = createProbeRedis();
  const discovered = await discoverProbeV03PolicyMigrationSource(redis, {
    guardInstanceId,
    initializedCommit
  });
  const nextPolicyHash = await probePolicyHash();
  const nextScriptHash = await probeLedgerScriptHash();
  const manifest = await createProbeV03PolicyMigrationManifest({
    sourceReceipt: discovered.sourceReceipt,
    predecessorReceipt: discovered.predecessorReceipt,
    migrationCommit: sourceCommit,
    nextPolicyHash,
    nextScriptHash
  });
  const [sourceDigest, migrationDigest] = await Promise.all([
    canonicalSha256(discovered.sourceReceipt),
    probeV03PolicyMigrationDigest(manifest)
  ]);
  const expectedConfirmation = await canonicalSha256({
    version: "toolproof-probe-policy-v03-confirmation@1.0.0",
    sourceCommit,
    guardInstanceId,
    initializedCommit,
    migrationId: PROBE_V03_POLICY_MIGRATION_ID,
    predecessorReceiptHash: PROBE_V03_PREDECESSOR_MIGRATION_RECEIPT_HASH,
    sourceDigest,
    migrationDigest,
    nextPolicyHash,
    nextScriptHash
  });
  return {
    redis,
    discovered,
    sourceCommit,
    guardInstanceId,
    initializedCommit,
    nextPolicyHash,
    nextScriptHash,
    sourceDigest,
    migrationDigest,
    expectedConfirmation
  };
}

async function preflightProductionPolicyV03(): Promise<void> {
  const prepared = await prepareProductionPolicyV03();
  safeReceipt({
    ok: true,
    mode: "preflight-policy-v03",
    migrationId: PROBE_V03_POLICY_MIGRATION_ID,
    predecessorReceiptHash: PROBE_V03_PREDECESSOR_MIGRATION_RECEIPT_HASH,
    sourceDigest: prepared.sourceDigest,
    migrationDigest: prepared.migrationDigest,
    policyHash: prepared.nextPolicyHash,
    scriptHash: prepared.nextScriptHash,
    confirmation: prepared.expectedConfirmation
  });
}

async function migrateProductionPolicyV03(): Promise<void> {
  productionV03MigrationContext();
  const suppliedConfirmation = process.env.TOOLPROOF_PROBE_POLICY_V03_MIGRATION_CONFIRM;
  if (!suppliedConfirmation || suppliedConfirmation.length !== 64) {
    throw new ProbeLedgerError("PRODUCTION_V03_MIGRATION_CONFIRMATION_REQUIRED");
  }
  const prepared = await prepareProductionPolicyV03();
  const {
    redis,
    discovered,
    sourceCommit,
    guardInstanceId,
    initializedCommit,
    nextPolicyHash,
    nextScriptHash,
    expectedConfirmation
  } = prepared;
  if (suppliedConfirmation !== expectedConfirmation) {
    throw new ProbeLedgerError("PRODUCTION_V03_MIGRATION_CONFIRMATION_REQUIRED");
  }

  const result = await migrateProbeGuardPolicyV03(redis, {
    sourceReceipt: discovered.sourceReceipt,
    predecessorReceipt: discovered.predecessorReceipt,
    migrationCommit: sourceCommit
  });
  const status = await readProbeGuardStatus(redis);
  const expected: ProbeGuardIdentity = {
    guardInstanceId,
    initializedCommit,
    policyHash: nextPolicyHash,
    scriptHash: nextScriptHash
  };
  const preserved = discovered.sourceReceipt.preserved;
  if (
    !isProbeGuardStatusConsistent(status, expected) ||
    status.claimedCalls !== preserved.claimedCalls ||
    status.knownCount !== preserved.knownCalls ||
    status.pendingCount !== preserved.pendingCalls ||
    status.uncertainCount !== preserved.uncertainCalls ||
    status.inflightCount !== preserved.inflightCalls ||
    status.committedNanoUsd !== preserved.committedNanoUsd ||
    status.knownActualNanoUsd !== preserved.knownActualNanoUsd ||
    status.uncertainUpperNanoUsd !== preserved.uncertainUpperNanoUsd ||
    status.sequence !== preserved.sequence ||
    canonicalJson(status.purposeCounts) !== canonicalJson(preserved.purposeCounts)
  ) {
    throw new ProbeLedgerError("V03_MIGRATION_RECEIPT_MISMATCH");
  }
  safeReceipt({
    ok: true,
    mode: "migrate-policy-v03",
    disposition: result.disposition,
    migrationId: result.receipt.migrationId,
    migrationDigest: result.receipt.migrationDigest,
    receiptHash: result.receipt.receiptHash,
    predecessorReceiptHash: result.receipt.predecessorMigrationReceiptHash,
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

async function seedIntegrationV03FifthCall(
  redis: ReturnType<typeof createProbeRedis>,
  keyspace: ReturnType<typeof createProbeLedgerKeyspace>,
  guardInstanceId: string,
  testId: string
) {
  const call = {
    ordinal: 4,
    jti: `jti_migration_${testId}_4`,
    dispatchSequence: 5,
    actualNanoUsd: 2_500_000,
    providerResponseHash: await sha256Hex(`migration-response:${testId}:4`),
    settlementDigest: await sha256Hex(`migration-settlement:${testId}:4`),
    usageHash: await sha256Hex(`migration-usage:${testId}:4`)
  };
  await redis.hset(keyspace.totals, {
    claimed_calls: 5,
    committed_nusd: 312_500_000,
    pending_count: 0,
    known_count: 5,
    uncertain_count: 0,
    known_actual_nusd: 13_860_800,
    uncertain_upper_nusd: 0,
    sequence: 5
  });
  await redis.hset(keyspace.purposeCounts, { calibration: 5 });
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
    guard_instance_id: guardInstanceId,
    policy_hash: PROBE_MIGRATED_POLICY_HASH,
    script_hash: PROBE_MIGRATED_LEDGER_SCRIPT_HASH,
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
  return call;
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
  const admissionKeyspace = createProbeLedgerKeyspace(`tp:{webmcp26}:admission_${testId}`);
  const migrationKeyspace = createProbeLedgerKeyspace(`tp:{webmcp26}:migration_${testId}`);
  const tamperKeyspace = createProbeLedgerKeyspace(`tp:{webmcp26}:migration_tamper_${testId}`);
  const migrationPrior = await integrationMigrationPriorReceipt(testId);
  const tamperPrior = await integrationMigrationPriorReceipt(`${testId}_tamper`);
  const guard = await identity(`guard_integration_${testId}`, "f".repeat(40));
  const concurrencyGuard: ProbeGuardIdentity = {
    ...guard,
    guardInstanceId: `guard_concurrency_${testId}`
  };
  const admissionGuard: ProbeGuardIdentity = {
    ...guard,
    guardInstanceId: `guard_admission_${testId}`
  };
  const actorHash = await sha256Hex(`actor:${testId}`);
  const admissionActivationHash = await sha256Hex(`admission-activation:${testId}`);
  const admissionOwnerHash = await sha256Hex(`admission-owner:${testId}`);
  const admissionRunBase = `tp:{webmcp26}:run-index:integration_${testId}`;
  const admissionAnchor = `${admissionRunBase}:${admissionActivationHash}:anchor`;
  const admissionData = `${admissionRunBase}:${admissionActivationHash}:data`;
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
    admissionKeyspace.config,
    admissionKeyspace.totals,
    admissionKeyspace.purposeLimits,
    admissionKeyspace.purposeCounts,
    admissionKeyspace.inflight,
    admissionAnchor,
    admissionData,
    migrationKeyspace.config,
    migrationKeyspace.totals,
    migrationKeyspace.purposeLimits,
    migrationKeyspace.purposeCounts,
    migrationKeyspace.inflight,
    probePolicyMigrationKey(migrationKeyspace),
    probeV03PolicyMigrationKey(migrationKeyspace),
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
      migratedStatus.policyVersion !== PROBE_MIGRATED_POLICY_VERSION ||
      migratedStatus.policyHash !== PROBE_MIGRATED_POLICY_HASH ||
      migratedStatus.scriptHash !== PROBE_MIGRATED_LEDGER_SCRIPT_HASH ||
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

    const fifthCall = await seedIntegrationV03FifthCall(
      redis,
      migrationKeyspace,
      migrationPrior.guardInstanceId,
      testId
    );
    keys.add(`${migrationKeyspace.namespace}:auth:${fifthCall.jti}`);
    keys.add(`${migrationKeyspace.namespace}:provider:${fifthCall.providerResponseHash}`);
    const discoveredV03 = await discoverProbeV03PolicyMigrationSource(
      redis,
      {
        guardInstanceId: migrationPrior.guardInstanceId,
        initializedCommit: migrationPrior.initializedCommit,
        expectedPredecessorReceiptHash: migrated.receipt.receiptHash
      },
      migrationKeyspace
    );
    const migratedV03 = await migrateProbeGuardPolicyV03(
      redis,
      {
        sourceReceipt: discoveredV03.sourceReceipt,
        predecessorReceipt: discoveredV03.predecessorReceipt,
        migrationCommit: "d".repeat(40)
      },
      migrationKeyspace
    );
    const replayedV03 = await migrateProbeGuardPolicyV03(
      redis,
      {
        sourceReceipt: discoveredV03.sourceReceipt,
        predecessorReceipt: discoveredV03.predecessorReceipt,
        migrationCommit: "d".repeat(40)
      },
      migrationKeyspace
    );
    const v03Status = await readProbeGuardStatus(redis, migrationKeyspace);
    if (
      migratedV03.disposition !== "new" ||
      replayedV03.disposition !== "existing" ||
      migratedV03.receipt.receiptHash !== replayedV03.receipt.receiptHash ||
      migratedV03.receipt.predecessorMigrationReceiptHash !== migrated.receipt.receiptHash ||
      !isProbeGuardStatusConsistent(v03Status, {
        guardInstanceId: migrationPrior.guardInstanceId,
        initializedCommit: migrationPrior.initializedCommit,
        policyHash: await probePolicyHash(),
        scriptHash: await probeLedgerScriptHash()
      }) ||
      v03Status.claimedCalls !== 5 ||
      v03Status.knownCount !== 5 ||
      v03Status.committedNanoUsd !== 312_500_000 ||
      v03Status.knownActualNanoUsd !== 13_860_800 ||
      v03Status.sequence !== 5 ||
      v03Status.purposeLimits.calibration !== 9 ||
      v03Status.purposeLimits.judge !== 5 ||
      (await redis.exists(probePolicyMigrationKey(migrationKeyspace))) !== 1
    ) {
      throw new ProbeLedgerError("V03_MIGRATION_TEST_NEW_STATUS_MISMATCH");
    }
    await migrateProbeGuardPolicyV03(
      redis,
      {
        sourceReceipt: discoveredV03.sourceReceipt,
        predecessorReceipt: discoveredV03.predecessorReceipt,
        migrationCommit: "c".repeat(40)
      },
      migrationKeyspace
    ).then(
      () => {
        throw new ProbeLedgerError("V03_MIGRATION_TEST_CONFLICT_ACCEPTED");
      },
      (error: unknown) => {
        if (
          !(error instanceof ProbeLedgerError) ||
          error.code !== "V03_MIGRATION_RECEIPT_CONFLICT"
        ) {
          throw error;
        }
      }
    );
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

    await initializeProbeGuard(redis, admissionGuard, Date.now(), admissionKeyspace);
    await redis.hset(admissionAnchor, {
      activation_hash: admissionActivationHash,
      build_commit: admissionGuard.initializedCommit
    });
    await redis.hset(admissionData, {
      activation_hash: admissionActivationHash,
      build_commit: admissionGuard.initializedCommit,
      status: "active",
      revision: 0,
      owner_revision: 0,
      owner_hash: admissionOwnerHash,
      owner_expires_at_ms: Date.now() + 60_000
    });
    if ((await redis.pexpire(admissionData, 60_000)) !== 1) {
      throw new ProbeLedgerError("ADMISSION_TEST_EXPIRY_FAILED");
    }
    const admissionJti = `jti_admission_${testId}_0`;
    const admissionSubject = await sha256Hex(`admission-subject:${testId}`);
    const admissionClaims = await sha256Hex(`admission-claims:${testId}`);
    const admissionResponse = await sha256Hex(`admission-response:${testId}`);
    const admissionRun = {
      anchorKey: admissionAnchor,
      dataKey: admissionData,
      activationHash: admissionActivationHash,
      buildCommit: admissionGuard.initializedCommit,
      ownerHash: admissionOwnerHash,
      ownerRevision: 0,
      ordinal: 0
    };
    keys.add(`${admissionKeyspace.namespace}:subject:${admissionSubject}`);
    keys.add(`${admissionKeyspace.namespace}:auth:${admissionJti}`);
    keys.add(`${admissionKeyspace.namespace}:provider:${admissionResponse}`);
    keys.add(`${admissionKeyspace.namespace}:issue-rate:calibration:${actorHash}`);
    await issueProbeAuthorization(
      redis,
      {
        ...admissionGuard,
        jti: admissionJti,
        claimsHash: admissionClaims,
        purpose: "calibration",
        subjectHash: admissionSubject,
        actorHash,
        runAdmission: admissionRun
      },
      admissionKeyspace
    );
    await beginProbeCall(
      redis,
      {
        ...admissionGuard,
        jti: admissionJti,
        claimsHash: admissionClaims,
        purpose: "calibration",
        runAdmission: admissionRun
      },
      admissionKeyspace
    );
    await settleProbeCallKnown(
      redis,
      {
        ...admissionGuard,
        jti: admissionJti,
        actualNanoUsd: 0,
        providerResponseHash: admissionResponse,
        settlementDigest: await sha256Hex(`admission-settlement:${testId}`),
        usageHash: await sha256Hex(`admission-usage:${testId}`)
      },
      admissionKeyspace
    );
    await redis.hset(admissionData, { status: "acknowledged" });
    const rejectedAdmissionJti = `jti_admission_${testId}_1`;
    const rejectedAdmissionSubject = await sha256Hex(`admission-subject:${testId}:rejected`);
    keys.add(`${admissionKeyspace.namespace}:subject:${rejectedAdmissionSubject}`);
    keys.add(`${admissionKeyspace.namespace}:auth:${rejectedAdmissionJti}`);
    await issueProbeAuthorization(
      redis,
      {
        ...admissionGuard,
        jti: rejectedAdmissionJti,
        claimsHash: await sha256Hex(`admission-claims:${testId}:rejected`),
        purpose: "calibration",
        subjectHash: rejectedAdmissionSubject,
        actorHash,
        runAdmission: admissionRun
      },
      admissionKeyspace
    ).then(
      () => {
        throw new ProbeLedgerError("INACTIVE_RUN_ADMISSION_ACCEPTED");
      },
      (error: unknown) => {
        if (!(error instanceof ProbeLedgerError) || error.code !== "RUN_ADMISSION_INVALID") {
          throw error;
        }
      }
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
      runAdmissionVerified: true,
      inactiveRunAdmissionRejected: true,
      overflowRejected: true,
      policyMigrationVerified: true,
      policyMigrationReplayVerified: true,
      policyMigrationConflictRejected: true,
      policyMigrationTamperRejected: true,
      policyV03MigrationVerified: true,
      policyV03MigrationReplayVerified: true,
      policyV03MigrationConflictRejected: true
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
  else if (mode === "preflight-policy-v03") await preflightProductionPolicyV03();
  else if (mode === "migrate-policy" || mode === "migrate-policy-v03")
    await migrateProductionPolicyV03();
  else if (mode === "bootstrap") {
    const operatorIntentCount = [
      process.env.TOOLPROOF_PROBE_POLICY_V03_MIGRATION_CONFIRM,
      process.env.TOOLPROOF_PROBE_POLICY_V03_MIGRATION_PREFLIGHT,
      process.env.TOOLPROOF_PROBE_POLICY_MIGRATION_CONFIRM,
      process.env.TOOLPROOF_PROBE_REAP_CONFIRM,
      process.env.TOOLPROOF_PROBE_INIT_CONFIRM
    ].filter(Boolean).length;
    if (operatorIntentCount > 1) throw new ProbeLedgerError("AMBIGUOUS_OPERATOR_INTENT");
    if (process.env.TOOLPROOF_PROBE_POLICY_MIGRATION_CONFIRM) {
      throw new ProbeLedgerError("LEGACY_MIGRATION_INTENT_REJECTED");
    }
    if (process.env.TOOLPROOF_PROBE_POLICY_V03_MIGRATION_PREFLIGHT) {
      if (process.env.TOOLPROOF_PROBE_POLICY_V03_MIGRATION_PREFLIGHT !== "1") {
        throw new ProbeLedgerError("INVALID_V03_MIGRATION_PREFLIGHT_INTENT");
      }
      await preflightProductionPolicyV03();
    } else if (process.env.TOOLPROOF_PROBE_POLICY_V03_MIGRATION_CONFIRM)
      await migrateProductionPolicyV03();
    else if (process.env.TOOLPROOF_PROBE_REAP_CONFIRM) await reapProduction();
    else if (process.env.TOOLPROOF_PROBE_INIT_CONFIRM) await initializeProduction();
    else await productionStatus();
  } else if (mode === "integration-test") await integrationTest();
  else
    throw new Error(
      "usage: probe-controls.ts <hashes|status|init|reap|preflight-policy-v03|migrate-policy-v03|bootstrap|integration-test>"
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
