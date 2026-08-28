import "server-only";

import { createCheckoutFixture } from "@/lib/domain/checkout";
import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import type { OperationTrace } from "@/lib/evidence/operation-trace";
import { fallbackCalibrationEnvelopeHash } from "@/lib/fallback/calibration-envelope";
import {
  fallbackBrowserRuntimeContractHash,
  fallbackRunnerContractHash
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
  PROBE_V04_MIGRATED_PURPOSE_CALL_LIMITS,
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
  PROBE_GLOBAL_CALL_LIMIT,
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
  PROBE_PER_CALL_RESERVATION_NANO_USD,
  calculateProbeCostNanoUsd,
  probePolicyHash
} from "@/lib/probe/policy";
import { probeCompletedCalibrationRowSchema } from "@/lib/probe/run-continuation.server";
import {
  FALLBACK_PROBE_CALIBRATION_BASE_CALLS,
  FALLBACK_PROBE_CALIBRATION_CASE_COUNT,
  FALLBACK_PROBE_CALIBRATION_LANE,
  FALLBACK_PROBE_CALIBRATION_PROTOCOL_VERSION,
  FALLBACK_PROBE_CALIBRATION_TERMINAL_CALLS
} from "@/lib/probe/service-contract";
import { z } from "zod";

export const GATE2_FALLBACK_CALIBRATION_BUNDLE_VERSION =
  "toolproof-gate2-googlechromelabs-fallback-evidence@1.0.0";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const nonNegativeInteger = z.number().int().nonnegative();
const bundleSchema = z
  .object({
    version: z.literal(GATE2_FALLBACK_CALIBRATION_BUNDLE_VERSION),
    protocolVersion: z.literal(FALLBACK_PROBE_CALIBRATION_PROTOCOL_VERSION),
    lane: z.literal(FALLBACK_PROBE_CALIBRATION_LANE),
    calibrationOnly: z.literal(true),
    includedInBenchmark: z.literal(false),
    designation: z.literal("approved-pinned-fallback-not-fourth-preferred-attempt"),
    callLineage: z
      .object({
        preservedPreferredCalls: z.literal(FALLBACK_PROBE_CALIBRATION_BASE_CALLS),
        fallbackCalibrationCalls: z.literal(FALLBACK_PROBE_CALIBRATION_CASE_COUNT),
        terminalCalibrationCalls: z.literal(FALLBACK_PROBE_CALIBRATION_TERMINAL_CALLS),
        priorEvidenceRawSha256: sha256,
        priorEvidenceDigest: sha256,
        priorMigrationReceiptHash: sha256
      })
      .strict(),
    policyMigration: z.json(),
    provider: z.literal("OpenAI"),
    model: z.literal("gpt-5.6-terra"),
    appCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    activationHash: sha256,
    policyHash: sha256,
    ledgerScriptHash: sha256,
    runnerContractHash: sha256,
    continuationScriptHash: sha256,
    runId: z.string().regex(/^run_[A-Za-z0-9_-]{22}$/u),
    completedAt: z.string(),
    cases: z
      .array(probeCompletedCalibrationRowSchema)
      .length(FALLBACK_PROBE_CALIBRATION_CASE_COUNT),
    caseCount: z.literal(FALLBACK_PROBE_CALIBRATION_CASE_COUNT),
    terminalGuard: z
      .object({
        phase: z.literal("idle"),
        claimedCalls: z.literal(FALLBACK_PROBE_CALIBRATION_TERMINAL_CALLS),
        knownCalls: z.literal(FALLBACK_PROBE_CALIBRATION_TERMINAL_CALLS),
        pendingCalls: z.literal(0),
        uncertainCalls: z.literal(0),
        calibrationCalls: z.literal(FALLBACK_PROBE_CALIBRATION_TERMINAL_CALLS),
        committedNanoUsd: nonNegativeInteger,
        knownAccountedNanoUsd: nonNegativeInteger,
        globalCallLimit: z.literal(PROBE_GLOBAL_CALL_LIMIT),
        lifetimeSpendCeilingNanoUsd: z.literal(PROBE_LIFETIME_SPEND_CEILING_NANO_USD)
      })
      .strict(),
    calibrationCost: z
      .object({
        priorCumulativeKnownAccountedNanoUsd: nonNegativeInteger,
        fallbackCalibrationAccountedNanoUsd: nonNegativeInteger,
        terminalCumulativeKnownAccountedNanoUsd: nonNegativeInteger
      })
      .strict(),
    passedCount: z.number().int().min(0).max(FALLBACK_PROBE_CALIBRATION_CASE_COUNT),
    evidenceDigest: sha256
  })
  .strict();

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

