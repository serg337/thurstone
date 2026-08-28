import "server-only";

import { getProbeConfigurationStatus } from "@/lib/probe/config";
import {
  PROBE_GLOBAL_CALL_LIMIT,
  PROBE_CHALLENGE_CLOSES_AT,
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
  PROBE_MAX_CONCURRENCY,
  PROBE_MODEL,
  PROBE_PER_CALL_RESERVATION_NANO_USD,
  PROBE_POLICY_VERSION,
  PROBE_PURPOSE_CALL_LIMITS,
  probePolicyHash
} from "@/lib/probe/policy";
import {
  createProbeRedis,
  probeLedgerScriptHash,
  readProbeGuardStatus,
  type ProbeGuardIdentity,
  type ProbeGuardStatus
} from "@/lib/probe/ledger";
import { requireProbeActivation } from "@/lib/probe/activation";
import {
  FALLBACK_PROBE_CALIBRATION_BASE_CALLS,
  FALLBACK_PROBE_CALIBRATION_TERMINAL_CALLS
} from "@/lib/probe/service-contract";
import { isProbeV04PolicyMigrationSourceStatus } from "@/lib/probe/policy-v04-migration-contract";

interface EnvironmentLike {
  readonly [key: string]: string | undefined;
}

export function isProbeGuardStatusConsistent(
  guard: ProbeGuardStatus,
  expected: ProbeGuardIdentity
): boolean {
  return (
    guard.status === "open" &&
    guard.guardInstanceId === expected.guardInstanceId &&
    guard.policyHash === expected.policyHash &&
    guard.scriptHash === expected.scriptHash &&
    guard.policyVersion === PROBE_POLICY_VERSION &&
    guard.model === PROBE_MODEL &&
    guard.globalCallLimit === PROBE_GLOBAL_CALL_LIMIT &&
    guard.spendCeilingNanoUsd === PROBE_LIFETIME_SPEND_CEILING_NANO_USD &&
    guard.perCallReservationNanoUsd === PROBE_PER_CALL_RESERVATION_NANO_USD &&
    guard.maxConcurrency === PROBE_MAX_CONCURRENCY &&
    guard.challengeClosesAtMs === Date.parse(PROBE_CHALLENGE_CLOSES_AT) &&
    /^[a-f0-9]{40}$/u.test(guard.initializedCommit) &&
    guard.initializedCommit === expected.initializedCommit &&
    Object.entries(PROBE_PURPOSE_CALL_LIMITS).every(
      ([purpose, limit]) =>
        guard.purposeLimits[purpose as keyof typeof PROBE_PURPOSE_CALL_LIMITS] === limit
    ) &&
    Object.values(guard.purposeCounts).reduce((sum, count) => sum + count, 0) ===
      guard.claimedCalls &&
    Object.entries(guard.purposeCounts).every(
      ([purpose, count]) =>
        count <= PROBE_PURPOSE_CALL_LIMITS[purpose as keyof typeof PROBE_PURPOSE_CALL_LIMITS]
    ) &&
    guard.claimedCalls <= PROBE_GLOBAL_CALL_LIMIT &&
    guard.committedNanoUsd === guard.claimedCalls * PROBE_PER_CALL_RESERVATION_NANO_USD &&
    guard.committedNanoUsd <= PROBE_LIFETIME_SPEND_CEILING_NANO_USD &&
    guard.pendingCount + guard.knownCount + guard.uncertainCount === guard.claimedCalls &&
    guard.knownActualNanoUsd <= guard.knownCount * PROBE_PER_CALL_RESERVATION_NANO_USD &&
    guard.uncertainUpperNanoUsd === guard.uncertainCount * PROBE_PER_CALL_RESERVATION_NANO_USD &&
    guard.inflightCount === guard.pendingCount &&
    guard.sequence === guard.claimedCalls &&
    !guard.haltMarkerPresent &&
    !guard.uncertainMarkerPresent &&
    guard.pendingCount === 0 &&
    guard.uncertainCount === 0
  );
}

