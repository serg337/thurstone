import { describe, expect, it } from "vitest";

import { getProbeConfigurationStatus, getPublicProbeStatus } from "@/lib/probe/config";
import {
  PROBE_CHALLENGE_CLOSES_AT,
  PROBE_GLOBAL_CALL_LIMIT,
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
  PROBE_MAX_CONCURRENCY,
  PROBE_MODEL,
  PROBE_PER_CALL_RESERVATION_NANO_USD,
  PROBE_POLICY_VERSION,
  PROBE_PURPOSE_CALL_LIMITS
} from "@/lib/probe/policy";
import { isProbeGuardStatusConsistent, readPublicProbeControlStatus } from "@/lib/probe/status";

const signingSecret = Buffer.alloc(32, 7).toString("base64url");

describe("Probe configuration", () => {
  it("fails closed when only the provider credential exists", () => {
    expect(getProbeConfigurationStatus({ OPENAI_API_KEY: "configured" })).toEqual({
      productionEnvironment: false,
      providerCredentialConfigured: true,
      durableStoreConfigured: false,
      signingSecretConfigured: false,
      guardInstanceConfigured: false,
      guardInitializedCommitConfigured: false,
      operationalControlsConfigured: false
    });
  });

  it("never treats environment presence alone as inference activation", () => {
    const environment = {
      VERCEL_ENV: "production",
      OPENAI_API_KEY: "configured",
      KV_REST_API_URL: "https://example.upstash.io",
      KV_REST_API_TOKEN: "configured",
      TOOLPROOF_SIGNING_SECRET: signingSecret,
      TOOLPROOF_GUARD_INSTANCE_ID: "guard_0123456789abcdef",
      TOOLPROOF_GUARD_INITIALIZED_COMMIT: "a".repeat(40)
    };
    expect(getProbeConfigurationStatus(environment).operationalControlsConfigured).toBe(true);
    expect(getPublicProbeStatus(environment)).toMatchObject({
      status: "disabled",
      inferenceEnabled: false,
      lifetimePolicy: { callLimit: 160, spendCeilingUsd: 10, resetsWithProviderWindow: false }
    });
  });

  it("returns a sanitized 503-ready receipt without configured controls", async () => {
    await expect(readPublicProbeControlStatus({})).resolves.toMatchObject({
      status: "controls-pending",
      enabled: false,
      activation: "disabled",
      policy: { callLimit: 160, spendCeilingUsd: "10.00" }
    });
  });

  it("rejects drifted purpose counters in the shared guard validator", () => {
    const identity = {
      guardInstanceId: "guard_0123456789abcdef",
      policyHash: "a".repeat(64),
      scriptHash: "b".repeat(64),
      initializedCommit: "c".repeat(40)
    };
    const guard = {
      ...identity,
      status: "open" as const,
      claimedCalls: 0,
      committedNanoUsd: 0,
      pendingCount: 0,
      knownCount: 0,
      uncertainCount: 0,
      knownActualNanoUsd: 0,
      uncertainUpperNanoUsd: 0,
      policyVersion: PROBE_POLICY_VERSION,
      model: PROBE_MODEL,
      globalCallLimit: PROBE_GLOBAL_CALL_LIMIT,
      spendCeilingNanoUsd: PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
      perCallReservationNanoUsd: PROBE_PER_CALL_RESERVATION_NANO_USD,
      maxConcurrency: PROBE_MAX_CONCURRENCY,
      challengeClosesAtMs: Date.parse(PROBE_CHALLENGE_CLOSES_AT),
      purposeLimits: PROBE_PURPOSE_CALL_LIMITS,
      purposeCounts: { calibration: 0, baseline: 0, repair: 0, revised: 0, judge: 0 },
      inflightCount: 0,
      sequence: 0,
      haltMarkerPresent: false,
      uncertainMarkerPresent: false
    };
    expect(isProbeGuardStatusConsistent(guard, identity)).toBe(true);
    expect(
      isProbeGuardStatusConsistent(guard, { ...identity, initializedCommit: "d".repeat(40) })
    ).toBe(false);
    expect(
      isProbeGuardStatusConsistent(
        {
          ...guard,
          claimedCalls: 5,
          committedNanoUsd: 5 * PROBE_PER_CALL_RESERVATION_NANO_USD,
          knownCount: 5,
          purposeCounts: { ...guard.purposeCounts, calibration: 5 }
        },
        identity
      )
    ).toBe(false);
  });
});
