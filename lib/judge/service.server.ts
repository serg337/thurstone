import "server-only";

import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import {
  captureJudgeDemoAuthorizationAnchor,
  readJudgeDemoAuthorizationAnchor,
  type JudgeDemoAuthorizationArtifact,
  type JudgeDemoAuthorizationKeyspace,
  type JudgeDemoAuthorizationRedis
} from "@/lib/judge/authorization-anchor.server";
import {
  JUDGE_DEMO_API_VERSION,
  JUDGE_DEMO_LANE,
  judgeDemoDecisionResponseSchema,
  judgeDemoProjectionSchema,
  judgeDemoStatusSchema,
  type JudgeDemoDecisionResponse,
  type JudgeDemoProjection,
  type JudgeDemoStatus
} from "@/lib/judge/contract";
import { readJudgeDemoDispatchState } from "@/lib/judge/dispatch-recovery.server";
import { createJudgeDemoEnvelope, type JudgeDemoEnvelope } from "@/lib/judge/envelope";
import {
  JudgeDemoProviderError,
  decideJudgeDemoWithOpenAi,
  verifyJudgeDemoProviderKnownReceipt,
  type DecideJudgeDemoInput,
  type JudgeDemoProviderKnownReceipt
} from "@/lib/judge/openai-provider.server";
import {
  JUDGE_DEMO_GIT_PACK_ENV,
  JUDGE_DEMO_PRESENTATION_BINDING_ENV,
  JUDGE_DEMO_PRESENTATION_BINDING_HASH_ENV,
  JUDGE_DEMO_PRESENTATION_MODE_ENV,
  configuredJudgeDemoPresentationBinding,
  publicJudgeDemoPresentationBinding,
  type JudgeDemoPresentationMode
} from "@/lib/judge/presentation-binding.server";
import {
  JUDGE_DEMO_RECEIPT_ARTIFACT_VERSION,
  JUDGE_DEMO_UNCERTAIN_ARTIFACT_VERSION,
  captureJudgeDemoReceipt,
  readJudgeDemoStore,
  recordJudgeDemoUncertain,
  sealJudgeDemoReceipt,
  type JudgeDemoReceiptArtifact,
  type JudgeDemoStoreKeyspace,
  type JudgeDemoStoreRedis
} from "@/lib/judge/store.server";
import {
  beginProbeCall,
  createProbeRedis,
  issueProbeAuthorization,
  probeLedgerScriptHash,
  readProbeGuardStatus,
  reapExpiredProbeCall,
  settleProbeCallKnown,
  settleProbeCallUncertain,
  type ProbeGuardIdentity,
  type ProbeGuardStatus,
  type ProbeRedisClient,
  ProbeLedgerError
} from "@/lib/probe/ledger";
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
import { deriveProbeActorHash } from "@/lib/probe/session";
import { isValidProbeSigningSecret } from "@/lib/probe/signing-secret";
import { createProbeToken, type SignedProbeToken } from "@/lib/probe/token";

export const JUDGE_DEMO_ACTIVATION_VERSION = "toolproof-judge-demo-activation@1.0.0";

export const JUDGE_DEMO_REQUIRED_PRIMARY_COUNTS = Object.freeze({
  calibration: 17,
  baseline: 48,
  repair: 2,
  revised: 24
});

type EnvironmentLike = Readonly<Record<string, string | undefined>>;

export class JudgeDemoServiceError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly inferencePerformed = false
  ) {
    super(code);
    this.name = "JudgeDemoServiceError";
  }
}

export interface JudgeDemoServiceDependencies {
  readonly environment?: EnvironmentLike;
  readonly redis?: ProbeRedisClient & JudgeDemoStoreRedis & JudgeDemoAuthorizationRedis;
  readonly storeKeyspace?: JudgeDemoStoreKeyspace;
  readonly authorizationKeyspace?: JudgeDemoAuthorizationKeyspace;
  readonly decide?: (input: DecideJudgeDemoInput) => Promise<JudgeDemoProviderKnownReceipt>;
  readonly nowMs?: () => number;
  readonly createToken?: (
    input: Parameters<typeof createProbeToken>[0],
    secret: string
  ) => SignedProbeToken;
}

interface JudgeDemoActivation {
  readonly environment: EnvironmentLike;
  readonly redis: ProbeRedisClient & JudgeDemoStoreRedis & JudgeDemoAuthorizationRedis;
  readonly storeKeyspace?: JudgeDemoStoreKeyspace;
  readonly authorizationKeyspace?: JudgeDemoAuthorizationKeyspace;
  readonly appCommit: string;
  readonly expectedProject: string;
  readonly presentationMode: JudgeDemoPresentationMode;
  readonly artifactSecret: string;
  readonly apiKey: string;
  readonly identity: ProbeGuardIdentity;
  readonly envelope: JudgeDemoEnvelope;
  readonly activationHash: string;
}

function nowOf(dependencies: JudgeDemoServiceDependencies): number {
  return (dependencies.nowMs ?? Date.now)();
}

function required(environment: EnvironmentLike, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new JudgeDemoServiceError("judge_demo_configuration_missing", 503);
  return value;
}

async function judgeDemoActivationHash(input: {
  readonly appCommit: string;
  readonly expectedProject: string;
  readonly identity: ProbeGuardIdentity;
  readonly envelope: JudgeDemoEnvelope;
}): Promise<string> {
  return canonicalSha256({
    version: JUDGE_DEMO_ACTIVATION_VERSION,
    appCommit: input.appCommit,
    expectedProject: input.expectedProject,
    guard: input.identity,
    envelopeHash: input.envelope.envelopeHash,
    runnerHash: input.envelope.runnerHash
  });
}

