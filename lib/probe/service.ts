import "server-only";

import { timingSafeEqual } from "node:crypto";

import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import {
  FALLBACK_CALIBRATION_ENVELOPE_VERSION,
  fallbackCalibrationEnvelopeHash,
  parseExpectationFreeFallbackEnvelope,
  verifyFallbackTransportBinding,
  type FallbackCalibrationEnvelope
} from "@/lib/fallback/calibration-envelope";
import { FALLBACK_LAB_PAGE_ADAPTER_VERSION } from "@/lib/fallback/lab-page-adapter.server";
import {
  FallbackProviderError,
  decideWithFallbackOpenAi,
  type FallbackProviderKnownReceipt
} from "@/lib/fallback/openai-tool-provider.server";
import { fallbackNoCallJsonSchemaHash } from "@/lib/fallback/openai-tool-decision";
import {
  FALLBACK_IMPLEMENTATION,
  FALLBACK_RUNNER_PROMPT_VERSION,
  FALLBACK_RUNNER_SETTINGS_VERSION,
  FALLBACK_UPSTREAM_PIN,
  fallbackBrowserRuntimeContractHash,
  fallbackRunnerContractHash,
  fallbackRunnerPromptHash,
  fallbackRunnerSettingsHash
} from "@/lib/fallback/runner-contract";
import { verifyGate2CalibrationBundleServer } from "@/lib/evidence/gate2-calibration-verifier.server";
import { verifyGate2FallbackCalibrationBundleServer } from "@/lib/evidence/gate2-fallback-calibration-verifier.server";
import {
  GATE2_ATTEMPT_COST_RECONCILIATION_VERSION,
  GATE2_CALIBRATION_BUNDLE_VERSION,
  GATE2_CALIBRATION_LANE,
  createGate2PriorAttemptsLineage
} from "@/lib/evidence/gate2-calibration-bundle";
import {
  PROBE_CALIBRATION_CASE_COUNT,
  evaluateProbeCalibrationCase,
  getProbeCalibrationCase,
  type ProbeCalibrationObservation,
  type ProbeNativeExecutionObservation,
  type ProbeResetBoundaryObservation
} from "@/lib/probe/calibration-catalog.server";
import {
  PROBE_CALIBRATION_ENVELOPE_VERSION,
  PROBE_LIVE_MANIFEST_VERSION,
  createProbeTransportBinding,
  createProbeFixtureSynopsis,
  parseExpectationFreeCalibrationEnvelope,
  probeCalibrationEnvelopeHash,
  probeLiveManifestSchema,
  verifyProbeTransportBinding,
  type ProbeCalibrationEnvelope,
  type ProbeLiveManifest
} from "@/lib/probe/calibration-envelope";
import { requireProbeActivation, type ProbeActivationContext } from "@/lib/probe/activation";
import {
  getProbeContinuation,
  putProbeContinuation,
  type ProbeContinuationRedisClient
} from "@/lib/probe/continuation-store";
import {
  probeDecisionJsonSchemaHash,
  probeFunctionToolDefinitionsHash
} from "@/lib/probe/decision";
import { PROBE_CLIENT_RUNNER_VERSION } from "@/lib/probe/client-runner";
import {
  ProbeLedgerError,
  PRODUCTION_PROBE_KEYSPACE,
  beginProbeCall,
  createProbeRedis,
  issueProbeAuthorization,
  probeAuthorizationKey,
  settleProbeCallKnown,
  settleProbeCallUncertain,
  type ProbeRedisClient
} from "@/lib/probe/ledger";
import {
  ProbeProviderError,
  decideWithOpenAi,
  type ProbeProviderKnownReceipt
} from "@/lib/probe/openai";
import { PROBE_PER_CALL_RESERVATION_NANO_USD, probePolicyHash } from "@/lib/probe/policy";
import {
  PROBE_V03_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
  PROBE_V03_POLICY_MIGRATION_ID,
  PROBE_V03_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
  PROBE_V03_POLICY_MIGRATION_VERSION,
  type ProbeV03PolicyMigrationReceipt
} from "@/lib/probe/policy-v03-migration-contract";
import {
  PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
  PROBE_V04_POLICY_MIGRATION_ID,
  PROBE_V04_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
  PROBE_V04_POLICY_MIGRATION_VERSION,
  PROBE_V04_PREDECESSOR_MIGRATION_RECEIPT_HASH,
  type ProbeV04PolicyMigrationReceipt
} from "@/lib/probe/policy-v04-migration-contract";
import {
  advanceProbeRunContinuation,
  createInitialProbeRunContinuation,
  deriveProbeTrialOpaqueIds,
  openProbeRunContinuation,
  probeCompletedCalibrationRowSchema,
  type ProbeCompletedCalibrationRow
} from "@/lib/probe/run-continuation.server";
import {
  advanceProbeRunIndex,
  acknowledgeProbeRunIndex,
  armProbeOperator,
  assertProbeRunDocumentOwner,
  assertProbeOperatorArmed,
  claimProbeRunDocument,
  deleteUnstartedProbeRunIndex,
  deriveProbeDocumentHash,
  getProbeRunIndex,
  getProbeRunIndexByLaunch,
  probeRunIndexKeys,
  putProbeRunIndex,
  terminalProbeRunIndexPayloadBinding,
  PRODUCTION_PROBE_RUN_INDEX_KEYSPACE,
  type ProbeRunIndexReceipt,
  type ProbeRunIndexRedisClient
} from "@/lib/probe/run-index";
import {
  PROBE_RUNNER_PROMPT_VERSION,
  PROBE_RUNNER_SETTINGS_VERSION,
  probeRunnerPromptHash,
  probeRunnerSettingsHash
} from "@/lib/probe/runner-contract";
import { signProbeArtifact, verifyProbeArtifact } from "@/lib/probe/server-artifact";
import { verifyProbeToken, verifyProbeTokenForRecovery } from "@/lib/probe/token";
import {
  FALLBACK_PROBE_CALIBRATION_BASE_CALLS,
  FALLBACK_PROBE_CALIBRATION_CASE_COUNT,
  FALLBACK_PROBE_CALIBRATION_LANE,
  FALLBACK_PROBE_CALIBRATION_PROTOCOL_VERSION,
  FALLBACK_PROBE_CALIBRATION_TERMINAL_CALLS,
  FALLBACK_PROBE_SERVICE_VERSION,
  PROBE_SERVICE_VERSION,
  PROBE_CALIBRATION_ATTEMPT,
  PROBE_CALIBRATION_ATTEMPT_CASE_COUNT,
  PROBE_CALIBRATION_BASE_CALLS,
  PROBE_CALIBRATION_PROTOCOL_VERSION,
  PROBE_CALIBRATION_TERMINAL_CALLS,
  probeBoundaryEvidenceSchema,
  probeCompleteBodySchema,
  probeDecideBodySchema,
  probeFreshDecisionResponseSchema,
  probeIssueBodySchema,
  probeIssueResultSchema,
  probeIssueResponseSchema,
  probeNativeAdmissionBodySchema,
  probeNativeAdmissionResponseSchema,
  probeResetEvidenceSchema,
  fallbackProbeCompleteBodySchema,
  fallbackProbeCompleteResponseSchema,
  fallbackProbeDecideBodySchema,
  fallbackProbeFreshDecisionResponseSchema,
  fallbackProbeIssueBodySchema,
  fallbackProbeIssueResponseSchema,
  fallbackProbeIssueResultSchema,
  fallbackProbeNativeAdmissionBodySchema,
  type ProbeBoundaryEvidence,
  type ProbeCompleteBody,
  type ProbeFreshDecisionResponse,
  type ProbeIssueBody,
  type ProbeIssueResult,
  type FallbackProbeCompleteBody,
  type FallbackProbeFreshDecisionResponse,
  type FallbackProbeIssueResult
} from "@/lib/probe/service-contract";
import {
  PROBE_SESSION_COOKIE,
  PROBE_RECOVERY_COOKIE,
  PROBE_RECOVERY_TTL_SECONDS,
  PROBE_OPERATOR_COOKIE,
  PROBE_OPERATOR_LAUNCH_RETRY_MARGIN_SECONDS,
  deriveProbeLaunchHash,
  deriveProbeActorHash,
  issueProbeRecoveryCredential,
  issueProbeOperatorCredential,
  issueRecoveredProbeSession,
  issueProbeSession,
  verifyProbeRecoveryCredential,
  signExistingProbeRecoveryCredential,
  verifyProbeOperatorCredential,
  verifyProbeSession,
  type ProbeRecoveryClaims,
  type ProbeOperatorClaims,
  type ProbeSessionClaims
} from "@/lib/probe/session";
import { createCheckoutFixture, CHECKOUT_DOMAIN_VERSION } from "@/lib/domain/checkout";
import { CHECKOUT_FIXTURE_STATE_HASH, verifyCheckoutReset } from "@/lib/domain/checkout-reset";
import {
  CHECKOUT_TOOLSET_VERSION,
  INITIAL_CHECKOUT_TOOL_NAMES,
  checkoutToolContractSnapshot
} from "@/lib/webmcp/catalog";
import type { OperationTrace } from "@/lib/evidence/operation-trace";
import { OPERATION_TRACE_VERSION } from "@/lib/evidence/operation-trace";
import { FIXTURE_RESET_HANDLER_VERSION } from "@/lib/evidence/checkout-trace-ledger";
import { CART_GET_HANDLER_VERSION } from "@/lib/webmcp/cart-get-tool";
import { CART_UPDATE_HANDLER_VERSION } from "@/lib/webmcp/cart-update-tool";
import { CHECKOUT_REQUEST_HANDLER_VERSION } from "@/lib/webmcp/checkout-request-tool";
import { ORDER_REVIEW_HANDLER_VERSION } from "@/lib/webmcp/order-review-tool";
import { z } from "zod";

export const PROBE_PROVIDER_RECEIPT_VERSION = 1;

interface EnvironmentLike {
  readonly [key: string]: string | undefined;
}

type ServiceRedis = ProbeRedisClient & ProbeContinuationRedisClient & ProbeRunIndexRedisClient;

export interface ProbeServiceDependencies {
  readonly environment?: EnvironmentLike;
  readonly redis?: ServiceRedis;
  readonly fetchImplementation?: typeof fetch;
  readonly now?: () => number;
  readonly activation?: ProbeActivationContext;
}

export class ProbeServiceError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly inferencePerformed: boolean = false
  ) {
    super(code);
    this.name = "ProbeServiceError";
  }
}

const signedProviderReceiptSchema = z
  .object({
    version: z.literal(PROBE_PROVIDER_RECEIPT_VERSION),
    token: z.string().min(32).max(1_000_000),
    receipt: z.json()
  })
  .strict();

const signedProviderArtifactSchema = z
  .object({
    version: z.literal(PROBE_PROVIDER_RECEIPT_VERSION),
    activationHash: z.string().regex(/^[a-f0-9]{64}$/u),
    sessionId: z.string().regex(/^[A-Za-z0-9_-]{16,96}$/u),
    jti: z.string().regex(/^[A-Za-z0-9_-]{16,96}$/u),
    claimsHash: z.string().regex(/^[a-f0-9]{64}$/u),
    envelopeHash: z.string().regex(/^[a-f0-9]{64}$/u),
    receiptHash: z.string().regex(/^[a-f0-9]{64}$/u)
  })
  .strict();

const issueCacheSchema = z
  .object({
    requestBinding: z.string().regex(/^[a-f0-9]{64}$/u),
    claimsHash: z.string().regex(/^[a-f0-9]{64}$/u),
    subjectHash: z.string().regex(/^[a-f0-9]{64}$/u),
    response: probeIssueResponseSchema
  })
  .strict();

const decisionCacheSchema = z
  .object({
    requestBinding: z.string().regex(/^[a-f0-9]{64}$/u),
    response: probeFreshDecisionResponseSchema
  })
  .strict();

const completionResponseSchema = z
  .object({
    version: z.literal(PROBE_SERVICE_VERSION),
    protocolVersion: z.literal(PROBE_CALIBRATION_PROTOCOL_VERSION),
    attempt: z.literal(PROBE_CALIBRATION_ATTEMPT),
    status: z.literal("sealed"),
    continuation: z.string().min(32).max(1_800_000),
    completedCount: z.number().int().min(1).max(PROBE_CALIBRATION_ATTEMPT_CASE_COUNT),
    terminal: z.boolean()
  })
  .strict();

const completionCacheSchema = z
  .object({
    requestBinding: z.string().regex(/^[a-f0-9]{64}$/u),
    response: completionResponseSchema,
    settlement: z
      .object({
        actualNanoUsd: z.number().int().nonnegative(),
        providerResponseHash: z.string().regex(/^[a-f0-9]{64}$/u),
        settlementDigest: z.string().regex(/^[a-f0-9]{64}$/u),
        usageHash: z.string().regex(/^[a-f0-9]{64}$/u)
      })
      .strict()
  })
  .strict();

const fallbackIssueCacheSchema = z
  .object({
    requestBinding: z.string().regex(/^[a-f0-9]{64}$/u),
    claimsHash: z.string().regex(/^[a-f0-9]{64}$/u),
    subjectHash: z.string().regex(/^[a-f0-9]{64}$/u),
    response: fallbackProbeIssueResponseSchema
  })
  .strict();

const fallbackDecisionCacheSchema = z
  .object({
    requestBinding: z.string().regex(/^[a-f0-9]{64}$/u),
    response: fallbackProbeFreshDecisionResponseSchema
  })
  .strict();

const fallbackCompletionCacheSchema = z
  .object({
    requestBinding: z.string().regex(/^[a-f0-9]{64}$/u),
    response: fallbackProbeCompleteResponseSchema,
    settlement: z
      .object({
        actualNanoUsd: z.number().int().nonnegative(),
        providerResponseHash: z.string().regex(/^[a-f0-9]{64}$/u),
        settlementDigest: z.string().regex(/^[a-f0-9]{64}$/u),
        usageHash: z.string().regex(/^[a-f0-9]{64}$/u)
      })
      .strict()
  })
  .strict();

const EXPECTED_HANDLER_VERSIONS: Readonly<Record<string, string>> = Object.freeze({
  cart_get: CART_GET_HANDLER_VERSION,
  order_review: ORDER_REVIEW_HANDLER_VERSION,
  cart_update: CART_UPDATE_HANDLER_VERSION,
  checkout_request: CHECKOUT_REQUEST_HANDLER_VERSION
});

async function createNativeAdmissionPayload(input: {
  readonly envelopeHash: string;
  readonly claimsHash: string;
  readonly decision: unknown;
  readonly initialBoundary: unknown;
}) {
  return Object.freeze({
    version: 1,
    envelopeHash: input.envelopeHash,
    claimsHash: input.claimsHash,
    decisionHash: await canonicalSha256(input.decision),
    initialBoundaryHash: await canonicalSha256(input.initialBoundary),
    initialBoundary: JSON.parse(canonicalJson(input.initialBoundary)) as unknown
  });
}

function environmentOf(dependencies: ProbeServiceDependencies): EnvironmentLike {
  return dependencies.environment ?? process.env;
}

function nowOf(dependencies: ProbeServiceDependencies): number {
  return (dependencies.now ?? Date.now)();
}

function requiredEnvironment(environment: EnvironmentLike, key: string): string {
  const value = environment[key];
  if (!value?.trim()) throw new ProbeServiceError("probe_configuration_unavailable", 503);
  return value;
}

function safeTextEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function redisOf(
  dependencies: ProbeServiceDependencies,
  environment: EnvironmentLike
): ServiceRedis {
  return (dependencies.redis ??
    createProbeRedis(environment as NodeJS.ProcessEnv)) as unknown as ServiceRedis;
}

async function activationOf(
  dependencies: ProbeServiceDependencies
): Promise<ProbeActivationContext> {
  try {
    return (
      dependencies.activation ??
      (await requireProbeActivation({ environment: environmentOf(dependencies) }))
    );
  } catch {
    throw new ProbeServiceError("probe_disabled", 503);
  }
}

function migrationOf(activation: ProbeActivationContext): ProbeV03PolicyMigrationReceipt {
  const migration = activation.predecessorMigration;
  const preserved = migration?.preserved;
  if (
    !migration ||
    migration.version !== PROBE_V03_POLICY_MIGRATION_VERSION ||
    migration.migrationId !== PROBE_V03_POLICY_MIGRATION_ID ||
    migration.priorActivationHash !== PROBE_V03_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH ||
    migration.receiptHash !== activation.manifest.predecessorPolicyMigrationReceiptHash ||
    migration.guardInstanceId !== activation.manifest.guardInstanceId ||
    migration.initializedCommit !== activation.manifest.guardInitializedCommit ||
    !preserved ||
    preserved.claimedCalls !== PROBE_V03_POLICY_MIGRATION_FIXED_PRESERVED_STATE.claimedCalls ||
    preserved.knownCalls !== PROBE_V03_POLICY_MIGRATION_FIXED_PRESERVED_STATE.knownCalls ||
    preserved.pendingCalls !== 0 ||
    preserved.uncertainCalls !== 0 ||
    preserved.inflightCalls !== 0 ||
    preserved.committedNanoUsd !==
      PROBE_V03_POLICY_MIGRATION_FIXED_PRESERVED_STATE.committedNanoUsd ||
    preserved.uncertainUpperNanoUsd !== 0 ||
    preserved.sequence !== PROBE_V03_POLICY_MIGRATION_FIXED_PRESERVED_STATE.sequence ||
    canonicalJson(preserved.purposeCounts) !==
      canonicalJson(PROBE_V03_POLICY_MIGRATION_FIXED_PRESERVED_STATE.purposeCounts) ||
    migration.knownCalls.length !== preserved.knownCalls ||
    migration.knownCalls.reduce((sum, call) => sum + call.actualNanoUsd, 0) !==
      preserved.knownActualNanoUsd
  ) {
    throw new ProbeServiceError("probe_policy_migration_unavailable", 503);
  }
  return migration;
}

function fallbackMigrationOf(activation: ProbeActivationContext): ProbeV04PolicyMigrationReceipt {
  const migration = activation.migration;
  const preserved = migration?.preserved;
  if (
    !migration ||
    migration.version !== PROBE_V04_POLICY_MIGRATION_VERSION ||
    migration.migrationId !== PROBE_V04_POLICY_MIGRATION_ID ||
    migration.priorActivationHash !== PROBE_V04_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH ||
    migration.predecessorMigrationReceiptHash !== PROBE_V04_PREDECESSOR_MIGRATION_RECEIPT_HASH ||
    migration.predecessorMigrationReceiptHash !==
      activation.manifest.predecessorPolicyMigrationReceiptHash ||
    migration.nextPolicyHash !== activation.manifest.policyHash ||
    migration.nextScriptHash !== activation.manifest.scriptHash ||
    migration.nextRunnerHash !== activation.manifest.runnerContractHash ||
    migration.migrationCommit !== activation.manifest.activeCommit ||
    migration.receiptHash !== activation.manifest.policyMigrationReceiptHash ||
    migration.guardInstanceId !== activation.manifest.guardInstanceId ||
    migration.initializedCommit !== activation.manifest.guardInitializedCommit ||
    !preserved ||
    preserved.claimedCalls !== PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE.claimedCalls ||
    preserved.knownCalls !== PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE.knownCalls ||
    preserved.pendingCalls !== 0 ||
    preserved.uncertainCalls !== 0 ||
    preserved.inflightCalls !== 0 ||
    preserved.committedNanoUsd !==
      PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE.committedNanoUsd ||
    preserved.knownActualNanoUsd !==
      PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE.knownActualNanoUsd ||
    preserved.uncertainUpperNanoUsd !== 0 ||
    preserved.sequence !== PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE.sequence ||
    canonicalJson(preserved.purposeCounts) !==
      canonicalJson(PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE.purposeCounts) ||
    migration.knownCalls.length !== FALLBACK_PROBE_CALIBRATION_BASE_CALLS ||
    migration.knownCalls.reduce((sum, call) => sum + call.actualNanoUsd, 0) !==
      preserved.knownActualNanoUsd
  ) {
    throw new ProbeServiceError("fallback_policy_migration_unavailable", 503);
  }
  return migration;
}

function namedCookieFromRequest(request: Request, name: string): string {
  const cookie = request.headers.get("cookie") ?? "";
  for (const segment of cookie.split(";")) {
    const [rawName, ...rawValue] = segment.trim().split("=");
    if (rawName === name) return rawValue.join("=");
  }
  throw new ProbeServiceError("invalid_probe_session", 403);
}

function cookieFromRequest(request: Request): string {
  return namedCookieFromRequest(request, PROBE_SESSION_COOKIE);
}

function csrfFromRequest(request: Request): string {
  const csrf = request.headers.get("x-toolproof-csrf");
  if (!csrf) throw new ProbeServiceError("invalid_probe_session", 403);
  return csrf;
}

function documentIdFromRequest(request: Request): string {
  const documentId = request.headers.get("x-toolproof-document") ?? "";
  if (!/^document_[A-Za-z0-9_-]{22,64}$/u.test(documentId)) {
    throw new ProbeServiceError("invalid_probe_document", 403);
  }
  return documentId;
}

async function assertDocumentOwner(input: {
  readonly request: Request;
  readonly redis: ServiceRedis;
  readonly recovery: ProbeRecoveryClaims;
  readonly signingSecret: string;
}): Promise<void> {
  try {
    await assertProbeRunDocumentOwner(input.redis, {
      recovery: input.recovery,
      documentId: documentIdFromRequest(input.request),
      artifactSecret: input.signingSecret
    });
  } catch {
    throw new ProbeServiceError("probe_document_not_owner", 409);
  }
}

