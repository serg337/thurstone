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
import {
  advanceContinuousJourney,
  parseContinuousJourneyRedisRecord,
  readContinuousJourneyByRun,
  recordContinuousJourneyResult,
  storeContinuousJourney
} from "@/lib/demo/continuous-journey.server";

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

function ownerSummary(plan: Awaited<ReturnType<typeof planFixture>>, position: number) {
  const step = plan.steps[position]!;
  return {
    caseId: step.contract.caseId,
    request: step.contract.request,
    expectedTool: step.contract.expectedTool,
    observedTool: step.contract.expectedTool,
    expectedArguments: step.contract.argumentPredicate,
    actualArguments: {},
    verifiedEffect: "No trusted state change",
    resultExplanation:
      "The agent selected the contract-required read-only tool and the trusted checkout state did not change.",
    primaryFindingCode: null,
    primaryFindingTitle: null,
    recommendedNextStep: null,
    trustedStateAfter: {
      revision: 0,
      lines: [
        { itemId: "field-notebook", name: "Field notebook", quantity: 1 },
        { itemId: "stoneware-mug", name: "Stoneware mug", quantity: 2 }
      ],
      pendingCheckoutStatus: null
    }
  };
}

function redisReply(
  plan: Awaited<ReturnType<typeof planFixture>>,
  options: {
    position?: number;
    results?: unknown;
    previousRunId?: string;
    previousResultDigest?: string;
    currentToken?: string;
  } = {}
) {
  const position = options.position ?? 0;
  const current = plan.steps[position]!;
  return [
    1,
    plan.journeyId,
    BYOA_CONTINUOUS_JOURNEY_VERSION,
    plan,
    position,
    current.runId,
    current.contractDigest,
    Date.parse(current.expiresAt),
    options.results ?? [],
    options.previousRunId ?? "",
    options.previousResultDigest ?? "",
    options.currentToken ?? ""
  ];
}

describe("production Redis journey decoding", () => {
  it("accepts both raw JSON strings and Upstash automatically deserialized values", async () => {
    const plan = await planFixture();
    const first = plan.steps[0]!;
    const rawReply = redisReply(plan);
    rawReply[3] = JSON.stringify(plan);
    rawReply[8] = "[]";
    const raw = parseContinuousJourneyRedisRecord(rawReply);
    const deserialized = parseContinuousJourneyRedisRecord(redisReply(plan));

    expect(raw).toEqual(deserialized);
    expect(deserialized).toMatchObject({
      plan,
      position: 0,
      currentRunId: first.runId,
      currentContractDigest: first.contractDigest,
      results: []
    });
  });

  it("preserves a completed result identically across opaque and legacy Upstash encodings", async () => {
    const plan = await planFixture();
    const first = plan.steps[0]!;
    const result = {
      runId: first.runId,
      verdict: "pass",
      resultDigest: "a".repeat(64),
      ownerSummary: ownerSummary(plan, 0)
    };
    const opaqueRaw = parseContinuousJourneyRedisRecord(
      redisReply(plan, { results: JSON.stringify([JSON.stringify(result)]) })
    );
    const opaqueDeserialized = parseContinuousJourneyRedisRecord(
      redisReply(plan, { results: [JSON.stringify(result)] })
    );
    const legacyDeserialized = parseContinuousJourneyRedisRecord(
      redisReply(plan, { results: [result] })
    );

    expect(opaqueRaw).toEqual(opaqueDeserialized);
    expect(opaqueDeserialized).toEqual(legacyDeserialized);
    expect(legacyDeserialized?.results).toEqual([result]);
  });

  it("parses the retry binding after the first result advances to the second case", async () => {
    const plan = await planFixture();
    const first = plan.steps[0]!;
    const resultDigest = "a".repeat(64);
    const result = {
      runId: first.runId,
      verdict: "pass",
      resultDigest,
      ownerSummary: ownerSummary(plan, 0)
    };
    const parsed = parseContinuousJourneyRedisRecord(
      redisReply(plan, {
        position: 1,
        results: [JSON.stringify(result)],
        previousRunId: first.runId,
        previousResultDigest: resultDigest,
        currentToken: "tbh2.retry-token"
      })
    );

    expect(parsed).toMatchObject({
      position: 1,
      currentRunId: plan.steps[1]!.runId,
      previousRunId: first.runId,
      previousResultDigest: resultDigest,
      currentToken: "tbh2.retry-token",
      results: [result]
    });
  });

  it("round-trips result and replay state through the production-shaped server API", async () => {
    const plan = await planFixture();
    const first = plan.steps[0]!;
    const second = plan.steps[1]!;
    const resultDigest = "a".repeat(64);
    const environment = { ...process.env, TOOLPROOF_BROWSER_FAKE_PROBE: "1" };

    await storeContinuousJourney(plan, Date.parse(first.expiresAt), environment);
    await recordContinuousJourneyResult(
      first.runId,
      "pass",
      resultDigest,
      ownerSummary(plan, 0),
      environment
    );
    const beforeAdvance = await readContinuousJourneyByRun(first.runId, environment);
    expect(beforeAdvance?.results).toHaveLength(1);
    await advanceContinuousJourney(
      beforeAdvance!,
      second,
      "tbh2.retry-token",
      resultDigest,
      environment
    );

    const byOriginalRun = await readContinuousJourneyByRun(first.runId, environment);
    const byNextRun = await readContinuousJourneyByRun(second.runId, environment);
    expect(byOriginalRun).toEqual(byNextRun);
    expect(byNextRun).toMatchObject({
      position: 1,
      currentRunId: second.runId,
      previousRunId: first.runId,
      previousResultDigest: resultDigest,
      currentToken: "tbh2.retry-token"
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
        [],
        "",
        "",
        ""
      ])
    ).toThrow(/record binding/iu);
  });

  it("fails closed when result order does not match the frozen plan", async () => {
    const plan = await planFixture();
    const second = plan.steps[1]!;
    expect(() =>
      parseContinuousJourneyRedisRecord(
        redisReply(plan, {
          results: [
            {
              runId: second.runId,
              verdict: "pass",
              resultDigest: "a".repeat(64),
              ownerSummary: ownerSummary(plan, 1)
            }
          ]
        })
      )
    ).toThrow(/result binding/iu);
  });
});
