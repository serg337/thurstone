import { canonicalJson } from "@/lib/evidence/digest";

export const GATE2_RETAINED_ATTEMPT_LINEAGE_VERSION =
  "toolproof-gate2-retained-attempt-lineage@1.0.0";
export const GATE2_PRIOR_ATTEMPTS_LINEAGE_VERSION = "toolproof-gate2-prior-attempts-lineage@1.0.0";
export const GATE2_ATTEMPT_2_LINEAGE_VERSION =
  "toolproof-gate2-invalid-infrastructure-lineage@1.0.0";
export const GATE2_ATTEMPT_1_KNOWN_ACCOUNTED_NANO_USD = 11_360_800 as const;

export const GATE2_ATTEMPT_1_LINEAGE = Object.freeze({
  version: GATE2_RETAINED_ATTEMPT_LINEAGE_VERSION,
  attempt: 1 as const,
  disposition: "retained-authentic-failure" as const,
  calibrationOnly: true as const,
  includedInBenchmark: false as const,
  rawSha256: "4832959832a45379a82c23a8d08712e7cdc78f2a07e621467ca8f3cd76d9756b",
  evidenceDigest: "016f607f498384bcac2d60474aaa3f3373635cd662bb2eb4d7bb71b0b223b863",
  appCommit: "64c3095a1098de30ac266ed2344873da6545875a",
  runId: "run_tOYy-NQLgCCS2YJ8l2DQ4Q",
  caseCount: 4 as const,
  passedCount: 0 as const,
  nativeDispatchCount: 0 as const,
  knownAccountedNanoUsd: GATE2_ATTEMPT_1_KNOWN_ACCOUNTED_NANO_USD
});

export const GATE2_ATTEMPT_2_APP_COMMIT = "191f7885eeb062de4bfe4effd9468ef648aef600" as const;
export const GATE2_ATTEMPT_2_ACTIVATION_HASH =
  "41f8363c74f7b277c239689194069d80749d3f33342779662009f8c47e5348d6" as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const OPAQUE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const ATTEMPT_2_KNOWN_CALL_ORDINAL = 4;
const PRIOR_KNOWN_CALL_COUNT = 5;

export interface Gate2PriorKnownCall {
  readonly ordinal: number;
  readonly jti: string;
  readonly dispatchSequence: number;
  readonly actualNanoUsd: number;
  readonly providerResponseHash: string;
  readonly settlementDigest: string;
  readonly usageHash: string;
}

export interface Gate2PriorMigrationLineageSource {
  readonly preserved: {
    readonly knownActualNanoUsd: number;
  };
  readonly knownCalls: readonly Gate2PriorKnownCall[];
}

export interface Gate2Attempt2Lineage {
  readonly version: typeof GATE2_ATTEMPT_2_LINEAGE_VERSION;
  readonly attempt: 2;
  readonly disposition: "terminal-invalid-infrastructure";
  readonly calibrationOnly: true;
  readonly includedInBenchmark: false;
  readonly appCommit: typeof GATE2_ATTEMPT_2_APP_COMMIT;
  readonly activationHash: typeof GATE2_ATTEMPT_2_ACTIVATION_HASH;
  readonly protocolVersion: "toolproof-probe-calibration-attempt-2@1.0.0";
  readonly plannedCaseCount: 4;
  readonly baseCalibrationCalls: 4;
  readonly observedCumulativeCalibrationCalls: 5;
  readonly knownProviderCallCount: 1;
  readonly retainedSemanticRowCount: 0;
  readonly nativeDispatchCount: null;
  readonly runId: null;
  readonly rawSha256: null;
  readonly evidenceDigest: null;
  readonly score: null;
  readonly failure: {
    readonly code: "probe_session_marker_missing";
    readonly recoveryArtifact: "completion_cache_expired";
    readonly semanticOutcomeInspected: false;
    readonly reconstructionPermitted: false;
  };
  readonly durableCall: Gate2PriorKnownCall;
  readonly knownAccountedNanoUsd: number;
}

export interface Gate2PriorAttemptsLineage {
  readonly version: typeof GATE2_PRIOR_ATTEMPTS_LINEAGE_VERSION;
  readonly mergedIntoCurrentAttempt: false;
  readonly attempt1: typeof GATE2_ATTEMPT_1_LINEAGE;
  readonly attempt2: Gate2Attempt2Lineage;
  readonly cumulative: {
    readonly knownProviderCallCount: 5;
    readonly retainedSemanticRowCount: 4;
    readonly unavailableSemanticRowCount: 1;
    readonly knownAccountedNanoUsd: number;
  };
}