function runAdmission(input: {
  readonly request: Request;
  readonly recovery: ProbeRecoveryClaims;
  readonly signingSecret: string;
  readonly ordinal: number;
}) {
  const [anchorKey, dataKey] = probeRunIndexKeys(
    PRODUCTION_PROBE_RUN_INDEX_KEYSPACE,
    input.recovery.activationHash
  );
  return Object.freeze({
    anchorKey,
    dataKey,
    activationHash: input.recovery.activationHash,
    buildCommit: input.recovery.buildCommit,
    ownerHash: deriveProbeDocumentHash(documentIdFromRequest(input.request), input.signingSecret),
    ownerRevision: input.ordinal,
    ordinal: input.ordinal
  });
}

function runOwnerContinuationAdmission(input: {
  readonly request: Request;
  readonly recovery: ProbeRecoveryClaims;
  readonly signingSecret: string;
  readonly ordinal: number;
}) {
  const admission = runAdmission(input);
  return Object.freeze({
    mode: "run-owner" as const,
    anchorKey: admission.anchorKey,
    dataKey: admission.dataKey,
    activationHash: admission.activationHash,
    buildCommit: admission.buildCommit,
    ownerHash: admission.ownerHash,
    revision: admission.ownerRevision
  });
}

function authenticateSession(input: {
  readonly request: Request;
  readonly activation: ProbeActivationContext;
  readonly environment: EnvironmentLike;
  readonly requireCsrf: boolean;
  readonly nowMs: number;
}): ProbeSessionClaims {
  const signingSecret = requiredEnvironment(input.environment, "TOOLPROOF_SIGNING_SECRET");
  const actorHash = deriveProbeActorHash(input.request, signingSecret);
  try {
    return verifyProbeSession({
      cookieValue: cookieFromRequest(input.request),
      signingSecret,
      activationHash: input.activation.activationHash,
      buildCommit: input.activation.manifest.activeCommit,
      actorHash,
      ...(input.requireCsrf ? { csrfToken: csrfFromRequest(input.request) } : {}),
      nowMs: input.nowMs
    });
  } catch {
    throw new ProbeServiceError("invalid_probe_session", 403);
  }
}

function authenticateRecovery(input: {
  readonly request: Request;
  readonly activation: ProbeActivationContext;
  readonly environment: EnvironmentLike;
  readonly nowMs: number;
  readonly session?: ProbeSessionClaims;
}): ProbeRecoveryClaims {
  const signingSecret = requiredEnvironment(input.environment, "TOOLPROOF_SIGNING_SECRET");
  const actorHash = deriveProbeActorHash(input.request, signingSecret);
  let recovery: ProbeRecoveryClaims;
  try {
    recovery = verifyProbeRecoveryCredential({
      cookieValue: namedCookieFromRequest(input.request, PROBE_RECOVERY_COOKIE),
      signingSecret,
      activationHash: input.activation.activationHash,
      buildCommit: input.activation.manifest.activeCommit,
      actorHash,
      nowMs: input.nowMs
    });
  } catch {
    throw new ProbeServiceError("invalid_probe_recovery", 403);
  }
  if (
    input.session &&
    (recovery.activationHash !== input.session.activationHash ||
      recovery.buildCommit !== input.session.buildCommit ||
      recovery.sessionId !== input.session.sessionId ||
      recovery.runId !== input.session.runId ||
      recovery.actorHash !== input.session.actorHash)
  ) {
    throw new ProbeServiceError("probe_recovery_binding_mismatch", 403);
  }
  return recovery;
}