function presentationConfigured(environment: EnvironmentLike): boolean {
  return Boolean(
    environment[JUDGE_DEMO_PRESENTATION_BINDING_ENV]?.trim() ||
    environment[JUDGE_DEMO_PRESENTATION_BINDING_HASH_ENV]?.trim()
  );
}

async function activation(
  dependencies: JudgeDemoServiceDependencies
): Promise<JudgeDemoActivation> {
  const environment = dependencies.environment ?? process.env;
  if (environment.TOOLPROOF_JUDGE_LANE_MODE !== "enabled") {
    throw new JudgeDemoServiceError("judge_demo_disabled", 503);
  }
  const presentationMode = environment[JUDGE_DEMO_PRESENTATION_MODE_ENV]?.trim();
  if (presentationMode !== "predecessor" && presentationMode !== "successor") {
    throw new JudgeDemoServiceError("judge_demo_presentation_mode_invalid", 503);
  }
  const bindingConfigured = presentationConfigured(environment);
  const gitPackConfigured = Boolean(environment[JUDGE_DEMO_GIT_PACK_ENV]?.trim());
  if (
    (presentationMode === "predecessor" && (bindingConfigured || gitPackConfigured)) ||
    (presentationMode === "successor" && !bindingConfigured)
  ) {
    throw new JudgeDemoServiceError("judge_demo_presentation_mode_configuration_invalid", 503);
  }
  if (
    environment.VERCEL !== "1" ||
    environment.VERCEL_ENV !== "production" ||
    environment.NODE_ENV !== "production"
  ) {
    throw new JudgeDemoServiceError("judge_demo_environment_mismatch", 503);
  }
  const expectedProject = required(environment, "TOOLPROOF_EXPECTED_VERCEL_PROJECT_ID");
  if (
    !/^[A-Za-z0-9_-]{8,128}$/u.test(expectedProject) ||
    environment.VERCEL_PROJECT_ID !== expectedProject
  ) {
    throw new JudgeDemoServiceError("judge_demo_project_mismatch", 503);
  }
  const appCommit = required(environment, "TOOLPROOF_JUDGE_ACTIVE_COMMIT");
  if (
    !/^[a-f0-9]{40}$/u.test(appCommit) ||
    environment.VERCEL_GIT_COMMIT_SHA !== appCommit ||
    environment.TOOLPROOF_COMMIT_SHA !== appCommit
  ) {
    throw new JudgeDemoServiceError("judge_demo_commit_mismatch", 503);
  }
  const artifactSecret = required(environment, "TOOLPROOF_SIGNING_SECRET");
  if (!isValidProbeSigningSecret(artifactSecret)) {
    throw new JudgeDemoServiceError("judge_demo_signing_secret_invalid", 503);
  }
  const apiKey = required(environment, "OPENAI_API_KEY");
  const identity = Object.freeze({
    guardInstanceId: required(environment, "TOOLPROOF_GUARD_INSTANCE_ID"),
    policyHash: await probePolicyHash(),
    scriptHash: await probeLedgerScriptHash(),
    initializedCommit: required(environment, "TOOLPROOF_GUARD_INITIALIZED_COMMIT")
  });
  if (
    !/^[A-Za-z0-9_-]{16,128}$/u.test(identity.guardInstanceId) ||
    !/^[a-f0-9]{40}$/u.test(identity.initializedCommit)
  ) {
    throw new JudgeDemoServiceError("judge_demo_guard_identity_invalid", 503);
  }
  const envelope = await createJudgeDemoEnvelope(appCommit);
  const activationHash = await judgeDemoActivationHash({
    appCommit,
    expectedProject,
    identity,
    envelope
  });
  const redis =
    dependencies.redis ??
    (createProbeRedis(environment as NodeJS.ProcessEnv) as ProbeRedisClient &
      JudgeDemoStoreRedis &
      JudgeDemoAuthorizationRedis);
  return Object.freeze({
    environment,
    redis,
    ...(dependencies.storeKeyspace ? { storeKeyspace: dependencies.storeKeyspace } : {}),
    ...(dependencies.authorizationKeyspace
      ? { authorizationKeyspace: dependencies.authorizationKeyspace }
      : {}),
    appCommit,
    expectedProject,
    presentationMode,
    artifactSecret,
    apiKey,
    identity,
    envelope,
    activationHash
  });
}

function primaryCountsMatch(status: ProbeGuardStatus): boolean {
  return (
    status.purposeCounts.calibration === JUDGE_DEMO_REQUIRED_PRIMARY_COUNTS.calibration &&
    status.purposeCounts.baseline === JUDGE_DEMO_REQUIRED_PRIMARY_COUNTS.baseline &&
    status.purposeCounts.repair === JUDGE_DEMO_REQUIRED_PRIMARY_COUNTS.repair &&
    status.purposeCounts.revised === JUDGE_DEMO_REQUIRED_PRIMARY_COUNTS.revised
  );
}

