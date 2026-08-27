import { describe, expect, it } from "vitest";

import {
  PROBE_GLOBAL_CALL_LIMIT,
  PROBE_LIFETIME_SPEND_CEILING_NANO_USD,
  PROBE_MAX_INPUT_TOKENS,
  PROBE_MAX_OUTPUT_TOKENS,
  PROBE_PER_CALL_RESERVATION_NANO_USD,
  PROBE_PURPOSE_CALL_LIMITS,
  calculateProbeCostNanoUsd,
  probePolicyHash
} from "@/lib/probe/policy";

describe("Probe challenge-lifetime policy", () => {
  it("allocates exactly 160 calls without borrowing or an extra judge quota", () => {
    expect(PROBE_PURPOSE_CALL_LIMITS).toEqual({
      calibration: 9,
      baseline: 72,
      repair: 2,
      revised: 72,
      judge: 5
    });
    expect(Object.values(PROBE_PURPOSE_CALL_LIMITS).reduce((sum, limit) => sum + limit, 0)).toBe(
      PROBE_GLOBAL_CALL_LIMIT
    );
  });

  it("permanently commits exactly the USD $10 ceiling across 160 grants", () => {
    expect(PROBE_GLOBAL_CALL_LIMIT * PROBE_PER_CALL_RESERVATION_NANO_USD).toBe(
      PROBE_LIFETIME_SPEND_CEILING_NANO_USD
    );
  });

  it("proves the maximum request costs less than its conservative reservation", () => {
    expect(
      calculateProbeCostNanoUsd({
        inputTokens: PROBE_MAX_INPUT_TOKENS,
        outputTokens: PROBE_MAX_OUTPUT_TOKENS
      })
    ).toBeLessThan(PROBE_PER_CALL_RESERVATION_NANO_USD);
  });

  it("uses a deterministic canonical policy hash and rejects invalid usage", async () => {
    await expect(probePolicyHash()).resolves.toBe(
      "8293eaee17e979eee1ca915a967ca3110f0d20068e4eda573554ae682dc563b0"
    );
    await expect(Promise.all([probePolicyHash(), probePolicyHash()])).resolves.toSatisfy(
      ([first, second]) => first === second
    );
    expect(() => calculateProbeCostNanoUsd({ inputTokens: -1, outputTokens: 0 })).toThrow(
      RangeError
    );
  });
});
