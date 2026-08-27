import { describe, expect, it } from "vitest";

import {
  advanceProbeRunContinuation,
  createInitialProbeRunContinuation,
  deriveProbeTrialOpaqueIds,
  openProbeRunContinuation
} from "@/lib/probe/run-continuation.server";
import {
  issueProbeRecoveryCredential,
  issueProbeSession,
  issueRecoveredProbeSession
} from "@/lib/probe/session";

const signingSecret = Buffer.alloc(32, 9).toString("base64url");
const activationSecret = Buffer.alloc(32, 10).toString("base64url");
const nowMs = Date.parse("2026-08-27T12:00:00.000Z");

function session() {
  const issued = issueProbeSession({
    activationHash: "a".repeat(64),
    buildCommit: "b".repeat(40),
    actorHash: "c".repeat(64),
    signingSecret,
    nowMs
  });
  return {
    session: issued.claims,
    recovery: issueProbeRecoveryCredential({
      session: issued.claims,
      launchHash: "d".repeat(64),
      signingSecret
    }).claims
  };
}

describe("opaque Probe run continuation", () => {
  it("creates a sealed empty run and advances an exact contiguous prefix", async () => {
    const { session: claims, recovery } = session();
    const initialToken = await createInitialProbeRunContinuation({
      recovery,
      signingSecret
    });
    expect(initialToken).not.toContain(claims.runId);
    const initial = await openProbeRunContinuation({
      token: initialToken,
      signingSecret,
      session: claims,
      recovery,
      activationHash: claims.activationHash,
      buildCommit: claims.buildCommit,
      nowMs: nowMs + 1_000
    });
    expect(initial).toMatchObject({ nextOrdinal: 0, rows: [] });

    const ids = deriveProbeTrialOpaqueIds({
      runId: claims.runId,
      ordinal: 0,
      activationSecret
    });
    const advanced = await advanceProbeRunContinuation({
      current: initial,
      signingSecret,
      row: {
        ordinal: 0,
        jti: ids.jti,
        trialEvidence: { receipt: "fixture" },
        evaluation: { passed: true },
        settlement: { actualNanoUsd: 123 }
      }
    });
    expect(advanced.token).not.toContain("passed");
    expect(advanced.continuation).toMatchObject({
      nextOrdinal: 1,
      rows: [{ ordinal: 0, jti: ids.jti }]
    });
  });

  it("rejects tampering, cross-session use, expiry, skips, and duplicate identities", async () => {
    const { session: claims, recovery } = session();
    const token = await createInitialProbeRunContinuation({ recovery, signingSecret });
    await expect(
      openProbeRunContinuation({
        token: `${token}x`,
        signingSecret,
        session: claims,
        recovery,
        activationHash: claims.activationHash,
        buildCommit: claims.buildCommit,
        nowMs
      })
    ).rejects.toThrowError(/invalid_continuation/u);

    const other = session();
    await expect(
      openProbeRunContinuation({
        token,
        signingSecret,
        session: { ...other.session, runId: `run_${"z".repeat(22)}` },
        recovery,
        activationHash: claims.activationHash,
        buildCommit: claims.buildCommit,
        nowMs
      })
    ).rejects.toThrowError(/continuation_binding_mismatch/u);

    await expect(
      openProbeRunContinuation({
        token,
        signingSecret,
        session: claims,
        recovery,
        activationHash: claims.activationHash,
        buildCommit: claims.buildCommit,
        nowMs: recovery.expiresAt * 1_000
      })
    ).rejects.toThrowError(/continuation_expired/u);

    const current = await openProbeRunContinuation({
      token,
      signingSecret,
      session: claims,
      recovery,
      activationHash: claims.activationHash,
      buildCommit: claims.buildCommit,
      nowMs
    });
    await expect(
      advanceProbeRunContinuation({
        current,
        signingSecret,
        row: {
          ordinal: 1,
          jti: "jti_invalid_skip_0001",
          trialEvidence: {},
          evaluation: {},
          settlement: {}
        }
      })
    ).rejects.toThrowError(/invalid_continuation_advance/u);
  });

  it("opens the same run after a short session expires by using a recovered session", async () => {
    const { session: original, recovery } = session();
    const token = await createInitialProbeRunContinuation({ recovery, signingSecret });
    const recovered = issueRecoveredProbeSession({
      recovery,
      signingSecret,
      nowMs: nowMs + 30 * 60_000
    });
    await expect(
      openProbeRunContinuation({
        token,
        signingSecret,
        session: recovered.claims,
        recovery,
        activationHash: original.activationHash,
        buildCommit: original.buildCommit,
        nowMs: nowMs + 30 * 60_000
      })
    ).resolves.toMatchObject({ nextOrdinal: 0, runId: original.runId });
  });

  it("derives stable opaque case/trial/JTI values without semantic labels", () => {
    const { session: claims } = session();
    const first = deriveProbeTrialOpaqueIds({
      runId: claims.runId,
      ordinal: 2,
      activationSecret
    });
    const second = deriveProbeTrialOpaqueIds({
      runId: claims.runId,
      ordinal: 2,
      activationSecret
    });
    expect(first).toEqual(second);
    expect(first.caseId).toMatch(/^case_[A-Za-z0-9_-]{22}$/u);
    expect(first.trialId).toMatch(/^trial_[A-Za-z0-9_-]{22}$/u);
    expect(first.jti).toMatch(/^jti_[A-Za-z0-9_-]{22}$/u);
    expect(JSON.stringify(first)).not.toMatch(/cart|order|checkout|quantity/iu);
  });
});
