import { describe, expect, it } from "vitest";

import {
  SEMANTIC_CONTRACT_VERSION,
  SEMANTIC_EFFECT_SURFACES,
  SEMANTIC_FAMILIES,
  SEMANTIC_SUITE_VERSION,
  SemanticSuiteValidationError,
  verifySemanticContract,
  verifySemanticSuiteStructure,
  type SemanticContract,
  type SemanticExpectation,
  type SemanticJsonValue,
  type SemanticMeaning,
  type SemanticScoredCase,
  type SemanticSuite
} from "@/lib/semantic/contract";
import {
  evaluateSemanticMatchedPair,
  evaluateSemanticTrial,
  type SemanticTrialObservation
} from "@/lib/semantic/evaluator.server";
import {
  SEMANTIC_SCHEDULE_VERSION,
  buildSemanticProtocolFreezeCandidate,
  deriveSemanticCaseOrder,
  type SemanticSchedule
} from "@/lib/semantic/protocol-freeze.server";
import {
  CHECKOUT_DOMAIN_VERSION,
  CHECKOUT_FIXTURE_ID,
  CHECKOUT_FIXTURE_SEED,
  CHECKOUT_FIXTURE_VERSION,
  cartUpdate,
  checkoutRequest,
  createCheckoutFixture,
  orderReview
} from "@/lib/domain/checkout";
import { createOperationTrace, type OperationTrace } from "@/lib/evidence/operation-trace";
import { CHECKOUT_TOOLSET_VERSION } from "@/lib/webmcp/catalog";
import type { SemanticResetBoundaryContract } from "@/lib/semantic/evaluator.server";

const FIXTURE_ID = CHECKOUT_FIXTURE_ID;
const RUNNER_OPERATION_ID = `probe_${"a".repeat(58)}`;
const REGISTRY_HASH = "b".repeat(64);
const INITIAL_STATE_HASH = "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457";
const REGISTERED_TOOLS = ["cart_get", "cart_update", "checkout_request", "order_review"];
const BOUNDARY_CONTRACT: SemanticResetBoundaryContract = {
  fixtureId: CHECKOUT_FIXTURE_ID,
  fixtureVersion: CHECKOUT_FIXTURE_VERSION,
  fixtureSeed: CHECKOUT_FIXTURE_SEED,
  stateHash: INITIAL_STATE_HASH,
  registryHash: REGISTRY_HASH,
  registeredToolNames: REGISTERED_TOOLS,
  appCommit: "a".repeat(40),
  domainVersion: CHECKOUT_DOMAIN_VERSION,
  toolsetVersion: CHECKOUT_TOOLSET_VERSION,
  handlerVersionByTool: {
    order_review: "order_review@synthetic",
    checkout_request: "checkout_request@synthetic",
    cart_update: "cart_update@synthetic"
  }
};

function resetBoundary() {
  return {
    status: "verified" as const,
    fixtureId: CHECKOUT_FIXTURE_ID,
    fixtureVersion: CHECKOUT_FIXTURE_VERSION,
    fixtureSeed: CHECKOUT_FIXTURE_SEED,
    stateRevision: 0,
    stateHash: INITIAL_STATE_HASH,
    expectedStateHash: INITIAL_STATE_HASH,
    operationLedgerCount: 0,
    currentTrajectoryCount: 0,
    registryHash: REGISTRY_HASH,
    registeredToolNames: REGISTERED_TOOLS
  };
}

function json(value: unknown): SemanticJsonValue {
  return JSON.parse(JSON.stringify(value)) as SemanticJsonValue;
}

const noChangedEffects = json({
  stateChanged: false,
  revision: { changed: false },
  quantities: [],
  pendingCheckout: { changed: false },
  unmodeledStateChanged: false
});

function stateChecks(revision: number) {
  return [{ path: "/revision", operator: "equals" as const, value: revision }];
}

function noCallExpectation(kind: "clarify" | "no_action"): SemanticExpectation {
  return {
    kind,
    stateChange: "forbidden",
    stateBefore: stateChecks(0),
    stateAfter: stateChecks(0),
    effect: [{ path: "/stateChanged", operator: "equals", value: false }]
  };
}

