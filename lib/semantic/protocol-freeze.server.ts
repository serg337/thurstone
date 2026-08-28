import "server-only";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  semanticEvaluatorContractHash,
  SEMANTIC_EVALUATOR_VERSION
} from "@/lib/semantic/evaluator.server";
import {
  SEMANTIC_CONTRACT_VERSION,
  SEMANTIC_SUITE_VERSION,
  semanticMeaningForCase,
  verifySemanticContract,
  verifySemanticSuiteStructure,
  type SemanticContract,
  type SemanticSuite
} from "@/lib/semantic/contract";
import { probeLiveManifestSchema, type ProbeLiveManifest } from "@/lib/probe/calibration-envelope";
import { z } from "zod";

export const SEMANTIC_FREEZE_CANDIDATE_VERSION = "toolproof-semantic-freeze-candidate@1.0.0";
export const SEMANTIC_SCHEDULE_VERSION = "toolproof-semantic-schedule@1.0.0";
export const SEMANTIC_RETRY_POLICY_VERSION = "toolproof-semantic-retry-policy@1.0.0";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const gitCommitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const nonBlankString = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim().length > 0, "Value must contain non-whitespace text.");
const opaqueRunnerCaseIdSchema = z.string().regex(/^case_[A-Za-z0-9_-]{22}$/u);

export const semanticSourceBindingSchema = z
  .object({
    repositoryCommit: gitCommitSchema,
    contractSourceSha256: sha256Schema,
    casesSourceSha256: sha256Schema,
    fixtureSourceSha256: sha256Schema,
    manifestSourceSha256: sha256Schema,
    runnerSourceSha256: sha256Schema,
    evaluatorSourceSha256: sha256Schema
  })
  .strict();

export type SemanticSourceBinding = z.infer<typeof semanticSourceBindingSchema>;

export const semanticFixtureBindingSchema = z
  .object({
    fixtureId: nonBlankString(160),
    fixtureVersion: nonBlankString(160),
    fixtureSeed: nonBlankString(256),
    initialState: z.json(),
    resetContract: z.json()
  })
  .strict();

export type SemanticFixtureBinding = z.infer<typeof semanticFixtureBindingSchema>;

const semanticHandlerVersionSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/u),
    version: nonBlankString(160)
  })
  .strict();

export const semanticTargetContractBindingSchema = z
  .object({
    appCommit: gitCommitSchema,
    toolsetVersion: nonBlankString(160),
    domainVersion: nonBlankString(160),
    initialManifest: probeLiveManifestSchema,
    pendingManifest: probeLiveManifestSchema,
    initialHandlerVersions: z.array(semanticHandlerVersionSchema).length(4),
    pendingHandlerVersions: z.array(semanticHandlerVersionSchema).length(5)
  })
  .strict();

export type SemanticTargetContractBinding = z.infer<typeof semanticTargetContractBindingSchema>;

export const semanticRunnerBindingSchema = z
  .object({
    runnerVersion: nonBlankString(160),
    implementation: nonBlankString(160),
    provider: nonBlankString(160),
    model: nonBlankString(160),
    promptVersion: nonBlankString(160),
    prompt: nonBlankString(16_000),
    settingsVersion: nonBlankString(160),
    settings: z.record(z.string(), z.json()),
    decisionSchema: z.record(z.string(), z.json()),
    runtime: z.record(z.string(), z.json()),
    timeoutsMs: z.record(z.string(), z.number().int().positive().max(300_000)),
    freshStatelessContextPerTrial: z.literal(true),
    maximumProviderCallsPerTrial: z.literal(1),
    maximumTargetCallsPerTrial: z.literal(1)
  })
  .strict();

export type SemanticRunnerBinding = z.infer<typeof semanticRunnerBindingSchema>;

export const semanticEvaluatorBindingSchema = z
  .object({
    version: z.literal(SEMANTIC_EVALUATOR_VERSION),
    canonicalizerVersion: nonBlankString(160),
    canonicalizerSourceSha256: sha256Schema
  })
  .strict();

