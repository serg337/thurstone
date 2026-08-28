import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { canonicalJson } from "@/lib/evidence/digest";
import {
  PROBE_FALLBACK_ACK_RECOVERY_GUARD,
  PROBE_FALLBACK_ACK_RECOVERY_PROJECT_ID,
  PROBE_FALLBACK_ACK_RECOVERY_TARGET_ACTIVATION_HASH,
  PROBE_FALLBACK_ACK_RECOVERY_TARGET_APP_COMMIT,
  PROBE_FALLBACK_ACK_RECOVERY_TARGET_RUN_ID
} from "@/lib/probe/fallback-ack-recovery-contract";
import {
  PROBE_FALLBACK_ACK_RECOVERY_SCRIPTS,
  assertProbeFallbackAckRecoveryProductionContext,
  preflightProbeFallbackAckRecovery,
  recoverProbeFallbackAck,
  type ProbeFallbackAckRecoveryRedisClient
} from "@/lib/probe/fallback-ack-recovery.server";
import { PROBE_RUN_INDEX_TTL_SECONDS, probeRunIndexPayloadSchema } from "@/lib/probe/run-index";
import { sealProbeArtifact } from "@/lib/probe/server-artifact";

const signingSecret = Buffer.alloc(32, 73).toString("base64url");
const repairCommit = "d".repeat(40);

function keyedHash(label: string, value: string): string {
  return createHmac("sha256", Buffer.from(signingSecret, "base64url"))
    .update(`toolproof.probe.run-index.${label}.v1.${value}`)
    .digest("hex");
}

function terminalFixture() {
  const issuedAt = 1_787_900_000;
  const payload = probeRunIndexPayloadSchema.parse({
    version: 1,
    activationHash: PROBE_FALLBACK_ACK_RECOVERY_TARGET_ACTIVATION_HASH,
    buildCommit: PROBE_FALLBACK_ACK_RECOVERY_TARGET_APP_COMMIT,
    launchHash: "a".repeat(64),
    recoveryId: "recovery_0123456789abcdef",
    sessionId: "session_0123456789abcdef",
    runId: PROBE_FALLBACK_ACK_RECOVERY_TARGET_RUN_ID,
    actorHash: "b".repeat(64),
    continuation: `tpse1.${"c".repeat(96)}.terminal`,
    nextOrdinal: 4,
    terminal: true,
    issuedAt,
    expiresAt: issuedAt + PROBE_RUN_INDEX_TTL_SECONDS
  });
  const binding = createHmac("sha256", Buffer.from(signingSecret, "base64url"))
    .update(`toolproof.probe.run-index.binding.v1.${canonicalJson(payload)}`)
    .digest("hex");
  const identities = [
    keyedHash("recovery", payload.recoveryId),
    keyedHash("session", payload.sessionId),
    keyedHash("run", payload.runId),
    payload.actorHash,
    payload.launchHash
  ] as const;
  return {
    payload,
    binding,
    identities,
    token: sealProbeArtifact("run_index", payload, signingSecret),
    ownerHash: "e".repeat(64)
  };
}

function fakeRedis(input: {
  readonly read: () => unknown | Promise<unknown>;
  readonly write?: () => unknown | Promise<unknown>;
}) {
  const evalRo = vi.fn(input.read);
  const evalWrite = vi.fn(input.write ?? (() => [0, "UNEXPECTED_WRITE"]));
  return {
    client: { evalRo, eval: evalWrite } as unknown as ProbeFallbackAckRecoveryRedisClient,
    evalRo,
    evalWrite
  };
}

