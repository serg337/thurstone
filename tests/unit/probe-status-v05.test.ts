import { beforeEach, describe, expect, it, vi } from "vitest";

const statusMocks = vi.hoisted(() => ({
  guard: undefined as unknown,
  activation: undefined as unknown
}));

vi.mock("@/lib/probe/ledger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/probe/ledger")>();
  return {
    ...actual,
    createProbeRedis: vi.fn(() => ({})),
    readProbeGuardStatus: vi.fn(async () => statusMocks.guard)
  };
});

vi.mock("@/lib/probe/activation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/probe/activation")>();
  return {
    ...actual,
    requireProbeActivation: vi.fn(async () => statusMocks.activation)
  };
});

import {
  PROBE_CHALLENGE_CLOSES_AT,
  PROBE_GLOBAL_CALL_LIMIT,
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
  PROBE_MAX_CONCURRENCY,
  PROBE_MODEL,
  PROBE_PER_CALL_RESERVATION_NANO_USD
} from "@/lib/probe/policy";
import {
  PROBE_V05_MIGRATED_LEDGER_SCRIPT_HASH,
  PROBE_V05_MIGRATED_POLICY_HASH,
  PROBE_V05_MIGRATED_POLICY_VERSION,
  PROBE_V05_MIGRATED_PURPOSE_CALL_LIMITS,
  PROBE_V05_POLICY_MIGRATION_FIXED_PRESERVED_STATE,
  PROBE_V05_PREVIOUS_LEDGER_SCRIPT_HASH,
  PROBE_V05_PREVIOUS_POLICY_HASH,
  PROBE_V05_PREVIOUS_POLICY_VERSION,
  PROBE_V05_PREVIOUS_PURPOSE_CALL_LIMITS
} from "@/lib/probe/policy-v05-migration-contract";
import { readPublicProbeControlStatus } from "@/lib/probe/status";

const guardInstanceId = "guard_status_v05_0123456789";
const initializedCommit = "a".repeat(40);
const signingSecret = Buffer.alloc(32, 9).toString("base64url");

function environment(activation = false) {
  return {
    VERCEL_ENV: "production",
    OPENAI_API_KEY: "configured",
    KV_REST_API_URL: "https://example.upstash.io",
    KV_REST_API_TOKEN: "configured",
    TOOLPROOF_SIGNING_SECRET: signingSecret,
    TOOLPROOF_GUARD_INSTANCE_ID: guardInstanceId,
    TOOLPROOF_GUARD_INITIALIZED_COMMIT: initializedCommit,
    ...(activation ? { TOOLPROOF_PROBE_ACTIVATION_MODE: "calibration" } : {})
  };
}

function guardCore() {
  const fixed = PROBE_V05_POLICY_MIGRATION_FIXED_PRESERVED_STATE;
  return {
    status: "open" as const,
    guardInstanceId,
    initializedCommit,
    model: PROBE_MODEL,
    globalCallLimit: PROBE_GLOBAL_CALL_LIMIT,
    spendCeilingNanoUsd: PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
    perCallReservationNanoUsd: PROBE_PER_CALL_RESERVATION_NANO_USD,
    maxConcurrency: PROBE_MAX_CONCURRENCY,
    challengeClosesAtMs: Date.parse(PROBE_CHALLENGE_CLOSES_AT),
    claimedCalls: fixed.claimedCalls,
    committedNanoUsd: fixed.committedNanoUsd,
    pendingCount: fixed.pendingCalls,
    knownCount: fixed.knownCalls,
    uncertainCount: fixed.uncertainCalls,
    knownActualNanoUsd: fixed.knownActualNanoUsd,
    uncertainUpperNanoUsd: fixed.uncertainUpperNanoUsd,
    purposeCounts: fixed.purposeCounts,
    inflightCount: fixed.inflightCalls,
    sequence: fixed.sequence,
    haltMarkerPresent: false,
    uncertainMarkerPresent: false
  };
}

function migrationSourceGuard() {
  return {
    ...guardCore(),
    policyVersion: PROBE_V05_PREVIOUS_POLICY_VERSION,
    policyHash: PROBE_V05_PREVIOUS_POLICY_HASH,
    scriptHash: PROBE_V05_PREVIOUS_LEDGER_SCRIPT_HASH,
    purposeLimits: PROBE_V05_PREVIOUS_PURPOSE_CALL_LIMITS
  };
}

function currentGuard() {
  return {
    ...guardCore(),
    policyVersion: PROBE_V05_MIGRATED_POLICY_VERSION,
    policyHash: PROBE_V05_MIGRATED_POLICY_HASH,
    scriptHash: PROBE_V05_MIGRATED_LEDGER_SCRIPT_HASH,
    purposeLimits: PROBE_V05_MIGRATED_PURPOSE_CALL_LIMITS
  };
}

describe("public v0.5 Probe status", () => {
  beforeEach(() => {
    statusMocks.guard = migrationSourceGuard();
    statusMocks.activation = undefined;
  });

  it("reports the exact terminal-thirteen v0.4 source as migration-required", async () => {
    await expect(readPublicProbeControlStatus(environment())).resolves.toMatchObject({
      status: "controls-ready",
      enabled: false,
      activation: "disabled",
      migration: "required",
      reason: expect.stringContaining("terminal-thirteen v0.4")
    });
  });

  it("recognizes the exact current v0.5 guard without mutating it", async () => {
    statusMocks.guard = currentGuard();
    await expect(readPublicProbeControlStatus(environment())).resolves.toMatchObject({
      status: "controls-ready",
      enabled: false,
      activation: "disabled",
      policy: { version: PROBE_V05_MIGRATED_POLICY_VERSION },
      reason: expect.stringContaining("lifetime guard is verified")
    });
  });

  it("uses fallback base 13 and terminal 17 for activated readiness", async () => {
    statusMocks.activation = {
      activationHash: "b".repeat(64),
      guard: {
        phase: "idle",
        claimedCalls: 13,
        knownCalls: 13,
        calibrationCalls: 13,
        pendingCalls: 0,
        uncertainCalls: 0
      }
    };
    await expect(readPublicProbeControlStatus(environment(true))).resolves.toMatchObject({
      status: "controls-ready",
      enabled: true,
      activation: "calibration",
      calibrationStartable: true,
      reason: expect.stringContaining("pinned four-case fallback")
    });

    statusMocks.activation = {
      activationHash: "b".repeat(64),
      guard: {
        phase: "idle",
        claimedCalls: 17,
        knownCalls: 17,
        calibrationCalls: 17,
        pendingCalls: 0,
        uncertainCalls: 0
      }
    };
    await expect(readPublicProbeControlStatus(environment(true))).resolves.toMatchObject({
      calibrationStartable: false,
      reason: expect.stringContaining("terminal")
    });
  });
});
