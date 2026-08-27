import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import { verifyCheckoutReset } from "@/lib/domain/checkout-reset";
import {
  GATE2_ATTEMPT_1_KNOWN_ACCOUNTED_NANO_USD,
  GATE2_ATTEMPT_1_LINEAGE,
  createGate2PriorAttemptsLineage,
  verifyGate2PriorAttemptsLineage,
  type Gate2PriorAttemptsLineage
} from "@/lib/evidence/gate2-attempt-lineage";
import {
  verifyProbeTransportBinding,
  type ProbeCalibrationEnvelope
} from "@/lib/probe/calibration-envelope";
import {
  PROBE_V03_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
  PROBE_V03_POLICY_MIGRATION_ID,
  PROBE_V03_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH,
  PROBE_V03_POLICY_MIGRATION_PRIOR_APP_COMMIT,
  PROBE_V03_POLICY_MIGRATION_VERSION,
  PROBE_V03_PREDECESSOR_MIGRATION_ID,
  PROBE_V03_PREDECESSOR_MIGRATION_RECEIPT_HASH,
  PROBE_V03_PREVIOUS_LEDGER_SCRIPT_HASH,
  PROBE_V03_PREVIOUS_POLICY_HASH,
  PROBE_V03_PREVIOUS_POLICY_VERSION,
  PROBE_V03_PREVIOUS_PURPOSE_CALL_LIMITS,
  probeV03PolicyMigrationDigest,
  probeV03PolicyMigrationReceiptHash,
  type ProbeV03PolicyMigrationManifest,
  type ProbeV03PolicyMigrationReceipt,
  type ProbeV03PolicyMigrationReceiptCore
} from "@/lib/probe/policy-v03-migration-contract";
import {
  PROBE_GLOBAL_CALL_LIMIT,
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
  PROBE_PER_CALL_RESERVATION_NANO_USD,
  PROBE_POLICY_VERSION,
  PROBE_PURPOSE_CALL_LIMITS
} from "@/lib/probe/policy";
import {
  PROBE_CALIBRATION_ATTEMPT,
  PROBE_CALIBRATION_ATTEMPT_CASE_COUNT,
  PROBE_CALIBRATION_BASE_CALLS,
  PROBE_CALIBRATION_PROTOCOL_VERSION,
  PROBE_CALIBRATION_TERMINAL_CALLS
} from "@/lib/probe/service-contract";

export const GATE2_CALIBRATION_BUNDLE_VERSION =
  "toolproof-gate2-calibration-attempt-3-evidence@1.0.0";
export const GATE2_CALIBRATION_LANE = "custom-probe-calibration-attempt-3" as const;
export const GATE2_ATTEMPT_COST_RECONCILIATION_VERSION =
  "toolproof-gate2-attempt-cost-reconciliation@2.0.0";

export {
  GATE2_ATTEMPT_1_KNOWN_ACCOUNTED_NANO_USD,
  GATE2_ATTEMPT_1_LINEAGE,
  GATE2_ATTEMPT_2_ACTIVATION_HASH,
  GATE2_ATTEMPT_2_APP_COMMIT,
  GATE2_ATTEMPT_2_LINEAGE_VERSION,
  GATE2_PRIOR_ATTEMPTS_LINEAGE_VERSION,
  GATE2_RETAINED_ATTEMPT_LINEAGE_VERSION,
  createGate2PriorAttemptsLineage,
  verifyGate2PriorAttemptsLineage,
  type Gate2Attempt2Lineage,
  type Gate2PriorAttemptsLineage
} from "@/lib/evidence/gate2-attempt-lineage";

export interface VerifiedGate2CalibrationBundle {
  readonly version: typeof GATE2_CALIBRATION_BUNDLE_VERSION;
  readonly protocolVersion: typeof PROBE_CALIBRATION_PROTOCOL_VERSION;
  readonly attempt: typeof PROBE_CALIBRATION_ATTEMPT;
  readonly lane: typeof GATE2_CALIBRATION_LANE;
  readonly calibrationOnly: true;
  readonly includedInBenchmark: false;
  readonly appCommit: string;
  readonly caseCount: typeof PROBE_CALIBRATION_ATTEMPT_CASE_COUNT;
  readonly passedCount: number;
  readonly cases: readonly Record<string, unknown>[];
  readonly priorAttempts: Gate2PriorAttemptsLineage;
  readonly evidenceDigest: string;
  readonly [key: string]: unknown;
}

export class Gate2CalibrationBundleError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "Gate2CalibrationBundleError";
  }
}