describe("one-time fallback terminal ACK recovery", () => {
  it("decrypts and binds the exact terminal run before preparing confirmation", async () => {
    const fixture = terminalFixture();
    const redis = fakeRedis({
      read: () => [
        1,
        "ACK_RECOVERY_READY",
        ...fixture.identities,
        fixture.binding,
        fixture.token,
        fixture.ownerHash,
        "0",
        "",
        "",
        ""
      ]
    });
    const prepared = await preflightProbeFallbackAckRecovery(redis.client, {
      repairCommit,
      signingSecret,
      evidencePath: "/var/tmp/toolproof-no-such-ack-evidence.json"
    });
    expect(prepared).toMatchObject({
      disposition: "ready",
      evidence: "not-available",
      payloadBinding: fixture.binding,
      identityHashes: fixture.identities
    });
    expect(prepared.confirmation).toMatch(/^[a-f0-9]{64}$/u);
    expect(redis.evalWrite).not.toHaveBeenCalled();
  });

  it("atomically deletes only data, retains the anchor, and records exact audit fields", async () => {
    const fixture = terminalFixture();
    const redis = fakeRedis({
      read: () => [
        1,
        "ACK_RECOVERY_READY",
        ...fixture.identities,
        fixture.binding,
        fixture.token,
        fixture.ownerHash,
        "0",
        "",
        "",
        ""
      ],
      write: () => [1, "ACKNOWLEDGED_NEW", 1_787_910_000_000]
    });
    const prepared = await preflightProbeFallbackAckRecovery(redis.client, {
      repairCommit,
      signingSecret,
      evidencePath: "/var/tmp/toolproof-no-such-ack-evidence.json"
    });
    await expect(
      recoverProbeFallbackAck(redis.client, {
        prepared,
        confirmation: "0".repeat(64)
      })
    ).rejects.toMatchObject({ code: "ACK_RECOVERY_CONFIRMATION_MISMATCH" });
    expect(redis.evalWrite).not.toHaveBeenCalled();
    await expect(
      recoverProbeFallbackAck(redis.client, {
        prepared,
        confirmation: prepared.confirmation
      })
    ).resolves.toEqual({ disposition: "new", acknowledgedAtMs: 1_787_910_000_000 });
    expect(PROBE_FALLBACK_ACK_RECOVERY_SCRIPTS.recover.match(/redis\.call\("DEL"/gu)).toHaveLength(
      1
    );
    expect(PROBE_FALLBACK_ACK_RECOVERY_SCRIPTS.recover).toContain('redis.call("DEL", KEYS[2])');
    expect(PROBE_FALLBACK_ACK_RECOVERY_SCRIPTS.recover).not.toContain('redis.call("DEL", KEYS[1]');
    for (const field of [
      "ack_status",
      "ack_revision",
      "ack_payload_binding",
      "ack_mode",
      "ack_evidence_digest",
      "ack_raw_evidence_sha256",
      "ack_repair_commit",
      "ack_program_hash",
      "ack_confirmation",
      "ack_run_identity_digest",
      "ack_guard_snapshot_digest"
    ]) {
      expect(PROBE_FALLBACK_ACK_RECOVERY_SCRIPTS.recover).toContain(`"${field}"`);
    }
  });

  it("replays the exact stored confirmation and refuses an active normal owner", async () => {
    const fixture = terminalFixture();
    const initialRedis = fakeRedis({
      read: () => [
        1,
        "ACK_RECOVERY_READY",
        ...fixture.identities,
        fixture.binding,
        fixture.token,
        fixture.ownerHash,
        "0",
        "",
        "",
        ""
      ]
    });
    const initial = await preflightProbeFallbackAckRecovery(initialRedis.client, {
      repairCommit,
      signingSecret,
      evidencePath: "/var/tmp/toolproof-no-such-ack-evidence.json"
    });
    const replayRedis = fakeRedis({
      read: () => [
        2,
        "ACKNOWLEDGED_EXISTING",
        ...fixture.identities,
        fixture.binding,
        "",
        "",
        "1787910000000",
        initial.confirmation,
        initial.runIdentityDigest,
        initial.guardSnapshotDigest
      ]
    });
    const replay = await preflightProbeFallbackAckRecovery(replayRedis.client, {
      repairCommit,
      signingSecret,
      evidencePath: "/var/tmp/toolproof-no-such-ack-evidence.json"
    });
    expect(replay.confirmation).toBe(initial.confirmation);
    expect(replay.disposition).toBe("existing");
    expect(PROBE_FALLBACK_ACK_RECOVERY_SCRIPTS.preflight).toContain(
      'owner_expires_at_ms") or "0") > current_time_ms'
    );
    expect(PROBE_FALLBACK_ACK_RECOVERY_SCRIPTS.recover).toContain(
      'owner_expires_at_ms") or "0") > current_time_ms'
    );
  });

  it("requires the exact Production project, repair source, active target, and guard", () => {
    const environment: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_PROJECT_ID: PROBE_FALLBACK_ACK_RECOVERY_PROJECT_ID,
      TOOLPROOF_EXPECTED_VERCEL_PROJECT_ID: PROBE_FALLBACK_ACK_RECOVERY_PROJECT_ID,
      VERCEL_GIT_COMMIT_SHA: repairCommit,
      TOOLPROOF_PROBE_APPROVED_COMMIT: repairCommit,
      TOOLPROOF_PROBE_ACTIVE_COMMIT: PROBE_FALLBACK_ACK_RECOVERY_TARGET_APP_COMMIT,
      TOOLPROOF_PROBE_ACTIVATION_HASH: PROBE_FALLBACK_ACK_RECOVERY_TARGET_ACTIVATION_HASH,
      TOOLPROOF_PROBE_ACTIVATION_MODE: "calibration",
      TOOLPROOF_GUARD_INSTANCE_ID: PROBE_FALLBACK_ACK_RECOVERY_GUARD.guardInstanceId,
      TOOLPROOF_GUARD_INITIALIZED_COMMIT: PROBE_FALLBACK_ACK_RECOVERY_GUARD.initializedCommit,
      TOOLPROOF_SIGNING_SECRET: signingSecret
    };
    expect(assertProbeFallbackAckRecoveryProductionContext(environment)).toEqual({
      repairCommit,
      signingSecret
    });
    expect(() =>
      assertProbeFallbackAckRecoveryProductionContext({
        ...environment,
        TOOLPROOF_PROBE_ACTIVE_COMMIT: "f".repeat(40)
      })
    ).toThrowError("ACK_RECOVERY_PRODUCTION_CONTEXT_REQUIRED");
  });
});
