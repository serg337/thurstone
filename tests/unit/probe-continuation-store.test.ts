import { describe, expect, it, vi } from "vitest";

import { canonicalJson } from "@/lib/evidence/digest";
import {
  PROBE_CONTINUATION_SCRIPTS,
  PROBE_CONTINUATION_TTL_SECONDS,
  ProbeContinuationError,
  getProbeContinuation,
  probeContinuationScriptHash,
  putProbeContinuation,
  type ProbeContinuationRedisClient
} from "@/lib/probe/continuation-store";
import { probeLedgerScriptHash } from "@/lib/probe/ledger";
import { probePolicyHash } from "@/lib/probe/policy";

const artifactSecret = Buffer.alloc(32, 7).toString("base64url");
const otherSecret = Buffer.alloc(32, 8).toString("base64url");
const jti = "jti_0123456789abcdef";
const createdAtMs = 1_777_777_777_000;
const expiresAtMs = createdAtMs + PROBE_CONTINUATION_TTL_SECONDS * 1_000;
const ttlMs = PROBE_CONTINUATION_TTL_SECONDS * 1_000;

function fakeRedis(options: {
  readonly eval?: (...args: unknown[]) => unknown | Promise<unknown>;
  readonly evalRo?: (...args: unknown[]) => unknown | Promise<unknown>;
}) {
  const evalMock = vi.fn(options.eval ?? (async () => [0, "UNEXPECTED_EVAL"]));
  const evalRoMock = vi.fn(options.evalRo ?? (async () => [0, "UNEXPECTED_EVAL_RO"]));
  return {
    client: { eval: evalMock, evalRo: evalRoMock } as unknown as ProbeContinuationRedisClient,
    evalMock,
    evalRoMock
  };
}

function storedReply(disposition: "STORED_NEW" | "STORED_EXISTING", args: unknown[]) {
  const redisArgs = args[2] as string[];
  return [
    disposition === "STORED_NEW" ? 1 : 2,
    disposition,
    redisArgs[3],
    redisArgs[2],
    createdAtMs,
    expiresAtMs,
    ttlMs
  ];
}