function objectValue(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Gate2CalibrationBundleError(code);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, pattern: RegExp, code: string): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Gate2CalibrationBundleError(code);
  }
  return value;
}

function exactJson(value: unknown, expected: unknown, code: string): void {
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new Gate2CalibrationBundleError(code);
  }
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  code: string
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Gate2CalibrationBundleError(code);
  }
}

async function verifyPolicyMigration(value: unknown): Promise<ProbeV03PolicyMigrationReceipt> {
  const migration = objectValue(value, "invalid_policy_migration");
  const preserved = objectValue(migration.preserved, "invalid_migration_preserved_state");
  const purposeCounts = objectValue(
    preserved.purposeCounts,
    "invalid_migration_preserved_purpose_counts"
  );
  const knownCalls = Array.isArray(migration.knownCalls) ? migration.knownCalls : [];
  exactKeys(
    migration,
    [
      "version",
      "migrationId",
      "priorAppCommit",
      "priorActivationHash",
      "predecessorMigrationId",
      "predecessorMigrationReceiptHash",
      "guardInstanceId",
      "initializedCommit",
      "previousPolicyVersion",
      "previousPolicyHash",
      "previousScriptHash",
      "preserved",
      "knownCalls",
      "migrationCommit",
      "nextPolicyVersion",
      "nextPolicyHash",
      "nextScriptHash",
      "previousPurposeLimits",
      "nextPurposeLimits",
      "globalCallLimit",
      "lifetimeSpendCeilingNanoUsd",
      "perCallReservationNanoUsd",
      "migrationDigest",
      "migratedAtMs",
      "receiptHash"
    ],
    "policy_migration_shape_mismatch"
  );
  exactKeys(
    preserved,
    [
      "claimedCalls",
      "knownCalls",
      "pendingCalls",
      "uncertainCalls",
      "inflightCalls",
      "committedNanoUsd",
      "knownActualNanoUsd",
      "uncertainUpperNanoUsd",
      "sequence",
      "purposeCounts"
    ],
    "policy_migration_preserved_shape_mismatch"
  );
  exactKeys(
    purposeCounts,
    ["calibration", "baseline", "repair", "revised", "judge"],
    "policy_migration_purpose_counts_shape_mismatch"
  );
  if (
    migration.version !== PROBE_V03_POLICY_MIGRATION_VERSION ||
    migration.migrationId !== PROBE_V03_POLICY_MIGRATION_ID ||
    migration.priorAppCommit !== PROBE_V03_POLICY_MIGRATION_PRIOR_APP_COMMIT ||
    migration.priorActivationHash !== PROBE_V03_POLICY_MIGRATION_PRIOR_ACTIVATION_HASH ||
    migration.predecessorMigrationId !== PROBE_V03_PREDECESSOR_MIGRATION_ID ||
    migration.predecessorMigrationReceiptHash !== PROBE_V03_PREDECESSOR_MIGRATION_RECEIPT_HASH ||
    migration.previousPolicyVersion !== PROBE_V03_PREVIOUS_POLICY_VERSION ||
    migration.previousPolicyHash !== PROBE_V03_PREVIOUS_POLICY_HASH ||
    migration.previousScriptHash !== PROBE_V03_PREVIOUS_LEDGER_SCRIPT_HASH ||
    migration.nextPolicyVersion !== PROBE_POLICY_VERSION ||
    typeof migration.nextPolicyHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(migration.nextPolicyHash) ||
    typeof migration.nextScriptHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(migration.nextScriptHash) ||
    typeof migration.migrationDigest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(migration.migrationDigest) ||
    typeof migration.receiptHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(migration.receiptHash) ||
    typeof migration.guardInstanceId !== "string" ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(migration.guardInstanceId) ||
    typeof migration.initializedCommit !== "string" ||
    !/^[a-f0-9]{40}$/u.test(migration.initializedCommit) ||
    typeof migration.migrationCommit !== "string" ||
    !/^[a-f0-9]{40}$/u.test(migration.migrationCommit) ||
    migration.globalCallLimit !== PROBE_GLOBAL_CALL_LIMIT ||
    migration.lifetimeSpendCeilingNanoUsd !== PROBE_LIFETIME_SPEND_CEILING_NANO_USD ||
    migration.perCallReservationNanoUsd !== PROBE_PER_CALL_RESERVATION_NANO_USD ||
    preserved.claimedCalls !== PROBE_CALIBRATION_BASE_CALLS ||
    preserved.knownCalls !== PROBE_CALIBRATION_BASE_CALLS ||
    preserved.pendingCalls !== 0 ||
    preserved.uncertainCalls !== 0 ||
    preserved.inflightCalls !== 0 ||
    preserved.committedNanoUsd !==
      PROBE_CALIBRATION_BASE_CALLS * PROBE_PER_CALL_RESERVATION_NANO_USD ||
    !Number.isSafeInteger(preserved.knownActualNanoUsd) ||
    Number(preserved.knownActualNanoUsd) < GATE2_ATTEMPT_1_KNOWN_ACCOUNTED_NANO_USD ||
    Number(preserved.knownActualNanoUsd) >
      PROBE_CALIBRATION_BASE_CALLS * PROBE_PER_CALL_RESERVATION_NANO_USD ||
    preserved.uncertainUpperNanoUsd !== 0 ||
    preserved.sequence !== PROBE_CALIBRATION_BASE_CALLS ||
    knownCalls.length !== PROBE_CALIBRATION_BASE_CALLS ||
    !Number.isSafeInteger(migration.migratedAtMs) ||
    Number(migration.migratedAtMs) < 0
  ) {
    throw new Gate2CalibrationBundleError("policy_migration_mismatch");
  }
  exactJson(
    migration.previousPurposeLimits,
    PROBE_V03_PREVIOUS_PURPOSE_CALL_LIMITS,
    "policy_migration_mismatch"
  );
  exactJson(migration.nextPurposeLimits, PROBE_PURPOSE_CALL_LIMITS, "policy_migration_mismatch");
  exactJson(
    Object.fromEntries(Object.entries(preserved).filter(([key]) => key !== "knownActualNanoUsd")),
    PROBE_V03_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
    "policy_migration_mismatch"
  );
  const knownJtis = new Set<string>();
  let knownCost = 0;
  for (const [ordinal, value] of knownCalls.entries()) {
    const call = objectValue(value, "invalid_migration_known_call");
    exactKeys(
      call,
      [
        "ordinal",
        "jti",
        "dispatchSequence",
        "actualNanoUsd",
        "providerResponseHash",
        "settlementDigest",
        "usageHash"
      ],
      "policy_migration_known_call_shape_mismatch"
    );
    if (
      call.ordinal !== ordinal ||
      typeof call.jti !== "string" ||
      !/^[A-Za-z0-9_-]{16,128}$/u.test(call.jti) ||
      call.dispatchSequence !== ordinal + 1 ||
      !Number.isSafeInteger(call.actualNanoUsd) ||
      Number(call.actualNanoUsd) < 0 ||
      Number(call.actualNanoUsd) > PROBE_PER_CALL_RESERVATION_NANO_USD ||
      typeof call.providerResponseHash !== "string" ||
      !/^[a-f0-9]{64}$/u.test(call.providerResponseHash) ||
      typeof call.settlementDigest !== "string" ||
      !/^[a-f0-9]{64}$/u.test(call.settlementDigest) ||
      typeof call.usageHash !== "string" ||
      !/^[a-f0-9]{64}$/u.test(call.usageHash) ||
      knownJtis.has(call.jti)
    ) {
      throw new Gate2CalibrationBundleError("policy_migration_known_call_mismatch");
    }
    knownJtis.add(call.jti);
    knownCost += Number(call.actualNanoUsd);
  }
  const attempt1KnownCost = knownCalls.slice(0, 4).reduce((total, value) => {
    return total + Number(objectValue(value, "invalid_migration_known_call").actualNanoUsd);
  }, 0);
  if (
    knownCost !== preserved.knownActualNanoUsd ||
    attempt1KnownCost !== GATE2_ATTEMPT_1_KNOWN_ACCOUNTED_NANO_USD
  ) {
    throw new Gate2CalibrationBundleError("policy_migration_cost_mismatch");
  }
  exactJson(
    purposeCounts,
    PROBE_V03_POLICY_MIGRATION_FIXED_PRESERVED_STATE.purposeCounts,
    "policy_migration_mismatch"
  );
  const core = Object.fromEntries(
    Object.entries(migration).filter(([key]) => key !== "receiptHash")
  ) as unknown as ProbeV03PolicyMigrationReceiptCore;
  const manifest = Object.fromEntries(
    Object.entries(core).filter(([key]) => !["migrationDigest", "migratedAtMs"].includes(key))
  ) as unknown as ProbeV03PolicyMigrationManifest;
  if (
    migration.migrationDigest !== (await probeV03PolicyMigrationDigest(manifest)) ||
    migration.receiptHash !== (await probeV03PolicyMigrationReceiptHash(core))
  ) {
    throw new Gate2CalibrationBundleError("policy_migration_digest_mismatch");
  }
  return migration as unknown as ProbeV03PolicyMigrationReceipt;
}

