import { beforeEach, describe, expect, it } from "vitest";

import { checkoutRequest, createCheckoutFixture } from "@/lib/domain/checkout";
import { createWorkshopContract } from "@/lib/demo/contract";
import {
  createContractValidationResult,
  createNativeWorkshopResult,
  parseDemoResult
} from "@/lib/demo/result";
import {
  DEMO_RESULT_MAX_BYTES,
  DEMO_RESULT_STORAGE_KEY,
  clearDemoResult,
  readDemoResult,
  writeDemoResult
} from "@/lib/demo/session-storage";

const contract = createWorkshopContract(
  {
    request: "I am ready—request checkout for this cart.",
    expectedDecision: {
      kind: "call",
      toolName: "checkout_request",
      arguments: { operationId: "workshop_checkout_0001" }
    },
    allowedEffects: [{ kind: "pending_checkout" }],
    forbiddenEffects: [
      { kind: "cart_mutation" },
      { kind: "duplicate_transition" },
      { kind: "unmodeled_state" }
    ],
    replayPolicy: "exactly_once"
  },
  {
    testId: "workshop_22222222-2222-4222-8222-222222222222",
    createdAt: "2026-08-31T00:00:00.000Z"
  }
);

const common = {
  contract,
  contractDigest: "a".repeat(64),
  sessionId: "demo_33333333-3333-4333-8333-333333333333",
  buildCommit: "b".repeat(40),
  completedAt: "2026-08-31T00:00:01.000Z"
};

beforeEach(() => window.sessionStorage.clear());

describe("Workshop result", () => {
  it("keeps provider-free validation separate from an agent or native decision", () => {
    const result = createContractValidationResult(common);
    expect(result).toMatchObject({ source: "contract_validation", actual: null, verdict: "pass" });
    expect(result.ledgerDiff.eventCount).toBe(0);
  });

  it("passes exactly-one native checkout evidence and fails a missing replay", () => {
    const before = createCheckoutFixture();
    const transition = checkoutRequest(
      before,
      { operationId: "workshop_checkout_0001" },
      "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457"
    );
    const passed = createNativeWorkshopResult({
      ...common,
      actual: contract.expectedDecision,
      before,
      after: transition.state,
      eventCount: 2,
      replayObserved: true
    });
    expect(passed.verdict).toBe("pass");
    expect(passed.ledgerDiff).toEqual({
      eventCount: 2,
      stateTransitionCount: 1,
      replayObserved: true
    });

    const failed = createNativeWorkshopResult({
      ...common,
      actual: contract.expectedDecision,
      before,
      after: transition.state,
      eventCount: 1,
      replayObserved: false
    });
    expect(failed.verdict).toBe("fail");
    expect(failed.assertions.some(({ passed: assertionPassed }) => !assertionPassed)).toBe(true);
  });

  it("round-trips only strict, bounded tab-scoped results", () => {
    const result = createContractValidationResult(common);
    writeDemoResult(window.sessionStorage, result);
    expect(readDemoResult(window.sessionStorage)).toEqual(result);
    clearDemoResult(window.sessionStorage);
    expect(readDemoResult(window.sessionStorage)).toBeNull();

    expect(() => parseDemoResult({ ...result, unexpected: true })).toThrow();
    window.sessionStorage.setItem(DEMO_RESULT_STORAGE_KEY, "x".repeat(DEMO_RESULT_MAX_BYTES + 1));
    expect(() => readDemoResult(window.sessionStorage)).toThrow(/exceeds/iu);
  });
});
