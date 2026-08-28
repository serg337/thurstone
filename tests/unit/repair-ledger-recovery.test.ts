import { RepairServiceError, assertRepairDispatchLedgerState } from "@/lib/repair/service.server";
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