async function verifyCanonicalEvidence(value: unknown): Promise<void> {
  const evidence = objectValue(value, "invalid_canonical_evidence");
  const bytes = typeof evidence.bytes === "string" ? evidence.bytes : "";
  if (canonicalJson(evidence.value) !== bytes || evidence.sha256 !== (await sha256Hex(bytes))) {
    throw new Gate2CalibrationBundleError("canonical_evidence_mismatch");
  }
}

async function verifyResetBoundary(value: unknown) {
  const boundary = objectValue(value, "invalid_reset_boundary");
  const resetEvidence = objectValue(boundary.resetReceipt, "invalid_reset_evidence");
  const verification = objectValue(resetEvidence.verification, "invalid_reset_verification");
  const domainReceipt = objectValue(resetEvidence.domainReceipt, "invalid_domain_reset");
  const inspection = objectValue(resetEvidence.inspection, "invalid_reset_inspection");
  const archives = Array.isArray(resetEvidence.domainArchives) ? resetEvidence.domainArchives : [];
  const traceLedger = objectValue(resetEvidence.traceLedger, "invalid_reset_trace_ledger");
  const recomputed = await verifyCheckoutReset({
    domainReceipt: domainReceipt as unknown as Parameters<
      typeof verifyCheckoutReset
    >[0]["domainReceipt"],
    inspection: inspection as unknown as Parameters<typeof verifyCheckoutReset>[0]["inspection"],
    archives: archives as unknown as Parameters<typeof verifyCheckoutReset>[0]["archives"],
    traceLedger: traceLedger as unknown as Parameters<typeof verifyCheckoutReset>[0]["traceLedger"],
    registry: {
      verified: true,
      registryHash: String(boundary.manifestHash ?? ""),
      registeredToolNames: Array.isArray(boundary.registeredToolNames)
        ? boundary.registeredToolNames.map(String)
        : []
    },
    checkedAt: String(verification.checkedAt ?? "")
  });
  if (
    canonicalJson(recomputed) !== canonicalJson(verification) ||
    boundary.resetId !== verification.resetId
  ) {
    throw new Gate2CalibrationBundleError("reset_evidence_mismatch");
  }
  return { boundary, domainReceipt, traceLedger };
}

