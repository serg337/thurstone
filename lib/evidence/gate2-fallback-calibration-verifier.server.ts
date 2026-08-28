import "server-only";

import { createCheckoutFixture } from "@/lib/domain/checkout";
import {
  GATE2_FALLBACK_CALIBRATION_BUNDLE_V1_VERSION,
  GATE2_FALLBACK_CALIBRATION_BUNDLE_V2_VERSION,
  GATE2_FALLBACK_CALIBRATION_LANE,
  GATE2_FALLBACK_CASE_COUNT,
  GATE2_FALLBACK_V1_BASE_CALLS,
  GATE2_FALLBACK_V1_FROZEN_IDENTITIES,
  GATE2_FALLBACK_V1_PROTOCOL_VERSION,
  GATE2_FALLBACK_V1_TERMINAL_CALLS,
  GATE2_FALLBACK_V2_BASE_CALLS,
  GATE2_FALLBACK_V2_FROZEN_SOURCE_IDENTITY,
  GATE2_FALLBACK_V2_PROTOCOL_VERSION,
  GATE2_FALLBACK_V2_TERMINAL_CALLS,
  fallbackV1CalibrationEnvelopeHash
} from "@/lib/evidence/gate2-fallback-calibration-contract";
import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import type { OperationTrace } from "@/lib/evidence/operation-trace";
import {
  FALLBACK_CALIBRATION_ENVELOPE_VERSION,
  fallbackCalibrationEnvelopeHash
} from "@/lib/fallback/calibration-envelope";
import {
  FALLBACK_IMPLEMENTATION,
  FALLBACK_TRIAL_EVIDENCE_VERSION,
  fallbackRunnerImplementationHash
} from "@/lib/fallback/implementation-contract";
import {
  FALLBACK_RUNNER_PROMPT_VERSION,
  FALLBACK_RUNNER_SETTINGS_VERSION,
  fallbackBrowserRuntimeContractHash,
  fallbackRunnerContractHash,
  fallbackRunnerPromptHash,
  fallbackRunnerSettingsHash
} from "@/lib/fallback/runner-contract";
import {
  evaluateProbeCalibrationCase,
  getProbeCalibrationCase,
  type ProbeNativeExecutionObservation,
  type ProbeResetBoundaryObservation
} from "@/lib/probe/calibration-catalog.server";
import type { ProbeDecision } from "@/lib/probe/decision";
import { probeContinuationScriptHash } from "@/lib/probe/continuation-store";
import { probeLedgerScriptHash } from "@/lib/probe/ledger";
import {
  PROBE_V04_MIGRATED_LEDGER_SCRIPT_HASH,
  PROBE_V04_MIGRATED_POLICY_HASH,
  PROBE_V04_MIGRATED_PURPOSE_CALL_LIMITS,
  PROBE_V04_MIGRATED_RUNNER_CONTRACT_HASH,
  PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
  PROBE_V04_POLICY_MIGRATION_ID,
  PROBE_V04_POLICY_MIGRATION_VERSION,
  PROBE_V04_PREDECESSOR_MIGRATION_RECEIPT_HASH,
  PROBE_V04_PRESERVED_KNOWN_CALLS_DIGEST,
  PROBE_V04_PRIOR_ATTEMPT3_EVIDENCE_DIGEST,
  PROBE_V04_PRIOR_ATTEMPT3_RAW_SHA256,
  probeV04PolicyMigrationReceiptHash
} from "@/lib/probe/policy-v04-migration-contract";
import { PROBE_V04_POLICY_MIGRATION_PROGRAM_HASH } from "@/lib/probe/policy-v04-migration.server";
import {
  PROBE_V05_AUTHORIZATION_INVENTORY,
  PROBE_V05_ACK_ANCHOR_FIXED,
  PROBE_V05_MIGRATED_LEDGER_SCRIPT_HASH,
  PROBE_V05_MIGRATED_POLICY_HASH,
  PROBE_V05_MIGRATED_POLICY_VERSION,
  PROBE_V05_MIGRATED_PURPOSE_CALL_LIMITS,
  PROBE_V05_MIGRATED_RUNNER_CONTRACT_HASH,
  PROBE_V05_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
  PROBE_V05_POLICY_MIGRATION_ID,
  PROBE_V05_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
  PROBE_V05_POLICY_MIGRATION_PRIOR_APP_COMMIT,
  PROBE_V05_POLICY_MIGRATION_VERSION,
  PROBE_V05_PREDECESSOR_MIGRATION_RECEIPT_HASH,
  PROBE_V05_PREDECESSOR_MIGRATION_ID,
  PROBE_V05_PRESERVED_KNOWN_CALLS_DIGEST,
  PROBE_V05_PRIOR_EVIDENCE_DIGEST,
  PROBE_V05_PRIOR_EVIDENCE_RAW_SHA256,
  PROBE_V05_PRIOR_REPRODUCER_EVIDENCE_DIGEST,
  PROBE_V05_PRIOR_REPRODUCER_RAW_SHA256,
  PROBE_V05_PREVIOUS_LEDGER_SCRIPT_HASH,
  PROBE_V05_PREVIOUS_POLICY_HASH,
  PROBE_V05_PREVIOUS_POLICY_VERSION,
  PROBE_V05_PREVIOUS_PURPOSE_CALL_LIMITS,
  PROBE_V05_PREVIOUS_RUNNER_CONTRACT_HASH,
  probeV05PolicyMigrationReceiptHash
} from "@/lib/probe/policy-v05-migration-contract";
import { PROBE_V05_POLICY_MIGRATION_PROGRAM_HASH } from "@/lib/probe/policy-v05-migration.server";
import {
  PROBE_GLOBAL_CALL_LIMIT,
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
  PROBE_PER_CALL_RESERVATION_NANO_USD,
  calculateProbeCostNanoUsd,
  probePolicyHash
} from "@/lib/probe/policy";
import { probeCompletedCalibrationRowSchema } from "@/lib/probe/run-continuation.server";
import { z } from "zod";

