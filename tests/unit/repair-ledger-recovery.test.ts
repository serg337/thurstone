import {
  RepairServiceError,
  assertRepairDispatchLedgerState,
  configuredRepairCallOffset
} from "@/lib/repair/service.server";
import { deriveRepairGrantIdentity } from "@/lib/repair/identity.server";
import type { ScoredLedgerRecord } from "@/lib/scored/ledger-record.server";
import { describe, expect, it } from "vitest";

const claimsHash = "a".repeat(64);

function record(state: ScoredLedgerRecord["state"]): ScoredLedgerRecord {
  return {
    state,
    jti: "jti_repair_test",
    claimsHash,
    purpose: "repair",
    dispatchSequence: state === "ISSUED" || state === "EXPIRED" ? null : 18,
    actualNanoUsd: null,
    providerResponseHash: null,
    settlementDigest: null,
    usageHash: null
  };
}

describe("Repair Builder restart admission", () => {
  it("derives one stable grant identity shared by execution and successor verification", async () => {
    const artifactSecret = Buffer.alloc(32, 29).toString("base64url");
    const first = await deriveRepairGrantIdentity({
      artifactSecret,
      developmentPackageHash: "a".repeat(64)
    });
    const replay = await deriveRepairGrantIdentity({
      artifactSecret,
      developmentPackageHash: "a".repeat(64)
    });
    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      contextId: expect.stringMatching(/^repair_[A-Za-z0-9_-]{22}$/u),
      jti: expect.stringMatching(/^jti_repair_[A-Za-z0-9_-]{22}$/u),
      claimsHash: expect.stringMatching(/^[a-f0-9]{64}$/u)
    });
    await expect(
      deriveRepairGrantIdentity({
        artifactSecret,
        developmentPackageHash: "b".repeat(64)
      })
    ).resolves.not.toEqual(first);
  });

  it("binds either a fresh or one-prior-repair protocol offset", () => {
    expect(configuredRepairCallOffset({})).toBe(0);
    expect(configuredRepairCallOffset({ TOOLPROOF_REPAIR_PHASE_CALL_OFFSET: "1" })).toBe(1);
    expect(() => configuredRepairCallOffset({ TOOLPROOF_REPAIR_PHASE_CALL_OFFSET: "2" })).toThrow(
      /repair_phase_call_offset_invalid/u
    );
  });

  it("permits only a missing or still-issued authorization before dispatch", () => {
    expect(() => assertRepairDispatchLedgerState(null, claimsHash)).not.toThrow();
    expect(() => assertRepairDispatchLedgerState(record("ISSUED"), claimsHash)).not.toThrow();
  });

  it.each(["IN_FLIGHT", "KNOWN", "UNCERTAIN"] as const)(
    "never repeats a provider call after durable %s admission",
    (state) => {
      try {
        assertRepairDispatchLedgerState(record(state), claimsHash);
        throw new Error("expected rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(RepairServiceError);
        expect(error).toMatchObject({
          code: "repair_provider_dispatch_already_admitted",
          inferencePerformed: true
        });
      }
    }
  );

  it("rejects expired or mismatched durable grants without provider dispatch", () => {
    expect(() => assertRepairDispatchLedgerState(record("EXPIRED"), claimsHash)).toThrow(
      /repair_authorization_expired/u
    );
    expect(() =>
      assertRepairDispatchLedgerState({ ...record("ISSUED"), purpose: "baseline" }, claimsHash)
    ).toThrow(/repair_grant_record_mismatch/u);
  });
});
