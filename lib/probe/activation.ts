import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { canonicalJson } from "@/lib/evidence/digest";
import { getProbeConfigurationStatus } from "@/lib/probe/config";
import { probeContinuationScriptHash } from "@/lib/probe/continuation-store";
import {
  createProbeRedis,
  probeLedgerScriptHash,
  readProbePolicyMigrationReceipt,
  readProbeGuardStatus,
  type ProbeGuardIdentity,
  type ProbeGuardStatus
} from "@/lib/probe/ledger";
import {
  PROBE_POLICY_MIGRATION_ID,
  PROBE_POLICY_MIGRATION_PRESERVED_STATE,
  PROBE_POLICY_MIGRATION_PRIOR_EVIDENCE_DIGEST,
  probePolicyMigrationReceiptHash,
  type ProbePolicyMigrationReceipt
} from "@/lib/probe/policy-migration-contract";
import {
  PROBE_CHALLENGE_CLOSES_AT,
  PROBE_GLOBAL_CALL_LIMIT,
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
  PROBE_MAX_CONCURRENCY,
  PROBE_MODEL,
  PROBE_PER_CALL_RESERVATION_NANO_USD,
  PROBE_POLICY_VERSION,
  PROBE_PRODUCTION_ORIGIN,
  PROBE_PURPOSE_CALL_LIMITS,
  probePolicyHash
} from "@/lib/probe/policy";
import { probeRunnerContractHash } from "@/lib/probe/runner-contract";
import { decodeProbeSigningSecret } from "@/lib/probe/signing-secret";

export const PROBE_ACTIVATION_VERSION = "toolproof-probe-activation@2.0.0";
export const PROBE_ACTIVATION_MODE = "calibration";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const VERCEL_PROJECT_PATTERN = /^prj_[A-Za-z0-9]{20,}$/u;
const OPAQUE_GUARD_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;

interface EnvironmentLike {
  readonly [key: string]: string | undefined;
}

export interface ProbeActivationFrozenHashes {
  readonly policyHash: string;
  readonly scriptHash: string;
  readonly runnerContractHash: string;
  readonly continuationScriptHash: string;
}

export interface ProbeActivationManifest {
  readonly version: typeof PROBE_ACTIVATION_VERSION;
  readonly mode: typeof PROBE_ACTIVATION_MODE;
  readonly origin: typeof PROBE_PRODUCTION_ORIGIN;
  readonly activeCommit: string;
  readonly vercelProjectId: string;
  readonly guardInstanceId: string;
  readonly guardInitializedCommit: string;
  readonly policyHash: string;
  readonly scriptHash: string;
  readonly runnerContractHash: string;
  readonly continuationScriptHash: string;
  readonly policyMigrationReceiptHash: string;
}

export type ProbeActivationGuardPhase = "idle" | "single-inflight";

export interface ProbeActivationGuardReceipt {
  readonly phase: ProbeActivationGuardPhase;
  readonly claimedCalls: number;
  readonly knownCalls: number;
  readonly pendingCalls: 0 | 1;
  readonly calibrationCalls: number;
  readonly committedNanoUsd: number;
  readonly knownAccountedNanoUsd: number;
  readonly uncertainCalls: 0;
}

export interface ProbeActivationContext {
  readonly enabled: true;
  readonly mode: typeof PROBE_ACTIVATION_MODE;
  readonly activationHash: string;
  readonly manifest: ProbeActivationManifest;
  readonly guard: ProbeActivationGuardReceipt;
  readonly guardIdentity: ProbeGuardIdentity;
  readonly migration: ProbePolicyMigrationReceipt;
}

export class ProbeActivationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProbeActivationError";
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function safeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function decodeActivationSecret(secret: string | undefined): Buffer {
  if (!secret || !/^[A-Za-z0-9_-]+$/u.test(secret)) {
    throw new ProbeActivationError("activation_secret_invalid");
  }
  const decoded = Buffer.from(secret, "base64url");
  if (decoded.byteLength !== 32 || decoded.toString("base64url") !== secret) {
    throw new ProbeActivationError("activation_secret_invalid");
  }
  return decoded;
}

function requireExactHash(value: string | undefined, expected: string): void {
  if (!value || !SHA256_PATTERN.test(value) || !safeEqual(value, expected)) {
    throw new ProbeActivationError("activation_frozen_hash_mismatch");
  }
}

