import { describe, expect, it, vi } from "vitest";

import {
  PROBE_RUN_INDEX_SCRIPTS,
  PROBE_RUN_INDEX_TTL_SECONDS,
  advanceProbeRunIndex,
  createProbeRunIndexKeyspace,
  deleteUnstartedProbeRunIndex,
  getProbeRunIndex,
  probeRunIndexScriptHash,
  putProbeRunIndex,
  type ProbeRunIndexRedisClient
} from "@/lib/probe/run-index";
import { issueProbeRecoveryCredential, issueProbeSession } from "@/lib/probe/session";

const signingSecret = Buffer.alloc(32, 17).toString("base64url");
const nowMs = Date.parse("2026-08-27T12:00:00.000Z");
const createdAtMs = nowMs;
const expiresAtMs = createdAtMs + PROBE_RUN_INDEX_TTL_SECONDS * 1_000;
const ttlMs = PROBE_RUN_INDEX_TTL_SECONDS * 1_000;

function recovery() {
  const session = issueProbeSession({
    activationHash: "a".repeat(64),
    buildCommit: "b".repeat(40),
    actorHash: "c".repeat(64),
    signingSecret,
    nowMs
  });
  return issueProbeRecoveryCredential({
    session: session.claims,
    launchHash: "d".repeat(64),
    signingSecret
  }).claims;
}

function fakeRedis(options: {
  readonly eval?: (...args: unknown[]) => unknown | Promise<unknown>;
  readonly evalRo?: (...args: unknown[]) => unknown | Promise<unknown>;
}) {
  const evalMock = vi.fn(options.eval ?? (async () => [0, "UNEXPECTED_EVAL"]));
  const evalRoMock = vi.fn(options.evalRo ?? (async () => [0, "UNEXPECTED_EVAL_RO"]));
  return {
    client: { eval: evalMock, evalRo: evalRoMock } as unknown as ProbeRunIndexRedisClient,
    evalMock,
    evalRoMock
  };
}