function readExpectation(): SemanticExpectation {
  return {
    kind: "call",
    tool: "order_review",
    arguments: { additionalProperties: "forbidden", predicates: [] },
    result: [{ path: "/ok", operator: "equals", value: true }],
    stateChange: "forbidden",
    stateBefore: stateChecks(0),
    stateAfter: stateChecks(0),
    effect: [{ path: "/stateChanged", operator: "equals", value: false }]
  };
}

function checkoutExpectation(): SemanticExpectation {
  return {
    kind: "call",
    tool: "checkout_request",
    arguments: {
      additionalProperties: "forbidden",
      predicates: [{ path: "/operationId", operator: "runner_operation_id" }]
    },
    result: [{ path: "/ok", operator: "equals", value: true }],
    stateChange: "required",
    stateBefore: stateChecks(0),
    stateAfter: stateChecks(1),
    effect: [{ path: "/pendingCheckout/changed", operator: "equals", value: true }]
  };
}

function updateExpectation(quantity: number): SemanticExpectation {
  return {
    kind: "call",
    tool: "cart_update",
    arguments: {
      additionalProperties: "forbidden",
      predicates: [
        { path: "/operationId", operator: "runner_operation_id" },
        { path: "/operation", operator: "equals", value: "set_quantity" },
        { path: "/itemId", operator: "equals", value: "field-notebook" },
        { path: "/quantity", operator: "equals", value: quantity }
      ]
    },
    result: [{ path: "/ok", operator: "equals", value: true }],
    stateChange: "required",
    stateBefore: stateChecks(0),
    stateAfter: stateChecks(1),
    effect: [{ path: "/quantities/0/changed", operator: "equals", value: true }]
  };
}

function expectationFor(familyIndex: number, side: 0 | 1): SemanticExpectation {
  if (familyIndex === 0) return readExpectation();
  if (familyIndex === 1) return checkoutExpectation();
  if (familyIndex === 2) return side === 0 ? readExpectation() : checkoutExpectation();
  if (familyIndex === 3) return side === 0 ? checkoutExpectation() : noCallExpectation("no_action");
  if (familyIndex === 4) return updateExpectation(side === 0 ? 2 : 3);
  return side === 0 ? noCallExpectation("clarify") : checkoutExpectation();
}

function meaningFields(
  expectation: SemanticExpectation
): Pick<SemanticMeaning, "approvalClass" | "allowedEffects" | "forbiddenEffects"> {
  if (expectation.kind !== "call") {
    return {
      approvalClass: "no-action" as const,
      allowedEffects: [],
      forbiddenEffects: [...SEMANTIC_EFFECT_SURFACES]
    };
  }
  if (expectation.tool === "order_review") {
    return {
      approvalClass: "read-only" as const,
      allowedEffects: [],
      forbiddenEffects: [...SEMANTIC_EFFECT_SURFACES]
    };
  }
  if (expectation.tool === "checkout_request") {
    return {
      approvalClass: "human-gated-consequential-request" as const,
      allowedEffects: ["state-revision", "pending-checkout"],
      forbiddenEffects: ["cart-quantities", "unmodeled-state"]
    };
  }
  return {
    approvalClass: "reversible-mutation" as const,
    allowedEffects: ["state-revision", "cart-quantities"],
    forbiddenEffects: ["pending-checkout", "unmodeled-state"]
  };
}

function runnerCaseId(index: number): string {
  return `case_${String(index).padStart(22, "0")}`;
}