function freezeManifest(manifest: ProbeActivationManifest): ProbeActivationManifest {
  return Object.freeze(manifest);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

export async function probeActivationFrozenHashes(): Promise<ProbeActivationFrozenHashes> {
  const [policyHash, scriptHash, runnerContractHash, continuationScriptHash] = await Promise.all([
    probePolicyHash(),
    probeLedgerScriptHash(),
    probeRunnerContractHash(),
    probeContinuationScriptHash()
  ]);
  return Object.freeze({ policyHash, scriptHash, runnerContractHash, continuationScriptHash });
}

export async function createProbeActivationManifest(
  environment: EnvironmentLike,
  suppliedHashes?: ProbeActivationFrozenHashes
): Promise<ProbeActivationManifest> {
  const hashes = suppliedHashes ?? (await probeActivationFrozenHashes());
  if (environment.TOOLPROOF_PROBE_ACTIVATION_MODE !== PROBE_ACTIVATION_MODE) {
    throw new ProbeActivationError("activation_disabled");
  }
  if (
    environment.VERCEL !== "1" ||
    environment.VERCEL_ENV !== "production" ||
    environment.NODE_ENV !== "production"
  ) {
    throw new ProbeActivationError("activation_environment_mismatch");
  }

  const expectedProjectId = environment.TOOLPROOF_EXPECTED_VERCEL_PROJECT_ID ?? "";
  if (
    !VERCEL_PROJECT_PATTERN.test(expectedProjectId) ||
    environment.VERCEL_PROJECT_ID !== expectedProjectId
  ) {
    throw new ProbeActivationError("activation_project_mismatch");
  }

  const activeCommit = environment.TOOLPROOF_PROBE_ACTIVE_COMMIT ?? "";
  if (
    !GIT_SHA_PATTERN.test(activeCommit) ||
    environment.VERCEL_GIT_COMMIT_SHA !== activeCommit ||
    environment.TOOLPROOF_COMMIT_SHA !== activeCommit
  ) {
    throw new ProbeActivationError("activation_commit_mismatch");
  }

  const guardInstanceId = environment.TOOLPROOF_GUARD_INSTANCE_ID ?? "";
  const guardInitializedCommit = environment.TOOLPROOF_GUARD_INITIALIZED_COMMIT ?? "";
  if (
    !OPAQUE_GUARD_PATTERN.test(guardInstanceId) ||
    !GIT_SHA_PATTERN.test(guardInitializedCommit)
  ) {
    throw new ProbeActivationError("activation_guard_identity_invalid");
  }

  requireExactHash(environment.TOOLPROOF_PROBE_ACTIVE_POLICY_HASH, hashes.policyHash);
  requireExactHash(environment.TOOLPROOF_PROBE_ACTIVE_SCRIPT_HASH, hashes.scriptHash);
  requireExactHash(environment.TOOLPROOF_PROBE_ACTIVE_RUNNER_HASH, hashes.runnerContractHash);
  requireExactHash(
    environment.TOOLPROOF_PROBE_ACTIVE_CONTINUATION_HASH,
    hashes.continuationScriptHash
  );
  const policyMigrationReceiptHash = environment.TOOLPROOF_PROBE_POLICY_MIGRATION_RECEIPT_HASH;
  if (!policyMigrationReceiptHash || !SHA256_PATTERN.test(policyMigrationReceiptHash)) {
    throw new ProbeActivationError("activation_migration_receipt_hash_invalid");
  }

  return freezeManifest({
    version: PROBE_ACTIVATION_VERSION,
    mode: PROBE_ACTIVATION_MODE,
    origin: PROBE_PRODUCTION_ORIGIN,
    activeCommit,
    vercelProjectId: expectedProjectId,
    guardInstanceId,
    guardInitializedCommit,
    policyHash: hashes.policyHash,
    scriptHash: hashes.scriptHash,
    runnerContractHash: hashes.runnerContractHash,
    continuationScriptHash: hashes.continuationScriptHash,
    policyMigrationReceiptHash
  });
}

export function computeProbeActivationHash(
  manifest: ProbeActivationManifest,
  activationSecret: string
): string {
  return createHmac("sha256", decodeActivationSecret(activationSecret))
    .update(`toolproof.probe.activation.v1.${canonicalJson(manifest)}`)
    .digest("hex");
}

export function validateProbeActivationGuard(
  guard: ProbeGuardStatus,
  expected: ProbeGuardIdentity,
  nowMs: number = Date.now()
): ProbeActivationGuardReceipt {
  const numericValues = [
    guard.claimedCalls,
    guard.committedNanoUsd,
    guard.pendingCount,
    guard.knownCount,
    guard.uncertainCount,
    guard.knownActualNanoUsd,
    guard.uncertainUpperNanoUsd,
    guard.globalCallLimit,
    guard.spendCeilingNanoUsd,
    guard.perCallReservationNanoUsd,
    guard.maxConcurrency,
    guard.challengeClosesAtMs,
    guard.inflightCount,
    guard.sequence,
    ...Object.values(guard.purposeLimits),
    ...Object.values(guard.purposeCounts)
  ];
  const purposeCountSum = Object.values(guard.purposeCounts).reduce((sum, count) => sum + count, 0);
  const nonCalibrationCount =
    guard.purposeCounts.baseline +
    guard.purposeCounts.repair +
    guard.purposeCounts.revised +
    guard.purposeCounts.judge;

  const valid =
    numericValues.every(safeInteger) &&
    guard.status === "open" &&
    guard.guardInstanceId === expected.guardInstanceId &&
    guard.policyHash === expected.policyHash &&
    guard.scriptHash === expected.scriptHash &&
    guard.initializedCommit === expected.initializedCommit &&
    guard.policyVersion === PROBE_POLICY_VERSION &&
    guard.model === PROBE_MODEL &&
    guard.globalCallLimit === PROBE_GLOBAL_CALL_LIMIT &&
    guard.spendCeilingNanoUsd === PROBE_LIFETIME_SPEND_CEILING_NANO_USD &&
    guard.perCallReservationNanoUsd === PROBE_PER_CALL_RESERVATION_NANO_USD &&
    guard.maxConcurrency === PROBE_MAX_CONCURRENCY &&
    guard.challengeClosesAtMs === Date.parse(PROBE_CHALLENGE_CLOSES_AT) &&
    nowMs < guard.challengeClosesAtMs &&
    Object.entries(PROBE_PURPOSE_CALL_LIMITS).every(
      ([purpose, limit]) =>
        guard.purposeLimits[purpose as keyof typeof PROBE_PURPOSE_CALL_LIMITS] === limit
    ) &&
    guard.pendingCount <= 1 &&
    guard.uncertainCount === 0 &&
    guard.uncertainUpperNanoUsd === 0 &&
    guard.inflightCount === guard.pendingCount &&
    guard.claimedCalls === guard.knownCount + guard.pendingCount &&
    guard.claimedCalls === purposeCountSum &&
    guard.purposeCounts.calibration === guard.claimedCalls &&
    nonCalibrationCount === 0 &&
    guard.claimedCalls <= PROBE_PURPOSE_CALL_LIMITS.calibration &&
    guard.committedNanoUsd === guard.claimedCalls * PROBE_PER_CALL_RESERVATION_NANO_USD &&
    guard.committedNanoUsd <= PROBE_LIFETIME_SPEND_CEILING_NANO_USD &&
    guard.knownActualNanoUsd <= guard.knownCount * PROBE_PER_CALL_RESERVATION_NANO_USD &&
    guard.sequence === guard.claimedCalls &&
    !guard.haltMarkerPresent &&
    !guard.uncertainMarkerPresent;

  if (!valid) throw new ProbeActivationError("activation_guard_invalid");

  return Object.freeze({
    phase: guard.pendingCount === 0 ? "idle" : "single-inflight",
    claimedCalls: guard.claimedCalls,
    knownCalls: guard.knownCount,
    pendingCalls: guard.pendingCount as 0 | 1,
    calibrationCalls: guard.purposeCounts.calibration,
    committedNanoUsd: guard.committedNanoUsd,
    knownAccountedNanoUsd: guard.knownActualNanoUsd,
    uncertainCalls: 0
  });
}

export async function requireProbeActivation(
  options: {
    readonly environment?: EnvironmentLike;
    readonly guard?: ProbeGuardStatus;
    readonly readGuard?: () => Promise<ProbeGuardStatus>;
    readonly migration?: ProbePolicyMigrationReceipt;
    readonly readMigration?: () => Promise<ProbePolicyMigrationReceipt>;
    readonly nowMs?: number;
  } = {}
): Promise<ProbeActivationContext> {
  const environment = options.environment ?? process.env;
  if (options.guard && options.readGuard) {
    throw new ProbeActivationError("activation_guard_source_ambiguous");
  }
  if (options.migration && options.readMigration) {
    throw new ProbeActivationError("activation_migration_source_ambiguous");
  }
  if (environment.TOOLPROOF_PROBE_ACTIVATION_MODE !== PROBE_ACTIVATION_MODE) {
    throw new ProbeActivationError("activation_disabled");
  }
  const hashes = await probeActivationFrozenHashes();
  const manifest = await createProbeActivationManifest(environment, hashes);
  if (!getProbeConfigurationStatus(environment).operationalControlsConfigured) {
    throw new ProbeActivationError("activation_controls_unavailable");
  }
  const activationSecret = environment.TOOLPROOF_PROBE_ACTIVATION_SECRET;
  const activationKey = decodeActivationSecret(activationSecret);
  let signingKey: Buffer;
  try {
    signingKey = decodeProbeSigningSecret(environment.TOOLPROOF_SIGNING_SECRET ?? "");
  } catch {
    throw new ProbeActivationError("activation_controls_unavailable");
  }
  if (timingSafeEqual(activationKey, signingKey)) {
    throw new ProbeActivationError("activation_secret_not_separate");
  }

  const activationHash = computeProbeActivationHash(manifest, activationSecret ?? "");
  const expectedActivationHash = environment.TOOLPROOF_PROBE_ACTIVATION_HASH ?? "";
  if (
    !SHA256_PATTERN.test(expectedActivationHash) ||
    !safeEqual(activationHash, expectedActivationHash)
  ) {
    throw new ProbeActivationError("activation_hash_mismatch");
  }

  const guardIdentity: ProbeGuardIdentity = Object.freeze({
    guardInstanceId: manifest.guardInstanceId,
    policyHash: manifest.policyHash,
    scriptHash: manifest.scriptHash,
    initializedCommit: manifest.guardInitializedCommit
  });
  const redis =
    (!options.guard && !options.readGuard) || (!options.migration && !options.readMigration)
      ? createProbeRedis(environment as NodeJS.ProcessEnv)
      : undefined;
  const guard =
    options.guard ??
    (options.readGuard ? await options.readGuard() : await readProbeGuardStatus(redis!));
  const guardReceipt = validateProbeActivationGuard(
    guard,
    guardIdentity,
    options.nowMs ?? Date.now()
  );
  let migration: ProbePolicyMigrationReceipt;
  try {
    migration =
      options.migration ??
      (options.readMigration
        ? await options.readMigration()
        : await readProbePolicyMigrationReceipt(redis!, {
            expectedReceiptHash: manifest.policyMigrationReceiptHash
          }));
    if (
      migration.receiptHash !== manifest.policyMigrationReceiptHash ||
      migration.receiptHash !== (await probePolicyMigrationReceiptHash(migration)) ||
      migration.migrationId !== PROBE_POLICY_MIGRATION_ID ||
      migration.migrationCommit !== manifest.activeCommit ||
      migration.priorEvidenceDigest !== PROBE_POLICY_MIGRATION_PRIOR_EVIDENCE_DIGEST ||
      migration.guardInstanceId !== manifest.guardInstanceId ||
      migration.initializedCommit !== manifest.guardInitializedCommit ||
      migration.nextPolicyVersion !== PROBE_POLICY_VERSION ||
      migration.nextPolicyHash !== manifest.policyHash ||
      migration.nextScriptHash !== manifest.scriptHash ||
      canonicalJson(migration.nextPurposeLimits) !== canonicalJson(PROBE_PURPOSE_CALL_LIMITS) ||
      canonicalJson(migration.preserved) !==
        canonicalJson(PROBE_POLICY_MIGRATION_PRESERVED_STATE) ||
      guard.claimedCalls < PROBE_POLICY_MIGRATION_PRESERVED_STATE.claimedCalls ||
      guard.knownCount < PROBE_POLICY_MIGRATION_PRESERVED_STATE.knownCalls ||
      guard.committedNanoUsd < PROBE_POLICY_MIGRATION_PRESERVED_STATE.committedNanoUsd ||
      guard.knownActualNanoUsd < PROBE_POLICY_MIGRATION_PRESERVED_STATE.knownActualNanoUsd ||
      guard.sequence < PROBE_POLICY_MIGRATION_PRESERVED_STATE.sequence ||
      guard.purposeCounts.calibration <
        PROBE_POLICY_MIGRATION_PRESERVED_STATE.purposeCounts.calibration
    ) {
      throw new ProbeActivationError("activation_migration_invalid");
    }
  } catch {
    throw new ProbeActivationError("activation_migration_invalid");
  }

  return Object.freeze({
    enabled: true as const,
    mode: PROBE_ACTIVATION_MODE,
    activationHash,
    manifest,
    guard: guardReceipt,
    guardIdentity,
    migration: deepFreeze(JSON.parse(canonicalJson(migration)) as ProbePolicyMigrationReceipt)
  });
}