describe("encrypted monotonic Probe run index", () => {
  it("stores only an encrypted continuation with a fixed non-sliding deadline", async () => {
    const claims = recovery();
    const continuation = `tpse1.${"x".repeat(64)}.opaque-continuation`;
    const { client, evalMock } = fakeRedis({
      eval: async (...args) => {
        const values = args[2] as string[];
        return [1, "STORED_NEW", values[8], values[7], 0, createdAtMs, expiresAtMs, ttlMs];
      }
    });
    const receipt = await putProbeRunIndex(client, {
      recovery: claims,
      continuation,
      artifactSecret: signingSecret
    });
    expect(receipt).toMatchObject({
      disposition: "new",
      revision: 0,
      nextOrdinal: 0,
      payload: { continuation, terminal: false }
    });
    const redisCall = JSON.stringify(evalMock.mock.calls[0]);
    expect(redisCall).not.toContain(continuation);
    expect(redisCall).not.toContain(claims.recoveryId);
    expect(redisCall).not.toContain(claims.sessionId);
    expect(redisCall).not.toContain(claims.runId);
    expect(PROBE_RUN_INDEX_SCRIPTS.put).toContain('redis.call("PEXPIRE", KEYS[2], ttl_ms)');
  });

  it("recovers read-only and advances exactly one ordinal without extending TTL", async () => {
    const claims = recovery();
    let token = "";
    let binding = "";
    const writer = fakeRedis({
      eval: async (...args) => {
        const values = args[2] as string[];
        token = values[8] ?? "";
        binding = values[7] ?? "";
        return [1, "STORED_NEW", token, binding, 0, createdAtMs, expiresAtMs, ttlMs];
      }
    });
    const initial = await putProbeRunIndex(writer.client, {
      recovery: claims,
      continuation: `tpse1.${"a".repeat(64)}.initial`,
      artifactSecret: signingSecret
    });
    const reader = fakeRedis({
      evalRo: async () => [1, "FOUND", token, binding, 0, createdAtMs, expiresAtMs, ttlMs - 5_000]
    });
    await expect(
      getProbeRunIndex(reader.client, { recovery: claims, artifactSecret: signingSecret })
    ).resolves.toMatchObject({ disposition: "recovered", nextOrdinal: 0 });
    expect(reader.evalMock).not.toHaveBeenCalled();

    const advancer = fakeRedis({
      eval: async (...args) => {
        const values = args[2] as string[];
        return [
          1,
          "ADVANCED_NEW",
          values[10],
          values[8],
          1,
          createdAtMs,
          expiresAtMs,
          ttlMs - 6_000
        ];
      }
    });
    const advanced = await advanceProbeRunIndex(advancer.client, {
      recovery: claims,
      current: initial,
      continuation: `tpse1.${"b".repeat(64)}.advanced`,
      documentId: `document_${"d".repeat(32)}`,
      artifactSecret: signingSecret
    });
    expect(advanced).toMatchObject({ revision: 1, nextOrdinal: 1, payload: { terminal: false } });
    expect(PROBE_RUN_INDEX_SCRIPTS.get).not.toContain("PEXPIRE");
    expect(PROBE_RUN_INDEX_SCRIPTS.advance).not.toContain("PEXPIRE");
  });

  it("deletes the permanent start anchor only through exact pre-grant guard admission", async () => {
    const claims = recovery();
    const { client, evalMock } = fakeRedis({ eval: async () => [1, "DELETED"] });
    await expect(
      deleteUnstartedProbeRunIndex(client, {
        recovery: claims,
        artifactSecret: signingSecret,
        guard: {
          configKey: "tp:{webmcp26}:config",
          totalsKey: "tp:{webmcp26}:totals",
          purposeCountsKey: "tp:{webmcp26}:purpose-counts",
          inflightKey: "tp:{webmcp26}:inflight",
          guardInstanceId: "guard_0123456789abcdef",
          policyHash: "d".repeat(64),
          scriptHash: "e".repeat(64),
          initializedCommit: "f".repeat(40),
          baseCalibrationCalls: 5,
          authorizationKey: "tp:{webmcp26}:auth:jti_cleanup_fixture_001",
          jti: "jti_cleanup_fixture_001"
        }
      })
    ).resolves.toBe("deleted");
    expect(evalMock).toHaveBeenCalledOnce();
    expect(PROBE_RUN_INDEX_SCRIPTS.deleteUnstarted).toContain(
      'redis.call("HGET", KEYS[2], "revision") ~= "0"'
    );
    expect(PROBE_RUN_INDEX_SCRIPTS.deleteUnstarted).toContain(
      'redis.call("HGET", KEYS[4], "claimed_calls") ~= ARGV[12]'
    );
  });

  it("fails closed on conflicts, malformed identities, and non-monotonic state", async () => {
    const claims = recovery();
    const conflict = fakeRedis({ eval: async () => [0, "RUN_INDEX_CONFLICT"] });
    await expect(
      putProbeRunIndex(conflict.client, {
        recovery: claims,
        continuation: `tpse1.${"a".repeat(64)}.initial`,
        artifactSecret: signingSecret
      })
    ).rejects.toMatchObject({ code: "RUN_INDEX_CONFLICT" });
    expect(() => createProbeRunIndexKeyspace("unsafe")).toThrowError(/INVALID_NAMESPACE/u);
    const missing = fakeRedis({ evalRo: async () => [2, "MISSING"] });
    await expect(
      getProbeRunIndex(missing.client, { recovery: claims, artifactSecret: signingSecret })
    ).resolves.toBeNull();
  });

  it("hashes the complete run-index script set deterministically", async () => {
    await expect(
      Promise.all([probeRunIndexScriptHash(), probeRunIndexScriptHash()])
    ).resolves.toEqual([await probeRunIndexScriptHash(), await probeRunIndexScriptHash()]);
  });
});