async function verifyRow(rowValue: unknown, ordinal: number, runId: string): Promise<boolean> {
  const row = objectValue(rowValue, "invalid_calibration_row");
  if (row.ordinal !== ordinal) throw new Gate2CalibrationBundleError("row_ordinal_mismatch");
  stringValue(row.jti, /^[A-Za-z0-9_-]{16,96}$/u, "invalid_row_jti");
  const evaluation = objectValue(row.evaluation, "invalid_evaluation");
  if (
    evaluation.ordinal !== ordinal ||
    evaluation.calibrationOnly !== true ||
    evaluation.includedInBenchmark !== false ||
    !Array.isArray(evaluation.failures)
  ) {
    throw new Gate2CalibrationBundleError("evaluation_contract_mismatch");
  }
  const passed = evaluation.passed === true;
  const score = objectValue(evaluation.score, "invalid_calibration_score");
  if (
    score.possible !== 1 ||
    score.earned !== (passed ? 1 : 0) ||
    passed !== (evaluation.failures.length === 0)
  ) {
    throw new Gate2CalibrationBundleError("calibration_score_mismatch");
  }

  const trial = objectValue(row.trialEvidence, "invalid_trial_evidence");
  const evidenceDigest = stringValue(
    trial.evidenceDigest,
    /^[a-f0-9]{64}$/u,
    "invalid_trial_digest"
  );
  const envelope = objectValue(trial.envelope, "invalid_trial_envelope");
  if (envelope.runId !== runId || envelope.purpose !== "calibration") {
    throw new Gate2CalibrationBundleError("trial_envelope_mismatch");
  }
  let transport;
  try {
    transport = await verifyProbeTransportBinding(envelope as unknown as ProbeCalibrationEnvelope);
  } catch {
    throw new Gate2CalibrationBundleError("trial_transport_binding_mismatch");
  }
  const capture = objectValue(trial.capture, "invalid_trial_capture");
  const claim = objectValue(capture.claim, "invalid_trial_claim");
  if (
    claim.runId !== envelope.runId ||
    claim.caseId !== envelope.caseId ||
    claim.trialId !== envelope.trialId
  ) {
    throw new Gate2CalibrationBundleError("trial_claim_mismatch");
  }
  const initialReset = await verifyResetBoundary(capture.initialBoundary);
  const verifiedPostReset = await verifyResetBoundary(trial.postResetBoundary);
  const postReset = verifiedPostReset.boundary;
  if (
    postReset.status !== "verified" ||
    postReset.stateRevision !== 0 ||
    postReset.operationLedgerCount !== 0 ||
    postReset.currentTrajectoryCount !== 0
  ) {
    throw new Gate2CalibrationBundleError("post_reset_mismatch");
  }
  if (
    initialReset.boundary.resetId === postReset.resetId ||
    verifiedPostReset.domainReceipt.archivedTrajectoryId !== initialReset.domainReceipt.trajectoryId
  ) {
    throw new Gate2CalibrationBundleError("reset_trajectory_mismatch");
  }
  const providerPublic = objectValue(trial.providerReceipt, "invalid_provider_receipt");
  const provider = objectValue(providerPublic.receipt, "invalid_provider_payload");
  if (
    provider.provider !== "OpenAI" ||
    provider.model !== "gpt-5.6-terra" ||
    provider.providerCallCount !== 1 ||
    provider.store !== false ||
    provider.previousResponseId !== null ||
    provider.conversationId !== null
  ) {
    throw new Gate2CalibrationBundleError("provider_contract_mismatch");
  }
  if (
    provider.transportBindingHash !== transport.bindingHash ||
    provider.requestBodyHash !== (await sha256Hex(String(provider.requestBodyBytes ?? ""))) ||
    provider.rawResponseHash !== (await sha256Hex(String(provider.rawResponseBytes ?? ""))) ||
    provider.usageHash !== (await canonicalSha256(provider.usage))
  ) {
    throw new Gate2CalibrationBundleError("provider_digest_mismatch");
  }

  if (
    trial.captureDigest !== (await canonicalSha256(capture)) ||
    capture.providerReceiptHash !== (await canonicalSha256(providerPublic)) ||
    capture.rawModelResponseHash !== (await sha256Hex(String(provider.rawResponseBytes ?? ""))) ||
    canonicalJson(capture.decision) !== canonicalJson(provider.decision)
  ) {
    throw new Gate2CalibrationBundleError("capture_digest_mismatch");
  }
  const nativeDispatchCount = capture.nativeDispatchCount;
  if (
    provider.decision &&
    typeof provider.decision === "object" &&
    !Array.isArray(provider.decision)
  ) {
    const decision = provider.decision as Record<string, unknown>;
    if (
      decision.kind === "call" &&
      ["cart_update", "checkout_request"].includes(String(decision.tool))
    ) {
      const argumentsValue = objectValue(decision.arguments, "invalid_mutation_arguments");
      if (argumentsValue.operationId !== transport.operationId) {
        throw new Gate2CalibrationBundleError("runner_owned_operation_id_mismatch");
      }
    }
  }
  const execution = capture.executionResult;
  const currentTraces = Array.isArray(trial.currentTraces) ? trial.currentTraces : [];
  if (currentTraces.length > 1) {
    throw new Gate2CalibrationBundleError("native_trace_count_mismatch");
  }
  if (
    currentTraces.some(
      (trace) =>
        objectValue(trace, "invalid_native_trace").runId !== initialReset.domainReceipt.trajectoryId
    )
  ) {
    throw new Gate2CalibrationBundleError("native_trace_trajectory_mismatch");
  }
  if (nativeDispatchCount === 1) {
    const admission = objectValue(trial.nativeAdmission, "native_admission_missing");
    const admissionPayload = objectValue(admission.payload, "invalid_native_admission");
    stringValue(admission.payloadBinding, /^[a-f0-9]{64}$/u, "invalid_admission_binding");
    if (
      admission.status !== "verified" ||
      admission.jti !== row.jti ||
      admissionPayload.version !== 1 ||
      admissionPayload.envelopeHash !== (await canonicalSha256(envelope)) ||
      admissionPayload.decisionHash !== (await canonicalSha256(provider.decision)) ||
      admissionPayload.initialBoundaryHash !==
        (await canonicalSha256(admissionPayload.initialBoundary)) ||
      typeof admissionPayload.claimsHash !== "string" ||
      !/^[a-f0-9]{64}$/u.test(admissionPayload.claimsHash)
    ) {
      throw new Gate2CalibrationBundleError("native_admission_mismatch");
    }
    if (execution === null) {
      const errors = objectValue(capture.errors, "invalid_trial_errors");
      const executionError = objectValue(errors.execution, "missing_native_failure");
      if (
        executionError.code !== "native_allowance_already_consumed" &&
        canonicalJson(admissionPayload.initialBoundary) !== canonicalJson(capture.initialBoundary)
      ) {
        throw new Gate2CalibrationBundleError("native_admission_boundary_mismatch");
      }
      if (currentTraces.length === 1) {
        const trace = objectValue(currentTraces[0], "invalid_native_trace");
        await Promise.all([
          verifyCanonicalEvidence(trace.rawArguments),
          ...(trace.canonicalArguments ? [verifyCanonicalEvidence(trace.canonicalArguments)] : []),
          ...(trace.rawResult ? [verifyCanonicalEvidence(trace.rawResult)] : []),
          ...(trace.canonicalResult ? [verifyCanonicalEvidence(trace.canonicalResult)] : []),
          ...(trace.error ? [verifyCanonicalEvidence(trace.error)] : []),
          verifyCanonicalEvidence(trace.stateBefore),
          verifyCanonicalEvidence(trace.stateAfter)
        ]);
        if (trace.source !== "native") {
          throw new Gate2CalibrationBundleError("native_trace_binding_mismatch");
        }
      }
    } else {
      if (
        canonicalJson(admissionPayload.initialBoundary) !== canonicalJson(capture.initialBoundary)
      ) {
        throw new Gate2CalibrationBundleError("native_admission_boundary_mismatch");
      }
      const executionObject = objectValue(execution, "invalid_native_execution");
      const receipt = objectValue(executionObject.receipt, "invalid_native_receipt");
      const trace = objectValue(executionObject.trace, "invalid_native_trace");
      if (currentTraces.length !== 1 || canonicalJson(currentTraces[0]) !== canonicalJson(trace)) {
        throw new Gate2CalibrationBundleError("native_trace_count_mismatch");
      }
      await Promise.all([
        verifyCanonicalEvidence(trace.rawArguments),
        verifyCanonicalEvidence(trace.canonicalArguments),
        verifyCanonicalEvidence(trace.rawResult),
        verifyCanonicalEvidence(trace.canonicalResult),
        verifyCanonicalEvidence(trace.stateBefore),
        verifyCanonicalEvidence(trace.stateAfter)
      ]);
      if (
        trace.source !== "native" ||
        receipt.nativeCallCount !== 1 ||
        receipt.handlerTraceId !== trace.eventId ||
        receipt.resultDigest !== objectValue(trace.canonicalResult, "invalid_result").sha256 ||
        receipt.stateBeforeDigest !== objectValue(trace.stateBefore, "invalid_state").sha256 ||
        receipt.stateAfterDigest !== objectValue(trace.stateAfter, "invalid_state").sha256 ||
        receipt.effectDigest !== (await canonicalSha256(trace.effect))
      ) {
        throw new Gate2CalibrationBundleError("native_trace_binding_mismatch");
      }
    }
  } else if (nativeDispatchCount !== 0 || execution !== null || trial.nativeAdmission !== null) {
    throw new Gate2CalibrationBundleError("native_dispatch_mismatch");
  }

  const baseEvidence = Object.fromEntries(
    Object.entries(trial).filter(
      ([key]) =>
        ![
          "postResetBoundary",
          "providerReceipt",
          "nativeAdmission",
          "envelope",
          "evidenceDigest"
        ].includes(key)
    )
  );
  const recomputedTrialDigest = await canonicalSha256({
    evidence: baseEvidence,
    postResetBoundary: trial.postResetBoundary,
    providerReceipt: trial.providerReceipt,
    nativeAdmission: trial.nativeAdmission,
    envelopeHash: await canonicalSha256(envelope)
  });
  if (evidenceDigest !== recomputedTrialDigest) {
    throw new Gate2CalibrationBundleError("trial_digest_mismatch");
  }

  const settlement = objectValue(row.settlement, "invalid_settlement");
  const usage = objectValue(provider.usage, "invalid_provider_usage");
  if (
    settlement.providerResponseHash !== provider.rawResponseHash ||
    settlement.usageHash !== provider.usageHash ||
    settlement.accountedNanoUsd !== usage.accountedNanoUsd ||
    settlement.costBasis !== "frozen-list-price-plus-10pct-uplift" ||
    settlement.provider !== "OpenAI" ||
    settlement.model !== "gpt-5.6-terra"
  ) {
    throw new Gate2CalibrationBundleError("settlement_mismatch");
  }
  const expectedSettlementDigest = await canonicalSha256({
    version: 1,
    jti: row.jti,
    providerResponseHash: provider.rawResponseHash,
    usageHash: provider.usageHash,
    trialEvidenceDigest: trial.evidenceDigest,
    evaluation
  });
  if (settlement.settlementDigest !== expectedSettlementDigest) {
    throw new Gate2CalibrationBundleError("settlement_digest_mismatch");
  }
  return passed;
}

