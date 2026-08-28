import { randomBytes } from "node:crypto";

import { createProbeRedis } from "../lib/probe/ledger";
import {
  SCORED_RUN_ATTEMPT_VERSION,
  SCORED_RUN_CASE_COUNT,
  acknowledgeScoredRun,
  acquireScoredRunOwner,
  createScoredRun,
  createScoredRunIdentity,
  createScoredRunKeyspace,
  readScoredRun,
  readPermanentScoredRun,
  readScoredRunProgress,
  recordScoredRunAttempt,
  scoredRunKeys,
  scoredRunEvidenceKey,
  sealScoredRunEvidence,
  type ScoredRunAttempt
} from "../lib/scored/run-store.server";

const redis = createProbeRedis();
const integrationId = randomBytes(8).toString("hex");
const keyspace = createScoredRunKeyspace(`tp:{webmcp26}:scored-run:integration_${integrationId}`);
const artifactSecret = randomBytes(32).toString("base64url");
const documentId = `document_${randomBytes(16).toString("base64url")}`;
const identity = await createScoredRunIdentity({
  phase: "baseline",
  appCommit: "a".repeat(40),
  reviewPackageHash: "1".repeat(64),
  frozenProtocolHash: "2".repeat(64),
  freezeCandidateHash: "3".repeat(64),
  runId: `run_${randomBytes(16).toString("base64url")}`,
  actorHash: "4".repeat(64),
  phaseCallOffset: 0,
  repairPhaseCallOffset: 0,
  predecessorProtocolHash: null,
  predecessorEvidenceDigest: null,
  predecessorRunId: null,
  predecessorDisposition: null,
  orderedRunnerCaseIds: Array.from(
    { length: SCORED_RUN_CASE_COUNT },
    (_, index) => `case_${String(index).padStart(22, "0")}`
  )
});
const keys = [
  ...scoredRunKeys(keyspace, identity.phase, identity.frozenProtocolHash, identity.runId),
  scoredRunEvidenceKey(keyspace, identity.phase, identity.frozenProtocolHash, identity.runId)
];

function attempt(input: {
  readonly ordinal: number;
  readonly attempt?: 0 | 1;
  readonly disposition?: "scored" | "infrastructure-invalid";
  readonly retryEligible?: boolean;
}): ScoredRunAttempt {
  const disposition = input.disposition ?? "scored";
  return {
    version: SCORED_RUN_ATTEMPT_VERSION,
    ordinal: input.ordinal,
    attempt: input.attempt ?? 0,
    runnerCaseId: identity.orderedRunnerCaseIds[input.ordinal]!,
    disposition,
    infrastructureRetryEligible: input.retryEligible ?? false,
    usableModelDecisionMade: disposition === "scored",
    targetExecutionMade: disposition === "scored",
    capturedAt: new Date().toISOString(),
    evidence: {
      synthetic: true,
      integrationId,
      ordinal: input.ordinal,
      attempt: input.attempt ?? 0
    }
  };
}

try {
  const created = await createScoredRun(
    redis,
    { identity, documentId, artifactSecret, createdAt: new Date().toISOString() },
    keyspace
  );
  const replay = await createScoredRun(
    redis,
    { identity, documentId, artifactSecret, createdAt: new Date().toISOString() },
    keyspace
  );
  if (created.disposition !== "new" || replay.disposition !== "existing") {
    throw new Error("scored_run_create_idempotency_failed");
  }
  const renewed = await acquireScoredRunOwner(
    redis,
    { identity, documentId, artifactSecret },
    keyspace
  );
  if (renewed.disposition !== "renewed") {
    throw new Error("scored_run_owner_renewal_failed");
  }

  const retry = await recordScoredRunAttempt(
    redis,
    {
      identity,
      documentId,
      artifactSecret,
      attempt: attempt({
        ordinal: 0,
        disposition: "infrastructure-invalid",
        retryEligible: true
      })
    },
    keyspace
  );
  if (
    retry.status !== "active" ||
    retry.currentOrdinal !== 0 ||
    retry.currentAttempt !== 1 ||
    retry.completedCount !== 0
  ) {
    throw new Error("scored_run_retry_admission_failed");
  }
  await recordScoredRunAttempt(
    redis,
    {
      identity,
      documentId,
      artifactSecret,
      attempt: attempt({ ordinal: 0, attempt: 1 })
    },
    keyspace
  );
  for (let ordinal = 1; ordinal < SCORED_RUN_CASE_COUNT; ordinal += 1) {
    await recordScoredRunAttempt(
      redis,
      { identity, documentId, artifactSecret, attempt: attempt({ ordinal }) },
      keyspace
    );
  }

  const terminal = await readScoredRun(redis, { identity, artifactSecret }, keyspace);
  if (
    !terminal ||
    terminal.status !== "terminal-complete" ||
    terminal.completedCount !== SCORED_RUN_CASE_COUNT ||
    terminal.attemptCount !== SCORED_RUN_CASE_COUNT + 1 ||
    terminal.transportFailureCount !== 1 ||
    terminal.attempts.length !== SCORED_RUN_CASE_COUNT + 1
  ) {
    throw new Error("scored_run_terminal_recovery_failed");
  }
  const evidenceDigest = "e".repeat(64);
  if (
    (await sealScoredRunEvidence(
      redis,
      {
        identity,
        evidenceDigest,
        attemptManifestDigest: "d".repeat(64),
        attemptCount: SCORED_RUN_CASE_COUNT + 1
      },
      keyspace
    )) !== "new"
  ) {
    throw new Error("scored_run_evidence_seal_failed");
  }
  if (
    (await acknowledgeScoredRun(redis, { identity, evidenceDigest }, keyspace)) !== "new" ||
    (await acknowledgeScoredRun(redis, { identity, evidenceDigest }, keyspace)) !== "existing"
  ) {
    throw new Error("scored_run_acknowledgement_failed");
  }
  const acknowledged = await readScoredRunProgress(
    redis,
    {
      phase: identity.phase,
      frozenProtocolHash: identity.frozenProtocolHash,
      runId: identity.runId
    },
    keyspace
  );
  if (
    acknowledged?.status !== "acknowledged" ||
    acknowledged.evidenceDigest !== evidenceDigest ||
    acknowledged.completedCount !== SCORED_RUN_CASE_COUNT
  ) {
    throw new Error("scored_run_anchor_retention_failed");
  }
  const permanent = await readPermanentScoredRun(redis, { identity, artifactSecret }, keyspace);
  if (
    !permanent ||
    permanent.status !== "acknowledged" ||
    permanent.attempts.length !== SCORED_RUN_CASE_COUNT + 1 ||
    permanent.evidenceDigest !== evidenceDigest
  ) {
    throw new Error("scored_run_permanent_evidence_failed");
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      mode: "scored-run-store-integration",
      scheduleCases: SCORED_RUN_CASE_COUNT,
      encryptedAttempts: SCORED_RUN_CASE_COUNT + 1,
      onePreDecisionReplacement: true,
      terminalRecovery: true,
      acknowledgementDeletesDataOnly: true,
      permanentDigestAnchor: true,
      permanentEncryptedEvidence: true
    })}\n`
  );
} finally {
  await redis.unlink(...keys);
  if ((await redis.exists(...keys)) !== 0) {
    throw new Error("scored_run_integration_cleanup_failed");
  }
}
