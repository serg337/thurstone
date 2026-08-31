import { describe, expect, it } from "vitest";

import {
  createWorkshopContract,
  mutationOperationId,
  parseWorkshopContract,
  workshopContractDigest,
  type WorkshopContractInput
} from "@/lib/demo/contract";

const options = {
  testId: "workshop_11111111-1111-4111-8111-111111111111",
  createdAt: "2026-08-31T00:00:00.000Z"
};

function base(overrides: Partial<WorkshopContractInput> = {}): WorkshopContractInput {
  return {
    request: "Show me the complete order before I decide.",
    expectedDecision: { kind: "call", toolName: "order_review", arguments: {} },
    allowedEffects: [],
    forbiddenEffects: [
      { kind: "cart_mutation" },
      { kind: "pending_checkout" },
      { kind: "unmodeled_state" }
    ],
    replayPolicy: "read_only",
    ...overrides
  };
}

describe("Workshop contract", () => {
  it("accepts call, clarification, and no-action contracts", () => {
    expect(createWorkshopContract(base(), options).expectedDecision.kind).toBe("call");
    for (const kind of ["clarify", "no_action"] as const) {
      expect(
        createWorkshopContract(
          base({
            expectedDecision: { kind },
            allowedEffects: [],
            replayPolicy: "not_applicable"
          }),
          options
        ).expectedDecision.kind
      ).toBe(kind);
    }
  });

  it("enforces tool-specific schemas, effects, and replay", () => {
    const update = createWorkshopContract(
      base({
        expectedDecision: {
          kind: "call",
          toolName: "cart_update",
          arguments: {
            operationId: "workshop_update_0001",
            operation: "set_quantity",
            itemId: "stoneware-mug",
            quantity: 3
          }
        },
        allowedEffects: [{ kind: "cart_quantity", itemId: "stoneware-mug", quantity: 3 }],
        forbiddenEffects: [
          { kind: "pending_checkout" },
          { kind: "duplicate_transition" },
          { kind: "unmodeled_state" }
        ],
        replayPolicy: "exactly_once"
      }),
      options
    );
    expect(update.expectedDecision).toMatchObject({ toolName: "cart_update" });

    expect(() =>
      createWorkshopContract(
        base({
          expectedDecision: update.expectedDecision,
          allowedEffects: [],
          replayPolicy: "read_only"
        }),
        options
      )
    ).toThrow();
  });

  it("rejects unknown fields and a contract that permits unmodeled state", () => {
    const valid = createWorkshopContract(base(), options);
    expect(() => parseWorkshopContract({ ...valid, unexpected: true })).toThrow();
    expect(() =>
      createWorkshopContract(
        base({ forbiddenEffects: [{ kind: "cart_mutation" }, { kind: "pending_checkout" }] }),
        options
      )
    ).toThrow(/unmodeled state/iu);
  });

  it("normalizes title/request and produces a stable canonical digest", async () => {
    const contract = createWorkshopContract(
      base({ title: "  Read-only order review  ", request: "  Review this order.  " }),
      options
    );
    expect(contract.title).toBe("Read-only order review");
    expect(contract.request).toBe("Review this order.");
    await expect(workshopContractDigest(contract)).resolves.toBe(
      await workshopContractDigest(parseWorkshopContract(JSON.parse(JSON.stringify(contract))))
    );
  });

  it("generates operation IDs accepted by the mutation schema", () => {
    for (const tool of ["cart_update", "checkout_request"] as const) {
      expect(mutationOperationId(tool)).toMatch(new RegExp(`^${tool}_[A-Za-z0-9-]{36}$`, "u"));
    }
  });
});
