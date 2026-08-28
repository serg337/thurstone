import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { GATE3_ORDER_SEED, GATE3_SEMANTIC_SUITE } from "@/lib/semantic/checkout-candidate.server";
import {
  CHECKOUT_FIXTURE_ID,
  CHECKOUT_FIXTURE_SEED,
  CHECKOUT_FIXTURE_VERSION,
  createCheckoutFixture
} from "@/lib/domain/checkout";
import { CHECKOUT_FIXTURE_STATE_HASH } from "@/lib/domain/checkout-reset";
import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import type { OperationTrace } from "@/lib/evidence/operation-trace";
import type {
  FallbackResetEvidence,
  FallbackTrialEvidence
} from "@/lib/fallback/lab-page-adapter.server";
import {
  PROBE_CONTINUATION_STAGES,
  getProbeContinuation,
  probeContinuationKey,
  putProbeContinuation
} from "@/lib/probe/continuation-store";
import type { ProbeBoundaryEvidence, ProbeClientCompletionInput } from "@/lib/probe/client-runner";
import {
  beginProbeCall,
  createProbeRedis,
  issueProbeAuthorization,
  settleProbeCallKnown,
  settleProbeCallUncertain
} from "@/lib/probe/ledger";
import { deriveProbeActorHash, deriveProbeLaunchHash } from "@/lib/probe/session";
import { decodeProbeSigningSecret } from "@/lib/probe/signing-secret";
import { deriveRepairGrantIdentity } from "@/lib/repair/identity.server";
import { readRepairProviderReceipt } from "@/lib/repair/store.server";
import {
  deriveScoredAuthorizationIdentity,
  issueScoredAuthorization,
  verifyScoredAuthorization,
  type ScoredAuthorization,
  type ScoredAuthorizationClaims
} from "@/lib/scored/authorization.server";
import { createGate3ScoredTrialEnvelope } from "@/lib/scored/case-source.server";
import {
  verifyExpectationFreeScoredEnvelope,
  type ScoredBoundaryInput,
  type ScoredTrialEnvelope
} from "@/lib/scored/envelope";
import {
  assertScoredPredecessorDisposition,
  assertScoredReplacementOffset,
  assertScoredPhaseCanStart,
  readScoredGuardContext
} from "@/lib/scored/guard.server";
import { readScoredLedgerRecord } from "@/lib/scored/ledger-record.server";
import {
  createScoredNativeAdmission,
  verifyScoredNativeAdmission,
  type ScoredNativeAdmission
} from "@/lib/scored/native-admission";
import {
  ScoredProviderError,
  decideScoredWithOpenAi,
  verifyScoredProviderKnownReceipt,
  type ScoredProviderKnownReceipt
} from "@/lib/scored/openai-provider.server";
import {
  SCORED_RUN_ATTEMPT_VERSION,
  SCORED_RUN_CASE_COUNT,
  SCORED_RUN_SCHEDULE_VERSION,
  acknowledgeScoredRun,
  acquireScoredRunOwner,
  createScoredRun,
  createScoredRunIdentity,
  readPermanentScoredRun,
  readPermanentScoredRunById,
  readScoredRun,
  readScoredRunProgress,
  recordScoredRunAttempt,
  sealScoredRunEvidence,
  scoredRunAttemptSchema,
  type ScoredRunAttempt,
  type ScoredRunIdentity,
  type ScoredRunProgress,
  type ScoredRunSnapshot
} from "@/lib/scored/run-store.server";
import { scoredInfrastructureReplacementEligible } from "@/lib/scored/retry-policy";
import {
  SCORED_PREDECESSOR_DISPOSITIONS,
  SCORED_RECOVERY_COOKIE,
  SCORED_SESSION_COOKIE,
  issueRecoveredScoredSession,
  issueScoredRecovery,
  issueScoredSession,
  verifyScoredRecovery,
  verifyScoredSession,
  type ScoredRecoveryClaims,
  type ScoredPredecessorDisposition,
  type ScoredSessionClaims
} from "@/lib/scored/session.server";
import type { ScoredFailureBody, ScoredSessionResponse } from "@/lib/scored/service-contract";
import { configuredGate3FrozenProtocol } from "@/lib/semantic/frozen-config.server";
import { readGate3Freeze } from "@/lib/semantic/freeze-store.server";
import { configuredGate3ReviewPackage } from "@/lib/semantic/review-package-config.server";
import type { Gate3SuccessorLineage } from "@/lib/semantic/gate3-successor-lineage.server";
import { deriveSemanticCaseOrder } from "@/lib/semantic/protocol-freeze.server";
import { configuredGate5Revision } from "@/lib/semantic/revision-config.server";
import {
  GATE3_SCORED_EVIDENCE_ROW_VERSION,
  buildGate3ScoredEvidenceRow,
  type Gate3ScoredEvidenceRow
} from "@/lib/semantic/scored-evaluation.server";
import { createCheckoutLiveManifest } from "@/lib/webmcp/live-manifest.server";

export const SCORED_AUTHORIZATION_RESPONSE_VERSION = 1;
export const GATE3_SCORED_BUNDLE_VERSION = "toolproof-gate3-scored-bundle@1.0.0";
export const GATE3_BASELINE_REVEAL_VERSION = "toolproof-gate3-baseline-development-reveal@1.0.0";
export const SCORED_OPERATOR_CAPABILITY_HASH_ENV = "TOOLPROOF_SCORED_OPERATOR_CAPABILITY_HASH";
export const SCORED_OPERATOR_PHASE_ENV = "TOOLPROOF_SCORED_OPERATOR_PHASE";
export const SCORED_PHASE_CALL_OFFSET_ENV = "TOOLPROOF_SCORED_PHASE_CALL_OFFSET";
export const SCORED_REPAIR_PHASE_CALL_OFFSET_ENV = "TOOLPROOF_REPAIR_PHASE_CALL_OFFSET";
export const SCORED_PREDECESSOR_PROTOCOL_HASH_ENV = "TOOLPROOF_SCORED_PREDECESSOR_PROTOCOL_HASH";
export const SCORED_PREDECESSOR_EVIDENCE_DIGEST_ENV =
  "TOOLPROOF_SCORED_PREDECESSOR_EVIDENCE_DIGEST";
export const SCORED_PREDECESSOR_RUN_ID_ENV = "TOOLPROOF_SCORED_PREDECESSOR_RUN_ID";
export const SCORED_PREDECESSOR_DISPOSITION_ENV = "TOOLPROOF_SCORED_PREDECESSOR_DISPOSITION";

type EnvironmentLike = Readonly<Record<string, string | undefined>>;

export interface ScoredServiceDependencies {
  readonly environment?: EnvironmentLike;
  readonly nowMs?: () => number;
}

export class ScoredServiceError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly inferencePerformed = false
  ) {
    super(code);
    this.name = "ScoredServiceError";
  }
}

export interface ScoredSessionStartResult extends ScoredSessionResponse {
  readonly sessionCookieValue: string;
  readonly recoveryCookieValue: string;
}

export interface ScoredSessionRecoveryResult extends ScoredSessionResponse {
  readonly sessionCookieValue: string;
}

export interface ScoredAuthorizationResponse {
  readonly status: "issued";
  readonly runId: string;
  readonly caseId: string;
  readonly trialId: string;
  readonly authorization: {
    readonly version: typeof SCORED_AUTHORIZATION_RESPONSE_VERSION;
    readonly probeToken: string;
    readonly envelope: ScoredTrialEnvelope;
    readonly claimsHash: string;
  };
}

export interface ScoredFreshDecisionResponse {
  readonly context: {
    readonly kind: "fresh-stateless";
    readonly previousResponseId: null;
    readonly providerRequestCount: 1;
  };
  readonly rawModelResponse: string;
  readonly providerReceipt: ScoredProviderKnownReceipt;
  readonly decision: ScoredProviderKnownReceipt["decision"];
}

export interface Gate3ScoredBundle {
  readonly version: typeof GATE3_SCORED_BUNDLE_VERSION;
  readonly phase: "baseline" | "revised";
  readonly runId: string;
  readonly appCommit: string;
  readonly reviewPackageHash: string;
  readonly frozenProtocolHash: string;
  readonly freezeCandidateHash: string;
  readonly scheduleHash: string;
  readonly orderedRunnerCaseIds: readonly string[];
  readonly phaseCallOffset: number;
  readonly repairPhaseCallOffset: 0 | 1;
  readonly predecessorProtocolHash: string | null;
  readonly predecessorEvidenceDigest: string | null;
  readonly predecessorRunId: string | null;
  readonly predecessorDisposition: ScoredPredecessorDisposition | null;
  readonly status: "terminal-complete" | "terminal-invalid";
  readonly completedCount: number;
  readonly attemptCount: number;
  readonly transportFailureCount: number;
  readonly attempts: readonly ScoredRunAttempt[];
  readonly attemptManifestDigest: string;
  readonly guard: {
    readonly claimedCalls: number;
    readonly knownCalls: number;
    readonly pendingCount: number;
    readonly uncertainCount: number;
    readonly baselineCalls: number;
    readonly revisedCalls: number;
    readonly committedNanoUsd: number;
    readonly knownActualNanoUsd: number;
  };
  readonly evidenceDigest: string;
}

export interface Gate3BaselineRevealBundle {
  readonly version: typeof GATE3_BASELINE_REVEAL_VERSION;
  readonly phase: "baseline";
  readonly runId: string;
  readonly appCommit: string;
  readonly reviewPackageHash: string;
  readonly frozenProtocolHash: string;
  readonly freezeCandidateHash: string;
  readonly phaseCallOffset: number;
  readonly repairPhaseCallOffset: 0 | 1;
  readonly predecessorProtocolHash: string | null;
  readonly predecessorEvidenceDigest: string | null;
  readonly predecessorRunId: string | null;
  readonly predecessorDisposition: ScoredPredecessorDisposition | null;
  readonly status: "terminal-complete" | "terminal-invalid";
  readonly completedCount: number;
  readonly attemptCount: number;
  readonly transportFailureCount: number;
  readonly developmentAttempts: readonly ScoredRunAttempt[];
  readonly developmentDigest: string;
  readonly sealedHoldout: {
    readonly caseCount: 12;
    readonly attemptCount: number;
    readonly commitmentDigest: string;
    readonly disclosure: "sealed-until-v2-freeze-and-revised-terminal";
  };
  readonly terminalEvidenceDigest: string;
  readonly guard: Gate3ScoredBundle["guard"];
  readonly revealDigest: string;
}

export interface Gate3BundleExpectedBinding {
  readonly phase?: "baseline" | "revised";
  readonly runId?: string;
  readonly appCommit?: string;
  readonly reviewPackageHash?: string;
  readonly frozenProtocolHash?: string;
  readonly freezeCandidateHash?: string;
  readonly scheduleHash?: string;
  readonly phaseCallOffset?: number;
  readonly repairPhaseCallOffset?: 0 | 1;
  readonly predecessorProtocolHash?: string | null;
  readonly predecessorEvidenceDigest?: string | null;
  readonly predecessorRunId?: string | null;
  readonly predecessorDisposition?: ScoredPredecessorDisposition | null;
}

const CONSUME_CAPABILITY_SCRIPT = `
local existing = redis.call("GET", KEYS[1])
if existing then
  if existing == ARGV[1] then return {2, "CAPABILITY_EXISTING"} end
  return {0, "CAPABILITY_CONFLICT"}
end
redis.call("SET", KEYS[1], ARGV[1])
return {1, "CAPABILITY_CONSUMED"}
`;

function environmentOf(dependencies: ScoredServiceDependencies): EnvironmentLike {
  return dependencies.environment ?? process.env;
}

function nowOf(dependencies: ScoredServiceDependencies): number {
  return (dependencies.nowMs ?? Date.now)();
}

function appCommit(environment: EnvironmentLike): string {
  const vercel = environment.VERCEL_GIT_COMMIT_SHA?.trim();
  const override = environment.TOOLPROOF_COMMIT_SHA?.trim();
  if (vercel && override && vercel !== override) {
    throw new ScoredServiceError("scored_commit_override_mismatch", 503);
  }
  const value = vercel ?? override ?? "";
  if (!/^[a-f0-9]{40}$/u.test(value)) {
    throw new ScoredServiceError("scored_build_unversioned", 503);
  }
  return value;
}

function requiredEnvironment(environment: EnvironmentLike, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new ScoredServiceError("scored_configuration_missing", 503);
  return value;
}

function cookie(request: Request, name: string): string {
  const source = request.headers.get("cookie") ?? "";
  const values = source
    .split(";")
    .map((entry) => entry.trim().split("="))
    .filter(([candidate]) => candidate === name)
    .map((entry) => entry.slice(1).join("="));
  if (values.length !== 1 || !values[0]) {
    throw new ScoredServiceError("scored_cookie_missing", 403);
  }
  return values[0];
}

function documentId(request: Request): string {
  const value = request.headers.get("x-toolproof-document") ?? "";
  if (!/^document_[A-Za-z0-9_-]{22,64}$/u.test(value)) {
    throw new ScoredServiceError("scored_document_invalid", 403);
  }
  return value;
}

