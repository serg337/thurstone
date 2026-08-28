import {
  SCORED_RECOVERY_TTL_SECONDS,
  SCORED_SESSION_TTL_SECONDS,
  ScoredSessionError,
  issueRecoveredScoredSession,
  issueScoredRecovery,
  issueScoredSession,
  verifyScoredRecovery,
  verifyScoredSession
} from "@/lib/scored/session.server";
import { describe, expect, it } from "vitest";

const SECRET = Buffer.alloc(32, 17).toString("base64url");
const NOW = 1_787_950_000_000;
const binding = {
  phase: "baseline" as const,
  appCommit: "a".repeat(40),
  reviewPackageHash: "1".repeat(64),
  frozenProtocolHash: "2".repeat(64),
  freezeCandidateHash: "3".repeat(64),
  phaseCallOffset: 0,
  repairPhaseCallOffset: 0 as const,
  predecessorProtocolHash: null,
  predecessorEvidenceDigest: null,
  predecessorRunId: null,
  predecessorDisposition: null,
  actorHash: "4".repeat(64)
};

describe("scored session credentials", () => {
  it("binds session, CSRF, recovery, and renewed session to the exact frozen protocol", () => {
    const session = issueScoredSession({ ...binding, signingSecret: SECRET, nowMs: NOW });
    expect(session.claims.expiresAt - session.claims.issuedAt).toBe(SCORED_SESSION_TTL_SECONDS);
    expect(
      verifyScoredSession({
        ...binding,
        cookieValue: session.cookieValue,
        signingSecret: SECRET,
        csrfToken: session.csrfToken,
        nowMs: NOW
      })
    ).toEqual(session.claims);

    const recovery = issueScoredRecovery({
      session: session.claims,
      launchHash: "5".repeat(64),
      signingSecret: SECRET
    });
    expect(recovery.claims.expiresAt - recovery.claims.issuedAt).toBe(SCORED_RECOVERY_TTL_SECONDS);
    expect(
      verifyScoredRecovery({
        ...binding,
        cookieValue: recovery.cookieValue,
        signingSecret: SECRET,
        nowMs: NOW
      })
    ).toEqual(recovery.claims);

    const renewed = issueRecoveredScoredSession({
      recovery: recovery.claims,
      signingSecret: SECRET,
      nowMs: NOW + 60_000
    });
    expect(renewed.claims.runId).toBe(session.claims.runId);
    expect(renewed.claims.sessionId).toBe(session.claims.sessionId);
    expect(renewed.claims.csrfHash).not.toBe(session.claims.csrfHash);
  });

  it("rejects wrong CSRF, phase, protocol, actor, and expiry", () => {
    const session = issueScoredSession({ ...binding, signingSecret: SECRET, nowMs: NOW });
    for (const override of [
      { csrfToken: "wrong" },
      { phase: "revised" as const, csrfToken: session.csrfToken },
      { frozenProtocolHash: "f".repeat(64), csrfToken: session.csrfToken },
      {
        predecessorDisposition: "invalid-schedule" as const,
        csrfToken: session.csrfToken
      },
      { actorHash: "e".repeat(64), csrfToken: session.csrfToken }
    ]) {
      expect(() =>
        verifyScoredSession({
          ...binding,
          ...override,
          cookieValue: session.cookieValue,
          signingSecret: SECRET,
          nowMs: NOW
        })
      ).toThrow(ScoredSessionError);
    }
    expect(() =>
      verifyScoredSession({
        ...binding,
        cookieValue: session.cookieValue,
        signingSecret: SECRET,
        csrfToken: session.csrfToken,
        nowMs: NOW + SCORED_SESSION_TTL_SECONDS * 1_000
      })
    ).toThrow(/scored_session_binding_mismatch/u);
  });

  it("preserves superseded-protocol lineage across session and recovery credentials", () => {
    const replacement = {
      ...binding,
      phaseCallOffset: 24,
      repairPhaseCallOffset: 1 as const,
      predecessorProtocolHash: "6".repeat(64),
      predecessorEvidenceDigest: "7".repeat(64),
      predecessorRunId: `run_${"p".repeat(22)}`,
      predecessorDisposition: "superseded-protocol" as const
    };
    const session = issueScoredSession({ ...replacement, signingSecret: SECRET, nowMs: NOW });
    const recovery = issueScoredRecovery({
      session: session.claims,
      launchHash: "8".repeat(64),
      signingSecret: SECRET
    });
    expect(
      verifyScoredRecovery({
        ...replacement,
        cookieValue: recovery.cookieValue,
        signingSecret: SECRET,
        nowMs: NOW
      }).predecessorDisposition
    ).toBe("superseded-protocol");
  });
});
