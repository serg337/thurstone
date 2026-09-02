import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HANDOFF_CLAIM_RECEIPT_VERSION,
  readHandoffClaimFailure,
  recordHandoffClaimFailure,
  resetHandoffClaimReceiptsForTests
} from "@/lib/demo/handoff-claim-receipt.server";

const environment = {
  NODE_ENV: "test",
  TOOLPROOF_BROWSER_FAKE_PROBE: "1"
} as NodeJS.ProcessEnv;

describe("bounded handoff claim failure receipts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T08:30:00.000Z"));
    resetHandoffClaimReceiptsForTests(environment);
  });

  afterEach(() => vi.useRealTimers());

  it("stores only a category, timestamp, count, and zero-exposure facts", async () => {
    const token = "tbh2.private-test-token-material";
    const first = await recordHandoffClaimFailure(token, "binding_mismatch", environment);
    expect(first).toEqual({
      version: HANDOFF_CLAIM_RECEIPT_VERSION,
      reason: "binding_mismatch",
      observedAtMs: Date.parse("2026-09-02T08:30:00.000Z"),
      attemptCount: 1,
      requestRevealed: false,
      toolsRegistered: false,
      nativeInvocationCount: 0
    });
    await recordHandoffClaimFailure(token, "already_claimed", environment);
    await expect(readHandoffClaimFailure(token, environment)).resolves.toMatchObject({
      reason: "already_claimed",
      attemptCount: 2
    });
    await expect(readHandoffClaimFailure("tbh2.other-token", environment)).resolves.toBeNull();
    expect(JSON.stringify(await readHandoffClaimFailure(token, environment))).not.toContain(token);
  });
});