function signingSecret(environment: EnvironmentLike): string {
  return requiredEnvironment(environment, "TOOLPROOF_SIGNING_SECRET");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function keyedHash(secret: string, label: string, value: string): string {
  let key: Buffer;
  try {
    key = decodeProbeSigningSecret(secret);
  } catch {
    throw new ScoredServiceError("scored_signing_secret_invalid", 503);
  }
  return createHmac("sha256", key)
    .update(`toolproof.scored-service.${label}.v1.${value}`)
    .digest("hex");
}

function rawSha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function frozenContext(environment: EnvironmentLike) {
  const frozen = await configuredGate3FrozenProtocol(environment);
  if (frozen.status !== "frozen" || !frozen.protocol) {
    throw new ScoredServiceError(
      frozen.status === "invalid"
        ? "gate3_frozen_configuration_invalid"
        : "gate3_human_approval_required",
      503
    );
  }
  let reviewPackage = (await configuredGate3ReviewPackage(environment)).reviewPackage;
  if (!reviewPackage) {
    const artifactSecret = requiredEnvironment(environment, "TOOLPROOF_SIGNING_SECRET");
    const stored = await readGate3Freeze(createProbeRedis(environment as NodeJS.ProcessEnv), {
      frozenProtocolHash: frozen.protocol.frozenProtocolHash,
      artifactSecret
    });
    reviewPackage = stored?.reviewPackage ?? null;
  }
  if (!reviewPackage) throw new ScoredServiceError("gate3_review_package_missing", 503);
  if (
    frozen.protocol.reviewPackageHash !== reviewPackage.packageHash ||
    frozen.protocol.freezeCandidateHash !== reviewPackage.freezeHash
  ) {
    throw new ScoredServiceError("gate3_frozen_configuration_mismatch", 503);
  }
  return Object.freeze({ frozen: frozen.protocol, review: reviewPackage });
}

async function runProtocolHash(
  environment: EnvironmentLike,
  phase: "baseline" | "revised",
  context: Awaited<ReturnType<typeof frozenContext>>
): Promise<string> {
  if (phase === "baseline") {
    if (context.frozen.frozenManifest.repositoryCommit !== appCommit(environment)) {
      throw new ScoredServiceError("baseline_commit_mismatch", 503);
    }
    return context.frozen.frozenProtocolHash;
  }
  const revision = await configuredGate5Revision(environment);
  if (
    revision.status !== "ready" ||
    !revision.revision ||
    revision.revision.v2AppCommit !== appCommit(environment) ||
    revision.revision.gate3FrozenProtocolHash !== context.frozen.frozenProtocolHash
  ) {
    throw new ScoredServiceError("gate5_revision_freeze_required", 503);
  }
  return revision.revision.revisionFreezeHash;
}

async function runIdentity(input: {
  readonly session: ScoredSessionClaims | ScoredRecoveryClaims;
  readonly actorHash: string;
  readonly orderedRunnerCaseIds: readonly string[];
}): Promise<ScoredRunIdentity> {
  return createScoredRunIdentity({
    phase: input.session.phase,
    appCommit: input.session.appCommit,
    reviewPackageHash: input.session.reviewPackageHash,
    frozenProtocolHash: input.session.frozenProtocolHash,
    freezeCandidateHash: input.session.freezeCandidateHash,
    phaseCallOffset: input.session.phaseCallOffset,
    repairPhaseCallOffset: input.session.repairPhaseCallOffset,
    predecessorProtocolHash: input.session.predecessorProtocolHash,
    predecessorEvidenceDigest: input.session.predecessorEvidenceDigest,
    predecessorRunId: input.session.predecessorRunId,
    predecessorDisposition: input.session.predecessorDisposition,
    runId: input.session.runId,
    actorHash: input.actorHash,
    orderedRunnerCaseIds: [...input.orderedRunnerCaseIds]
  });
}

function bindingFromFrozen(input: {
  readonly phase: "baseline" | "revised";
  readonly commit: string;
  readonly actorHash: string;
  readonly reviewPackageHash: string;
  readonly frozenProtocolHash: string;
  readonly freezeCandidateHash: string;
  readonly phaseCallOffset: number;
  readonly repairPhaseCallOffset: 0 | 1;
  readonly predecessorProtocolHash: string | null;
  readonly predecessorEvidenceDigest: string | null;
  readonly predecessorRunId: string | null;
  readonly predecessorDisposition: ScoredPredecessorDisposition | null;
}) {
  return {
    phase: input.phase,
    appCommit: input.commit,
    reviewPackageHash: input.reviewPackageHash,
    frozenProtocolHash: input.frozenProtocolHash,
    freezeCandidateHash: input.freezeCandidateHash,
    phaseCallOffset: input.phaseCallOffset,
    repairPhaseCallOffset: input.repairPhaseCallOffset,
    predecessorProtocolHash: input.predecessorProtocolHash,
    predecessorEvidenceDigest: input.predecessorEvidenceDigest,
    predecessorRunId: input.predecessorRunId,
    predecessorDisposition: input.predecessorDisposition,
    actorHash: input.actorHash
  } as const;
}

function phaseExecutionBinding(environment: EnvironmentLike): {
  readonly phaseCallOffset: number;
  readonly repairPhaseCallOffset: 0 | 1;
  readonly predecessorProtocolHash: string | null;
  readonly predecessorEvidenceDigest: string | null;
  readonly predecessorRunId: string | null;
  readonly predecessorDisposition: ScoredPredecessorDisposition | null;
} {
  const rawOffset = requiredEnvironment(environment, SCORED_PHASE_CALL_OFFSET_ENV);
  if (!/^(0|[1-9][0-9]?)$/u.test(rawOffset)) {
    throw new ScoredServiceError("scored_phase_call_offset_invalid", 503);
  }
  const phaseCallOffset = Number(rawOffset);
  const rawRepairOffset = requiredEnvironment(environment, SCORED_REPAIR_PHASE_CALL_OFFSET_ENV);
  if (!/^[01]$/u.test(rawRepairOffset)) {
    throw new ScoredServiceError("scored_repair_phase_call_offset_invalid", 503);
  }
  const repairPhaseCallOffset = Number(rawRepairOffset) as 0 | 1;
  const predecessorProtocolHash = environment[SCORED_PREDECESSOR_PROTOCOL_HASH_ENV]?.trim() || null;
  const predecessor = environment[SCORED_PREDECESSOR_EVIDENCE_DIGEST_ENV]?.trim() || null;
  const predecessorRunId = environment[SCORED_PREDECESSOR_RUN_ID_ENV]?.trim() || null;
  const predecessorDispositionValue =
    environment[SCORED_PREDECESSOR_DISPOSITION_ENV]?.trim() || null;
  const predecessorDisposition = SCORED_PREDECESSOR_DISPOSITIONS.includes(
    predecessorDispositionValue as ScoredPredecessorDisposition
  )
    ? (predecessorDispositionValue as ScoredPredecessorDisposition)
    : null;
  const predecessorValues = [
    predecessorProtocolHash,
    predecessor,
    predecessorRunId,
    predecessorDisposition
  ];
  const predecessorCount = predecessorValues.filter((value) => value !== null).length;
  if (
    phaseCallOffset > 46 ||
    (predecessorCount !== 0 && predecessorCount !== predecessorValues.length) ||
    (phaseCallOffset > 0 && predecessorCount !== predecessorValues.length) ||
    (predecessorProtocolHash !== null && !/^[a-f0-9]{64}$/u.test(predecessorProtocolHash)) ||
    (predecessor !== null && !/^[a-f0-9]{64}$/u.test(predecessor)) ||
    (predecessorRunId !== null && !/^run_[A-Za-z0-9_-]{22}$/u.test(predecessorRunId)) ||
    (predecessorDispositionValue !== null && predecessorDisposition === null)
  ) {
    throw new ScoredServiceError("scored_predecessor_binding_invalid", 503);
  }
  return Object.freeze({
    phaseCallOffset,
    repairPhaseCallOffset,
    predecessorProtocolHash,
    predecessorEvidenceDigest: predecessor,
    predecessorRunId,
    predecessorDisposition
  });
}

export function assertScoredFrozenPhaseExecution(input: {
  readonly lineage:
    | {
        readonly lineageHash: string;
        readonly disposition: "superseded-protocol";
        readonly predecessor: {
          readonly frozenProtocolHash: string;
          readonly evidenceDigest: string;
          readonly runId: string;
        };
        readonly phaseCallOffsets: {
          readonly baseline: 24;
          readonly repair: 1;
          readonly revised: 0;
        };
      }
    | undefined;
  readonly frozenSuccessorLineageHash: string | undefined;
  readonly phase: "baseline" | "revised";
  readonly execution: ReturnType<typeof phaseExecutionBinding>;
}): void {
  const { lineage, phase, execution } = input;
  if (!lineage) {
    if (
      execution.repairPhaseCallOffset !== 0 ||
      execution.predecessorDisposition === "superseded-protocol"
    ) {
      throw new ScoredServiceError("scored_execution_freeze_lineage_mismatch", 503);
    }
    return;
  }
  if (
    input.frozenSuccessorLineageHash !== lineage.lineageHash ||
    execution.repairPhaseCallOffset !== lineage.phaseCallOffsets.repair
  ) {
    throw new ScoredServiceError("scored_execution_freeze_lineage_mismatch", 503);
  }
  if (phase === "baseline") {
    if (execution.phaseCallOffset === lineage.phaseCallOffsets.baseline) {
      if (
        execution.predecessorProtocolHash !== lineage.predecessor.frozenProtocolHash ||
        execution.predecessorEvidenceDigest !== lineage.predecessor.evidenceDigest ||
        execution.predecessorRunId !== lineage.predecessor.runId ||
        execution.predecessorDisposition !== lineage.disposition
      ) {
        throw new ScoredServiceError("scored_execution_freeze_lineage_mismatch", 503);
      }
      return;
    }
    if (
      execution.phaseCallOffset <= lineage.phaseCallOffsets.baseline ||
      execution.predecessorDisposition !== "invalid-schedule"
    ) {
      throw new ScoredServiceError("scored_execution_freeze_lineage_mismatch", 503);
    }
    return;
  }
  if (execution.phaseCallOffset === lineage.phaseCallOffsets.revised) {
    if (
      execution.predecessorProtocolHash !== null ||
      execution.predecessorEvidenceDigest !== null ||
      execution.predecessorRunId !== null ||
      execution.predecessorDisposition !== null
    ) {
      throw new ScoredServiceError("scored_execution_freeze_lineage_mismatch", 503);
    }
    return;
  }
  if (execution.predecessorDisposition !== "invalid-schedule") {
    throw new ScoredServiceError("scored_execution_freeze_lineage_mismatch", 503);
  }
}

function progressResponse(input: {
  readonly session: ScoredSessionClaims | ScoredRecoveryClaims;
  readonly progress: ScoredRunProgress;
  readonly csrfToken: string;
  readonly sessionExpiresAt: number;
  readonly recoveryExpiresAt: number;
}): ScoredSessionResponse {
  const terminal = input.progress.status !== "active";
  return Object.freeze({
    ok: true,
    phase: input.session.phase,
    path: terminal ? "/results" : "/lab",
    buildCommit: input.session.appCommit,
    frozenProtocolHash: input.session.frozenProtocolHash,
    reviewPackageHash: input.session.reviewPackageHash,
    csrfToken: input.csrfToken,
    sessionExpiresAt: input.sessionExpiresAt,
    recoveryExpiresAt: input.recoveryExpiresAt,
    completedCount: input.progress.completedCount,
    remainingCount: input.progress.remainingCount,
    currentOrdinal: input.progress.currentOrdinal,
    currentAttempt: input.progress.currentAttempt,
    terminal
  });
}

async function authenticateSession(
  request: Request,
  dependencies: ScoredServiceDependencies,
  mode:
    | "active-settled"
    | "decision-recovery"
    | "failure-reconciliation"
    | "terminal-evidence" = "active-settled",
  requireCsrf = true
) {
  const environment = environmentOf(dependencies);
  const context = await frozenContext(environment);
  const secret = signingSecret(environment);
  const actorHash = deriveProbeActorHash(request, secret);
  const execution = phaseExecutionBinding(environment);
  const phaseCookie = cookie(request, SCORED_SESSION_COOKIE);
  const csrfToken = requireCsrf ? (request.headers.get("x-toolproof-csrf") ?? "") : undefined;
  let phase: "baseline" | "revised" | null = null;
  let selectedProtocolHash: string | null = null;
  for (const candidate of ["baseline", "revised"] as const) {
    try {
      const candidateProtocolHash = await runProtocolHash(environment, candidate, context);
      verifyScoredSession({
        ...bindingFromFrozen({
          phase: candidate,
          commit: appCommit(environment),
          actorHash,
          reviewPackageHash: context.frozen.reviewPackageHash,
          frozenProtocolHash: candidateProtocolHash,
          freezeCandidateHash: context.frozen.freezeCandidateHash,
          phaseCallOffset: execution.phaseCallOffset,
          repairPhaseCallOffset: execution.repairPhaseCallOffset,
          predecessorProtocolHash: execution.predecessorProtocolHash,
          predecessorEvidenceDigest: execution.predecessorEvidenceDigest,
          predecessorRunId: execution.predecessorRunId,
          predecessorDisposition: execution.predecessorDisposition
        }),
        cookieValue: phaseCookie,
        signingSecret: secret,
        ...(csrfToken === undefined ? {} : { csrfToken }),
        nowMs: nowOf(dependencies)
      });
      phase = candidate;
      selectedProtocolHash = candidateProtocolHash;
      break;
    } catch {
      // Try the other exact scored phase; neither result is exposed.
    }
  }
  if (!phase || !selectedProtocolHash) {
    throw new ScoredServiceError("invalid_scored_session", 403);
  }
  const binding = bindingFromFrozen({
    phase,
    commit: appCommit(environment),
    actorHash,
    reviewPackageHash: context.frozen.reviewPackageHash,
    frozenProtocolHash: selectedProtocolHash,
    freezeCandidateHash: context.frozen.freezeCandidateHash,
    phaseCallOffset: execution.phaseCallOffset,
    repairPhaseCallOffset: execution.repairPhaseCallOffset,
    predecessorProtocolHash: execution.predecessorProtocolHash,
    predecessorEvidenceDigest: execution.predecessorEvidenceDigest,
    predecessorRunId: execution.predecessorRunId,
    predecessorDisposition: execution.predecessorDisposition
  });
  const session = verifyScoredSession({
    ...binding,
    cookieValue: phaseCookie,
    signingSecret: secret,
    ...(csrfToken === undefined ? {} : { csrfToken }),
    nowMs: nowOf(dependencies)
  });
  const identity = await runIdentity({
    session,
    actorHash,
    orderedRunnerCaseIds: context.frozen.frozenManifest.schedule.orderedRunnerCaseIds
  });
  const ownerDocumentId = documentId(request);
  const guard = await readScoredGuardContext(environment, { allowUnsettled: true });
  const unsettled =
    guard.status.pendingCount !== 0 ||
    guard.status.uncertainCount !== 0 ||
    guard.status.inflightCount !== 0;
  const progress = await readScoredRunProgress(guard.redis, {
    phase: identity.phase,
    frozenProtocolHash: identity.frozenProtocolHash,
    runId: identity.runId
  });
  if (!progress) throw new ScoredServiceError("scored_run_missing", 409);
  if (mode === "active-settled" && unsettled) {
    throw new ScoredServiceError("scored_guard_unsettled", 409);
  }
  if ((mode === "active-settled" || mode === "decision-recovery") && progress.status !== "active") {
    throw new ScoredServiceError("scored_run_not_active", 409);
  }
  if (mode === "terminal-evidence" && progress.status === "active") {
    throw new ScoredServiceError("scored_run_not_terminal", 409);
  }
  if (mode === "failure-reconciliation" && progress.status !== "active" && unsettled) {
    throw new ScoredServiceError("scored_terminal_evidence_only", 409);
  }
  if (progress.status === "active") {
    await acquireScoredRunOwner(guard.redis, {
      identity,
      documentId: ownerDocumentId,
      artifactSecret: secret
    });
  }
  const permanent =
    progress.status === "active"
      ? null
      : await readPermanentScoredRun(guard.redis, { identity, artifactSecret: secret });
  const snapshot =
    permanent ?? (await readScoredRun(guard.redis, { identity, artifactSecret: secret }));
  if (!snapshot) throw new ScoredServiceError("scored_run_missing", 409);
  return Object.freeze({
    environment,
    context,
    secret,
    actorHash,
    session,
    identity,
    documentId: ownerDocumentId,
    guard,
    snapshot,
    nowMs: nowOf(dependencies)
  });
}

function freshDecisionResponse(
  providerReceipt: ScoredProviderKnownReceipt
): ScoredFreshDecisionResponse {
  return Object.freeze({
    context: Object.freeze({
      kind: "fresh-stateless" as const,
      previousResponseId: null,
      providerRequestCount: 1 as const
    }),
    rawModelResponse: providerReceipt.rawResponseBytes,
    providerReceipt,
    decision: providerReceipt.decision
  });
}

async function settleKnownScoredDecision(input: {
  readonly authenticated: Awaited<ReturnType<typeof authenticateSession>>;
  readonly envelope: ScoredTrialEnvelope;
  readonly authorization: ScoredAuthorization;
  readonly providerReceipt: unknown;
}): Promise<ScoredProviderKnownReceipt> {
  const providerReceipt = await verifyScoredProviderKnownReceipt({
    receipt: input.providerReceipt,
    envelope: input.envelope
  });
  const settlementDigest = await canonicalSha256({
    version: "toolproof-scored-known-settlement@1.0.0",
    jti: input.authorization.claims.jti,
    envelopeHash: input.envelope.envelopeHash,
    providerResponseHash: providerReceipt.rawResponseHash,
    usageHash: providerReceipt.usageHash,
    actualNanoUsd: providerReceipt.usage.accountedNanoUsd
  });
  const durableGrant = await readScoredLedgerRecord(input.authenticated.guard.redis, {
    ...input.authenticated.guard.identity,
    jti: input.authorization.claims.jti
  });
  if (
    !durableGrant ||
    durableGrant.claimsHash !== input.authorization.claimsHash ||
    durableGrant.purpose !== input.authenticated.session.phase
  ) {
    throw new ScoredServiceError("scored_authorization_record_mismatch", 409, true);
  }
  if (durableGrant.state === "KNOWN") {
    if (
      durableGrant.actualNanoUsd !== providerReceipt.usage.accountedNanoUsd ||
      durableGrant.providerResponseHash !== providerReceipt.rawResponseHash ||
      durableGrant.usageHash !== providerReceipt.usageHash ||
      durableGrant.settlementDigest !== settlementDigest
    ) {
      throw new ScoredServiceError("scored_known_decision_receipt_mismatch", 500, true);
    }
    return providerReceipt;
  }
  if (durableGrant.state !== "IN_FLIGHT" && durableGrant.state !== "UNCERTAIN") {
    throw new ScoredServiceError("scored_known_decision_settlement_invalid", 409, true);
  }
  await settleProbeCallKnown(input.authenticated.guard.redis, {
    ...input.authenticated.guard.identity,
    jti: input.authorization.claims.jti,
    actualNanoUsd: providerReceipt.usage.accountedNanoUsd,
    providerResponseHash: providerReceipt.rawResponseHash,
    settlementDigest,
    usageHash: providerReceipt.usageHash
  });
  return providerReceipt;
}

function assertAuthenticatedGuardClean(
  authenticated: Awaited<ReturnType<typeof authenticateSession>>
): void {
  const guard = authenticated.guard.status;
  if (guard.pendingCount !== 0 || guard.uncertainCount !== 0 || guard.inflightCount !== 0) {
    throw new ScoredServiceError("scored_guard_unsettled", 409);
  }
}

function authorizationExpected(input: {
  readonly session: ScoredSessionClaims;
  readonly snapshot: ScoredRunSnapshot;
  readonly envelope: ScoredTrialEnvelope;
}): Omit<ScoredAuthorizationClaims, "issuedAt" | "expiresAt" | "jti" | "subjectHash"> {
  return {
    version: "toolproof-scored-authorization@1.0.0",
    phase: input.session.phase,
    appCommit: input.session.appCommit,
    reviewPackageHash: input.session.reviewPackageHash,
    frozenProtocolHash: input.session.frozenProtocolHash,
    freezeCandidateHash: input.session.freezeCandidateHash,
    phaseCallOffset: input.session.phaseCallOffset,
    repairPhaseCallOffset: input.session.repairPhaseCallOffset,
    predecessorProtocolHash: input.session.predecessorProtocolHash,
    predecessorEvidenceDigest: input.session.predecessorEvidenceDigest,
    predecessorRunId: input.session.predecessorRunId,
    predecessorDisposition: input.session.predecessorDisposition,
    runId: input.session.runId,
    runnerCaseId: input.envelope.caseId,
    trialId: input.envelope.trialId,
    ordinal: input.snapshot.currentOrdinal,
    attempt: input.snapshot.currentAttempt,
    envelopeHash: input.envelope.envelopeHash,
    actorHash: input.session.actorHash
  };
}

async function verifyAuthorization(input: {
  readonly authenticated: Awaited<ReturnType<typeof authenticateSession>>;
  readonly probeToken: string;
  readonly envelopeValue: unknown;
}) {
  const envelope = await verifyExpectationFreeScoredEnvelope(input.envelopeValue);
  const authorization = await verifyScoredAuthorization({
    token: input.probeToken,
    expected: authorizationExpected({
      session: input.authenticated.session,
      snapshot: input.authenticated.snapshot,
      envelope
    }),
    signingSecret: input.authenticated.secret,
    nowMs: input.authenticated.nowMs
  });
  return Object.freeze({ envelope, authorization });
}

function capabilityKey(phase: "baseline" | "revised", frozenProtocolHash: string): string {
  return `tp:{webmcp26}:scored-capability:${phase}:${frozenProtocolHash}`;
}

async function assertConfiguredScoredPredecessor(input: {
  readonly phase: "baseline" | "revised";
  readonly protocolHash: string;
  readonly phaseExecution: ReturnType<typeof phaseExecutionBinding>;
  readonly guard: Awaited<ReturnType<typeof readScoredGuardContext>>;
  readonly artifactSecret: string;
  readonly successorLineage: Gate3SuccessorLineage | undefined;
}): Promise<void> {
  const lineage = input.successorLineage;
  if (lineage) {
    const [permanentFreeze, permanentRun, permanentRepair] = await Promise.all([
      readGate3Freeze(input.guard.redis, {
        frozenProtocolHash: lineage.predecessor.frozenProtocolHash,
        artifactSecret: input.artifactSecret
      }),
      readPermanentScoredRunById(input.guard.redis, {
        phase: "baseline",
        frozenProtocolHash: lineage.predecessor.frozenProtocolHash,
        runId: lineage.predecessor.runId,
        artifactSecret: input.artifactSecret
      }),
      readRepairProviderReceipt(input.guard.redis, {
        baselineEvidenceDigest: lineage.predecessor.evidenceDigest,
        artifactSecret: input.artifactSecret
      })
    ]);
    const originalTermination = permanentFreeze?.frozenProtocol.authoringTermination;
    if (
      !permanentFreeze ||
      permanentFreeze.reviewPackage.packageHash !== lineage.predecessor.reviewPackageHash ||
      permanentFreeze.reviewPackage.freezeHash !== lineage.predecessor.freezeCandidateHash ||
      permanentFreeze.frozenProtocol.frozenProtocolHash !==
        lineage.predecessor.frozenProtocolHash ||
      !originalTermination ||
      canonicalJson(originalTermination) !==
        canonicalJson(lineage.authoringContinuity.originalAuthoringTermination) ||
      permanentFreeze.frozenProtocol.authoringTerminationHash !==
        lineage.authoringContinuity.originalAuthoringTerminationHash ||
      !permanentRun ||
      permanentRun.status !== lineage.predecessor.acknowledgementStatus ||
      permanentRun.terminalStatus !== lineage.predecessor.terminalStatus ||
      permanentRun.completedCount !== lineage.predecessor.completedCaseCount ||
      permanentRun.evidenceDigest !== lineage.predecessor.evidenceDigest ||
      permanentRun.identity.reviewPackageHash !== lineage.predecessor.reviewPackageHash ||
      permanentRun.identity.freezeCandidateHash !== lineage.predecessor.freezeCandidateHash ||
      permanentRun.identity.frozenProtocolHash !== lineage.predecessor.frozenProtocolHash ||
      !permanentRepair ||
      canonicalJson(permanentRepair.repairBuilderReceipt) !==
        canonicalJson(lineage.priorRepair.repairBuilderReceipt)
    ) {
      throw new ScoredServiceError("scored_successor_permanent_lineage_mismatch", 409);
    }
    const repairIdentity = await deriveRepairGrantIdentity({
      artifactSecret: input.artifactSecret,
      developmentPackageHash: permanentRepair.repairBuilderReceipt.developmentPackageHash
    });
    if (repairIdentity.contextId !== permanentRepair.repairBuilderReceipt.contextId) {
      throw new ScoredServiceError("scored_successor_permanent_lineage_mismatch", 409);
    }
    const repairRecord = await readScoredLedgerRecord(input.guard.redis, {
      ...input.guard.identity,
      jti: repairIdentity.jti
    });
    const repairSettlementDigest = await canonicalSha256({
      version: "toolproof-repair-known-settlement@1.0.0",
      jti: repairIdentity.jti,
      providerResponseHash: permanentRepair.rawResponseHash,
      usageHash: permanentRepair.usageHash,
      actualNanoUsd: permanentRepair.actualNanoUsd
    });
    if (
      !repairRecord ||
      repairRecord.state !== "KNOWN" ||
      repairRecord.purpose !== "repair" ||
      repairRecord.claimsHash !== repairIdentity.claimsHash ||
      repairRecord.providerResponseHash !== permanentRepair.rawResponseHash ||
      repairRecord.usageHash !== permanentRepair.usageHash ||
      repairRecord.actualNanoUsd !== permanentRepair.actualNanoUsd ||
      repairRecord.settlementDigest !== repairSettlementDigest
    ) {
      throw new ScoredServiceError("scored_successor_repair_ledger_mismatch", 409);
    }
  }
  const predecessorProtocolHash = input.phaseExecution.predecessorProtocolHash;
  const predecessorRunId = input.phaseExecution.predecessorRunId;
  const predecessorEvidenceDigest = input.phaseExecution.predecessorEvidenceDigest;
  const predecessorDisposition = input.phaseExecution.predecessorDisposition;
  if (
    !predecessorProtocolHash ||
    !predecessorRunId ||
    !predecessorEvidenceDigest ||
    !predecessorDisposition
  ) {
    return;
  }
  const predecessor = await readPermanentScoredRunById(input.guard.redis, {
    phase: input.phase,
    frozenProtocolHash: predecessorProtocolHash,
    runId: predecessorRunId,
    artifactSecret: input.artifactSecret
  });
  if (
    !predecessor ||
    predecessor.status !== "acknowledged" ||
    predecessor.terminalStatus === null ||
    predecessor.evidenceDigest !== predecessorEvidenceDigest ||
    predecessor.identity.frozenProtocolHash !== predecessorProtocolHash
  ) {
    throw new ScoredServiceError("scored_predecessor_evidence_mismatch", 409);
  }
  assertScoredPredecessorDisposition({
    disposition: predecessorDisposition,
    currentProtocolHash: input.protocolHash,
    predecessorProtocolHash,
    predecessorTerminalStatus: predecessor.terminalStatus,
    predecessorCompletedCount: predecessor.completedCount
  });
  const predecessorJtis = new Set<string>();
  let predecessorProviderGrants = 0;
  for (const attempt of predecessor.attempts) {
    const evidence = attempt.evidence as Record<string, unknown>;
    const jti = evidence.authorizationJti;
    if (
      typeof jti !== "string" ||
      !/^jti_scored_[A-Za-z0-9_-]{22}$/u.test(jti) ||
      predecessorJtis.has(jti)
    ) {
      throw new ScoredServiceError("scored_predecessor_attempt_identity_mismatch", 409);
    }
    predecessorJtis.add(jti);
    const record = await readScoredLedgerRecord(input.guard.redis, {
      ...input.guard.identity,
      jti
    });
    if (record && record.purpose !== input.phase) {
      throw new ScoredServiceError("scored_predecessor_ledger_mismatch", 409);
    }
    const stateImpliesDispatch =
      record?.state === "IN_FLIGHT" || record?.state === "KNOWN" || record?.state === "UNCERTAIN";
    if (record && stateImpliesDispatch !== (record.dispatchSequence !== null)) {
      throw new ScoredServiceError("scored_predecessor_ledger_mismatch", 409);
    }
    if (stateImpliesDispatch) predecessorProviderGrants += 1;
  }
  assertScoredReplacementOffset({
    phaseCallOffset: input.phaseExecution.phaseCallOffset,
    predecessorPhaseCallOffset: predecessor.identity.phaseCallOffset,
    predecessorProviderGrants
  });
}

export async function readGate3ScoredReadiness(dependencies: ScoredServiceDependencies = {}) {
  const environment = environmentOf(dependencies);
  try {
    const context = await frozenContext(environment);
    const guard = await readScoredGuardContext(environment);
    const configuredPhase = environment[SCORED_OPERATOR_PHASE_ENV]?.trim() || null;
    let phaseReadiness: Readonly<Record<string, unknown>> = Object.freeze({
      configuredPhase: null,
      executionVerified: false
    });
    if (configuredPhase !== null) {
      if (configuredPhase !== "baseline" && configuredPhase !== "revised") {
        throw new ScoredServiceError("scored_operator_phase_invalid", 503);
      }
      const phaseExecution = phaseExecutionBinding(environment);
      const protocolHash = await runProtocolHash(environment, configuredPhase, context);
      assertScoredFrozenPhaseExecution({
        lineage: context.review.successorLineage,
        frozenSuccessorLineageHash: context.frozen.successorLineageHash,
        phase: configuredPhase,
        execution: phaseExecution
      });
      assertScoredPhaseCanStart(guard.status, configuredPhase, phaseExecution);
      await assertConfiguredScoredPredecessor({
        phase: configuredPhase,
        protocolHash,
        phaseExecution,
        guard,
        artifactSecret: signingSecret(environment),
        successorLineage: context.review.successorLineage
      });
      phaseReadiness = Object.freeze({
        configuredPhase,
        executionVerified: true,
        protocolHash,
        phaseCallOffset: phaseExecution.phaseCallOffset,
        repairPhaseCallOffset: phaseExecution.repairPhaseCallOffset,
        predecessorDisposition: phaseExecution.predecessorDisposition
      });
    }
    return Object.freeze({
      status: "ready" as const,
      appCommit: appCommit(environment),
      reviewPackageHash: context.frozen.reviewPackageHash,
      frozenProtocolHash: context.frozen.frozenProtocolHash,
      freezeCandidateHash: context.frozen.freezeCandidateHash,
      scheduleCases: 24,
      repetitionCount: 1,
      evidenceLabel: "demonstration-snapshot" as const,
      phaseReadiness,
      guard: {
        claimedCalls: guard.status.claimedCalls,
        knownCalls: guard.status.knownCount,
        calibrationCalls: guard.status.purposeCounts.calibration,
        baselineCalls: guard.status.purposeCounts.baseline,
        repairCalls: guard.status.purposeCounts.repair,
        revisedCalls: guard.status.purposeCounts.revised
      },
      providerCallPerformed: false
    });
  } catch (error) {
    return Object.freeze({
      status: "not-ready" as const,
      reason: error instanceof Error ? error.message : "scored_readiness_failed",
      providerCallPerformed: false
    });
  }
}

export async function startScoredSession(
  request: Request,
  input: {
    readonly capability: string;
    readonly phase: "baseline" | "revised";
    readonly launchId: string;
    readonly documentId: string;
  },
  dependencies: ScoredServiceDependencies = {}
): Promise<ScoredSessionStartResult> {
  const environment = environmentOf(dependencies);
  const expectedHash = requiredEnvironment(environment, SCORED_OPERATOR_CAPABILITY_HASH_ENV);
  const configuredPhase = requiredEnvironment(environment, SCORED_OPERATOR_PHASE_ENV);
  if (
    configuredPhase !== input.phase ||
    !/^[a-f0-9]{64}$/u.test(expectedHash) ||
    !safeEqual(rawSha256(input.capability), expectedHash)
  ) {
    throw new ScoredServiceError("invalid_scored_operator_capability", 403);
  }
  const context = await frozenContext(environment);
  const protocolHash = await runProtocolHash(environment, input.phase, context);
  const secret = signingSecret(environment);
  const actorHash = deriveProbeActorHash(request, secret);
  const guard = await readScoredGuardContext(environment);
  const phaseExecution = phaseExecutionBinding(environment);
  assertScoredFrozenPhaseExecution({
    lineage: context.review.successorLineage,
    frozenSuccessorLineageHash: context.frozen.successorLineageHash,
    phase: input.phase,
    execution: phaseExecution
  });
  assertScoredPhaseCanStart(guard.status, input.phase, phaseExecution);
  await assertConfiguredScoredPredecessor({
    phase: input.phase,
    protocolHash,
    phaseExecution,
    guard,
    artifactSecret: secret,
    successorLineage: context.review.successorLineage
  });
  const binding = bindingFromFrozen({
    phase: input.phase,
    commit: appCommit(environment),
    actorHash,
    reviewPackageHash: context.frozen.reviewPackageHash,
    frozenProtocolHash: protocolHash,
    freezeCandidateHash: context.frozen.freezeCandidateHash,
    ...phaseExecution
  });
  const deterministicSessionSeed = `${expectedHash}.${input.phase}.${input.launchId}.${actorHash}.${protocolHash}`;
  const session = issueScoredSession({
    ...binding,
    signingSecret: secret,
    nowMs: nowOf(dependencies),
    sessionId: `session_${keyedHash(secret, "session", deterministicSessionSeed).slice(0, 22)}`,
    runId: `run_${keyedHash(secret, "run", deterministicSessionSeed).slice(0, 22)}`
  });
  const recovery = issueScoredRecovery({
    session: session.claims,
    launchHash: deriveProbeLaunchHash(input.launchId, secret),
    signingSecret: secret
  });
  const identity = await runIdentity({
    session: session.claims,
    actorHash,
    orderedRunnerCaseIds: context.frozen.frozenManifest.schedule.orderedRunnerCaseIds
  });
  const capabilityBinding = keyedHash(
    secret,
    "capability-consumer",
    `${expectedHash}.${input.phase}.${input.launchId}.${actorHash}.${session.claims.runId}`
  );
  const consumed = await guard.redis.eval<string[], unknown>(
    CONSUME_CAPABILITY_SCRIPT,
    [capabilityKey(input.phase, protocolHash)],
    [capabilityBinding]
  );
  if (!Array.isArray(consumed) || (Number(consumed[0]) !== 1 && Number(consumed[0]) !== 2)) {
    throw new ScoredServiceError("scored_operator_capability_consumed", 409);
  }
  try {
    await createScoredRun(guard.redis, {
      identity,
      documentId: input.documentId,
      artifactSecret: secret,
      createdAt: new Date(nowOf(dependencies)).toISOString()
    });
  } catch (error) {
    throw new ScoredServiceError(
      error instanceof Error ? error.message : "scored_run_create_failed",
      409
    );
  }
  const progress = await readScoredRunProgress(guard.redis, {
    phase: identity.phase,
    frozenProtocolHash: identity.frozenProtocolHash,
    runId: identity.runId
  });
  if (!progress) throw new ScoredServiceError("scored_run_create_failed", 500);
  return Object.freeze({
    ...progressResponse({
      session: session.claims,
      progress,
      csrfToken: session.csrfToken,
      sessionExpiresAt: session.claims.expiresAt,
      recoveryExpiresAt: recovery.claims.expiresAt
    }),
    sessionCookieValue: session.cookieValue,
    recoveryCookieValue: recovery.cookieValue
  });
}

export async function recoverScoredSession(
  request: Request,
  input: { readonly documentId: string },
  dependencies: ScoredServiceDependencies = {}
): Promise<ScoredSessionRecoveryResult> {
  const environment = environmentOf(dependencies);
  const context = await frozenContext(environment);
  const secret = signingSecret(environment);
  const actorHash = deriveProbeActorHash(request, secret);
  const execution = phaseExecutionBinding(environment);
  let recovery: ScoredRecoveryClaims | null = null;
  let phase: "baseline" | "revised" | null = null;
  let selectedProtocolHash: string | null = null;
  for (const candidate of ["baseline", "revised"] as const) {
    try {
      const candidateProtocolHash = await runProtocolHash(environment, candidate, context);
      const binding = bindingFromFrozen({
        phase: candidate,
        commit: appCommit(environment),
        actorHash,
        reviewPackageHash: context.frozen.reviewPackageHash,
        frozenProtocolHash: candidateProtocolHash,
        freezeCandidateHash: context.frozen.freezeCandidateHash,
        phaseCallOffset: execution.phaseCallOffset,
        repairPhaseCallOffset: execution.repairPhaseCallOffset,
        predecessorProtocolHash: execution.predecessorProtocolHash,
        predecessorEvidenceDigest: execution.predecessorEvidenceDigest,
        predecessorRunId: execution.predecessorRunId,
        predecessorDisposition: execution.predecessorDisposition
      });
      recovery = verifyScoredRecovery({
        ...binding,
        cookieValue: cookie(request, SCORED_RECOVERY_COOKIE),
        signingSecret: secret,
        nowMs: nowOf(dependencies)
      });
      phase = candidate;
      selectedProtocolHash = candidateProtocolHash;
      break;
    } catch {
      // Try the other exact scored phase.
    }
  }
  if (!recovery || !phase || !selectedProtocolHash) {
    throw new ScoredServiceError("invalid_scored_recovery", 403);
  }
  if (documentId(request) !== input.documentId) {
    throw new ScoredServiceError("scored_document_mismatch", 403);
  }
  const session = issueRecoveredScoredSession({
    recovery,
    signingSecret: secret,
    nowMs: nowOf(dependencies)
  });
  const identity = await runIdentity({
    session: recovery,
    actorHash,
    orderedRunnerCaseIds: context.frozen.frozenManifest.schedule.orderedRunnerCaseIds
  });
  const guard = await readScoredGuardContext(environment, { allowUnsettled: true });
  const progress = await readScoredRunProgress(guard.redis, {
    phase,
    frozenProtocolHash: identity.frozenProtocolHash,
    runId: identity.runId
  });
  if (!progress) throw new ScoredServiceError("scored_run_missing", 409);
  if (progress.status === "active") {
    await acquireScoredRunOwner(guard.redis, {
      identity,
      documentId: input.documentId,
      artifactSecret: secret
    });
  }
  return Object.freeze({
    ...progressResponse({
      session: recovery,
      progress,
      csrfToken: session.csrfToken,
      sessionExpiresAt: session.claims.expiresAt,
      recoveryExpiresAt: recovery.expiresAt
    }),
    sessionCookieValue: session.cookieValue
  });
}

function scoredBoundary(initial: ProbeBoundaryEvidence<unknown>): ScoredBoundaryInput {
  return {
    fixtureId: CHECKOUT_FIXTURE_ID,
    fixtureVersion: CHECKOUT_FIXTURE_VERSION,
    fixtureSeed: CHECKOUT_FIXTURE_SEED,
    stateRevision: 0 as const,
    stateHash: CHECKOUT_FIXTURE_STATE_HASH,
    manifestHash: initial.manifestHash,
    registrationGeneration: initial.registrationGeneration,
    operationLedgerCount: 0 as const,
    currentTrajectoryCount: 0 as const,
    registeredToolNames: initial.registeredToolNames
  };
}

export async function issueScoredTrial(
  request: Request,
  body: {
    readonly initialBoundary: ProbeBoundaryEvidence<unknown>;
    readonly liveManifest: unknown;
  },
  dependencies: ScoredServiceDependencies = {}
): Promise<ScoredAuthorizationResponse> {
  const authenticated = await authenticateSession(request, dependencies);
  assertAuthenticatedGuardClean(authenticated);
  if (authenticated.snapshot.status !== "active") {
    throw new ScoredServiceError("scored_run_not_active", 409);
  }
  const runnerCaseId =
    authenticated.identity.orderedRunnerCaseIds[authenticated.snapshot.currentOrdinal];
  if (!runnerCaseId) throw new ScoredServiceError("scored_schedule_exhausted", 409);
  const expectedManifest = await createCheckoutLiveManifest(
    createCheckoutFixture(),
    authenticated.session.appCommit
  );
  if (
    canonicalJson(body.liveManifest) !== canonicalJson(expectedManifest) ||
    body.initialBoundary.stateHash !== CHECKOUT_FIXTURE_STATE_HASH ||
    body.initialBoundary.manifestHash !== expectedManifest.manifestHash ||
    canonicalJson([...body.initialBoundary.registeredToolNames].sort()) !==
      canonicalJson(["cart_get", "cart_update", "checkout_request", "order_review"])
  ) {
    throw new ScoredServiceError("scored_initial_boundary_mismatch", 409);
  }
  const trialId = `trial_${keyedHash(
    authenticated.secret,
    "trial",
    `${authenticated.session.frozenProtocolHash}.${authenticated.session.runId}.${authenticated.snapshot.currentOrdinal}.${authenticated.snapshot.currentAttempt}`
  ).slice(0, 22)}`;
  const envelope = await createGate3ScoredTrialEnvelope({
    purpose: authenticated.session.phase,
    freezeHash: authenticated.session.frozenProtocolHash,
    buildCommit: authenticated.session.appCommit,
    runId: authenticated.session.runId,
    runnerCaseId,
    trialId,
    liveManifest: expectedManifest,
    initialBoundary: scoredBoundary(body.initialBoundary)
  });
  const authorization = await issueScoredAuthorization({
    session: authenticated.session,
    runnerCaseId,
    trialId,
    ordinal: authenticated.snapshot.currentOrdinal,
    attempt: authenticated.snapshot.currentAttempt,
    envelopeHash: envelope.envelopeHash,
    signingSecret: authenticated.secret,
    nowMs: nowOf(dependencies)
  });
  const existing = await getProbeContinuation<{
    readonly envelope: ScoredTrialEnvelope;
    readonly authorization: ScoredAuthorization;
  }>(authenticated.guard.redis, {
    jti: authorization.claims.jti,
    stage: "issue",
    artifactSecret: authenticated.secret
  });
  let durableEnvelope = envelope;
  let durableAuthorization = authorization;
  if (existing) {
    if (canonicalJson(existing.payload.envelope) !== canonicalJson(envelope)) {
      throw new ScoredServiceError("scored_issue_recovery_mismatch", 409);
    }
    durableEnvelope = existing.payload.envelope;
    durableAuthorization = existing.payload.authorization;
  } else {
    const stored = await putProbeContinuation(authenticated.guard.redis, {
      jti: authorization.claims.jti,
      stage: "issue",
      payload: { envelope, authorization },
      artifactSecret: authenticated.secret
    });
    durableEnvelope = stored.payload.envelope;
    durableAuthorization = stored.payload.authorization;
  }
  await issueProbeAuthorization(authenticated.guard.redis, {
    ...authenticated.guard.identity,
    jti: durableAuthorization.claims.jti,
    claimsHash: durableAuthorization.claimsHash,
    purpose: authenticated.session.phase,
    subjectHash: durableAuthorization.claims.subjectHash,
    actorHash: authenticated.actorHash
  });
  return Object.freeze({
    status: "issued",
    runId: durableEnvelope.runId,
    caseId: durableEnvelope.caseId,
    trialId: durableEnvelope.trialId,
    authorization: {
      version: 1 as const,
      probeToken: durableAuthorization.token,
      envelope: durableEnvelope,
      claimsHash: durableAuthorization.claimsHash
    }
  });
}

export async function decideScoredTrial(
  request: Request,
  body: { readonly probeToken: string; readonly envelope: unknown },
  dependencies: ScoredServiceDependencies = {}
): Promise<ScoredFreshDecisionResponse> {
  const authenticated = await authenticateSession(request, dependencies, "decision-recovery");
  const { envelope, authorization } = await verifyAuthorization({
    authenticated,
    probeToken: body.probeToken,
    envelopeValue: body.envelope
  });
  const recovered = await getProbeContinuation<ScoredFreshDecisionResponse>(
    authenticated.guard.redis,
    { jti: authorization.claims.jti, stage: "decision", artifactSecret: authenticated.secret }
  );
  if (recovered) {
    const providerReceipt = await settleKnownScoredDecision({
      authenticated,
      envelope,
      authorization,
      providerReceipt: recovered.payload.providerReceipt
    });
    const response = freshDecisionResponse(providerReceipt);
    if (canonicalJson(response) !== canonicalJson(recovered.payload)) {
      throw new ScoredServiceError("scored_decision_recovery_mismatch", 500, true);
    }
    return response;
  }
  assertAuthenticatedGuardClean(authenticated);
  const durableGrant = await readScoredLedgerRecord(authenticated.guard.redis, {
    ...authenticated.guard.identity,
    jti: authorization.claims.jti
  });
  if (
    !durableGrant ||
    durableGrant.claimsHash !== authorization.claimsHash ||
    durableGrant.purpose !== authenticated.session.phase
  ) {
    throw new ScoredServiceError("scored_authorization_record_mismatch", 409);
  }
  if (durableGrant.state !== "ISSUED") {
    throw new ScoredServiceError(
      durableGrant.state === "KNOWN"
        ? "scored_known_decision_receipt_unrecoverable"
        : "scored_provider_dispatch_already_admitted",
      409,
      durableGrant.state === "IN_FLIGHT" ||
        durableGrant.state === "KNOWN" ||
        durableGrant.state === "UNCERTAIN"
    );
  }
  let providerReceipt: ScoredProviderKnownReceipt;
  try {
    providerReceipt = await decideScoredWithOpenAi({
      envelope,
      apiKey: requiredEnvironment(authenticated.environment, "OPENAI_API_KEY"),
      safetyIdentifier: keyedHash(
        authenticated.secret,
        "provider-safety",
        `${authenticated.session.frozenProtocolHash}.${authenticated.session.runId}`
      ),
      ...(dependencies.nowMs ? { now: dependencies.nowMs } : {}),
      beforeDispatch: async () => {
        await beginProbeCall(authenticated.guard.redis, {
          ...authenticated.guard.identity,
          jti: authorization.claims.jti,
          claimsHash: authorization.claimsHash,
          purpose: authenticated.session.phase
        });
      }
    });
  } catch (error) {
    if (error instanceof ScoredProviderError && error.dispatch === "after_dispatch_uncertain") {
      await recordScoredRunAttempt(authenticated.guard.redis, {
        identity: authenticated.identity,
        documentId: authenticated.documentId,
        artifactSecret: authenticated.secret,
        attempt: {
          version: SCORED_RUN_ATTEMPT_VERSION,
          ordinal: authenticated.snapshot.currentOrdinal,
          attempt: authenticated.snapshot.currentAttempt,
          runnerCaseId: envelope.caseId,
          disposition: "infrastructure-invalid",
          infrastructureRetryEligible: false,
          usableModelDecisionMade: false,
          targetExecutionMade: false,
          capturedAt: new Date(nowOf(dependencies)).toISOString(),
          evidence: {
            version: "toolproof-scored-provider-uncertain@1.0.0",
            code: error.code,
            inferencePerformed: true,
            authorizationJti: authorization.claims.jti,
            envelopeHash: envelope.envelopeHash,
            httpStatus: error.httpStatus,
            rawModelResponse: error.evidence?.rawResponseBytes ?? null,
            rawModelResponseHash: error.evidence
              ? await sha256Hex(error.evidence.rawResponseBytes)
              : null
          }
        },
        terminalReason: error.code
      });
      await settleProbeCallUncertain(authenticated.guard.redis, {
        ...authenticated.guard.identity,
        jti: authorization.claims.jti,
        settlementDigest: await canonicalSha256({
          version: "toolproof-scored-uncertain-settlement@1.0.0",
          jti: authorization.claims.jti,
          envelopeHash: envelope.envelopeHash,
          code: error.code
        }),
        reason: error.code
      });
      throw new ScoredServiceError(error.code, 502, true);
    }
    throw new ScoredServiceError(
      error instanceof Error ? error.message : "scored_decision_failed",
      503,
      false
    );
  }
  const response = freshDecisionResponse(providerReceipt);
  await putProbeContinuation(authenticated.guard.redis, {
    jti: authorization.claims.jti,
    stage: "decision",
    payload: response,
    artifactSecret: authenticated.secret
  });
  const settledReceipt = await settleKnownScoredDecision({
    authenticated,
    envelope,
    authorization,
    providerReceipt
  });
  return freshDecisionResponse(settledReceipt);
}

export async function admitScoredNative(
  request: Request,
  body: {
    readonly probeToken: string;
    readonly envelope: unknown;
    readonly decision: unknown;
    readonly registrationGeneration: number;
  },
  dependencies: ScoredServiceDependencies = {}
): Promise<{
  readonly status: "admitted" | "already-admitted";
  readonly admission: ScoredNativeAdmission;
}> {
  const authenticated = await authenticateSession(request, dependencies);
  assertAuthenticatedGuardClean(authenticated);
  const { envelope, authorization } = await verifyAuthorization({
    authenticated,
    probeToken: body.probeToken,
    envelopeValue: body.envelope
  });
  const decisionContinuation = await getProbeContinuation<ScoredFreshDecisionResponse>(
    authenticated.guard.redis,
    { jti: authorization.claims.jti, stage: "decision", artifactSecret: authenticated.secret }
  );
  if (
    !decisionContinuation ||
    canonicalJson(decisionContinuation.payload.decision) !== canonicalJson(body.decision)
  ) {
    throw new ScoredServiceError("scored_decision_continuation_missing", 409);
  }
  const admission = await createScoredNativeAdmission({
    envelope,
    decision: decisionContinuation.payload.decision!
  });
  if (admission.registrationGeneration !== body.registrationGeneration) {
    throw new ScoredServiceError("scored_native_generation_mismatch", 409);
  }
  const stored = await putProbeContinuation(authenticated.guard.redis, {
    jti: authorization.claims.jti,
    stage: "native",
    payload: admission,
    artifactSecret: authenticated.secret
  });
  return Object.freeze({
    status: stored.disposition === "new" ? "admitted" : "already-admitted",
    admission
  });
}

export async function completeScoredTrial(
  request: Request,
  body: {
    readonly probeToken: string;
    readonly envelope: unknown;
    readonly completion: unknown;
  },
  dependencies: ScoredServiceDependencies = {}
) {
  const authenticated = await authenticateSession(request, dependencies);
  assertAuthenticatedGuardClean(authenticated);
  const { envelope, authorization } = await verifyAuthorization({
    authenticated,
    probeToken: body.probeToken,
    envelopeValue: body.envelope
  });
  const decisionContinuation = await getProbeContinuation<ScoredFreshDecisionResponse>(
    authenticated.guard.redis,
    { jti: authorization.claims.jti, stage: "decision", artifactSecret: authenticated.secret }
  );
  if (!decisionContinuation) throw new ScoredServiceError("scored_decision_missing", 409);
  const decision = decisionContinuation.payload.providerReceipt.decision;
  const nativeContinuation = await getProbeContinuation<ScoredNativeAdmission>(
    authenticated.guard.redis,
    { jti: authorization.claims.jti, stage: "native", artifactSecret: authenticated.secret }
  );
  if ((decision?.kind === "call") !== Boolean(nativeContinuation)) {
    throw new ScoredServiceError("scored_native_continuation_mismatch", 409);
  }
  const verifiedNativeAdmission =
    decision?.kind === "call" && nativeContinuation
      ? await verifyScoredNativeAdmission({
          envelope,
          decision,
          admission: nativeContinuation.payload
        })
      : null;
  const completion = body.completion as ProbeClientCompletionInput<
    FallbackResetEvidence,
    FallbackTrialEvidence
  >;
  if (
    !completion ||
    typeof completion !== "object" ||
    (completion.nativeDispatchCount !== 0 && completion.nativeDispatchCount !== 1) ||
    !completion.evidence ||
    !completion.postResetBoundary
  ) {
    throw new ScoredServiceError("scored_completion_invalid", 400);
  }
  const row = await buildGate3ScoredEvidenceRow({
    phase: authenticated.session.phase,
    ordinal: authenticated.snapshot.currentOrdinal,
    attempt: authenticated.snapshot.currentAttempt,
    runnerCaseId: envelope.caseId,
    appCommit: authenticated.session.appCommit,
    manifestHash: envelope.liveManifest.manifestHash,
    envelope,
    providerReceipt: decisionContinuation.payload.providerReceipt,
    nativeAdmission: verifiedNativeAdmission,
    trialEvidence: completion.evidence,
    postResetBoundary: completion.postResetBoundary
  });
  const attempt: ScoredRunAttempt = {
    version: SCORED_RUN_ATTEMPT_VERSION,
    ordinal: authenticated.snapshot.currentOrdinal,
    attempt: authenticated.snapshot.currentAttempt,
    runnerCaseId: envelope.caseId,
    disposition: row.evaluation.disposition === "scored" ? "scored" : "infrastructure-invalid",
    infrastructureRetryEligible: row.evaluation.infrastructureRetryEligible,
    usableModelDecisionMade: decision !== null,
    targetExecutionMade: completion.nativeDispatchCount === 1,
    capturedAt: row.trialEvidence.capturedAt,
    evidence: JSON.parse(
      canonicalJson({
        authorizationJti: authorization.claims.jti,
        authorizationClaimsHash: authorization.claimsHash,
        authorizationSubjectHash: authorization.claims.subjectHash,
        row
      })
    ) as ScoredRunAttempt["evidence"]
  };
  const progress = await recordScoredRunAttempt(authenticated.guard.redis, {
    identity: authenticated.identity,
    documentId: authenticated.documentId,
    artifactSecret: authenticated.secret,
    attempt
  });
  await putProbeContinuation(authenticated.guard.redis, {
    jti: authorization.claims.jti,
    stage: "completion",
    payload: { rowDigest: row.rowDigest, progress },
    artifactSecret: authenticated.secret
  });
  return Object.freeze({
    status: "sealed" as const,
    completedCount: progress.completedCount,
    remainingCount: progress.remainingCount,
    terminal: progress.status !== "active",
    runStatus: progress.status
  });
}

export async function recordScoredTrialFailure(
  request: Request,
  body: ScoredFailureBody,
  dependencies: ScoredServiceDependencies = {}
) {
  const authenticated = await authenticateSession(request, dependencies, "failure-reconciliation");
  if (authenticated.snapshot.status !== "active") {
    return Object.freeze({ progress: authenticated.snapshot, inferencePerformed: false });
  }
  let authorization: ScoredAuthorization | null = null;
  let decisionPresent = false;
  let nativePresent = false;
  if (body.probeToken && body.envelope) {
    const verified = await verifyAuthorization({
      authenticated,
      probeToken: body.probeToken,
      envelopeValue: body.envelope
    });
    authorization = verified.authorization;
    decisionPresent = Boolean(
      await getProbeContinuation(authenticated.guard.redis, {
        jti: authorization.claims.jti,
        stage: "decision",
        artifactSecret: authenticated.secret
      })
    );
    nativePresent = Boolean(
      await getProbeContinuation(authenticated.guard.redis, {
        jti: authorization.claims.jti,
        stage: "native",
        artifactSecret: authenticated.secret
      })
    );
  }
  const currentRunnerCaseId =
    authenticated.identity.orderedRunnerCaseIds[authenticated.snapshot.currentOrdinal];
  if (!currentRunnerCaseId) throw new ScoredServiceError("scored_schedule_exhausted", 409);
  const authorizationIdentity = authorization
    ? { jti: authorization.claims.jti, subjectHash: authorization.claims.subjectHash }
    : await deriveScoredAuthorizationIdentity({
        session: authenticated.session,
        runnerCaseId: currentRunnerCaseId,
        ordinal: authenticated.snapshot.currentOrdinal,
        attempt: authenticated.snapshot.currentAttempt,
        signingSecret: authenticated.secret
      });
  const ledgerRecord = await readScoredLedgerRecord(authenticated.guard.redis, {
    ...authenticated.guard.identity,
    jti: authorizationIdentity.jti
  });
  const durableInferencePerformed =
    body.inferencePerformed ||
    ledgerRecord?.state === "IN_FLIGHT" ||
    ledgerRecord?.state === "KNOWN" ||
    ledgerRecord?.state === "UNCERTAIN";
  const eligible = scoredInfrastructureReplacementEligible({
    attempt: authenticated.snapshot.currentAttempt,
    clientInferencePerformed: durableInferencePerformed,
    clientNativeCallMade: body.nativeCallMade,
    decisionContinuationPresent: decisionPresent,
    nativeAdmissionPresent: nativePresent,
    durableGrantState: ledgerRecord?.state ?? null
  });
  const runnerCaseId = currentRunnerCaseId;
  const attempt: ScoredRunAttempt = {
    version: SCORED_RUN_ATTEMPT_VERSION,
    ordinal: authenticated.snapshot.currentOrdinal,
    attempt: authenticated.snapshot.currentAttempt,
    runnerCaseId,
    disposition: "infrastructure-invalid",
    infrastructureRetryEligible: eligible,
    usableModelDecisionMade: decisionPresent,
    targetExecutionMade: body.nativeCallMade,
    capturedAt: new Date(nowOf(dependencies)).toISOString(),
    evidence: {
      version: "toolproof-scored-infrastructure-failure@1.0.0",
      stage: body.stage,
      code: body.code,
      message: body.message,
      inferencePerformed: durableInferencePerformed,
      nativeCallMade: body.nativeCallMade,
      authorizationJti: authorizationIdentity.jti,
      authorizationClaimsHash: authorization?.claimsHash ?? null,
      authorizationSubjectHash: authorizationIdentity.subjectHash,
      nativeAdmissionMade: nativePresent,
      durableGrantState: ledgerRecord?.state ?? null
    }
  };
  const progress = await recordScoredRunAttempt(authenticated.guard.redis, {
    identity: authenticated.identity,
    documentId: authenticated.documentId,
    artifactSecret: authenticated.secret,
    attempt,
    terminalReason: eligible ? "replacement_admitted" : body.code
  });
  if (ledgerRecord?.state === "IN_FLIGHT") {
    await settleProbeCallUncertain(authenticated.guard.redis, {
      ...authenticated.guard.identity,
      jti: authorizationIdentity.jti,
      settlementDigest: await canonicalSha256({
        version: "toolproof-scored-uncertain-settlement@1.0.0",
        jti: authorizationIdentity.jti,
        code: body.code,
        runId: authenticated.session.runId,
        ordinal: authenticated.snapshot.currentOrdinal,
        attempt: authenticated.snapshot.currentAttempt
      }),
      reason: body.code
    });
  }
  return Object.freeze({ progress, inferencePerformed: durableInferencePerformed });
}

function exactRecordKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return canonicalJson(Object.keys(value).sort()) === canonicalJson([...expected].sort());
}