describe("encrypted Probe continuation store", () => {
  it("stores an encrypted issue continuation without sending plaintext truth to Redis", async () => {
    const payload = {
      expectedTool: "order_review",
      privateEvaluator: { score: true },
      request: "Review the simulated order."
    };
    const { client, evalMock } = fakeRedis({
      eval: async (...args) => storedReply("STORED_NEW", args)
    });
    const receipt = await putProbeContinuation(client, {
      jti,
      stage: "issue",
      payload,
      artifactSecret
    });
    expect(receipt).toMatchObject({
      disposition: "new",
      jti,
      stage: "issue",
      payload,
      createdAtMs,
      expiresAtMs,
      ttlRemainingMs: ttlMs
    });
    expect(receipt.token).not.toContain("order_review");
    expect(receipt.token).not.toContain("expectedTool");
    const redisArguments = JSON.stringify(evalMock.mock.calls[0]);
    expect(redisArguments).not.toContain("order_review");
    expect(redisArguments).not.toContain("expectedTool");
    expect(redisArguments).not.toContain(artifactSecret);
    expect(receipt.payloadBinding).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("returns the first encrypted token for an idempotent retry without extending TTL", async () => {
    let originalToken = "";
    let originalBinding = "";
    const first = fakeRedis({
      eval: async (...args) => {
        const redisArgs = args[2] as string[];
        originalToken = redisArgs[3] as string;
        originalBinding = redisArgs[2] as string;
        return storedReply("STORED_NEW", args);
      }
    });
    const payload = { decision: { kind: "clarify", text: "Which item?" } };
    await putProbeContinuation(first.client, {
      jti,
      stage: "decision",
      payload,
      artifactSecret
    });

    const retry = fakeRedis({
      eval: async () => [
        2,
        "STORED_EXISTING",
        originalToken,
        originalBinding,
        createdAtMs,
        expiresAtMs,
        ttlMs - 2_000
      ]
    });
    const recovered = await putProbeContinuation(retry.client, {
      jti,
      stage: "decision",
      payload,
      artifactSecret
    });
    expect(recovered.disposition).toBe("existing");
    expect(recovered.token).toBe(originalToken);
    expect(recovered.payload).toEqual(payload);
    expect(recovered.ttlRemainingMs).toBe(ttlMs - 2_000);
    expect(PROBE_CONTINUATION_SCRIPTS.put.indexOf("STORED_EXISTING")).toBeLessThan(
      PROBE_CONTINUATION_SCRIPTS.put.indexOf("PEXPIRE")
    );
  });

  it("recovers a completion continuation read-only and returns null after expiry", async () => {
    let token = "";
    let binding = "";
    const payload = { terminal: true, evidenceDigest: "a".repeat(64) };
    const writer = fakeRedis({
      eval: async (...args) => {
        const redisArgs = args[2] as string[];
        token = redisArgs[3] as string;
        binding = redisArgs[2] as string;
        return storedReply("STORED_NEW", args);
      }
    });
    await putProbeContinuation(writer.client, {
      jti,
      stage: "completion",
      payload,
      artifactSecret
    });

    const reader = fakeRedis({
      evalRo: async () => [1, "FOUND", token, binding, createdAtMs, expiresAtMs, ttlMs - 5_000]
    });
    const recovered = await getProbeContinuation<typeof payload>(reader.client, {
      jti,
      stage: "completion",
      artifactSecret
    });
    expect(recovered).toMatchObject({
      disposition: "recovered",
      payload,
      ttlRemainingMs: ttlMs - 5_000
    });
    expect(JSON.stringify(recovered?.payload)).not.toBe(JSON.stringify(payload));
    expect(canonicalJson(recovered?.payload)).toBe(canonicalJson(payload));
    expect(reader.evalMock).not.toHaveBeenCalled();
    expect(PROBE_CONTINUATION_SCRIPTS.get).not.toContain("PEXPIRE");

    const missing = fakeRedis({ evalRo: async () => [2, "MISSING"] });
    await expect(
      getProbeContinuation(missing.client, { jti, stage: "completion", artifactSecret })
    ).resolves.toBeNull();
  });

  it("rejects conflicting, corrupt, malformed, and identity-mismatched records", async () => {
    for (const reply of [
      [0, "CONTINUATION_CONFLICT"],
      [0, "CORRUPT_CONTINUATION"],
      [0, "CONTINUATION_IDENTITY_MISMATCH"]
    ]) {
      const { client } = fakeRedis({ eval: async () => reply });
      await expect(
        putProbeContinuation(client, {
          jti,
          stage: "issue",
          payload: { ok: true },
          artifactSecret
        })
      ).rejects.toBeInstanceOf(ProbeContinuationError);
    }

    const invalidReply = fakeRedis({
      evalRo: async () => [1, "FOUND", "broken", "a".repeat(64), 1, 2, 1]
    });
    await expect(
      getProbeContinuation(invalidReply.client, { jti, stage: "issue", artifactSecret })
    ).rejects.toBeInstanceOf(ProbeContinuationError);
  });

  it("rejects wrong secrets, invalid identifiers/stages, non-JSON payloads, and invalid TTL receipts", async () => {
    const never = fakeRedis({});
    await expect(
      putProbeContinuation(never.client, {
        jti: "short",
        stage: "issue",
        payload: {},
        artifactSecret
      })
    ).rejects.toMatchObject({ code: "INVALID_JTI" });
    await expect(
      putProbeContinuation(never.client, {
        jti,
        stage: "unknown" as "issue",
        payload: {},
        artifactSecret
      })
    ).rejects.toMatchObject({ code: "INVALID_STAGE" });
    await expect(
      putProbeContinuation(never.client, {
        jti,
        stage: "issue",
        payload: { invalid: undefined },
        artifactSecret
      })
    ).rejects.toBeInstanceOf(Error);
    await expect(
      putProbeContinuation(never.client, {
        jti,
        stage: "issue",
        payload: {},
        artifactSecret: "weak"
      })
    ).rejects.toMatchObject({ code: "WEAK_ARTIFACT_SECRET" });

    let token = "";
    let binding = "";
    const writer = fakeRedis({
      eval: async (...args) => {
        const redisArgs = args[2] as string[];
        token = redisArgs[3] as string;
        binding = redisArgs[2] as string;
        return storedReply("STORED_NEW", args);
      }
    });
    await putProbeContinuation(writer.client, {
      jti,
      stage: "issue",
      payload: { ok: true },
      artifactSecret
    });
    const wrongSecret = fakeRedis({
      evalRo: async () => [1, "FOUND", token, binding, createdAtMs, expiresAtMs, ttlMs]
    });
    await expect(
      getProbeContinuation(wrongSecret.client, {
        jti,
        stage: "issue",
        artifactSecret: otherSecret
      })
    ).rejects.toMatchObject({ code: "INVALID_CONTINUATION_ARTIFACT" });

    const invalidTtl = fakeRedis({
      evalRo: async () => [1, "FOUND", token, binding, createdAtMs, expiresAtMs, ttlMs + 1]
    });
    await expect(
      getProbeContinuation(invalidTtl.client, { jti, stage: "issue", artifactSecret })
    ).rejects.toMatchObject({ code: "INVALID_REPLY" });
  });

  it("keeps its scripts separately hashed and preserves frozen policy/ledger hashes", async () => {
    await expect(
      Promise.all([probeContinuationScriptHash(), probeContinuationScriptHash()])
    ).resolves.toEqual([await probeContinuationScriptHash(), await probeContinuationScriptHash()]);
    expect(PROBE_CONTINUATION_SCRIPTS.put).toContain('redis.call("PEXPIRE"');
    expect(PROBE_CONTINUATION_SCRIPTS.get).toContain('redis.call("PTTL"');
    await expect(probePolicyHash()).resolves.toBe(
      "8293eaee17e979eee1ca915a967ca3110f0d20068e4eda573554ae682dc563b0"
    );
    await expect(probeLedgerScriptHash()).resolves.toBe(
      "c25d90f7e060662867925e83c6d33dc7636f22b18cbcd94c3ffc6880eb907779"
    );
  });
});