export type SemanticEvaluatorBinding = z.infer<typeof semanticEvaluatorBindingSchema>;

export const semanticRetryPolicySchema = z
  .object({
    version: z.literal(SEMANTIC_RETRY_POLICY_VERSION),
    maximumInfrastructureRetriesPerTrial: z.number().int().min(0).max(2),
    soleEligibility: z.literal(
      "transport-or-infrastructure-failure-before-usable-model-decision-and-before-target-tool-execution"
    ),
    usableModelDecisionRetryable: z.literal(false),
    targetToolExecutionRetryable: z.literal(false),
    mutatingActionAutomaticallyRetried: z.literal(false),
    malformedOrWrongDecisionRetryable: z.literal(false),
    outcomeIndependent: z.literal(true)
  })
  .strict();

export type SemanticRetryPolicy = z.infer<typeof semanticRetryPolicySchema>;

export const semanticScheduleSchema = z
  .object({
    version: z.literal(SEMANTIC_SCHEDULE_VERSION),
    repetitionCountPerCase: z.literal(1),
    evidenceLabel: z.literal("demonstration-snapshot"),
    maximumModelDecisionsPerTrial: z.literal(1),
    maximumTargetCallsPerTrial: z.literal(1),
    orderSeed: nonBlankString(256),
    orderedRunnerCaseIds: z.array(opaqueRunnerCaseIdSchema).length(24),
    appliesUnchangedTo: z.tuple([z.literal("baseline-v1"), z.literal("revised-v2")]),
    plannedTrialsPerVersion: z.literal(24),
    totalPlannedScoredTrials: z.literal(48),
    sameOrderAcrossVersions: z.literal(true)
  })
  .strict();

export type SemanticSchedule = z.infer<typeof semanticScheduleSchema>;

export interface SemanticFreezeComponentHashes {
  readonly source: string;
  readonly contract: string;
  readonly cases: string;
  readonly scoredCases: string;
  readonly calibrationCases: string;
  readonly fixture: string;
  readonly v1Manifest: string;
  readonly targetContract: string;
  readonly runner: string;
  readonly runnerPrompt: string;
  readonly runnerSettings: string;
  readonly runnerDecisionSchema: string;
  readonly evaluator: string;
  readonly retryPolicy: string;
  readonly schedule: string;
}

export interface SemanticFreezeManifest {
  readonly version: typeof SEMANTIC_FREEZE_CANDIDATE_VERSION;
  readonly status: "awaiting-human-approval";
  readonly repositoryCommit: string;
  readonly contractVersion: typeof SEMANTIC_CONTRACT_VERSION;
  readonly suiteVersion: typeof SEMANTIC_SUITE_VERSION;
  readonly suiteId: string;
  readonly fixtureId: string;
  readonly v1LiveManifestHash: string;
  readonly v1PendingLiveManifestHash: string;
  readonly targetAppCommit: string;
  readonly toolsetVersion: string;
  readonly domainVersion: string;
  readonly evaluatorVersion: typeof SEMANTIC_EVALUATOR_VERSION;
  readonly schedule: {
    readonly scoredCaseCount: 24;
    readonly developmentCaseCount: 12;
    readonly holdoutCaseCount: 12;
    readonly calibrationCaseCount: 4;
    readonly repetitionCountPerCase: 1;
    readonly plannedTrialsPerVersion: 24;
    readonly totalPlannedScoredTrials: 48;
    readonly appliesUnchangedTo: readonly ["baseline-v1", "revised-v2"];
    readonly sameOrderAcrossVersions: true;
    readonly evidenceLabel: "demonstration-snapshot";
    readonly orderSeed: string;
    readonly orderedRunnerCaseIds: readonly string[];
  };
  readonly retryPolicy: {
    readonly maximumInfrastructureRetriesPerTrial: number;
    readonly soleEligibility: SemanticRetryPolicy["soleEligibility"];
    readonly mutatingActionAutomaticallyRetried: false;
    readonly outcomeIndependent: true;
  };
  readonly invariants: {
    readonly exactFamilyCount: 6;
    readonly casesPerFamily: 4;
    readonly casesPerFamilySubset: 2;
    readonly matchedPairsIntact: true;
    readonly calibrationExcluded: true;
    readonly maximumModelDecisionsPerTrial: 1;
    readonly maximumTargetCallsPerTrial: 1;
    readonly runnerOwnedMutationOperationIds: true;
  };
  readonly componentHashes: SemanticFreezeComponentHashes;
}