function hashValue(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function jtiValue(value: unknown): value is string {
  return typeof value === "string" && /^jti_[A-Za-z0-9_-]{22,64}$/u.test(value);
}

function assertRowBundleBinding(
  row: Gate3ScoredEvidenceRow,
  binding: Gate3BundleExpectedBinding
): void {
  const envelope = row.envelope as unknown as ScoredTrialEnvelope;
  if (
    (binding.phase !== undefined && row.phase !== binding.phase) ||
    (binding.runId !== undefined && envelope.runId !== binding.runId) ||
    (binding.appCommit !== undefined && envelope.buildCommit !== binding.appCommit) ||
    (binding.frozenProtocolHash !== undefined &&
      envelope.runBinding.freezeHash !== binding.frozenProtocolHash)
  ) {
    throw new ScoredServiceError("scored_bundle_row_root_binding_mismatch", 500);
  }
}

async function verifyAttemptEvidence(
  attemptValue: ScoredRunAttempt,
  binding: Gate3BundleExpectedBinding = {}
): Promise<Gate3ScoredEvidenceRow | null> {
  const attempt = scoredRunAttemptSchema.parse(attemptValue);
  const evidence = attempt.evidence as Record<string, unknown>;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new ScoredServiceError("scored_bundle_attempt_evidence_invalid", 500);
  }
  if ("row" in evidence) {
    const row = evidence.row as Gate3ScoredEvidenceRow | undefined;
    if (
      !exactRecordKeys(evidence, [
        "authorizationClaimsHash",
        "authorizationJti",
        "authorizationSubjectHash",
        "row"
      ]) ||
      !row ||
      row.version !== GATE3_SCORED_EVIDENCE_ROW_VERSION ||
      row.ordinal !== attempt.ordinal ||
      row.attempt !== attempt.attempt ||
      row.runnerCaseId !== attempt.runnerCaseId ||
      !jtiValue(evidence.authorizationJti) ||
      !hashValue(evidence.authorizationClaimsHash) ||
      !hashValue(evidence.authorizationSubjectHash)
    ) {
      throw new ScoredServiceError("scored_bundle_row_invalid", 500);
    }
    const { rowDigest, ...payload } = row;
    if (!/^[a-f0-9]{64}$/u.test(rowDigest) || (await canonicalSha256(payload)) !== rowDigest) {
      throw new ScoredServiceError("scored_bundle_row_invalid", 500);
    }
    const envelope = await verifyExpectationFreeScoredEnvelope(row.envelope);
    const rebuilt = await buildGate3ScoredEvidenceRow({
      phase: row.phase,
      ordinal: row.ordinal,
      attempt: row.attempt,
      runnerCaseId: row.runnerCaseId,
      appCommit: envelope.buildCommit,
      manifestHash: envelope.liveManifest.manifestHash,
      envelope,
      providerReceipt: row.providerReceipt,
      nativeAdmission: row.nativeAdmission,
      trialEvidence: row.trialEvidence,
      postResetBoundary: row.postResetBoundary as unknown as ProbeBoundaryEvidence<unknown>
    });
    if (
      canonicalJson(rebuilt) !== canonicalJson(row) ||
      row.evaluation.disposition !== attempt.disposition ||
      row.evaluation.infrastructureRetryEligible !== attempt.infrastructureRetryEligible ||
      attempt.usableModelDecisionMade !== (row.providerReceipt.decision !== null) ||
      attempt.targetExecutionMade !== (row.nativeAdmission !== null)
    ) {
      throw new ScoredServiceError("scored_bundle_row_reverification_failed", 500);
    }
    assertRowBundleBinding(row, binding);
    return row;
  }
  if (attempt.disposition === "scored") {
    throw new ScoredServiceError("scored_bundle_row_missing", 500);
  }
  if (evidence.version === "toolproof-scored-provider-uncertain@1.0.0") {
    if (
      !exactRecordKeys(evidence, [
        "authorizationJti",
        "code",
        "envelopeHash",
        "httpStatus",
        "inferencePerformed",
        "rawModelResponse",
        "rawModelResponseHash",
        "version"
      ]) ||
      !jtiValue(evidence.authorizationJti) ||
      !hashValue(evidence.envelopeHash) ||
      evidence.inferencePerformed !== true ||
      !(
        evidence.httpStatus === null ||
        (nonnegativeInteger(evidence.httpStatus) && Number(evidence.httpStatus) <= 599)
      ) ||
      !(
        (evidence.rawModelResponse === null && evidence.rawModelResponseHash === null) ||
        (typeof evidence.rawModelResponse === "string" &&
          evidence.rawModelResponse.length <= 128 * 1_024 &&
          hashValue(evidence.rawModelResponseHash) &&
          (await sha256Hex(evidence.rawModelResponse)) === evidence.rawModelResponseHash)
      ) ||
      typeof evidence.code !== "string" ||
      evidence.code.length < 1 ||
      evidence.code.length > 160 ||
      attempt.infrastructureRetryEligible ||
      attempt.usableModelDecisionMade ||
      attempt.targetExecutionMade
    ) {
      throw new ScoredServiceError("scored_bundle_uncertain_evidence_invalid", 500);
    }
    return null;
  }
  if (evidence.version === "toolproof-scored-infrastructure-failure@1.0.0") {
    const durableGrantState = evidence.durableGrantState;
    if (
      !exactRecordKeys(evidence, [
        "authorizationClaimsHash",
        "authorizationJti",
        "authorizationSubjectHash",
        "code",
        "durableGrantState",
        "inferencePerformed",
        "message",
        "nativeAdmissionMade",
        "nativeCallMade",
        "stage",
        "version"
      ]) ||
      !jtiValue(evidence.authorizationJti) ||
      !(evidence.authorizationClaimsHash === null || hashValue(evidence.authorizationClaimsHash)) ||
      !hashValue(evidence.authorizationSubjectHash) ||
      typeof evidence.stage !== "string" ||
      evidence.stage.length < 1 ||
      evidence.stage.length > 64 ||
      typeof evidence.code !== "string" ||
      evidence.code.length < 1 ||
      evidence.code.length > 160 ||
      typeof evidence.message !== "string" ||
      evidence.message.length < 1 ||
      evidence.message.length > 1_000 ||
      typeof evidence.inferencePerformed !== "boolean" ||
      typeof evidence.nativeCallMade !== "boolean" ||
      typeof evidence.nativeAdmissionMade !== "boolean" ||
      !(
        durableGrantState === null ||
        ["ISSUED", "IN_FLIGHT", "KNOWN", "UNCERTAIN", "EXPIRED"].includes(String(durableGrantState))
      ) ||
      (attempt.usableModelDecisionMade && evidence.inferencePerformed !== true) ||
      attempt.targetExecutionMade !== evidence.nativeCallMade
    ) {
      throw new ScoredServiceError("scored_bundle_infrastructure_evidence_invalid", 500);
    }
    return null;
  }
  throw new ScoredServiceError("scored_bundle_attempt_evidence_unknown", 500);
}

