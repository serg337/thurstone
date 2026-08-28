import "server-only";

import {
  createProbeRedis,
  probeLedgerScriptHash,
  readProbeGuardStatus,
  type ProbeGuardIdentity,
  type ProbeGuardStatus,
  type ProbeRedisClient
} from "@/lib/probe/ledger";
import { probePolicyHash } from "@/lib/probe/policy";
import {
  PROBE_GLOBAL_CALL_LIMIT,
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
  PROBE_MAX_CONCURRENCY,
  PROBE_MODEL,
  PROBE_PER_CALL_RESERVATION_NANO_USD,
  PROBE_POLICY_VERSION,
  PROBE_PURPOSE_CALL_LIMITS
} from "@/lib/probe/policy";
import { isProbeGuardStatusConsistent } from "@/lib/probe/status";
import type { ScoredPredecessorDisposition } from "@/lib/scored/session.server";

type EnvironmentLike = Readonly<Record<string, string | undefined>>;

export interface ScoredGuardContext {
  readonly redis: ProbeRedisClient;
  readonly identity: ProbeGuardIdentity;
  readonly status: ProbeGuardStatus;
}

export class ScoredGuardError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ScoredGuardError";
  }
}

export async function readScoredGuardContext(
  environment: EnvironmentLike = process.env,
  options: { readonly allowUnsettled?: boolean } = {}
): Promise<ScoredGuardContext> {
  const redis = createProbeRedis(environment as NodeJS.ProcessEnv);
  const [status, policyHash, scriptHash] = await Promise.all([
    readProbeGuardStatus(redis),
    probePolicyHash(),
    probeLedgerScriptHash()
  ]);
  const identity: ProbeGuardIdentity = {
    guardInstanceId: environment.TOOLPROOF_GUARD_INSTANCE_ID ?? "",
    policyHash,
    scriptHash,
    initializedCommit: environment.TOOLPROOF_GUARD_INITIALIZED_COMMIT ?? ""
  };
  const staticIdentityValid =
    status.status === "open" &&
    status.guardInstanceId === identity.guardInstanceId &&
    status.policyHash === identity.policyHash &&
    status.scriptHash === identity.scriptHash &&
    status.initializedCommit === identity.initializedCommit &&
    status.policyVersion === PROBE_POLICY_VERSION &&
    status.model === PROBE_MODEL &&
    status.globalCallLimit === PROBE_GLOBAL_CALL_LIMIT &&
    status.spendCeilingNanoUsd === PROBE_LIFETIME_SPEND_CEILING_NANO_USD &&
    status.perCallReservationNanoUsd === PROBE_PER_CALL_RESERVATION_NANO_USD &&
    status.maxConcurrency === PROBE_MAX_CONCURRENCY &&
    Object.entries(PROBE_PURPOSE_CALL_LIMITS).every(
      ([purpose, limit]) =>
        status.purposeLimits[purpose as keyof typeof PROBE_PURPOSE_CALL_LIMITS] === limit
    ) &&
    Object.values(status.purposeCounts).reduce((sum, count) => sum + count, 0) ===
      status.claimedCalls &&
    status.pendingCount + status.knownCount + status.uncertainCount === status.claimedCalls &&
    status.committedNanoUsd === status.claimedCalls * PROBE_PER_CALL_RESERVATION_NANO_USD &&
    status.committedNanoUsd <= PROBE_LIFETIME_SPEND_CEILING_NANO_USD &&
    status.sequence === status.claimedCalls &&
    !status.haltMarkerPresent;
  const settlementValid = options.allowUnsettled
    ? status.pendingCount <= 1 &&
      status.uncertainCount <= 1 &&
      status.inflightCount === status.pendingCount
    : isProbeGuardStatusConsistent(status, identity);
  if (
    !staticIdentityValid ||
    !settlementValid ||
    status.purposeCounts.calibration !== 17 ||
    status.purposeCounts.baseline > PROBE_PURPOSE_CALL_LIMITS.baseline ||
    status.purposeCounts.revised > PROBE_PURPOSE_CALL_LIMITS.revised
  ) {
    throw new ScoredGuardError("scored_guard_not_clean");
  }
  return Object.freeze({ redis, identity: Object.freeze(identity), status });
}

