import { describe, expect, it, vi } from "vitest";

import {
  PROBE_ACTIVATION_MODE,
  ProbeActivationError,
  computeProbeActivationHash,
  createProbeActivationManifest,
  probeActivationFrozenHashes,
  requireProbeActivation,
  validateProbeActivationGuard
} from "@/lib/probe/activation";
import { probeLedgerScriptHash, type ProbeGuardStatus } from "@/lib/probe/ledger";
import {
  PROBE_CHALLENGE_CLOSES_AT,
  PROBE_GLOBAL_CALL_LIMIT,
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
  PROBE_MAX_CONCURRENCY,
  PROBE_MODEL,
  PROBE_PER_CALL_RESERVATION_NANO_USD,
  PROBE_POLICY_VERSION,
  PROBE_PURPOSE_CALL_LIMITS,
  probePolicyHash
} from "@/lib/probe/policy";

const signingSecret = Buffer.alloc(32, 3).toString("base64url");
const activationSecret = Buffer.alloc(32, 4).toString("base64url");
const activeCommit = "a".repeat(40);
const initializedCommit = "b".repeat(40);
const guardInstanceId = "guard_0123456789abcdef";
const projectId = `prj_${"p".repeat(24)}`;
const nowMs = Date.parse("2026-08-27T12:00:00.000Z");

function guard(overrides: Partial<ProbeGuardStatus> = {}): ProbeGuardStatus {
  return {
    status: "open",
    guardInstanceId,
    policyHash: "",
    scriptHash: "",
    initializedCommit,
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
    uncertainMarkerPresent: false,
    ...overrides
  };
}

async function validFixture() {
  const hashes = await probeActivationFrozenHashes();
  const environment: Record<string, string> = {
    VERCEL: "1",
    VERCEL_ENV: "production",
    NODE_ENV: "production",
    VERCEL_PROJECT_ID: projectId,
    TOOLPROOF_EXPECTED_VERCEL_PROJECT_ID: projectId,
    VERCEL_GIT_COMMIT_SHA: activeCommit,
    TOOLPROOF_COMMIT_SHA: activeCommit,
    TOOLPROOF_PROBE_ACTIVE_COMMIT: activeCommit,
    TOOLPROOF_PROBE_ACTIVATION_MODE: PROBE_ACTIVATION_MODE,
    TOOLPROOF_PROBE_ACTIVATION_SECRET: activationSecret,
    TOOLPROOF_SIGNING_SECRET: signingSecret,
    TOOLPROOF_GUARD_INSTANCE_ID: guardInstanceId,
    TOOLPROOF_GUARD_INITIALIZED_COMMIT: initializedCommit,
    TOOLPROOF_PROBE_ACTIVE_POLICY_HASH: hashes.policyHash,
    TOOLPROOF_PROBE_ACTIVE_SCRIPT_HASH: hashes.scriptHash,
    TOOLPROOF_PROBE_ACTIVE_RUNNER_HASH: hashes.runnerContractHash,
    TOOLPROOF_PROBE_ACTIVE_CONTINUATION_HASH: hashes.continuationScriptHash,
    OPENAI_API_KEY: "configured",
    KV_REST_API_URL: "https://fixture.upstash.io",
    KV_REST_API_TOKEN: "configured"
  };
  const manifest = await createProbeActivationManifest(environment, hashes);
  environment.TOOLPROOF_PROBE_ACTIVATION_HASH = computeProbeActivationHash(
    manifest,
    activationSecret
  );
  const liveGuard = guard({ policyHash: hashes.policyHash, scriptHash: hashes.scriptHash });
  return { environment, hashes, manifest, liveGuard };
}