async function verifyAttemptLedgerBinding(
  attempt: ScoredRunAttempt,
  authenticated: Awaited<ReturnType<typeof authenticateSession>>
): Promise<0 | 1> {
  const evidence = attempt.evidence as Record<string, unknown>;
  const jti = evidence.authorizationJti;
  if (typeof jti !== "string") {
    throw new ScoredServiceError("scored_bundle_jti_missing", 500);
  }
  const record = await readScoredLedgerRecord(authenticated.guard.redis, {
    ...authenticated.guard.identity,
    jti
  });
  const row = evidence.row as Gate3ScoredEvidenceRow | undefined;
  if (row) {
    const claimsHash = evidence.authorizationClaimsHash;
    const expectedSettlementDigest = await canonicalSha256({
      version: "toolproof-scored-known-settlement@1.0.0",
      jti,
      envelopeHash: row.providerReceipt.envelopeHash,
      providerResponseHash: row.providerReceipt.rawResponseHash,
      usageHash: row.providerReceipt.usageHash,
      actualNanoUsd: row.providerReceipt.usage.accountedNanoUsd
    });
    if (
      !record ||
      record.state !== "KNOWN" ||
      record.claimsHash !== claimsHash ||
      record.purpose !== row.phase ||
      record.actualNanoUsd !== row.providerReceipt.usage.accountedNanoUsd ||
      record.providerResponseHash !== row.providerReceipt.rawResponseHash ||
      record.usageHash !== row.providerReceipt.usageHash ||
      record.settlementDigest !== expectedSettlementDigest ||
      record.dispatchSequence === null
    ) {
      throw new ScoredServiceError("scored_bundle_known_ledger_mismatch", 500);
    }
    return 1;
  }
  if (attempt.disposition !== "scored") {
    const inferencePerformed =
      objectBoolean(evidence, "inferencePerformed") ??
      objectBoolean(
        typeof evidence.row === "object" && evidence.row !== null
          ? (evidence.row as Record<string, unknown>)
          : {},
        "inferencePerformed"
      ) ??
      false;
    if (
      inferencePerformed &&
      (!record ||
        (record.state !== "IN_FLIGHT" && record.state !== "KNOWN" && record.state !== "UNCERTAIN"))
    ) {
      throw new ScoredServiceError("scored_bundle_uncertain_ledger_missing", 500);
    }
    return record?.dispatchSequence === null || record?.dispatchSequence === undefined ? 0 : 1;
  }
  throw new ScoredServiceError("scored_bundle_known_row_missing", 500);
}

