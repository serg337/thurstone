import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import { verifyCheckoutReset } from "@/lib/domain/checkout-reset";

export const GATE2_CALIBRATION_BUNDLE_VERSION = "toolproof-gate2-calibration-evidence@1.0.0";

export interface VerifiedGate2CalibrationBundle {
  readonly version: typeof GATE2_CALIBRATION_BUNDLE_VERSION;
  readonly lane: "custom-probe-calibration";
  readonly calibrationOnly: true;
  readonly includedInBenchmark: false;
  readonly appCommit: string;
  readonly caseCount: 4;
  readonly passedCount: number;
  readonly cases: readonly Record<string, unknown>[];
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
    bundle.lane !== "custom-probe-calibration" ||
    bundle.calibrationOnly !== true ||
    bundle.includedInBenchmark !== false ||
    bundle.provider !== "OpenAI" ||
    bundle.model !== "gpt-5.6-terra" ||
    bundle.caseCount !== 4 ||
    !Array.isArray(bundle.cases) ||
    bundle.cases.length !== 4
  ) {
    throw new Gate2CalibrationBundleError("gate2_bundle_contract_mismatch");
  }
  const runId = stringValue(bundle.runId, /^run_[A-Za-z0-9_-]{22}$/u, "invalid_run_id");
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
  if (new Set(jtis).size !== 4) {
    throw new Gate2CalibrationBundleError("duplicate_row_jti");
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
  const passed = await Promise.all(
    bundle.cases.map((row, ordinal) => verifyRow(row, ordinal, runId))
  );
  if (bundle.passedCount !== passed.filter(Boolean).length) {
    throw new Gate2CalibrationBundleError("passed_count_mismatch");
  }
  const terminalGuard = objectValue(bundle.terminalGuard, "invalid_terminal_guard");
  const accountedNanoUsd = bundle.cases.reduce((total, row) => {
    const settlement = objectValue(
      objectValue(row, "invalid_calibration_row").settlement,
      "invalid_settlement"
    );
    return total + Number(settlement.accountedNanoUsd ?? Number.NaN);
  }, 0);
  if (
    terminalGuard.phase !== "idle" ||
    terminalGuard.claimedCalls !== 4 ||
    terminalGuard.knownCalls !== 4 ||
    terminalGuard.pendingCalls !== 0 ||
    terminalGuard.uncertainCalls !== 0 ||
    terminalGuard.calibrationCalls !== 4 ||
    terminalGuard.committedNanoUsd !== 250_000_000 ||
    terminalGuard.knownAccountedNanoUsd !== accountedNanoUsd
  ) {
    throw new Gate2CalibrationBundleError("terminal_guard_mismatch");
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
