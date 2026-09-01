import { describe, expect, it } from "vitest";

import { createThurstoneDemoCatalogSnapshot } from "@/lib/demo/catalog-snapshot";
import {
  addContractSuiteCase,
  createThurstoneContractSuite,
  selectContractSuiteCase,
  type ThurstoneContractCaseInput
} from "@/lib/demo/contract-suite";
import {
  byoaContractV3Digest,
  createByoaContractV3,
  expectedLineageForThurstoneSuite,
  parseByoaContractV3,
  selectedCaseFromByoaContractV3,
  verifyByoaContractV3
} from "@/lib/demo/contract-v3";
import {
  createByoaContract,
  createByoaDescriptorSnapshot,
  parseByoaContract
} from "@/lib/demo/contract-v2";
import {
  parseSupportedByoaContract,
  supportedByoaContractDigest,
  verifySupportedByoaContract
} from "@/lib/demo/contract-version";

const suiteId = "suite_11111111-1111-4111-8111-111111111111";
const reviewCaseId = "case_22222222-2222-4222-8222-222222222222";
const checkoutCaseId = "case_33333333-3333-4333-8333-333333333333";
const contractId = "byoa_44444444-4444-4444-8444-444444444444";
const buildCommit = "b".repeat(40);
const at = (second: number) => `2026-09-01T00:00:0${second}.000Z`;

const reviewCase: ThurstoneContractCaseInput = {
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

const checkoutCase: ThurstoneContractCaseInput = {
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

async function selectedSuite() {
  let suite = await createThurstoneContractSuite({
    suiteId,
    name: "Checkout meaning",
    catalogSnapshot: createThurstoneDemoCatalogSnapshot({
      selectedToolNames: ["cart_get", "order_review", "checkout_request"]
    }),
    createdAt: at(0)
  });
  suite = addContractSuiteCase(suite, reviewCase, { caseId: reviewCaseId, updatedAt: at(1) });
  suite = addContractSuiteCase(suite, checkoutCase, {
    caseId: checkoutCaseId,
    updatedAt: at(2)
  });
  return selectContractSuiteCase(suite, checkoutCaseId, { updatedAt: at(3) });
}

async function liveContract() {
  return createByoaContractV3({
    contractId,
    suite: await selectedSuite(),
    buildCommit,
    createdAt: at(4)
  });
}

describe("BYOA selected-case Contract v3", () => {
  it("compiles only the selected case and exact two-to-four-tool catalog", async () => {
    const contract = await liveContract();
    expect(contract).toMatchObject({
      version: "thurstone-byoa-contract@3",
      toolsetVersion: "thurstone-byoa-demo-toolset@2",
      suiteId,
      caseId: checkoutCaseId,
      expectedTool: "checkout_request"
    });
    expect(contract.catalogSnapshot.tools.map(({ name }) => name)).toEqual([
      "cart_get",
      "order_review",
      "checkout_request"
    ]);
    const bytes = JSON.stringify(contract);
    expect(bytes).not.toContain(reviewCaseId);
    expect(bytes).not.toContain(reviewCase.request);
    expect(bytes).not.toContain("issuedCaseIds");
    expect(selectedCaseFromByoaContractV3(contract)).toMatchObject({
      caseId: checkoutCaseId,
      request: checkoutCase.request
    });
  });

  it("verifies catalog, case, and independently derived full-suite lineage digests", async () => {
    const suite = await selectedSuite();
    const contract = await liveContract();
    const lineage = await expectedLineageForThurstoneSuite(suite);
    await expect(verifyByoaContractV3(contract, lineage)).resolves.toEqual(contract);
    await expect(
      verifyByoaContractV3(contract, { ...lineage, suiteDigest: "0".repeat(64) })
    ).rejects.toThrow(/expected suite and case lineage/iu);
    await expect(
      verifyByoaContractV3({ ...contract, catalogDigest: "0".repeat(64) }, lineage)
    ).rejects.toThrow();
    await expect(
      verifyByoaContractV3({ ...contract, caseDigest: "0".repeat(64) }, lineage)
    ).rejects.toThrow(/case digest/iu);
  });

  it("rejects unknown fields and cross-field tool or effect tampering", async () => {
    const contract = await liveContract();
    expect(() => parseByoaContractV3({ ...contract, surprise: true })).toThrow();
    expect(() =>
      parseByoaContractV3({
        ...contract,
        expectedTool: "order_review",
        argumentPredicate: { kind: "checkout_request", operationId: "valid_unique" }
      })
    ).toThrow(/order_review requires/iu);
    expect(() =>
      parseByoaContractV3({
        ...contract,
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
        catalogSnapshot: createThurstoneDemoCatalogSnapshot()
      })
    ).toThrow(/must exist in the live catalog/iu);
  });

  it("produces stable canonical contract digests", async () => {
    const contract = await liveContract();
    const roundTrip = parseByoaContractV3(JSON.parse(JSON.stringify(contract)) as unknown);
    const lineage = await expectedLineageForThurstoneSuite(await selectedSuite());
    await expect(byoaContractV3Digest(contract, lineage)).resolves.toBe(
      await byoaContractV3Digest(roundTrip, lineage)
    );
  });

  it("dispatches old v2 and new v3 without broadening the old parser", async () => {
    const descriptors = await createByoaDescriptorSnapshot();
    const v2 = createByoaContract({
      contractId: "byoa_55555555-5555-4555-8555-555555555555",
      request: reviewCase.request,
      expectedTool: "order_review",
      argumentPredicate: { kind: "empty" },
      allowedEffects: [],
      forbiddenEffects: reviewCase.forbiddenEffects,
      replayPolicy: "read_only",
      approvalClass: "read_only",
      ...descriptors,
      buildCommit,
      createdAt: at(4)
    });
    const v3 = await liveContract();
    const lineage = await expectedLineageForThurstoneSuite(await selectedSuite());
    expect(parseSupportedByoaContract(v2).version).toBe("thurstone-byoa-contract@2");
    expect(parseSupportedByoaContract(v3).version).toBe("thurstone-byoa-contract@3");
    await expect(verifySupportedByoaContract(v2)).resolves.toEqual(v2);
    await expect(verifySupportedByoaContract(v3)).rejects.toThrow(/requires independently/iu);
    await expect(verifySupportedByoaContract(v3, lineage)).resolves.toEqual(v3);
    await expect(supportedByoaContractDigest(v2)).resolves.toMatch(/^[a-f0-9]{64}$/u);
    await expect(supportedByoaContractDigest(v3)).rejects.toThrow(/requires independently/iu);
    await expect(supportedByoaContractDigest(v3, lineage)).resolves.toMatch(/^[a-f0-9]{64}$/u);
    expect(() => parseByoaContract(v3)).toThrow();
    expect(() => parseSupportedByoaContract({ version: "thurstone-byoa-contract@99" })).toThrow(
      /unsupported/iu
    );
  });
});