function staticGuardMatches(status: ProbeGuardStatus, identity: ProbeGuardIdentity): boolean {
  const purposeSum = Object.values(status.purposeCounts).reduce((sum, value) => sum + value, 0);
  return (
    status.guardInstanceId === identity.guardInstanceId &&
    status.policyHash === identity.policyHash &&
    status.scriptHash === identity.scriptHash &&
    status.initializedCommit === identity.initializedCommit &&
    status.policyVersion === PROBE_POLICY_VERSION &&
    status.model === PROBE_MODEL &&
    status.globalCallLimit === PROBE_GLOBAL_CALL_LIMIT &&
    status.spendCeilingNanoUsd === PROBE_LIFETIME_SPEND_CEILING_NANO_USD &&
    status.perCallReservationNanoUsd === PROBE_PER_CALL_RESERVATION_NANO_USD &&
    status.maxConcurrency === PROBE_MAX_CONCURRENCY &&
    status.challengeClosesAtMs === Date.parse(PROBE_CHALLENGE_CLOSES_AT) &&
    Object.entries(PROBE_PURPOSE_CALL_LIMITS).every(
      ([purpose, limit]) =>
        status.purposeLimits[purpose as keyof typeof PROBE_PURPOSE_CALL_LIMITS] === limit
    ) &&
    primaryCountsMatch(status) &&
    (status.purposeCounts.judge === 0 || status.purposeCounts.judge === 1) &&
    purposeSum === status.claimedCalls &&
    status.pendingCount + status.knownCount + status.uncertainCount === status.claimedCalls &&
    status.committedNanoUsd === status.claimedCalls * PROBE_PER_CALL_RESERVATION_NANO_USD &&
    status.committedNanoUsd <= PROBE_LIFETIME_SPEND_CEILING_NANO_USD &&
    status.knownActualNanoUsd <= status.knownCount * PROBE_PER_CALL_RESERVATION_NANO_USD &&
    status.uncertainUpperNanoUsd === status.uncertainCount * PROBE_PER_CALL_RESERVATION_NANO_USD &&
    status.inflightCount === status.pendingCount &&
    status.sequence === status.claimedCalls &&
    !status.haltMarkerPresent
  );
}

function guardMode(status: ProbeGuardStatus, identity: ProbeGuardIdentity) {
  if (!staticGuardMatches(status, identity)) return "invalid" as const;
  if (
    status.status === "open" &&
    status.purposeCounts.judge === 0 &&
    status.pendingCount === 0 &&
    status.uncertainCount === 0 &&
    status.knownCount === status.claimedCalls &&
    !status.uncertainMarkerPresent
  ) {
    return "available" as const;
  }
  if (
    status.status === "open" &&
    status.purposeCounts.judge === 1 &&
    status.pendingCount === 1 &&
    status.inflightCount === 1 &&
    status.uncertainCount === 0 &&
    status.knownCount === status.claimedCalls - 1 &&
    !status.uncertainMarkerPresent
  ) {
    return "running" as const;
  }
  if (
    status.status === "open" &&
    status.purposeCounts.judge === 1 &&
    status.pendingCount === 0 &&
    status.uncertainCount === 0 &&
    status.knownCount === status.claimedCalls &&
    !status.uncertainMarkerPresent
  ) {
    return "known" as const;
  }
  if (
    status.status === "quarantined" &&
    status.purposeCounts.judge === 1 &&
    status.pendingCount === 0 &&
    status.uncertainCount === 1 &&
    status.uncertainMarkerPresent
  ) {
    return "uncertain" as const;
  }
  return "invalid" as const;
}

function statusReceipt(input: {
  readonly status: JudgeDemoStatus["status"];
  readonly remainingModelCalls: 0 | 1;
  readonly reason: string;
  readonly projection?: JudgeDemoProjection | null;
}): JudgeDemoStatus {
  return judgeDemoStatusSchema.parse({
    version: JUDGE_DEMO_API_VERSION,
    lane: JUDGE_DEMO_LANE,
    status: input.status,
    sourceFixed: true,
    arbitraryPromptAccepted: false,
    remainingModelCalls: input.remainingModelCalls,
    inferencePerformed: false,
    reason: input.reason,
    projection: input.projection ?? null
  });
}

async function settlementPayload(artifact: Omit<JudgeDemoReceiptArtifact, "settlement">) {
  return {
    version: "toolproof-judge-demo-known-settlement@1.0.0",
    authorizationJti: artifact.authorization.claims.jti,
    envelopeHash: artifact.envelope.envelopeHash,
    providerResponseHash: artifact.providerReceipt.rawResponseHash,
    usageHash: artifact.providerReceipt.usageHash,
    actualNanoUsd: artifact.providerReceipt.usage.accountedNanoUsd
  } as const;
}

async function projectionFor(input: {
  readonly envelope: JudgeDemoEnvelope;
  readonly receipt: JudgeDemoProviderKnownReceipt;
  readonly capturedAt: string;
}): Promise<JudgeDemoProjection> {
  const payload = {
    version: "toolproof-judge-demo-public-receipt@1.0.0" as const,
    lane: JUDGE_DEMO_LANE,
    evidenceClass: "non-scored-model-selection" as const,
    sourceFixed: true as const,
    arbitraryPromptAccepted: false as const,
    globalProviderCall: 1 as const,
    nativeExecutionIncluded: false as const,
    replayPolicy: "archived-decision-may-be-executed-locally-without-model-call" as const,
    appCommit: input.envelope.buildCommit,
    evidenceAppCommit: input.envelope.buildCommit,
    caseId: input.envelope.publicCaseId,
    naturalLanguageRequest: input.envelope.naturalLanguageRequest,
    fixtureHash: input.envelope.fixtureHash,
    manifestHash: input.envelope.liveManifest.manifestHash,
    evidenceManifestHash: input.envelope.liveManifest.manifestHash,
    envelopeHash: input.envelope.envelopeHash,
    runnerHash: input.envelope.runnerHash,
    provider: "OpenAI" as const,
    model: PROBE_MODEL,
    providerResponseHash: input.receipt.rawResponseHash,
    requestBodyHash: input.receipt.requestBodyHash,
    usageHash: input.receipt.usageHash,
    usage: input.receipt.usage,
    decision: input.receipt.decision,
    decisionError: input.receipt.decisionError,
    responseStatus: input.receipt.responseStatus,
    capturedAt: input.capturedAt,
    presentationBinding: null
  };
  return judgeDemoProjectionSchema.parse({
    ...payload,
    receiptDigest: await canonicalSha256(payload)
  });
}

interface VerifiedStoredArtifact {
  readonly artifact: JudgeDemoReceiptArtifact;
  readonly projection: JudgeDemoProjection;
}

