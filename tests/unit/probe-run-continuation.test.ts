import { describe, expect, it } from "vitest";

import {
  advanceProbeRunContinuation,
  createInitialProbeRunContinuation,
  deriveProbeTrialOpaqueIds,
  openProbeRunContinuation
} from "@/lib/probe/run-continuation.server";
import { issueProbeSession } from "@/lib/probe/session";

const signingSecret = Buffer.alloc(32, 9).toString("base64url");
const activationSecret = Buffer.alloc(32, 10).toString("base64url");
const nowMs = Date.parse("2026-08-27T12:00:00.000Z");

function session() {
  return issueProbeSession({
    activationHash: "a".repeat(64),
    buildCommit: "b".repeat(40),
    actorHash: "c".repeat(64),
    signingSecret,
    nowMs
  }).claims;
}

describe("opaque Probe run continuation", () => {
  it("creates a sealed empty run and advances an exact contiguous prefix", async () => {
    const claims = session();
    const initialToken = await createInitialProbeRunContinuation({
      session: claims,
      signingSecret
    });
    expect(initialToken).not.toContain(claims.runId);
    const initial = await openProbeRunContinuation({
      token: initialToken,
      signingSecret,
      session: claims,
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
    const claims = session();
    const token = await createInitialProbeRunContinuation({ session: claims, signingSecret });
    await expect(
      openProbeRunContinuation({
        token: `${token}x`,
        signingSecret,
        session: claims,
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
        session: { ...other, runId: `run_${"z".repeat(22)}` },
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
        activationHash: claims.activationHash,
        buildCommit: claims.buildCommit,
        nowMs: claims.expiresAt * 1_000
      })
    ).rejects.toThrowError(/continuation_expired/u);

    const current = await openProbeRunContinuation({
      token,
      signingSecret,
      session: claims,
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

  it("derives stable opaque case/trial/JTI values without semantic labels", () => {
    const claims = session();
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
