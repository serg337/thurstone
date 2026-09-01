import {
  BYOA_HANDOFF_LEDGER_V2_ACTIVE_KEY,
  BYOA_HANDOFF_LEDGER_V2_ACTIVE_LIMIT,
  BYOA_HANDOFF_LEDGER_V2_FINALIZATION_GRACE_MS,
  BYOA_HANDOFF_LEDGER_V2_ISSUE_LIMIT,
  BYOA_HANDOFF_LEDGER_V2_ISSUE_RATE_KEY,
  BYOA_HANDOFF_LEDGER_V2_ISSUE_WINDOW_MS,
  BYOA_HANDOFF_LEDGER_V2_MAX_TTL_MS,
  BYOA_HANDOFF_LEDGER_V2_NAMESPACE,
  BYOA_HANDOFF_LEDGER_V2_SCRIPTS,
  BYOA_HANDOFF_LEDGER_V2_TIMEOUT_MS,
  ByoaHandoffLedgerV2Error,
  byoaHandoffLedgerV2Key,
  claimByoaHandoffV2,
  createByoaHandoffLedgerV2Redis,
  digestByoaHandoffV2Context,
  digestByoaHandoffV2Token,
  grantByoaHandoffV2Reveal,
  issueByoaHandoffV2,
  readByoaHandoffV2Status,
  receiveByoaHandoffV2,
  resetByoaHandoffLedgerV2FakeForTests,
  revokeByoaHandoffV2,
  settleByoaHandoffV2,
  startByoaHandoffV2,
  timeoutByoaHandoffV2,
  type ByoaHandoffLedgerV2Redis
} from "@/lib/demo/handoff-ledger-v2.server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const START = 1_788_200_000_000;
let sequence = 0;

