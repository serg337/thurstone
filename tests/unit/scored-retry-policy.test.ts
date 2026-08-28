import { scoredInfrastructureReplacementEligible } from "@/lib/scored/retry-policy";
import { describe, expect, it } from "vitest";

const clean = {
  attempt: 0 as const,
  clientInferencePerformed: false,
  clientNativeCallMade: false,
  decisionContinuationPresent: false,
  nativeAdmissionPresent: false,
  durableGrantState: null
};

describe("scored infrastructure replacement policy", () => {
  it("admits only a first pre-decision/pre-target failure", () => {
    expect(scoredInfrastructureReplacementEligible(clean)).toBe(true);
    expect(scoredInfrastructureReplacementEligible({ ...clean, durableGrantState: "ISSUED" })).toBe(
      true
    );
    expect(
      scoredInfrastructureReplacementEligible({ ...clean, durableGrantState: "EXPIRED" })
    ).toBe(true);
  });

  it.each(["IN_FLIGHT", "KNOWN", "UNCERTAIN"] as const)(
    "denies a replacement after durable %s admission even if a continuation write was lost",
    (durableGrantState) => {
      expect(scoredInfrastructureReplacementEligible({ ...clean, durableGrantState })).toBe(false);
    }
  );

  it("denies retries after any decision, admission, execution, client inference flag, or first replacement", () => {
    expect(
      scoredInfrastructureReplacementEligible({ ...clean, decisionContinuationPresent: true })
    ).toBe(false);
    expect(
      scoredInfrastructureReplacementEligible({ ...clean, nativeAdmissionPresent: true })
    ).toBe(false);
    expect(scoredInfrastructureReplacementEligible({ ...clean, clientNativeCallMade: true })).toBe(
      false
    );
    expect(
      scoredInfrastructureReplacementEligible({ ...clean, clientInferencePerformed: true })
    ).toBe(false);
    expect(scoredInfrastructureReplacementEligible({ ...clean, attempt: 1 })).toBe(false);
  });
});
