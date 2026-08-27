import { randomBytes } from "node:crypto";

import { canonicalJson } from "../lib/evidence/digest";
import {
  PROBE_CONTINUATION_STAGES,
  createProbeContinuationKeyspace,
  getProbeContinuation,
  probeContinuationKey,
  putProbeContinuation
} from "../lib/probe/continuation-store";
import { createProbeRedis } from "../lib/probe/ledger";
import {
  acknowledgeProbeRunIndex,
  advanceProbeRunIndex,
  armProbeOperator,
  assertProbeOperatorArmed,
  assertProbeRunDocumentOwner,
  claimProbeRunDocument,
  createProbeRunIndexKeyspace,
  deleteUnstartedProbeRunIndex,
  getProbeRunIndex,
  getProbeRunIndexByLaunch,
  probeOperatorArmKey,
  probeRunIndexKeys,
  putProbeRunIndex,
  terminalProbeRunIndexPayloadBinding
} from "../lib/probe/run-index";
import { issueProbeRecoveryCredential, issueProbeSession } from "../lib/probe/session";

const redis = createProbeRedis();
const testId = randomBytes(8).toString("hex");
const keyspace = createProbeContinuationKeyspace(
  `tp:{webmcp26}:continuation:integration_${testId}`
);
const artifactSecret = randomBytes(32).toString("base64url");
const jti = `jti_integration_${testId}`;
const keys = PROBE_CONTINUATION_STAGES.map((stage) => probeContinuationKey(keyspace, jti, stage));
const runIndexKeyspace = createProbeRunIndexKeyspace(
  `tp:{webmcp26}:run-index:integration_${testId}`
);
const cleanupRunIndexKeyspace = createProbeRunIndexKeyspace(
  `tp:{webmcp26}:run-index:cleanup_${testId}`
);
const activationHash = "a".repeat(64);
const cleanupActivationHash = "e".repeat(64);
const buildCommit = "b".repeat(40);
const actorHash = "c".repeat(64);
const launchHash = "d".repeat(64);
const cleanupLaunchHash = "f".repeat(64);
const guardInstanceId = `guard_integration_${testId}`;
const policyHash = "1".repeat(64);
const scriptHash = "2".repeat(64);
const initializedCommit = "3".repeat(40);

function runRecovery(input: { readonly activationHash: string; readonly launchHash: string }) {
  const session = issueProbeSession({
    activationHash: input.activationHash,
    buildCommit,
    actorHash,
    signingSecret: artifactSecret
  });
  return issueProbeRecoveryCredential({
    session: session.claims,
    launchHash: input.launchHash,
    signingSecret: artifactSecret
  }).claims;
}

function guardKeys(label: string) {
  const namespace = `tp:{webmcp26}:run-index-guard:${label}_${testId}`;
  return {
    configKey: `${namespace}:config`,
    totalsKey: `${namespace}:totals`,
    purposeCountsKey: `${namespace}:purpose-counts`,
    inflightKey: `${namespace}:inflight`
  };
}

async function seedGuard(count: number, guard: ReturnType<typeof guardKeys>): Promise<void> {
  await redis.hset(guard.configKey, {
    status: "open",
    guard_instance_id: guardInstanceId,
    policy_hash: policyHash,
    script_hash: scriptHash,
    initialized_commit: initializedCommit
  });
  await redis.hset(guard.totalsKey, {
    claimed_calls: String(count),
    known_count: String(count),
    pending_count: "0",
    uncertain_count: "0"
  });
  await redis.hset(guard.purposeCountsKey, { calibration: String(count) });
}

const terminalGuardKeys = guardKeys("terminal");
const cleanupGuardKeys = guardKeys("cleanup");
const cleanupJti = `jti_cleanup_${testId}`;
const runKeys = [
  ...probeRunIndexKeys(runIndexKeyspace, activationHash),
  probeOperatorArmKey(runIndexKeyspace, activationHash),
  ...Object.values(terminalGuardKeys),
  ...probeRunIndexKeys(cleanupRunIndexKeyspace, cleanupActivationHash),
  ...Object.values(cleanupGuardKeys),
  `${cleanupGuardKeys.configKey.replace(/:config$/u, "")}:auth:${cleanupJti}`
];

