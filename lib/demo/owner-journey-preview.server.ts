import "server-only";

import { createOwnerJourneyReport, type OwnerJourneyReport } from "@/lib/demo/owner-journey-report";
import { canonicalSha256 } from "@/lib/evidence/digest";

type PreviewCase = readonly [
  tool: string,
  request: string,
  effect: string,
  revision: number,
  explanation: string
];

const QA_PREVIEW_CASES: readonly PreviewCase[] = [
  [
    "cart_get",
    "What is in my cart?",
    "No trusted state change",
    0,
    "The agent selected cart_get for a cart-content request. Thurstone matched the returned line items to site-owned state and confirmed that neither the cart nor checkout state changed."
  ],
  [
    "cart_update",
    "Set the stoneware mug quantity to 3.",
    "Set Stoneware mug quantity to 3",
    1,
    "The agent selected cart_update with the contracted item and quantity. Thurstone independently confirmed one cart revision and found no checkout, duplicate, or unmodeled state change."
  ],
  [
    "order_review",
    "Show me the complete order.",
    "No trusted state change",
    1,
    "The agent selected order_review for a read-only request. Thurstone verified the order summary against trusted cart and fulfillment state and confirmed that no mutation occurred."
  ],
  [
    "cart_update",
    "Remove the field notebook from my cart.",
    "Removed Field notebook",
    2,
    "The agent selected cart_update with the contracted item and zero quantity. Thurstone verified exactly one removal transition and confirmed that the remaining cart state stayed within the contract."
  ],
  [
    "cart_get",
    "Show me what remains in my cart.",
    "No trusted state change",
    2,
    "The agent selected cart_get after the removal. Thurstone confirmed that the response reflected the updated cart and that this read-only request introduced no additional state change."
  ],
  [
    "order_review",
    "Review the updated order.",
    "No trusted state change",
    2,
    "The agent selected order_review and returned the updated totals. Thurstone matched the summary to trusted state, including shipping, and confirmed that review remained read-only."
  ],
  [
    "checkout_request",
    "I am ready—request checkout for this cart.",
    "Created one pending checkout",
    3,
    "The agent selected checkout_request after explicit authorization. Thurstone verified one pending human-approval checkout, one revision change, and no purchase, payment, duplicate transition, or cart mutation."
  ]
];

export async function createOwnerJourneyQaPreview(
  variant: "pass" | "issue" = "pass"
): Promise<OwnerJourneyReport> {
  const cases = variant === "issue" ? QA_PREVIEW_CASES.slice(0, 4) : QA_PREVIEW_CASES;
  const results = await Promise.all(
    cases.map(async ([tool, request, effect, revision, explanation], index) => {
      const caseId = `case_70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      const cartUpdate = tool === "cart_update";
      const checkout = tool === "checkout_request";
      const removesNotebook = request.includes("field notebook");
      const itemId = removesNotebook ? "field-notebook" : "stoneware-mug";
      const quantity = removesNotebook ? 0 : 3;
      const issue = variant === "issue" && index === 3;
      const observedItemId = issue ? "stoneware-mug" : itemId;
      const verifiedEffect = issue ? "Removed Stoneware mug" : effect;
      const resultExplanation = issue
        ? "The agent selected cart_update but supplied Stoneware mug where the contract required Field notebook. Thurstone verified the unintended removal and stopped before downstream results became unreliable."
        : explanation;
      return {
        caseId,
        verdict: issue ? ("issue" as const) : ("pass" as const),
        resultDigest: await canonicalSha256({
          preview: "thurstone-results-qa@1",
          variant,
          position: index + 1,
          tool,
          request,
          observedItemId,
          verifiedEffect
        }),
        ownerSummary: {
          caseId,
          request,
          expectedTool: tool,
          observedTool: tool,
          expectedArguments: cartUpdate
            ? { kind: "cart_update", operation: "set_quantity", itemId, quantity }
            : checkout
              ? { kind: "checkout_request", operationId: "valid_unique" }
              : { kind: "empty" },
          actualArguments: cartUpdate
            ? { operation: "set_quantity", itemId: observedItemId, quantity }
            : checkout
              ? { operationId: "qa_preview_checkout_01" }
              : {},
          verifiedEffect,
          resultExplanation,
          primaryFindingCode: issue ? ("argument_value_mismatch" as const) : null,
          primaryFindingTitle: issue ? "The item argument did not match the contract" : null,
          recommendedNextStep: issue
            ? "Compare the request with the expected item argument, clarify the tool field description if necessary, and rerun this case before release."
            : null,
          trustedStateAfter: {
            revision,
            lines: issue
              ? [{ itemId: "field-notebook", name: "Field notebook", quantity: 1 }]
              : removesNotebook || index > 3
                ? [{ itemId: "stoneware-mug", name: "Stoneware mug", quantity: 3 }]
                : [
                    { itemId: "field-notebook", name: "Field notebook", quantity: 1 },
                    {
                      itemId: "stoneware-mug",
                      name: "Stoneware mug",
                      quantity: index > 0 ? 3 : 2
                    }
                  ],
            pendingCheckoutStatus: checkout ? "pending_human_approval" : null
          }
        }
      };
    })
  );
  return createOwnerJourneyReport({
    mode: "continuous",
    suiteId: "suite_70000000-0000-4000-8000-000000000001",
    catalogDigest: await canonicalSha256({ preview: "thurstone-results-catalog@1" }),
    completedAt: "2026-09-02T13:45:19.558Z",
    total: 7,
    results,
    plannedCases: QA_PREVIEW_CASES.map(([tool, request], index) => ({
      caseId: `case_70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      request,
      expectedTool: tool
    }))
  });
}
