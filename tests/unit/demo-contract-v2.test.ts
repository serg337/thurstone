import { describe, expect, it } from "vitest";

import {
  byoaContractDigest,
  createByoaContract,
  createByoaDescriptorSnapshot,
  parseByoaContract,
  verifyByoaContract,
  type CreateByoaContractInput
} from "@/lib/demo/contract-v2";

const fixed = {
  contractId: "byoa_11111111-1111-4111-8111-111111111111",
  buildCommit: "b".repeat(40),
  createdAt: "2026-09-01T00:00:00.000Z"
};

async function reviewInput(
  overrides: Partial<CreateByoaContractInput> = {}
): Promise<CreateByoaContractInput> {
  const snapshot = await createByoaDescriptorSnapshot();
  return {
    ...fixed,
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
    ...overrides
  };
}

async function checkoutInput(
  overrides: Partial<CreateByoaContractInput> = {}
): Promise<CreateByoaContractInput> {
  const snapshot = await createByoaDescriptorSnapshot();
  return {
    ...fixed,
    contractId: "byoa_22222222-2222-4222-8222-222222222222",
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
    approvalClass: "consequential",
    ...snapshot,
    ...overrides
  };
}

describe("BYOA Contract v2", () => {
  it("accepts the exact review and checkout variants", async () => {
    await expect(
      verifyByoaContract(createByoaContract(await reviewInput()))
    ).resolves.toMatchObject({
      expectedTool: "order_review",
      argumentPredicate: { kind: "empty" },
      replayPolicy: "read_only"
    });
    await expect(
      verifyByoaContract(createByoaContract(await checkoutInput()))
    ).resolves.toMatchObject({
      expectedTool: "checkout_request",
      argumentPredicate: { kind: "checkout_request", operationId: "valid_unique" },
      replayPolicy: "exactly_once"
    });
  });

  it("freezes exact descriptor identity, schema, order, and annotations", async () => {
    const valid = createByoaContract(await reviewInput());
    expect(valid.descriptors.map(({ name }) => name)).toEqual(["order_review", "checkout_request"]);

    const reversed = [...valid.descriptors].reverse();
    const reversedInput = { ...(await reviewInput()), descriptors: reversed };
    expect(() => createByoaContract(reversedInput)).toThrow(/frozen two-tool order/iu);
    const changedSchema = valid.descriptors.map((descriptor) =>
      descriptor.name === "order_review"
        ? { ...descriptor, inputSchema: { type: "object", additionalProperties: true } }
        : descriptor
    );
    const changedSchemaInput = { ...(await reviewInput()), descriptors: changedSchema };
    expect(() => createByoaContract(changedSchemaInput)).toThrow(/schemas are frozen/iu);
  });

  it("allows bounded titles/descriptions but rejects markup, URLs, and secret-shaped text", async () => {
    const customized = await createByoaDescriptorSnapshot({
      orderReview: {
        title: "Inspect the order",
        description: "Return the full order summary without changing checkout state."
      }
    });
    expect(customized.descriptors[0]?.title).toBe("Inspect the order");

    for (const description of [
      "Read details at https://example.com before using this tool.",
      "Return <script>alert(1)</script> for the current order.",
      "Use credential sk-examplecredential123456789 to review the order."
    ]) {
      await expect(createByoaDescriptorSnapshot({ orderReview: { description } })).rejects.toThrow(
        /plain synthetic text/iu
      );
    }
  });

  it("enforces tool-specific effects, replay, approval, and unmodeled-state protection", async () => {
    const invalidReview = await reviewInput({
      allowedEffects: [{ kind: "pending_checkout" }],
      replayPolicy: "exactly_once"
    });
    expect(() => createByoaContract(invalidReview)).toThrow(/order_review requires/iu);
    const missingInvariant = await checkoutInput({
      forbiddenEffects: [{ kind: "cart_mutation" }, { kind: "duplicate_transition" }]
    });
    expect(() => createByoaContract(missingInvariant)).toThrow(/unmodeled state/iu);
    const invalidArguments = await checkoutInput({ argumentPredicate: { kind: "empty" } });
    expect(() => createByoaContract(invalidArguments)).toThrow(/unique operation ID/iu);
  });

  it("rejects unknown fields and tampered descriptor digests", async () => {
    const valid = createByoaContract(await reviewInput());
    expect(() => parseByoaContract({ ...valid, unexpected: true })).toThrow();
    await expect(
      verifyByoaContract({ ...valid, descriptorDigest: "0".repeat(64) })
    ).rejects.toThrow(/descriptor digest/iu);
  });

  it("produces stable canonical descriptor and contract digests", async () => {
    const first = createByoaContract(await reviewInput());
    const roundTrip = parseByoaContract(JSON.parse(JSON.stringify(first)) as unknown);
    await expect(byoaContractDigest(first)).resolves.toBe(await byoaContractDigest(roundTrip));
    expect(first.descriptorDigest).toBe(roundTrip.descriptorDigest);
  });
});