export async function verifyGate2CalibrationBundle(
  value: unknown
): Promise<VerifiedGate2CalibrationBundle> {
  const bundle = objectValue(value, "invalid_gate2_bundle");
  if (
    bundle.version !== GATE2_CALIBRATION_BUNDLE_VERSION ||
    bundle.protocolVersion !== PROBE_CALIBRATION_PROTOCOL_VERSION ||
    bundle.attempt !== PROBE_CALIBRATION_ATTEMPT ||
    bundle.lane !== GATE2_CALIBRATION_LANE ||
    bundle.calibrationOnly !== true ||
    bundle.includedInBenchmark !== false ||
    bundle.provider !== "OpenAI" ||
    bundle.model !== "gpt-5.6-terra" ||
    bundle.caseCount !== PROBE_CALIBRATION_ATTEMPT_CASE_COUNT ||
    !Array.isArray(bundle.cases) ||
    bundle.cases.length !== PROBE_CALIBRATION_ATTEMPT_CASE_COUNT
  ) {
    throw new Gate2CalibrationBundleError("gate2_bundle_contract_mismatch");
  }
  exactJson(
    bundle.attemptScope,
    {
      designation: "separate-versioned-third-final-preferred-attempt",
      baseCalibrationCalls: PROBE_CALIBRATION_BASE_CALLS,
      terminalCalibrationCalls: PROBE_CALIBRATION_TERMINAL_CALLS,
      caseCount: PROBE_CALIBRATION_ATTEMPT_CASE_COUNT,
      priorAttemptsMerged: false
    },
    "attempt_scope_mismatch"
  );
  const migration = await verifyPolicyMigration(bundle.policyMigration);
  verifyGate2PriorAttemptsLineage(bundle.priorAttempts, migration);
  if (
    bundle.policyHash !== migration.nextPolicyHash ||
    bundle.ledgerScriptHash !== migration.nextScriptHash ||
    bundle.appCommit !== migration.migrationCommit
  ) {
    throw new Gate2CalibrationBundleError("active_migration_binding_mismatch");
  }
  const runId = stringValue(bundle.runId, /^run_[A-Za-z0-9_-]{22}$/u, "invalid_run_id");
  if (runId === GATE2_ATTEMPT_1_LINEAGE.runId) {
    throw new Gate2CalibrationBundleError("attempt_run_identity_reused");
  }
  stringValue(bundle.appCommit, /^[a-f0-9]{40}$/u, "invalid_app_commit");
  stringValue(
    bundle.completedAt,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
    "invalid_completed_at"
  );
  const jtis = bundle.cases.map((row) =>
    stringValue(
      objectValue(row, "invalid_calibration_row").jti,
      /^[A-Za-z0-9_-]{16,96}$/u,
      "invalid_row_jti"
    )
  );
  if (new Set(jtis).size !== PROBE_CALIBRATION_ATTEMPT_CASE_COUNT) {
    throw new Gate2CalibrationBundleError("duplicate_row_jti");
  }
  const priorJtis = new Set(migration.knownCalls.map(({ jti }) => jti));
  if (jtis.some((jti) => priorJtis.has(jti))) {
    throw new Gate2CalibrationBundleError("cross_attempt_jti_reused");
  }
  const traceIds = bundle.cases.flatMap((row) => {
    const trial = objectValue(
      objectValue(row, "invalid_calibration_row").trialEvidence,
      "invalid_trial_evidence"
    );
    const traces = Array.isArray(trial.currentTraces) ? trial.currentTraces : [];
    return traces.map((trace) =>
      stringValue(
        objectValue(trace, "invalid_native_trace").eventId,
        /^[A-Za-z0-9_-]{16,96}$/u,
        "invalid_trace_event_id"
      )
    );
  });
  if (new Set(traceIds).size !== traceIds.length) {
    throw new Gate2CalibrationBundleError("duplicate_trace_event_id");
  }
  const attemptResponseHashes = bundle.cases.map((row) => {
    const trial = objectValue(
      objectValue(row, "invalid_calibration_row").trialEvidence,
      "invalid_trial_evidence"
    );
    const provider = objectValue(
      objectValue(trial.providerReceipt, "invalid_provider_receipt").receipt,
      "invalid_provider_payload"
    );
    return stringValue(
      provider.rawResponseHash,
      /^[a-f0-9]{64}$/u,
      "invalid_provider_response_hash"
    );
  });
  const priorResponseHashes = new Set(
    migration.knownCalls.map(({ providerResponseHash }) => providerResponseHash)
  );
  if (
    new Set(attemptResponseHashes).size !== PROBE_CALIBRATION_ATTEMPT_CASE_COUNT ||
    attemptResponseHashes.some((hash) => priorResponseHashes.has(hash))
  ) {
    throw new Gate2CalibrationBundleError("cross_attempt_provider_response_reused");
  }
  const passed = await Promise.all(
    bundle.cases.map((row, ordinal) => verifyRow(row, ordinal, runId))
  );
  if (bundle.passedCount !== passed.filter(Boolean).length) {
    throw new Gate2CalibrationBundleError("passed_count_mismatch");
  }
  const terminalGuard = objectValue(bundle.terminalGuard, "invalid_terminal_guard");
  const priorAttempts = createGate2PriorAttemptsLineage(migration);
  const priorCumulativeKnownAccountedNanoUsd = priorAttempts.cumulative.knownAccountedNanoUsd;
  const attemptAccountedNanoUsd = bundle.cases.reduce((total, row) => {
    const settlement = objectValue(
      objectValue(row, "invalid_calibration_row").settlement,
      "invalid_settlement"
    );
    return total + Number(settlement.accountedNanoUsd ?? Number.NaN);
  }, 0);
  if (
    terminalGuard.phase !== "idle" ||
    terminalGuard.claimedCalls !== PROBE_CALIBRATION_TERMINAL_CALLS ||
    terminalGuard.knownCalls !== PROBE_CALIBRATION_TERMINAL_CALLS ||
    terminalGuard.pendingCalls !== 0 ||
    terminalGuard.uncertainCalls !== 0 ||
    terminalGuard.calibrationCalls !== PROBE_CALIBRATION_TERMINAL_CALLS ||
    terminalGuard.committedNanoUsd !==
      PROBE_CALIBRATION_TERMINAL_CALLS * PROBE_PER_CALL_RESERVATION_NANO_USD ||
    terminalGuard.knownAccountedNanoUsd !==
      priorCumulativeKnownAccountedNanoUsd + attemptAccountedNanoUsd
  ) {
    throw new Gate2CalibrationBundleError("terminal_guard_mismatch");
  }
  const cost = objectValue(bundle.attemptCost, "invalid_attempt_cost_reconciliation");
  const priorCumulativeCost = Number(cost.priorCumulativeKnownAccountedNanoUsd ?? Number.NaN);
  const reportedAttemptCost = Number(cost.attemptAccountedNanoUsd ?? Number.NaN);
  const terminalCumulativeCost = Number(cost.terminalCumulativeKnownAccountedNanoUsd ?? Number.NaN);
  if (
    cost.version !== GATE2_ATTEMPT_COST_RECONCILIATION_VERSION ||
    ![priorCumulativeCost, reportedAttemptCost, terminalCumulativeCost].every(
      (value) => Number.isSafeInteger(value) && value >= 0
    ) ||
    priorCumulativeCost !== priorCumulativeKnownAccountedNanoUsd ||
    reportedAttemptCost !== attemptAccountedNanoUsd ||
    terminalCumulativeCost !== terminalGuard.knownAccountedNanoUsd ||
    terminalCumulativeCost - priorCumulativeCost !== reportedAttemptCost
  ) {
    throw new Gate2CalibrationBundleError("attempt_cost_reconciliation_mismatch");
  }
  const evidenceDigest = stringValue(
    bundle.evidenceDigest,
    /^[a-f0-9]{64}$/u,
    "invalid_evidence_digest"
  );
  const unsigned = Object.fromEntries(
    Object.entries(bundle).filter(([key]) => key !== "evidenceDigest")
  );
  if (evidenceDigest !== (await canonicalSha256(unsigned))) {
    throw new Gate2CalibrationBundleError("evidence_digest_mismatch");
  }
  return bundle as unknown as VerifiedGate2CalibrationBundle;
}
