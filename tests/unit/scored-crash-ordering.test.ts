import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

async function source(relativePath: string): Promise<string> {
  return readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("scored crash-ordering invariants", () => {
  it("persists the deterministic issue artifact before the permanent ledger subject latch", async () => {
    const text = await source("lib/scored/service.server.ts");
    const start = text.indexOf("export async function issueScoredTrial");
    const end = text.indexOf("export async function decideScoredTrial", start);
    const section = text.slice(start, end);
    expect(section.indexOf("putProbeContinuation(")).toBeGreaterThan(0);
    expect(section.indexOf("issueProbeAuthorization(")).toBeGreaterThan(
      section.indexOf("putProbeContinuation(")
    );
  });

  it("checks durable grant state before a provider call and denies replacement after admission", async () => {
    const service = await source("lib/scored/service.server.ts");
    const start = service.indexOf("export async function decideScoredTrial");
    const end = service.indexOf("export async function admitScoredNative", start);
    const section = service.slice(start, end);
    expect(section.indexOf("readScoredLedgerRecord(")).toBeGreaterThan(0);
    expect(section.indexOf("decideScoredWithOpenAi(")).toBeGreaterThan(
      section.indexOf("readScoredLedgerRecord(")
    );

    const retry = await source("lib/scored/retry-policy.ts");
    for (const state of ["IN_FLIGHT", "KNOWN", "UNCERTAIN"]) {
      expect(retry).not.toContain(`input.durableGrantState === \"${state}\"`);
    }
  });

  it("persists the full decision receipt before KNOWN settlement and recovers settlement", async () => {
    const text = await source("lib/scored/service.server.ts");
    const start = text.indexOf("export async function decideScoredTrial");
    const end = text.indexOf("export async function admitScoredNative", start);
    const section = text.slice(start, end);
    expect(section.indexOf("putProbeContinuation(")).toBeGreaterThan(
      section.indexOf("decideScoredWithOpenAi(")
    );
    expect(
      section.indexOf("settleKnownScoredDecision({", section.indexOf("putProbeContinuation("))
    ).toBeGreaterThan(section.indexOf("putProbeContinuation("));
    expect(text).toContain('"decision-recovery"');
    expect(text).toContain("verifyScoredProviderKnownReceipt({");
  });

  it("deletes recoverable continuations before deleting run recovery data", async () => {
    const text = await source("lib/scored/service.server.ts");
    const start = text.indexOf("export async function acknowledgeVerifiedScoredRun");
    const section = text.slice(start);
    expect(section.indexOf("continuationKeys")).toBeGreaterThan(0);
    expect(section.indexOf("acknowledgeScoredRun(")).toBeGreaterThan(
      section.indexOf("continuationKeys")
    );
  });

  it("copies encrypted schedule and attempts to permanent evidence during seal, before ACK", async () => {
    const text = await source("lib/scored/run-store.server.ts");
    const sealStart = text.indexOf("const SEAL_EVIDENCE_SCRIPT");
    const ackStart = text.indexOf("const ACK_SCRIPT", sealStart);
    const seal = text.slice(sealStart, ackStart);
    const ack = text.slice(
      ackStart,
      text.indexOf("export const SCORED_RUN_STORE_SCRIPTS", ackStart)
    );

    expect(seal).toContain('"schedule_token", schedule_token');
    expect(seal).toContain('string.match(field, "^attempt_%d+_[01]$")');
    expect(seal.indexOf('redis.call("HSET", KEYS[3]')).toBeLessThan(
      seal.indexOf('redis.call("HSET", KEYS[1], "evidence_status"')
    );
    expect(ack).not.toContain('"schedule_token"');
    expect(ack).not.toContain("local data = redis.call");
    expect(ack).toContain('redis.call("DEL", KEYS[2])');
  });

  it("limits unsettled recovery to failure reconciliation or terminal evidence", async () => {
    const text = await source("lib/scored/service.server.ts");
    for (const mode of [
      '"active-settled"',
      '"decision-recovery"',
      '"failure-reconciliation"',
      '"terminal-evidence"'
    ]) {
      expect(text).toContain(mode);
    }
    expect(text).toContain('mode === "active-settled" && unsettled');
    expect(text).toContain('mode === "terminal-evidence" && progress.status === "active"');
    expect(text).toContain(
      'mode === "failure-reconciliation" && progress.status !== "active" && unsettled'
    );
    expect(text).toContain('authenticateSession(request, dependencies, "failure-reconciliation")');
    expect(text).toContain('authenticateSession(request, dependencies, "terminal-evidence")');
    expect(text).toContain("async function reconcileTerminalInflightAttempts");
    expect(text.match(/reconcileTerminalInflightAttempts\(/gu)).toHaveLength(3);

    const failureStart = text.indexOf("export async function recordScoredTrialFailure");
    const failureEnd = text.indexOf("async function verifyAttemptEvidence", failureStart);
    const failure = text.slice(failureStart, failureEnd);
    expect(failure.indexOf("recordScoredRunAttempt(")).toBeLessThan(
      failure.indexOf("settleProbeCallUncertain(")
    );
  });

  it("persists encrypted local recovery before the first scored start call", async () => {
    const text = await source("scripts/scored-run.ts");
    expect(text.indexOf("saveScoredLocalRecovery(localRecovery)")).toBeGreaterThan(0);
    expect(text.indexOf("startScoredBrowserSession({")).toBeGreaterThan(
      text.indexOf("saveScoredLocalRecovery(localRecovery)")
    );
  });

  it("retries a response-lost ACK through durable recovery before deleting local recovery", async () => {
    const text = await source("scripts/scored-run.ts");
    const recovery = text.indexOf("scored_ack_response_loss_recovery_mismatch");
    const retry = text.indexOf("await adapter.acknowledge(evidenceDigest)", recovery);
    const deletion = text.indexOf("await deleteScoredLocalRecovery(phase)", retry);
    expect(recovery).toBeGreaterThan(0);
    expect(retry).toBeGreaterThan(recovery);
    expect(deletion).toBeGreaterThan(retry);
  });

  it("loads replacement evidence through its predecessor protocol and verifies the exact call delta", async () => {
    const text = await source("lib/scored/service.server.ts");
    const start = text.indexOf("export async function startScoredSession");
    const end = text.indexOf("export async function recoverScoredSession", start);
    const section = text.slice(start, end);
    expect(section).toContain("frozenProtocolHash: phaseExecution.predecessorProtocolHash");
    expect(section).toContain("assertScoredReplacementOffset({");
    expect(section).toContain("predecessorProviderGrants");
  });
});