function objectBoolean(record: Record<string, unknown>, key: string): boolean | null {
  return typeof record[key] === "boolean" ? (record[key] as boolean) : null;
}

async function reconcileTerminalInflightAttempts(
  authenticated: Awaited<ReturnType<typeof authenticateSession>>
) {
  for (const attempt of authenticated.snapshot.attempts) {
    if (attempt.disposition === "scored") continue;
    const evidence = attempt.evidence as Record<string, unknown>;
    const jti = evidence.authorizationJti;
    if (typeof jti !== "string") continue;
    const record = await readScoredLedgerRecord(authenticated.guard.redis, {
      ...authenticated.guard.identity,
      jti
    });
    if (record?.state !== "IN_FLIGHT") continue;
    const code =
      typeof evidence.code === "string" && evidence.code.length > 0
        ? evidence.code
        : "terminal_provider_dispatch_uncertain";
    await settleProbeCallUncertain(authenticated.guard.redis, {
      ...authenticated.guard.identity,
      jti,
      settlementDigest: await canonicalSha256({
        version: "toolproof-scored-uncertain-settlement@1.0.0",
        jti,
        code,
        runId: authenticated.session.runId,
        ordinal: attempt.ordinal,
        attempt: attempt.attempt
      }),
      reason: code
    });
  }
  return readScoredGuardContext(authenticated.environment, { allowUnsettled: true });
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function assertExpectedBundleBinding(
  value: Gate3BundleExpectedBinding,
  expected: Gate3BundleExpectedBinding
): void {
  for (const key of [
    "phase",
    "runId",
    "appCommit",
    "reviewPackageHash",
    "frozenProtocolHash",
    "freezeCandidateHash",
    "scheduleHash",
    "phaseCallOffset",
    "repairPhaseCallOffset",
    "predecessorProtocolHash",
    "predecessorEvidenceDigest",
    "predecessorRunId",
    "predecessorDisposition"
  ] as const) {
    if (expected[key] !== undefined && value[key] !== expected[key]) {
      throw new ScoredServiceError("scored_bundle_expected_binding_mismatch", 500);
    }
  }
}

export async function verifyGate3ScoredBundle(
  value: unknown,
  expected: Gate3BundleExpectedBinding = {}
): Promise<Gate3ScoredBundle> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ScoredServiceError("scored_bundle_invalid", 500);
  }
  const root = value as Record<string, unknown>;
  const repairOffsetPresent = Object.hasOwn(root, "repairPhaseCallOffset");
  const predecessorDispositionPresent = Object.hasOwn(root, "predecessorDisposition");
  const legacyBundle = !repairOffsetPresent && !predecessorDispositionPresent;
  if (
    repairOffsetPresent !== predecessorDispositionPresent ||
    !exactRecordKeys(root, [
      "appCommit",
      "attemptCount",
      "attemptManifestDigest",
      "attempts",
      "completedCount",
      "evidenceDigest",
      "freezeCandidateHash",
      "frozenProtocolHash",
      "guard",
      "orderedRunnerCaseIds",
      "phase",
      "phaseCallOffset",
      ...(legacyBundle ? [] : ["repairPhaseCallOffset", "predecessorDisposition"]),
      "predecessorEvidenceDigest",
      "predecessorProtocolHash",
      "predecessorRunId",
      "reviewPackageHash",
      "runId",
      "scheduleHash",
      "status",
      "transportFailureCount",
      "version"
    ]) ||
    !root.guard ||
    typeof root.guard !== "object" ||
    Array.isArray(root.guard) ||
    !exactRecordKeys(root.guard as Record<string, unknown>, [
      "baselineCalls",
      "claimedCalls",
      "committedNanoUsd",
      "knownActualNanoUsd",
      "knownCalls",
      "pendingCount",
      "revisedCalls",
      "uncertainCount"
    ])
  ) {
    throw new ScoredServiceError("scored_bundle_schema_invalid", 500);
  }
  const bundle = value as Gate3ScoredBundle;
  const repairPhaseCallOffset = legacyBundle ? 0 : bundle.repairPhaseCallOffset;
  const legacyPredecessorPresent =
    bundle.predecessorProtocolHash !== null ||
    bundle.predecessorEvidenceDigest !== null ||
    bundle.predecessorRunId !== null;
  const predecessorDisposition = legacyBundle
    ? legacyPredecessorPresent
      ? "invalid-schedule"
      : null
    : bundle.predecessorDisposition;
  const { evidenceDigest, ...payload } = bundle;
  const derivedOrder = await deriveSemanticCaseOrder(
    GATE3_ORDER_SEED,
    GATE3_SEMANTIC_SUITE.scoredCases.map(({ runnerCaseId }) => runnerCaseId)
  );
  const derivedScheduleHash = await canonicalSha256({
    version: SCORED_RUN_SCHEDULE_VERSION,
    orderedRunnerCaseIds: derivedOrder
  });
  const predecessorPresent =
    bundle.predecessorProtocolHash !== null ||
    bundle.predecessorEvidenceDigest !== null ||
    bundle.predecessorRunId !== null ||
    predecessorDisposition !== null;
  const guardValues = Object.values(bundle.guard);
  if (
    bundle.version !== GATE3_SCORED_BUNDLE_VERSION ||
    (bundle.phase !== "baseline" && bundle.phase !== "revised") ||
    !/^run_[A-Za-z0-9_-]{22}$/u.test(bundle.runId) ||
    !/^[a-f0-9]{40}$/u.test(bundle.appCommit) ||
    !hashValue(bundle.reviewPackageHash) ||
    !hashValue(bundle.frozenProtocolHash) ||
    !hashValue(bundle.freezeCandidateHash) ||
    bundle.scheduleHash !== derivedScheduleHash ||
    canonicalJson(bundle.orderedRunnerCaseIds) !== canonicalJson(derivedOrder) ||
    !nonnegativeInteger(bundle.phaseCallOffset) ||
    bundle.phaseCallOffset > 46 ||
    (repairPhaseCallOffset !== 0 && repairPhaseCallOffset !== 1) ||
    (predecessorPresent &&
      (!hashValue(bundle.predecessorProtocolHash) ||
        !hashValue(bundle.predecessorEvidenceDigest) ||
        typeof bundle.predecessorRunId !== "string" ||
        !/^run_[A-Za-z0-9_-]{22}$/u.test(bundle.predecessorRunId) ||
        !SCORED_PREDECESSOR_DISPOSITIONS.includes(
          predecessorDisposition as ScoredPredecessorDisposition
        ))) ||
    (!predecessorPresent && bundle.phaseCallOffset !== 0) ||
    (bundle.status !== "terminal-complete" && bundle.status !== "terminal-invalid") ||
    !nonnegativeInteger(bundle.completedCount) ||
    bundle.completedCount > SCORED_RUN_CASE_COUNT ||
    !nonnegativeInteger(bundle.attemptCount) ||
    bundle.attemptCount < 1 ||
    bundle.attemptCount > SCORED_RUN_CASE_COUNT * 2 ||
    !nonnegativeInteger(bundle.transportFailureCount) ||
    !hashValue(bundle.attemptManifestDigest) ||
    guardValues.some((nested) => !nonnegativeInteger(nested)) ||
    bundle.guard.pendingCount !== 0 ||
    !/^[a-f0-9]{64}$/u.test(evidenceDigest) ||
    (await canonicalSha256(payload)) !== evidenceDigest ||
    !Array.isArray(bundle.attempts) ||
    !Array.isArray(bundle.orderedRunnerCaseIds) ||
    bundle.orderedRunnerCaseIds.length !== SCORED_RUN_CASE_COUNT ||
    new Set(bundle.orderedRunnerCaseIds).size !== SCORED_RUN_CASE_COUNT ||
    bundle.attempts.length !== bundle.attemptCount
  ) {
    throw new ScoredServiceError("scored_bundle_invalid", 500);
  }
  assertExpectedBundleBinding(bundle, expected);
  const parsedAttempts = bundle.attempts.map((attempt) => scoredRunAttemptSchema.parse(attempt));
  const attemptManifest = await Promise.all(
    parsedAttempts.map(async (attempt) => ({
      ordinal: attempt.ordinal,
      attempt: attempt.attempt,
      digest: await canonicalSha256(attempt)
    }))
  );
  if ((await canonicalSha256(attemptManifest)) !== bundle.attemptManifestDigest) {
    throw new ScoredServiceError("scored_bundle_attempt_manifest_invalid", 500);
  }
  let scoredCount = 0;
  let infrastructureCount = 0;
  let expectedOrdinal = 0;
  let cursor = 0;
  let terminalInvalid = false;
  const eventIds = new Set<string>();
  const providerResponseHashes = new Set<string>();
  const authorizationJtis = new Set<string>();
  while (cursor < parsedAttempts.length) {
    const attempt = parsedAttempts[cursor]!;
    if (
      attempt.ordinal !== expectedOrdinal ||
      attempt.attempt !== 0 ||
      attempt.runnerCaseId !== bundle.orderedRunnerCaseIds[attempt.ordinal] ||
      expectedOrdinal >= SCORED_RUN_CASE_COUNT
    ) {
      throw new ScoredServiceError("scored_bundle_schedule_invalid", 500);
    }
    const group = [attempt];
    if (attempt.disposition === "infrastructure-invalid") {
      infrastructureCount += 1;
      if (attempt.infrastructureRetryEligible) {
        const replacement = parsedAttempts[cursor + 1];
        if (
          !replacement ||
          replacement.ordinal !== expectedOrdinal ||
          replacement.attempt !== 1 ||
          replacement.runnerCaseId !== attempt.runnerCaseId ||
          replacement.infrastructureRetryEligible
        ) {
          throw new ScoredServiceError("scored_bundle_retry_topology_invalid", 500);
        }
        group.push(replacement);
        cursor += 1;
        if (replacement.disposition === "infrastructure-invalid") {
          infrastructureCount += 1;
          terminalInvalid = true;
        } else {
          scoredCount += 1;
        }
      } else {
        terminalInvalid = true;
      }
    } else {
      scoredCount += 1;
    }
    for (const groupedAttempt of group) {
      const row = await verifyAttemptEvidence(groupedAttempt, bundle);
      const evidence = groupedAttempt.evidence as Record<string, unknown>;
      const jti = evidence.authorizationJti;
      if (!jtiValue(jti) || authorizationJtis.has(jti)) {
        throw new ScoredServiceError("scored_bundle_jti_duplicate", 500);
      }
      authorizationJtis.add(jti);
      if (row) {
        const trace = (row.trialEvidence.currentTraces as unknown as readonly OperationTrace[])[0];
        if (trace) {
          if (eventIds.has(trace.eventId)) {
            throw new ScoredServiceError("scored_bundle_trace_replay", 500);
          }
          eventIds.add(trace.eventId);
        }
        if (providerResponseHashes.has(row.providerReceipt.rawResponseHash)) {
          throw new ScoredServiceError("scored_bundle_provider_replay", 500);
        }
        providerResponseHashes.add(row.providerReceipt.rawResponseHash);
      }
    }
    cursor += 1;
    if (terminalInvalid) break;
    expectedOrdinal += 1;
  }
  if (
    cursor !== parsedAttempts.length ||
    bundle.completedCount !== scoredCount ||
    bundle.transportFailureCount !== infrastructureCount ||
    (bundle.status === "terminal-complete" &&
      (terminalInvalid || scoredCount !== SCORED_RUN_CASE_COUNT || expectedOrdinal !== 24)) ||
    (bundle.status === "terminal-invalid" && !terminalInvalid)
  ) {
    throw new ScoredServiceError("scored_bundle_count_invalid", 500);
  }
  return Object.freeze(JSON.parse(canonicalJson(bundle)) as Gate3ScoredBundle);
}