async function presentedProjection(input: {
  readonly active: JudgeDemoActivation;
  readonly artifact: JudgeDemoReceiptArtifact;
  readonly baseProjection: JudgeDemoProjection;
}): Promise<JudgeDemoProjection> {
  if (input.artifact.appCommit === input.active.appCommit) {
    if (input.active.presentationMode !== "predecessor") {
      throw new JudgeDemoServiceError("judge_demo_presentation_not_successor", 503, false);
    }
    if (canonicalJson(input.artifact.envelope) !== canonicalJson(input.active.envelope)) {
      throw new JudgeDemoServiceError("judge_demo_permanent_receipt_mismatch", 503, true);
    }
    return input.baseProjection;
  }
  if (input.active.presentationMode !== "successor") {
    throw new JudgeDemoServiceError("judge_demo_presentation_successor_required", 503, false);
  }
  const binding = await configuredJudgeDemoPresentationBinding({
    environment: input.active.environment,
    predecessorEnvelope: input.artifact.envelope,
    successorEnvelope: input.active.envelope,
    predecessorReceiptDigest: input.baseProjection.receiptDigest
  });
  const base = { ...input.baseProjection };
  delete (base as Partial<JudgeDemoProjection>).receiptDigest;
  const payload = {
    ...base,
    appCommit: input.active.appCommit,
    manifestHash: input.active.envelope.liveManifest.manifestHash,
    presentationBinding: publicJudgeDemoPresentationBinding(binding)
  };
  return judgeDemoProjectionSchema.parse({
    ...payload,
    receiptDigest: await canonicalSha256(payload)
  });
}

async function verifyStoredArtifact(
  active: JudgeDemoActivation,
  artifact: JudgeDemoReceiptArtifact,
  projection: JudgeDemoProjection
): Promise<VerifiedStoredArtifact> {
  const expectedEnvelope = await createJudgeDemoEnvelope(artifact.appCommit);
  const expectedActivationHash = await judgeDemoActivationHash({
    appCommit: artifact.appCommit,
    expectedProject: active.expectedProject,
    identity: active.identity,
    envelope: expectedEnvelope
  });
  const providerReceipt = await verifyJudgeDemoProviderKnownReceipt({
    receipt: artifact.providerReceipt,
    envelope: artifact.envelope
  });
  const claimsHash = await canonicalSha256(artifact.authorization.claims);
  const settlement = await settlementPayload({ ...artifact, providerReceipt });
  const settlementDigest = await canonicalSha256(settlement);
  const rebuiltProjection = await projectionFor({
    envelope: artifact.envelope,
    receipt: providerReceipt,
    capturedAt: artifact.capturedAt
  });
  if (
    artifact.activationHash !== expectedActivationHash ||
    canonicalJson(artifact.envelope) !== canonicalJson(expectedEnvelope) ||
    artifact.authorization.claims.purpose !== "judge" ||
    artifact.authorization.claims.activationHash !== expectedActivationHash ||
    artifact.authorization.claims.buildCommit !== artifact.appCommit ||
    artifact.authorization.claims.policyHash !== active.identity.policyHash ||
    artifact.authorization.claims.guardInstanceId !== active.identity.guardInstanceId ||
    artifact.authorization.claims.model !== PROBE_MODEL ||
    artifact.authorization.claims.runId !== artifact.envelope.runId ||
    artifact.authorization.claims.caseId !== artifact.envelope.caseId ||
    artifact.authorization.claims.trialId !== artifact.envelope.trialId ||
    artifact.authorization.claims.fixtureHash !== artifact.envelope.fixtureHash ||
    artifact.authorization.claims.requestHash !==
      (await sha256Hex(artifact.envelope.naturalLanguageRequest)) ||
    artifact.authorization.claims.manifestHash !== artifact.envelope.liveManifest.manifestHash ||
    artifact.authorization.claims.settingsHash !== artifact.envelope.runner.settingsHash ||
    artifact.authorization.claims.envelopeHash !== artifact.envelope.envelopeHash ||
    artifact.authorization.claimsHash !== claimsHash ||
    artifact.settlement.settlementDigest !== settlementDigest ||
    artifact.settlement.actualNanoUsd !== settlement.actualNanoUsd ||
    artifact.settlement.providerResponseHash !== settlement.providerResponseHash ||
    artifact.settlement.usageHash !== settlement.usageHash ||
    canonicalJson(projection) !== canonicalJson(rebuiltProjection)
  ) {
    throw new JudgeDemoServiceError("judge_demo_permanent_receipt_mismatch", 503, true);
  }
  const verifiedArtifact = Object.freeze({ ...artifact, providerReceipt });
  return Object.freeze({
    artifact: verifiedArtifact,
    projection: await presentedProjection({
      active,
      artifact: verifiedArtifact,
      baseProjection: projection
    })
  });
}

async function settleAndSealCaptured(
  active: JudgeDemoActivation,
  stored: Extract<Awaited<ReturnType<typeof readJudgeDemoStore>>, { state: "captured" | "sealed" }>,
  dependencies: JudgeDemoServiceDependencies
): Promise<JudgeDemoProjection> {
  const verified = await verifyStoredArtifact(active, stored.artifact, stored.projection);
  const artifact = verified.artifact;
  if (stored.state === "captured") {
    await settleProbeCallKnown(active.redis, {
      ...active.identity,
      jti: artifact.authorization.claims.jti,
      ...artifact.settlement,
      settledAtMs: nowOf(dependencies)
    });
    await sealJudgeDemoReceipt(active.redis, {
      appCommit: artifact.appCommit,
      artifactDigest: stored.artifactDigest,
      sealedAtMs: nowOf(dependencies),
      ...(active.storeKeyspace ? { keyspace: active.storeKeyspace } : {})
    });
  }
  const guard = await readProbeGuardStatus(active.redis);
  if (guardMode(guard, active.identity) !== "known") {
    throw new JudgeDemoServiceError("judge_demo_settlement_not_verified", 503, true);
  }
  return verified.projection;
}