export const GATE2_FALLBACK_CALIBRATION_BUNDLE_VERSION =
  GATE2_FALLBACK_CALIBRATION_BUNDLE_V2_VERSION;

interface EvidenceContract {
  readonly generation: 1 | 2;
  readonly version: string;
  readonly protocolVersion: string;
  readonly baseCalls: number;
  readonly terminalCalls: number;
  readonly policyHash: string;
  readonly ledgerScriptHash: string;
  readonly runnerContractHash: string;
  readonly continuationScriptHash: string;
  readonly browserRuntimeHash: string;
  readonly promptHash: string;
  readonly settingsHash: string;
  readonly envelopeVersion: string;
  readonly trialEvidenceVersion: string;
  readonly implementation: string;
  readonly implementationHash: string | null;
  readonly promptVersion: string;
  readonly settingsVersion: string;
  readonly priorEvidenceRawSha256: string;
  readonly priorEvidenceDigest: string;
  readonly priorMigrationReceiptHash: string;
  readonly priorKnownActualNanoUsd: number;
}

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const nonNegativeInteger = z.number().int().nonnegative();

function bundleSchema(contract: EvidenceContract) {
  const callLineage =
    contract.generation === 1
      ? z
          .object({
            preservedPreferredCalls: z.literal(GATE2_FALLBACK_V1_BASE_CALLS),
            fallbackCalibrationCalls: z.literal(GATE2_FALLBACK_CASE_COUNT),
            terminalCalibrationCalls: z.literal(GATE2_FALLBACK_V1_TERMINAL_CALLS),
            priorEvidenceRawSha256: z.literal(contract.priorEvidenceRawSha256),
            priorEvidenceDigest: z.literal(contract.priorEvidenceDigest),
            priorMigrationReceiptHash: z.literal(contract.priorMigrationReceiptHash)
          })
          .strict()
      : z
          .object({
            preservedPreferredCalls: z.literal(GATE2_FALLBACK_V1_BASE_CALLS),
            preservedFallbackCalls: z.literal(GATE2_FALLBACK_CASE_COUNT),
            preservedCalibrationCalls: z.literal(GATE2_FALLBACK_V2_BASE_CALLS),
            fallbackCalibrationCalls: z.literal(GATE2_FALLBACK_CASE_COUNT),
            terminalCalibrationCalls: z.literal(GATE2_FALLBACK_V2_TERMINAL_CALLS),
            priorEvidenceRawSha256: z.literal(contract.priorEvidenceRawSha256),
            priorEvidenceDigest: z.literal(contract.priorEvidenceDigest),
            priorMigrationReceiptHash: z.literal(contract.priorMigrationReceiptHash)
          })
          .strict();
  return z
    .object({
      version: z.literal(contract.version),
      protocolVersion: z.literal(contract.protocolVersion),
      lane: z.literal(GATE2_FALLBACK_CALIBRATION_LANE),
      calibrationOnly: z.literal(true),
      includedInBenchmark: z.literal(false),
      designation: z.literal(
        contract.generation === 1
          ? "approved-pinned-fallback-not-fourth-preferred-attempt"
          : "approved-pinned-fallback-repair-attempt-2"
      ),
      callLineage,
      policyMigration: z.json(),
      provider: z.literal("OpenAI"),
      model: z.literal("gpt-5.6-terra"),
      appCommit: z.string().regex(/^[a-f0-9]{40}$/u),
      activationHash: sha256,
      policyHash: z.literal(contract.policyHash),
      ledgerScriptHash: z.literal(contract.ledgerScriptHash),
      runnerContractHash: z.literal(contract.runnerContractHash),
      continuationScriptHash: z.literal(contract.continuationScriptHash),
      runId: z.string().regex(/^run_[A-Za-z0-9_-]{22}$/u),
      completedAt: z.string(),
      cases: z.array(probeCompletedCalibrationRowSchema).length(GATE2_FALLBACK_CASE_COUNT),
      caseCount: z.literal(GATE2_FALLBACK_CASE_COUNT),
      terminalGuard: z
        .object({
          phase: z.literal("idle"),
          claimedCalls: z.literal(contract.terminalCalls),
          knownCalls: z.literal(contract.terminalCalls),
          pendingCalls: z.literal(0),
          uncertainCalls: z.literal(0),
          calibrationCalls: z.literal(contract.terminalCalls),
          committedNanoUsd: z.literal(contract.terminalCalls * PROBE_PER_CALL_RESERVATION_NANO_USD),
          knownAccountedNanoUsd: nonNegativeInteger,
          globalCallLimit: z.literal(PROBE_GLOBAL_CALL_LIMIT),
          lifetimeSpendCeilingNanoUsd: z.literal(PROBE_LIFETIME_SPEND_CEILING_NANO_USD)
        })
        .strict(),
      calibrationCost: z
        .object({
          priorCumulativeKnownAccountedNanoUsd: z.literal(contract.priorKnownActualNanoUsd),
          fallbackCalibrationAccountedNanoUsd: nonNegativeInteger,
          terminalCumulativeKnownAccountedNanoUsd: nonNegativeInteger
        })
        .strict(),
      passedCount: z.number().int().min(0).max(GATE2_FALLBACK_CASE_COUNT),
      evidenceDigest: sha256
    })
    .strict();
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function exactUtc(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function resetProjection(value: unknown): ProbeResetBoundaryObservation {
  const boundary = record(value, "fallback_bundle_reset_invalid");
  return {
    status: String(boundary.status ?? "invalid"),
    stateRevision: Number(boundary.stateRevision ?? -1),
    stateHash: String(boundary.stateHash ?? ""),
    operationLedgerCount: Number(boundary.operationLedgerCount ?? -1),
    currentTrajectoryCount: Number(boundary.currentTrajectoryCount ?? -1),
    registeredToolNames: Array.isArray(boundary.registeredToolNames)
      ? boundary.registeredToolNames.map(String)
      : []
  };
}

async function evidenceContract(value: unknown): Promise<EvidenceContract> {
  const version = record(value, "fallback_bundle_invalid").version;
  if (version === GATE2_FALLBACK_CALIBRATION_BUNDLE_V1_VERSION) {
    return {
      generation: 1,
      version,
      protocolVersion: GATE2_FALLBACK_V1_PROTOCOL_VERSION,
      baseCalls: GATE2_FALLBACK_V1_BASE_CALLS,
      terminalCalls: GATE2_FALLBACK_V1_TERMINAL_CALLS,
      policyHash: GATE2_FALLBACK_V1_FROZEN_IDENTITIES.policyHash,
      ledgerScriptHash: GATE2_FALLBACK_V1_FROZEN_IDENTITIES.ledgerScriptHash,
      runnerContractHash: GATE2_FALLBACK_V1_FROZEN_IDENTITIES.runnerContractHash,
      continuationScriptHash: GATE2_FALLBACK_V1_FROZEN_IDENTITIES.continuationScriptHash,
      browserRuntimeHash: GATE2_FALLBACK_V1_FROZEN_IDENTITIES.browserRuntimeHash,
      promptHash: GATE2_FALLBACK_V1_FROZEN_IDENTITIES.promptHash,
      settingsHash: GATE2_FALLBACK_V1_FROZEN_IDENTITIES.settingsHash,
      envelopeVersion: GATE2_FALLBACK_V1_FROZEN_IDENTITIES.envelopeVersion,
      trialEvidenceVersion: GATE2_FALLBACK_V1_FROZEN_IDENTITIES.trialEvidenceVersion,
      implementation: GATE2_FALLBACK_V1_FROZEN_IDENTITIES.implementation,
      implementationHash: null,
      promptVersion: GATE2_FALLBACK_V1_FROZEN_IDENTITIES.promptVersion,
      settingsVersion: GATE2_FALLBACK_V1_FROZEN_IDENTITIES.settingsVersion,
      priorEvidenceRawSha256: PROBE_V04_PRIOR_ATTEMPT3_RAW_SHA256,
      priorEvidenceDigest: PROBE_V04_PRIOR_ATTEMPT3_EVIDENCE_DIGEST,
      priorMigrationReceiptHash: PROBE_V04_PREDECESSOR_MIGRATION_RECEIPT_HASH,
      priorKnownActualNanoUsd: PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE.knownActualNanoUsd
    };
  }
  if (version !== GATE2_FALLBACK_CALIBRATION_BUNDLE_V2_VERSION) {
    throw new Error("fallback_bundle_version_unsupported");
  }
  const [policyHash, ledgerScriptHash, runnerContractHash, continuationScriptHash] =
    await Promise.all([
      probePolicyHash(),
      probeLedgerScriptHash(),
      fallbackRunnerContractHash(),
      probeContinuationScriptHash()
    ]);
  if (
    policyHash !== PROBE_V05_MIGRATED_POLICY_HASH ||
    ledgerScriptHash !== PROBE_V05_MIGRATED_LEDGER_SCRIPT_HASH ||
    runnerContractHash !== PROBE_V05_MIGRATED_RUNNER_CONTRACT_HASH
  ) {
    throw new Error("fallback_bundle_v2_runtime_identity_mismatch");
  }
  const [browserRuntimeHash, promptHash, settingsHash, implementationHash] = await Promise.all([
    fallbackBrowserRuntimeContractHash(),
    fallbackRunnerPromptHash(),
    fallbackRunnerSettingsHash(),
    fallbackRunnerImplementationHash()
  ]);
  return {
    generation: 2,
    version,
    protocolVersion: GATE2_FALLBACK_V2_PROTOCOL_VERSION,
    baseCalls: GATE2_FALLBACK_V2_BASE_CALLS,
    terminalCalls: GATE2_FALLBACK_V2_TERMINAL_CALLS,
    policyHash,
    ledgerScriptHash,
    runnerContractHash,
    continuationScriptHash,
    browserRuntimeHash,
    promptHash,
    settingsHash,
    envelopeVersion: FALLBACK_CALIBRATION_ENVELOPE_VERSION,
    trialEvidenceVersion: FALLBACK_TRIAL_EVIDENCE_VERSION,
    implementation: FALLBACK_IMPLEMENTATION,
    implementationHash,
    promptVersion: FALLBACK_RUNNER_PROMPT_VERSION,
    settingsVersion: FALLBACK_RUNNER_SETTINGS_VERSION,
    priorEvidenceRawSha256: PROBE_V05_PRIOR_EVIDENCE_RAW_SHA256,
    priorEvidenceDigest: PROBE_V05_PRIOR_EVIDENCE_DIGEST,
    priorMigrationReceiptHash: PROBE_V05_PREDECESSOR_MIGRATION_RECEIPT_HASH,
    priorKnownActualNanoUsd: PROBE_V05_POLICY_MIGRATION_FIXED_PRESERVED_STATE.knownActualNanoUsd
  };
}

async function verifyMigration(
  migrationValue: unknown,
  contract: EvidenceContract,
  appCommit: string
): Promise<ReadonlySet<string>> {
  const migration = record(migrationValue, "fallback_bundle_migration_invalid");
  const manifest = { ...migration };
  delete manifest.receiptHash;
  delete manifest.migrationDigest;
  delete manifest.migratedAtMs;
  const knownCalls = Array.isArray(migration.knownCalls) ? migration.knownCalls : [];
  const isV1 = contract.generation === 1;
  const receiptHash = isV1
    ? await probeV04PolicyMigrationReceiptHash(migration as never)
    : await probeV05PolicyMigrationReceiptHash(migration as never);
  const expected = isV1
    ? {
        version: PROBE_V04_POLICY_MIGRATION_VERSION,
        migrationId: PROBE_V04_POLICY_MIGRATION_ID,
        migrationProgramHash: PROBE_V04_POLICY_MIGRATION_PROGRAM_HASH,
        nextPurposeLimits: PROBE_V04_MIGRATED_PURPOSE_CALL_LIMITS,
        preserved: PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
        knownCallsDigest: PROBE_V04_PRESERVED_KNOWN_CALLS_DIGEST,
        nextPolicyHash: PROBE_V04_MIGRATED_POLICY_HASH,
        nextScriptHash: PROBE_V04_MIGRATED_LEDGER_SCRIPT_HASH,
        nextRunnerHash: PROBE_V04_MIGRATED_RUNNER_CONTRACT_HASH
      }
    : {
        version: PROBE_V05_POLICY_MIGRATION_VERSION,
        migrationId: PROBE_V05_POLICY_MIGRATION_ID,
        migrationProgramHash: PROBE_V05_POLICY_MIGRATION_PROGRAM_HASH,
        nextPurposeLimits: PROBE_V05_MIGRATED_PURPOSE_CALL_LIMITS,
        preserved: PROBE_V05_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
        knownCallsDigest: PROBE_V05_PRESERVED_KNOWN_CALLS_DIGEST,
        nextPolicyHash: PROBE_V05_MIGRATED_POLICY_HASH,
        nextScriptHash: PROBE_V05_MIGRATED_LEDGER_SCRIPT_HASH,
        nextRunnerHash: PROBE_V05_MIGRATED_RUNNER_CONTRACT_HASH
      };
  const ackAnchor = isV1 ? null : record(migration.ackAnchor, "fallback_bundle_ack_invalid");
  const fixedAckMatches = isV1
    ? true
    : Object.entries(PROBE_V05_ACK_ANCHOR_FIXED).every(
        ([key, expectedValue]) => ackAnchor?.[key] === expectedValue
      );
  const variableAckHashesMatch = isV1
    ? true
    : ["recoveryHash", "sessionHash", "runHash", "actorHash", "launchHash", "payloadBinding"].every(
        (key) => typeof ackAnchor?.[key] === "string" && /^[a-f0-9]{64}$/u.test(ackAnchor[key])
      );
  const v2SourceIdentityMatches =
    isV1 ||
    (migration.priorAppCommit === PROBE_V05_POLICY_MIGRATION_PRIOR_APP_COMMIT &&
      migration.priorActivationHash === PROBE_V05_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH &&
      migration.predecessorMigrationId === PROBE_V05_PREDECESSOR_MIGRATION_ID &&
      migration.guardInstanceId === GATE2_FALLBACK_V2_FROZEN_SOURCE_IDENTITY.guardInstanceId &&
      migration.initializedCommit === GATE2_FALLBACK_V2_FROZEN_SOURCE_IDENTITY.initializedCommit &&
      migration.previousPolicyVersion === PROBE_V05_PREVIOUS_POLICY_VERSION &&
      migration.previousPolicyHash === PROBE_V05_PREVIOUS_POLICY_HASH &&
      migration.previousScriptHash === PROBE_V05_PREVIOUS_LEDGER_SCRIPT_HASH &&
      migration.previousRunnerHash === PROBE_V05_PREVIOUS_RUNNER_CONTRACT_HASH &&
      canonicalJson(migration.previousPurposeLimits) ===
        canonicalJson(PROBE_V05_PREVIOUS_PURPOSE_CALL_LIMITS) &&
      canonicalJson(migration.authorizationInventory) ===
        canonicalJson(PROBE_V05_AUTHORIZATION_INVENTORY) &&
      migration.nextPolicyVersion === PROBE_V05_MIGRATED_POLICY_VERSION);
  if (
    migration.version !== expected.version ||
    migration.migrationId !== expected.migrationId ||
    migration.receiptHash !== receiptHash ||
    migration.migrationDigest !== (await canonicalSha256(manifest)) ||
    migration.nextPolicyHash !== contract.policyHash ||
    migration.nextPolicyHash !== expected.nextPolicyHash ||
    migration.nextScriptHash !== contract.ledgerScriptHash ||
    migration.nextScriptHash !== expected.nextScriptHash ||
    migration.nextRunnerHash !== contract.runnerContractHash ||
    migration.nextRunnerHash !== expected.nextRunnerHash ||
    migration.migrationProgramHash !== expected.migrationProgramHash ||
    migration.migrationCommit !== appCommit ||
    migration.predecessorMigrationReceiptHash !== contract.priorMigrationReceiptHash ||
    migration.priorEvidenceRawSha256 !== contract.priorEvidenceRawSha256 ||
    migration.priorEvidenceDigest !== contract.priorEvidenceDigest ||
    !v2SourceIdentityMatches ||
    (!isV1 &&
      (migration.priorReproducerRawSha256 !== PROBE_V05_PRIOR_REPRODUCER_RAW_SHA256 ||
        migration.priorReproducerEvidenceDigest !== PROBE_V05_PRIOR_REPRODUCER_EVIDENCE_DIGEST ||
        !fixedAckMatches ||
        !variableAckHashesMatch ||
        ackAnchor?.encryptedDataPresent !== false)) ||
    canonicalJson(migration.preserved) !== canonicalJson(expected.preserved) ||
    canonicalJson(migration.nextPurposeLimits) !== canonicalJson(expected.nextPurposeLimits) ||
    migration.globalCallLimit !== PROBE_GLOBAL_CALL_LIMIT ||
    migration.lifetimeSpendCeilingNanoUsd !== PROBE_LIFETIME_SPEND_CEILING_NANO_USD ||
    migration.perCallReservationNanoUsd !== PROBE_PER_CALL_RESERVATION_NANO_USD ||
    knownCalls.length !== contract.baseCalls ||
    (await canonicalSha256(knownCalls)) !== expected.knownCallsDigest
  ) {
    throw new Error("fallback_bundle_migration_mismatch");
  }
  const knownJtis = new Set(
    knownCalls.map((call) => String(record(call, "fallback_bundle_known_call_invalid").jti ?? ""))
  );
  if (knownJtis.size !== knownCalls.length || knownJtis.has("")) {
    throw new Error("fallback_bundle_known_call_identity_mismatch");
  }
  return knownJtis;
}

async function verifyEnvelopeHash(value: unknown, contract: EvidenceContract): Promise<string> {
  return contract.generation === 1
    ? fallbackV1CalibrationEnvelopeHash(value)
    : fallbackCalibrationEnvelopeHash(value);
}

export async function verifyGate2FallbackCalibrationBundleServer(value: unknown): Promise<void> {
  const contract = await evidenceContract(value);
  const bundle = bundleSchema(contract).parse(value);
  const { evidenceDigest, ...core } = bundle;
  if (evidenceDigest !== (await canonicalSha256(core)) || !exactUtc(bundle.completedAt)) {
    throw new Error("fallback_bundle_digest_or_time_mismatch");
  }
  const preservedJtis = await verifyMigration(bundle.policyMigration, contract, bundle.appCommit);

  const jtis = new Set<string>();
  const caseIds = new Set<string>();
  const trialIds = new Set<string>();
  let actualCost = 0;
  let passed = 0;
  for (const [ordinal, row] of bundle.cases.entries()) {
    const evaluation = record(row.evaluation, "fallback_bundle_evaluation_invalid");
    const settlement = record(row.settlement, "fallback_bundle_settlement_invalid");
    const trialEvidence = record(row.trialEvidence, "fallback_bundle_trial_evidence_invalid");
    const envelope = record(trialEvidence.envelope, "fallback_bundle_envelope_invalid");
    const runner = record(envelope.runner, "fallback_bundle_runner_invalid");
    const providerReceipt = record(
      trialEvidence.providerReceipt,
      "fallback_bundle_provider_receipt_invalid"
    );
    const provider = record(providerReceipt.receipt, "fallback_bundle_provider_invalid");
    const capture = record(trialEvidence.capture, "fallback_bundle_capture_invalid");
    const claim =
      contract.generation === 2
        ? record(capture.claim, "fallback_bundle_capture_claim_invalid")
        : null;
    const fallback = record(trialEvidence.fallback, "fallback_bundle_runtime_invalid");
    const nativeReceipt =
      fallback.nativeReceipt === null
        ? null
        : record(fallback.nativeReceipt, "fallback_bundle_native_receipt_invalid");
    const traces = Array.isArray(trialEvidence.currentTraces) ? trialEvidence.currentTraces : [];
    const trace = (traces[0] ?? null) as OperationTrace | null;
    const expected = getProbeCalibrationCase(ordinal);
    const cost = Number(settlement.accountedNanoUsd);
    const envelopeCaseId = String(envelope.caseId ?? "");
    const envelopeTrialId = String(envelope.trialId ?? "");
    const nativeAdmission = trialEvidence.nativeAdmission;
    const admission =
      nativeAdmission === null
        ? null
        : record(nativeAdmission, "fallback_bundle_native_admission_invalid");
    if (
      row.ordinal !== ordinal ||
      jtis.has(row.jti) ||
      (contract.generation === 2 && preservedJtis.has(row.jti)) ||
      !Number.isSafeInteger(cost) ||
      cost < 0 ||
      cost > PROBE_PER_CALL_RESERVATION_NANO_USD ||
      evaluation.ordinal !== ordinal ||
      evaluation.internalTruthId !== expected.internalTruthId ||
      evaluation.expectedTool !== expected.expectedTool ||
      evaluation.calibrationOnly !== true ||
      evaluation.includedInBenchmark !== false ||
      record(evaluation.score, "fallback_bundle_score_invalid").possible !== 1 ||
      record(evaluation.score, "fallback_bundle_score_invalid").earned !==
        (evaluation.passed === true ? 1 : 0) ||
      trialEvidence.version !== contract.trialEvidenceVersion ||
      trialEvidence.evidenceDigest === undefined ||
      envelope.version !== contract.envelopeVersion ||
      envelope.buildCommit !== bundle.appCommit ||
      (contract.generation === 2 &&
        (envelope.runId !== bundle.runId ||
          claim?.runId !== bundle.runId ||
          claim.caseId !== envelopeCaseId ||
          claim.trialId !== envelopeTrialId ||
          caseIds.has(envelopeCaseId) ||
          trialIds.has(envelopeTrialId) ||
          (admission !== null && admission.jti !== row.jti))) ||
      runner.implementation !== contract.implementation ||
      (contract.implementationHash !== null &&
        runner.implementationHash !== contract.implementationHash) ||
      runner.promptVersion !== contract.promptVersion ||
      runner.promptHash !== contract.promptHash ||
      runner.settingsVersion !== contract.settingsVersion ||
      runner.settingsHash !== contract.settingsHash ||
      runner.browserRuntimeHash !== contract.browserRuntimeHash ||
      provider.runnerContractHash !== contract.runnerContractHash ||
      provider.promptHash !== contract.promptHash ||
      provider.settingsHash !== contract.settingsHash ||
      provider.browserRuntimeHash !== contract.browserRuntimeHash
    ) {
      throw new Error(
        contract.generation === 2 && preservedJtis.has(row.jti)
          ? "fallback_bundle_jti_lineage_overlap"
          : "fallback_bundle_case_mismatch"
      );
    }
    jtis.add(row.jti);
    caseIds.add(envelopeCaseId);
    trialIds.add(envelopeTrialId);
    const postResetBoundary = trialEvidence.postResetBoundary;
    const clientEvidence = { ...trialEvidence };
    delete clientEvidence.postResetBoundary;
    delete clientEvidence.providerReceipt;
    delete clientEvidence.nativeAdmission;
    delete clientEvidence.envelope;
    delete clientEvidence.evidenceDigest;
    const expectedTrialDigest = await canonicalSha256({
      lane: GATE2_FALLBACK_CALIBRATION_LANE,
      evidence: clientEvidence,
      postResetBoundary,
      providerReceipt,
      nativeAdmission,
      envelopeHash: await verifyEnvelopeHash(envelope, contract)
    });
    const usage = record(provider.usage, "fallback_bundle_usage_invalid");
    const usageCost = calculateProbeCostNanoUsd({
      inputTokens: Number(usage.inputTokens),
      outputTokens: Number(usage.outputTokens)
    });
    let parsedRawResponse: unknown;
    try {
      parsedRawResponse = JSON.parse(String(provider.rawResponseBytes)) as unknown;
    } catch {
      throw new Error("fallback_bundle_raw_provider_response_invalid");
    }
    const expectedDecisionEnvelope = {
      context: { kind: "fresh-stateless", previousResponseId: null, providerRequestCount: 1 },
      rawModelResponse: provider.rawResponseBytes,
      providerReceipt,
      decision: provider.decision
    };
    if (
      trialEvidence.evidenceDigest !== expectedTrialDigest ||
      clientEvidence.captureDigest !== (await canonicalSha256(capture)) ||
      capture.providerReceiptHash !== (await canonicalSha256(providerReceipt)) ||
      capture.rawModelResponseHash !== (await sha256Hex(String(provider.rawResponseBytes))) ||
      capture.rawDecisionEnvelopeHash !== (await canonicalSha256(expectedDecisionEnvelope)) ||
      provider.requestBodyHash !== (await sha256Hex(String(provider.requestBodyBytes))) ||
      provider.rawResponseHash !== (await sha256Hex(String(provider.rawResponseBytes))) ||
      canonicalJson(provider.rawResponse) !== canonicalJson(parsedRawResponse) ||
      provider.usageHash !== (await canonicalSha256(usage)) ||
      usage.accountedNanoUsd !== usageCost ||
      cost !== usageCost ||
      settlement.providerResponseHash !== provider.rawResponseHash ||
      settlement.usageHash !== provider.usageHash
    ) {
      throw new Error("fallback_bundle_provider_or_trial_digest_mismatch");
    }

    const nativeExecution: ProbeNativeExecutionObservation | null =
      nativeReceipt && trace
        ? {
            toolName: String(nativeReceipt.toolName ?? ""),
            nativeCallCount: Number(nativeReceipt.nativeCallCount ?? -1),
            handlerTraceId: trace.eventId,
            resultDigest: trace.canonicalResult?.sha256 ?? null,
            effectDigest: await canonicalSha256(trace.effect),
            stateBeforeDigest: trace.stateBefore.sha256,
            stateAfterDigest: trace.stateAfter.sha256
          }
        : null;
    const recomputedEvaluation = await evaluateProbeCalibrationCase(ordinal, {
      decision: (provider.decision ?? null) as ProbeDecision | null,
      decisionError: typeof provider.decisionError === "string" ? provider.decisionError : null,
      nativeDispatchCount: Number(capture.nativeDispatchCount ?? -1),
      nativeExecution,
      trace,
      resetBefore: resetProjection(capture.initialBoundary),
      resetAfter: resetProjection(postResetBoundary)
    });
    const expectedSettlementDigest = await canonicalSha256({
      version: 1,
      lane: GATE2_FALLBACK_CALIBRATION_LANE,
      jti: row.jti,
      providerResponseHash: provider.rawResponseHash,
      usageHash: provider.usageHash,
      trialEvidenceDigest: trialEvidence.evidenceDigest,
      evaluation: recomputedEvaluation
    });
    const currentInspection = record(
      clientEvidence.currentInspection,
      "fallback_bundle_current_inspection_invalid"
    );
    const expectedState = trace?.stateAfter.value ?? createCheckoutFixture();
    if (
      canonicalJson(recomputedEvaluation) !== canonicalJson(row.evaluation) ||
      settlement.settlementDigest !== expectedSettlementDigest ||
      canonicalJson(clientEvidence.currentState) !== canonicalJson(expectedState) ||
      canonicalJson(currentInspection.state) !== canonicalJson(expectedState) ||
      currentInspection.currentTraceCount !== (trace ? 1 : 0)
    ) {
      throw new Error("fallback_bundle_case_recomputation_mismatch");
    }
    actualCost += cost;
    if (evaluation.passed === true) passed += 1;
  }
  if (
    actualCost !== bundle.calibrationCost.fallbackCalibrationAccountedNanoUsd ||
    bundle.calibrationCost.terminalCumulativeKnownAccountedNanoUsd !==
      bundle.calibrationCost.priorCumulativeKnownAccountedNanoUsd + actualCost ||
    bundle.terminalGuard.knownAccountedNanoUsd !==
      bundle.calibrationCost.terminalCumulativeKnownAccountedNanoUsd ||
    bundle.passedCount !== passed
  ) {
    throw new Error("fallback_bundle_cost_or_score_mismatch");
  }
}