export async function readPublicProbeControlStatus(environment: EnvironmentLike = process.env) {
  const commit =
    environment.TOOLPROOF_COMMIT_SHA ?? environment.VERCEL_GIT_COMMIT_SHA ?? "unversioned";
  const expectedPolicyHash = await probePolicyHash();
  const expectedScriptHash = await probeLedgerScriptHash();
  const configuration = getProbeConfigurationStatus(environment);
  const policy = {
    version: PROBE_POLICY_VERSION,
    hash: expectedPolicyHash,
    model: PROBE_MODEL,
    callLimit: PROBE_GLOBAL_CALL_LIMIT,
    allocation: PROBE_PURPOSE_CALL_LIMITS,
    spendCeilingUsd: "10.00",
    perCallReservationNanoUsd: String(PROBE_PER_CALL_RESERVATION_NANO_USD),
    resetsWithProviderWindow: false
  };

  if (!configuration.operationalControlsConfigured) {
    return {
      status: "controls-pending" as const,
      enabled: false,
      activation: "disabled" as const,
      policy,
      reason: "Durable lifetime-budget and signed-token controls are not fully configured.",
      commit
    };
  }

  try {
    const guard = await readProbeGuardStatus(createProbeRedis(environment as NodeJS.ProcessEnv));
    const expectedGuard = environment.TOOLPROOF_GUARD_INSTANCE_ID;
    const expectedIdentity = {
      guardInstanceId: expectedGuard ?? "",
      policyHash: expectedPolicyHash,
      scriptHash: expectedScriptHash,
      initializedCommit: environment.TOOLPROOF_GUARD_INITIALIZED_COMMIT ?? ""
    };
    if (environment.TOOLPROOF_PROBE_ACTIVATION_MODE === "calibration") {
      try {
        const activation = await requireProbeActivation({ environment, guard });
        const calibrationStartable =
          activation.guard.phase === "idle" &&
          activation.guard.claimedCalls === FALLBACK_PROBE_CALIBRATION_BASE_CALLS &&
          activation.guard.knownCalls === FALLBACK_PROBE_CALIBRATION_BASE_CALLS &&
          activation.guard.calibrationCalls === FALLBACK_PROBE_CALIBRATION_BASE_CALLS &&
          activation.guard.pendingCalls === 0 &&
          activation.guard.uncertainCalls === 0;
        const calibrationTerminal =
          activation.guard.phase === "idle" &&
          activation.guard.claimedCalls === FALLBACK_PROBE_CALIBRATION_TERMINAL_CALLS &&
          activation.guard.knownCalls === FALLBACK_PROBE_CALIBRATION_TERMINAL_CALLS &&
          activation.guard.calibrationCalls === FALLBACK_PROBE_CALIBRATION_TERMINAL_CALLS;
        return {
          status: "controls-ready" as const,
          enabled: true,
          activation: "calibration" as const,
          calibrationStartable,
          policy,
          reason: calibrationStartable
            ? "The exact pinned four-case fallback calibration is ready for this build."
            : calibrationTerminal
              ? "The pinned fallback calibration is terminal; another run is not admitted."
              : "The pinned fallback calibration is active or requires exact recovery.",
          commit,
          guard: {
            phase: activation.guard.phase,
            claimedCalls: activation.guard.claimedCalls,
            knownCalls: activation.guard.knownCalls,
            calibrationCalls: activation.guard.calibrationCalls
          },
          activationHash: activation.activationHash
        };
      } catch {
        return {
          status: "controls-unavailable" as const,
          enabled: false,
          activation: "invalid" as const,
          policy,
          reason: "Probe activation is configured but does not match this build or guard.",
          commit
        };
      }
    }
    const internallyConsistent = isProbeGuardStatusConsistent(guard, expectedIdentity);
    const migrationRequired = isProbeV04PolicyMigrationSourceStatus(guard, {
      guardInstanceId: expectedIdentity.guardInstanceId,
      initializedCommit: expectedIdentity.initializedCommit
    });

    if (!internallyConsistent && !migrationRequired) {
      return {
        status: "controls-unavailable" as const,
        enabled: false,
        activation: "disabled" as const,
        policy,
        reason: "The durable guard is unavailable, quarantined, halted, or mismatched.",
        commit
      };
    }

    return {
      status: "controls-ready" as const,
      enabled: false,
      activation: "disabled" as const,
      policy,
      reason: migrationRequired
        ? "The exact terminal-nine v0.3 guard is verified and awaits the approved atomic v0.4 migration."
        : "The lifetime guard is verified; the Probe lane remains disabled until Gate 2.",
      ...(migrationRequired ? { migration: "required" as const } : {}),
      commit
    };
  } catch {
    return {
      status: "controls-unavailable" as const,
      enabled: false,
      activation: "disabled" as const,
      policy,
      reason: "The durable guard could not be verified.",
      commit
    };
  }
}
