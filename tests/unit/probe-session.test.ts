import { describe, expect, it } from "vitest";

import {
  PROBE_RECOVERY_TTL_SECONDS,
  PROBE_SESSION_TTL_SECONDS,
  deriveProbeActorHash,
  issueProbeRecoveryCredential,
  issueRecoveredProbeSession,
  issueProbeSession,
  probeRecoveryCookieOptions,
  probeSessionCookieOptions,
  verifyProbeRecoveryCredential,
  verifyProbeSession
} from "@/lib/probe/session";

const signingSecret = Buffer.alloc(32, 3).toString("base64url");
const binding = {
  activationHash: "a".repeat(64),
  buildCommit: "b".repeat(40),
  actorHash: "c".repeat(64),
  signingSecret
};

describe("Probe session", () => {
  it("issues an opaque cookie and verifies activation, build, actor, CSRF, and lifetime", () => {
    const nowMs = Date.parse("2026-08-27T12:00:00.000Z");
    const issued = issueProbeSession({ ...binding, nowMs });
    expect(issued.cookieValue).not.toContain(issued.csrfToken);
    expect(
      verifyProbeSession({
        cookieValue: issued.cookieValue,
        signingSecret,
        activationHash: binding.activationHash,
        buildCommit: binding.buildCommit,
        actorHash: binding.actorHash,
        csrfToken: issued.csrfToken,
        nowMs: nowMs + 1_000
      })
    ).toEqual(issued.claims);
    expect(issued.claims.expiresAt - issued.claims.issuedAt).toBe(PROBE_SESSION_TTL_SECONDS);
  });

  it("rejects mismatched bindings, CSRF, and expiry", () => {
    const nowMs = Date.parse("2026-08-27T12:00:00.000Z");
    const issued = issueProbeSession({ ...binding, nowMs });
    const common = {
      cookieValue: issued.cookieValue,
      signingSecret,
      activationHash: binding.activationHash,
      buildCommit: binding.buildCommit,
      nowMs: nowMs + 1_000
    };
    expect(() => verifyProbeSession({ ...common, csrfToken: "x".repeat(43) })).toThrowError(
      /csrf_mismatch/u
    );
    expect(() => verifyProbeSession({ ...common, buildCommit: "d".repeat(40) })).toThrowError(
      /session_binding_mismatch/u
    );
    expect(() =>
      verifyProbeSession({ ...common, nowMs: nowMs + (PROBE_SESSION_TTL_SECONDS + 1) * 1_000 })
    ).toThrowError(/session_expired/u);
  });

  it("recovers the same run with fresh short sessions for the full fixed recovery window", () => {
    const nowMs = Date.parse("2026-08-27T12:00:00.000Z");
    const original = issueProbeSession({ ...binding, nowMs });
    const recovery = issueProbeRecoveryCredential({
      session: original.claims,
      launchHash: "d".repeat(64),
      signingSecret
    });
    expect(recovery.cookieValue).not.toContain(original.claims.runId);
    expect(recovery.claims.expiresAt - recovery.claims.issuedAt).toBe(PROBE_RECOVERY_TTL_SECONDS);
    expect(
      verifyProbeRecoveryCredential({
        cookieValue: recovery.cookieValue,
        signingSecret,
        activationHash: binding.activationHash,
        buildCommit: binding.buildCommit,
        actorHash: binding.actorHash,
        nowMs: nowMs + 30 * 60_000
      })
    ).toEqual(recovery.claims);

    const refreshed = issueRecoveredProbeSession({
      recovery: recovery.claims,
      signingSecret,
      nowMs: nowMs + 30 * 60_000
    });
    expect(refreshed.claims).toMatchObject({
      sessionId: original.claims.sessionId,
      runId: original.claims.runId
    });
    expect(refreshed.csrfToken).not.toBe(original.csrfToken);

    const nearExpiryMs = (recovery.claims.expiresAt - 5 * 60) * 1_000;
    const shortened = issueRecoveredProbeSession({
      recovery: recovery.claims,
      signingSecret,
      nowMs: nearExpiryMs
    });
    expect(shortened.claims.expiresAt).toBe(recovery.claims.expiresAt);
    expect(shortened.claims.expiresAt - shortened.claims.issuedAt).toBe(5 * 60);
    expect(
      verifyProbeSession({
        cookieValue: shortened.cookieValue,
        signingSecret,
        activationHash: binding.activationHash,
        buildCommit: binding.buildCommit,
        actorHash: binding.actorHash,
        csrfToken: shortened.csrfToken,
        nowMs: nearExpiryMs + 1_000
      })
    ).toEqual(shortened.claims);
  });

  it("derives a private stable actor hash without retaining network identifiers", () => {
    const request = new Request("https://toolproof-rust.vercel.app/api/probe/session", {
      headers: {
        "x-vercel-forwarded-for": "203.0.113.4, 10.0.0.1",
        "user-agent": "Fixture Browser"
      }
    });
    const actor = deriveProbeActorHash(request, signingSecret);
    expect(actor).toMatch(/^[a-f0-9]{64}$/u);
    expect(actor).not.toContain("203.0.113.4");
    expect(deriveProbeActorHash(request, signingSecret)).toBe(actor);
  });

  it("uses an HttpOnly, Secure, same-site strict cookie", () => {
    expect(probeSessionCookieOptions()).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/"
    });
    expect(probeRecoveryCookieOptions()).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: PROBE_RECOVERY_TTL_SECONDS
    });
  });
});
