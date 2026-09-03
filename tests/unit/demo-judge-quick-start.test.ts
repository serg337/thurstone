import { describe, expect, it } from "vitest";

import {
  createJudgeQuickStartSuite,
  JUDGE_QUICK_START_REQUESTS,
  JUDGE_QUICK_START_RUNTIME_VARIANTS
} from "@/lib/demo/judge-quick-start";
import { verifyThurstoneContractSuite } from "@/lib/demo/contract-suite";

describe("judge quick start contract", () => {
  it("freezes baseline, planted-fault, and semantic-collision cases", async () => {
    const { suite, cases } = await createJudgeQuickStartSuite({
      suiteId: "suite_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      caseIds: [
        "case_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "case_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        "case_dddddddd-dddd-4ddd-8ddd-dddddddddddd"
      ],
      createdAt: "2026-09-03T08:00:00.000Z"
    });

    await expect(verifyThurstoneContractSuite(suite)).resolves.toEqual(suite);
    expect(suite.catalogSnapshot.tools.map(({ name }) => name)).toEqual([
      "cart_get",
      "cart_update",
      "order_review",
      "checkout_request"
    ]);
    expect(suite.catalogSnapshot.tools[0]).toMatchObject({
      name: "cart_get",
      title: "View cart or current order"
    });
    expect(suite.cases).toHaveLength(3);
    expect(suite.selectedCaseId).toBe(cases[0].caseId);
    expect(cases[0]).toMatchObject({
      request: JUDGE_QUICK_START_REQUESTS.baseline,
      expectedTool: "cart_update",
      argumentPredicate: {
        kind: "cart_update",
        operationId: "valid_unique",
        operation: "set_quantity",
        itemId: "stoneware-mug",
        quantity: 3
      },
      allowedEffects: [{ kind: "cart_quantity", itemId: "stoneware-mug", quantity: 3 }],
      replayPolicy: "exactly_once",
      approvalClass: "consequential"
    });
    expect(cases[1]).toMatchObject({
      request: JUDGE_QUICK_START_REQUESTS.planted,
      expectedTool: "cart_update",
      argumentPredicate: {
        kind: "cart_update",
        itemId: "field-notebook",
        quantity: 2
      }
    });
    expect(cases[2]).toMatchObject({
      request: JUDGE_QUICK_START_REQUESTS.collision,
      expectedTool: "order_review",
      argumentPredicate: { kind: "empty" },
      allowedEffects: [],
      replayPolicy: "read_only"
    });
    expect(JUDGE_QUICK_START_RUNTIME_VARIANTS).toEqual([
      "standard",
      "planted-cart-update-noop",
      "semantic-collision"
    ]);
  });
});