async function recordOrphanedUncertain(input: {
  readonly active: JudgeDemoActivation;
  readonly jti: string;
  readonly settlementDigest: string;
  readonly code: string;
  readonly capturedAtMs: number;
}): Promise<void> {
  await recordJudgeDemoUncertain(input.active.redis, {
    artifact: {
      version: JUDGE_DEMO_UNCERTAIN_ARTIFACT_VERSION,
      activationHash: input.active.activationHash,
      appCommit: input.active.appCommit,
      envelopeHash: input.active.envelope.envelopeHash,
      authorizationJti: input.jti,
      code: input.code,
      rawResponseBytes: null,
      settlementDigest: input.settlementDigest,
      capturedAt: new Date(input.capturedAtMs).toISOString()
    },
    artifactSecret: input.active.artifactSecret,
    capturedAtMs: input.capturedAtMs,
    ...(input.active.storeKeyspace ? { keyspace: input.active.storeKeyspace } : {})
  });
}

async function reconcileEmptyOrphanedDispatch(
  active: JudgeDemoActivation,
  guard: ProbeGuardStatus,
  dependencies: JudgeDemoServiceDependencies
): Promise<"running" | "uncertain"> {
  const mode = guardMode(guard, active.identity);
  const dispatch = await readJudgeDemoDispatchState(active.redis);
  if (mode === "running") {
    if (dispatch.state !== "inflight") {
      throw new JudgeDemoServiceError("judge_demo_orphan_dispatch_mismatch", 503, true);
    }
    if (dispatch.leaseExpiresAt > Math.floor(nowOf(dependencies) / 1_000)) return "running";
    const settlementDigest = await canonicalSha256({
      version: "toolproof-judge-demo-orphan-reap@1.0.0",
      authorizationJti: dispatch.jti,
      envelopeHash: active.envelope.envelopeHash,
      reason: "hard_interruption_after_dispatch_lease_expired"
    });
    try {
      await reapExpiredProbeCall(active.redis, {
        ...active.identity,
        jti: dispatch.jti,
        settlementDigest
      });
    } catch (error) {
      if (error instanceof ProbeLedgerError && error.code === "LEASE_NOT_EXPIRED") {
        return "running";
      }
      throw error;
    }
    await recordOrphanedUncertain({
      active,
      jti: dispatch.jti,
      settlementDigest,
      code: "hard_interruption_after_dispatch_lease_expired",
      capturedAtMs: nowOf(dependencies)
    });
    const reaped = await readProbeGuardStatus(active.redis);
    if (guardMode(reaped, active.identity) !== "uncertain") {
      throw new JudgeDemoServiceError("judge_demo_orphan_reap_not_verified", 503, true);
    }
    return "uncertain";
  }
  if (mode === "uncertain") {
    if (dispatch.state !== "uncertain") {
      throw new JudgeDemoServiceError("judge_demo_orphan_dispatch_mismatch", 503, true);
    }
    await recordOrphanedUncertain({
      active,
      jti: dispatch.jti,
      settlementDigest: dispatch.settlementDigest,
      code: `hard_interruption_${dispatch.reason}`.slice(0, 160),
      capturedAtMs: dispatch.settledAtMs || nowOf(dependencies)
    });
    return "uncertain";
  }
  throw new JudgeDemoServiceError("judge_demo_orphan_dispatch_mismatch", 503, true);
}

async function reconcileStoredUncertain(
  active: JudgeDemoActivation,
  stored: Extract<Awaited<ReturnType<typeof readJudgeDemoStore>>, { state: "uncertain" }>,
  dependencies: JudgeDemoServiceDependencies
): Promise<"running" | "uncertain"> {
  const guard = await readProbeGuardStatus(active.redis);
  const mode = guardMode(guard, active.identity);
  if (mode === "uncertain") return "uncertain";
  if (mode !== "running") {
    throw new JudgeDemoServiceError("judge_demo_uncertain_guard_mismatch", 503, true);
  }
  const dispatch = await readJudgeDemoDispatchState(active.redis);
  if (dispatch.state !== "inflight" || dispatch.jti !== stored.artifact.authorizationJti) {
    throw new JudgeDemoServiceError("judge_demo_uncertain_guard_mismatch", 503, true);
  }
  if (dispatch.leaseExpiresAt > Math.floor(nowOf(dependencies) / 1_000)) return "running";
  try {
    await reapExpiredProbeCall(active.redis, {
      ...active.identity,
      jti: dispatch.jti,
      settlementDigest: stored.artifact.settlementDigest
    });
  } catch (error) {
    if (error instanceof ProbeLedgerError && error.code === "LEASE_NOT_EXPIRED") return "running";
    throw error;
  }
  const reaped = await readProbeGuardStatus(active.redis);
  if (guardMode(reaped, active.identity) !== "uncertain") {
    throw new JudgeDemoServiceError("judge_demo_orphan_reap_not_verified", 503, true);
  }
  return "uncertain";
}

