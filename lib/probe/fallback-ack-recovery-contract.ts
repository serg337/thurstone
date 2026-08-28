import { canonicalSha256 } from "@/lib/evidence/digest";

export const PROBE_FALLBACK_ACK_RECOVERY_VERSION = "toolproof-fallback-ack-recovery@1.0.0";
export const PROBE_FALLBACK_ACK_RECOVERY_CONFIRMATION_VERSION =
  "toolproof-fallback-ack-recovery-confirmation@1.0.0";

export const PROBE_FALLBACK_ACK_RECOVERY_PROJECT_ID = "prj_giQhynM5Q7QjJ1ZzjrS3Zv8H3M1r";
export const PROBE_FALLBACK_ACK_RECOVERY_TARGET_ACTIVATION_HASH =
  "842c355e6b783b838727376e35c63fc7d0bab9eda112a49c8136e6ef752e4950";
export const PROBE_FALLBACK_ACK_RECOVERY_TARGET_APP_COMMIT =
  "42f65f0345adca88b83b2e8c612c7914f8fbbaba";
export const PROBE_FALLBACK_ACK_RECOVERY_TARGET_RUN_ID = "run_rYOrmuUtrnjts9wqPm8alA";
export const PROBE_FALLBACK_ACK_RECOVERY_EVIDENCE_DIGEST =
  "43bf61e6bceccdf80e561da3a596ce758016ec6a4b2ed53502136a6a6303c3fb";
export const PROBE_FALLBACK_ACK_RECOVERY_RAW_EVIDENCE_SHA256 =
  "cbc359472f18f8c240480562905507806ea2db45d84ba8f247714a097d05814c";

export const PROBE_FALLBACK_ACK_RECOVERY_GUARD = Object.freeze({
  guardInstanceId: "guard_3323051706a8384028e97a60f0c0b868",
  initializedCommit: "86584fe4fa308980bfb7d60f9722cc8b49b78644",
  policyVersion: "toolproof-probe-policy@0.4.0",
  policyHash: "4c70f123b0e3bc9b31477e976e51604e570e1475ef1d315a21615553e0be2b77",
  ledgerScriptHash: "c25d90f7e060662867925e83c6d33dc7636f22b18cbcd94c3ffc6880eb907779",
  runnerContractHash: "ccdb4f578a37cf0b774c195a855c3d2fa3352fbd5ccdbee3b89eb1c5d5185ecc",
  continuationScriptHash: "f3b6402b933da2372dda644ebb82e2b600c6b5b62b5e2f3615e642be30310f05",
  claimedCalls: 13,
  knownCalls: 13,
  pendingCalls: 0,
  uncertainCalls: 0,
  inflightCalls: 0,
  committedNanoUsd: 812_500_000,
  knownActualNanoUsd: 42_165_200,
  uncertainUpperNanoUsd: 0,
  sequence: 13,
  purposeLimits: Object.freeze({ calibration: 13, baseline: 72, repair: 2, revised: 72, judge: 1 }),
  purposeCounts: Object.freeze({ calibration: 13, baseline: 0, repair: 0, revised: 0, judge: 0 })
});

export const PROBE_FALLBACK_ACK_RECOVERY_MIGRATION = Object.freeze({
  version: "toolproof-probe-policy-migration-v04@1.0.0",
  migrationId: "migration_gate2_googlechromelabs_fallback_1",
  migrationDigest: "607666ccb962f0c795efc9aa7fc69718abc3cc82313d3797b0b8d10b81773ba4",
  receiptHash: "bb60398c7f803c19845c5f05d9e70d88784f9a11ca8cd33e7f7d1dfd0b91b9c1",
  predecessorMigrationId: "migration_gate2_calibration_attempt_3",
  predecessorReceiptHash: "6f63c8879535b7b3a5a3edf7c908fdd1783057fccd134b03df78e2573a1462e6",
  priorAppCommit: "2ca1f277b27b727c4a336b83b12bca77be1cc938",
  priorActivationHash: "9321638a281240419d3eebdd056733b2e91b1633db5d1245e135dc28490b2beb",
  migrationCommit: PROBE_FALLBACK_ACK_RECOVERY_TARGET_APP_COMMIT,
  migrationProgramHash: "63b192b247399e710334caaed8766f78dd1c9fd73cf65f148d8e81d63a62cf59"
});

export interface ProbeFallbackAckRecoveryConfirmationInput {
  readonly repairCommit: string;
  readonly programHash: string;
  readonly terminalPayloadBinding: string;
  readonly guardSnapshotDigest: string;
  readonly runIdentityDigest: string;
}

export async function probeFallbackAckRecoveryConfirmation(
  input: ProbeFallbackAckRecoveryConfirmationInput
): Promise<string> {
  return canonicalSha256({
    version: PROBE_FALLBACK_ACK_RECOVERY_CONFIRMATION_VERSION,
    repairCommit: input.repairCommit,
    projectId: PROBE_FALLBACK_ACK_RECOVERY_PROJECT_ID,
    targetActivationHash: PROBE_FALLBACK_ACK_RECOVERY_TARGET_ACTIVATION_HASH,
    targetAppCommit: PROBE_FALLBACK_ACK_RECOVERY_TARGET_APP_COMMIT,
    targetRunId: PROBE_FALLBACK_ACK_RECOVERY_TARGET_RUN_ID,
    evidenceDigest: PROBE_FALLBACK_ACK_RECOVERY_EVIDENCE_DIGEST,
    rawEvidenceSha256: PROBE_FALLBACK_ACK_RECOVERY_RAW_EVIDENCE_SHA256,
    terminalPayloadBinding: input.terminalPayloadBinding,
    guardSnapshotDigest: input.guardSnapshotDigest,
    runIdentityDigest: input.runIdentityDigest,
    migrationReceiptHash: PROBE_FALLBACK_ACK_RECOVERY_MIGRATION.receiptHash,
    migrationDigest: PROBE_FALLBACK_ACK_RECOVERY_MIGRATION.migrationDigest,
    programHash: input.programHash
  });
}