function binding() {
  sequence += 1;
  return {
    runId: `byoa_run_00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    contractDigest: sequence.toString(16).padStart(64, "0"),
    token: `tbh2.test-token-material-${sequence.toString().padStart(24, "0")}`,
    freshContextId: `fresh_00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`
  } as const;
}

function fakeRedis(): ByoaHandoffLedgerV2Redis {
  return createByoaHandoffLedgerV2Redis({
    NODE_ENV: "test",
    TOOLPROOF_BROWSER_FAKE_PROBE: "1"
  } as NodeJS.ProcessEnv);
}

async function issued(redis: ByoaHandoffLedgerV2Redis, value = binding()) {
  const receipt = await issueByoaHandoffV2(redis, {
    ...value,
    expiresAtMs: Date.now() + 10 * 60 * 1000
  });
  return { value, receipt };
}

describe("ephemeral atomic BYOA Handoff v2 ledger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    resetByoaHandoffLedgerV2FakeForTests({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses a strict isolated keyspace, bounded TTL, and digest-only tiny fields", async () => {
    const redis = fakeRedis();
    const { value, receipt } = await issued(redis);
    expect(receipt).toMatchObject({ disposition: "ISSUED_NEW", state: "ISSUED" });
    expect(byoaHandoffLedgerV2Key(value.runId)).toBe(
      `${BYOA_HANDOFF_LEDGER_V2_NAMESPACE}:${value.runId}`
    );
    expect(byoaHandoffLedgerV2Key(value.runId)).not.toContain(":auth:");
    expect(byoaHandoffLedgerV2Key(value.runId)).not.toContain(":totals");
    expect(BYOA_HANDOFF_LEDGER_V2_ISSUE_RATE_KEY).toBe(
      `${BYOA_HANDOFF_LEDGER_V2_NAMESPACE}:issuance-rate`
    );
    expect(BYOA_HANDOFF_LEDGER_V2_ACTIVE_KEY).toBe(`${BYOA_HANDOFF_LEDGER_V2_NAMESPACE}:active`);
    expect(BYOA_HANDOFF_LEDGER_V2_ISSUE_RATE_KEY).not.toContain(":auth:");
    expect(BYOA_HANDOFF_LEDGER_V2_ACTIVE_KEY).not.toContain(":totals");

    const status = await readByoaHandoffV2Status(redis, value.runId);
    expect(status).toMatchObject({
      state: "ISSUED",
      contractDigest: value.contractDigest,
      tokenDigest: digestByoaHandoffV2Token(value.token),
      freshContextDigest: null
    });
    expect(status!.ttlMs).toBeLessThanOrEqual(BYOA_HANDOFF_LEDGER_V2_MAX_TTL_MS);
    expect(JSON.stringify(status)).not.toContain(value.token);
    expect(() => byoaHandoffLedgerV2Key("byoa_run_bad")).toThrow("INVALID_RUN_ID");
  });

  it("issues idempotently only for the exact binding", async () => {
    const redis = fakeRedis();
    const { value } = await issued(redis);
    const existing = await issueByoaHandoffV2(redis, {
      ...value,
      expiresAtMs: Date.now() + 10 * 60 * 1000
    });
    expect(existing.disposition).toBe("ISSUE_EXISTING");
    await expect(
      issueByoaHandoffV2(redis, {
        ...value,
        token: `${value.token}-different`,
        expiresAtMs: Date.now() + 10 * 60 * 1000
      })
    ).rejects.toMatchObject({ code: "HANDOFF_ISSUE_CONFLICT" });
  });

  it("charges an exact issue once and enforces the rolling issuance cap with Redis time", async () => {
    const redis = fakeRedis();
    const first = binding();
    const expiresAtMs = Date.now() + 10 * 60 * 1000;
    await issueByoaHandoffV2(redis, { ...first, expiresAtMs });
    await expect(issueByoaHandoffV2(redis, { ...first, expiresAtMs })).resolves.toMatchObject({
      disposition: "ISSUE_EXISTING"
    });
    for (let index = 1; index < BYOA_HANDOFF_LEDGER_V2_ISSUE_LIMIT; index += 1) {
      await issueByoaHandoffV2(redis, {
        ...binding(),
        expiresAtMs: Date.now() + 10 * 60 * 1000
      });
    }
    await expect(
      issueByoaHandoffV2(redis, {
        ...binding(),
        expiresAtMs: Date.now() + 10 * 60 * 1000
      })
    ).rejects.toMatchObject({ code: "HANDOFF_ISSUE_RATE_LIMIT" });

    vi.setSystemTime(START + BYOA_HANDOFF_LEDGER_V2_ISSUE_WINDOW_MS + 1);
    await expect(
      issueByoaHandoffV2(redis, {
        ...binding(),
        expiresAtMs: Date.now() + 10 * 60 * 1000
      })
    ).resolves.toMatchObject({ disposition: "ISSUED_NEW" });
  });

  it("bounds active unexpired handoffs and releases capacity on revoke and terminal state", async () => {
    const redis = fakeRedis();
    const values: ReturnType<typeof binding>[] = [];
    for (let index = 0; index < BYOA_HANDOFF_LEDGER_V2_ACTIVE_LIMIT; index += 1) {
      if (index > 0 && index % BYOA_HANDOFF_LEDGER_V2_ISSUE_LIMIT === 0) {
        vi.setSystemTime(Date.now() + BYOA_HANDOFF_LEDGER_V2_ISSUE_WINDOW_MS + 1);
      }
      const value = binding();
      values.push(value);
      await issueByoaHandoffV2(redis, {
        ...value,
        expiresAtMs: Date.now() + 10 * 60 * 1000
      });
    }
    await expect(
      issueByoaHandoffV2(redis, {
        ...binding(),
        expiresAtMs: Date.now() + 10 * 60 * 1000
      })
    ).rejects.toMatchObject({ code: "HANDOFF_ACTIVE_LIMIT" });

    await revokeByoaHandoffV2(redis, values[0]!);
    await expect(
      issueByoaHandoffV2(redis, {
        ...binding(),
        expiresAtMs: Date.now() + 10 * 60 * 1000
      })
    ).resolves.toMatchObject({ disposition: "ISSUED_NEW" });

    const terminal = values[1]!;
    await claimByoaHandoffV2(redis, terminal);
    await receiveByoaHandoffV2(redis, terminal);
    await startByoaHandoffV2(redis, terminal);
    await settleByoaHandoffV2(redis, terminal, "SETTLED");
    await expect(
      issueByoaHandoffV2(redis, {
        ...binding(),
        expiresAtMs: Date.now() + 10 * 60 * 1000
      })
    ).resolves.toMatchObject({ disposition: "ISSUED_NEW" });
    await expect(readByoaHandoffV2Status(redis, terminal.runId)).resolves.toMatchObject({
      state: "SETTLED"
    });
  });

  it("claims once, retries in the same context, and rejects a second context", async () => {
    const redis = fakeRedis();
    const { value } = await issued(redis);
    await expect(claimByoaHandoffV2(redis, value)).resolves.toMatchObject({
      disposition: "CLAIMED_NEW",
      state: "CLAIMED"
    });
    await expect(claimByoaHandoffV2(redis, value)).resolves.toMatchObject({
      disposition: "CLAIM_EXISTING",
      state: "CLAIMED"
    });
    expect((await readByoaHandoffV2Status(redis, value.runId))!.freshContextDigest).toBe(
      digestByoaHandoffV2Context(value.freshContextId)
    );
    await expect(
      claimByoaHandoffV2(redis, {
        ...value,
        freshContextId: "fresh_ffffffff-ffff-4fff-8fff-ffffffffffff"
      })
    ).rejects.toMatchObject({ code: "HANDOFF_ALREADY_CLAIMED" });
  });

  it("bootstraps only the claimed context and marks RECEIVED idempotently", async () => {
    const redis = fakeRedis();
    const { value } = await issued(redis);
    await expect(receiveByoaHandoffV2(redis, value)).rejects.toMatchObject({
      code: "HANDOFF_BINDING_MISMATCH"
    });
    await claimByoaHandoffV2(redis, value);
    await expect(receiveByoaHandoffV2(redis, value)).resolves.toMatchObject({
      disposition: "RECEIVED_NEW",
      state: "RECEIVED"
    });
    await expect(receiveByoaHandoffV2(redis, value)).resolves.toMatchObject({
      disposition: "RECEIVED_EXISTING",
      state: "RECEIVED"
    });
  });

  it("rejects early reveal and a second explicit start", async () => {
    const redis = fakeRedis();
    const { value } = await issued(redis);
    await claimByoaHandoffV2(redis, value);
    await receiveByoaHandoffV2(redis, value);
    await expect(grantByoaHandoffV2Reveal(redis, value)).rejects.toMatchObject({
      code: "HANDOFF_REVEAL_TOO_EARLY"
    });
    await expect(startByoaHandoffV2(redis, value)).resolves.toMatchObject({ state: "STARTED" });
    await expect(startByoaHandoffV2(redis, value)).rejects.toMatchObject({
      code: "HANDOFF_START_INVALID_STATE"
    });
  });

  it("refuses START atomically when a full timeout plus finalization grace cannot fit", async () => {
    const redis = fakeRedis();
    const value = binding();
    await issueByoaHandoffV2(redis, {
      ...value,
      expiresAtMs:
        START + BYOA_HANDOFF_LEDGER_V2_TIMEOUT_MS + BYOA_HANDOFF_LEDGER_V2_FINALIZATION_GRACE_MS - 1
    });
    await claimByoaHandoffV2(redis, value);
    await receiveByoaHandoffV2(redis, value);
    await expect(startByoaHandoffV2(redis, value)).rejects.toMatchObject({
      code: "HANDOFF_LIFETIME_INSUFFICIENT"
    });
    await expect(readByoaHandoffV2Status(redis, value.runId)).resolves.toMatchObject({
      state: "RECEIVED",
      startedAtMs: null
    });
  });

  it("grants reveal only after SETTLED or UNAVAILABLE from STARTED", async () => {
    const redis = fakeRedis();
    const { value } = await issued(redis);
    await claimByoaHandoffV2(redis, value);
    await receiveByoaHandoffV2(redis, value);
    await expect(settleByoaHandoffV2(redis, value, "SETTLED")).rejects.toMatchObject({
      code: "HANDOFF_TERMINAL_INVALID_STATE"
    });
    await startByoaHandoffV2(redis, value);
    await settleByoaHandoffV2(redis, value, "SETTLED");
    await expect(grantByoaHandoffV2Reveal(redis, value)).resolves.toMatchObject({
      state: "SETTLED"
    });
    await expect(settleByoaHandoffV2(redis, value, "UNAVAILABLE")).rejects.toMatchObject({
      code: "HANDOFF_TERMINAL_INVALID_STATE"
    });
  });

  it("uses the server clock for the complete 120-second timeout boundary", async () => {
    const redis = fakeRedis();
    const { value } = await issued(redis);
    await claimByoaHandoffV2(redis, value);
    await receiveByoaHandoffV2(redis, value);
    const started = await startByoaHandoffV2(redis, value);
    expect(started.startedAtMs).toBe(START);
    await expect(timeoutByoaHandoffV2(redis, value)).rejects.toMatchObject({
      code: "HANDOFF_TIMEOUT_EARLY"
    });
    vi.setSystemTime(START + BYOA_HANDOFF_LEDGER_V2_TIMEOUT_MS - 1);
    await expect(timeoutByoaHandoffV2(redis, value)).rejects.toMatchObject({
      code: "HANDOFF_TIMEOUT_EARLY"
    });
    vi.setSystemTime(START + BYOA_HANDOFF_LEDGER_V2_TIMEOUT_MS);
    await expect(timeoutByoaHandoffV2(redis, value)).resolves.toMatchObject({
      state: "TIMED_OUT"
    });
    await expect(grantByoaHandoffV2Reveal(redis, value)).resolves.toMatchObject({
      state: "TIMED_OUT"
    });
  });

  it("revokes only unclaimed issuance and expires without persistent residue", async () => {
    const redis = fakeRedis();
    const first = await issued(redis);
    await expect(revokeByoaHandoffV2(redis, first.value)).resolves.toMatchObject({
      state: "REVOKED",
      disposition: "REVOKED_NEW"
    });
    await expect(revokeByoaHandoffV2(redis, first.value)).resolves.toMatchObject({
      disposition: "REVOKED_EXISTING"
    });
    await expect(readByoaHandoffV2Status(redis, first.value.runId)).resolves.toMatchObject({
      state: "REVOKED"
    });
    await expect(claimByoaHandoffV2(redis, first.value)).rejects.toBeInstanceOf(
      ByoaHandoffLedgerV2Error
    );

    const second = await issued(redis);
    await claimByoaHandoffV2(redis, second.value);
    await expect(revokeByoaHandoffV2(redis, second.value)).rejects.toMatchObject({
      code: "HANDOFF_REVOKE_INVALID_STATE"
    });
    vi.setSystemTime(START + 10 * 60 * 1000 + 1);
    await expect(readByoaHandoffV2Status(redis, second.value.runId)).resolves.toBeNull();
  });

  it("fails closed when the durable Redis boundary is unavailable", async () => {
    const redis: ByoaHandoffLedgerV2Redis = {
      eval: vi.fn().mockRejectedValue(new Error("redis unavailable")),
      evalRo: vi.fn().mockRejectedValue(new Error("redis unavailable"))
    };
    const value = binding();
    await expect(
      issueByoaHandoffV2(redis, { ...value, expiresAtMs: Date.now() + 60_000 })
    ).rejects.toThrow("redis unavailable");
    await expect(grantByoaHandoffV2Reveal(redis, value)).rejects.toThrow("redis unavailable");
  });

  it("forbids the in-memory ledger and test reset in production", () => {
    expect(() =>
      createByoaHandoffLedgerV2Redis({
        NODE_ENV: "production",
        TOOLPROOF_BROWSER_FAKE_PROBE: "1"
      } as NodeJS.ProcessEnv)
    ).toThrow("BROWSER_FAKE_LEDGER_FORBIDDEN");
    expect(() =>
      resetByoaHandoffLedgerV2FakeForTests({ NODE_ENV: "production" } as NodeJS.ProcessEnv)
    ).toThrow("BROWSER_FAKE_RESET_FORBIDDEN");
  });

  it("ships Lua that uses Redis TIME and one-key expiry rather than probe guard keys", () => {
    for (const [operation, script] of Object.entries(BYOA_HANDOFF_LEDGER_V2_SCRIPTS)) {
      expect(script).not.toContain(":auth:");
      expect(script).not.toContain("purpose-counts");
      if (operation !== "read") expect(script).toContain('redis.call("TIME")');
    }
    expect(BYOA_HANDOFF_LEDGER_V2_SCRIPTS.issue).toContain('redis.call("PEXPIREAT"');
    expect(BYOA_HANDOFF_LEDGER_V2_SCRIPTS.issue).toContain('redis.call("ZREMRANGEBYSCORE"');
    expect(BYOA_HANDOFF_LEDGER_V2_SCRIPTS.issue).toContain('redis.call("ZCARD"');
    expect(BYOA_HANDOFF_LEDGER_V2_SCRIPTS.terminal).toContain('redis.call("ZREM"');
    expect(BYOA_HANDOFF_LEDGER_V2_SCRIPTS.timeout).toContain('redis.call("ZREM"');
    expect(BYOA_HANDOFF_LEDGER_V2_SCRIPTS.revoke).toContain('redis.call("ZREM"');
    expect(BYOA_HANDOFF_LEDGER_V2_SCRIPTS.timeout).toContain("started_at_ms + tonumber(ARGV[5])");
  });
});