try {
  for (const stage of PROBE_CONTINUATION_STAGES) {
    const payload = { testId, stage, synthetic: true };
    const stored = await putProbeContinuation(
      redis,
      { jti, stage, payload, artifactSecret },
      keyspace
    );
    if (stored.disposition !== "new") throw new Error("continuation_not_new");
    const replay = await putProbeContinuation(
      redis,
      { jti, stage, payload, artifactSecret },
      keyspace
    );
    if (replay.disposition !== "existing") throw new Error("continuation_not_idempotent");
    const recovered = await getProbeContinuation<typeof payload>(
      redis,
      { jti, stage, artifactSecret },
      keyspace
    );
    if (!recovered || canonicalJson(recovered.payload) !== canonicalJson(payload)) {
      throw new Error("continuation_recovery_mismatch");
    }
  }

  const armed = await armProbeOperator(
    redis,
    {
      activationHash,
      buildCommit,
      actorHash
    },
    runIndexKeyspace
  );
  if (armed.disposition !== "new") throw new Error("operator_arm_not_new");
  const armedReplay = await armProbeOperator(
    redis,
    {
      activationHash,
      buildCommit,
      actorHash
    },
    runIndexKeyspace
  );
  if (
    armedReplay.disposition !== "existing" ||
    armedReplay.armedAtMs !== armed.armedAtMs ||
    armedReplay.expiresAtMs !== armed.expiresAtMs
  ) {
    throw new Error("operator_arm_not_fixed_idempotent");
  }
  await assertProbeOperatorArmed(
    redis,
    { activationHash, buildCommit, actorHash },
    runIndexKeyspace
  );

  const recovery = runRecovery({ activationHash, launchHash });
  let runIndex = await putProbeRunIndex(
    redis,
    {
      recovery,
      continuation: `tpse1.integration.${testId}.0.${"x".repeat(32)}`,
      artifactSecret
    },
    runIndexKeyspace
  );
  if (runIndex.disposition !== "new" || runIndex.nextOrdinal !== 0) {
    throw new Error("run_index_not_new");
  }
  const recoveredRunIndex = await getProbeRunIndex(
    redis,
    { recovery, artifactSecret },
    runIndexKeyspace
  );
  if (
    !recoveredRunIndex ||
    recoveredRunIndex.payload.continuation !== runIndex.payload.continuation
  ) {
    throw new Error("run_index_recovery_mismatch");
  }
  const byLaunch = await getProbeRunIndexByLaunch(
    redis,
    { activationHash, buildCommit, actorHash, launchHash, artifactSecret },
    runIndexKeyspace
  );
  if (!byLaunch || byLaunch.index.payload.continuation !== runIndex.payload.continuation) {
    throw new Error("run_index_launch_recovery_mismatch");
  }
  for (let ordinal = 0; ordinal < 4; ordinal += 1) {
    const documentId = `document_integration_${testId}_${ordinal}`;
    const owner = await claimProbeRunDocument(
      redis,
      { recovery, documentId, artifactSecret },
      runIndexKeyspace
    );
    if (owner.disposition !== "new" || owner.revision !== ordinal) {
      throw new Error("run_index_owner_claim_mismatch");
    }
    if (
      (await assertProbeRunDocumentOwner(
        redis,
        { recovery, documentId, artifactSecret },
        runIndexKeyspace
      )) !== ordinal
    ) {
      throw new Error("run_index_owner_assertion_mismatch");
    }
    runIndex = await advanceProbeRunIndex(
      redis,
      {
        recovery,
        current: runIndex,
        continuation: `tpse1.integration.${testId}.${ordinal + 1}.${"y".repeat(32)}`,
        documentId,
        artifactSecret
      },
      runIndexKeyspace
    );
  }
  if (!runIndex.payload.terminal || runIndex.nextOrdinal !== 4) {
    throw new Error("run_index_not_terminal");
  }
  const resultsDocumentId = `document_integration_${testId}_results`;
  await claimProbeRunDocument(
    redis,
    { recovery, documentId: resultsDocumentId, artifactSecret },
    runIndexKeyspace
  );
  await seedGuard(9, terminalGuardKeys);
  const terminalBinding = terminalProbeRunIndexPayloadBinding({
    recovery,
    continuation: runIndex.payload.continuation,
    artifactSecret
  });
  const acknowledgeInput = {
    recovery,
    documentId: resultsDocumentId,
    payloadBinding: terminalBinding,
    artifactSecret,
    guard: {
      ...terminalGuardKeys,
      guardInstanceId,
      policyHash,
      scriptHash,
      initializedCommit,
      terminalCalibrationCalls: 9
    }
  } as const;
  if (
    (await acknowledgeProbeRunIndex(redis, acknowledgeInput, runIndexKeyspace)) !== "new" ||
    (await acknowledgeProbeRunIndex(redis, acknowledgeInput, runIndexKeyspace)) !== "existing"
  ) {
    throw new Error("run_index_acknowledgement_mismatch");
  }

  const cleanupRecovery = runRecovery({
    activationHash: cleanupActivationHash,
    launchHash: cleanupLaunchHash
  });
  await putProbeRunIndex(
    redis,
    {
      recovery: cleanupRecovery,
      continuation: `tpse1.integration.${testId}.cleanup.${"z".repeat(32)}`,
      artifactSecret
    },
    cleanupRunIndexKeyspace
  );
  await seedGuard(5, cleanupGuardKeys);
  const cleanupAuthorizationKey = `${cleanupGuardKeys.configKey.replace(/:config$/u, "")}:auth:${cleanupJti}`;
  if (
    (await deleteUnstartedProbeRunIndex(
      redis,
      {
        recovery: cleanupRecovery,
        artifactSecret,
        guard: {
          ...cleanupGuardKeys,
          guardInstanceId,
          policyHash,
          scriptHash,
          initializedCommit,
          baseCalibrationCalls: 5,
          authorizationKey: cleanupAuthorizationKey,
          jti: cleanupJti
        }
      },
      cleanupRunIndexKeyspace
    )) !== "deleted"
  ) {
    throw new Error("run_index_pregrant_cleanup_mismatch");
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      mode: "probe-continuation-integration",
      stages: PROBE_CONTINUATION_STAGES.length,
      encrypted: true,
      idempotent: true,
      runIndex: true,
      documentOwnership: true,
      fixedOperatorDeadline: true,
      terminalAcknowledgement: true,
      pregrantCleanup: true
    })}\n`
  );
} finally {
  const cleanupKeys = [...keys, ...runKeys];
  if (cleanupKeys.length > 0) await redis.unlink(...cleanupKeys);
  if (cleanupKeys.length > 0 && (await redis.exists(...cleanupKeys)) !== 0) {
    throw new Error("continuation_cleanup_failed");
  }
}
