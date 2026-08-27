import "server-only";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  GATE2_ATTEMPT_1_LINEAGE,
  verifyGate2CalibrationBundle,
  type VerifiedGate2CalibrationBundle
} from "@/lib/evidence/gate2-calibration-bundle";
import type { OperationTrace } from "@/lib/evidence/operation-trace";
import {
  evaluateProbeCalibrationCase,
  type ProbeNativeExecutionObservation,
  type ProbeResetBoundaryObservation
} from "@/lib/probe/calibration-catalog.server";
import type { ProbeDecision } from "@/lib/probe/decision";

function objectValue(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function resetProjection(value: unknown): ProbeResetBoundaryObservation {
  const boundary = objectValue(value, "invalid_reset_boundary");
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

export async function verifyGate2CalibrationBundleServer(
  value: unknown
): Promise<VerifiedGate2CalibrationBundle> {
  const bundle = await verifyGate2CalibrationBundle(value);
  if (canonicalJson(bundle.priorAttempt) !== canonicalJson(GATE2_ATTEMPT_1_LINEAGE)) {
    throw new Error("server_prior_attempt_lineage_mismatch");
  }
  const migration = objectValue(bundle.policyMigration, "invalid_policy_migration");
  if (
    migration.priorEvidenceDigest !== GATE2_ATTEMPT_1_LINEAGE.evidenceDigest ||
    migration.nextPolicyHash !== bundle.policyHash ||
    migration.nextScriptHash !== bundle.ledgerScriptHash ||
    migration.migrationCommit !== bundle.appCommit
  ) {
    throw new Error("server_policy_migration_mismatch");
  }
  for (const [ordinal, row] of bundle.cases.entries()) {
    const trial = objectValue(row.trialEvidence, "invalid_trial_evidence");
    const capture = objectValue(trial.capture, "invalid_trial_capture");
    const provider = objectValue(
      objectValue(trial.providerReceipt, "invalid_provider_receipt").receipt,
      "invalid_provider_payload"
    );
    const traces = Array.isArray(trial.currentTraces) ? trial.currentTraces : [];
    const trace = (traces[0] ?? null) as OperationTrace | null;
    const execution =
      capture.executionResult === null
        ? null
        : objectValue(capture.executionResult, "invalid_execution_result");
    const receipt = execution ? objectValue(execution.receipt, "invalid_native_receipt") : null;
    const nativeExecution: ProbeNativeExecutionObservation | null = receipt
      ? {
          toolName: String(receipt.toolName ?? ""),
          nativeCallCount: Number(receipt.nativeCallCount ?? -1),
          handlerTraceId:
            typeof receipt.handlerTraceId === "string" ? receipt.handlerTraceId : null,
          resultDigest: typeof receipt.resultDigest === "string" ? receipt.resultDigest : null,
          effectDigest: typeof receipt.effectDigest === "string" ? receipt.effectDigest : null,
          stateBeforeDigest:
            typeof receipt.stateBeforeDigest === "string" ? receipt.stateBeforeDigest : null,
          stateAfterDigest:
            typeof receipt.stateAfterDigest === "string" ? receipt.stateAfterDigest : null
        }
      : null;
    const evaluation = await evaluateProbeCalibrationCase(ordinal, {
      decision: (provider.decision ?? null) as ProbeDecision | null,
      decisionError: typeof provider.decisionError === "string" ? provider.decisionError : null,
      nativeDispatchCount: Number(capture.nativeDispatchCount ?? -1),
      nativeExecution,
      trace,
      resetBefore: resetProjection(capture.initialBoundary),
      resetAfter: resetProjection(trial.postResetBoundary)
    });
    if (canonicalJson(evaluation) !== canonicalJson(row.evaluation)) {
      throw new Error("server_evaluation_mismatch");
    }
    const settlement = objectValue(row.settlement, "invalid_settlement");
    const expectedSettlementDigest = await canonicalSha256({
      version: 1,
      jti: row.jti,
      providerResponseHash: provider.rawResponseHash,
      usageHash: provider.usageHash,
      trialEvidenceDigest: trial.evidenceDigest,
      evaluation
    });
    if (settlement.settlementDigest !== expectedSettlementDigest) {
      throw new Error("server_settlement_mismatch");
    }
  }
  return bundle;
}
