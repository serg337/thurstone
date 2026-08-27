import { describe, expect, it } from "vitest";

import { PROBE_TOKEN_TTL_SECONDS, probePolicyHash } from "@/lib/probe/policy";
import {
  ProbeTokenError,
  createProbeToken,
  verifyProbeToken,
  verifyProbeTokenForRecovery
} from "@/lib/probe/token";

const secret = Buffer.alloc(32, 7).toString("base64url");
const hash = (character: string) => character.repeat(64);

async function input() {
  return {
    policyHash: await probePolicyHash(),
    guardInstanceId: "guard_0123456789abcdef",
    buildCommit: "a".repeat(40),
    activationHash: hash("1"),
    sessionHash: hash("2"),
    purpose: "calibration" as const,
    runId: "run_0123456789abcdef",
    caseId: "case_0123456789abcdef",
    trialId: "trial_0123456789abcdef",
    fixtureHash: hash("b"),
    requestHash: hash("c"),
    manifestHash: hash("d"),
    settingsHash: hash("e"),
    envelopeHash: hash("f"),
    jti: "jti_0123456789abcdef",
    nowMs: 1_000_000
  };
}

describe("signed Probe authorization", () => {
  it("round-trips strict, origin-bound, short-lived claims", async () => {
    const tokenInput = await input();
    const signed = createProbeToken(tokenInput, secret);
    expect(verifyProbeToken(signed.token, secret, tokenInput.nowMs)).toEqual(signed.claims);
    expect(signed.claims.expiresAt - signed.claims.issuedAt).toBe(PROBE_TOKEN_TTL_SECONDS);
    expect(signed.claims.audience).toBe("https://toolproof-rust.vercel.app");
  });

  it("rejects tampering, expiry, and weak secrets", async () => {
    const tokenInput = await input();
    const signed = createProbeToken(tokenInput, secret);
    const tampered = `${signed.token.slice(0, -1)}${signed.token.endsWith("a") ? "b" : "a"}`;

    expect(() => verifyProbeToken(tampered, secret, tokenInput.nowMs)).toThrowError(
      expect.objectContaining<Partial<ProbeTokenError>>({ code: "invalid_signature" })
    );
    expect(() =>
      verifyProbeToken(
        signed.token,
        secret,
        tokenInput.nowMs + (PROBE_TOKEN_TTL_SECONDS + 1) * 1_000
      )
    ).toThrowError(expect.objectContaining<Partial<ProbeTokenError>>({ code: "expired_token" }));
    expect(verifyProbeTokenForRecovery(signed.token, secret)).toEqual(signed.claims);
    expect(() => verifyProbeTokenForRecovery(tampered, secret)).toThrowError(
      expect.objectContaining<Partial<ProbeTokenError>>({ code: "invalid_signature" })
    );
    expect(() => createProbeToken(tokenInput, "too-short")).toThrowError(
      expect.objectContaining<Partial<ProbeTokenError>>({ code: "weak_signing_secret" })
    );
  });
});