export async function verifyGate3BaselineRevealBundle(
  value: unknown,
  expected: Gate3BundleExpectedBinding = {}
): Promise<Gate3BaselineRevealBundle> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ScoredServiceError("baseline_reveal_invalid", 500);
  }
  const root = value as Record<string, unknown>;
  const repairOffsetPresent = Object.hasOwn(root, "repairPhaseCallOffset");
  const predecessorDispositionPresent = Object.hasOwn(root, "predecessorDisposition");
  const legacyBundle = !repairOffsetPresent && !predecessorDispositionPresent;
  if (
    repairOffsetPresent !== predecessorDispositionPresent ||
    !exactRecordKeys(root, [
      "appCommit",
      "attemptCount",
      "completedCount",
      "developmentAttempts",
      "developmentDigest",
      "freezeCandidateHash",
      "frozenProtocolHash",
      "guard",
      "phase",
      "phaseCallOffset",
      ...(legacyBundle ? [] : ["repairPhaseCallOffset", "predecessorDisposition"]),
      "predecessorEvidenceDigest",
      "predecessorProtocolHash",
      "predecessorRunId",
      "revealDigest",
      "reviewPackageHash",
      "runId",
      "sealedHoldout",
      "status",
      "terminalEvidenceDigest",
      "transportFailureCount",
      "version"
    ]) ||
    !root.guard ||
    typeof root.guard !== "object" ||
    Array.isArray(root.guard) ||
    !exactRecordKeys(root.guard as Record<string, unknown>, [
      "baselineCalls",
      "claimedCalls",
      "committedNanoUsd",
      "knownActualNanoUsd",
      "knownCalls",
      "pendingCount",
      "revisedCalls",
      "uncertainCount"
    ]) ||
    !root.sealedHoldout ||
    typeof root.sealedHoldout !== "object" ||
    Array.isArray(root.sealedHoldout) ||
    !exactRecordKeys(root.sealedHoldout as Record<string, unknown>, [
      "attemptCount",
      "caseCount",
      "commitmentDigest",
      "disclosure"
    ])
  ) {
    throw new ScoredServiceError("baseline_reveal_schema_invalid", 500);
  }
  const reveal = value as Gate3BaselineRevealBundle;
  const repairPhaseCallOffset = legacyBundle ? 0 : reveal.repairPhaseCallOffset;
  const legacyPredecessorPresent =
    reveal.predecessorProtocolHash !== null ||
    reveal.predecessorEvidenceDigest !== null ||
    reveal.predecessorRunId !== null;
  const predecessorDisposition = legacyBundle
    ? legacyPredecessorPresent
      ? "invalid-schedule"
      : null
    : reveal.predecessorDisposition;
  const { revealDigest, ...payload } = reveal;
  const predecessorPresent =
    reveal.predecessorProtocolHash !== null ||
    reveal.predecessorEvidenceDigest !== null ||
    reveal.predecessorRunId !== null ||
    predecessorDisposition !== null;
  if (
    reveal.version !== GATE3_BASELINE_REVEAL_VERSION ||
    reveal.phase !== "baseline" ||
    !/^run_[A-Za-z0-9_-]{22}$/u.test(reveal.runId) ||
    !/^[a-f0-9]{40}$/u.test(reveal.appCommit) ||
    !hashValue(reveal.reviewPackageHash) ||
    !hashValue(reveal.frozenProtocolHash) ||
    !hashValue(reveal.freezeCandidateHash) ||
    !nonnegativeInteger(reveal.phaseCallOffset) ||
    reveal.phaseCallOffset > 46 ||
    (repairPhaseCallOffset !== 0 && repairPhaseCallOffset !== 1) ||
    (predecessorPresent &&
      (!hashValue(reveal.predecessorProtocolHash) ||
        !hashValue(reveal.predecessorEvidenceDigest) ||
        typeof reveal.predecessorRunId !== "string" ||
        !/^run_[A-Za-z0-9_-]{22}$/u.test(reveal.predecessorRunId) ||
        !SCORED_PREDECESSOR_DISPOSITIONS.includes(
          predecessorDisposition as ScoredPredecessorDisposition
        ))) ||
    (!predecessorPresent && reveal.phaseCallOffset !== 0) ||
    (reveal.status !== "terminal-complete" && reveal.status !== "terminal-invalid") ||
    !nonnegativeInteger(reveal.completedCount) ||
    reveal.completedCount > SCORED_RUN_CASE_COUNT ||
    !nonnegativeInteger(reveal.attemptCount) ||
    reveal.attemptCount < 1 ||
    reveal.attemptCount > SCORED_RUN_CASE_COUNT * 2 ||
    !nonnegativeInteger(reveal.transportFailureCount) ||
    !Array.isArray(reveal.developmentAttempts) ||
    !/^[a-f0-9]{64}$/u.test(reveal.terminalEvidenceDigest) ||
    !/^[a-f0-9]{64}$/u.test(reveal.developmentDigest) ||
    !/^[a-f0-9]{64}$/u.test(reveal.sealedHoldout.commitmentDigest) ||
    reveal.sealedHoldout.caseCount !== 12 ||
    !nonnegativeInteger(reveal.sealedHoldout.attemptCount) ||
    reveal.sealedHoldout.attemptCount > 24 ||
    reveal.sealedHoldout.disclosure !== "sealed-until-v2-freeze-and-revised-terminal" ||
    reveal.attemptCount !== reveal.developmentAttempts.length + reveal.sealedHoldout.attemptCount ||
    Object.values(reveal.guard).some((nested) => !nonnegativeInteger(nested)) ||
    reveal.guard.pendingCount !== 0 ||
    (reveal.status === "terminal-complete" && reveal.completedCount !== 24) ||
    (await canonicalSha256(reveal.developmentAttempts)) !== reveal.developmentDigest ||
    (await canonicalSha256(payload)) !== revealDigest
  ) {
    throw new ScoredServiceError("baseline_reveal_invalid", 500);
  }
  assertExpectedBundleBinding(reveal, { ...expected, phase: "baseline" });
  const developmentIds = new Set(
    GATE3_SEMANTIC_SUITE.scoredCases
      .filter(({ subset }) => subset === "development")
      .map(({ runnerCaseId }) => runnerCaseId)
  );
  if (reveal.developmentAttempts.some(({ runnerCaseId }) => !developmentIds.has(runnerCaseId))) {
    throw new ScoredServiceError("baseline_reveal_holdout_leak", 500);
  }
  const derivedOrder = await deriveSemanticCaseOrder(
    GATE3_ORDER_SEED,
    GATE3_SEMANTIC_SUITE.scoredCases.map(({ runnerCaseId }) => runnerCaseId)
  );
  let previousOrdinal = -1;
  let previousAttempt = -1;
  let developmentScoredCount = 0;
  let developmentInfrastructureCount = 0;
  const jtis = new Set<string>();
  for (const [index, attemptValue] of reveal.developmentAttempts.entries()) {
    const attempt = scoredRunAttemptSchema.parse(attemptValue);
    const ordinal = derivedOrder.indexOf(attempt.runnerCaseId);
    if (
      ordinal !== attempt.ordinal ||
      ordinal < previousOrdinal ||
      (ordinal === previousOrdinal && attempt.attempt <= previousAttempt) ||
      (attempt.attempt === 1 && (ordinal !== previousOrdinal || previousAttempt !== 0)) ||
      (attempt.attempt === 1 && attempt.infrastructureRetryEligible)
    ) {
      throw new ScoredServiceError("baseline_reveal_topology_invalid", 500);
    }
    if (ordinal !== previousOrdinal) previousAttempt = -1;
    if (attempt.attempt === 1) {
      const prior = reveal.developmentAttempts[index - 1];
      if (
        !prior ||
        prior.ordinal !== attempt.ordinal ||
        prior.attempt !== 0 ||
        prior.disposition !== "infrastructure-invalid" ||
        !prior.infrastructureRetryEligible
      ) {
        throw new ScoredServiceError("baseline_reveal_topology_invalid", 500);
      }
    }
    if (attempt.attempt === 0 && attempt.infrastructureRetryEligible) {
      const replacement = reveal.developmentAttempts[index + 1];
      if (!replacement || replacement.ordinal !== attempt.ordinal || replacement.attempt !== 1) {
        throw new ScoredServiceError("baseline_reveal_topology_invalid", 500);
      }
    }
    if (
      attempt.disposition === "infrastructure-invalid" &&
      (!attempt.infrastructureRetryEligible || attempt.attempt === 1) &&
      index !== reveal.developmentAttempts.length - 1
    ) {
      throw new ScoredServiceError("baseline_reveal_topology_invalid", 500);
    }
    const row = await verifyAttemptEvidence(attempt, reveal);
    const evidence = attempt.evidence as Record<string, unknown>;
    if (!jtiValue(evidence.authorizationJti) || jtis.has(evidence.authorizationJti)) {
      throw new ScoredServiceError("baseline_reveal_jti_invalid", 500);
    }
    jtis.add(evidence.authorizationJti);
    if (attempt.disposition === "scored") {
      developmentScoredCount += 1;
      if (!row) throw new ScoredServiceError("baseline_reveal_row_missing", 500);
    } else {
      developmentInfrastructureCount += 1;
    }
    previousOrdinal = ordinal;
    previousAttempt = attempt.attempt;
  }
  if (
    reveal.transportFailureCount < developmentInfrastructureCount ||
    (reveal.status === "terminal-complete" && developmentScoredCount !== 12)
  ) {
    throw new ScoredServiceError("baseline_reveal_count_invalid", 500);
  }
  return Object.freeze(JSON.parse(canonicalJson(reveal)) as Gate3BaselineRevealBundle);
}

