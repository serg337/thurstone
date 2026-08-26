import { describe, expect, it, vi } from "vitest";

import {
  PROBE_LEDGER_SCRIPTS,
  ProbeLedgerError,
  beginProbeCall,
  initializeProbeGuard,
  issueProbeAuthorization,
  probeLedgerScriptHash,
  reapExpiredProbeCall,
  settleProbeCallKnown,
  settleProbeCallUncertain,
  type ProbeGuardIdentity,
  type ProbeRedisClient
} from "@/lib/probe/ledger";

const identity: ProbeGuardIdentity = {
  guardInstanceId: "guard_0123456789abcdef",
  policyHash: "a".repeat(64),
  scriptHash: "b".repeat(64),
  initializedCommit: "f".repeat(40)
};

function fakeRedis(reply: unknown): {
  readonly client: ProbeRedisClient;
  readonly evalMock: ReturnType<typeof vi.fn>;
} {
  const evalMock = vi.fn(async () => reply);
  return {
    client: { eval: evalMock, evalRo: evalMock } as unknown as ProbeRedisClient,
    evalMock
  };
}

describe("durable Probe guard adapter", () => {
  it("freezes the reviewed Lua bundle hash", async () => {
    await expect(probeLedgerScriptHash()).resolves.toBe(
      "41d351ad5d1adb81b0c6a90aa930cf1ae932b053d58b097c0283846728b798d2"
    );
  });

  it("initializes only through the explicit operator transition", async () => {
    const { client } = fakeRedis([1, "INITIALIZED", identity.guardInstanceId]);
    await expect(initializeProbeGuard(client, identity, 1_000)).resolves.toBe("INITIALIZED");
    expect(PROBE_LEDGER_SCRIPTS.init).toContain('return {0, "CONFIG_MISMATCH"}');
    expect(PROBE_LEDGER_SCRIPTS.init).toContain(
      'if config_exists > 0 or redis.call("EXISTS", KEYS[2], KEYS[3], KEYS[4], KEYS[5]) > 0'
    );
  });

  it("issues one permanent subject authorization without consuming budget", async () => {
    const { client, evalMock } = fakeRedis([1, "ISSUED_NEW", "jti_0123456789abcdef", 1_000, 1_120]);
    await expect(
      issueProbeAuthorization(client, {
        ...identity,
        jti: "jti_0123456789abcdef",
        claimsHash: "c".repeat(64),
        purpose: "judge",
        subjectHash: "d".repeat(64),
        actorHash: "e".repeat(64)
      })
    ).resolves.toEqual({ disposition: "new", issuedAt: 1_000, expiresAt: 1_120 });
    expect(String(evalMock.mock.calls[0]?.[0])).not.toContain('claimed_calls", 1');
  });

  it("authorizes a provider call only on explicit GRANTED_NEW", async () => {
    const { client } = fakeRedis([1, "GRANTED_NEW", 1, 1, 62_500_000, 1_045]);
    await expect(
      beginProbeCall(client, {
        ...identity,
        jti: "jti_0123456789abcdef",
        claimsHash: "c".repeat(64),
        purpose: "calibration"
      })
    ).resolves.toEqual({
      sequence: 1,
      claimedCalls: 1,
      committedNanoUsd: 62_500_000,
      leaseExpiresAt: 1_045
    });

    const ambiguous = fakeRedis([2, "GRANTED_EXISTING", 1, 1, 62_500_000, 1_045]);
    await expect(
      beginProbeCall(ambiguous.client, {
        ...identity,
        jti: "jti_0123456789abcdef",
        claimsHash: "c".repeat(64),
        purpose: "calibration"
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<ProbeLedgerError>>({ code: "AMBIGUOUS_GRANT" })
    );
    expect(PROBE_LEDGER_SCRIPTS.begin).toContain('"halt_reason", "CONFIG_DRIFT"');
    expect(PROBE_LEDGER_SCRIPTS.begin).toContain('"halt_reason", "MISSING_COUNTER"');
    expect(PROBE_LEDGER_SCRIPTS.begin).toContain('"halt_reason", "COUNTER_DRIFT"');
    expect(PROBE_LEDGER_SCRIPTS.begin).toContain("value == math.floor(value)");
    expect(PROBE_LEDGER_SCRIPTS.begin).toContain("sequence_value ~= claimed");
    expect(PROBE_LEDGER_SCRIPTS.issue).toContain('return {0, "COMMIT_MISMATCH"}');
    expect(PROBE_LEDGER_SCRIPTS.settleKnown).toContain('return {0, "COMMIT_MISMATCH"}');
    expect(PROBE_LEDGER_SCRIPTS.settleUncertain).toContain('return {0, "COMMIT_MISMATCH"}');
    expect(PROBE_LEDGER_SCRIPTS.reap).toContain('return {0, "COMMIT_MISMATCH"}');
    expect(PROBE_LEDGER_SCRIPTS.begin).toContain('return {0, "CHALLENGE_CLOSED"}');
  });

  it("retains the stale JTI needed by the confirmed operator reap path", async () => {
    const { client } = fakeRedis([0, "STALE_INFLIGHT_REQUIRES_REAP", "jti_stale_0123456789"]);
    await beginProbeCall(client, {
      ...identity,
      jti: "jti_0123456789abcdef",
      claimsHash: "c".repeat(64),
      purpose: "calibration"
    }).then(
      () => {
        throw new Error("stale lease was not rejected");
      },
      (error: unknown) => {
        expect(error).toEqual(
          expect.objectContaining<Partial<ProbeLedgerError>>({
            code: "STALE_INFLIGHT_REQUIRES_REAP",
            details: ["jti_stale_0123456789"]
          })
        );
      }
    );
  });

  it("records known and uncertain terminal outcomes without restoring admission capacity", async () => {
    const known = fakeRedis([1, "KNOWN_NEW", 10_000_000, 1, 62_500_000]);
    await expect(
      settleProbeCallKnown(known.client, {
        ...identity,
        jti: "jti_0123456789abcdef",
        actualNanoUsd: 10_000_000,
        providerResponseHash: "c".repeat(64),
        settlementDigest: "d".repeat(64),
        usageHash: "e".repeat(64),
        settledAtMs: 2_000
      })
    ).resolves.toEqual({ disposition: "new", actualNanoUsd: 10_000_000 });

    const uncertain = fakeRedis([1, "UNCERTAIN_NEW", 62_500_000, 1, 62_500_000]);
    await expect(
      settleProbeCallUncertain(uncertain.client, {
        ...identity,
        jti: "jti_0123456789abcdef",
        settlementDigest: "f".repeat(64),
        reason: "provider_timeout",
        settledAtMs: 2_000
      })
    ).resolves.toEqual({ disposition: "new", upperBoundNanoUsd: 62_500_000 });

    expect(PROBE_LEDGER_SCRIPTS.settleKnown).not.toContain('"committed_nusd", -');
    expect(PROBE_LEDGER_SCRIPTS.settleKnown).toContain('redis.call("ZREM", KEYS[3], jti)');
    expect(PROBE_LEDGER_SCRIPTS.settleKnown).toContain('"halt_reason", "MISSING_INFLIGHT_LEASE"');
    expect(PROBE_LEDGER_SCRIPTS.settleUncertain).toContain('"status", "quarantined"');
    expect(PROBE_LEDGER_SCRIPTS.settleUncertain).toContain(
      'if config_status == "halted" then return {0, "GUARD_HALTED"} end'
    );
  });

  it("reaps an expired lease into uncertainty rather than reopening concurrency", async () => {
    const { client } = fakeRedis([1, "UNCERTAIN_NEW", 62_500_000]);
    await expect(
      reapExpiredProbeCall(client, {
        ...identity,
        jti: "jti_0123456789abcdef",
        settlementDigest: "a".repeat(64)
      })
    ).resolves.toEqual({ disposition: "new", upperBoundNanoUsd: 62_500_000 });
    expect(PROBE_LEDGER_SCRIPTS.reap).toContain('"uncertain_reason", "lease_expired"');
  });

  it("keeps subject, authorization, policy, and counter records free of TTL resets", () => {
    expect(PROBE_LEDGER_SCRIPTS.issue).not.toContain('redis.call("EXPIRE"');
    expect(PROBE_LEDGER_SCRIPTS.begin).not.toContain('redis.call("EXPIRE"');
  });
});