export function assertScoredPhaseCanStart(
  guard: ProbeGuardStatus,
  phase: "baseline" | "revised",
  execution: {
    readonly phaseCallOffset: number;
    readonly repairPhaseCallOffset: 0 | 1;
    readonly predecessorProtocolHash: string | null;
    readonly predecessorEvidenceDigest: string | null;
    readonly predecessorRunId: string | null;
    readonly predecessorDisposition: ScoredPredecessorDisposition | null;
  }
): void {
  const observed = guard.purposeCounts[phase];
  const predecessorValues = [
    execution.predecessorProtocolHash,
    execution.predecessorEvidenceDigest,
    execution.predecessorRunId,
    execution.predecessorDisposition
  ];
  const predecessorCount = predecessorValues.filter((value) => value !== null).length;
  if (
    observed !== execution.phaseCallOffset ||
    execution.phaseCallOffset + 24 > PROBE_PURPOSE_CALL_LIMITS[phase] ||
    guard.purposeCounts.repair !==
      execution.repairPhaseCallOffset + (phase === "revised" ? 1 : 0) ||
    (phase === "baseline" &&
      execution.repairPhaseCallOffset === 1 &&
      execution.phaseCallOffset === 24 &&
      execution.predecessorDisposition !== "superseded-protocol") ||
    (predecessorCount !== 0 && predecessorCount !== predecessorValues.length) ||
    (execution.phaseCallOffset > 0 && predecessorCount !== predecessorValues.length) ||
    (execution.predecessorProtocolHash !== null &&
      !/^[a-f0-9]{64}$/u.test(execution.predecessorProtocolHash)) ||
    (execution.predecessorEvidenceDigest !== null &&
      !/^[a-f0-9]{64}$/u.test(execution.predecessorEvidenceDigest)) ||
    (execution.predecessorRunId !== null &&
      !/^run_[A-Za-z0-9_-]{22}$/u.test(execution.predecessorRunId))
  ) {
    throw new ScoredGuardError("scored_phase_offset_mismatch");
  }
  if (phase === "baseline") {
    if (guard.purposeCounts.revised !== 0) {
      throw new ScoredGuardError("baseline_already_started");
    }
    return;
  }
  if (guard.purposeCounts.baseline < (execution.repairPhaseCallOffset + 1) * 24) {
    throw new ScoredGuardError("revised_phase_not_ready");
  }
}

export function assertScoredPredecessorDisposition(input: {
  readonly disposition: ScoredPredecessorDisposition;
  readonly currentProtocolHash: string;
  readonly predecessorProtocolHash: string;
  readonly predecessorTerminalStatus: "terminal-complete" | "terminal-invalid";
  readonly predecessorCompletedCount: number;
}): void {
  const invalidSchedule =
    input.disposition === "invalid-schedule" &&
    input.predecessorTerminalStatus === "terminal-invalid" &&
    input.predecessorCompletedCount < 24;
  const supersededProtocol =
    input.disposition === "superseded-protocol" &&
    input.predecessorTerminalStatus === "terminal-complete" &&
    input.predecessorCompletedCount === 24 &&
    input.predecessorProtocolHash !== input.currentProtocolHash;
  if (!invalidSchedule && !supersededProtocol) {
    throw new ScoredGuardError("scored_predecessor_disposition_mismatch");
  }
}

export function assertScoredReplacementOffset(input: {
  readonly phaseCallOffset: number;
  readonly predecessorPhaseCallOffset: number;
  readonly predecessorProviderGrants: number;
}): void {
  if (
    !Number.isSafeInteger(input.predecessorPhaseCallOffset) ||
    input.predecessorPhaseCallOffset < 0 ||
    !Number.isSafeInteger(input.predecessorProviderGrants) ||
    input.predecessorProviderGrants < 0 ||
    input.phaseCallOffset !== input.predecessorPhaseCallOffset + input.predecessorProviderGrants
  ) {
    throw new ScoredGuardError("scored_predecessor_call_delta_mismatch");
  }
}