export async function revealScoredRun(
  request: Request,
  dependencies: ScoredServiceDependencies = {}
): Promise<Gate3BaselineRevealBundle | Gate3ScoredBundle> {
  const authenticated = await authenticateSession(request, dependencies, "terminal-evidence");
  const terminalStatus =
    authenticated.snapshot.status === "acknowledged"
      ? authenticated.snapshot.terminalStatus
      : authenticated.snapshot.status;
  if (terminalStatus !== "terminal-complete" && terminalStatus !== "terminal-invalid") {
    throw new ScoredServiceError("scored_run_not_terminal", 409);
  }
  const reconciled = Object.freeze({
    ...authenticated,
    guard: await reconcileTerminalInflightAttempts(authenticated)
  });
  for (const attempt of reconciled.snapshot.attempts) await verifyAttemptEvidence(attempt);
  const attemptManifest = await Promise.all(
    reconciled.snapshot.attempts.map(async (attempt) => ({
      ordinal: attempt.ordinal,
      attempt: attempt.attempt,
      digest: await canonicalSha256(attempt)
    }))
  );
  const attemptManifestDigest = await canonicalSha256(attemptManifest);
  const guard = reconciled.guard.status;
  let phaseProviderCalls = 0;
  for (const attempt of reconciled.snapshot.attempts) {
    phaseProviderCalls += await verifyAttemptLedgerBinding(attempt, reconciled);
  }
  const observedPhaseCalls =
    authenticated.session.phase === "baseline"
      ? guard.purposeCounts.baseline
      : guard.purposeCounts.revised;
  if (observedPhaseCalls - authenticated.session.phaseCallOffset !== phaseProviderCalls) {
    throw new ScoredServiceError("scored_bundle_phase_call_count_mismatch", 500);
  }
  const payload = {
    version: GATE3_SCORED_BUNDLE_VERSION,
    phase: authenticated.session.phase,
    runId: authenticated.session.runId,
    appCommit: authenticated.session.appCommit,
    reviewPackageHash: authenticated.session.reviewPackageHash,
    frozenProtocolHash: authenticated.session.frozenProtocolHash,
    freezeCandidateHash: authenticated.session.freezeCandidateHash,
    scheduleHash: authenticated.identity.scheduleHash,
    orderedRunnerCaseIds: authenticated.identity.orderedRunnerCaseIds,
    phaseCallOffset: authenticated.session.phaseCallOffset,
    repairPhaseCallOffset: authenticated.session.repairPhaseCallOffset,
    predecessorProtocolHash: authenticated.session.predecessorProtocolHash,
    predecessorEvidenceDigest: authenticated.session.predecessorEvidenceDigest,
    predecessorRunId: authenticated.session.predecessorRunId,
    predecessorDisposition: authenticated.session.predecessorDisposition,
    status: terminalStatus,
    completedCount: reconciled.snapshot.completedCount,
    attemptCount: reconciled.snapshot.attemptCount,
    transportFailureCount: reconciled.snapshot.transportFailureCount,
    attempts: reconciled.snapshot.attempts,
    attemptManifestDigest,
    guard: {
      claimedCalls: guard.claimedCalls,
      knownCalls: guard.knownCount,
      pendingCount: guard.pendingCount,
      uncertainCount: guard.uncertainCount,
      baselineCalls: guard.purposeCounts.baseline,
      revisedCalls: guard.purposeCounts.revised,
      committedNanoUsd: guard.committedNanoUsd,
      knownActualNanoUsd: guard.knownActualNanoUsd
    }
  } as const;
  const bundle = Object.freeze({ ...payload, evidenceDigest: await canonicalSha256(payload) });
  await verifyGate3ScoredBundle(bundle, {
    phase: reconciled.identity.phase,
    runId: reconciled.identity.runId,
    appCommit: reconciled.identity.appCommit,
    reviewPackageHash: reconciled.identity.reviewPackageHash,
    frozenProtocolHash: reconciled.identity.frozenProtocolHash,
    freezeCandidateHash: reconciled.identity.freezeCandidateHash,
    scheduleHash: reconciled.identity.scheduleHash
  });
  if (authenticated.snapshot.status === "acknowledged") {
    if (authenticated.snapshot.evidenceDigest !== bundle.evidenceDigest) {
      throw new ScoredServiceError("scored_permanent_evidence_digest_mismatch", 500);
    }
  } else {
    await sealScoredRunEvidence(reconciled.guard.redis, {
      identity: reconciled.identity,
      evidenceDigest: bundle.evidenceDigest,
      attemptManifestDigest,
      attemptCount: reconciled.snapshot.attemptCount
    });
  }
  if (bundle.phase === "revised") return bundle;
  const developmentIds = new Set(
    GATE3_SEMANTIC_SUITE.scoredCases
      .filter(({ subset }) => subset === "development")
      .map(({ runnerCaseId }) => runnerCaseId)
  );
  const developmentAttempts = bundle.attempts.filter(({ runnerCaseId }) =>
    developmentIds.has(runnerCaseId)
  );
  const holdoutAttempts = bundle.attempts.filter(
    ({ runnerCaseId }) => !developmentIds.has(runnerCaseId)
  );
  const revealPayload = {
    version: GATE3_BASELINE_REVEAL_VERSION,
    phase: "baseline" as const,
    runId: bundle.runId,
    appCommit: bundle.appCommit,
    reviewPackageHash: bundle.reviewPackageHash,
    frozenProtocolHash: bundle.frozenProtocolHash,
    freezeCandidateHash: bundle.freezeCandidateHash,
    phaseCallOffset: bundle.phaseCallOffset,
    repairPhaseCallOffset: bundle.repairPhaseCallOffset,
    predecessorProtocolHash: bundle.predecessorProtocolHash,
    predecessorEvidenceDigest: bundle.predecessorEvidenceDigest,
    predecessorRunId: bundle.predecessorRunId,
    predecessorDisposition: bundle.predecessorDisposition,
    status: bundle.status,
    completedCount: bundle.completedCount,
    attemptCount: bundle.attemptCount,
    transportFailureCount: bundle.transportFailureCount,
    developmentAttempts,
    developmentDigest: await canonicalSha256(developmentAttempts),
    sealedHoldout: {
      caseCount: 12 as const,
      attemptCount: holdoutAttempts.length,
      commitmentDigest: await canonicalSha256(holdoutAttempts),
      disclosure: "sealed-until-v2-freeze-and-revised-terminal" as const
    },
    terminalEvidenceDigest: bundle.evidenceDigest,
    guard: bundle.guard
  };
  return verifyGate3BaselineRevealBundle(
    {
      ...revealPayload,
      revealDigest: await canonicalSha256(revealPayload)
    },
    {
      phase: "baseline",
      runId: reconciled.identity.runId,
      appCommit: reconciled.identity.appCommit,
      reviewPackageHash: reconciled.identity.reviewPackageHash,
      frozenProtocolHash: reconciled.identity.frozenProtocolHash,
      freezeCandidateHash: reconciled.identity.freezeCandidateHash
    }
  );
}