export interface SemanticFreezeCandidate {
  readonly manifest: SemanticFreezeManifest;
  /** The exact digest a genuine human approval receipt must reference. */
  readonly freezeHash: string;
}

export class SemanticProtocolFreezeError extends Error {
  constructor(
    readonly code:
      | "fixture_binding_mismatch"
      | "schedule_case_mismatch"
      | "schedule_order_seed_mismatch"
      | "target_contract_mismatch"
      | "expected_tool_missing"
      | "read_only_contract_mismatch"
      | "mutation_contract_mismatch",
    message: string
  ) {
    super(message);
    this.name = "SemanticProtocolFreezeError";
  }
}

function canonicalClone<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

export async function deriveSemanticCaseOrder(
  orderSeed: string,
  runnerCaseIds: readonly string[]
): Promise<readonly string[]> {
  const decorated = await Promise.all(
    runnerCaseIds.map(async (runnerCaseId) => ({
      runnerCaseId,
      sortKey: await canonicalSha256({
        version: SEMANTIC_SCHEDULE_VERSION,
        orderSeed,
        runnerCaseId
      })
    }))
  );
  return Object.freeze(
    decorated
      .sort(
        (left, right) =>
          left.sortKey.localeCompare(right.sortKey) ||
          left.runnerCaseId.localeCompare(right.runnerCaseId)
      )
      .map(({ runnerCaseId }) => runnerCaseId)
  );
}

function assertFixtureBinding(suite: SemanticSuite, fixture: SemanticFixtureBinding): void {
  for (const suiteCase of [...suite.scoredCases, ...suite.calibrationCases]) {
    if (suiteCase.fixtureId !== fixture.fixtureId) {
      throw new SemanticProtocolFreezeError(
        "fixture_binding_mismatch",
        `${suiteCase.caseId} references ${suiteCase.fixtureId}, not ${fixture.fixtureId}.`
      );
    }
  }
}

function assertScheduleBinding(suite: SemanticSuite, schedule: SemanticSchedule): void {
  const expected = [...suite.scoredCases.map(({ runnerCaseId }) => runnerCaseId)].sort();
  const actual = [...schedule.orderedRunnerCaseIds].sort();
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    throw new SemanticProtocolFreezeError(
      "schedule_case_mismatch",
      "The frozen order must contain every scored runner case ID exactly once and no other ID."
    );
  }
}

function runnerOperationPredicateCount(
  expectation: Extract<SemanticContract["meanings"][number]["expectation"], { kind: "call" }>
): number {
  return expectation.arguments.predicates.filter(
    ({ operator }) => operator === "runner_operation_id"
  ).length;
}

function assertManifestContractBinding(
  contract: SemanticContract,
  suite: SemanticSuite,
  manifest: ProbeLiveManifest
): void {
  const toolByName = new Map(manifest.tools.map((tool) => [tool.name, tool]));
  for (const scoredCase of suite.scoredCases) {
    const meaning = semanticMeaningForCase(contract, scoredCase);
    if (meaning.expectation.kind !== "call") continue;
    const tool = toolByName.get(meaning.expectation.tool);
    if (!tool) {
      throw new SemanticProtocolFreezeError(
        "expected_tool_missing",
        `${scoredCase.caseId} expects ${meaning.expectation.tool}, which is absent from v1.`
      );
    }
    const operationPredicates = runnerOperationPredicateCount(meaning.expectation);
    if (tool.annotations.readOnlyHint) {
      if (
        operationPredicates !== 0 ||
        meaning.approvalClass !== "read-only" ||
        meaning.expectation.stateChange !== "forbidden"
      ) {
        throw new SemanticProtocolFreezeError(
          "read_only_contract_mismatch",
          `${scoredCase.caseId} does not preserve the live read-only tool contract.`
        );
      }
    } else if (
      operationPredicates !== 1 ||
      meaning.approvalClass === "read-only" ||
      meaning.approvalClass === "no-action"
    ) {
      throw new SemanticProtocolFreezeError(
        "mutation_contract_mismatch",
        `${scoredCase.caseId} must bind exactly one runner-owned operationId for the live mutation.`
      );
    }
  }
}

