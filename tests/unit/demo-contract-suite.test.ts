import { describe, expect, it } from "vitest";

import {
  ContractSuiteOperationError,
  THURSTONE_CONTRACT_SUITE_MAX_CASES,
  addContractSuiteCase,
  clearContractSuiteCases,
  createThurstoneContractSuite,
  editContractSuiteCase,
  getArmableContractSuiteSelection,
  parseThurstoneContractSuite,
  removeContractSuiteCase,
  renameContractSuite,
  selectContractSuiteCase,
  thurstoneContractSuiteDigest,
  updateContractSuiteCatalog,
  verifyThurstoneContractSuite,
  type ThurstoneContractCaseInput,
  type ThurstoneContractSuiteV1
} from "@/lib/demo/contract-suite";
import {
  createThurstoneDemoCatalogSnapshot,
  type ThurstoneDemoSelectableToolName
} from "@/lib/demo/catalog-snapshot";

const suiteId = "suite_11111111-1111-4111-8111-111111111111";
const caseIds = Array.from(
  { length: 8 },
  (_, index) => `case_00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
);
const at = (second: number) => `2026-09-01T00:00:${String(second).padStart(2, "0")}.000Z`;

function reviewInput(
  overrides: Partial<ThurstoneContractCaseInput> = {}
): ThurstoneContractCaseInput {
  return {
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
    approvalClass: "read_only",
    ...overrides
  };
}

function caseInputFor(toolName: ThurstoneDemoSelectableToolName): ThurstoneContractCaseInput {
  if (toolName === "cart_get") {
    return reviewInput({
      name: "Read cart",
      request: "What is in my cart?",
      expectedTool: "cart_get"
    });
  }
  if (toolName === "order_review") {
    return reviewInput();
  }
  if (toolName === "cart_update") {
    return {
      name: "Update mug quantity",
      request: "Set the stoneware mug quantity to three.",
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
    };
  }
  return {
    name: "Request checkout",
    request: "I am ready—request checkout for this cart.",
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
  };
}

async function emptySuite(
  selectedToolNames: readonly ThurstoneDemoSelectableToolName[] = [
    "order_review",
    "checkout_request"
  ]
): Promise<ThurstoneContractSuiteV1> {
  const catalogSnapshot = createThurstoneDemoCatalogSnapshot({ selectedToolNames });
  return createThurstoneContractSuite({
    suiteId,
    name: "Checkout meaning",
    catalogSnapshot,
    createdAt: at(0)
  });
}

async function suiteWithCase(
  input: ThurstoneContractCaseInput = reviewInput()
): Promise<ThurstoneContractSuiteV1> {
  return addContractSuiteCase(await emptySuite(), input, {
    caseId: caseIds[0]!,
    updatedAt: at(1)
  });
}

describe("Thurstone contract suite", () => {
  it("creates a strict empty versioned suite and a stable canonical digest", async () => {
    const suite = await emptySuite();
    expect(suite).toMatchObject({
      version: "thurstone-contract-suite@1",
      suiteId,
      cases: [],
      selectedCaseId: null,
      issuedCaseIds: []
    });
    expect(Object.isFrozen(suite.catalogSnapshot.tools)).toBe(true);
    await expect(verifyThurstoneContractSuite(suite)).resolves.toEqual(suite);
    await expect(thurstoneContractSuiteDigest(suite)).resolves.toBe(
      await thurstoneContractSuiteDigest(JSON.parse(JSON.stringify(suite)))
    );
    expect(() => parseThurstoneContractSuite({ ...suite, unexpected: true })).toThrow();
    await expect(
      verifyThurstoneContractSuite({ ...suite, catalogDigest: "0".repeat(64) })
    ).rejects.toMatchObject({ code: "catalog_digest_mismatch" });
  });

  it("normalizes names and rejects unsafe or regressing updates", async () => {
    const catalogSnapshot = createThurstoneDemoCatalogSnapshot();
    const suite = await createThurstoneContractSuite({
      suiteId,
      name: "  Checkout intent suite  ",
      catalogSnapshot,
      createdAt: at(0)
    });
    expect(suite.name).toBe("Checkout intent suite");
    expect(renameContractSuite(suite, "Meaning checks", { updatedAt: at(1) }).name).toBe(
      "Meaning checks"
    );
    expect(() =>
      renameContractSuite(suite, "Visit https://example.com", { updatedAt: at(1) })
    ).toThrow(/plain synthetic text/iu);
    expect(() => renameContractSuite(suite, "Too early", { updatedAt: at(0) })).toThrow(
      ContractSuiteOperationError
    );
  });

  it("accepts every selectable real tool only with its exact argument/effect policy", async () => {
    let suite = await emptySuite(["cart_get", "cart_update", "checkout_request", "order_review"]);
    for (const [index, toolName] of (
      ["cart_get", "cart_update", "checkout_request", "order_review"] as const
    ).entries()) {
      suite = addContractSuiteCase(suite, caseInputFor(toolName), {
        caseId: caseIds[index]!,
        updatedAt: at(index + 1)
      });
    }
    expect(suite.cases.map(({ expectedTool }) => expectedTool)).toEqual([
      "cart_get",
      "cart_update",
      "checkout_request",
      "order_review"
    ]);

    expect(() =>
      addContractSuiteCase(
        suite,
        {
          ...caseInputFor("cart_update"),
          allowedEffects: [{ kind: "cart_quantity", itemId: "stoneware-mug", quantity: 4 }]
        },
        { caseId: caseIds[5]!, updatedAt: at(5) }
      )
    ).toThrow(/matching cart-quantity effect/iu);
    expect(() =>
      addContractSuiteCase(
        suite,
        {
          ...caseInputFor("checkout_request"),
          request: "Begin checkout now.",
          replayPolicy: "read_only"
        },
        { caseId: caseIds[5]!, updatedAt: at(5) }
      )
    ).toThrow(/exactly-once replay/iu);
    expect(() =>
      addContractSuiteCase(
        suite,
        {
          ...reviewInput(),
          request: "Review this order now.",
          allowedEffects: [{ kind: "pending_checkout" }]
        },
        { caseId: caseIds[5]!, updatedAt: at(5) }
      )
    ).toThrow(/requires empty arguments/iu);

    expect(() =>
      addContractSuiteCase(
        suite,
        {
          ...caseInputFor("cart_update"),
          name: "Seeded no-op",
          request: "Keep the stoneware mug quantity at two.",
          argumentPredicate: {
            kind: "cart_update",
            operationId: "valid_unique",
            operation: "set_quantity",
            itemId: "stoneware-mug",
            quantity: 2
          },
          allowedEffects: [{ kind: "cart_quantity", itemId: "stoneware-mug", quantity: 2 }]
        },
        { caseId: caseIds[5]!, updatedAt: at(5) }
      )
    ).toThrow(/different from the exact seeded fixture/iu);

    expect(() =>
      addContractSuiteCase(
        suite,
        {
          ...caseInputFor("checkout_request"),
          name: "Contradictory checkout",
          request: "Begin checkout with contradictory effects.",
          forbiddenEffects: [
            { kind: "pending_checkout" },
            { kind: "cart_mutation" },
            { kind: "duplicate_transition" },
            { kind: "unmodeled_state" }
          ]
        },
        { caseId: caseIds[5]!, updatedAt: at(5) }
      )
    ).toThrow(/both permitted and prohibited/iu);
  });

  it("rejects expected tools outside the selected catalog and strict unknown case fields", async () => {
    const suite = await emptySuite();
    expect(() =>
      addContractSuiteCase(suite, caseInputFor("cart_update"), {
        caseId: caseIds[0]!,
        updatedAt: at(1)
      })
    ).toThrow(/expected tool must exist/iu);

    const valid = await suiteWithCase();
    expect(() =>
      parseThurstoneContractSuite({
        ...valid,
        cases: [{ ...valid.cases[0], unknownCaseField: true }]
      })
    ).toThrow();
  });

  it("rejects exact semantic duplicates independently of their display names", async () => {
    const suite = await suiteWithCase();
    expect(() =>
      addContractSuiteCase(
        suite,
        { ...reviewInput(), name: "Same semantic case" },
        {
          caseId: caseIds[1]!,
          updatedAt: at(2)
        }
      )
    ).toThrowError(expect.objectContaining({ code: "duplicate_semantic_case" }));
  });

  it("supports immutable add, edit, select, remove, and explicit clear operations", async () => {
    const original = await emptySuite();
    const added = addContractSuiteCase(original, reviewInput(), {
      caseId: caseIds[0]!,
      updatedAt: at(1)
    });
    expect(original.cases).toHaveLength(0);
    expect(added.cases).toHaveLength(1);

    const edited = editContractSuiteCase(
      added,
      caseIds[0]!,
      { ...reviewInput(), request: "Please show the final order summary." },
      { updatedAt: at(2) }
    );
    expect(edited.cases[0]?.request).toBe("Please show the final order summary.");
    expect(added.cases[0]?.request).toBe("Show me the complete order.");

    const selected = selectContractSuiteCase(edited, caseIds[0]!, { updatedAt: at(3) });
    await expect(getArmableContractSuiteSelection(selected)).resolves.toMatchObject({
      selectedCase: { caseId: caseIds[0] }
    });

    const removed = removeContractSuiteCase(selected, caseIds[0]!, { updatedAt: at(4) });
    expect(removed).toMatchObject({ cases: [], selectedCaseId: null });
    expect(removed.issuedCaseIds).toEqual([caseIds[0]]);
    expect(() =>
      addContractSuiteCase(removed, reviewInput(), {
        caseId: caseIds[0]!,
        updatedAt: at(5)
      })
    ).toThrowError(expect.objectContaining({ code: "case_id_already_issued" }));

    const replacement = addContractSuiteCase(removed, reviewInput(), {
      caseId: caseIds[1]!,
      updatedAt: at(5)
    });
    const cleared = clearContractSuiteCases(replacement, { updatedAt: at(6) });
    expect(cleared).toMatchObject({ cases: [], selectedCaseId: null });
    expect(cleared.issuedCaseIds).toEqual([caseIds[0], caseIds[1]]);
  });

  it("bounds suites to six cases and preserves an explicit empty/unselected arm state", async () => {
    const empty = await emptySuite();
    await expect(getArmableContractSuiteSelection(empty)).rejects.toMatchObject({
      code: "suite_empty"
    });
    let suite = empty;
    for (let index = 0; index < THURSTONE_CONTRACT_SUITE_MAX_CASES; index += 1) {
      suite = addContractSuiteCase(
        suite,
        reviewInput({
          name: `Review wording ${index + 1}`,
          request: `Show me order wording ${index + 1}.`
        }),
        { caseId: caseIds[index]!, updatedAt: at(index + 1) }
      );
    }
    expect(suite.cases).toHaveLength(6);
    expect(() =>
      addContractSuiteCase(
        suite,
        reviewInput({ name: "Seventh", request: "Show me a seventh wording." }),
        { caseId: caseIds[6]!, updatedAt: at(7) }
      )
    ).toThrowError(expect.objectContaining({ code: "case_limit_reached" }));
    await expect(getArmableContractSuiteSelection(suite)).rejects.toMatchObject({
      code: "selected_case_required"
    });
  });

  it("fails closed when catalog removal would orphan a case and rebinds safe edits", async () => {
    let suite = await emptySuite(["cart_get", "order_review", "checkout_request"]);
    suite = addContractSuiteCase(suite, caseInputFor("cart_get"), {
      caseId: caseIds[0]!,
      updatedAt: at(1)
    });
    const removal = createThurstoneDemoCatalogSnapshot({
      selectedToolNames: ["order_review", "checkout_request"]
    });
    await expect(
      updateContractSuiteCatalog(suite, removal, { updatedAt: at(2) })
    ).rejects.toMatchObject({ code: "catalog_tool_referenced" });

    const descriptorEdit = createThurstoneDemoCatalogSnapshot({
      selectedToolNames: ["cart_get", "order_review", "checkout_request"],
      descriptorOverrides: {
        cart_get: {
          title: "Inspect current cart",
          description: "Return current cart line identities and quantities without changing state."
        }
      }
    });
    const updated = await updateContractSuiteCatalog(suite, descriptorEdit, { updatedAt: at(2) });
    expect(updated.catalogDigest).not.toBe(suite.catalogDigest);
    expect(updated.cases[0]?.catalogDigest).toBe(updated.catalogDigest);
    await expect(verifyThurstoneContractSuite(updated)).resolves.toEqual(updated);
  });

  it("rejects parser-level referential, duplicate-ID, and timestamp tampering", async () => {
    const suite = await suiteWithCase();
    expect(() => parseThurstoneContractSuite({ ...suite, selectedCaseId: caseIds[1] })).toThrow(
      /selected case/iu
    );
    expect(() => parseThurstoneContractSuite({ ...suite, issuedCaseIds: [] })).toThrow(
      /active case ID/iu
    );
    expect(() =>
      parseThurstoneContractSuite({ ...suite, updatedAt: "2025-01-01T00:00:00.000Z" })
    ).toThrow(/cannot precede/iu);
    expect(() =>
      parseThurstoneContractSuite({
        ...suite,
        cases: [suite.cases[0], suite.cases[0]]
      })
    ).toThrow(/Case IDs must be unique/iu);
  });
});