async function expectedLiveManifest(buildCommit: string): Promise<ProbeLiveManifest> {
  const fixture = createCheckoutFixture();
  const contract = checkoutToolContractSnapshot(fixture);
  const versions = new Map(contract.handlerVersions.map(({ name, version }) => [name, version]));
  const tools = contract.manifest
    .map(({ name, title, description, inputSchema, annotations }) => ({
      name,
      title,
      description,
      inputSchema: JSON.parse(canonicalJson(inputSchema)) as Record<string, unknown>,
      annotations: {
        readOnlyHint: annotations.readOnlyHint ?? false,
        untrustedContentHint: annotations.untrustedContentHint ?? false
      }
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const readinessManifest = {
    catalogState: "initial",
    toolsetVersion: CHECKOUT_TOOLSET_VERSION,
    domainVersion: CHECKOUT_DOMAIN_VERSION,
    appCommit: buildCommit,
    tools: tools.map((tool) => ({
      ...tool,
      handlerVersion: versions.get(tool.name)
    }))
  };
  return probeLiveManifestSchema.parse({
    version: PROBE_LIVE_MANIFEST_VERSION,
    manifestHash: await canonicalSha256(readinessManifest),
    tools
  });
}

function namesMatchInitial(names: readonly string[]): boolean {
  const sorted = [...names].sort();
  return (
    sorted.length === INITIAL_CHECKOUT_TOOL_NAMES.length &&
    sorted.every((name, index) => name === INITIAL_CHECKOUT_TOOL_NAMES[index])
  );
}

function resetProjection(boundary: ProbeBoundaryEvidence): ProbeResetBoundaryObservation {
  return {
    status: boundary.status,
    stateRevision: boundary.stateRevision,
    stateHash: boundary.stateHash,
    operationLedgerCount: boundary.operationLedgerCount,
    currentTrajectoryCount: boundary.currentTrajectoryCount,
    registeredToolNames: boundary.registeredToolNames
  };
}

async function validateInitialIssueBoundary(
  body: ProbeIssueBody,
  buildCommit: string
): Promise<void> {
  const expectedFixture = createProbeFixtureSynopsis(createCheckoutFixture());
  const expectedManifest = await expectedLiveManifest(buildCommit);
  if (
    body.initialBoundary.stateHash !== CHECKOUT_FIXTURE_STATE_HASH ||
    body.initialBoundary.manifestHash !== expectedManifest.manifestHash ||
    !namesMatchInitial(body.initialBoundary.registeredToolNames) ||
    canonicalJson(body.fixture) !== canonicalJson(expectedFixture) ||
    canonicalJson(body.liveManifest) !== canonicalJson(expectedManifest)
  ) {
    throw new ProbeServiceError("initial_boundary_mismatch", 409);
  }
  await validateBoundaryResetEvidence(
    body.initialBoundary,
    expectedManifest.manifestHash,
    buildCommit
  );
}

async function validateCompletionBoundary(
  boundary: ProbeBoundaryEvidence,
  buildCommit: string
): Promise<VerifiedResetLineage> {
  const expectedManifest = await expectedLiveManifest(buildCommit);
  if (
    boundary.stateHash !== CHECKOUT_FIXTURE_STATE_HASH ||
    boundary.manifestHash !== expectedManifest.manifestHash ||
    !namesMatchInitial(boundary.registeredToolNames)
  ) {
    throw new ProbeServiceError("completion_boundary_mismatch", 409);
  }
  return validateBoundaryResetEvidence(boundary, expectedManifest.manifestHash, buildCommit);
}

async function verifyEnvelopeAgainstClaims(input: {
  readonly envelope: ProbeCalibrationEnvelope;
  readonly token: string;
  readonly activation: ProbeActivationContext;
  readonly session: ProbeSessionClaims;
  readonly signingSecret: string;
  readonly nowMs: number;
  readonly allowExpiredRecovery?: boolean;
}) {
  let claims;
  try {
    claims = input.allowExpiredRecovery
      ? verifyProbeTokenForRecovery(input.token, input.signingSecret)
      : verifyProbeToken(input.token, input.signingSecret, input.nowMs);
  } catch {
    throw new ProbeServiceError("invalid_probe_authorization", 403);
  }
  const envelope = parseExpectationFreeCalibrationEnvelope(input.envelope);
  const envelopeHash = await probeCalibrationEnvelopeHash(envelope);
  const sessionHash = await sha256Hex(input.session.sessionId);
  if (
    claims.activationHash !== input.activation.activationHash ||
    claims.policyHash !== input.activation.manifest.policyHash ||
    claims.guardInstanceId !== input.activation.manifest.guardInstanceId ||
    claims.buildCommit !== input.activation.manifest.activeCommit ||
    claims.purpose !== "calibration" ||
    claims.origin !== input.activation.manifest.origin ||
    claims.audience !== input.activation.manifest.origin ||
    claims.model !== "gpt-5.6-terra" ||
    claims.sessionHash !== sessionHash ||
    claims.runId !== input.session.runId ||
    claims.runId !== envelope.runId ||
    claims.caseId !== envelope.caseId ||
    claims.trialId !== envelope.trialId ||
    claims.fixtureHash !== CHECKOUT_FIXTURE_STATE_HASH ||
    claims.requestHash !== (await sha256Hex(envelope.naturalLanguageRequest)) ||
    claims.manifestHash !== envelope.liveManifest.manifestHash ||
    claims.settingsHash !== envelope.runner.settingsHash ||
    claims.envelopeHash !== envelopeHash
  ) {
    throw new ProbeServiceError("probe_authorization_mismatch", 403);
  }
  return { claims, envelope, envelopeHash, claimsHash: await canonicalSha256(claims) };
}

function ordinalForEnvelope(
  envelope: Pick<ProbeCalibrationEnvelope, "caseId" | "trialId">,
  runId: string,
  activationSecret: string
): number {
  for (let ordinal = 0; ordinal < PROBE_CALIBRATION_CASE_COUNT; ordinal += 1) {
    const ids = deriveProbeTrialOpaqueIds({ runId, ordinal, activationSecret });
    if (ids.caseId === envelope.caseId && ids.trialId === envelope.trialId) return ordinal;
  }
  throw new ProbeServiceError("unknown_calibration_claim", 403);
}

function assertDerivedProbeJti(input: {
  readonly runId: string;
  readonly ordinal: number;
  readonly activationSecret: string;
  readonly jti: string;
}): void {
  const expected = deriveProbeTrialOpaqueIds(input);
  if (input.jti !== expected.jti) {
    throw new ProbeServiceError("probe_jti_mismatch", 403);
  }
}

async function validateFrozenEnvelope(
  envelope: ProbeCalibrationEnvelope,
  ordinal: number,
  activation: ProbeActivationContext
): Promise<void> {
  const definition = getProbeCalibrationCase(ordinal);
  const expectedManifest = await expectedLiveManifest(activation.manifest.activeCommit);
  const expectedFixture = createProbeFixtureSynopsis(createCheckoutFixture());
  const transport = await verifyProbeTransportBinding(envelope);
  if (
    envelope.naturalLanguageRequest !== definition.naturalLanguageRequest ||
    envelope.buildCommit !== activation.manifest.activeCommit ||
    canonicalJson(envelope.fixture) !== canonicalJson(expectedFixture) ||
    canonicalJson(envelope.liveManifest) !== canonicalJson(expectedManifest) ||
    envelope.runner.promptVersion !== PROBE_RUNNER_PROMPT_VERSION ||
    envelope.runner.promptHash !== (await probeRunnerPromptHash()) ||
    envelope.runner.settingsVersion !== PROBE_RUNNER_SETTINGS_VERSION ||
    envelope.runner.settingsHash !== (await probeRunnerSettingsHash()) ||
    envelope.runner.decisionSchemaHash !==
      (await probeDecisionJsonSchemaHash(expectedManifest, transport))
  ) {
    throw new ProbeServiceError("frozen_envelope_mismatch", 403);
  }
}

async function verifyFallbackEnvelopeAgainstClaims(input: {
  readonly envelope: FallbackCalibrationEnvelope;
  readonly token: string;
  readonly activation: ProbeActivationContext;
  readonly session: ProbeSessionClaims;
  readonly signingSecret: string;
  readonly nowMs: number;
  readonly allowExpiredRecovery?: boolean;
}) {
  let claims;
  try {
    claims = input.allowExpiredRecovery
      ? verifyProbeTokenForRecovery(input.token, input.signingSecret)
      : verifyProbeToken(input.token, input.signingSecret, input.nowMs);
  } catch {
    throw new ProbeServiceError("invalid_fallback_authorization", 403);
  }
  const envelope = parseExpectationFreeFallbackEnvelope(input.envelope);
  const envelopeHash = await fallbackCalibrationEnvelopeHash(envelope);
  const sessionHash = await sha256Hex(input.session.sessionId);
  if (
    claims.activationHash !== input.activation.activationHash ||
    claims.policyHash !== input.activation.manifest.policyHash ||
    claims.guardInstanceId !== input.activation.manifest.guardInstanceId ||
    claims.buildCommit !== input.activation.manifest.activeCommit ||
    claims.purpose !== "calibration" ||
    claims.origin !== input.activation.manifest.origin ||
    claims.audience !== input.activation.manifest.origin ||
    claims.model !== "gpt-5.6-terra" ||
    claims.sessionHash !== sessionHash ||
    claims.runId !== input.session.runId ||
    claims.runId !== envelope.runId ||
    claims.caseId !== envelope.caseId ||
    claims.trialId !== envelope.trialId ||
    claims.fixtureHash !== CHECKOUT_FIXTURE_STATE_HASH ||
    claims.requestHash !== (await sha256Hex(envelope.naturalLanguageRequest)) ||
    claims.manifestHash !== envelope.liveManifest.manifestHash ||
    claims.settingsHash !== envelope.runner.settingsHash ||
    claims.envelopeHash !== envelopeHash
  ) {
    throw new ProbeServiceError("fallback_authorization_mismatch", 403);
  }
  return { claims, envelope, envelopeHash, claimsHash: await canonicalSha256(claims) };
}

async function validateFrozenFallbackEnvelope(
  envelope: FallbackCalibrationEnvelope,
  ordinal: number,
  activation: ProbeActivationContext
): Promise<void> {
  const definition = getProbeCalibrationCase(ordinal);
  const expectedManifest = await expectedLiveManifest(activation.manifest.activeCommit);
  const expectedFixture = createProbeFixtureSynopsis(createCheckoutFixture());
  const transport = await verifyFallbackTransportBinding(envelope);
  const [
    promptHash,
    settingsHash,
    browserRuntimeHash,
    toolDefinitionsHash,
    noCallSchemaHash,
    runnerHash
  ] = await Promise.all([
    fallbackRunnerPromptHash(),
    fallbackRunnerSettingsHash(),
    fallbackBrowserRuntimeContractHash(),
    probeFunctionToolDefinitionsHash(expectedManifest, transport),
    fallbackNoCallJsonSchemaHash(),
    fallbackRunnerContractHash()
  ]);
  if (
    envelope.naturalLanguageRequest !== definition.naturalLanguageRequest ||
    envelope.buildCommit !== activation.manifest.activeCommit ||
    canonicalJson(envelope.fixture) !== canonicalJson(expectedFixture) ||
    canonicalJson(envelope.liveManifest) !== canonicalJson(expectedManifest) ||
    envelope.runner.promptVersion !== FALLBACK_RUNNER_PROMPT_VERSION ||
    envelope.runner.promptHash !== promptHash ||
    envelope.runner.settingsVersion !== FALLBACK_RUNNER_SETTINGS_VERSION ||
    envelope.runner.settingsHash !== settingsHash ||
    envelope.runner.browserRuntimeHash !== browserRuntimeHash ||
    envelope.runner.toolDefinitionsHash !== toolDefinitionsHash ||
    envelope.runner.noCallSchemaHash !== noCallSchemaHash ||
    activation.manifest.runnerContractHash !== runnerHash
  ) {
    throw new ProbeServiceError("frozen_fallback_envelope_mismatch", 403);
  }
}

export async function armProbeCalibrationOperator(
  request: Request,
  capability: string,
  dependencies: ProbeServiceDependencies = {}
) {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(capability)) {
    throw new ProbeServiceError("invalid_operator_capability", 403);
  }
  const environment = environmentOf(dependencies);
  const configuredCapabilityHash = requiredEnvironment(
    environment,
    "TOOLPROOF_PROBE_OPERATOR_CAPABILITY_HASH"
  );
  const observedHash = await sha256Hex(capability);
  if (!safeTextEqual(observedHash, configuredCapabilityHash)) {
    throw new ProbeServiceError("invalid_operator_capability", 403);
  }
  const activation = await activationOf(dependencies);
  migrationOf(activation);
  if (!safeTextEqual(configuredCapabilityHash, activation.manifest.operatorCapabilityHash)) {
    throw new ProbeServiceError("invalid_operator_capability", 403);
  }
  const signingSecret = requiredEnvironment(environment, "TOOLPROOF_SIGNING_SECRET");
  const actorHash = deriveProbeActorHash(request, signingSecret);
  const armed = await armProbeOperator(redisOf(dependencies, environment), {
    activationHash: activation.activationHash,
    buildCommit: activation.manifest.activeCommit,
    actorHash
  });
  const credential = issueProbeOperatorCredential({
    activationHash: activation.activationHash,
    buildCommit: activation.manifest.activeCommit,
    actorHash,
    signingSecret,
    nowMs: armed.armedAtMs
  });
  if (credential.claims.expiresAt * 1_000 !== armed.expiresAtMs) {
    throw new ProbeServiceError("operator_arm_expiry_mismatch", 503);
  }
  return Object.freeze({
    disposition: armed.disposition,
    cookieValue: credential.cookieValue,
    expiresAt: credential.claims.expiresAt
  });
}

export async function startProbeCalibrationSession(
  request: Request,
  launchId: string,
  dependencies: ProbeServiceDependencies = {}
) {
  const environment = environmentOf(dependencies);
  const nowMs = nowOf(dependencies);
  const signingSecret = requiredEnvironment(environment, "TOOLPROOF_SIGNING_SECRET");
  const actorHash = deriveProbeActorHash(request, signingSecret);
  const configuredActivationHash = requiredEnvironment(
    environment,
    "TOOLPROOF_PROBE_ACTIVATION_HASH"
  );
  const configuredCommit = requiredEnvironment(environment, "TOOLPROOF_PROBE_ACTIVE_COMMIT");
  let operatorClaims: ProbeOperatorClaims;
  try {
    operatorClaims = verifyProbeOperatorCredential({
      cookieValue: namedCookieFromRequest(request, PROBE_OPERATOR_COOKIE),
      signingSecret,
      activationHash: configuredActivationHash,
      buildCommit: configuredCommit,
      actorHash,
      nowMs
    });
  } catch {
    throw new ProbeServiceError("probe_operator_not_armed", 403);
  }
  const activation = await activationOf(dependencies);
  const migration = migrationOf(activation);
  if (
    activation.guard.phase !== "idle" ||
    activation.guard.claimedCalls !== PROBE_CALIBRATION_BASE_CALLS ||
    activation.guard.knownCalls !== PROBE_CALIBRATION_BASE_CALLS ||
    activation.guard.calibrationCalls !== PROBE_CALIBRATION_BASE_CALLS ||
    activation.guard.pendingCalls !== 0 ||
    activation.guard.uncertainCalls !== 0 ||
    activation.guard.committedNanoUsd !==
      PROBE_CALIBRATION_BASE_CALLS * PROBE_PER_CALL_RESERVATION_NANO_USD ||
    activation.guard.knownAccountedNanoUsd !== migration.preserved.knownActualNanoUsd
  ) {
    throw new ProbeServiceError("calibration_session_unavailable", 409);
  }
  const launchHash = deriveProbeLaunchHash(launchId, signingSecret);
  const redis = redisOf(dependencies, environment);
  try {
    await assertProbeOperatorArmed(redis, {
      activationHash: activation.activationHash,
      buildCommit: activation.manifest.activeCommit,
      actorHash
    });
  } catch {
    throw new ProbeServiceError("probe_operator_not_armed", 403);
  }
  const existing = await getProbeRunIndexByLaunch(redis, {
    activationHash: activation.activationHash,
    buildCommit: activation.manifest.activeCommit,
    actorHash,
    launchHash,
    artifactSecret: signingSecret
  });
  if (existing) {
    if (existing.index.nextOrdinal !== 0 || existing.index.payload.terminal) {
      throw new ProbeServiceError("calibration_session_unavailable", 409);
    }
    const refreshed = issueRecoveredProbeSession({
      recovery: existing.recovery,
      signingSecret,
      nowMs: nowOf(dependencies)
    });
    return Object.freeze({
      cookieValue: refreshed.cookieValue,
      recoveryCookieValue: signExistingProbeRecoveryCredential(existing.recovery, signingSecret),
      csrfToken: refreshed.csrfToken,
      continuation: existing.index.payload.continuation,
      buildCommit: activation.manifest.activeCommit,
      expiresAt: refreshed.claims.expiresAt,
      recoveryExpiresAt: existing.recovery.expiresAt
    });
  }
  if (
    operatorClaims.expiresAt - Math.floor(nowMs / 1_000) <
    PROBE_RECOVERY_TTL_SECONDS + PROBE_OPERATOR_LAUNCH_RETRY_MARGIN_SECONDS
  ) {
    throw new ProbeServiceError("operator_launch_window_expired", 409);
  }
  const issued = issueProbeSession({
    activationHash: activation.activationHash,
    buildCommit: activation.manifest.activeCommit,
    actorHash,
    signingSecret,
    nowMs
  });
  const recovery = issueProbeRecoveryCredential({
    session: issued.claims,
    launchHash,
    signingSecret
  });
  const continuation = await createInitialProbeRunContinuation({
    recovery: recovery.claims,
    signingSecret
  });
  let runIndex: ProbeRunIndexReceipt;
  try {
    runIndex = await putProbeRunIndex(redis, {
      recovery: recovery.claims,
      continuation,
      artifactSecret: signingSecret
    });
  } catch {
    const raced = await getProbeRunIndexByLaunch(redis, {
      activationHash: activation.activationHash,
      buildCommit: activation.manifest.activeCommit,
      actorHash,
      launchHash,
      artifactSecret: signingSecret
    });
    if (!raced || raced.index.nextOrdinal !== 0 || raced.index.payload.terminal) {
      throw new ProbeServiceError("calibration_run_index_unavailable", 409);
    }
    const refreshed = issueRecoveredProbeSession({
      recovery: raced.recovery,
      signingSecret,
      nowMs: nowOf(dependencies)
    });
    return Object.freeze({
      cookieValue: refreshed.cookieValue,
      recoveryCookieValue: signExistingProbeRecoveryCredential(raced.recovery, signingSecret),
      csrfToken: refreshed.csrfToken,
      continuation: raced.index.payload.continuation,
      buildCommit: activation.manifest.activeCommit,
      expiresAt: refreshed.claims.expiresAt,
      recoveryExpiresAt: raced.recovery.expiresAt
    });
  }
  if (runIndex.nextOrdinal !== 0 || runIndex.payload.continuation !== continuation) {
    throw new ProbeServiceError("calibration_run_index_unavailable", 503);
  }
  return Object.freeze({
    cookieValue: issued.cookieValue,
    recoveryCookieValue: recovery.cookieValue,
    csrfToken: issued.csrfToken,
    continuation,
    buildCommit: activation.manifest.activeCommit,
    expiresAt: issued.claims.expiresAt,
    recoveryExpiresAt: recovery.claims.expiresAt
  });
}

/**
 * Dormant local-only entry point for the approved pinned GoogleChromeLabs fallback lane.
 * No route references this function; activation remains an explicit later human gate.
 */
export async function startFallbackProbeCalibrationSession(
  request: Request,
  launchId: string,
  dependencies: ProbeServiceDependencies = {}
) {
  const environment = environmentOf(dependencies);
  const nowMs = nowOf(dependencies);
  const signingSecret = requiredEnvironment(environment, "TOOLPROOF_SIGNING_SECRET");
  const actorHash = deriveProbeActorHash(request, signingSecret);
  const configuredActivationHash = requiredEnvironment(
    environment,
    "TOOLPROOF_PROBE_ACTIVATION_HASH"
  );
  const configuredCommit = requiredEnvironment(environment, "TOOLPROOF_PROBE_ACTIVE_COMMIT");
  let operatorClaims: ProbeOperatorClaims;
  try {
    operatorClaims = verifyProbeOperatorCredential({
      cookieValue: namedCookieFromRequest(request, PROBE_OPERATOR_COOKIE),
      signingSecret,
      activationHash: configuredActivationHash,
      buildCommit: configuredCommit,
      actorHash,
      nowMs
    });
  } catch {
    throw new ProbeServiceError("fallback_operator_not_armed", 403);
  }
  const activation = await activationOf(dependencies);
  const migration = fallbackMigrationOf(activation);
  if (
    activation.guard.phase !== "idle" ||
    activation.guard.claimedCalls !== FALLBACK_PROBE_CALIBRATION_BASE_CALLS ||
    activation.guard.knownCalls !== FALLBACK_PROBE_CALIBRATION_BASE_CALLS ||
    activation.guard.calibrationCalls !== FALLBACK_PROBE_CALIBRATION_BASE_CALLS ||
    activation.guard.pendingCalls !== 0 ||
    activation.guard.uncertainCalls !== 0 ||
    activation.guard.committedNanoUsd !==
      FALLBACK_PROBE_CALIBRATION_BASE_CALLS * PROBE_PER_CALL_RESERVATION_NANO_USD ||
    activation.guard.knownAccountedNanoUsd !== migration.preserved.knownActualNanoUsd
  ) {
    throw new ProbeServiceError("fallback_calibration_session_unavailable", 409);
  }
  const launchHash = deriveProbeLaunchHash(launchId, signingSecret);
  const redis = redisOf(dependencies, environment);
  try {
    await assertProbeOperatorArmed(redis, {
      activationHash: activation.activationHash,
      buildCommit: activation.manifest.activeCommit,
      actorHash
    });
  } catch {
    throw new ProbeServiceError("fallback_operator_not_armed", 403);
  }
  const existing = await getProbeRunIndexByLaunch(redis, {
    activationHash: activation.activationHash,
    buildCommit: activation.manifest.activeCommit,
    actorHash,
    launchHash,
    artifactSecret: signingSecret
  });
  if (existing) {
    if (existing.index.nextOrdinal !== 0 || existing.index.payload.terminal) {
      throw new ProbeServiceError("fallback_calibration_session_unavailable", 409);
    }
    const refreshed = issueRecoveredProbeSession({
      recovery: existing.recovery,
      signingSecret,
      nowMs: nowOf(dependencies)
    });
    return Object.freeze({
      version: FALLBACK_PROBE_SERVICE_VERSION,
      protocolVersion: FALLBACK_PROBE_CALIBRATION_PROTOCOL_VERSION,
      lane: FALLBACK_PROBE_CALIBRATION_LANE,
      cookieValue: refreshed.cookieValue,
      recoveryCookieValue: signExistingProbeRecoveryCredential(existing.recovery, signingSecret),
      csrfToken: refreshed.csrfToken,
      continuation: existing.index.payload.continuation,
      buildCommit: activation.manifest.activeCommit,
      expiresAt: refreshed.claims.expiresAt,
      recoveryExpiresAt: existing.recovery.expiresAt,
      inferencePerformed: false as const
    });
  }
  if (
    operatorClaims.expiresAt - Math.floor(nowMs / 1_000) <
    PROBE_RECOVERY_TTL_SECONDS + PROBE_OPERATOR_LAUNCH_RETRY_MARGIN_SECONDS
  ) {
    throw new ProbeServiceError("fallback_operator_launch_window_expired", 409);
  }
  const issued = issueProbeSession({
    activationHash: activation.activationHash,
    buildCommit: activation.manifest.activeCommit,
    actorHash,
    signingSecret,
    nowMs
  });
  const recovery = issueProbeRecoveryCredential({
    session: issued.claims,
    launchHash,
    signingSecret
  });
  const continuation = await createInitialProbeRunContinuation({
    recovery: recovery.claims,
    signingSecret
  });
  let runIndex: ProbeRunIndexReceipt;
  try {
    runIndex = await putProbeRunIndex(redis, {
      recovery: recovery.claims,
      continuation,
      artifactSecret: signingSecret
    });
  } catch {
    const raced = await getProbeRunIndexByLaunch(redis, {
      activationHash: activation.activationHash,
      buildCommit: activation.manifest.activeCommit,
      actorHash,
      launchHash,
      artifactSecret: signingSecret
    });
    if (!raced || raced.index.nextOrdinal !== 0 || raced.index.payload.terminal) {
      throw new ProbeServiceError("fallback_run_index_unavailable", 409);
    }
    const refreshed = issueRecoveredProbeSession({
      recovery: raced.recovery,
      signingSecret,
      nowMs: nowOf(dependencies)
    });
    return Object.freeze({
      version: FALLBACK_PROBE_SERVICE_VERSION,
      protocolVersion: FALLBACK_PROBE_CALIBRATION_PROTOCOL_VERSION,
      lane: FALLBACK_PROBE_CALIBRATION_LANE,
      cookieValue: refreshed.cookieValue,
      recoveryCookieValue: signExistingProbeRecoveryCredential(raced.recovery, signingSecret),
      csrfToken: refreshed.csrfToken,
      continuation: raced.index.payload.continuation,
      buildCommit: activation.manifest.activeCommit,
      expiresAt: refreshed.claims.expiresAt,
      recoveryExpiresAt: raced.recovery.expiresAt,
      inferencePerformed: false as const
    });
  }
  if (runIndex.nextOrdinal !== 0 || runIndex.payload.continuation !== continuation) {
    throw new ProbeServiceError("fallback_run_index_unavailable", 503);
  }
  return Object.freeze({
    version: FALLBACK_PROBE_SERVICE_VERSION,
    protocolVersion: FALLBACK_PROBE_CALIBRATION_PROTOCOL_VERSION,
    lane: FALLBACK_PROBE_CALIBRATION_LANE,
    cookieValue: issued.cookieValue,
    recoveryCookieValue: recovery.cookieValue,
    csrfToken: issued.csrfToken,
    continuation,
    buildCommit: activation.manifest.activeCommit,
    expiresAt: issued.claims.expiresAt,
    recoveryExpiresAt: recovery.claims.expiresAt,
    inferencePerformed: false as const
  });
}

async function reconcileRecoveredRunIndex(input: {
  readonly redis: ServiceRedis;
  readonly activation: ProbeActivationContext;
  readonly recovery: ProbeRecoveryClaims;
  readonly signingSecret: string;
  readonly activationSecret: string;
  readonly documentId: string;
}): Promise<ProbeRunIndexReceipt> {
  let index = await getProbeRunIndex(input.redis, {
    recovery: input.recovery,
    artifactSecret: input.signingSecret
  });
  if (!index) throw new ProbeServiceError("probe_run_index_missing", 409);

  const claimed = input.activation.guard.calibrationCalls;
  const expectedSettled = PROBE_CALIBRATION_BASE_CALLS + index.nextOrdinal;
  if (
    input.activation.guard.phase === "single-inflight" &&
    claimed === expectedSettled + 1 &&
    !index.payload.terminal
  ) {
    return index;
  }
  if (input.activation.guard.phase !== "idle") {
    throw new ProbeServiceError("probe_run_index_guard_mismatch", 409);
  }
  if (claimed === expectedSettled) return index;
  if (claimed !== expectedSettled + 1 || index.payload.terminal) {
    throw new ProbeServiceError("probe_run_index_guard_mismatch", 409);
  }

  const ids = deriveProbeTrialOpaqueIds({
    runId: input.recovery.runId,
    ordinal: index.nextOrdinal,
    activationSecret: input.activationSecret
  });
  const completion = await getProbeContinuation<z.infer<typeof completionCacheSchema>>(
    input.redis,
    {
      jti: ids.jti,
      stage: "completion",
      artifactSecret: input.signingSecret
    }
  );
  if (!completion) throw new ProbeServiceError("probe_completion_recovery_missing", 409);
  const cached = completionCacheSchema.parse(completion.payload);
  try {
    await settleProbeCallKnown(input.redis, {
      ...input.activation.guardIdentity,
      jti: ids.jti,
      ...cached.settlement
    });
  } catch {
    throw new ProbeServiceError("known_settlement_failed", 503, true);
  }
  index = await advanceProbeRunIndex(input.redis, {
    recovery: input.recovery,
    current: index,
    continuation: cached.response.continuation,
    documentId: input.documentId,
    artifactSecret: input.signingSecret
  });
  return index;
}

export async function recoverProbeCalibrationSession(
  request: Request,
  documentId: string,
  dependencies: ProbeServiceDependencies = {}
) {
  const environment = environmentOf(dependencies);
  const activation = await activationOf(dependencies);
  migrationOf(activation);
  const nowMs = nowOf(dependencies);
  const signingSecret = requiredEnvironment(environment, "TOOLPROOF_SIGNING_SECRET");
  const recovery = authenticateRecovery({
    request,
    activation,
    environment,
    nowMs
  });
  const redis = redisOf(dependencies, environment);
  await claimProbeRunDocument(redis, {
    recovery,
    documentId,
    artifactSecret: signingSecret
  });
  const index = await reconcileRecoveredRunIndex({
    redis,
    activation,
    recovery,
    signingSecret,
    activationSecret: requiredEnvironment(environment, "TOOLPROOF_PROBE_ACTIVATION_SECRET"),
    documentId
  });
  const session = issueRecoveredProbeSession({ recovery, signingSecret, nowMs });
  return Object.freeze({
    cookieValue: session.cookieValue,
    csrfToken: session.csrfToken,
    continuation: index.payload.continuation,
    buildCommit: recovery.buildCommit,
    expiresAt: session.claims.expiresAt,
    recoveryExpiresAt: recovery.expiresAt,
    path: index.payload.terminal ? ("/results" as const) : ("/lab" as const)
  });
}

async function reconcileRecoveredFallbackRunIndex(input: {
  readonly redis: ServiceRedis;
  readonly activation: ProbeActivationContext;
  readonly recovery: ProbeRecoveryClaims;
  readonly signingSecret: string;
  readonly activationSecret: string;
  readonly documentId: string;
}): Promise<ProbeRunIndexReceipt> {
  let index = await getProbeRunIndex(input.redis, {
    recovery: input.recovery,
    artifactSecret: input.signingSecret
  });
  if (!index) throw new ProbeServiceError("fallback_run_index_missing", 409);
  const claimed = input.activation.guard.calibrationCalls;
  const expectedSettled = FALLBACK_PROBE_CALIBRATION_BASE_CALLS + index.nextOrdinal;
  if (
    input.activation.guard.phase === "single-inflight" &&
    claimed === expectedSettled + 1 &&
    !index.payload.terminal
  ) {
    return index;
  }
  if (input.activation.guard.phase !== "idle") {
    throw new ProbeServiceError("fallback_run_index_guard_mismatch", 409);
  }
  if (claimed === expectedSettled) return index;
  if (claimed !== expectedSettled + 1 || index.payload.terminal) {
    throw new ProbeServiceError("fallback_run_index_guard_mismatch", 409);
  }
  const ids = deriveProbeTrialOpaqueIds({
    runId: input.recovery.runId,
    ordinal: index.nextOrdinal,
    activationSecret: input.activationSecret
  });
  const completion = await getProbeContinuation<z.infer<typeof fallbackCompletionCacheSchema>>(
    input.redis,
    { jti: ids.jti, stage: "completion", artifactSecret: input.signingSecret }
  );
  if (!completion) throw new ProbeServiceError("fallback_completion_recovery_missing", 409);
  const cached = fallbackCompletionCacheSchema.parse(completion.payload);
  try {
    await settleProbeCallKnown(input.redis, {
      ...input.activation.guardIdentity,
      jti: ids.jti,
      ...cached.settlement
    });
  } catch {
    throw new ProbeServiceError("known_settlement_failed", 503, true);
  }
  index = await advanceProbeRunIndex(input.redis, {
    recovery: input.recovery,
    current: index,
    continuation: cached.response.continuation,
    documentId: input.documentId,
    artifactSecret: input.signingSecret
  });
  return index;
}

export async function recoverFallbackProbeCalibrationSession(
  request: Request,
  documentId: string,
  dependencies: ProbeServiceDependencies = {}
) {
  const environment = environmentOf(dependencies);
  const activation = await activationOf(dependencies);
  fallbackMigrationOf(activation);
  const nowMs = nowOf(dependencies);
  const signingSecret = requiredEnvironment(environment, "TOOLPROOF_SIGNING_SECRET");
  const recovery = authenticateRecovery({ request, activation, environment, nowMs });
  const redis = redisOf(dependencies, environment);
  await claimProbeRunDocument(redis, { recovery, documentId, artifactSecret: signingSecret });
  const index = await reconcileRecoveredFallbackRunIndex({
    redis,
    activation,
    recovery,
    signingSecret,
    activationSecret: requiredEnvironment(environment, "TOOLPROOF_PROBE_ACTIVATION_SECRET"),
    documentId
  });
  const session = issueRecoveredProbeSession({ recovery, signingSecret, nowMs });
  return Object.freeze({
    version: 1 as const,
    protocolVersion: FALLBACK_PROBE_CALIBRATION_PROTOCOL_VERSION,
    lane: FALLBACK_PROBE_CALIBRATION_LANE,
    status: "recovered" as const,
    cookieValue: session.cookieValue,
    csrfToken: session.csrfToken,
    continuation: index.payload.continuation,
    buildCommit: recovery.buildCommit,
    expiresAt: session.claims.expiresAt,
    recoveryExpiresAt: recovery.expiresAt,
    path: index.payload.terminal ? ("/results" as const) : ("/lab" as const),
    inferencePerformed: false as const
  });
}

export async function clearUnstartedProbeCalibrationSession(
  request: Request,
  dependencies: ProbeServiceDependencies = {}
): Promise<{ readonly disposition: "deleted" | "missing" }> {
  const environment = environmentOf(dependencies);
  const activation = await activationOf(dependencies);
  migrationOf(activation);
  const nowMs = nowOf(dependencies);
  const signingSecret = requiredEnvironment(environment, "TOOLPROOF_SIGNING_SECRET");
  const recovery = authenticateRecovery({
    request,
    activation,
    environment,
    nowMs
  });
  const initialIds = deriveProbeTrialOpaqueIds({
    runId: recovery.runId,
    ordinal: 0,
    activationSecret: requiredEnvironment(environment, "TOOLPROOF_PROBE_ACTIVATION_SECRET")
  });
  const disposition = await deleteUnstartedProbeRunIndex(redisOf(dependencies, environment), {
    recovery,
    artifactSecret: signingSecret,
    guard: {
      configKey: PRODUCTION_PROBE_KEYSPACE.config,
      totalsKey: PRODUCTION_PROBE_KEYSPACE.totals,
      purposeCountsKey: PRODUCTION_PROBE_KEYSPACE.purposeCounts,
      inflightKey: PRODUCTION_PROBE_KEYSPACE.inflight,
      guardInstanceId: activation.guardIdentity.guardInstanceId,
      policyHash: activation.guardIdentity.policyHash,
      scriptHash: activation.guardIdentity.scriptHash,
      initializedCommit: activation.guardIdentity.initializedCommit,
      baseCalibrationCalls: PROBE_CALIBRATION_BASE_CALLS,
      authorizationKey: probeAuthorizationKey(PRODUCTION_PROBE_KEYSPACE, initialIds.jti),
      jti: initialIds.jti
    }
  });
  return Object.freeze({ disposition });
}

export async function clearUnstartedFallbackProbeCalibrationSession(
  request: Request,
  dependencies: ProbeServiceDependencies = {}
): Promise<{ readonly disposition: "deleted" | "missing" }> {
  const environment = environmentOf(dependencies);
  const activation = await activationOf(dependencies);
  fallbackMigrationOf(activation);
  const nowMs = nowOf(dependencies);
  const signingSecret = requiredEnvironment(environment, "TOOLPROOF_SIGNING_SECRET");
  const recovery = authenticateRecovery({ request, activation, environment, nowMs });
  const initialIds = deriveProbeTrialOpaqueIds({
    runId: recovery.runId,
    ordinal: 0,
    activationSecret: requiredEnvironment(environment, "TOOLPROOF_PROBE_ACTIVATION_SECRET")
  });
  const disposition = await deleteUnstartedProbeRunIndex(redisOf(dependencies, environment), {
    recovery,
    artifactSecret: signingSecret,
    guard: {
      configKey: PRODUCTION_PROBE_KEYSPACE.config,
      totalsKey: PRODUCTION_PROBE_KEYSPACE.totals,
      purposeCountsKey: PRODUCTION_PROBE_KEYSPACE.purposeCounts,
      inflightKey: PRODUCTION_PROBE_KEYSPACE.inflight,
      guardInstanceId: activation.guardIdentity.guardInstanceId,
      policyHash: activation.guardIdentity.policyHash,
      scriptHash: activation.guardIdentity.scriptHash,
      initializedCommit: activation.guardIdentity.initializedCommit,
      baseCalibrationCalls: FALLBACK_PROBE_CALIBRATION_BASE_CALLS,
      authorizationKey: probeAuthorizationKey(PRODUCTION_PROBE_KEYSPACE, initialIds.jti),
      jti: initialIds.jti
    }
  });
  return Object.freeze({ disposition });
}

export async function issueProbeCalibrationTrial(
  request: Request,
  value: unknown,
  dependencies: ProbeServiceDependencies = {}
): Promise<ProbeIssueResult> {
  const environment = environmentOf(dependencies);
  const activation = await activationOf(dependencies);
  const nowMs = nowOf(dependencies);
  const session = authenticateSession({
    request,
    activation,
    environment,
    requireCsrf: true,
    nowMs
  });
  const recovery = authenticateRecovery({
    request,
    activation,
    environment,
    nowMs,
    session
  });
  const signingSecret = requiredEnvironment(environment, "TOOLPROOF_SIGNING_SECRET");
  const activationSecret = requiredEnvironment(environment, "TOOLPROOF_PROBE_ACTIVATION_SECRET");
  const body = probeIssueBodySchema.parse(value);
  const continuation = await openProbeRunContinuation({
    token: body.continuation,
    signingSecret,
    session,
    recovery,
    activationHash: activation.activationHash,
    buildCommit: activation.manifest.activeCommit,
    nowMs
  });
  if (continuation.nextOrdinal >= PROBE_CALIBRATION_CASE_COUNT) {
    throw new ProbeServiceError("calibration_sequence_mismatch", 409);
  }
  await validateInitialIssueBoundary(body, activation.manifest.activeCommit);
  const ordinal = continuation.nextOrdinal;
  const definition = getProbeCalibrationCase(ordinal);
  const ids = deriveProbeTrialOpaqueIds({ runId: session.runId, ordinal, activationSecret });
  const transport = await createProbeTransportBinding({
    runId: session.runId,
    caseId: ids.caseId,
    trialId: ids.trialId
  });
  const envelope: ProbeCalibrationEnvelope = {
    version: PROBE_CALIBRATION_ENVELOPE_VERSION,
    purpose: "calibration",
    buildCommit: activation.manifest.activeCommit,
    runId: session.runId,
    caseId: ids.caseId,
    trialId: ids.trialId,
    naturalLanguageRequest: definition.naturalLanguageRequest,
    fixture: body.fixture,
    liveManifest: body.liveManifest,
    runner: {
      promptVersion: PROBE_RUNNER_PROMPT_VERSION,
      promptHash: await probeRunnerPromptHash(),
      settingsVersion: PROBE_RUNNER_SETTINGS_VERSION,
      settingsHash: await probeRunnerSettingsHash(),
      decisionSchemaHash: await probeDecisionJsonSchemaHash(body.liveManifest, transport),
      transport
    }
  };
  const redis = redisOf(dependencies, environment);
  await assertDocumentOwner({ request, redis, recovery, signingSecret });
  const recoveredCompletion = await getProbeContinuation<z.infer<typeof completionCacheSchema>>(
    redis,
    {
      jti: ids.jti,
      stage: "completion",
      artifactSecret: signingSecret
    }
  );
  if (recoveredCompletion) {
    const cached = completionCacheSchema.parse(recoveredCompletion.payload);
    try {
      await settleProbeCallKnown(redis, {
        ...activation.guardIdentity,
        jti: ids.jti,
        ...cached.settlement
      });
    } catch {
      throw new ProbeServiceError("known_settlement_failed", 503, true);
    }
    return probeIssueResultSchema.parse({
      ...cached.response,
      version: PROBE_SERVICE_VERSION,
      protocolVersion: PROBE_CALIBRATION_PROTOCOL_VERSION,
      attempt: PROBE_CALIBRATION_ATTEMPT,
      status: "already-sealed"
    });
  }
  const expectedClaims =
    PROBE_CALIBRATION_BASE_CALLS + (activation.guard.phase === "idle" ? ordinal : ordinal + 1);
  if (activation.guard.calibrationCalls !== expectedClaims) {
    throw new ProbeServiceError("calibration_sequence_mismatch", 409);
  }
  const requestBinding = await canonicalSha256({
    continuation: body.continuation,
    fixture: body.fixture,
    liveManifest: body.liveManifest,
    boundary: {
      status: body.initialBoundary.status,
      catalogState: body.initialBoundary.catalogState,
      fixtureId: body.initialBoundary.fixtureId,
      fixtureSeed: body.initialBoundary.fixtureSeed,
      stateRevision: body.initialBoundary.stateRevision,
      stateHash: body.initialBoundary.stateHash,
      manifestHash: body.initialBoundary.manifestHash,
      operationLedgerCount: body.initialBoundary.operationLedgerCount,
      currentTrajectoryCount: body.initialBoundary.currentTrajectoryCount,
      registeredToolNames: body.initialBoundary.registeredToolNames
    }
  });
  let cached = await getProbeContinuation<z.infer<typeof issueCacheSchema>>(redis, {
    jti: ids.jti,
    stage: "issue",
    artifactSecret: signingSecret
  });
  if (!cached) {
    const { createProbeToken } = await import("@/lib/probe/token");
    const token = createProbeToken(
      {
        policyHash: await probePolicyHash(),
        guardInstanceId: activation.manifest.guardInstanceId,
        buildCommit: activation.manifest.activeCommit,
        activationHash: activation.activationHash,
        sessionHash: await sha256Hex(session.sessionId),
        purpose: "calibration",
        runId: session.runId,
        caseId: ids.caseId,
        trialId: ids.trialId,
        fixtureHash: CHECKOUT_FIXTURE_STATE_HASH,
        requestHash: await sha256Hex(definition.naturalLanguageRequest),
        manifestHash: body.liveManifest.manifestHash,
        settingsHash: envelope.runner.settingsHash,
        envelopeHash: await probeCalibrationEnvelopeHash(envelope),
        jti: ids.jti,
        nowMs
      },
      signingSecret
    );
    const response = probeIssueResponseSchema.parse({
      version: PROBE_SERVICE_VERSION,
      protocolVersion: PROBE_CALIBRATION_PROTOCOL_VERSION,
      attempt: PROBE_CALIBRATION_ATTEMPT,
      status: "issued",
      runId: session.runId,
      caseId: ids.caseId,
      trialId: ids.trialId,
      authorization: {
        version: 1,
        probeToken: token.token,
        envelope,
        continuation: body.continuation
      }
    });
    const payload = issueCacheSchema.parse({
      requestBinding,
      claimsHash: await canonicalSha256(token.claims),
      subjectHash: await canonicalSha256({
        activationHash: activation.activationHash,
        sessionId: session.sessionId,
        runId: session.runId,
        ordinal,
        caseId: ids.caseId,
        trialId: ids.trialId
      }),
      response
    });
    cached = await putProbeContinuation(redis, {
      jti: ids.jti,
      stage: "issue",
      payload,
      artifactSecret: signingSecret
    });
  }
  const payload = issueCacheSchema.parse(cached.payload);
  if (payload.requestBinding !== requestBinding) {
    throw new ProbeServiceError("issue_replay_mismatch", 409);
  }
  if (activation.guard.phase === "idle") {
    await issueProbeAuthorization(redis, {
      ...activation.guardIdentity,
      jti: ids.jti,
      claimsHash: payload.claimsHash,
      purpose: "calibration",
      subjectHash: payload.subjectHash,
      actorHash: session.actorHash,
      runAdmission: runAdmission({ request, recovery, signingSecret, ordinal })
    });
  }
  return payload.response;
}

export async function issueFallbackProbeCalibrationTrial(
  request: Request,
  value: unknown,
  dependencies: ProbeServiceDependencies = {}
): Promise<FallbackProbeIssueResult> {
  const environment = environmentOf(dependencies);
  const activation = await activationOf(dependencies);
  fallbackMigrationOf(activation);
  const nowMs = nowOf(dependencies);
  const session = authenticateSession({
    request,
    activation,
    environment,
    requireCsrf: true,
    nowMs
  });
  const recovery = authenticateRecovery({ request, activation, environment, nowMs, session });
  const signingSecret = requiredEnvironment(environment, "TOOLPROOF_SIGNING_SECRET");
  const activationSecret = requiredEnvironment(environment, "TOOLPROOF_PROBE_ACTIVATION_SECRET");
  const body = fallbackProbeIssueBodySchema.parse(value);
  const continuation = await openProbeRunContinuation({
    token: body.continuation,
    signingSecret,
    session,
    recovery,
    activationHash: activation.activationHash,
    buildCommit: activation.manifest.activeCommit,
    nowMs
  });
  if (continuation.nextOrdinal >= FALLBACK_PROBE_CALIBRATION_CASE_COUNT) {
    throw new ProbeServiceError("fallback_calibration_sequence_mismatch", 409);
  }
  await validateInitialIssueBoundary(body, activation.manifest.activeCommit);
  const ordinal = continuation.nextOrdinal;
  const definition = getProbeCalibrationCase(ordinal);
  const ids = deriveProbeTrialOpaqueIds({ runId: session.runId, ordinal, activationSecret });
  const transport = await createProbeTransportBinding({
    runId: session.runId,
    caseId: ids.caseId,
    trialId: ids.trialId
  });
  const [promptHash, settingsHash, browserRuntimeHash, toolDefinitionsHash, noCallSchemaHash] =
    await Promise.all([
      fallbackRunnerPromptHash(),
      fallbackRunnerSettingsHash(),
      fallbackBrowserRuntimeContractHash(),
      probeFunctionToolDefinitionsHash(body.liveManifest, transport),
      fallbackNoCallJsonSchemaHash()
    ]);
  const envelope: FallbackCalibrationEnvelope = {
    version: FALLBACK_CALIBRATION_ENVELOPE_VERSION,
    purpose: "calibration",
    buildCommit: activation.manifest.activeCommit,
    runId: session.runId,
    caseId: ids.caseId,
    trialId: ids.trialId,
    naturalLanguageRequest: definition.naturalLanguageRequest,
    fixture: body.fixture,
    liveManifest: body.liveManifest,
    runner: {
      implementation: FALLBACK_IMPLEMENTATION,
      upstreamCommit: FALLBACK_UPSTREAM_PIN.commit,
      upstreamSubtree: FALLBACK_UPSTREAM_PIN.subtree,
      promptVersion: FALLBACK_RUNNER_PROMPT_VERSION,
      promptHash,
      settingsVersion: FALLBACK_RUNNER_SETTINGS_VERSION,
      settingsHash,
      browserRuntimeHash,
      toolDefinitionsHash,
      noCallSchemaHash,
      transport
    }
  };
  await validateFrozenFallbackEnvelope(envelope, ordinal, activation);
  const redis = redisOf(dependencies, environment);
  await assertDocumentOwner({ request, redis, recovery, signingSecret });
  const recoveredCompletion = await getProbeContinuation<
    z.infer<typeof fallbackCompletionCacheSchema>
  >(redis, {
    jti: ids.jti,
    stage: "completion",
    artifactSecret: signingSecret
  });
  if (recoveredCompletion) {
    const cached = fallbackCompletionCacheSchema.parse(recoveredCompletion.payload);
    try {
      await settleProbeCallKnown(redis, {
        ...activation.guardIdentity,
        jti: ids.jti,
        ...cached.settlement
      });
    } catch {
      throw new ProbeServiceError("known_settlement_failed", 503, true);
    }
    return fallbackProbeIssueResultSchema.parse({ ...cached.response, status: "already-sealed" });
  }
  const expectedClaims =
    FALLBACK_PROBE_CALIBRATION_BASE_CALLS +
    (activation.guard.phase === "idle" ? ordinal : ordinal + 1);
  if (activation.guard.calibrationCalls !== expectedClaims) {
    throw new ProbeServiceError("fallback_calibration_sequence_mismatch", 409);
  }
  const requestBinding = await canonicalSha256({
    continuation: body.continuation,
    fixture: body.fixture,
    liveManifest: body.liveManifest,
    boundary: {
      status: body.initialBoundary.status,
      catalogState: body.initialBoundary.catalogState,
      fixtureId: body.initialBoundary.fixtureId,
      fixtureSeed: body.initialBoundary.fixtureSeed,
      stateRevision: body.initialBoundary.stateRevision,
      stateHash: body.initialBoundary.stateHash,
      manifestHash: body.initialBoundary.manifestHash,
      operationLedgerCount: body.initialBoundary.operationLedgerCount,
      currentTrajectoryCount: body.initialBoundary.currentTrajectoryCount,
      registeredToolNames: body.initialBoundary.registeredToolNames
    }
  });
  let cached = await getProbeContinuation<z.infer<typeof fallbackIssueCacheSchema>>(redis, {
    jti: ids.jti,
    stage: "issue",
    artifactSecret: signingSecret
  });
  if (!cached) {
    const { createProbeToken } = await import("@/lib/probe/token");
    const token = createProbeToken(
      {
        policyHash: await probePolicyHash(),
        guardInstanceId: activation.manifest.guardInstanceId,
        buildCommit: activation.manifest.activeCommit,
        activationHash: activation.activationHash,
        sessionHash: await sha256Hex(session.sessionId),
        purpose: "calibration",
        runId: session.runId,
        caseId: ids.caseId,
        trialId: ids.trialId,
        fixtureHash: CHECKOUT_FIXTURE_STATE_HASH,
        requestHash: await sha256Hex(definition.naturalLanguageRequest),
        manifestHash: body.liveManifest.manifestHash,
        settingsHash: envelope.runner.settingsHash,
        envelopeHash: await fallbackCalibrationEnvelopeHash(envelope),
        jti: ids.jti,
        nowMs
      },
      signingSecret
    );
    const response = fallbackProbeIssueResponseSchema.parse({
      version: FALLBACK_PROBE_SERVICE_VERSION,
      protocolVersion: FALLBACK_PROBE_CALIBRATION_PROTOCOL_VERSION,
      lane: FALLBACK_PROBE_CALIBRATION_LANE,
      status: "issued",
      runId: session.runId,
      caseId: ids.caseId,
      trialId: ids.trialId,
      authorization: {
        version: 1,
        probeToken: token.token,
        envelope,
        continuation: body.continuation
      }
    });
    const payload = fallbackIssueCacheSchema.parse({
      requestBinding,
      claimsHash: await canonicalSha256(token.claims),
      subjectHash: await canonicalSha256({
        activationHash: activation.activationHash,
        sessionId: session.sessionId,
        runId: session.runId,
        lane: FALLBACK_PROBE_CALIBRATION_LANE,
        ordinal,
        caseId: ids.caseId,
        trialId: ids.trialId
      }),
      response
    });
    cached = await putProbeContinuation(redis, {
      jti: ids.jti,
      stage: "issue",
      payload,
      artifactSecret: signingSecret
    });
  }
  const payload = fallbackIssueCacheSchema.parse(cached.payload);
  if (payload.requestBinding !== requestBinding) {
    throw new ProbeServiceError("fallback_issue_replay_mismatch", 409);
  }
  if (activation.guard.phase === "idle") {
    await issueProbeAuthorization(redis, {
      ...activation.guardIdentity,
      jti: ids.jti,
      claimsHash: payload.claimsHash,
      purpose: "calibration",
      subjectHash: payload.subjectHash,
      actorHash: session.actorHash,
      runAdmission: runAdmission({ request, recovery, signingSecret, ordinal })
    });
  }
  return payload.response;
}

export async function decideProbeCalibrationTrial(
  request: Request,
  value: unknown,
  dependencies: ProbeServiceDependencies = {}
): Promise<ProbeFreshDecisionResponse> {
  const environment = environmentOf(dependencies);
  const activation = await activationOf(dependencies);
  const nowMs = nowOf(dependencies);
  const session = authenticateSession({
    request,
    activation,
    environment,
    requireCsrf: true,
    nowMs
  });
  const recovery = authenticateRecovery({
    request,
    activation,
    environment,
    nowMs,
    session
  });
  const signingSecret = requiredEnvironment(environment, "TOOLPROOF_SIGNING_SECRET");
  const activationSecret = requiredEnvironment(environment, "TOOLPROOF_PROBE_ACTIVATION_SECRET");
  const body = probeDecideBodySchema.parse(value);
  const verified = await verifyEnvelopeAgainstClaims({
    envelope: body.envelope,
    token: body.probeToken,
    activation,
    session,
    signingSecret,
    nowMs,
    allowExpiredRecovery: true
  });
  const ordinal = ordinalForEnvelope(verified.envelope, session.runId, activationSecret);
  assertDerivedProbeJti({
    runId: session.runId,
    ordinal,
    activationSecret,
    jti: verified.claims.jti
  });
  await validateFrozenEnvelope(verified.envelope, ordinal, activation);
  const requestBinding = await canonicalSha256(body);
  const redis = redisOf(dependencies, environment);
  await assertDocumentOwner({ request, redis, recovery, signingSecret });
  const recovered = await getProbeContinuation<z.infer<typeof decisionCacheSchema>>(redis, {
    jti: verified.claims.jti,
    stage: "decision",
    artifactSecret: signingSecret
  });
  if (recovered) {
    const cached = decisionCacheSchema.parse(recovered.payload);
    if (cached.requestBinding !== requestBinding) {
      throw new ProbeServiceError("decision_replay_mismatch", 409);
    }
    return cached.response;
  }
  try {
    verifyProbeToken(body.probeToken, signingSecret, nowMs);
  } catch {
    throw new ProbeServiceError("expired_probe_authorization", 403);
  }
  if (
    activation.guard.phase !== "idle" ||
    activation.guard.calibrationCalls !== PROBE_CALIBRATION_BASE_CALLS + ordinal
  ) {
    throw new ProbeServiceError("decision_recovery_missing", 409);
  }
  let grantSucceeded = false;
  let provider: ProbeProviderKnownReceipt;
  try {
    provider = await decideWithOpenAi({
      envelope: verified.envelope,
      apiKey: requiredEnvironment(environment, "OPENAI_API_KEY"),
      safetyIdentifier: session.actorHash,
      ...(dependencies.fetchImplementation
        ? { fetchImplementation: dependencies.fetchImplementation }
        : {}),
      ...(dependencies.now ? { now: dependencies.now } : {}),
      beforeDispatch: async () => {
        try {
          await beginProbeCall(redis, {
            ...activation.guardIdentity,
            jti: verified.claims.jti,
            claimsHash: verified.claimsHash,
            purpose: "calibration",
            runAdmission: runAdmission({ request, recovery, signingSecret, ordinal })
          });
          grantSucceeded = true;
        } catch (error) {
          throw new ProbeServiceError(
            error instanceof ProbeLedgerError ? error.code.toLowerCase() : "probe_grant_failed",
            409
          );
        }
      }
    });
  } catch (error) {
    if (
      grantSucceeded &&
      (!(error instanceof ProbeProviderError) || error.dispatch === "after_dispatch_uncertain")
    ) {
      const settlementDigest = await canonicalSha256({
        version: 1,
        jti: verified.claims.jti,
        code: error instanceof ProbeProviderError ? error.code : "post_grant_failure",
        disposition: "after_dispatch_uncertain"
      });
      try {
        await settleProbeCallUncertain(redis, {
          ...activation.guardIdentity,
          jti: verified.claims.jti,
          settlementDigest,
          reason: "provider_uncertain"
        });
      } catch {
        throw new ProbeServiceError("uncertain_settlement_failed", 503, true);
      }
      throw new ProbeServiceError("provider_uncertain", 503, true);
    }
    if (error instanceof ProbeServiceError) throw error;
    throw new ProbeServiceError("provider_unavailable", 503, false);
  }
  try {
    const receiptHash = await canonicalSha256(provider);
    const signedPayload = signedProviderArtifactSchema.parse({
      version: PROBE_PROVIDER_RECEIPT_VERSION,
      activationHash: activation.activationHash,
      sessionId: session.sessionId,
      jti: verified.claims.jti,
      claimsHash: verified.claimsHash,
      envelopeHash: verified.envelopeHash,
      receiptHash
    });
    const publicProviderReceipt = signedProviderReceiptSchema.parse({
      version: PROBE_PROVIDER_RECEIPT_VERSION,
      token: signProbeArtifact("provider_receipt", signedPayload, signingSecret),
      receipt: provider
    });
    const response = probeFreshDecisionResponseSchema.parse({
      context: {
        kind: "fresh-stateless",
        previousResponseId: null,
        providerRequestCount: 1
      },
      rawModelResponse: provider.rawResponseBytes,
      providerReceipt: publicProviderReceipt,
      decision: provider.decision
    });
    const cached = await putProbeContinuation(redis, {
      jti: verified.claims.jti,
      stage: "decision",
      payload: decisionCacheSchema.parse({ requestBinding, response }),
      artifactSecret: signingSecret,
      admission: {
        mode: "grant-owner",
        authorizationKey: probeAuthorizationKey(PRODUCTION_PROBE_KEYSPACE, verified.claims.jti),
        jti: verified.claims.jti,
        claimsHash: verified.claimsHash,
        guardInstanceId: activation.guardIdentity.guardInstanceId,
        policyHash: activation.guardIdentity.policyHash,
        scriptHash: activation.guardIdentity.scriptHash,
        activationHash: recovery.activationHash,
        buildCommit: recovery.buildCommit,
        ownerHash: deriveProbeDocumentHash(documentIdFromRequest(request), signingSecret),
        revision: ordinal
      }
    });
    return decisionCacheSchema.parse(cached.payload).response;
  } catch {
    const settlementDigest = await canonicalSha256({
      version: 1,
      jti: verified.claims.jti,
      code: "decision_recovery_store_failed",
      providerResponseHash: provider.rawResponseHash
    });
    try {
      await settleProbeCallUncertain(redis, {
        ...activation.guardIdentity,
        jti: verified.claims.jti,
        settlementDigest,
        reason: "recovery_store_failed"
      });
    } catch {
      throw new ProbeServiceError("uncertain_settlement_failed", 503, true);
    }
    throw new ProbeServiceError("decision_recovery_store_failed", 503, true);
  }
}

export async function decideFallbackProbeCalibrationTrial(
  request: Request,
  value: unknown,
  dependencies: ProbeServiceDependencies = {}
): Promise<FallbackProbeFreshDecisionResponse> {
  const environment = environmentOf(dependencies);
  const activation = await activationOf(dependencies);
  fallbackMigrationOf(activation);
  const nowMs = nowOf(dependencies);
  const session = authenticateSession({
    request,
    activation,
    environment,
    requireCsrf: true,
    nowMs
  });
  const recovery = authenticateRecovery({ request, activation, environment, nowMs, session });
  const signingSecret = requiredEnvironment(environment, "TOOLPROOF_SIGNING_SECRET");
  const activationSecret = requiredEnvironment(environment, "TOOLPROOF_PROBE_ACTIVATION_SECRET");
  const body = fallbackProbeDecideBodySchema.parse(value);
  const verified = await verifyFallbackEnvelopeAgainstClaims({
    envelope: body.envelope,
    token: body.probeToken,
    activation,
    session,
    signingSecret,
    nowMs,
    allowExpiredRecovery: true
  });
  const ordinal = ordinalForEnvelope(verified.envelope, session.runId, activationSecret);
  assertDerivedProbeJti({
    runId: session.runId,
    ordinal,
    activationSecret,
    jti: verified.claims.jti
  });
  await validateFrozenFallbackEnvelope(verified.envelope, ordinal, activation);
  const requestBinding = await canonicalSha256(body);
  const redis = redisOf(dependencies, environment);
  await assertDocumentOwner({ request, redis, recovery, signingSecret });
  const recovered = await getProbeContinuation<z.infer<typeof fallbackDecisionCacheSchema>>(redis, {
    jti: verified.claims.jti,
    stage: "decision",
    artifactSecret: signingSecret
  });
  if (recovered) {
    const cached = fallbackDecisionCacheSchema.parse(recovered.payload);
    if (cached.requestBinding !== requestBinding) {
      throw new ProbeServiceError("fallback_decision_replay_mismatch", 409);
    }
    return cached.response;
  }
  try {
    verifyProbeToken(body.probeToken, signingSecret, nowMs);
  } catch {
    throw new ProbeServiceError("expired_fallback_authorization", 403);
  }
  if (
    activation.guard.phase !== "idle" ||
    activation.guard.calibrationCalls !== FALLBACK_PROBE_CALIBRATION_BASE_CALLS + ordinal
  ) {
    throw new ProbeServiceError("fallback_decision_recovery_missing", 409);
  }
  let grantSucceeded = false;
  let provider: FallbackProviderKnownReceipt;
  try {
    provider = await decideWithFallbackOpenAi({
      envelope: verified.envelope,
      apiKey: requiredEnvironment(environment, "OPENAI_API_KEY"),
      safetyIdentifier: session.actorHash,
      ...(dependencies.fetchImplementation
        ? { fetchImplementation: dependencies.fetchImplementation }
        : {}),
      ...(dependencies.now ? { now: dependencies.now } : {}),
      beforeDispatch: async () => {
        try {
          await beginProbeCall(redis, {
            ...activation.guardIdentity,
            jti: verified.claims.jti,
            claimsHash: verified.claimsHash,
            purpose: "calibration",
            runAdmission: runAdmission({ request, recovery, signingSecret, ordinal })
          });
          grantSucceeded = true;
        } catch (error) {
          throw new ProbeServiceError(
            error instanceof ProbeLedgerError ? error.code.toLowerCase() : "fallback_grant_failed",
            409
          );
        }
      }
    });
  } catch (error) {
    if (
      grantSucceeded &&
      (!(error instanceof FallbackProviderError) || error.dispatch === "after_dispatch_uncertain")
    ) {
      const settlementDigest = await canonicalSha256({
        version: 1,
        lane: FALLBACK_PROBE_CALIBRATION_LANE,
        jti: verified.claims.jti,
        code: error instanceof FallbackProviderError ? error.code : "post_grant_failure",
        disposition: "after_dispatch_uncertain"
      });
      try {
        await settleProbeCallUncertain(redis, {
          ...activation.guardIdentity,
          jti: verified.claims.jti,
          settlementDigest,
          reason: "provider_uncertain"
        });
      } catch {
        throw new ProbeServiceError("uncertain_settlement_failed", 503, true);
      }
      throw new ProbeServiceError("fallback_provider_uncertain", 503, true);
    }
    if (error instanceof ProbeServiceError) throw error;
    throw new ProbeServiceError("fallback_provider_unavailable", 503, false);
  }
  try {
    const receiptHash = await canonicalSha256(provider);
    const signedPayload = signedProviderArtifactSchema.parse({
      version: PROBE_PROVIDER_RECEIPT_VERSION,
      activationHash: activation.activationHash,
      sessionId: session.sessionId,
      jti: verified.claims.jti,
      claimsHash: verified.claimsHash,
      envelopeHash: verified.envelopeHash,
      receiptHash
    });
    const publicProviderReceipt = signedProviderReceiptSchema.parse({
      version: PROBE_PROVIDER_RECEIPT_VERSION,
      token: signProbeArtifact("provider_receipt", signedPayload, signingSecret),
      receipt: provider
    });
    const response = fallbackProbeFreshDecisionResponseSchema.parse({
      context: {
        kind: "fresh-stateless",
        previousResponseId: null,
        providerRequestCount: 1
      },
      rawModelResponse: provider.rawResponseBytes,
      providerReceipt: publicProviderReceipt,
      decision: provider.decision
    });
    const cached = await putProbeContinuation(redis, {
      jti: verified.claims.jti,
      stage: "decision",
      payload: fallbackDecisionCacheSchema.parse({ requestBinding, response }),
      artifactSecret: signingSecret,
      admission: {
        mode: "grant-owner",
        authorizationKey: probeAuthorizationKey(PRODUCTION_PROBE_KEYSPACE, verified.claims.jti),
        jti: verified.claims.jti,
        claimsHash: verified.claimsHash,
        guardInstanceId: activation.guardIdentity.guardInstanceId,
        policyHash: activation.guardIdentity.policyHash,
        scriptHash: activation.guardIdentity.scriptHash,
        activationHash: recovery.activationHash,
        buildCommit: recovery.buildCommit,
        ownerHash: deriveProbeDocumentHash(documentIdFromRequest(request), signingSecret),
        revision: ordinal
      }
    });
    return fallbackDecisionCacheSchema.parse(cached.payload).response;
  } catch {
    const settlementDigest = await canonicalSha256({
      version: 1,
      lane: FALLBACK_PROBE_CALIBRATION_LANE,
      jti: verified.claims.jti,
      code: "fallback_decision_recovery_store_failed",
      providerResponseHash: provider.rawResponseHash
    });
    try {
      await settleProbeCallUncertain(redis, {
        ...activation.guardIdentity,
        jti: verified.claims.jti,
        settlementDigest,
        reason: "recovery_store_failed"
      });
    } catch {
      throw new ProbeServiceError("uncertain_settlement_failed", 503, true);
    }
    throw new ProbeServiceError("fallback_decision_recovery_store_failed", 503, true);
  }
}

export async function admitProbeNativeDispatch(
  request: Request,
  value: unknown,
  dependencies: ProbeServiceDependencies = {}
) {
  const environment = environmentOf(dependencies);
  const activation = await activationOf(dependencies);
  const nowMs = nowOf(dependencies);
  const session = authenticateSession({
    request,
    activation,
    environment,
    requireCsrf: true,
    nowMs
  });
  const recovery = authenticateRecovery({
    request,
    activation,
    environment,
    nowMs,
    session
  });
  const signingSecret = requiredEnvironment(environment, "TOOLPROOF_SIGNING_SECRET");
  const activationSecret = requiredEnvironment(environment, "TOOLPROOF_PROBE_ACTIVATION_SECRET");
  const body = probeNativeAdmissionBodySchema.parse(value);
  const verified = await verifyEnvelopeAgainstClaims({
    envelope: body.envelope,
    token: body.probeToken,
    activation,
    session,
    signingSecret,
    nowMs,
    allowExpiredRecovery: true
  });
  const ordinal = ordinalForEnvelope(verified.envelope, session.runId, activationSecret);
  assertDerivedProbeJti({
    runId: session.runId,
    ordinal,
    activationSecret,
    jti: verified.claims.jti
  });
  await validateFrozenEnvelope(verified.envelope, ordinal, activation);
  await validateCompletionBoundary(body.initialBoundary, activation.manifest.activeCommit);
  const redis = redisOf(dependencies, environment);
  await assertDocumentOwner({ request, redis, recovery, signingSecret });
  if (
    activation.guard.phase !== "single-inflight" ||
    activation.guard.calibrationCalls !== PROBE_CALIBRATION_BASE_CALLS + ordinal + 1
  ) {
    throw new ProbeServiceError("native_grant_mismatch", 409);
  }
  const completion = await getProbeContinuation(redis, {
    jti: verified.claims.jti,
    stage: "completion",
    artifactSecret: signingSecret
  });
  if (completion) throw new ProbeServiceError("trial_already_complete", 409);
  const decisionCache = await getProbeContinuation<z.infer<typeof decisionCacheSchema>>(redis, {
    jti: verified.claims.jti,
    stage: "decision",
    artifactSecret: signingSecret
  });
  if (!decisionCache) throw new ProbeServiceError("decision_receipt_missing", 409);
  const decisionPayload = decisionCacheSchema.parse(decisionCache.payload);
  const providerPublic = signedProviderReceiptSchema.parse(
    decisionPayload.response.providerReceipt
  );
  const providerReceipt = objectValue(providerPublic.receipt, "invalid_provider_receipt");
  const decision = objectValue(providerReceipt.decision, "native_decision_not_call");
  if (decision.kind !== "call") throw new ProbeServiceError("native_decision_not_call", 409);
  const payload = await createNativeAdmissionPayload({
    envelopeHash: verified.envelopeHash,
    claimsHash: verified.claimsHash,
    decision,
    initialBoundary: body.initialBoundary
  });
  const existing = await getProbeContinuation<typeof payload>(redis, {
    jti: verified.claims.jti,
    stage: "native",
    artifactSecret: signingSecret
  });
  let admittedPayload = payload;
  if (existing) {
    const existingPayload = objectValue(existing.payload, "invalid_native_admission");
    if (
      existingPayload.version !== payload.version ||
      existingPayload.envelopeHash !== payload.envelopeHash ||
      existingPayload.claimsHash !== payload.claimsHash ||
      existingPayload.decisionHash !== payload.decisionHash
    ) {
      throw new ProbeServiceError("native_admission_mismatch", 409);
    }
    admittedPayload = existing.payload as typeof payload;
  } else {
    try {
      verifyProbeToken(body.probeToken, signingSecret, nowMs);
    } catch {
      throw new ProbeServiceError("expired_native_authorization", 403);
    }
  }
  const stored = await putProbeContinuation(redis, {
    jti: verified.claims.jti,
    stage: "native",
    payload: admittedPayload,
    artifactSecret: signingSecret,
    admission: runOwnerContinuationAdmission({
      request,
      recovery,
      signingSecret,
      ordinal
    })
  });
  return probeNativeAdmissionResponseSchema.parse({
    status: stored.disposition === "new" ? "admitted" : "already-admitted",
    jti: verified.claims.jti,
    inferencePerformed: false
  });
}

export async function admitFallbackProbeNativeDispatch(
  request: Request,
  value: unknown,
  dependencies: ProbeServiceDependencies = {}
) {
  const environment = environmentOf(dependencies);
  const activation = await activationOf(dependencies);
  fallbackMigrationOf(activation);
  const nowMs = nowOf(dependencies);
  const session = authenticateSession({
    request,
    activation,
    environment,
    requireCsrf: true,
    nowMs
  });
  const recovery = authenticateRecovery({ request, activation, environment, nowMs, session });
  const signingSecret = requiredEnvironment(environment, "TOOLPROOF_SIGNING_SECRET");
  const activationSecret = requiredEnvironment(environment, "TOOLPROOF_PROBE_ACTIVATION_SECRET");
  const body = fallbackProbeNativeAdmissionBodySchema.parse(value);
  const verified = await verifyFallbackEnvelopeAgainstClaims({
    envelope: body.envelope,
    token: body.probeToken,
    activation,
    session,
    signingSecret,
    nowMs,
    allowExpiredRecovery: true
  });
  const ordinal = ordinalForEnvelope(verified.envelope, session.runId, activationSecret);
  assertDerivedProbeJti({
    runId: session.runId,
    ordinal,
    activationSecret,
    jti: verified.claims.jti
  });
  await validateFrozenFallbackEnvelope(verified.envelope, ordinal, activation);
  await validateCompletionBoundary(body.initialBoundary, activation.manifest.activeCommit);
  const redis = redisOf(dependencies, environment);
  await assertDocumentOwner({ request, redis, recovery, signingSecret });
  if (
    activation.guard.phase !== "single-inflight" ||
    activation.guard.calibrationCalls !== FALLBACK_PROBE_CALIBRATION_BASE_CALLS + ordinal + 1
  ) {
    throw new ProbeServiceError("fallback_native_grant_mismatch", 409);
  }
  const completion = await getProbeContinuation(redis, {
    jti: verified.claims.jti,
    stage: "completion",
    artifactSecret: signingSecret
  });
  if (completion) throw new ProbeServiceError("fallback_trial_already_complete", 409);
  const decisionCache = await getProbeContinuation<z.infer<typeof fallbackDecisionCacheSchema>>(
    redis,
    { jti: verified.claims.jti, stage: "decision", artifactSecret: signingSecret }
  );
  if (!decisionCache) throw new ProbeServiceError("fallback_decision_receipt_missing", 409);
  const decisionPayload = fallbackDecisionCacheSchema.parse(decisionCache.payload);
  const providerPublic = signedProviderReceiptSchema.parse(
    decisionPayload.response.providerReceipt
  );
  const providerReceipt = objectValue(providerPublic.receipt, "invalid_fallback_provider_receipt");
  const decision = objectValue(providerReceipt.decision, "fallback_native_decision_not_call");
  if (decision.kind !== "call") {
    throw new ProbeServiceError("fallback_native_decision_not_call", 409);
  }
  const payload = await createNativeAdmissionPayload({
    envelopeHash: verified.envelopeHash,
    claimsHash: verified.claimsHash,
    decision,
    initialBoundary: body.initialBoundary
  });
  const existing = await getProbeContinuation<typeof payload>(redis, {
    jti: verified.claims.jti,
    stage: "native",
    artifactSecret: signingSecret
  });
  if (existing) {
    const existingPayload = objectValue(existing.payload, "invalid_fallback_native_admission");
    if (
      existingPayload.version !== payload.version ||
      existingPayload.envelopeHash !== payload.envelopeHash ||
      existingPayload.claimsHash !== payload.claimsHash ||
      existingPayload.decisionHash !== payload.decisionHash
    ) {
      throw new ProbeServiceError("fallback_native_admission_mismatch", 409);
    }
    throw new ProbeServiceError("fallback_native_allowance_already_consumed", 409);
  }
  try {
    verifyProbeToken(body.probeToken, signingSecret, nowMs);
  } catch {
    throw new ProbeServiceError("expired_fallback_native_authorization", 403);
  }
  const stored = await putProbeContinuation(redis, {
    jti: verified.claims.jti,
    stage: "native",
    payload,
    artifactSecret: signingSecret,
    admission: runOwnerContinuationAdmission({ request, recovery, signingSecret, ordinal })
  });
  if (stored.disposition !== "new") {
    throw new ProbeServiceError("fallback_native_allowance_already_consumed", 409);
  }
  return probeNativeAdmissionResponseSchema.parse({
    status: "admitted",
    jti: verified.claims.jti,
    inferencePerformed: false
  });
}

async function providerArtifact<TReceipt = ProbeProviderKnownReceipt>(input: {
  readonly value: unknown;
  readonly signingSecret: string;
  readonly activation: ProbeActivationContext;
  readonly session: ProbeSessionClaims;
  readonly jti: string;
  readonly claimsHash: string;
  readonly envelopeHash: string;
}): Promise<TReceipt> {
  const value = signedProviderReceiptSchema.parse(input.value);
  let artifact: z.infer<typeof signedProviderArtifactSchema>;
  try {
    artifact = signedProviderArtifactSchema.parse(
      verifyProbeArtifact("provider_receipt", value.token, input.signingSecret)
    );
  } catch {
    throw new ProbeServiceError("invalid_provider_receipt", 403);
  }
  if (
    artifact.activationHash !== input.activation.activationHash ||
    artifact.sessionId !== input.session.sessionId ||
    artifact.jti !== input.jti ||
    artifact.claimsHash !== input.claimsHash ||
    artifact.envelopeHash !== input.envelopeHash ||
    artifact.receiptHash !== (await canonicalSha256(value.receipt))
  ) {
    throw new ProbeServiceError("provider_receipt_mismatch", 403);
  }
  return value.receipt as unknown as TReceipt;
}

function objectValue(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProbeServiceError(code, 400);
  }
  return value as Record<string, unknown>;
}

async function verifyCanonicalEvidence(value: unknown): Promise<void> {
  const evidence = objectValue(value, "invalid_canonical_evidence");
  if (
    typeof evidence.bytes !== "string" ||
    typeof evidence.sha256 !== "string" ||
    canonicalJson(evidence.value) !== evidence.bytes ||
    (await sha256Hex(evidence.bytes)) !== evidence.sha256
  ) {
    throw new ProbeServiceError("canonical_evidence_mismatch", 409);
  }
}

interface VerifiedResetLineage {
  readonly verification: Record<string, unknown>;
  readonly domainReceipt: Record<string, unknown>;
  readonly resetTrace: OperationTrace;
  readonly domainArchive: Record<string, unknown>;
  readonly traceArchive: Record<string, unknown>;
}

async function validateBoundaryResetEvidence(
  boundary: ProbeBoundaryEvidence,
  expectedManifestHash: string,
  buildCommit: string
): Promise<VerifiedResetLineage> {
  const resetEvidence = probeResetEvidenceSchema.parse(boundary.resetReceipt);
  const verification = objectValue(resetEvidence.verification, "invalid_reset_verification");
  const domainReceipt = objectValue(resetEvidence.domainReceipt, "invalid_domain_reset_receipt");
  const inspection = objectValue(resetEvidence.inspection, "invalid_reset_inspection");
  const domainArchives = resetEvidence.domainArchives;
  const traceLedger = objectValue(resetEvidence.traceLedger, "invalid_reset_trace_ledger");
  const resetTrace = objectValue(
    traceLedger.lastResetTrace,
    "invalid_reset_trace"
  ) as unknown as OperationTrace;
  const domainArchive = objectValue(domainArchives.at(-1), "invalid_domain_archive");
  const traceArchives = Array.isArray(traceLedger.archives) ? traceLedger.archives : [];
  const traceArchive = objectValue(traceArchives.at(-1), "invalid_trace_archive");
  const domainCore = objectValue(domainReceipt.core, "invalid_reset_core");
  const domainEntries = Array.isArray(domainArchive.entries) ? domainArchive.entries : [];
  const archivedTraces = Array.isArray(traceArchive.traces) ? traceArchive.traces : [];
  const expectedResetBeforeHash =
    archivedTraces.length > 0
      ? objectValue(archivedTraces.at(-1), "invalid_archived_trace").stateAfter
        ? objectValue(
            objectValue(archivedTraces.at(-1), "invalid_archived_trace").stateAfter,
            "invalid_archived_state"
          ).sha256
        : null
      : CHECKOUT_FIXTURE_STATE_HASH;

  const recomputedVerification = await verifyCheckoutReset({
    domainReceipt: domainReceipt as unknown as Parameters<
      typeof verifyCheckoutReset
    >[0]["domainReceipt"],
    inspection: inspection as unknown as Parameters<typeof verifyCheckoutReset>[0]["inspection"],
    archives: domainArchives as unknown as Parameters<typeof verifyCheckoutReset>[0]["archives"],
    traceLedger: traceLedger as unknown as Parameters<typeof verifyCheckoutReset>[0]["traceLedger"],
    registry: {
      verified: true,
      registryHash: expectedManifestHash,
      registeredToolNames: boundary.registeredToolNames
    },
    checkedAt: String(verification.checkedAt ?? "")
  });

  await Promise.all([
    verifyCanonicalEvidence(resetTrace.rawArguments),
    ...(resetTrace.canonicalArguments
      ? [verifyCanonicalEvidence(resetTrace.canonicalArguments)]
      : []),
    ...(resetTrace.rawResult ? [verifyCanonicalEvidence(resetTrace.rawResult)] : []),
    ...(resetTrace.canonicalResult ? [verifyCanonicalEvidence(resetTrace.canonicalResult)] : []),
    ...(resetTrace.error ? [verifyCanonicalEvidence(resetTrace.error)] : []),
    verifyCanonicalEvidence(resetTrace.stateBefore),
    verifyCanonicalEvidence(resetTrace.stateAfter)
  ]);

  if (canonicalJson(recomputedVerification) !== canonicalJson(verification)) {
    throw new ProbeServiceError("reset_verification_recompute_mismatch", 409);
  }
  if (
    canonicalJson(resetTrace.rawResult?.value) !== canonicalJson(domainReceipt) ||
    canonicalJson(resetTrace.canonicalResult?.value) !== canonicalJson(domainReceipt)
  ) {
    throw new ProbeServiceError("reset_result_mismatch", 409);
  }
  if (
    domainReceipt.coreHash !== (await canonicalSha256(domainCore)) ||
    resetTrace.stateAfter.sha256 !== CHECKOUT_FIXTURE_STATE_HASH
  ) {
    throw new ProbeServiceError("reset_state_digest_mismatch", 409);
  }

  if (
    verification.status !== "verified" ||
    verification.resetId !== boundary.resetId ||
    verification.stateRevision !== 0 ||
    verification.stateHash !== CHECKOUT_FIXTURE_STATE_HASH ||
    verification.expectedStateHash !== CHECKOUT_FIXTURE_STATE_HASH ||
    verification.registryHash !== expectedManifestHash ||
    verification.operationLedgerCount !== 0 ||
    verification.currentTrajectoryCount !== 0 ||
    !Array.isArray(verification.registeredToolNames) ||
    !namesMatchInitial(verification.registeredToolNames as string[]) ||
    domainReceipt.resetId !== boundary.resetId ||
    domainReceipt.resetEventId !== resetTrace.eventId ||
    domainReceipt.sessionId !== resetTrace.sessionId ||
    domainReceipt.trajectoryId !== resetTrace.runId ||
    domainReceipt.archivedTrajectoryId !== domainArchive.trajectoryId ||
    domainReceipt.archivedEventCount !== domainArchive.eventCount ||
    domainReceipt.archivedEventCount !== archivedTraces.length ||
    domainArchive.archivedByResetId !== boundary.resetId ||
    traceArchive.archivedByResetId !== boundary.resetId ||
    traceArchive.trajectoryId !== domainArchive.trajectoryId ||
    domainEntries.length !== archivedTraces.length ||
    domainEntries.some(
      (entry, index) =>
        objectValue(entry, "invalid_domain_archive_entry").eventId !==
        objectValue(archivedTraces[index], "invalid_trace_archive_entry").eventId
    ) ||
    domainCore.stateRevision !== 0 ||
    domainCore.stateHash !== CHECKOUT_FIXTURE_STATE_HASH ||
    domainCore.currentOperationCount !== 0 ||
    resetTrace.traceVersion !== OPERATION_TRACE_VERSION ||
    resetTrace.toolName !== "fixture_reset" ||
    resetTrace.handlerVersion !== FIXTURE_RESET_HANDLER_VERSION ||
    resetTrace.domainVersion !== CHECKOUT_DOMAIN_VERSION ||
    resetTrace.toolsetVersion !== CHECKOUT_TOOLSET_VERSION ||
    resetTrace.appCommit !== buildCommit ||
    resetTrace.status !== "completed" ||
    resetTrace.commitDisposition !== "committed" ||
    resetTrace.runtime.executionPath !== "ui" ||
    resetTrace.runtime.argumentMode !== "not-applicable" ||
    resetTrace.stateBefore.sha256 !== expectedResetBeforeHash ||
    canonicalJson(resetTrace.rawArguments.value) !== canonicalJson({}) ||
    canonicalJson(resetTrace.canonicalArguments?.value) !== canonicalJson({}) ||
    resetTrace.error?.value !== null
  ) {
    throw new ProbeServiceError("reset_lineage_mismatch", 409);
  }
  return { verification, domainReceipt, resetTrace, domainArchive, traceArchive };
}

async function extractCalibrationObservation(
  body: ProbeCompleteBody,
  provider: ProbeProviderKnownReceipt,
  activation: ProbeActivationContext,
  envelope: ProbeCalibrationEnvelope,
  requestUserAgent: string
): Promise<{ readonly observation: ProbeCalibrationObservation; readonly evidence: unknown }> {
  const evidence = objectValue(body.completion.evidence, "invalid_trial_evidence");
  if (evidence.version !== "toolproof-probe-trial-evidence@1.0.0") {
    throw new ProbeServiceError("invalid_trial_evidence", 400);
  }
  const capture = objectValue(evidence.capture, "invalid_trial_capture");
  const expectedDecisionEnvelope = probeFreshDecisionResponseSchema.parse({
    context: {
      kind: "fresh-stateless",
      previousResponseId: null,
      providerRequestCount: 1
    },
    rawModelResponse: provider.rawResponseBytes,
    providerReceipt: body.providerReceipt,
    decision: provider.decision
  });
  if (
    evidence.appCommit !== activation.manifest.activeCommit ||
    evidence.origin !== activation.manifest.origin ||
    typeof evidence.userAgent !== "string" ||
    evidence.userAgent.trim().length === 0 ||
    evidence.userAgent !== requestUserAgent ||
    evidence.captureDigest !== (await canonicalSha256(capture)) ||
    canonicalJson(capture.claim) !== canonicalJson(body.completion.claim) ||
    capture.terminalStatus !== body.completion.terminalStatus ||
    capture.nativeDispatchCount !== body.completion.nativeDispatchCount ||
    capture.providerReceiptHash !== (await canonicalSha256(body.providerReceipt)) ||
    capture.rawModelResponseHash !== (await sha256Hex(provider.rawResponseBytes)) ||
    capture.rawDecisionEnvelopeHash !== (await canonicalSha256(expectedDecisionEnvelope)) ||
    canonicalJson(capture.decision) !== canonicalJson(provider.decision)
  ) {
    throw new ProbeServiceError("trial_capture_mismatch", 409);
  }
  if (provider.decision?.kind === "call" && body.completion.terminalStatus !== "boundary_drift") {
    if (
      capture.selectedToolName !== provider.decision.tool ||
      canonicalJson(capture.rawArguments) !== canonicalJson(provider.decision.arguments)
    ) {
      throw new ProbeServiceError("captured_arguments_mismatch", 409);
    }
  } else if (capture.selectedToolName !== null || capture.rawArguments !== null) {
    throw new ProbeServiceError("unexpected_captured_arguments", 409);
  }
  const initial = probeBoundaryEvidenceSchema.parse(capture.initialBoundary);
  const post = probeBoundaryEvidenceSchema.parse(body.completion.postResetBoundary);
  const [initialReset, postReset] = await Promise.all([
    validateCompletionBoundary(initial, activation.manifest.activeCommit),
    validateCompletionBoundary(post, activation.manifest.activeCommit)
  ]);
  if (
    initial.resetId === post.resetId ||
    postReset.domainReceipt.archivedTrajectoryId !== initialReset.domainReceipt.trajectoryId
  ) {
    throw new ProbeServiceError("reset_trajectory_mismatch", 409);
  }
  const errors = objectValue(capture.errors, "invalid_trial_errors");
  if (
    Object.keys(errors).sort().join("|") !==
    ["decision", "execution", "liveBoundary", "provider"].sort().join("|")
  ) {
    throw new ProbeServiceError("trial_error_shape_mismatch", 409);
  }
  const liveBoundary =
    capture.liveBoundary === null
      ? null
      : objectValue(capture.liveBoundary, "invalid_live_boundary");
  if (liveBoundary === null) {
    if (
      capture.terminalStatus !== "boundary_drift" ||
      errors.liveBoundary === null ||
      body.completion.nativeDispatchCount !== 0
    ) {
      throw new ProbeServiceError("live_boundary_missing", 409);
    }
  } else if (
    liveBoundary.stateHash !== initial.stateHash ||
    liveBoundary.manifestHash !== initial.manifestHash ||
    liveBoundary.registrationGeneration !== initial.registrationGeneration ||
    liveBoundary.operationLedgerCount !== 0 ||
    liveBoundary.currentTrajectoryCount !== 0 ||
    canonicalJson(liveBoundary.registeredToolNames) !== canonicalJson(initial.registeredToolNames)
  ) {
    throw new ProbeServiceError("live_boundary_mismatch", 409);
  }
  const timings = objectValue(capture.timings, "invalid_trial_timings");
  const timingKeys = [
    "startedAtMs",
    "initialBoundaryVerifiedAtMs",
    "claimIssuedAtMs",
    "decisionCompletedAtMs",
    "liveReverifiedAtMs",
    "nativeCompletedAtMs",
    "captureStartedAtMs"
  ];
  if (
    capture.runnerVersion !== PROBE_CLIENT_RUNNER_VERSION ||
    capture.decisionRequestCount !== 1 ||
    Object.keys(timings).sort().join("|") !== [...timingKeys].sort().join("|") ||
    timingKeys
      .filter((key) => key !== "nativeCompletedAtMs")
      .some((key) => !Number.isFinite(timings[key])) ||
    !(
      (timings.startedAtMs as number) <= (timings.initialBoundaryVerifiedAtMs as number) &&
      (timings.initialBoundaryVerifiedAtMs as number) <= (timings.claimIssuedAtMs as number) &&
      (timings.claimIssuedAtMs as number) <= (timings.decisionCompletedAtMs as number) &&
      (timings.decisionCompletedAtMs as number) <= (timings.liveReverifiedAtMs as number) &&
      (timings.liveReverifiedAtMs as number) <= (timings.captureStartedAtMs as number)
    ) ||
    (body.completion.nativeDispatchCount === 0 && timings.nativeCompletedAtMs !== null) ||
    (body.completion.nativeDispatchCount === 1 &&
      (!Number.isFinite(timings.nativeCompletedAtMs) ||
        (timings.nativeCompletedAtMs as number) < (timings.liveReverifiedAtMs as number) ||
        (timings.nativeCompletedAtMs as number) > (timings.captureStartedAtMs as number))) ||
    capture.nativeAllowanceConsumed !== (body.completion.nativeDispatchCount === 1)
  ) {
    throw new ProbeServiceError("trial_timing_mismatch", 409);
  }
  const executionResult =
    capture.executionResult === null
      ? null
      : objectValue(capture.executionResult, "invalid_execution_result");
  if (
    (capture.terminalStatus === "call_completed" &&
      (body.completion.nativeDispatchCount !== 1 ||
        executionResult === null ||
        errors.execution !== null)) ||
    (capture.terminalStatus === "call_failed" &&
      (body.completion.nativeDispatchCount !== 1 || errors.execution === null)) ||
    (capture.terminalStatus === "clarified" && provider.decision?.kind !== "clarify") ||
    (capture.terminalStatus === "abstained" && provider.decision?.kind !== "abstain") ||
    (capture.terminalStatus === "malformed_decision" && errors.decision === null) ||
    (capture.terminalStatus === "boundary_drift" && errors.liveBoundary === null)
  ) {
    throw new ProbeServiceError("terminal_status_mismatch", 409);
  }
  if (!Array.isArray(evidence.currentTraces) || evidence.currentTraces.length > 1) {
    throw new ProbeServiceError("trial_trace_count_mismatch", 409);
  }
  const currentTraceValue = evidence.currentTraces[0];
  let trace: OperationTrace | null = null;
  let nativeExecution: ProbeNativeExecutionObservation | null = null;
  const receipt = executionResult
    ? objectValue(executionResult.receipt, "invalid_native_receipt")
    : null;
  const rawTraceValue = executionResult?.trace ?? currentTraceValue ?? null;
  if (
    executionResult &&
    (currentTraceValue === undefined ||
      canonicalJson(executionResult.trace) !== canonicalJson(currentTraceValue))
  ) {
    throw new ProbeServiceError("execution_trace_mismatch", 409);
  }
  if (rawTraceValue !== null) {
    const rawTrace = objectValue(
      rawTraceValue,
      "invalid_handler_trace"
    ) as unknown as OperationTrace;
    await Promise.all([
      verifyCanonicalEvidence(rawTrace.rawArguments),
      ...(rawTrace.canonicalArguments
        ? [verifyCanonicalEvidence(rawTrace.canonicalArguments)]
        : []),
      ...(rawTrace.rawResult ? [verifyCanonicalEvidence(rawTrace.rawResult)] : []),
      ...(rawTrace.canonicalResult ? [verifyCanonicalEvidence(rawTrace.canonicalResult)] : []),
      ...(rawTrace.error ? [verifyCanonicalEvidence(rawTrace.error)] : []),
      verifyCanonicalEvidence(rawTrace.stateBefore),
      verifyCanonicalEvidence(rawTrace.stateAfter)
    ]);
    trace = rawTrace;
    const observedAtValid =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(rawTrace.observedAt) &&
      !Number.isNaN(Date.parse(rawTrace.observedAt)) &&
      new Date(rawTrace.observedAt).toISOString() === rawTrace.observedAt;
    if (
      rawTrace.traceVersion !== OPERATION_TRACE_VERSION ||
      !/^[A-Za-z0-9_-]{16,96}$/u.test(rawTrace.eventId) ||
      rawTrace.sessionId !== initialReset.resetTrace.sessionId ||
      rawTrace.runId !== initialReset.domainReceipt.trajectoryId ||
      rawTrace.parentEventId !== initialReset.resetTrace.eventId ||
      !Number.isSafeInteger(rawTrace.sequence) ||
      rawTrace.sequence <= initialReset.resetTrace.sequence ||
      !observedAtValid ||
      rawTrace.fixture.fixtureId !== "checkout-seed-v1" ||
      rawTrace.fixture.fixtureVersion !== "checkout-fixture@1.0.0" ||
      rawTrace.fixture.fixtureSeed !== "toolproof-checkout-seed-001" ||
      rawTrace.handlerVersion !== EXPECTED_HANDLER_VERSIONS[rawTrace.toolName] ||
      rawTrace.domainVersion !== CHECKOUT_DOMAIN_VERSION ||
      rawTrace.toolsetVersion !== CHECKOUT_TOOLSET_VERSION ||
      rawTrace.appCommit !== activation.manifest.activeCommit ||
      rawTrace.registryHash !== envelope.liveManifest.manifestHash ||
      rawTrace.runtime.executionPath !== "native-webmcp" ||
      rawTrace.runtime.origin !== activation.manifest.origin ||
      rawTrace.runtime.userAgent !== evidence.userAgent ||
      (rawTrace.runtime.argumentMode !== "object" &&
        rawTrace.runtime.argumentMode !== "json-string") ||
      rawTrace.operationId !==
        (provider.decision?.kind === "call" &&
        typeof provider.decision.arguments.operationId === "string"
          ? provider.decision.arguments.operationId
          : null) ||
      (provider.decision?.kind === "call" &&
        canonicalJson(rawTrace.rawArguments.value) !==
          canonicalJson(provider.decision.arguments)) ||
      (rawTrace.canonicalArguments !== null &&
        canonicalJson(rawTrace.rawArguments.value) !==
          canonicalJson(rawTrace.canonicalArguments.value)) ||
      (rawTrace.rawResult === null) !== (rawTrace.canonicalResult === null) ||
      (rawTrace.rawResult !== null &&
        canonicalJson(rawTrace.rawResult.value) !== canonicalJson(rawTrace.canonicalResult?.value))
    ) {
      throw new ProbeServiceError("native_provenance_mismatch", 409);
    }
    if (receipt) {
      let receiptRawResult: unknown;
      try {
        receiptRawResult = JSON.parse(String(receipt.rawResult ?? "")) as unknown;
      } catch {
        throw new ProbeServiceError("native_raw_result_mismatch", 409);
      }
      if (
        receipt.manifestHash !== envelope.liveManifest.manifestHash ||
        receipt.argumentMode !== rawTrace.runtime.argumentMode ||
        receipt.handlerTraceStatus !== rawTrace.status ||
        canonicalJson(receiptRawResult) !== canonicalJson(receipt.canonicalResult) ||
        canonicalJson(receipt.canonicalResult) !== canonicalJson(rawTrace.canonicalResult?.value)
      ) {
        throw new ProbeServiceError("native_receipt_mismatch", 409);
      }
      nativeExecution = {
        toolName: String(receipt.toolName ?? ""),
        nativeCallCount: Number(receipt.nativeCallCount ?? -1),
        handlerTraceId: typeof receipt.handlerTraceId === "string" ? receipt.handlerTraceId : null,
        resultDigest: typeof receipt.resultDigest === "string" ? receipt.resultDigest : null,
        effectDigest: typeof receipt.effectDigest === "string" ? receipt.effectDigest : null,
        stateBeforeDigest:
          typeof receipt.stateBeforeDigest === "string" ? receipt.stateBeforeDigest : null,
        stateAfterDigest:
          typeof receipt.stateAfterDigest === "string" ? receipt.stateAfterDigest : null
      };
    }
  }
  const postArchivedTraces = Array.isArray(postReset.traceArchive.traces)
    ? postReset.traceArchive.traces
    : [];
  if (
    postArchivedTraces.length !== (trace ? 1 : 0) ||
    (trace &&
      (trace.runId !== initialReset.domainReceipt.trajectoryId ||
        objectValue(postArchivedTraces[0], "invalid_post_reset_trace").eventId !== trace.eventId))
  ) {
    throw new ProbeServiceError("trial_trajectory_mismatch", 409);
  }
  return {
    observation: {
      decision: provider.decision,
      decisionError: provider.decisionError,
      nativeDispatchCount: body.completion.nativeDispatchCount,
      nativeExecution,
      trace,
      resetBefore: resetProjection(initial),
      resetAfter: resetProjection(post)
    },
    evidence
  };
}

async function extractFallbackCalibrationObservation(
  body: FallbackProbeCompleteBody,
  provider: FallbackProviderKnownReceipt,
  activation: ProbeActivationContext,
  envelope: FallbackCalibrationEnvelope,
  requestUserAgent: string
): Promise<{ readonly observation: ProbeCalibrationObservation; readonly evidence: unknown }> {
  const evidence = objectValue(body.completion.evidence, "invalid_fallback_trial_evidence");
  if (evidence.version !== "toolproof-fallback-trial-evidence@1.0.0") {
    throw new ProbeServiceError("invalid_fallback_trial_evidence", 400);
  }
  const capture = objectValue(evidence.capture, "invalid_fallback_trial_capture");
  const fallback = objectValue(evidence.fallback, "invalid_fallback_runtime_evidence");
  const catalog = objectValue(fallback.catalog, "invalid_fallback_catalog_receipt");
  const runtime = objectValue(fallback.runtime, "invalid_fallback_runtime_receipt");
  const nativeReceipt =
    fallback.nativeReceipt === null
      ? null
      : objectValue(fallback.nativeReceipt, "invalid_fallback_native_receipt");
  const capturedAt = typeof evidence.capturedAt === "string" ? evidence.capturedAt : "";
  const captureErrors = objectValue(capture.errors, "invalid_fallback_trial_errors");
  const captureExecutionError =
    captureErrors.execution === null
      ? null
      : objectValue(captureErrors.execution, "invalid_fallback_execution_error");
  const recoveredAfterAdmission =
    capture.terminalStatus === "call_failed" &&
    capture.executionResult === null &&
    (captureExecutionError?.code === "fallback_native_allowance_already_consumed" ||
      captureExecutionError?.code === "native_allowance_already_consumed" ||
      captureExecutionError?.code === "native_allowance_consumed");
  if (
    evidence.adapterVersion !== FALLBACK_LAB_PAGE_ADAPTER_VERSION ||
    evidence.appCommit !== activation.manifest.activeCommit ||
    evidence.origin !== activation.manifest.origin ||
    typeof evidence.userAgent !== "string" ||
    evidence.userAgent.trim().length === 0 ||
    evidence.userAgent !== requestUserAgent ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(capturedAt) ||
    Number.isNaN(Date.parse(capturedAt)) ||
    new Date(capturedAt).toISOString() !== capturedAt ||
    evidence.captureDigest !== (await canonicalSha256(capture)) ||
    catalog.version !== "toolproof-fallback-native-bridge@1.0.0" ||
    catalog.targetOrigin !== activation.manifest.origin ||
    catalog.pageUrl !== `${activation.manifest.origin}/lab` ||
    catalog.manifestHash !== envelope.liveManifest.manifestHash ||
    !Number.isSafeInteger(catalog.registrationGeneration) ||
    (catalog.registrationGeneration as number) < 1 ||
    catalog.catalogDigest !==
      (await canonicalSha256({
        manifest: envelope.liveManifest,
        targetOrigin: activation.manifest.origin,
        pageUrl: `${activation.manifest.origin}/lab`,
        registrationGeneration: catalog.registrationGeneration
      })) ||
    catalog.upstreamCommit !== FALLBACK_UPSTREAM_PIN.commit ||
    catalog.puppeteerCore !== FALLBACK_UPSTREAM_PIN.puppeteerCore ||
    runtime.version !== "toolproof-fallback-browser-runtime@1.0.0" ||
    typeof runtime.planHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(runtime.planHash) ||
    runtime.runtimeContractHash !== envelope.runner.browserRuntimeHash ||
    runtime.executableSha256 !== FALLBACK_UPSTREAM_PIN.chromeExecutableSha256 ||
    runtime.browserVersion !== `Chrome/${FALLBACK_UPSTREAM_PIN.chromeForTesting}` ||
    runtime.puppeteerCore !== FALLBACK_UPSTREAM_PIN.puppeteerCore ||
    runtime.chromeForTesting !== FALLBACK_UPSTREAM_PIN.chromeForTesting ||
    runtime.protocol !== FALLBACK_UPSTREAM_PIN.protocol ||
    runtime.targetOrigin !== activation.manifest.origin ||
    runtime.targetUrl !== `${activation.manifest.origin}/lab` ||
    runtime.isolatedProcess !== true ||
    runtime.foreignRequestObserved !== false ||
    runtime.unexpectedTargetObserved !== false ||
    runtime.additionalTargetCount !== 0
  ) {
    throw new ProbeServiceError("fallback_runtime_provenance_mismatch", 409);
  }
  const catalogNames = Array.isArray(catalog.toolNames) ? catalog.toolNames : [];
  if (
    !namesMatchInitial(catalogNames as string[]) ||
    catalog.registrationGeneration !==
      objectValue(capture.initialBoundary, "invalid_fallback_initial_boundary")
        .registrationGeneration
  ) {
    throw new ProbeServiceError("fallback_catalog_provenance_mismatch", 409);
  }
  if (!Array.isArray(evidence.currentTraces) || evidence.currentTraces.length > 1) {
    throw new ProbeServiceError("fallback_trial_trace_count_mismatch", 409);
  }
  const traceValue = evidence.currentTraces[0] ?? null;
  const providerDecision = provider.decision;
  const callReachedNativeBoundary =
    providerDecision?.kind === "call" && body.completion.terminalStatus !== "boundary_drift";
  if (callReachedNativeBoundary && !recoveredAfterAdmission) {
    if (!nativeReceipt || traceValue === null) {
      throw new ProbeServiceError("fallback_native_evidence_missing", 409);
    }
    const rawResult = objectValue(nativeReceipt.rawResult, "invalid_fallback_native_result");
    const nativeArguments = objectValue(
      nativeReceipt.arguments,
      "invalid_fallback_native_arguments"
    );
    const trace = objectValue(
      traceValue,
      "invalid_fallback_handler_trace"
    ) as unknown as OperationTrace;
    const invokedEvent = Array.isArray(nativeReceipt.invokedEvents)
      ? objectValue(nativeReceipt.invokedEvents[0], "invalid_fallback_invoked_event")
      : null;
    const respondedEvent = Array.isArray(nativeReceipt.respondedEvents)
      ? objectValue(nativeReceipt.respondedEvents[0], "invalid_fallback_responded_event")
      : null;
    const rawCall = objectValue(rawResult.call, "invalid_fallback_native_call");
    if (
      nativeReceipt.toolName !== providerDecision.tool ||
      nativeReceipt.manifestHash !== envelope.liveManifest.manifestHash ||
      nativeReceipt.registrationGeneration !== catalog.registrationGeneration ||
      nativeReceipt.allowanceConsumed !== true ||
      nativeReceipt.nativeCallCount !== 1 ||
      nativeReceipt.outcome !== "Completed" ||
      nativeReceipt.error !== null ||
      canonicalJson(nativeArguments.value) !== canonicalJson(providerDecision.arguments) ||
      nativeArguments.bytes !== canonicalJson(providerDecision.arguments) ||
      nativeArguments.sha256 !== (await sha256Hex(nativeArguments.bytes as string)) ||
      rawResult.status !== "Completed" ||
      rawResult.outputPresent !== true ||
      rawResult.errorText !== null ||
      rawResult.exception !== null ||
      canonicalJson(rawResult.output) !== canonicalJson(trace.canonicalResult?.value) ||
      !Array.isArray(nativeReceipt.invokedEvents) ||
      nativeReceipt.invokedEvents.length !== 1 ||
      !Array.isArray(nativeReceipt.respondedEvents) ||
      nativeReceipt.respondedEvents.length !== 1 ||
      !invokedEvent ||
      !respondedEvent ||
      invokedEvent.id !== rawResult.id ||
      invokedEvent.id !== rawCall.id ||
      invokedEvent.toolName !== providerDecision.tool ||
      rawCall.toolName !== providerDecision.tool ||
      canonicalJson(invokedEvent.input) !== canonicalJson(providerDecision.arguments) ||
      canonicalJson(rawCall.input) !== canonicalJson(providerDecision.arguments) ||
      canonicalJson(respondedEvent) !== canonicalJson(rawResult)
    ) {
      throw new ProbeServiceError("fallback_native_receipt_mismatch", 409);
    }
  } else if (nativeReceipt !== null || traceValue !== null) {
    throw new ProbeServiceError("unexpected_fallback_native_evidence", 409);
  }

  const compatibilityReceipt =
    nativeReceipt && traceValue
      ? await (async () => {
          const trace = objectValue(
            traceValue,
            "invalid_fallback_handler_trace"
          ) as unknown as OperationTrace;
          const rawResult = objectValue(nativeReceipt.rawResult, "invalid_fallback_native_result");
          return {
            toolName: nativeReceipt.toolName,
            manifestHash: nativeReceipt.manifestHash,
            argumentMode: trace.runtime.argumentMode,
            handlerTraceStatus: trace.status,
            rawResult: canonicalJson(rawResult.output),
            canonicalResult: rawResult.output,
            nativeCallCount: 1,
            handlerTraceId: trace.eventId,
            resultDigest: trace.canonicalResult?.sha256 ?? null,
            effectDigest: await canonicalSha256(trace.effect),
            stateBeforeDigest: trace.stateBefore.sha256,
            stateAfterDigest: trace.stateAfter.sha256
          };
        })()
      : null;
  const projectedCapture = {
    ...capture,
    executionResult:
      compatibilityReceipt && traceValue
        ? { receipt: compatibilityReceipt, trace: traceValue }
        : null
  };
  const projectedEvidence = {
    ...evidence,
    version: "toolproof-probe-trial-evidence@1.0.0",
    capture: projectedCapture,
    captureDigest: await canonicalSha256(projectedCapture)
  };
  const projectedBody = {
    ...body,
    envelope: envelope as unknown as ProbeCalibrationEnvelope,
    completion: { ...body.completion, evidence: projectedEvidence }
  } as unknown as ProbeCompleteBody;
  const extracted = await extractCalibrationObservation(
    projectedBody,
    provider as unknown as ProbeProviderKnownReceipt,
    activation,
    envelope as unknown as ProbeCalibrationEnvelope,
    requestUserAgent
  );
  const currentInspection = objectValue(
    evidence.currentInspection,
    "invalid_fallback_current_inspection"
  );
  const initialBoundary = objectValue(capture.initialBoundary, "invalid_fallback_initial_boundary");
  const initialResetReceipt = objectValue(
    initialBoundary.resetReceipt,
    "invalid_fallback_initial_reset_receipt"
  );
  const initialDomainReceipt = objectValue(
    initialResetReceipt.domainReceipt,
    "invalid_fallback_initial_domain_receipt"
  );
  const lastResetTrace = objectValue(
    currentInspection.lastResetTrace,
    "invalid_fallback_current_reset_trace"
  );
  const trace = extracted.observation.trace;
  const expectedCurrentState = trace?.stateAfter.value ?? createCheckoutFixture();
  const expectedOperationCount = trace?.operationId ? 1 : 0;
  if (
    canonicalJson(evidence.currentState) !== canonicalJson(expectedCurrentState) ||
    canonicalJson(currentInspection.state) !== canonicalJson(expectedCurrentState) ||
    currentInspection.currentOperationCount !== expectedOperationCount ||
    currentInspection.currentTraceCount !== (trace ? 1 : 0) ||
    currentInspection.haltedReason !== null ||
    currentInspection.sessionId !== (trace?.sessionId ?? initialDomainReceipt.sessionId) ||
    currentInspection.trajectoryId !== (trace?.runId ?? initialDomainReceipt.trajectoryId) ||
    lastResetTrace.eventId !== initialDomainReceipt.resetEventId
  ) {
    throw new ProbeServiceError("fallback_current_state_or_inspection_mismatch", 409);
  }
  return { observation: extracted.observation, evidence };
}

export async function completeProbeCalibrationTrial(
  request: Request,
  value: unknown,
  dependencies: ProbeServiceDependencies = {}
) {
  const environment = environmentOf(dependencies);
  const activation = await activationOf(dependencies);
  const nowMs = nowOf(dependencies);
  const session = authenticateSession({
    request,
    activation,
    environment,
    requireCsrf: true,
    nowMs
  });
  const recovery = authenticateRecovery({
    request,
    activation,
    environment,
    nowMs,
    session
  });
  const signingSecret = requiredEnvironment(environment, "TOOLPROOF_SIGNING_SECRET");
  const activationSecret = requiredEnvironment(environment, "TOOLPROOF_PROBE_ACTIVATION_SECRET");
  const body = probeCompleteBodySchema.parse(value);
  const verified = await verifyEnvelopeAgainstClaims({
    envelope: body.envelope,
    token: body.probeToken,
    activation,
    session,
    signingSecret,
    nowMs,
    allowExpiredRecovery: true
  });
  const ordinal = ordinalForEnvelope(verified.envelope, session.runId, activationSecret);
  assertDerivedProbeJti({
    runId: session.runId,
    ordinal,
    activationSecret,
    jti: verified.claims.jti
  });
  await validateFrozenEnvelope(verified.envelope, ordinal, activation);
  const continuation = await openProbeRunContinuation({
    token: body.continuation,
    signingSecret,
    session,
    recovery,
    activationHash: activation.activationHash,
    buildCommit: activation.manifest.activeCommit,
    nowMs
  });
  if (
    continuation.nextOrdinal !== ordinal ||
    canonicalJson(body.completion.claim) !==
      canonicalJson({
        runId: verified.envelope.runId,
        caseId: verified.envelope.caseId,
        trialId: verified.envelope.trialId
      })
  ) {
    throw new ProbeServiceError("completion_sequence_mismatch", 409);
  }
  const requestBinding = await canonicalSha256(body);
  const redis = redisOf(dependencies, environment);
  await assertDocumentOwner({ request, redis, recovery, signingSecret });
  const runIndex = await getProbeRunIndex(redis, {
    recovery,
    artifactSecret: signingSecret
  });
  if (
    !runIndex ||
    runIndex.nextOrdinal !== ordinal ||
    runIndex.payload.continuation !== body.continuation
  ) {
    throw new ProbeServiceError("probe_run_index_sequence_mismatch", 409);
  }
  const recovered = await getProbeContinuation<z.infer<typeof completionCacheSchema>>(redis, {
    jti: verified.claims.jti,
    stage: "completion",
    artifactSecret: signingSecret
  });
  if (recovered) {
    let cached = completionCacheSchema.parse(recovered.payload);
    if (cached.requestBinding !== requestBinding) {
      throw new ProbeServiceError("completion_replay_mismatch", 409);
    }
    const admitted = await putProbeContinuation(redis, {
      jti: verified.claims.jti,
      stage: "completion",
      payload: cached,
      artifactSecret: signingSecret,
      admission: runOwnerContinuationAdmission({
        request,
        recovery,
        signingSecret,
        ordinal
      })
    });
    cached = completionCacheSchema.parse(admitted.payload);
    try {
      await settleProbeCallKnown(redis, {
        ...activation.guardIdentity,
        jti: verified.claims.jti,
        ...cached.settlement
      });
    } catch {
      throw new ProbeServiceError("known_settlement_failed", 503, true);
    }
    await advanceProbeRunIndex(redis, {
      recovery,
      current: runIndex,
      continuation: cached.response.continuation,
      documentId: documentIdFromRequest(request),
      artifactSecret: signingSecret
    });
    return cached.response;
  }
  if (
    activation.guard.phase !== "single-inflight" ||
    activation.guard.calibrationCalls !== PROBE_CALIBRATION_BASE_CALLS + ordinal + 1
  ) {
    throw new ProbeServiceError("completion_grant_mismatch", 409);
  }
  const provider = await providerArtifact({
    value: body.providerReceipt,
    signingSecret,
    activation,
    session,
    jti: verified.claims.jti,
    claimsHash: verified.claimsHash,
    envelopeHash: verified.envelopeHash
  });
  const transport = await verifyProbeTransportBinding(verified.envelope);
  if (
    provider.promptHash !== verified.envelope.runner.promptHash ||
    provider.settingsHash !== verified.envelope.runner.settingsHash ||
    provider.decisionSchemaHash !== verified.envelope.runner.decisionSchemaHash ||
    provider.transportBindingHash !== transport.bindingHash
  ) {
    throw new ProbeServiceError("provider_contract_mismatch", 409);
  }
  const nativeAdmission = await getProbeContinuation<{
    readonly version: number;
    readonly envelopeHash: string;
    readonly claimsHash: string;
    readonly decisionHash: string;
    readonly initialBoundaryHash: string;
    readonly initialBoundary: unknown;
  }>(redis, {
    jti: verified.claims.jti,
    stage: "native",
    artifactSecret: signingSecret
  });
  const callReachedNativeBoundary =
    provider.decision?.kind === "call" && body.completion.terminalStatus !== "boundary_drift";
  if (callReachedNativeBoundary) {
    const completionEvidence = objectValue(body.completion.evidence, "invalid_trial_evidence");
    const completionCapture = objectValue(completionEvidence.capture, "invalid_trial_capture");
    const capturedInitialBoundary = probeBoundaryEvidenceSchema.parse(
      completionCapture.initialBoundary
    );
    const admissionPayload = nativeAdmission
      ? objectValue(nativeAdmission.payload, "invalid_native_admission")
      : null;
    const captureErrors = objectValue(completionCapture.errors, "invalid_trial_errors");
    const executionError =
      captureErrors.execution === null
        ? null
        : objectValue(captureErrors.execution, "invalid_execution_error");
    const recoveredAfterAdmission =
      completionCapture.executionResult === null &&
      executionError?.code === "native_allowance_already_consumed";
    const expectedAdmission = nativeAdmission
      ? await createNativeAdmissionPayload({
          envelopeHash: verified.envelopeHash,
          claimsHash: verified.claimsHash,
          decision: provider.decision,
          initialBoundary: admissionPayload?.initialBoundary
        })
      : null;
    if (
      body.completion.nativeDispatchCount !== 1 ||
      !nativeAdmission ||
      !expectedAdmission ||
      canonicalJson(nativeAdmission.payload) !== canonicalJson(expectedAdmission) ||
      (!recoveredAfterAdmission &&
        admissionPayload?.initialBoundaryHash !== (await canonicalSha256(capturedInitialBoundary)))
    ) {
      throw new ProbeServiceError("native_admission_missing", 409);
    }
  } else if (body.completion.nativeDispatchCount !== 0 || nativeAdmission) {
    throw new ProbeServiceError("unexpected_native_admission", 409);
  }
  const extracted = await extractCalibrationObservation(
    body,
    provider,
    activation,
    verified.envelope,
    request.headers.get("user-agent") ?? ""
  );
  const evaluation = await evaluateProbeCalibrationCase(ordinal, extracted.observation);
  const nativeAdmissionEvidence = nativeAdmission
    ? {
        status: "verified",
        jti: verified.claims.jti,
        payload: nativeAdmission.payload,
        payloadBinding: nativeAdmission.payloadBinding
      }
    : null;
  const trialEvidence = {
    ...objectValue(extracted.evidence, "invalid_trial_evidence"),
    postResetBoundary: body.completion.postResetBoundary,
    providerReceipt: body.providerReceipt,
    nativeAdmission: nativeAdmissionEvidence,
    envelope: verified.envelope,
    evidenceDigest: await canonicalSha256({
      evidence: extracted.evidence,
      postResetBoundary: body.completion.postResetBoundary,
      providerReceipt: body.providerReceipt,
      nativeAdmission: nativeAdmissionEvidence,
      envelopeHash: verified.envelopeHash
    })
  };
  const settlementDigest = await canonicalSha256({
    version: 1,
    jti: verified.claims.jti,
    providerResponseHash: provider.rawResponseHash,
    usageHash: provider.usageHash,
    trialEvidenceDigest: trialEvidence.evidenceDigest,
    evaluation
  });
  const settlement = {
    actualNanoUsd: provider.usage.accountedNanoUsd,
    providerResponseHash: provider.rawResponseHash,
    settlementDigest,
    usageHash: provider.usageHash
  };
  const row: ProbeCompletedCalibrationRow = {
    ordinal,
    jti: verified.claims.jti,
    trialEvidence: JSON.parse(canonicalJson(trialEvidence)) as z.infer<
      typeof probeCompletedCalibrationRowSchema
    >["trialEvidence"],
    evaluation: JSON.parse(canonicalJson(evaluation)) as z.infer<
      typeof probeCompletedCalibrationRowSchema
    >["evaluation"],
    settlement: JSON.parse(
      canonicalJson({
        accountedNanoUsd: settlement.actualNanoUsd,
        providerResponseHash: settlement.providerResponseHash,
        settlementDigest: settlement.settlementDigest,
        usageHash: settlement.usageHash,
        costBasis: provider.usage.costBasis,
        model: provider.model,
        provider: provider.provider,
        usage: provider.usage
      })
    ) as z.infer<typeof probeCompletedCalibrationRowSchema>["settlement"]
  };
  const advanced = await advanceProbeRunContinuation({
    current: continuation,
    row,
    signingSecret,
    ...(ordinal === PROBE_CALIBRATION_CASE_COUNT - 1
      ? { completedAt: new Date(nowMs).toISOString() }
      : {})
  });
  const response = completionResponseSchema.parse({
    version: PROBE_SERVICE_VERSION,
    protocolVersion: PROBE_CALIBRATION_PROTOCOL_VERSION,
    attempt: PROBE_CALIBRATION_ATTEMPT,
    status: "sealed",
    continuation: advanced.token,
    completedCount: advanced.continuation.nextOrdinal,
    terminal: advanced.continuation.nextOrdinal === PROBE_CALIBRATION_CASE_COUNT
  });
  const cached = await putProbeContinuation(redis, {
    jti: verified.claims.jti,
    stage: "completion",
    payload: completionCacheSchema.parse({ requestBinding, response, settlement }),
    artifactSecret: signingSecret,
    admission: runOwnerContinuationAdmission({
      request,
      recovery,
      signingSecret,
      ordinal
    })
  });
  const cachedPayload = completionCacheSchema.parse(cached.payload);
  try {
    await settleProbeCallKnown(redis, {
      ...activation.guardIdentity,
      jti: verified.claims.jti,
      ...cachedPayload.settlement
    });
  } catch {
    throw new ProbeServiceError("known_settlement_failed", 503, true);
  }
  await advanceProbeRunIndex(redis, {
    recovery,
    current: runIndex,
    continuation: cachedPayload.response.continuation,
    documentId: documentIdFromRequest(request),
    artifactSecret: signingSecret
  });
  return cachedPayload.response;
}

export async function completeFallbackProbeCalibrationTrial(
  request: Request,
  value: unknown,
  dependencies: ProbeServiceDependencies = {}
) {
  const environment = environmentOf(dependencies);
  const activation = await activationOf(dependencies);
  fallbackMigrationOf(activation);
  const nowMs = nowOf(dependencies);
  const session = authenticateSession({
    request,
    activation,
    environment,
    requireCsrf: true,
    nowMs
  });
  const recovery = authenticateRecovery({ request, activation, environment, nowMs, session });
  const signingSecret = requiredEnvironment(environment, "TOOLPROOF_SIGNING_SECRET");
  const activationSecret = requiredEnvironment(environment, "TOOLPROOF_PROBE_ACTIVATION_SECRET");
  const body = fallbackProbeCompleteBodySchema.parse(value);
  const verified = await verifyFallbackEnvelopeAgainstClaims({
    envelope: body.envelope,
    token: body.probeToken,
    activation,
    session,
    signingSecret,
    nowMs,
    allowExpiredRecovery: true
  });
  const ordinal = ordinalForEnvelope(verified.envelope, session.runId, activationSecret);
  assertDerivedProbeJti({
    runId: session.runId,
    ordinal,
    activationSecret,
    jti: verified.claims.jti
  });
  await validateFrozenFallbackEnvelope(verified.envelope, ordinal, activation);
  const continuation = await openProbeRunContinuation({
    token: body.continuation,
    signingSecret,
    session,
    recovery,
    activationHash: activation.activationHash,
    buildCommit: activation.manifest.activeCommit,
    nowMs
  });
  if (
    continuation.nextOrdinal !== ordinal ||
    canonicalJson(body.completion.claim) !==
      canonicalJson({
        runId: verified.envelope.runId,
        caseId: verified.envelope.caseId,
        trialId: verified.envelope.trialId
      })
  ) {
    throw new ProbeServiceError("fallback_completion_sequence_mismatch", 409);
  }
  const requestBinding = await canonicalSha256(body);
  const redis = redisOf(dependencies, environment);
  await assertDocumentOwner({ request, redis, recovery, signingSecret });
  const runIndex = await getProbeRunIndex(redis, { recovery, artifactSecret: signingSecret });
  if (
    !runIndex ||
    runIndex.nextOrdinal !== ordinal ||
    runIndex.payload.continuation !== body.continuation
  ) {
    throw new ProbeServiceError("fallback_run_index_sequence_mismatch", 409);
  }
  const recovered = await getProbeContinuation<z.infer<typeof fallbackCompletionCacheSchema>>(
    redis,
    { jti: verified.claims.jti, stage: "completion", artifactSecret: signingSecret }
  );
  if (recovered) {
    let cached = fallbackCompletionCacheSchema.parse(recovered.payload);
    if (cached.requestBinding !== requestBinding) {
      throw new ProbeServiceError("fallback_completion_replay_mismatch", 409);
    }
    const admitted = await putProbeContinuation(redis, {
      jti: verified.claims.jti,
      stage: "completion",
      payload: cached,
      artifactSecret: signingSecret,
      admission: runOwnerContinuationAdmission({ request, recovery, signingSecret, ordinal })
    });
    cached = fallbackCompletionCacheSchema.parse(admitted.payload);
    try {
      await settleProbeCallKnown(redis, {
        ...activation.guardIdentity,
        jti: verified.claims.jti,
        ...cached.settlement
      });
    } catch {
      throw new ProbeServiceError("known_settlement_failed", 503, true);
    }
    await advanceProbeRunIndex(redis, {
      recovery,
      current: runIndex,
      continuation: cached.response.continuation,
      documentId: documentIdFromRequest(request),
      artifactSecret: signingSecret
    });
    return cached.response;
  }
  if (
    activation.guard.phase !== "single-inflight" ||
    activation.guard.calibrationCalls !== FALLBACK_PROBE_CALIBRATION_BASE_CALLS + ordinal + 1
  ) {
    throw new ProbeServiceError("fallback_completion_grant_mismatch", 409);
  }
  const provider = await providerArtifact<FallbackProviderKnownReceipt>({
    value: body.providerReceipt,
    signingSecret,
    activation,
    session,
    jti: verified.claims.jti,
    claimsHash: verified.claimsHash,
    envelopeHash: verified.envelopeHash
  });
  const transport = await verifyFallbackTransportBinding(verified.envelope);
  if (
    provider.promptHash !== verified.envelope.runner.promptHash ||
    provider.settingsHash !== verified.envelope.runner.settingsHash ||
    provider.runnerContractHash !== activation.manifest.runnerContractHash ||
    provider.browserRuntimeHash !== verified.envelope.runner.browserRuntimeHash ||
    provider.toolDefinitionsHash !== verified.envelope.runner.toolDefinitionsHash ||
    provider.noCallSchemaHash !== verified.envelope.runner.noCallSchemaHash ||
    provider.transportBindingHash !== transport.bindingHash
  ) {
    throw new ProbeServiceError("fallback_provider_contract_mismatch", 409);
  }
  const nativeAdmission = await getProbeContinuation<{
    readonly version: number;
    readonly envelopeHash: string;
    readonly claimsHash: string;
    readonly decisionHash: string;
    readonly initialBoundaryHash: string;
    readonly initialBoundary: unknown;
  }>(redis, {
    jti: verified.claims.jti,
    stage: "native",
    artifactSecret: signingSecret
  });
  const callReachedNativeBoundary =
    provider.decision?.kind === "call" && body.completion.terminalStatus !== "boundary_drift";
  if (callReachedNativeBoundary) {
    const completionEvidence = objectValue(
      body.completion.evidence,
      "invalid_fallback_trial_evidence"
    );
    const completionCapture = objectValue(
      completionEvidence.capture,
      "invalid_fallback_trial_capture"
    );
    const capturedInitialBoundary = probeBoundaryEvidenceSchema.parse(
      completionCapture.initialBoundary
    );
    const admissionPayload = nativeAdmission
      ? objectValue(nativeAdmission.payload, "invalid_fallback_native_admission")
      : null;
    const captureErrors = objectValue(completionCapture.errors, "invalid_fallback_trial_errors");
    const executionError =
      captureErrors.execution === null
        ? null
        : objectValue(captureErrors.execution, "invalid_fallback_execution_error");
    const recoveredAfterAdmission =
      completionCapture.executionResult === null &&
      (executionError?.code === "fallback_native_allowance_already_consumed" ||
        executionError?.code === "native_allowance_already_consumed" ||
        executionError?.code === "native_allowance_consumed");
    const expectedAdmission = nativeAdmission
      ? await createNativeAdmissionPayload({
          envelopeHash: verified.envelopeHash,
          claimsHash: verified.claimsHash,
          decision: provider.decision,
          initialBoundary: admissionPayload?.initialBoundary
        })
      : null;
    if (
      body.completion.nativeDispatchCount !== 1 ||
      !nativeAdmission ||
      !expectedAdmission ||
      canonicalJson(nativeAdmission.payload) !== canonicalJson(expectedAdmission) ||
      (!recoveredAfterAdmission &&
        admissionPayload?.initialBoundaryHash !== (await canonicalSha256(capturedInitialBoundary)))
    ) {
      throw new ProbeServiceError("fallback_native_admission_missing", 409);
    }
  } else if (body.completion.nativeDispatchCount !== 0 || nativeAdmission) {
    throw new ProbeServiceError("unexpected_fallback_native_admission", 409);
  }
  const extracted = await extractFallbackCalibrationObservation(
    body,
    provider,
    activation,
    verified.envelope,
    request.headers.get("user-agent") ?? ""
  );
  const evaluation = await evaluateProbeCalibrationCase(ordinal, extracted.observation);
  const nativeAdmissionEvidence = nativeAdmission
    ? {
        status: "verified",
        jti: verified.claims.jti,
        payload: nativeAdmission.payload,
        payloadBinding: nativeAdmission.payloadBinding
      }
    : null;
  const trialEvidence = {
    ...objectValue(extracted.evidence, "invalid_fallback_trial_evidence"),
    postResetBoundary: body.completion.postResetBoundary,
    providerReceipt: body.providerReceipt,
    nativeAdmission: nativeAdmissionEvidence,
    envelope: verified.envelope,
    evidenceDigest: await canonicalSha256({
      lane: FALLBACK_PROBE_CALIBRATION_LANE,
      evidence: extracted.evidence,
      postResetBoundary: body.completion.postResetBoundary,
      providerReceipt: body.providerReceipt,
      nativeAdmission: nativeAdmissionEvidence,
      envelopeHash: verified.envelopeHash
    })
  };
  const settlementDigest = await canonicalSha256({
    version: 1,
    lane: FALLBACK_PROBE_CALIBRATION_LANE,
    jti: verified.claims.jti,
    providerResponseHash: provider.rawResponseHash,
    usageHash: provider.usageHash,
    trialEvidenceDigest: trialEvidence.evidenceDigest,
    evaluation
  });
  const settlement = {
    actualNanoUsd: provider.usage.accountedNanoUsd,
    providerResponseHash: provider.rawResponseHash,
    settlementDigest,
    usageHash: provider.usageHash
  };
  const row: ProbeCompletedCalibrationRow = {
    ordinal,
    jti: verified.claims.jti,
    trialEvidence: JSON.parse(canonicalJson(trialEvidence)) as z.infer<
      typeof probeCompletedCalibrationRowSchema
    >["trialEvidence"],
    evaluation: JSON.parse(canonicalJson(evaluation)) as z.infer<
      typeof probeCompletedCalibrationRowSchema
    >["evaluation"],
    settlement: JSON.parse(
      canonicalJson({
        accountedNanoUsd: settlement.actualNanoUsd,
        providerResponseHash: settlement.providerResponseHash,
        settlementDigest: settlement.settlementDigest,
        usageHash: settlement.usageHash,
        costBasis: provider.usage.costBasis,
        model: provider.model,
        provider: provider.provider,
        usage: provider.usage
      })
    ) as z.infer<typeof probeCompletedCalibrationRowSchema>["settlement"]
  };
  const advanced = await advanceProbeRunContinuation({
    current: continuation,
    row,
    signingSecret,
    ...(ordinal === FALLBACK_PROBE_CALIBRATION_CASE_COUNT - 1
      ? { completedAt: new Date(nowMs).toISOString() }
      : {})
  });
  const response = fallbackProbeCompleteResponseSchema.parse({
    version: FALLBACK_PROBE_SERVICE_VERSION,
    protocolVersion: FALLBACK_PROBE_CALIBRATION_PROTOCOL_VERSION,
    lane: FALLBACK_PROBE_CALIBRATION_LANE,
    status: "sealed",
    continuation: advanced.token,
    completedCount: advanced.continuation.nextOrdinal,
    terminal: advanced.continuation.nextOrdinal === FALLBACK_PROBE_CALIBRATION_CASE_COUNT
  });
  const cached = await putProbeContinuation(redis, {
    jti: verified.claims.jti,
    stage: "completion",
    payload: fallbackCompletionCacheSchema.parse({ requestBinding, response, settlement }),
    artifactSecret: signingSecret,
    admission: runOwnerContinuationAdmission({ request, recovery, signingSecret, ordinal })
  });
  const cachedPayload = fallbackCompletionCacheSchema.parse(cached.payload);
  try {
    await settleProbeCallKnown(redis, {
      ...activation.guardIdentity,
      jti: verified.claims.jti,
      ...cachedPayload.settlement
    });
  } catch {
    throw new ProbeServiceError("known_settlement_failed", 503, true);
  }
  await advanceProbeRunIndex(redis, {
    recovery,
    current: runIndex,
    continuation: cachedPayload.response.continuation,
    documentId: documentIdFromRequest(request),
    artifactSecret: signingSecret
  });
  return cachedPayload.response;
}

export async function revealProbeCalibrationRun(
  request: Request,
  continuationToken: string,
  dependencies: ProbeServiceDependencies = {}
) {
  const environment = environmentOf(dependencies);
  const activation = await activationOf(dependencies);
  const migration = migrationOf(activation);
  const nowMs = nowOf(dependencies);
  const session = authenticateSession({
    request,
    activation,
    environment,
    requireCsrf: true,
    nowMs
  });
  const recovery = authenticateRecovery({
    request,
    activation,
    environment,
    nowMs,
    session
  });
  if (
    activation.guard.phase !== "idle" ||
    activation.guard.claimedCalls !== PROBE_CALIBRATION_TERMINAL_CALLS ||
    activation.guard.calibrationCalls !== PROBE_CALIBRATION_TERMINAL_CALLS ||
    activation.guard.knownCalls !== PROBE_CALIBRATION_TERMINAL_CALLS ||
    activation.guard.pendingCalls !== 0 ||
    activation.guard.uncertainCalls !== 0 ||
    activation.guard.committedNanoUsd !==
      PROBE_CALIBRATION_TERMINAL_CALLS * PROBE_PER_CALL_RESERVATION_NANO_USD
  ) {
    throw new ProbeServiceError("calibration_not_complete", 409);
  }
  const signingSecret = requiredEnvironment(environment, "TOOLPROOF_SIGNING_SECRET");
  await assertDocumentOwner({
    request,
    redis: redisOf(dependencies, environment),
    recovery,
    signingSecret
  });
  const continuation = await openProbeRunContinuation({
    token: continuationToken,
    signingSecret,
    session,
    recovery,
    activationHash: activation.activationHash,
    buildCommit: activation.manifest.activeCommit,
    nowMs
  });
  if (
    continuation.nextOrdinal !== PROBE_CALIBRATION_CASE_COUNT ||
    continuation.rows.length !== PROBE_CALIBRATION_CASE_COUNT
  ) {
    throw new ProbeServiceError("calibration_not_complete", 409);
  }
  const attemptAccountedNanoUsd = continuation.rows.reduce((total, row) => {
    const settlement = objectValue(row.settlement, "invalid_settlement");
    return total + Number(settlement.accountedNanoUsd ?? Number.NaN);
  }, 0);
  if (
    !Number.isSafeInteger(attemptAccountedNanoUsd) ||
    attemptAccountedNanoUsd < 0 ||
    activation.guard.knownAccountedNanoUsd - migration.preserved.knownActualNanoUsd !==
      attemptAccountedNanoUsd
  ) {
    throw new ProbeServiceError("terminal_guard_cost_mismatch", 409);
  }
  const evidence = {
    version: GATE2_CALIBRATION_BUNDLE_VERSION,
    protocolVersion: PROBE_CALIBRATION_PROTOCOL_VERSION,
    attempt: PROBE_CALIBRATION_ATTEMPT,
    lane: GATE2_CALIBRATION_LANE,
    calibrationOnly: true,
    includedInBenchmark: false,
    attemptScope: {
      designation: "separate-versioned-third-final-preferred-attempt",
      baseCalibrationCalls: PROBE_CALIBRATION_BASE_CALLS,
      terminalCalibrationCalls: PROBE_CALIBRATION_TERMINAL_CALLS,
      caseCount: PROBE_CALIBRATION_ATTEMPT_CASE_COUNT,
      priorAttemptsMerged: false
    },
    priorAttempts: createGate2PriorAttemptsLineage(migration),
    policyMigration: migration,
    provider: "OpenAI",
    model: "gpt-5.6-terra",
    appCommit: activation.manifest.activeCommit,
    activationHash: activation.activationHash,
    policyHash: activation.manifest.policyHash,
    ledgerScriptHash: activation.manifest.scriptHash,
    runnerContractHash: activation.manifest.runnerContractHash,
    continuationScriptHash: activation.manifest.continuationScriptHash,
    runId: continuation.runId,
    completedAt: continuation.completedAt,
    cases: continuation.rows,
    caseCount: continuation.rows.length,
    terminalGuard: {
      phase: activation.guard.phase,
      claimedCalls: activation.guard.claimedCalls,
      knownCalls: activation.guard.knownCalls,
      pendingCalls: activation.guard.pendingCalls,
      uncertainCalls: activation.guard.uncertainCalls,
      calibrationCalls: activation.guard.calibrationCalls,
      committedNanoUsd: activation.guard.committedNanoUsd,
      knownAccountedNanoUsd: activation.guard.knownAccountedNanoUsd
    },
    attemptCost: {
      version: GATE2_ATTEMPT_COST_RECONCILIATION_VERSION,
      priorCumulativeKnownAccountedNanoUsd: migration.preserved.knownActualNanoUsd,
      attemptAccountedNanoUsd,
      terminalCumulativeKnownAccountedNanoUsd: activation.guard.knownAccountedNanoUsd
    },
    passedCount: continuation.rows.filter(
      ({ evaluation }) => objectValue(evaluation, "invalid_evaluation").passed === true
    ).length
  };
  const receipt = Object.freeze({
    ...evidence,
    evidenceDigest: await canonicalSha256(evidence)
  });
  await verifyGate2CalibrationBundleServer(receipt);
  return receipt;
}

export async function revealFallbackProbeCalibrationRun(
  request: Request,
  continuationToken: string,
  dependencies: ProbeServiceDependencies = {}
) {
  const environment = environmentOf(dependencies);
  const activation = await activationOf(dependencies);
  const migration = fallbackMigrationOf(activation);
  const nowMs = nowOf(dependencies);
  const session = authenticateSession({
    request,
    activation,
    environment,
    requireCsrf: true,
    nowMs
  });
  const recovery = authenticateRecovery({ request, activation, environment, nowMs, session });
  if (
    activation.guard.phase !== "idle" ||
    activation.guard.claimedCalls !== FALLBACK_PROBE_CALIBRATION_TERMINAL_CALLS ||
    activation.guard.calibrationCalls !== FALLBACK_PROBE_CALIBRATION_TERMINAL_CALLS ||
    activation.guard.knownCalls !== FALLBACK_PROBE_CALIBRATION_TERMINAL_CALLS ||
    activation.guard.pendingCalls !== 0 ||
    activation.guard.uncertainCalls !== 0 ||
    activation.guard.committedNanoUsd !==
      FALLBACK_PROBE_CALIBRATION_TERMINAL_CALLS * PROBE_PER_CALL_RESERVATION_NANO_USD
  ) {
    throw new ProbeServiceError("fallback_calibration_not_complete", 409);
  }
  const signingSecret = requiredEnvironment(environment, "TOOLPROOF_SIGNING_SECRET");
  await assertDocumentOwner({
    request,
    redis: redisOf(dependencies, environment),
    recovery,
    signingSecret
  });
  const continuation = await openProbeRunContinuation({
    token: continuationToken,
    signingSecret,
    session,
    recovery,
    activationHash: activation.activationHash,
    buildCommit: activation.manifest.activeCommit,
    nowMs
  });
  if (
    continuation.nextOrdinal !== FALLBACK_PROBE_CALIBRATION_CASE_COUNT ||
    continuation.rows.length !== FALLBACK_PROBE_CALIBRATION_CASE_COUNT
  ) {
    throw new ProbeServiceError("fallback_calibration_not_complete", 409);
  }
  const calibrationAccountedNanoUsd = continuation.rows.reduce((total, row) => {
    const settlement = objectValue(row.settlement, "invalid_fallback_settlement");
    return total + Number(settlement.accountedNanoUsd ?? Number.NaN);
  }, 0);
  if (
    !Number.isSafeInteger(calibrationAccountedNanoUsd) ||
    calibrationAccountedNanoUsd < 0 ||
    activation.guard.knownAccountedNanoUsd - migration.preserved.knownActualNanoUsd !==
      calibrationAccountedNanoUsd
  ) {
    throw new ProbeServiceError("fallback_terminal_guard_cost_mismatch", 409);
  }
  const evidence = {
    version: "toolproof-gate2-googlechromelabs-fallback-evidence@1.0.0",
    protocolVersion: FALLBACK_PROBE_CALIBRATION_PROTOCOL_VERSION,
    lane: FALLBACK_PROBE_CALIBRATION_LANE,
    calibrationOnly: true,
    includedInBenchmark: false,
    designation: "approved-pinned-fallback-not-fourth-preferred-attempt",
    callLineage: {
      preservedPreferredCalls: FALLBACK_PROBE_CALIBRATION_BASE_CALLS,
      fallbackCalibrationCalls: FALLBACK_PROBE_CALIBRATION_CASE_COUNT,
      terminalCalibrationCalls: FALLBACK_PROBE_CALIBRATION_TERMINAL_CALLS,
      priorEvidenceRawSha256: migration.priorEvidenceRawSha256,
      priorEvidenceDigest: migration.priorEvidenceDigest,
      priorMigrationReceiptHash: migration.predecessorMigrationReceiptHash
    },
    policyMigration: migration,
    provider: "OpenAI",
    model: "gpt-5.6-terra",
    appCommit: activation.manifest.activeCommit,
    activationHash: activation.activationHash,
    policyHash: activation.manifest.policyHash,
    ledgerScriptHash: activation.manifest.scriptHash,
    runnerContractHash: activation.manifest.runnerContractHash,
    continuationScriptHash: activation.manifest.continuationScriptHash,
    runId: continuation.runId,
    completedAt: continuation.completedAt,
    cases: continuation.rows,
    caseCount: continuation.rows.length,
    terminalGuard: {
      phase: activation.guard.phase,
      claimedCalls: activation.guard.claimedCalls,
      knownCalls: activation.guard.knownCalls,
      pendingCalls: activation.guard.pendingCalls,
      uncertainCalls: activation.guard.uncertainCalls,
      calibrationCalls: activation.guard.calibrationCalls,
      committedNanoUsd: activation.guard.committedNanoUsd,
      knownAccountedNanoUsd: activation.guard.knownAccountedNanoUsd,
      globalCallLimit: 160,
      lifetimeSpendCeilingNanoUsd: 10_000_000_000
    },
    calibrationCost: {
      priorCumulativeKnownAccountedNanoUsd: migration.preserved.knownActualNanoUsd,
      fallbackCalibrationAccountedNanoUsd: calibrationAccountedNanoUsd,
      terminalCumulativeKnownAccountedNanoUsd: activation.guard.knownAccountedNanoUsd
    },
    passedCount: continuation.rows.filter(
      ({ evaluation }) => objectValue(evaluation, "invalid_fallback_evaluation").passed === true
    ).length
  };
  const receipt = Object.freeze({ ...evidence, evidenceDigest: await canonicalSha256(evidence) });
  await verifyGate2FallbackCalibrationBundleServer(receipt);
  return receipt;
}

export async function acknowledgeProbeCalibrationRun(
  request: Request,
  continuationToken: string,
  dependencies: ProbeServiceDependencies = {}
): Promise<{ readonly disposition: "new" | "existing" }> {
  const environment = environmentOf(dependencies);
  const activation = await activationOf(dependencies);
  migrationOf(activation);
  const nowMs = nowOf(dependencies);
  const session = authenticateSession({
    request,
    activation,
    environment,
    requireCsrf: true,
    nowMs
  });
  const recovery = authenticateRecovery({
    request,
    activation,
    environment,
    nowMs,
    session
  });
  const signingSecret = requiredEnvironment(environment, "TOOLPROOF_SIGNING_SECRET");
  const redis = redisOf(dependencies, environment);
  let index: ProbeRunIndexReceipt | null = null;
  try {
    index = await getProbeRunIndex(redis, { recovery, artifactSecret: signingSecret });
  } catch {
    // An exact idempotent acknowledgement is validated against the permanent anchor below.
  }
  if (
    index &&
    (!index.payload.terminal ||
      index.nextOrdinal !== PROBE_CALIBRATION_ATTEMPT_CASE_COUNT ||
      index.payload.continuation !== continuationToken)
  ) {
    throw new ProbeServiceError("terminal_run_index_mismatch", 409);
  }
  const payloadBinding = terminalProbeRunIndexPayloadBinding({
    recovery,
    continuation: continuationToken,
    artifactSecret: signingSecret
  });
  const disposition = await acknowledgeProbeRunIndex(redis, {
    recovery,
    documentId: documentIdFromRequest(request),
    payloadBinding,
    artifactSecret: signingSecret,
    guard: {
      configKey: PRODUCTION_PROBE_KEYSPACE.config,
      totalsKey: PRODUCTION_PROBE_KEYSPACE.totals,
      purposeCountsKey: PRODUCTION_PROBE_KEYSPACE.purposeCounts,
      inflightKey: PRODUCTION_PROBE_KEYSPACE.inflight,
      guardInstanceId: activation.guardIdentity.guardInstanceId,
      policyHash: activation.guardIdentity.policyHash,
      scriptHash: activation.guardIdentity.scriptHash,
      initializedCommit: activation.guardIdentity.initializedCommit,
      terminalCalibrationCalls: PROBE_CALIBRATION_TERMINAL_CALLS
    }
  });
  return Object.freeze({ disposition });
}

export async function acknowledgeFallbackProbeCalibrationRun(
  request: Request,
  continuationToken: string,
  dependencies: ProbeServiceDependencies = {}
): Promise<{ readonly disposition: "new" | "existing" }> {
  const environment = environmentOf(dependencies);
  const activation = await activationOf(dependencies);
  fallbackMigrationOf(activation);
  const nowMs = nowOf(dependencies);
  const session = authenticateSession({
    request,
    activation,
    environment,
    requireCsrf: true,
    nowMs
  });
  const recovery = authenticateRecovery({ request, activation, environment, nowMs, session });
  const signingSecret = requiredEnvironment(environment, "TOOLPROOF_SIGNING_SECRET");
  const redis = redisOf(dependencies, environment);
  let index: ProbeRunIndexReceipt | null = null;
  try {
    index = await getProbeRunIndex(redis, { recovery, artifactSecret: signingSecret });
  } catch {
    // Exact idempotent acknowledgement remains validated by the permanent run anchor.
  }
  if (
    index &&
    (!index.payload.terminal ||
      index.nextOrdinal !== FALLBACK_PROBE_CALIBRATION_CASE_COUNT ||
      index.payload.continuation !== continuationToken)
  ) {
    throw new ProbeServiceError("fallback_terminal_run_index_mismatch", 409);
  }
  const payloadBinding = terminalProbeRunIndexPayloadBinding({
    recovery,
    continuation: continuationToken,
    artifactSecret: signingSecret
  });
  const disposition = await acknowledgeProbeRunIndex(redis, {
    recovery,
    documentId: documentIdFromRequest(request),
    payloadBinding,
    artifactSecret: signingSecret,
    guard: {
      configKey: PRODUCTION_PROBE_KEYSPACE.config,
      totalsKey: PRODUCTION_PROBE_KEYSPACE.totals,
      purposeCountsKey: PRODUCTION_PROBE_KEYSPACE.purposeCounts,
      inflightKey: PRODUCTION_PROBE_KEYSPACE.inflight,
      guardInstanceId: activation.guardIdentity.guardInstanceId,
      policyHash: activation.guardIdentity.policyHash,
      scriptHash: activation.guardIdentity.scriptHash,
      initializedCommit: activation.guardIdentity.initializedCommit,
      terminalCalibrationCalls: FALLBACK_PROBE_CALIBRATION_TERMINAL_CALLS
    }
  });
  return Object.freeze({ disposition });
}