const INITIAL_TARGET_NAMES = ["cart_get", "cart_update", "checkout_request", "order_review"];
const PENDING_TARGET_NAMES = [
  "cart_get",
  "cart_update",
  "checkout_cancel",
  "checkout_request",
  "order_review"
];

function assertTargetContractBinding(
  source: SemanticSourceBinding,
  target: SemanticTargetContractBinding
): void {
  if (source.repositoryCommit !== target.appCommit) {
    throw new SemanticProtocolFreezeError(
      "target_contract_mismatch",
      "The target app commit must equal the frozen repository commit."
    );
  }
  for (const [label, manifest, handlers, expectedNames] of [
    ["initial", target.initialManifest, target.initialHandlerVersions, INITIAL_TARGET_NAMES],
    ["pending", target.pendingManifest, target.pendingHandlerVersions, PENDING_TARGET_NAMES]
  ] as const) {
    const names = manifest.tools.map(({ name }) => name).sort();
    if (canonicalJson(names) !== canonicalJson(expectedNames)) {
      throw new SemanticProtocolFreezeError(
        "target_contract_mismatch",
        `The ${label} v1 catalog does not contain the exact ToolProof target names.`
      );
    }
    const handlerNames = handlers.map(({ name }) => name).sort();
    if (canonicalJson(handlerNames) !== canonicalJson(expectedNames)) {
      throw new SemanticProtocolFreezeError(
        "target_contract_mismatch",
        `The ${label} handler-version inventory does not match its catalog.`
      );
    }
    for (const tool of manifest.tools) {
      const expectedReadOnly = tool.name === "cart_get" || tool.name === "order_review";
      if (
        tool.annotations.readOnlyHint !== expectedReadOnly ||
        tool.annotations.untrustedContentHint !== false
      ) {
        throw new SemanticProtocolFreezeError(
          "target_contract_mismatch",
          `${label}/${tool.name} has unexpected frozen annotations.`
        );
      }
    }
  }
}

/**
 * Builds a review candidate only. It deliberately cannot create a human approval receipt or mark a
 * protocol frozen; Sergio's later receipt must reference the returned freezeHash exactly.
 */