async function verifyAnchoredAuthorization(
  active: JudgeDemoActivation,
  artifact: JudgeDemoAuthorizationArtifact,
  dependencies: JudgeDemoServiceDependencies
): Promise<JudgeDemoAuthorizationArtifact> {
  const [claimsHash, sessionHash, requestHash, subjectHash] = await Promise.all([
    canonicalSha256(artifact.claims),
    canonicalSha256({
      version: "toolproof-judge-demo-session@1.0.0",
      actorHash: artifact.actorHash,
      activationHash: active.activationHash,
      envelopeHash: active.envelope.envelopeHash
    }),
    sha256Hex(active.envelope.naturalLanguageRequest),
    canonicalSha256({
      version: "toolproof-judge-demo-subject@1.0.0",
      actorHash: artifact.actorHash,
      jti: artifact.claims.jti,
      envelopeHash: active.envelope.envelopeHash
    })
  ]);
  if (
    artifact.activationHash !== active.activationHash ||
    artifact.appCommit !== active.appCommit ||
    artifact.envelopeHash !== active.envelope.envelopeHash ||
    artifact.claimsHash !== claimsHash ||
    artifact.subjectHash !== subjectHash ||
    artifact.claims.policyHash !== active.identity.policyHash ||
    artifact.claims.guardInstanceId !== active.identity.guardInstanceId ||
    artifact.claims.activationHash !== active.activationHash ||
    artifact.claims.sessionHash !== sessionHash ||
    artifact.claims.purpose !== "judge" ||
    artifact.claims.buildCommit !== active.appCommit ||
    artifact.claims.runId !== active.envelope.runId ||
    artifact.claims.caseId !== active.envelope.caseId ||
    artifact.claims.trialId !== active.envelope.trialId ||
    artifact.claims.fixtureHash !== active.envelope.fixtureHash ||
    artifact.claims.requestHash !== requestHash ||
    artifact.claims.manifestHash !== active.envelope.liveManifest.manifestHash ||
    artifact.claims.settingsHash !== active.envelope.runner.settingsHash ||
    artifact.claims.envelopeHash !== active.envelope.envelopeHash
  ) {
    throw new JudgeDemoServiceError("judge_demo_authorization_anchor_mismatch", 503, false);
  }
  if (artifact.claims.expiresAt <= Math.floor(nowOf(dependencies) / 1_000)) {
    throw new JudgeDemoServiceError("judge_demo_authorization_anchor_expired", 409, false);
  }
  return artifact;
}

async function anchoredAuthorization(
  request: Request,
  active: JudgeDemoActivation,
  dependencies: JudgeDemoServiceDependencies
): Promise<JudgeDemoAuthorizationArtifact> {
  const actorHash = deriveProbeActorHash(request, active.artifactSecret);
  const sessionHash = await canonicalSha256({
    version: "toolproof-judge-demo-session@1.0.0",
    actorHash,
    activationHash: active.activationHash,
    envelopeHash: active.envelope.envelopeHash
  });
  const token = (dependencies.createToken ?? createProbeToken)(
    {
      policyHash: active.identity.policyHash,
      guardInstanceId: active.identity.guardInstanceId,
      buildCommit: active.appCommit,
      activationHash: active.activationHash,
      sessionHash,
      purpose: "judge",
      runId: active.envelope.runId,
      caseId: active.envelope.caseId,
      trialId: active.envelope.trialId,
      fixtureHash: active.envelope.fixtureHash,
      requestHash: await sha256Hex(active.envelope.naturalLanguageRequest),
      manifestHash: active.envelope.liveManifest.manifestHash,
      settingsHash: active.envelope.runner.settingsHash,
      envelopeHash: active.envelope.envelopeHash,
      nowMs: nowOf(dependencies)
    },
    active.artifactSecret
  );
  const claimsHash = await canonicalSha256(token.claims);
  const subjectHash = await canonicalSha256({
    version: "toolproof-judge-demo-subject@1.0.0",
    actorHash,
    jti: token.claims.jti,
    envelopeHash: active.envelope.envelopeHash
  });
  const anchored = await captureJudgeDemoAuthorizationAnchor(active.redis, {
    artifact: {
      version: "toolproof-judge-demo-authorization-artifact@1.0.0",
      activationHash: active.activationHash,
      appCommit: active.appCommit,
      envelopeHash: active.envelope.envelopeHash,
      claims: token.claims,
      claimsHash,
      actorHash,
      subjectHash,
      anchoredAt: new Date(nowOf(dependencies)).toISOString()
    },
    artifactSecret: active.artifactSecret,
    ...(active.authorizationKeyspace ? { keyspace: active.authorizationKeyspace } : {})
  });
  return verifyAnchoredAuthorization(active, anchored, dependencies);
}

