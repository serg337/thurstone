import { describe, expect, it } from "vitest";

import { createThurstoneDemoCatalogSnapshot } from "@/lib/demo/catalog-snapshot";
import {
  addContractSuiteCase,
  createThurstoneContractSuite,
  setContractSuiteProcessEndingTool,
  type ThurstoneContractCaseInput
} from "@/lib/demo/contract-suite";
import {
  createContractRunQueue,
  queueRemainingCaseIds,
  readContractRunQueue,
  recordContractRunResult,
  writeContractRunQueue
} from "@/lib/demo/contract-run-queue";
import {
  addContinuousJourneyStep,
  createContinuousJourneyPlanDraft,
  moveContinuousJourneyStep,
  removeContinuousJourneyStep,
  validateContinuousJourneyPlan
} from "@/lib/demo/continuous-journey-plan";

const caseInput: ThurstoneContractCaseInput = {
  name: "Review order",
  request: "Show me the complete order.",
  expectedTool: "order_review",
  argumentPredicate: { kind: "empty" },
  allowedEffects: [],
  forbiddenEffects: [
    { kind: "cart_mutation" },
    { kind: "pending_checkout" },
    { kind: "unmodeled_state" }
  ],
  replayPolicy: "read_only",
  approvalClass: "read_only"
};