export async function buildSemanticProtocolFreezeCandidate(input: {
  readonly source: SemanticSourceBinding;
  readonly contract: SemanticContract;
  readonly suite: SemanticSuite;
  readonly fixture: SemanticFixtureBinding;
  readonly targetContract: SemanticTargetContractBinding;
  readonly runner: SemanticRunnerBinding;
  readonly evaluator: SemanticEvaluatorBinding;
  readonly retryPolicy: SemanticRetryPolicy;
  readonly schedule: SemanticSchedule;
}): Promise<SemanticFreezeCandidate> {
  const source = semanticSourceBindingSchema.parse(input.source);
  const contract = verifySemanticContract(input.contract);
  const suite = verifySemanticSuiteStructure(input.suite, contract);
  const fixture = semanticFixtureBindingSchema.parse(input.fixture);
  const targetContract = semanticTargetContractBindingSchema.parse(input.targetContract);
  const v1Manifest = targetContract.initialManifest;
  const runner = semanticRunnerBindingSchema.parse(input.runner);
  const evaluator = semanticEvaluatorBindingSchema.parse(input.evaluator);
  const retryPolicy = semanticRetryPolicySchema.parse(input.retryPolicy);
  const schedule = semanticScheduleSchema.parse(input.schedule);

  assertFixtureBinding(suite, fixture);
  assertTargetContractBinding(source, targetContract);
  assertScheduleBinding(suite, schedule);
  const derivedOrder = await deriveSemanticCaseOrder(
    schedule.orderSeed,
    suite.scoredCases.map(({ runnerCaseId }) => runnerCaseId)
  );
  if (canonicalJson(derivedOrder) !== canonicalJson(schedule.orderedRunnerCaseIds)) {
    throw new SemanticProtocolFreezeError(
      "schedule_order_seed_mismatch",
      "The frozen runner order does not match the declared deterministic order seed."
    );
  }
  assertManifestContractBinding(contract, suite, v1Manifest);

  const evaluatorContractHash = await semanticEvaluatorContractHash();
  const evaluatorManifest = {
    ...evaluator,
    contractHash: evaluatorContractHash
  };
  const componentHashes: SemanticFreezeComponentHashes = {
    source: await canonicalSha256(source),
    contract: await canonicalSha256(contract),
    cases: await canonicalSha256(suite),
    scoredCases: await canonicalSha256(suite.scoredCases),
    calibrationCases: await canonicalSha256(suite.calibrationCases),
    fixture: await canonicalSha256(fixture),
    v1Manifest: await canonicalSha256(v1Manifest),
    targetContract: await canonicalSha256(targetContract),
    runner: await canonicalSha256(runner),
    runnerPrompt: await canonicalSha256({
      version: runner.promptVersion,
      prompt: runner.prompt
    }),
    runnerSettings: await canonicalSha256({
      version: runner.settingsVersion,
      settings: runner.settings,
      timeoutsMs: runner.timeoutsMs
    }),
    runnerDecisionSchema: await canonicalSha256(runner.decisionSchema),
    evaluator: await canonicalSha256(evaluatorManifest),
    retryPolicy: await canonicalSha256(retryPolicy),
    schedule: await canonicalSha256(schedule)
  };

  const manifest: SemanticFreezeManifest = {
    version: SEMANTIC_FREEZE_CANDIDATE_VERSION,
    status: "awaiting-human-approval",
    repositoryCommit: source.repositoryCommit,
    contractVersion: contract.version,
    suiteVersion: suite.version,
    suiteId: suite.suiteId,
    fixtureId: fixture.fixtureId,
    v1LiveManifestHash: v1Manifest.manifestHash,
    v1PendingLiveManifestHash: targetContract.pendingManifest.manifestHash,
    targetAppCommit: targetContract.appCommit,
    toolsetVersion: targetContract.toolsetVersion,
    domainVersion: targetContract.domainVersion,
    evaluatorVersion: evaluator.version,
    schedule: {
      scoredCaseCount: 24,
      developmentCaseCount: 12,
      holdoutCaseCount: 12,
      calibrationCaseCount: 4,
      repetitionCountPerCase: 1,
      plannedTrialsPerVersion: 24,
      totalPlannedScoredTrials: 48,
      appliesUnchangedTo: schedule.appliesUnchangedTo,
      sameOrderAcrossVersions: true,
      evidenceLabel: "demonstration-snapshot",
      orderSeed: schedule.orderSeed,
      orderedRunnerCaseIds: schedule.orderedRunnerCaseIds
    },
    retryPolicy: {
      maximumInfrastructureRetriesPerTrial: retryPolicy.maximumInfrastructureRetriesPerTrial,
      soleEligibility: retryPolicy.soleEligibility,
      mutatingActionAutomaticallyRetried: false,
      outcomeIndependent: true
    },
    invariants: {
      exactFamilyCount: 6,
      casesPerFamily: 4,
      casesPerFamilySubset: 2,
      matchedPairsIntact: true,
      calibrationExcluded: true,
      maximumModelDecisionsPerTrial: 1,
      maximumTargetCallsPerTrial: 1,
      runnerOwnedMutationOperationIds: true
    },
    componentHashes
  };
  const canonicalManifest = deepFreeze(canonicalClone(manifest));
  return deepFreeze({
    manifest: canonicalManifest,
    freezeHash: await canonicalSha256(canonicalManifest)
  });
}
