import { describe, expect, it } from "vitest";

import {
  createJudgeQuickStartSuite,
  JUDGE_QUICK_START_REQUEST
} from "@/lib/demo/judge-quick-start";
import { verifyThurstoneContractSuite } from "@/lib/demo/contract-suite";

describe("judge quick start contract", () => {
  it("freezes one visible cart mutation against the complete real reference catalog", async () => {
    const { suite, selectedCase } = await createJudgeQuickStartSuite({
      suiteId: "suite_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      caseId: "case_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      createdAt: "2026-09-03T08:00:00.000Z"
    });

    await expect(verifyThurstoneContractSuite(suite)).resolves.toEqual(suite);
    expect(suite.catalogSnapshot.tools.map(({ name }) => name)).toEqual([
      "cart_get",
      "cart_update",
      "order_review",
      "checkout_request"
    ]);
    expect(suite.cases).toHaveLength(1);
    expect(suite.selectedCaseId).toBe(selectedCase.caseId);
    expect(selectedCase).toMatchObject({
      request: JUDGE_QUICK_START_REQUEST,
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
  });
});