describe("contract run queue", () => {
  it("preserves ordered independent results without allowing replacement", async () => {
    let suite = await createThurstoneContractSuite({
      suiteId: "suite_66666666-6666-4666-8666-666666666666",
      name: "Queue suite",
      catalogSnapshot: createThurstoneDemoCatalogSnapshot({ selectedToolNames: ["order_review"] }),
      createdAt: "2026-09-01T09:00:00.000Z"
    });
    suite = addContractSuiteCase(suite, caseInput, {
      caseId: "case_77777777-7777-4777-8777-777777777777",
      updatedAt: "2026-09-01T09:00:01.000Z"
    });
    suite = addContractSuiteCase(
      suite,
      { ...caseInput, request: "Review this order." },
      {
        caseId: "case_88888888-8888-4888-8888-888888888888",
        updatedAt: "2026-09-01T09:00:02.000Z"
      }
    );
    const queue = createContractRunQueue(suite);
    expect(queueRemainingCaseIds(queue)).toHaveLength(2);
    const first = recordContractRunResult(queue, {
      caseId: queue.orderedCaseIds[0]!,
      verdict: "pass",
      resultDigest: "a".repeat(64)
    });
    expect(first.currentCaseId).toBe(queue.orderedCaseIds[1]);
    expect(queueRemainingCaseIds(first)).toEqual([queue.orderedCaseIds[1]]);
    expect(() =>
      recordContractRunResult(first, {
        caseId: queue.orderedCaseIds[0]!,
        verdict: "issue",
        resultDigest: "b".repeat(64)
      })
    ).toThrow(/cannot be replaced/iu);
    writeContractRunQueue(window.sessionStorage, first);
    expect(readContractRunQueue(window.sessionStorage)).toEqual(first);
  });

  it("allows any two-or-more requests and enforces only owner-marked process endings", async () => {
    let suite = await createThurstoneContractSuite({
      suiteId: "suite_99999999-9999-4999-8999-999999999999",
      name: "Journey suite",
      catalogSnapshot: createThurstoneDemoCatalogSnapshot({
        selectedToolNames: ["cart_get", "cart_update", "order_review", "checkout_request"]
      }),
      createdAt: "2026-09-01T09:10:00.000Z"
    });
    const cases: readonly ThurstoneContractCaseInput[] = [
      {
        ...caseInput,
        name: "Read cart",
        request: "What is in my cart?",
        expectedTool: "cart_get"
      },
      {
        ...caseInput,
        name: "Update cart",
        request: "Set the mug quantity to three.",
        expectedTool: "cart_update",
        argumentPredicate: {
          kind: "cart_update",
          operationId: "valid_unique",
          operation: "set_quantity",
          itemId: "stoneware-mug",
          quantity: 3
        },
        allowedEffects: [{ kind: "cart_quantity", itemId: "stoneware-mug", quantity: 3 }],
        forbiddenEffects: [
          { kind: "pending_checkout" },
          { kind: "duplicate_transition" },
          { kind: "unmodeled_state" }
        ],
        replayPolicy: "exactly_once",
        approvalClass: "consequential"
      },
      caseInput,
      {
        ...caseInput,
        name: "Request checkout",
        request: "Request checkout for this cart.",
        expectedTool: "checkout_request",
        argumentPredicate: { kind: "checkout_request", operationId: "valid_unique" },
        allowedEffects: [{ kind: "pending_checkout" }],
        forbiddenEffects: [
          { kind: "cart_mutation" },
          { kind: "duplicate_transition" },
          { kind: "unmodeled_state" }
        ],
        replayPolicy: "exactly_once",
        approvalClass: "consequential"
      }
    ];
    for (const [index, input] of cases.entries()) {
      suite = addContractSuiteCase(suite, input, {
        caseId: `case_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${index}`,
        updatedAt: `2026-09-01T09:10:0${index + 1}.000Z`
      });
    }
    const queue = createContractRunQueue(suite, "continuous");
    expect(queue.mode).toBe("continuous");
    expect(
      queue.orderedCaseIds.map(
        (caseId) => suite.cases.find((testCase) => testCase.caseId === caseId)?.expectedTool
      )
    ).toEqual(["cart_get", "cart_update", "order_review", "checkout_request"]);

    const plan = createContinuousJourneyPlanDraft(suite);
    expect(validateContinuousJourneyPlan(suite, plan).valid).toBe(true);
    const checkoutTooEarly = moveContinuousJourneyStep(plan, 3, 2);
    expect(validateContinuousJourneyPlan(suite, checkoutTooEarly).valid).toBe(true);
    suite = setContractSuiteProcessEndingTool(suite, "checkout_request", true, {
      updatedAt: "2026-09-01T09:10:05.000Z"
    });
    expect(validateContinuousJourneyPlan(suite, checkoutTooEarly)).toMatchObject({
      valid: false,
      errors: expect.arrayContaining([
        "checkout_request is marked process-ending, so nothing may follow it."
      ])
    });
    const reviewBeforeUpdate = moveContinuousJourneyStep(plan, 2, 1);
    expect(validateContinuousJourneyPlan(suite, reviewBeforeUpdate).valid).toBe(true);
    expect(validateContinuousJourneyPlan(suite, { ...plan, anyOrderMiddle: true }).valid).toBe(
      true
    );

    const repeatedReadId = "case_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    suite = addContractSuiteCase(
      suite,
      {
        ...caseInput,
        name: "Read cart again",
        request: "Show the updated cart.",
        expectedTool: "cart_get"
      },
      { caseId: repeatedReadId, updatedAt: "2026-09-01T09:10:06.000Z" }
    );
    const freshPlanWithRepeatedRequest = createContinuousJourneyPlanDraft(suite);
    expect(freshPlanWithRepeatedRequest.orderedCaseIds).toHaveLength(4);
    expect(
      freshPlanWithRepeatedRequest.orderedCaseIds.map(
        (caseId) => suite.cases.find((testCase) => testCase.caseId === caseId)?.expectedTool
      )
    ).toEqual(["cart_get", "cart_update", "order_review", "checkout_request"]);
    const repeated = addContinuousJourneyStep(plan, suite, repeatedReadId);
    expect(repeated.orderedCaseIds).toHaveLength(5);
    expect(repeated.orderedCaseIds.at(-2)).toBe(repeatedReadId);
    expect(validateContinuousJourneyPlan(suite, repeated).valid).toBe(true);
    expect(removeContinuousJourneyStep(repeated, repeatedReadId)).toEqual(plan);
  });

  it("unlocks a continuous journey with two requests from the same standard tool", async () => {
    let suite = await createThurstoneContractSuite({
      suiteId: "suite_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      name: "Nonlinear journey",
      catalogSnapshot: createThurstoneDemoCatalogSnapshot({ selectedToolNames: ["cart_get"] }),
      createdAt: "2026-09-01T09:20:00.000Z"
    });
    for (const [index, request] of ["What is in my cart?", "Read my cart again."].entries()) {
      suite = addContractSuiteCase(
        suite,
        { ...caseInput, name: "Read cart", request, expectedTool: "cart_get" },
        {
          caseId: `case_dddddddd-dddd-4ddd-8ddd-ddddddddddd${index}`,
          updatedAt: `2026-09-01T09:20:0${index + 1}.000Z`
        }
      );
    }
    const queue = createContractRunQueue(suite, "continuous");
    expect(queue.orderedCaseIds).toEqual(suite.cases.map(({ caseId }) => caseId));
    expect(
      validateContinuousJourneyPlan(suite, createContinuousJourneyPlanDraft(suite)).valid
    ).toBe(true);
  });
});