export class Gate2AttemptLineageError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "Gate2AttemptLineageError";
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

function validKnownCall(call: Gate2PriorKnownCall, ordinal: number): boolean {
  return (
    call.ordinal === ordinal &&
    call.dispatchSequence === ordinal + 1 &&
    OPAQUE_PATTERN.test(call.jti) &&
    Number.isSafeInteger(call.actualNanoUsd) &&
    call.actualNanoUsd >= 0 &&
    SHA256_PATTERN.test(call.providerResponseHash) &&
    SHA256_PATTERN.test(call.settlementDigest) &&
    SHA256_PATTERN.test(call.usageHash)
  );
}

export function createGate2PriorAttemptsLineage(
  source: Gate2PriorMigrationLineageSource
): Gate2PriorAttemptsLineage {
  if (
    !Array.isArray(source.knownCalls) ||
    source.knownCalls.length !== PRIOR_KNOWN_CALL_COUNT ||
    !Number.isSafeInteger(source.preserved.knownActualNanoUsd) ||
    source.preserved.knownActualNanoUsd < 0
  ) {
    throw new Gate2AttemptLineageError("invalid_prior_attempt_migration_source");
  }
  const jtis = new Set<string>();
  const providerResponses = new Set<string>();
  let cumulativeCost = 0;
  for (const [ordinal, call] of source.knownCalls.entries()) {
    if (
      !validKnownCall(call, ordinal) ||
      jtis.has(call.jti) ||
      providerResponses.has(call.providerResponseHash)
    ) {
      throw new Gate2AttemptLineageError("invalid_prior_attempt_known_call");
    }
    jtis.add(call.jti);
    providerResponses.add(call.providerResponseHash);
    cumulativeCost += call.actualNanoUsd;
  }
  const attempt1Cost = source.knownCalls
    .slice(0, ATTEMPT_2_KNOWN_CALL_ORDINAL)
    .reduce((sum, call) => sum + call.actualNanoUsd, 0);
  if (
    attempt1Cost !== GATE2_ATTEMPT_1_KNOWN_ACCOUNTED_NANO_USD ||
    cumulativeCost !== source.preserved.knownActualNanoUsd
  ) {
    throw new Gate2AttemptLineageError("prior_attempt_cost_mismatch");
  }
  const durableCall = source.knownCalls[ATTEMPT_2_KNOWN_CALL_ORDINAL];
  if (!durableCall) throw new Gate2AttemptLineageError("attempt_2_call_missing");

  return deepFreeze({
    version: GATE2_PRIOR_ATTEMPTS_LINEAGE_VERSION,
    mergedIntoCurrentAttempt: false,
    attempt1: GATE2_ATTEMPT_1_LINEAGE,
    attempt2: {
      version: GATE2_ATTEMPT_2_LINEAGE_VERSION,
      attempt: 2,
      disposition: "terminal-invalid-infrastructure",
      calibrationOnly: true,
      includedInBenchmark: false,
      appCommit: GATE2_ATTEMPT_2_APP_COMMIT,
      activationHash: GATE2_ATTEMPT_2_ACTIVATION_HASH,
      protocolVersion: "toolproof-probe-calibration-attempt-2@1.0.0",
      plannedCaseCount: 4,
      baseCalibrationCalls: 4,
      observedCumulativeCalibrationCalls: 5,
      knownProviderCallCount: 1,
      retainedSemanticRowCount: 0,
      nativeDispatchCount: null,
      runId: null,
      rawSha256: null,
      evidenceDigest: null,
      score: null,
      failure: {
        code: "probe_session_marker_missing",
        recoveryArtifact: "completion_cache_expired",
        semanticOutcomeInspected: false,
        reconstructionPermitted: false
      },
      durableCall: { ...durableCall },
      knownAccountedNanoUsd: durableCall.actualNanoUsd
    },
    cumulative: {
      knownProviderCallCount: 5,
      retainedSemanticRowCount: 4,
      unavailableSemanticRowCount: 1,
      knownAccountedNanoUsd: source.preserved.knownActualNanoUsd
    }
  });
}

export function verifyGate2PriorAttemptsLineage(
  value: unknown,
  source: Gate2PriorMigrationLineageSource
): Gate2PriorAttemptsLineage {
  const expected = createGate2PriorAttemptsLineage(source);
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new Gate2AttemptLineageError("prior_attempts_lineage_mismatch");
  }
  return expected;
}
