import { describe, expect, it } from "vitest";

import {
  BYOA_CONTINUOUS_JOURNEY_VERSION,
  byoaContinuousJourneyPlanSchema
} from "@/lib/demo/agent-handoff-v2";
import { createThurstoneDemoCatalogSnapshot } from "@/lib/demo/catalog-snapshot";
import {
  addContractSuiteCase,
  createThurstoneContractSuite,
  selectContractSuiteCase,
  type ThurstoneContractCaseInput
} from "@/lib/demo/contract-suite";
import { createByoaContractV3, expectedLineageForThurstoneSuite } from "@/lib/demo/contract-v3";
import { createCompiledByoaSessionV2, transitionByoaSessionV2 } from "@/lib/demo/agent-session-v2";
import { parseContinuousJourneyRedisRecord } from "@/lib/demo/continuous-journey.server";

const at = (second: number) => `2026-09-02T12:00:${String(second).padStart(2, "0")}.000Z`;
const readOnlyCase: ThurstoneContractCaseInput = {
  name: "Read cart",
  request: "What is in my cart?",
  expectedTool: "cart_get",
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

async function planFixture() {
  let suite = await createThurstoneContractSuite({
    suiteId: "suite_12121212-1212-4212-8212-121212121212",
    name: "Redis journey fixture",
    catalogSnapshot: createThurstoneDemoCatalogSnapshot({
      selectedToolNames: ["cart_get", "order_review"]
    }),
    createdAt: at(0)
  });
  suite = addContractSuiteCase(suite, readOnlyCase, {
    caseId: "case_23232323-2323-4232-8232-232323232323",
    updatedAt: at(1)
  });
  suite = addContractSuiteCase(
    suite,
    {
      ...readOnlyCase,
      name: "Review order",
      request: "Show me the complete order.",
      expectedTool: "order_review"
    },
    {
      caseId: "case_34343434-3434-4343-8343-343434343434",
      updatedAt: at(2)
    }
  );
  const steps = [];
  for (const [index, testCase] of suite.cases.entries()) {
    const selected = selectContractSuiteCase(suite, testCase.caseId, {
      updatedAt: at(3 + index)
    });
    const lineage = await expectedLineageForThurstoneSuite(selected);
    const contract = await createByoaContractV3({
      contractId: `byoa_${index === 0 ? "45454545-4545-4454-8454-454545454545" : "56565656-5656-4565-8565-565656565656"}`,
      suite: selected,
      buildCommit: "b".repeat(40),
      createdAt: at(5 + index)
    });
    const compiled = await createCompiledByoaSessionV2({
      runId: `byoa_run_${index === 0 ? "67676767-6767-4676-8676-676767676767" : "78787878-7878-4787-8787-787878787878"}`,
      contract,
      lineage,
      createdAt: at(7 + index),
      expiresAt: "2026-09-02T12:10:00.000Z"
    });
    steps.push(
      transitionByoaSessionV2(compiled, "HANDOFF_ISSUED", {
        at: at(9 + index),
        reasonCode: "owner_issued_fresh_handoff"
      })
    );
  }
  return byoaContinuousJourneyPlanSchema.parse({
    version: BYOA_CONTINUOUS_JOURNEY_VERSION,
    journeyId: "journey_89898989-8989-4898-8989-898989898989",
    mode: "regression",
    processEndingToolNames: [],
    steps
  });
}

describe("production Redis journey decoding", () => {
  it("accepts both raw JSON strings and Upstash automatically deserialized values", async () => {
    const plan = await planFixture();
    const first = plan.steps[0]!;
    const common = [
      1,
      plan.journeyId,
      BYOA_CONTINUOUS_JOURNEY_VERSION,
      null,
      0,
      first.runId,
      first.contractDigest,
      Date.parse(first.expiresAt),
      null
    ];
    const raw = parseContinuousJourneyRedisRecord([
      ...common.slice(0, 3),
      JSON.stringify(plan),
      ...common.slice(4, 8),
      "[]"
    ]);
    const deserialized = parseContinuousJourneyRedisRecord([
      ...common.slice(0, 3),
      plan,
      ...common.slice(4, 8),
      []
    ]);

    expect(raw).toEqual(deserialized);
    expect(deserialized).toMatchObject({
      plan,
      position: 0,
      currentRunId: first.runId,
      currentContractDigest: first.contractDigest,
      results: []
    });
  });

  it("fails closed when the decoded record does not match the frozen current step", async () => {
    const plan = await planFixture();
    const first = plan.steps[0]!;
    expect(() =>
      parseContinuousJourneyRedisRecord([
        1,
        plan.journeyId,
        BYOA_CONTINUOUS_JOURNEY_VERSION,
        plan,
        0,
        plan.steps[1]!.runId,
        first.contractDigest,
        Date.parse(first.expiresAt),
        []
      ])
    ).toThrow(/record binding/iu);
  });
});