export async function acknowledgeVerifiedScoredRun(
  request: Request,
  evidenceDigest: string,
  dependencies: ScoredServiceDependencies = {}
) {
  const authenticated = await authenticateSession(request, dependencies, "terminal-evidence");
  if (authenticated.snapshot.evidenceDigest !== evidenceDigest) {
    throw new ScoredServiceError("scored_evidence_digest_mismatch", 409);
  }
  const reconciledGuard = await reconcileTerminalInflightAttempts(authenticated);
  const jtis = authenticated.snapshot.attempts
    .map((attempt) => {
      const evidence = attempt.evidence as Record<string, unknown>;
      return typeof evidence.authorizationJti === "string" ? evidence.authorizationJti : null;
    })
    .filter((value): value is string => value !== null);
  const continuationKeys = jtis.flatMap((jti) =>
    PROBE_CONTINUATION_STAGES.map((stage) =>
      probeContinuationKey({ namespace: "tp:{webmcp26}:continuation" }, jti, stage)
    )
  );
  if (continuationKeys.length > 0) {
    const cleanup = await reconciledGuard.redis.eval(
      `redis.call("UNLINK", unpack(KEYS)); return redis.call("EXISTS", unpack(KEYS))`,
      continuationKeys,
      []
    );
    if (Number(cleanup) !== 0) {
      throw new ScoredServiceError("scored_continuation_cleanup_failed", 500);
    }
  }
  const disposition = await acknowledgeScoredRun(reconciledGuard.redis, {
    identity: authenticated.identity,
    evidenceDigest
  });
  return Object.freeze({ disposition, inferencePerformed: false });
}

export function scoredServiceErrorResponse(error: unknown): {
  readonly status: number;
  readonly body: { readonly error: string; readonly inferencePerformed: boolean };
} {
  if (error instanceof ScoredServiceError) {
    return Object.freeze({
      status: error.status,
      body: Object.freeze({ error: error.code, inferencePerformed: error.inferencePerformed })
    });
  }
  return Object.freeze({
    status: 500,
    body: Object.freeze({ error: "scored_request_failed", inferencePerformed: false })
  });
}
