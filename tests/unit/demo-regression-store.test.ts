import { beforeEach, describe, expect, it } from "vitest";

import { createCheckoutFixture } from "@/lib/domain/checkout";
import { createByoaContract, createByoaDescriptorSnapshot } from "@/lib/demo/contract-v2";
import { createByoaDemoResult, type ByoaDemoResultV2 } from "@/lib/demo/result-v2";
import {
  MY_TESTS_STORAGE_KEY,
  readMyTests,
  removeMyTest,
  saveRegressionResult
} from "@/lib/demo/regression-store";

const completedAt = "2026-09-01T01:00:00.000Z";

beforeEach(() => window.sessionStorage.clear());

async function result(input: {
  readonly runId: string;
  readonly previousResultDigest?: string;
  readonly verdict?: "pass" | "incomplete";
}): Promise<ByoaDemoResultV2> {
  const descriptors = await createByoaDescriptorSnapshot();
  const contract = createByoaContract({
    contractId: "byoa_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
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
    ...descriptors,
    buildCommit: "c".repeat(40),
    createdAt: "2026-09-01T00:00:00.000Z"
  });
  const pass = input.verdict !== "incomplete";
  const evidenceRefs = [
    { source: "native-trace" as const, jsonPointer: "/toolName", sha256: "d".repeat(64) }
  ];
  return createByoaDemoResult({
    runId: input.runId,
    contract,
    observedTool: pass ? "order_review" : null,
    rawArguments: pass ? {} : null,
    canonicalArguments: pass ? {} : null,
    trustedStateBefore: createCheckoutFixture(),
    trustedStateAfter: createCheckoutFixture(),
    ledgerDiff: {
      eventCountBefore: 0,
      eventCountAfter: pass ? 1 : 0,
      eventCountDelta: pass ? 1 : 0,
      stateTransitionCount: 0,
      operationLedgerCountBefore: 0,
      operationLedgerCountAfter: 0,
      operationLedgerCountDelta: 0,
      pendingCheckoutChanged: false,
      rejectedAdditionalAttempts: 0
    },
    assertions: [
      {
        assertionId: "selection.expected-tool",
        scope: "selection",
        path: "/observedTool",
        expected: "order_review",
        actual: pass ? "order_review" : null,
        passed: pass,
        label: "Observed invocation matches the contract",
        detail: pass ? "Expected tool observed." : "No invocation observed.",
        evidenceRefs
      }
    ],
    diagnosticSignals: pass
      ? []
      : [
          {
            code: "native_invocation_missing",
            expected: "one native invocation",
            actual: null,
            failedAssertionIds: ["selection.expected-tool"],
            evidenceRefs
          }
        ],
    verdict: pass ? "pass" : "incomplete",
    manifestHash: "e".repeat(64),
    armedAt: "2026-09-01T00:59:00.000Z",
    completedAt,
    previousResultDigest: input.previousResultDigest ?? null
  });
}

describe("browser-local My Tests regression store", () => {
  it("saves a verified terminal case with its immutable source result", async () => {
    const source = await result({
      runId: "byoa_run_cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    });
    const saved = await saveRegressionResult({
      storage: window.sessionStorage,
      result: source,
      createdAt: completedAt
    });
    expect(saved.case.sourceResultDigest).toBe(source.resultDigest);
    expect(saved.results).toEqual([source]);
    await expect(readMyTests(window.sessionStorage)).resolves.toMatchObject({
      version: "thurstone-my-tests@1",
      entries: [{ case: { caseDigest: saved.case.caseDigest } }]
    });
  });

  it("appends a rerun successor without overwriting the original", async () => {
    const first = await result({
      runId: "byoa_run_dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    });
    const initial = await saveRegressionResult({
      storage: window.sessionStorage,
      result: first,
      createdAt: completedAt
    });
    const successor = await result({
      runId: "byoa_run_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      previousResultDigest: first.resultDigest
    });
    const updated = await saveRegressionResult({
      storage: window.sessionStorage,
      result: successor,
      existingCaseDigest: initial.case.caseDigest,
      createdAt: "2026-09-01T01:01:00.000Z"
    });
    expect(updated.case.caseDigest).toBe(initial.case.caseDigest);
    expect(updated.results.map(({ resultDigest }) => resultDigest)).toEqual([
      first.resultDigest,
      successor.resultDigest
    ]);
  });

  it("rejects incomplete evidence and a broken successor chain", async () => {
    await expect(
      saveRegressionResult({
        storage: window.sessionStorage,
        result: await result({
          runId: "byoa_run_ffffffff-ffff-4fff-8fff-ffffffffffff",
          verdict: "incomplete"
        }),
        createdAt: completedAt
      })
    ).rejects.toThrow(/pass or issue/iu);

    const first = await result({
      runId: "byoa_run_12121212-1212-4212-8212-121212121212"
    });
    const saved = await saveRegressionResult({
      storage: window.sessionStorage,
      result: first,
      createdAt: completedAt
    });
    const unrelated = await result({
      runId: "byoa_run_13131313-1313-4313-8313-131313131313"
    });
    await expect(
      saveRegressionResult({
        storage: window.sessionStorage,
        result: unrelated,
        existingCaseDigest: saved.case.caseDigest,
        createdAt: completedAt
      })
    ).rejects.toThrow(/lineage/iu);
  });

  it("removes only the selected saved case and rejects tampered storage", async () => {
    const source = await result({
      runId: "byoa_run_14141414-1414-4414-8414-141414141414"
    });
    const saved = await saveRegressionResult({
      storage: window.sessionStorage,
      result: source,
      createdAt: completedAt
    });
    await expect(removeMyTest(window.sessionStorage, saved.case.caseDigest)).resolves.toMatchObject(
      {
        entries: []
      }
    );

    window.sessionStorage.setItem(
      MY_TESTS_STORAGE_KEY,
      JSON.stringify({ version: "thurstone-my-tests@1", entries: [], unexpected: true })
    );
    await expect(readMyTests(window.sessionStorage)).rejects.toThrow();
  });
});