export async function readJudgeDemoStatus(
  dependencies: JudgeDemoServiceDependencies = {}
): Promise<JudgeDemoStatus> {
  let active: JudgeDemoActivation;
  try {
    active = await activation(dependencies);
  } catch (error) {
    return statusReceipt({
      status: "disabled",
      remainingModelCalls: 0,
      reason:
        error instanceof JudgeDemoServiceError ? error.code : "judge_demo_configuration_invalid"
    });
  }
  try {
    const stored = await readJudgeDemoStore(active.redis, {
      artifactSecret: active.artifactSecret,
      ...(active.storeKeyspace ? { keyspace: active.storeKeyspace } : {})
    });
    if (stored.state === "sealed") {
      const verified = await verifyStoredArtifact(active, stored.artifact, stored.projection);
      const guard = await readProbeGuardStatus(active.redis);
      if (guardMode(guard, active.identity) !== "known") {
        throw new JudgeDemoServiceError("judge_demo_settlement_not_verified", 503, true);
      }
      return statusReceipt({
        status: "sealed",
        remainingModelCalls: 0,
        reason: "The single global model decision is sealed and available for local native replay.",
        projection: verified.projection
      });
    }
    if (stored.state === "captured") {
      const verified = await verifyStoredArtifact(active, stored.artifact, stored.projection);
      return statusReceipt({
        status: "recoverable",
        remainingModelCalls: 0,
        reason:
          "The permanent provider receipt is captured; resume once to finish idempotent settlement without another model call.",
        projection: verified.projection
      });
    }
    if (stored.state === "uncertain") {
      const reconciled = await reconcileStoredUncertain(active, stored, dependencies);
      return statusReceipt({
        status: reconciled,
        remainingModelCalls: 0,
        reason:
          reconciled === "running"
            ? "The single global provider lease is still live; it will never be redispatched."
            : "Provider dispatch is uncertain; the global lane is permanently closed to retry."
      });
    }
    if (presentationConfigured(active.environment)) {
      return statusReceipt({
        status: "unavailable",
        remainingModelCalls: 0,
        reason:
          "Replay-only presentation configuration requires an existing permanent predecessor receipt."
      });
    }
    const guard = await readProbeGuardStatus(active.redis);
    const mode = guardMode(guard, active.identity);
    if (mode === "available") {
      const authorization = await readJudgeDemoAuthorizationAnchor(active.redis, {
        artifactSecret: active.artifactSecret,
        ...(active.authorizationKeyspace ? { keyspace: active.authorizationKeyspace } : {})
      });
      if (authorization) await verifyAnchoredAuthorization(active, authorization, dependencies);
      return statusReceipt({
        status: nowOf(dependencies) >= guard.challengeClosesAtMs ? "closed" : "available",
        remainingModelCalls: nowOf(dependencies) >= guard.challengeClosesAtMs ? 0 : 1,
        reason:
          nowOf(dependencies) >= guard.challengeClosesAtMs
            ? "The challenge-lifetime provider window is closed."
            : "One source-fixed, read-only global model decision remains."
      });
    }
    if (mode === "running") {
      const reconciled = await reconcileEmptyOrphanedDispatch(active, guard, dependencies);
      return statusReceipt({
        status: reconciled,
        remainingModelCalls: 0,
        reason:
          reconciled === "running"
            ? "The single global provider lease is still live; it will never be redispatched."
            : "The expired orphaned dispatch was permanently quarantined without retry."
      });
    }
    if (mode === "uncertain") {
      await reconcileEmptyOrphanedDispatch(active, guard, dependencies);
      return statusReceipt({
        status: "uncertain",
        remainingModelCalls: 0,
        reason: "Provider dispatch is uncertain; the global lane is permanently closed to retry."
      });
    }
    return statusReceipt({
      status: "unavailable",
      remainingModelCalls: 0,
      reason:
        mode === "known"
          ? "The judge allocation is consumed but its permanent receipt is unavailable."
          : "The judge guard does not match the exact frozen primary-evidence boundary."
    });
  } catch {
    return statusReceipt({
      status: "unavailable",
      remainingModelCalls: 0,
      reason: "The permanent judge receipt or lifetime guard could not be verified."
    });
  }
}

