import { randomBytes } from "node:crypto";

import { sha256Hex } from "../lib/evidence/digest";
import {
  ProbeLedgerError,
  beginProbeCall,
  createProbeLedgerKeyspace,
  createProbeRedis,
  initializeProbeGuard,
  issueProbeAuthorization,
  probeLedgerScriptHash,
  readProbeGuardStatus,
  reapExpiredProbeCall,
  settleProbeCallKnown,
  type ProbeGuardIdentity
} from "../lib/probe/ledger";
import {
  PROBE_GLOBAL_CALL_LIMIT,
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
  PROBE_PER_CALL_RESERVATION_NANO_USD,
  PROBE_PURPOSE_CALL_LIMITS,
  probePolicyHash,
  type ProbePurpose
} from "../lib/probe/policy";
import { isProbeGuardStatusConsistent } from "../lib/probe/status";

const VERCEL_PROJECT_ID = "prj_giQhynM5Q7QjJ1ZzjrS3Zv8H3M1r";

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
  if (!isProbeGuardStatusConsistent(status, expected)) {
    throw new ProbeLedgerError("GUARD_IDENTITY_MISMATCH");
  }
  safeReceipt({
    ok: true,
    mode: "status",
    status: status.status,
    guardInstanceId: status.guardInstanceId,
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
    process.env.VERCEL_PROJECT_ID !== VERCEL_PROJECT_ID
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
    guardInstanceId: status.guardInstanceId,
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
    process.env.VERCEL_PROJECT_ID !== VERCEL_PROJECT_ID
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
    jti,
    settlementDigest,
    claimedCalls: status.claimedCalls,
    committedNanoUsd: status.committedNanoUsd,
    uncertainCount: status.uncertainCount
  });
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
    `${concurrencyKeyspace.namespace}:issue-rate:calibration:${actorHash}`,
    ...Object.keys(PROBE_PURPOSE_CALL_LIMITS).map(
      (purpose) => `${keyspace.namespace}:issue-rate:${purpose}:${actorHash}`
    )
  ]);
  let terminalReceipt: Record<string, unknown> | undefined;

  try {
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
      overflowRejected: true
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
  else if (mode === "bootstrap") {
    if (process.env.TOOLPROOF_PROBE_REAP_CONFIRM) await reapProduction();
    else if (process.env.TOOLPROOF_PROBE_INIT_CONFIRM) await initializeProduction();
    else await productionStatus();
  } else if (mode === "integration-test") await integrationTest();
  else
    throw new Error(
      "usage: probe-controls.ts <hashes|status|init|reap|bootstrap|integration-test>"
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