function createSyntheticArtifacts(): { contract: SemanticContract; suite: SemanticSuite } {
  const scoredCases: Record<string, unknown>[] = [];
  const meanings = new Map<string, Record<string, unknown>>();
  let ordinal = 1;
  SEMANTIC_FAMILIES.forEach((family, familyIndex) => {
    (["development", "builder-blinded-holdout"] as const).forEach((subset, subsetIndex) => {
      ([0, 1] as const).forEach((side) => {
        const equivalence = familyIndex < 2;
        const meaningId = equivalence
          ? `meaning_${familyIndex}_${subsetIndex}_synthetic`
          : `meaning_${familyIndex}_${subsetIndex}_${side}_synthetic`;
        const expectation = expectationFor(familyIndex, side);
        if (!meanings.has(meaningId)) {
          meanings.set(meaningId, {
            meaningId,
            label: `Synthetic meaning ${meaningId}`,
            approvedMeaning: "Synthetic test meaning; never a Gate 3 authoring candidate.",
            ...meaningFields(expectation),
            expectation
          });
        }
        const relationship = equivalence
          ? {
              kind: "equivalent_realization",
              groupId: `equiv_${familyIndex}_${subsetIndex}_synthetic`
            }
          : {
              kind: "matched_boundary",
              pairId: `boundary_${familyIndex}_${subsetIndex}_synthetic`,
              side: side === 0 ? "anchor" : "contrast",
              materialDifference: `Synthetic material difference ${familyIndex}/${subsetIndex}.`
            };
        scoredCases.push({
          caseId: `synthetic_case_${String(ordinal).padStart(2, "0")}`,
          runnerCaseId: runnerCaseId(ordinal),
          purpose: "scored",
          subset,
          family,
          fixtureId: FIXTURE_ID,
          meaningId,
          naturalLanguageRequest: `SYNTHETIC TEST ONLY request ${ordinal}.`,
          relationship
        });
        ordinal += 1;
      });
    });
  });

  const contract = verifySemanticContract({
    version: SEMANTIC_CONTRACT_VERSION,
    contractId: "synthetic_contract",
    domain: "Synthetic checkout test domain",
    taskBoundary: "Synthetic single-step decisions used only to exercise structural machinery.",
    equivalencePrinciple: "Synthetic equivalent requests share one action signature.",
    sensitivityPrinciple: "Synthetic boundary requests change one action signature.",
    actionClasses: ["call", "clarify", "no_action"],
    maximumModelDecisions: 1,
    maximumTargetCalls: 1,
    meanings: [...meanings.values()]
  });
  const calibrationExpectations = [
    readExpectation(),
    checkoutExpectation(),
    noCallExpectation("clarify"),
    noCallExpectation("no_action")
  ];
  const suite = verifySemanticSuiteStructure(
    {
      version: SEMANTIC_SUITE_VERSION,
      suiteId: "synthetic_suite",
      scoredCases,
      calibrationCases: calibrationExpectations.map((expectation, index) => ({
        caseId: `synthetic_calibration_${index + 1}`,
        runnerCaseId: runnerCaseId(25 + index),
        purpose: "calibration",
        excludedFromBenchmark: true,
        fixtureId: FIXTURE_ID,
        naturalLanguageRequest: `SYNTHETIC CALIBRATION ONLY request ${index + 1}.`,
        expectation
      }))
    },
    contract
  );
  return { contract, suite };
}

