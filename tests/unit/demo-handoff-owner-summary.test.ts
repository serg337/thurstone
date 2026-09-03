import { beforeEach, describe, expect, it } from "vitest";

import {
  BYOA_OWNER_SUMMARY_TTL_MS,
  parseByoaOwnerSummaryEnvelope,
  readByoaOwnerSummary,
  resetByoaOwnerSummariesForTests,
  storeByoaOwnerSummary
} from "@/lib/demo/handoff-owner-summary.server";

const environment = {
  NODE_ENV: "test",
  TOOLPROOF_BROWSER_FAKE_PROBE: "1"
} as NodeJS.ProcessEnv;

const input = {
  runId: "byoa_run_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  contractDigest: "a".repeat(64),
  resultDigest: "b".repeat(64),
  ownerSummary: {
    caseId: "case_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    request: "Set the Stoneware mug quantity to 3.",
    expectedTool: "cart_update",
    observedTool: "cart_update",
    expectedArguments: { itemId: "stoneware-mug", quantity: 3 },
    actualArguments: { itemId: "stoneware-mug", quantity: 3 },
    verifiedEffect: "Set Stoneware mug quantity to 3",
    resultExplanation: "The native action and trusted state matched the owner contract.",
    primaryFindingCode: null,
    primaryFindingTitle: null,
    recommendedNextStep: null,
    trustedStateBefore: {
      revision: 0,
      lines: [
        { itemId: "field-notebook", name: "Field notebook", quantity: 1 },
        { itemId: "stoneware-mug", name: "Stoneware mug", quantity: 2 }
      ],
      pendingCheckoutStatus: null
    },
    trustedStateAfter: {
      revision: 1,
      lines: [
        { itemId: "field-notebook", name: "Field notebook", quantity: 1 },
        { itemId: "stoneware-mug", name: "Stoneware mug", quantity: 3 }
      ],
      pendingCheckoutStatus: null
    },
    ledger: {
      eventCountDelta: 1,
      stateTransitionCount: 1,
      operationLedgerCountDelta: 1,
      rejectedAdditionalAttempts: 0
    },
    assertions: { passed: 7, total: 7, failed: [] }
  }
};

describe("ephemeral owner result summary", () => {
  beforeEach(() => resetByoaOwnerSummariesForTests(environment));

  it("stores one bounded digest-bound summary idempotently outside the handoff ledger", async () => {
    expect(BYOA_OWNER_SUMMARY_TTL_MS).toBe(15 * 60 * 1000);
    await storeByoaOwnerSummary(input, environment);
    await storeByoaOwnerSummary(input, environment);
    await expect(readByoaOwnerSummary(input.runId, environment)).resolves.toMatchObject(input);
    await expect(
      storeByoaOwnerSummary({ ...input, resultDigest: "c".repeat(64) }, environment)
    ).rejects.toThrow("owner summary conflict");
  });

  it("accepts raw Redis strings and Upstash auto-deserialized objects", () => {
    const envelope = {
      version: "thurstone-byoa-owner-summary@1",
      ...input
    } as const;
    expect(parseByoaOwnerSummaryEnvelope(JSON.stringify(envelope))).toEqual(envelope);
    expect(parseByoaOwnerSummaryEnvelope(envelope)).toEqual(envelope);
  });
});