export async function verifyGate2FallbackCalibrationBundleServer(value: unknown): Promise<void> {
  const bundle = bundleSchema.parse(value);
  const { evidenceDigest, ...core } = bundle;
  if (evidenceDigest !== (await canonicalSha256(core)) || !exactUtc(bundle.completedAt)) {
    throw new Error("fallback_bundle_digest_or_time_mismatch");
  }

  const migration = record(bundle.policyMigration, "fallback_bundle_migration_invalid");
  const manifest = { ...migration };
  delete manifest.receiptHash;
  delete manifest.migrationDigest;
  delete manifest.migratedAtMs;
  const knownCalls = Array.isArray(migration.knownCalls) ? migration.knownCalls : [];
  if (
    migration.version !== PROBE_V04_POLICY_MIGRATION_VERSION ||
    migration.migrationId !== PROBE_V04_POLICY_MIGRATION_ID ||
    migration.receiptHash !== (await probeV04PolicyMigrationReceiptHash(migration as never)) ||
    migration.migrationDigest !== (await canonicalSha256(manifest)) ||
    migration.nextPolicyHash !== bundle.policyHash ||
    migration.nextScriptHash !== bundle.ledgerScriptHash ||
    migration.nextRunnerHash !== bundle.runnerContractHash ||
    migration.migrationProgramHash !== PROBE_V04_POLICY_MIGRATION_PROGRAM_HASH ||
    migration.migrationCommit !== bundle.appCommit ||
    migration.predecessorMigrationReceiptHash !== PROBE_V04_PREDECESSOR_MIGRATION_RECEIPT_HASH ||
    migration.priorEvidenceRawSha256 !== PROBE_V04_PRIOR_ATTEMPT3_RAW_SHA256 ||
    migration.priorEvidenceDigest !== PROBE_V04_PRIOR_ATTEMPT3_EVIDENCE_DIGEST ||
    canonicalJson(migration.preserved) !==
      canonicalJson(PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE) ||
    canonicalJson(migration.nextPurposeLimits) !==
      canonicalJson(PROBE_V04_MIGRATED_PURPOSE_CALL_LIMITS) ||
    migration.globalCallLimit !== PROBE_GLOBAL_CALL_LIMIT ||
    migration.lifetimeSpendCeilingNanoUsd !== PROBE_LIFETIME_SPEND_CEILING_NANO_USD ||
    migration.perCallReservationNanoUsd !== PROBE_PER_CALL_RESERVATION_NANO_USD ||
    knownCalls.length !== FALLBACK_PROBE_CALIBRATION_BASE_CALLS ||
    (await canonicalSha256(knownCalls)) !== PROBE_V04_PRESERVED_KNOWN_CALLS_DIGEST
  ) {
    throw new Error("fallback_bundle_migration_mismatch");
  }

  const [policyHash, ledgerHash, runnerHash, continuationHash, browserRuntimeHash] =
    await Promise.all([
      probePolicyHash(),
      probeLedgerScriptHash(),
      fallbackRunnerContractHash(),
      probeContinuationScriptHash(),
      fallbackBrowserRuntimeContractHash()
    ]);
  if (
    bundle.policyHash !== policyHash ||
    bundle.ledgerScriptHash !== ledgerHash ||
    bundle.runnerContractHash !== runnerHash ||
    bundle.continuationScriptHash !== continuationHash ||
    bundle.callLineage.priorEvidenceRawSha256 !== PROBE_V04_PRIOR_ATTEMPT3_RAW_SHA256 ||
    bundle.callLineage.priorEvidenceDigest !== PROBE_V04_PRIOR_ATTEMPT3_EVIDENCE_DIGEST ||
    bundle.callLineage.priorMigrationReceiptHash !== PROBE_V04_PREDECESSOR_MIGRATION_RECEIPT_HASH ||
    bundle.terminalGuard.committedNanoUsd !==
      FALLBACK_PROBE_CALIBRATION_TERMINAL_CALLS * PROBE_PER_CALL_RESERVATION_NANO_USD ||
    bundle.calibrationCost.priorCumulativeKnownAccountedNanoUsd !==
      PROBE_V04_POLICY_MIGRATION_FIXED_PRESERVED_STATE.knownActualNanoUsd
  ) {
    throw new Error("fallback_bundle_frozen_identity_mismatch");
  }

  const jtis = new Set<string>();
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
    const fallback = record(trialEvidence.fallback, "fallback_bundle_runtime_invalid");
    const nativeReceipt =
      fallback.nativeReceipt === null
        ? null
        : record(fallback.nativeReceipt, "fallback_bundle_native_receipt_invalid");
    const traces = Array.isArray(trialEvidence.currentTraces) ? trialEvidence.currentTraces : [];
    const trace = (traces[0] ?? null) as OperationTrace | null;
    const expected = getProbeCalibrationCase(ordinal);
    const cost = Number(settlement.accountedNanoUsd);
    if (
      row.ordinal !== ordinal ||
      jtis.has(row.jti) ||
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
      trialEvidence.evidenceDigest === undefined ||
      envelope.buildCommit !== bundle.appCommit ||
      runner.browserRuntimeHash !== browserRuntimeHash
    ) {
      throw new Error("fallback_bundle_case_mismatch");
    }
    jtis.add(row.jti);
    const postResetBoundary = trialEvidence.postResetBoundary;
    const nativeAdmission = trialEvidence.nativeAdmission;
    const clientEvidence = { ...trialEvidence };
    delete clientEvidence.postResetBoundary;
    delete clientEvidence.providerReceipt;
    delete clientEvidence.nativeAdmission;
    delete clientEvidence.envelope;
    delete clientEvidence.evidenceDigest;
    const expectedTrialDigest = await canonicalSha256({
      lane: FALLBACK_PROBE_CALIBRATION_LANE,
      evidence: clientEvidence,
      postResetBoundary,
      providerReceipt,
      nativeAdmission,
      envelopeHash: await fallbackCalibrationEnvelopeHash(envelope as never)
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
      lane: FALLBACK_PROBE_CALIBRATION_LANE,
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