async function observationFor(
  contract: SemanticContract,
  scoredCase: SemanticScoredCase
): Promise<SemanticTrialObservation> {
  const expectation = contract.meanings.find(
    ({ meaningId }) => meaningId === scoredCase.meaningId
  )?.expectation;
  if (!expectation) throw new Error("Synthetic meaning missing.");
  const initial = createCheckoutFixture();
  const before = json(initial);
  if (expectation.kind !== "call") {
    return {
      decision:
        expectation.kind === "clarify"
          ? { kind: "clarify", text: "Which action do you want?" }
          : { kind: "abstain", reason: "No action requested." },
      modelDecisionCount: 1,
      usableStructuredDecisionCount: 1,
      providerToolCallCount: 0,
      nativeDispatchCount: 0,
      handlerTraceCount: 0,
      beforeReset: resetBoundary(),
      afterReset: resetBoundary(),
      targetCalls: [],
      runnerOperationId: RUNNER_OPERATION_ID,
      stateBefore: before,
      stateAfter: before,
      effect: noChangedEffects
    };
  }

  let argumentsValue: Record<string, SemanticJsonValue> = {};
  let stateAfter = initial;
  let resultValue: unknown = orderReview(initial);
  if (expectation.tool === "checkout_request") {
    argumentsValue = { operationId: RUNNER_OPERATION_ID };
    const mutation = checkoutRequest(initial, { operationId: RUNNER_OPERATION_ID }, "c".repeat(64));
    stateAfter = mutation.state;
    resultValue = mutation.result;
  } else if (expectation.tool === "cart_update") {
    const quantityPredicate = expectation.arguments.predicates.find(
      ({ path }) => path === "/quantity"
    );
    const quantity = quantityPredicate?.operator === "equals" ? quantityPredicate.value : 2;
    argumentsValue = {
      operationId: RUNNER_OPERATION_ID,
      operation: "set_quantity",
      itemId: "field-notebook",
      quantity
    };
    const mutation = cartUpdate(initial, {
      operationId: RUNNER_OPERATION_ID,
      operation: "set_quantity",
      itemId: "field-notebook",
      quantity: quantity as number
    });
    stateAfter = mutation.state;
    resultValue = mutation.result;
  }
  const trace = await createOperationTrace({
    eventId: `event_${scoredCase.caseId}`,
    sessionId: "session_synthetic_gate3",
    runId: "trajectory_synthetic_gate3",
    sequence: 1,
    source: "native",
    toolName: expectation.tool,
    operationId: expectation.tool === "order_review" ? null : RUNNER_OPERATION_ID,
    observedAt: "2026-08-28T00:00:00.000Z",
    registryHash: REGISTRY_HASH,
    handlerVersion: `${expectation.tool}@synthetic`,
    domainVersion: CHECKOUT_DOMAIN_VERSION,
    toolsetVersion: CHECKOUT_TOOLSET_VERSION,
    appCommit: "a".repeat(40),
    runtime: {
      executionPath: "native-webmcp",
      origin: "https://synthetic.invalid",
      userAgent: "synthetic-test",
      argumentMode: "json-string"
    },
    status: "completed",
    commitDisposition: expectation.stateChange === "required" ? "committed" : "none",
    rawArguments: argumentsValue,
    canonicalArguments: argumentsValue,
    rawResult: resultValue,
    canonicalResult: resultValue,
    stateBefore: initial,
    stateAfter
  });
  const result = json(resultValue);
  return {
    decision: { kind: "call", tool: expectation.tool, arguments: argumentsValue },
    modelDecisionCount: 1,
    usableStructuredDecisionCount: 1,
    providerToolCallCount: 1,
    nativeDispatchCount: 1,
    handlerTraceCount: 1,
    beforeReset: resetBoundary(),
    afterReset: resetBoundary(),
    targetCalls: [
      {
        tool: expectation.tool,
        arguments: argumentsValue,
        result,
        trace,
        traceVerification: {
          status: "verified",
          verifierVersion: "synthetic-trace-verifier@1",
          traceHash: "c".repeat(64)
        }
      }
    ],
    runnerOperationId: RUNNER_OPERATION_ID,
    stateBefore: before,
    stateAfter: json(stateAfter),
    effect: json(trace.effect)
  };
}

function tool(name: string, readOnlyHint: boolean) {
  return {
    name,
    title: `Synthetic ${name}`,
    description: `Synthetic ${name} description.`,
    inputSchema: {
      type: "object",
      properties: readOnlyHint ? {} : { operationId: { type: "string" } },
      required: readOnlyHint ? [] : ["operationId"],
      additionalProperties: false
    },
    annotations: { readOnlyHint, untrustedContentHint: false }
  };
}