export async function decideJudgeDemo(
  request: Request,
  dependencies: JudgeDemoServiceDependencies = {}
): Promise<JudgeDemoDecisionResponse> {
  const active = await activation(dependencies);
  const stored = await readJudgeDemoStore(active.redis, {
    artifactSecret: active.artifactSecret,
    ...(active.storeKeyspace ? { keyspace: active.storeKeyspace } : {})
  });
  if (stored.state === "sealed" || stored.state === "captured") {
    const projection = await settleAndSealCaptured(active, stored, dependencies);
    return judgeDemoDecisionResponseSchema.parse({
      version: JUDGE_DEMO_API_VERSION,
      lane: JUDGE_DEMO_LANE,
      status: "archived",
      inferencePerformed: false,
      projection
    });
  }
  if (stored.state === "uncertain") {
    const reconciled = await reconcileStoredUncertain(active, stored, dependencies);
    throw new JudgeDemoServiceError(
      reconciled === "running" ? "judge_demo_running" : "judge_demo_dispatch_uncertain_no_retry",
      409,
      true
    );
  }
  if (presentationConfigured(active.environment)) {
    throw new JudgeDemoServiceError("judge_demo_replay_predecessor_missing", 409, false);
  }
  const guard = await readProbeGuardStatus(active.redis);
  const mode = guardMode(guard, active.identity);
  if (mode !== "available") {
    const reconciled =
      mode === "running" || mode === "uncertain"
        ? await reconcileEmptyOrphanedDispatch(active, guard, dependencies)
        : mode;
    throw new JudgeDemoServiceError(
      reconciled === "running"
        ? "judge_demo_running"
        : reconciled === "uncertain"
          ? "judge_demo_dispatch_uncertain_no_retry"
          : "judge_demo_unavailable",
      409,
      reconciled === "running" || reconciled === "uncertain"
    );
  }
  if (nowOf(dependencies) >= guard.challengeClosesAtMs) {
    throw new JudgeDemoServiceError("judge_demo_challenge_closed", 410);
  }

  const authorization = await anchoredAuthorization(request, active, dependencies);
  try {
    await issueProbeAuthorization(active.redis, {
      ...active.identity,
      jti: authorization.claims.jti,
      claimsHash: authorization.claimsHash,
      purpose: "judge",
      subjectHash: authorization.subjectHash,
      actorHash: authorization.actorHash
    });
  } catch (error) {
    const issuedGuard = await readProbeGuardStatus(active.redis);
    const issuedMode = guardMode(issuedGuard, active.identity);
    if (issuedMode === "running") {
      const dispatch = await readJudgeDemoDispatchState(active.redis);
      if (dispatch.state === "inflight" && dispatch.jti === authorization.claims.jti) {
        throw new JudgeDemoServiceError("judge_demo_running", 409, true);
      }
    }
    if (issuedMode === "known") {
      throw new JudgeDemoServiceError("judge_demo_receipt_recovery_required", 409, true);
    }
    throw error;
  }

  let dispatchAdmitted = false;
  const decide = dependencies.decide ?? decideJudgeDemoWithOpenAi;
  try {
    const receipt = await decide({
      envelope: active.envelope,
      apiKey: active.apiKey,
      safetyIdentifier: await canonicalSha256({
        version: "toolproof-judge-demo-provider-safety@1.0.0",
        activationHash: active.activationHash,
        actorHash: authorization.actorHash
      }),
      ...(dependencies.nowMs ? { now: dependencies.nowMs } : {}),
      beforeDispatch: async () => {
        try {
          await beginProbeCall(active.redis, {
            ...active.identity,
            jti: authorization.claims.jti,
            claimsHash: authorization.claimsHash,
            purpose: "judge"
          });
          dispatchAdmitted = true;
        } catch (error) {
          const concurrentGuard = await readProbeGuardStatus(active.redis);
          if (guardMode(concurrentGuard, active.identity) === "running") {
            const concurrent = await readJudgeDemoDispatchState(active.redis);
            if (concurrent.state === "inflight" && concurrent.jti === authorization.claims.jti) {
              throw new JudgeDemoServiceError("judge_demo_running", 409, true);
            }
          }
          throw error;
        }
      }
    });
    const capturedAtMs = nowOf(dependencies);
    const capturedAt = new Date(capturedAtMs).toISOString();
    const verifiedReceipt = await verifyJudgeDemoProviderKnownReceipt({
      receipt,
      envelope: active.envelope
    });
    const projection = await projectionFor({
      envelope: active.envelope,
      receipt: verifiedReceipt,
      capturedAt
    });
    const withoutSettlement = {
      version: JUDGE_DEMO_RECEIPT_ARTIFACT_VERSION,
      activationHash: active.activationHash,
      appCommit: active.appCommit,
      envelope: active.envelope,
      authorization: {
        claims: authorization.claims,
        claimsHash: authorization.claimsHash
      },
      providerReceipt: verifiedReceipt,
      capturedAt
    } as const;
    const settlement = await settlementPayload(withoutSettlement);
    const artifact: JudgeDemoReceiptArtifact = {
      ...withoutSettlement,
      settlement: {
        actualNanoUsd: settlement.actualNanoUsd,
        providerResponseHash: settlement.providerResponseHash,
        usageHash: settlement.usageHash,
        settlementDigest: await canonicalSha256(settlement)
      }
    };
    const capture = await captureJudgeDemoReceipt(active.redis, {
      artifact,
      projection,
      artifactSecret: active.artifactSecret,
      capturedAtMs,
      ...(active.storeKeyspace ? { keyspace: active.storeKeyspace } : {})
    });
    await settleProbeCallKnown(active.redis, {
      ...active.identity,
      jti: authorization.claims.jti,
      ...artifact.settlement,
      settledAtMs: nowOf(dependencies)
    });
    await sealJudgeDemoReceipt(active.redis, {
      appCommit: active.appCommit,
      artifactDigest: capture.artifactDigest,
      sealedAtMs: nowOf(dependencies),
      ...(active.storeKeyspace ? { keyspace: active.storeKeyspace } : {})
    });
    const settledGuard = await readProbeGuardStatus(active.redis);
    if (guardMode(settledGuard, active.identity) !== "known") {
      throw new JudgeDemoServiceError("judge_demo_settlement_not_verified", 503, true);
    }
    return judgeDemoDecisionResponseSchema.parse({
      version: JUDGE_DEMO_API_VERSION,
      lane: JUDGE_DEMO_LANE,
      status: "fresh",
      inferencePerformed: true,
      projection
    });
  } catch (error) {
    if (!dispatchAdmitted) {
      if (error instanceof JudgeDemoServiceError) throw error;
      if (error instanceof JudgeDemoProviderError && error.dispatch === "before_dispatch") {
        throw new JudgeDemoServiceError(error.code, 503, false);
      }
      throw new JudgeDemoServiceError("judge_demo_before_dispatch_failed", 503, false);
    }
    const code =
      error instanceof JudgeDemoProviderError ? error.code : "judge_demo_after_dispatch_failed";
    const settlementDigest = await canonicalSha256({
      version: "toolproof-judge-demo-uncertain-settlement@1.0.0",
      authorizationJti: authorization.claims.jti,
      envelopeHash: active.envelope.envelopeHash,
      code
    });
    try {
      await recordJudgeDemoUncertain(active.redis, {
        artifact: {
          version: JUDGE_DEMO_UNCERTAIN_ARTIFACT_VERSION,
          activationHash: active.activationHash,
          appCommit: active.appCommit,
          envelopeHash: active.envelope.envelopeHash,
          authorizationJti: authorization.claims.jti,
          code,
          rawResponseBytes: error instanceof JudgeDemoProviderError ? error.rawResponseBytes : null,
          settlementDigest,
          capturedAt: new Date(nowOf(dependencies)).toISOString()
        },
        artifactSecret: active.artifactSecret,
        capturedAtMs: nowOf(dependencies),
        ...(active.storeKeyspace ? { keyspace: active.storeKeyspace } : {})
      });
    } catch {
      // Guard quarantine remains authoritative if permanent failure capture itself fails.
    }
    try {
      await settleProbeCallUncertain(active.redis, {
        ...active.identity,
        jti: authorization.claims.jti,
        settlementDigest,
        reason: code,
        settledAtMs: nowOf(dependencies)
      });
    } catch {
      // A durable known receipt may already exist and is recoverable through the captured store.
    }
    throw new JudgeDemoServiceError(code, 502, true);
  }
}

export function judgeDemoServiceErrorResponse(error: unknown): {
  readonly status: number;
  readonly body: { readonly error: string; readonly inferencePerformed: boolean };
} {
  if (error instanceof JudgeDemoServiceError) {
    return Object.freeze({
      status: error.status,
      body: Object.freeze({ error: error.code, inferencePerformed: error.inferencePerformed })
    });
  }
  return Object.freeze({
    status: 500,
    body: Object.freeze({ error: "judge_demo_request_failed", inferencePerformed: false })
  });
}