describe("Probe activation", () => {
  it("is disabled by default without reading durable state", async () => {
    const readGuard = vi.fn(async () => guard());
    await expect(requireProbeActivation({ environment: {}, readGuard, nowMs })).rejects.toEqual(
      expect.objectContaining<Partial<ProbeActivationError>>({ code: "activation_disabled" })
    );
    expect(readGuard).not.toHaveBeenCalled();
  });

  it("binds exact production, project, build, guard, and frozen contract identities", async () => {
    const fixture = await validFixture();
    const readGuard = vi.fn(async () => fixture.liveGuard);
    const activation = await requireProbeActivation({
      environment: fixture.environment,
      readGuard,
      nowMs
    });
    expect(readGuard).toHaveBeenCalledTimes(1);
    expect(activation).toMatchObject({
      enabled: true,
      mode: "calibration",
      activationHash: fixture.environment.TOOLPROOF_PROBE_ACTIVATION_HASH,
      manifest: {
        activeCommit,
        vercelProjectId: projectId,
        guardInstanceId,
        guardInitializedCommit: initializedCommit,
        policyHash: fixture.hashes.policyHash,
        scriptHash: fixture.hashes.scriptHash,
        runnerContractHash: fixture.hashes.runnerContractHash,
        continuationScriptHash: fixture.hashes.continuationScriptHash
      },
      guard: { phase: "idle", claimedCalls: 0, pendingCalls: 0 }
    });
    expect(Object.isFrozen(activation)).toBe(true);
    expect(Object.isFrozen(activation.manifest)).toBe(true);
  });

  it.each([
    ["VERCEL", "0", "activation_environment_mismatch"],
    ["VERCEL_ENV", "preview", "activation_environment_mismatch"],
    ["NODE_ENV", "development", "activation_environment_mismatch"],
    ["VERCEL_PROJECT_ID", `prj_${"x".repeat(24)}`, "activation_project_mismatch"],
    ["TOOLPROOF_PROBE_ACTIVE_COMMIT", "c".repeat(40), "activation_commit_mismatch"],
    ["VERCEL_GIT_COMMIT_SHA", "c".repeat(40), "activation_commit_mismatch"],
    ["TOOLPROOF_COMMIT_SHA", "c".repeat(40), "activation_commit_mismatch"],
    ["TOOLPROOF_PROBE_ACTIVE_POLICY_HASH", "c".repeat(64), "activation_frozen_hash_mismatch"],
    ["TOOLPROOF_PROBE_ACTIVE_SCRIPT_HASH", "c".repeat(64), "activation_frozen_hash_mismatch"],
    ["TOOLPROOF_PROBE_ACTIVE_RUNNER_HASH", "c".repeat(64), "activation_frozen_hash_mismatch"],
    ["TOOLPROOF_PROBE_ACTIVE_CONTINUATION_HASH", "d".repeat(64), "activation_frozen_hash_mismatch"],
    ["TOOLPROOF_PROBE_ACTIVATION_HASH", "c".repeat(64), "activation_hash_mismatch"]
  ])("fails closed when %s drifts", async (key, value, code) => {
    const fixture = await validFixture();
    fixture.environment[key] = value;
    await expect(
      requireProbeActivation({ environment: fixture.environment, guard: fixture.liveGuard, nowMs })
    ).rejects.toEqual(expect.objectContaining<Partial<ProbeActivationError>>({ code }));
  });

  it("requires a canonical separate 32-byte activation secret", async () => {
    const fixture = await validFixture();
    fixture.environment.TOOLPROOF_PROBE_ACTIVATION_SECRET = "weak";
    await expect(
      requireProbeActivation({ environment: fixture.environment, guard: fixture.liveGuard, nowMs })
    ).rejects.toMatchObject({ code: "activation_secret_invalid" });

    const reused = await validFixture();
    reused.environment.TOOLPROOF_PROBE_ACTIVATION_SECRET = signingSecret;
    const reusedManifest = await createProbeActivationManifest(reused.environment, reused.hashes);
    reused.environment.TOOLPROOF_PROBE_ACTIVATION_HASH = computeProbeActivationHash(
      reusedManifest,
      signingSecret
    );
    await expect(
      requireProbeActivation({ environment: reused.environment, guard: reused.liveGuard, nowMs })
    ).rejects.toMatchObject({ code: "activation_secret_not_separate" });
  });

  it("accepts idle progress and exactly one in-flight calibration call", async () => {
    const fixture = await validFixture();
    const expected = {
      guardInstanceId,
      policyHash: fixture.hashes.policyHash,
      scriptHash: fixture.hashes.scriptHash,
      initializedCommit
    };
    const idleProgress = guard({
      policyHash: fixture.hashes.policyHash,
      scriptHash: fixture.hashes.scriptHash,
      claimedCalls: 2,
      committedNanoUsd: 2 * PROBE_PER_CALL_RESERVATION_NANO_USD,
      knownCount: 2,
      knownActualNanoUsd: 4_000_000,
      purposeCounts: { calibration: 2, baseline: 0, repair: 0, revised: 0, judge: 0 },
      sequence: 2
    });
    expect(validateProbeActivationGuard(idleProgress, expected, nowMs)).toMatchObject({
      phase: "idle",
      claimedCalls: 2,
      knownCalls: 2,
      pendingCalls: 0
    });

    const inflight = guard({
      policyHash: fixture.hashes.policyHash,
      scriptHash: fixture.hashes.scriptHash,
      claimedCalls: 3,
      committedNanoUsd: 3 * PROBE_PER_CALL_RESERVATION_NANO_USD,
      knownCount: 2,
      knownActualNanoUsd: 4_000_000,
      pendingCount: 1,
      inflightCount: 1,
      purposeCounts: { calibration: 3, baseline: 0, repair: 0, revised: 0, judge: 0 },
      sequence: 3
    });
    expect(validateProbeActivationGuard(inflight, expected, nowMs)).toMatchObject({
      phase: "single-inflight",
      claimedCalls: 3,
      knownCalls: 2,
      pendingCalls: 1
    });
  });

  it.each([
    { status: "quarantined" as const },
    { pendingCount: 2, inflightCount: 2 },
    { uncertainCount: 1, uncertainUpperNanoUsd: PROBE_PER_CALL_RESERVATION_NANO_USD },
    { pendingCount: 1, inflightCount: 0 },
    { claimedCalls: 1, knownCount: 0, purposeCounts: PROBE_PURPOSE_CALL_LIMITS },
    {
      claimedCalls: 1,
      knownCount: 1,
      committedNanoUsd: PROBE_PER_CALL_RESERVATION_NANO_USD,
      purposeCounts: { calibration: 0, baseline: 1, repair: 0, revised: 0, judge: 0 },
      sequence: 1
    },
    { sequence: 1 },
    { committedNanoUsd: 1 },
    { haltMarkerPresent: true },
    { uncertainMarkerPresent: true },
    { claimedCalls: Number.NaN },
    { challengeClosesAtMs: nowMs }
  ])("rejects malformed, drifted, unsafe, or non-calibration guard state %#", async (override) => {
    const fixture = await validFixture();
    const expected = {
      guardInstanceId,
      policyHash: fixture.hashes.policyHash,
      scriptHash: fixture.hashes.scriptHash,
      initializedCommit
    };
    expect(() =>
      validateProbeActivationGuard(
        guard({
          policyHash: fixture.hashes.policyHash,
          scriptHash: fixture.hashes.scriptHash,
          ...override
        }),
        expected,
        nowMs
      )
    ).toThrowError(expect.objectContaining({ code: "activation_guard_invalid" }));
  });

  it("preserves the initialized policy and Lua bundle hashes", async () => {
    await expect(probePolicyHash()).resolves.toBe(
      "9289f1def645e9ccc71a3ef95320281cef937be5ec1329beaf57f22b4b2c7939"
    );
    await expect(probeLedgerScriptHash()).resolves.toBe(
      "41d351ad5d1adb81b0c6a90aa930cf1ae932b053d58b097c0283846728b798d2"
    );
  });
});