describe("Gate 3 semantic core", () => {
  it("verifies exactly 24 scored cases, 12/12 subsets, six 2/2 families, intact pairs, and four disjoint calibration cases", () => {
    const { contract, suite } = createSyntheticArtifacts();
    expect(suite.scoredCases).toHaveLength(24);
    expect(suite.calibrationCases).toHaveLength(4);
    expect(suite.scoredCases.filter(({ subset }) => subset === "development")).toHaveLength(12);
    expect(
      suite.scoredCases.filter(({ subset }) => subset === "builder-blinded-holdout")
    ).toHaveLength(12);
    expect(() => verifySemanticSuiteStructure(suite, contract)).not.toThrow();

    const invalid: SemanticSuite = {
      ...suite,
      calibrationCases: suite.calibrationCases.map((entry, index) =>
        index === 0 ? { ...entry, runnerCaseId: suite.scoredCases[0]!.runnerCaseId } : entry
      )
    };
    expect(() => verifySemanticSuiteStructure(invalid, contract)).toThrow(
      SemanticSuiteValidationError
    );
  });

  it("requires a matched boundary to change the action signature, not only metadata", () => {
    const { contract, suite } = createSyntheticArtifacts();
    const pair = suite.scoredCases.filter(
      ({ family, subset }) =>
        family === "commitment-boundary-matched-pairs" && subset === "development"
    );
    const [anchor, contrast] = pair;
    if (!anchor || !contrast) throw new Error("Synthetic pair missing.");
    const anchorMeaning = contract.meanings.find(
      ({ meaningId }) => meaningId === anchor.meaningId
    )!;
    const collapsed: SemanticContract = {
      ...contract,
      meanings: contract.meanings.map((meaning) =>
        meaning.meaningId === contrast.meaningId
          ? {
              ...meaning,
              ...meaningFields(anchorMeaning.expectation),
              expectation: anchorMeaning.expectation
            }
          : meaning
      )
    };
    expect(() => verifySemanticSuiteStructure(suite, collapsed)).toThrowError(
      /boundary_expectation_collapsed/u
    );
  });

  it("scores call, clarify, and no-action decisions with arguments, runner IDs, state, effects, and exact call counts", async () => {
    const { contract, suite } = createSyntheticArtifacts();
    const representatives = [
      suite.scoredCases.find(({ family }) => family === "review-equivalent-realizations")!,
      suite.scoredCases.find(
        ({ family, relationship }) =>
          family === "ambiguity-versus-explicit-intent-matched-pairs" &&
          relationship.kind === "matched_boundary" &&
          relationship.side === "anchor"
      )!,
      suite.scoredCases.find(
        ({ family, relationship }) =>
          family === "negation-scope-boundary-matched-pairs" &&
          relationship.kind === "matched_boundary" &&
          relationship.side === "contrast"
      )!,
      suite.scoredCases.find(({ family }) => family === "argument-boundary-matched-pairs")!
    ];
    for (const scoredCase of representatives) {
      const observation = await observationFor(contract, scoredCase);
      expect(
        evaluateSemanticTrial({
          contract,
          scoredCase,
          boundaryContract: BOUNDARY_CONTRACT,
          observation
        }).passed
      ).toBe(true);
    }

    const mutation = representatives[3]!;
    const observation = await observationFor(contract, mutation);
    const wrongRunnerId: SemanticTrialObservation = {
      ...observation,
      decision: {
        ...(observation.decision as Record<string, unknown>),
        arguments: {
          ...((observation.decision as { arguments: Record<string, unknown> }).arguments ?? {}),
          operationId: `probe_${"b".repeat(58)}`
        }
      }
    };
    expect(
      evaluateSemanticTrial({
        contract,
        scoredCase: mutation,
        boundaryContract: BOUNDARY_CONTRACT,
        observation: wrongRunnerId
      }).failureCodes
    ).toContain("decision_execution_arguments");

    const wrongExecutionArguments = {
      ...wrongRunnerId,
      targetCalls: wrongRunnerId.targetCalls.map((call) => ({
        ...call,
        arguments: {
          ...call.arguments,
          operationId: `probe_${"b".repeat(58)}`
        }
      }))
    };
    expect(
      evaluateSemanticTrial({
        contract,
        scoredCase: mutation,
        boundaryContract: BOUNDARY_CONTRACT,
        observation: wrongExecutionArguments
      }).failureCodes
    ).toContain("predicate_runner_operation_id");

    const extraDecision: SemanticTrialObservation = {
      ...observation,
      modelDecisionCount: 2,
      providerToolCallCount: 2,
      nativeDispatchCount: 2,
      handlerTraceCount: 2,
      targetCalls: [...observation.targetCalls, ...observation.targetCalls]
    };
    const extraResult = evaluateSemanticTrial({
      contract,
      scoredCase: mutation,
      boundaryContract: BOUNDARY_CONTRACT,
      observation: extraDecision
    });
    expect(extraResult.passed).toBe(false);
    expect(extraResult.failureCodes).toEqual(
      expect.arrayContaining([
        "exactly_one_model_decision",
        "maximum_one_provider_tool_call",
        "maximum_one_native_dispatch",
        "maximum_one_handler_trace",
        "maximum_one_target_call"
      ])
    );

    const targetCall = observation.targetCalls[0]!;
    const partialTrace: OperationTrace = { ...targetCall.trace, status: "partial" };
    const partialResult = evaluateSemanticTrial({
      contract,
      scoredCase: mutation,
      boundaryContract: BOUNDARY_CONTRACT,
      observation: {
        ...observation,
        targetCalls: [{ ...targetCall, trace: partialTrace }]
      }
    });
    expect(partialResult.passed).toBe(false);
    expect(partialResult.failureCodes).toContain("trace_status_completed");

    const resetFailure = evaluateSemanticTrial({
      contract,
      scoredCase: mutation,
      boundaryContract: BOUNDARY_CONTRACT,
      observation: {
        ...observation,
        decision: null,
        modelDecisionCount: 0,
        usableStructuredDecisionCount: 0,
        providerToolCallCount: 0,
        nativeDispatchCount: 0,
        handlerTraceCount: 0,
        targetCalls: [],
        beforeReset: { ...resetBoundary(), status: "failed" }
      }
    });
    expect(resetFailure).toMatchObject({
      disposition: "infrastructure-invalid",
      infrastructureRetryEligible: true,
      score: null,
      passed: false
    });
  });

  it("passes an intact pair only when both cases pass and the observed action delta matches the frozen boundary delta", async () => {
    const { contract, suite } = createSyntheticArtifacts();
    const pair = suite.scoredCases.filter(
      ({ family, subset }) =>
        family === "argument-boundary-matched-pairs" && subset === "development"
    );
    const [first, second] = pair;
    if (!first || !second) throw new Error("Synthetic pair missing.");
    const firstObservation = await observationFor(contract, first);
    const secondObservation = await observationFor(contract, second);
    const passed = evaluateSemanticMatchedPair({
      contract,
      trials: [
        { scoredCase: first, boundaryContract: BOUNDARY_CONTRACT, observation: firstObservation },
        {
          scoredCase: second,
          boundaryContract: BOUNDARY_CONTRACT,
          observation: secondObservation
        }
      ]
    });
    expect(passed).toMatchObject({
      bothCasesPassed: true,
      frozenActionsDiffer: true,
      observedActionsDiffer: true,
      observedDeltaMatchesFrozen: true,
      passed: true
    });

    const failed = evaluateSemanticMatchedPair({
      contract,
      trials: [
        { scoredCase: first, boundaryContract: BOUNDARY_CONTRACT, observation: firstObservation },
        { scoredCase: second, boundaryContract: BOUNDARY_CONTRACT, observation: firstObservation }
      ]
    });
    expect(failed.passed).toBe(false);
    expect(failed.observedDeltaMatchesFrozen).toBe(false);
  });

  it("builds a deterministic review-only freeze hash binding both v1 catalogs, versions, one-trial schedule, retry policy, and unchanged 24+24 order", async () => {
    const { contract, suite } = createSyntheticArtifacts();
    const repositoryCommit = "a".repeat(40);
    const source = {
      repositoryCommit,
      contractSourceSha256: "1".repeat(64),
      casesSourceSha256: "2".repeat(64),
      fixtureSourceSha256: "3".repeat(64),
      manifestSourceSha256: "4".repeat(64),
      runnerSourceSha256: "5".repeat(64),
      evaluatorSourceSha256: "6".repeat(64)
    };
    const initialTools = [
      tool("cart_get", true),
      tool("cart_update", false),
      tool("checkout_request", false),
      tool("order_review", true)
    ];
    const pendingTools = [...initialTools, tool("checkout_cancel", false)];
    const targetContract = {
      appCommit: repositoryCommit,
      toolsetVersion: "synthetic-toolset@1",
      domainVersion: "synthetic-domain@1",
      initialManifest: {
        version: "toolproof-probe-live-manifest@1.0.0" as const,
        manifestHash: "7".repeat(64),
        tools: initialTools
      },
      pendingManifest: {
        version: "toolproof-probe-live-manifest@1.0.0" as const,
        manifestHash: "8".repeat(64),
        tools: pendingTools
      },
      initialHandlerVersions: initialTools.map(({ name }) => ({ name, version: `${name}@1` })),
      pendingHandlerVersions: pendingTools.map(({ name }) => ({ name, version: `${name}@1` }))
    };
    const orderSeed = "synthetic-order-seed";
    const orderedRunnerCaseIds = await deriveSemanticCaseOrder(
      orderSeed,
      suite.scoredCases.map(({ runnerCaseId }) => runnerCaseId)
    );
    const schedule: SemanticSchedule = {
      version: SEMANTIC_SCHEDULE_VERSION,
      repetitionCountPerCase: 1,
      evidenceLabel: "demonstration-snapshot",
      maximumModelDecisionsPerTrial: 1,
      maximumTargetCallsPerTrial: 1,
      orderSeed,
      orderedRunnerCaseIds: [...orderedRunnerCaseIds],
      appliesUnchangedTo: ["baseline-v1", "revised-v2"],
      plannedTrialsPerVersion: 24,
      totalPlannedScoredTrials: 48,
      sameOrderAcrossVersions: true
    };
    const common = {
      source,
      contract,
      suite,
      fixture: {
        fixtureId: FIXTURE_ID,
        fixtureVersion: "synthetic-fixture@1",
        fixtureSeed: "synthetic-seed",
        initialState: json({ revision: 0 }),
        resetContract: json({ resetToRevision: 0 })
      },
      targetContract,
      runner: {
        runnerVersion: "synthetic-runner@1",
        implementation: "synthetic-test-only",
        provider: "synthetic-provider",
        model: "synthetic-model",
        promptVersion: "synthetic-prompt@1",
        prompt: "Synthetic generic runner prompt used only by this unit test.",
        settingsVersion: "synthetic-settings@1",
        settings: { temperature: 0 },
        decisionSchema: { type: "object", additionalProperties: false },
        runtime: { browser: "synthetic" },
        timeoutsMs: { provider: 1_000, native: 1_000 },
        freshStatelessContextPerTrial: true as const,
        maximumProviderCallsPerTrial: 1 as const,
        maximumTargetCallsPerTrial: 1 as const
      },
      evaluator: {
        version: "toolproof-semantic-evaluator@1.0.0" as const,
        canonicalizerVersion: "synthetic-canonicalizer@1",
        canonicalizerSourceSha256: "9".repeat(64)
      },
      retryPolicy: {
        version: "toolproof-semantic-retry-policy@1.0.0" as const,
        maximumInfrastructureRetriesPerTrial: 1,
        soleEligibility:
          "transport-or-infrastructure-failure-before-usable-model-decision-and-before-target-tool-execution" as const,
        usableModelDecisionRetryable: false as const,
        targetToolExecutionRetryable: false as const,
        mutatingActionAutomaticallyRetried: false as const,
        malformedOrWrongDecisionRetryable: false as const,
        outcomeIndependent: true as const
      }
    };
    const candidate = await buildSemanticProtocolFreezeCandidate({ ...common, schedule });
    expect(candidate.freezeHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(candidate.manifest).toMatchObject({
      status: "awaiting-human-approval",
      toolsetVersion: "synthetic-toolset@1",
      domainVersion: "synthetic-domain@1",
      schedule: {
        plannedTrialsPerVersion: 24,
        totalPlannedScoredTrials: 48,
        sameOrderAcrossVersions: true
      },
      invariants: { runnerOwnedMutationOperationIds: true }
    });
    expect(candidate.manifest.componentHashes.targetContract).toMatch(/^[a-f0-9]{64}$/u);

    const reversed: SemanticSchedule = {
      ...schedule,
      orderedRunnerCaseIds: [...schedule.orderedRunnerCaseIds].reverse()
    };
    await expect(
      buildSemanticProtocolFreezeCandidate({ ...common, schedule: reversed })
    ).rejects.toMatchObject({ code: "schedule_order_seed_mismatch" });
  });
});
