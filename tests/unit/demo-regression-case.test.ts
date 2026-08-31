import { describe, expect, it } from "vitest";

import { createCheckoutFixture } from "@/lib/domain/checkout";
import {
  createByoaContract,
  createByoaDescriptorSnapshot,
  type ByoaContractV2
} from "@/lib/demo/contract-v2";
import { parseDemoResult } from "@/lib/demo/result";
import {
  createByoaDemoResult,
  parseByoaDemoResult,
  verifyByoaDemoResult,
  type ByoaDemoResultV2,
  type DemoAssertionV2
} from "@/lib/demo/result-v2";
import {
  createRegressionCase,
  parseRegressionCase,
  verifyRegressionCase
} from "@/lib/demo/regression-case";

const completedAt = "2026-09-01T00:00:02.000Z";
const evidenceRef = {
  source: "native-trace" as const,
  jsonPointer: "/toolName",
  sha256: "d".repeat(64)
};

async function contract(): Promise<ByoaContractV2> {
  const snapshot = await createByoaDescriptorSnapshot();
  return createByoaContract({
    contractId: "byoa_33333333-3333-4333-8333-333333333333",
    request: "Show me the complete order before I decide.",
    expectedTool: "order_review",
    argumentPredicate: { kind: "empty" },
    allowedEffects: [],
    forbiddenEffects: [
      { kind: "cart_mutation" },
      { kind: "pending_checkout" },
      { kind: "unmodeled_state" }
    ],
    replayPolicy: "read_only",
    approvalClass: "read_only",
    ...snapshot,
    buildCommit: "c".repeat(40),
    createdAt: "2026-09-01T00:00:00.000Z"
  });
}

function assertion(passed: boolean): DemoAssertionV2 {
  return {
    assertionId: "selection.expected-tool",
    scope: "selection",
    path: "/observedTool",
    expected: "order_review",
    actual: passed ? "order_review" : "checkout_request",
    passed,
    label: "Observed invocation matches the contract",
    detail: passed ? "Expected tool observed." : "Different tool observed.",
    evidenceRefs: [evidenceRef]
  };
}

async function result(verdict: ByoaDemoResultV2["verdict"] = "pass"): Promise<ByoaDemoResultV2> {
  const frozen = await contract();
  const passed = verdict === "pass";
  const incomplete = verdict === "incomplete" || verdict === "unavailable";
  return createByoaDemoResult({
    runId: "byoa_run_44444444-4444-4444-8444-444444444444",
    contract: frozen,
    observedTool: incomplete ? null : passed ? "order_review" : "checkout_request",
    rawArguments: incomplete ? null : {},
    canonicalArguments: incomplete ? null : {},
    trustedStateBefore: createCheckoutFixture(),
    trustedStateAfter: createCheckoutFixture(),
    ledgerDiff: {
      eventCountBefore: 0,
      eventCountAfter: incomplete ? 0 : 1,
      eventCountDelta: incomplete ? 0 : 1,
      stateTransitionCount: 0,
      operationLedgerCountBefore: 0,
      operationLedgerCountAfter: 0,
      operationLedgerCountDelta: 0,
      pendingCheckoutChanged: false,
      rejectedAdditionalAttempts: 0
    },
    assertions: [assertion(passed && !incomplete)],
    diagnosticSignals: passed
      ? []
      : incomplete
        ? [
            {
              code: "agent_decision_unobservable",
              expected: "one native invocation",
              actual: null,
              failedAssertionIds: ["selection.expected-tool"],
              evidenceRefs: [evidenceRef]
            }
          ]
        : [
            {
              code: "wrong_tool_selected",
              expected: "order_review",
              actual: "checkout_request",
              failedAssertionIds: ["selection.expected-tool"],
              evidenceRefs: [evidenceRef]
            }
          ],
    verdict,
    manifestHash: "e".repeat(64),
    armedAt: "2026-09-01T00:00:01.000Z",
    completedAt
  });
}

describe("BYOA result and regression lineage", () => {
  it("round-trips strict v2 results while preserving v1 incompatibility", async () => {
    const valid = await result();
    await expect(verifyByoaDemoResult(valid)).resolves.toEqual(valid);
    expect(() => parseByoaDemoResult({ ...valid, unexpected: true })).toThrow();
    expect(() => parseDemoResult(valid)).toThrow();
  });

  it("binds full trusted state, contract, diagnosis, and terminal result digests", async () => {
    const valid = await result("fail");
    expect(valid.trustedStateBefore.bytes).toContain("checkout-seed-v1");
    expect(valid.diagnostic.primaryFindingId).toContain("wrong_tool_selected");
    await expect(
      verifyByoaDemoResult({
        ...valid,
        trustedStateAfter: {
          ...valid.trustedStateAfter,
          sha256: "0".repeat(64)
        }
      })
    ).rejects.toThrow(/state evidence digest/iu);
    await expect(verifyByoaDemoResult({ ...valid, resultDigest: "0".repeat(64) })).rejects.toThrow(
      /result digest/iu
    );
    expect(() =>
      parseByoaDemoResult({
        ...valid,
        diagnostic: { ...valid.diagnostic, buildCommit: "0".repeat(40) }
      })
    ).toThrow(/diagnostic identity/iu);
  });

  it("saves pass and issue results as immutable regression cases", async () => {
    for (const verdict of ["pass", "fail"] as const) {
      const source = await result(verdict);
      const saved = await createRegressionCase(source, completedAt);
      expect(saved.sourceResultDigest).toBe(source.resultDigest);
      expect(saved.contract).toEqual(source.contract);
      await expect(verifyRegressionCase(saved)).resolves.toEqual(saved);
    }
  });

  it("rejects incomplete results and tampered regression lineage", async () => {
    await expect(createRegressionCase(await result("incomplete"), completedAt)).rejects.toThrow(
      /pass or fail/iu
    );
    const saved = await createRegressionCase(await result("pass"), completedAt);
    expect(() => parseRegressionCase({ ...saved, unexpected: true })).toThrow();
    await expect(
      verifyRegressionCase({ ...saved, originalCatalogDigest: "0".repeat(64) })
    ).rejects.toThrow(/regression-case digest/iu);
  });

  it("uses successor result lineage without overwriting the original", async () => {
    const first = await result("fail");
    const frozen = await contract();
    const successor = await createByoaDemoResult({
      runId: "byoa_run_55555555-5555-4555-8555-555555555555",
      contract: frozen,
      observedTool: "order_review",
      rawArguments: {},
      canonicalArguments: {},
      trustedStateBefore: createCheckoutFixture(),
      trustedStateAfter: createCheckoutFixture(),
      ledgerDiff: {
        eventCountBefore: 0,
        eventCountAfter: 1,
        eventCountDelta: 1,
        stateTransitionCount: 0,
        operationLedgerCountBefore: 0,
        operationLedgerCountAfter: 0,
        operationLedgerCountDelta: 0,
        pendingCheckoutChanged: false,
        rejectedAdditionalAttempts: 0
      },
      assertions: [assertion(true)],
      diagnosticSignals: [],
      verdict: "pass",
      manifestHash: "e".repeat(64),
      armedAt: "2026-09-01T00:00:01.000Z",
      completedAt: "2026-09-01T00:00:03.000Z",
      previousResultDigest: first.resultDigest
    });
    const saved = await createRegressionCase(successor, "2026-09-01T00:00:04.000Z");
    expect(saved.previousResultDigest).toBe(first.resultDigest);
    expect(first.previousResultDigest).toBeNull();
  });
});
