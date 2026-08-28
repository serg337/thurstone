import "server-only";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import type { OperationTrace } from "@/lib/evidence/operation-trace";
import {
  semanticMeaningForCase,
  type SemanticContract,
  type SemanticEffectSurface,
  type SemanticExpectation,
  type SemanticJsonValue,
  type SemanticMeaning,
  type SemanticScoredCase,
  type SemanticValuePredicate
} from "@/lib/semantic/contract";
import { z } from "zod";

export const SEMANTIC_EVALUATOR_VERSION = "toolproof-semantic-evaluator@1.0.0";

export const SEMANTIC_EVALUATOR_CONTRACT = Object.freeze({
  version: SEMANTIC_EVALUATOR_VERSION,
  score: Object.freeze({ pass: 1, fail: 0 }),
  expectedActionClasses: Object.freeze(["call", "clarify", "no_action"]),
  observedNoActionDecision: "abstain",
  maximumModelDecisions: 1,
  maximumTargetCalls: 1,
  argumentPolicy: "all-leaves-covered-no-additional-properties",
  operationIdPolicy: "runner-owned-exact-match",
  statePolicy: "canonical-before-after-and-frozen-predicates",
  manualRelabeling: false
});

const jsonRecordSchema = z.record(z.string(), z.json());
const observedDecisionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("call"),
      tool: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/u),
      arguments: jsonRecordSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("clarify"),
      text: z.string().min(1)
    })
    .strict(),
  z
    .object({
      kind: z.literal("abstain"),
      reason: z.string().min(1)
    })
    .strict()
]);

export type SemanticObservedDecision = z.infer<typeof observedDecisionSchema>;

export interface SemanticObservedTargetCall {
  readonly tool: string;
  readonly arguments: Readonly<Record<string, SemanticJsonValue>>;
  readonly result: SemanticJsonValue;
  readonly trace: OperationTrace;
  readonly traceVerification: {
    readonly status: "verified";
    readonly verifierVersion: string;
    readonly traceHash: string;
  };
}

export interface SemanticResetBoundaryContract {
  readonly fixtureId: string;
  readonly fixtureVersion: string;
  readonly fixtureSeed: string;
  readonly stateHash: string;
  readonly registryHash: string;
  readonly registeredToolNames: readonly string[];
  readonly appCommit: string;
  readonly domainVersion: string;
  readonly toolsetVersion: string;
  readonly handlerVersionByTool: Readonly<Record<string, string>>;
}

export interface SemanticResetBoundaryEvidence {
  readonly status: "verified" | "failed";
  readonly fixtureId: string;
  readonly fixtureVersion: string;
  readonly fixtureSeed: string;
  readonly stateRevision: number;
  readonly stateHash: string;
  readonly expectedStateHash: string;
  readonly operationLedgerCount: number;
  readonly currentTrajectoryCount: number;
  readonly registryHash: string;
  readonly registeredToolNames: readonly string[];
}

export interface SemanticTrialObservation {
  /** Null or malformed values remain honest deterministic failures. */
  readonly decision: unknown;
  readonly modelDecisionCount: number;
  readonly usableStructuredDecisionCount: number;
  readonly providerToolCallCount: number;
  readonly nativeDispatchCount: number;
  readonly handlerTraceCount: number;
  readonly beforeReset: SemanticResetBoundaryEvidence;
  readonly afterReset: SemanticResetBoundaryEvidence;
  readonly targetCalls: readonly SemanticObservedTargetCall[];
  readonly runnerOperationId: string;
  readonly stateBefore: SemanticJsonValue;
  readonly stateAfter: SemanticJsonValue;
  readonly effect: SemanticJsonValue;
}

export type SemanticObservedActionClass = "call" | "clarify" | "no_action" | "malformed";

export interface SemanticEvaluationCheck {
  readonly code: string;
  readonly passed: boolean;
  readonly path: string | null;
  readonly expected: SemanticJsonValue;
  readonly actual: SemanticJsonValue;
}

export interface SemanticEvaluationResult {
  readonly version: typeof SEMANTIC_EVALUATOR_VERSION;
  readonly caseId: string;
  readonly runnerCaseId: string;
  readonly approvalClass: SemanticMeaning["approvalClass"];
  readonly expectedActionClass: SemanticExpectation["kind"];
  readonly observedActionClass: SemanticObservedActionClass;
  readonly disposition: "scored" | "infrastructure-invalid";
  readonly infrastructureRetryEligible: boolean;
  readonly passed: boolean;
  readonly score: 0 | 1 | null;
  readonly checks: readonly SemanticEvaluationCheck[];
  readonly failureCodes: readonly string[];
}

interface PointerResolution {
  readonly found: boolean;
  readonly value: SemanticJsonValue;
}

const MISSING_VALUE = Object.freeze({ $toolproofSemantic: "missing" }) as SemanticJsonValue;

function decodePointerSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function resolveJsonPointer(root: SemanticJsonValue, pointer: string): PointerResolution {
  if (pointer === "") return { found: true, value: root };
  let current: SemanticJsonValue = root;
  for (const encoded of pointer.slice(1).split("/")) {
    const segment = decodePointerSegment(encoded);
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/u.test(segment)) return { found: false, value: MISSING_VALUE };
      const index = Number(segment);
      if (index >= current.length) return { found: false, value: MISSING_VALUE };
      const nested = current[index];
      if (nested === undefined) return { found: false, value: MISSING_VALUE };
      current = nested;
      continue;
    }
    if (typeof current !== "object" || current === null) {
      return { found: false, value: MISSING_VALUE };
    }
    if (!Object.hasOwn(current, segment)) return { found: false, value: MISSING_VALUE };
    const nested = current[segment];
    if (nested === undefined) return { found: false, value: MISSING_VALUE };
    current = nested;
  }
  return { found: true, value: current };
}

function jsonType(
  value: SemanticJsonValue
): "null" | "boolean" | "number" | "string" | "array" | "object" {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value as "boolean" | "number" | "string" | "object";
}

function evaluatePredicate(
  root: SemanticJsonValue,
  predicate: SemanticValuePredicate,
  runnerOperationId: string
): SemanticEvaluationCheck {
  const resolution = resolveJsonPointer(root, predicate.path);
  switch (predicate.operator) {
    case "equals":
      return {
        code: "predicate_equals",
        passed:
          resolution.found && canonicalJson(resolution.value) === canonicalJson(predicate.value),
        path: predicate.path,
        expected: predicate.value,
        actual: resolution.value
      };
    case "present":
      return {
        code: "predicate_present",
        passed: resolution.found,
        path: predicate.path,
        expected: true,
        actual: resolution.found
      };
    case "absent":
      return {
        code: "predicate_absent",
        passed: !resolution.found,
        path: predicate.path,
        expected: false,
        actual: resolution.found
      };
    case "json_type":
      return {
        code: "predicate_json_type",
        passed: resolution.found && jsonType(resolution.value) === predicate.value,
        path: predicate.path,
        expected: predicate.value,
        actual: resolution.found ? jsonType(resolution.value) : MISSING_VALUE
      };
    case "runner_operation_id":
      return {
        code: "predicate_runner_operation_id",
        passed: resolution.found && resolution.value === runnerOperationId,
        path: predicate.path,
        expected: "runner-owned",
        actual: resolution.value
      };
  }
}

function escapePointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function collectLeafPointers(value: SemanticJsonValue, path = ""): readonly string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [path];
    return value.flatMap((nested, index) => collectLeafPointers(nested, `${path}/${index}`));
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);
    if (entries.length === 0) return path === "" ? [] : [path];
    return entries.flatMap(([key, nested]) =>
      collectLeafPointers(nested, `${path}/${escapePointerSegment(key)}`)
    );
  }
  return [path];
}

function predicateCoversLeaf(predicate: SemanticValuePredicate, leaf: string): boolean {
  if (
    predicate.operator === "absent" ||
    predicate.operator === "present" ||
    predicate.operator === "json_type"
  ) {
    return false;
  }
  return (
    leaf === predicate.path || (predicate.path !== "" && leaf.startsWith(`${predicate.path}/`))
  );
}

function observedActionClass(
  decision: SemanticObservedDecision | null
): SemanticObservedActionClass {
  if (!decision) return "malformed";
  if (decision.kind === "abstain") return "no_action";
  return decision.kind;
}

function observedEffectSurfaces(effect: SemanticJsonValue): readonly SemanticEffectSurface[] {
  const surfaces: SemanticEffectSurface[] = [];
  if (resolveJsonPointer(effect, "/revision/changed").value === true) {
    surfaces.push("state-revision");
  }
  const quantities = resolveJsonPointer(effect, "/quantities");
  if (
    quantities.found &&
    Array.isArray(quantities.value) &&
    quantities.value.some(
      (item) =>
        typeof item === "object" && item !== null && !Array.isArray(item) && item.changed === true
    )
  ) {
    surfaces.push("cart-quantities");
  }
  if (resolveJsonPointer(effect, "/pendingCheckout/changed").value === true) {
    surfaces.push("pending-checkout");
  }
  if (resolveJsonPointer(effect, "/unmodeledStateChanged").value === true) {
    surfaces.push("unmodeled-state");
  }
  return surfaces;
}

function asJsonRecord(value: Readonly<Record<string, SemanticJsonValue>>): SemanticJsonValue {
  return value;
}

function canonicalClone<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

function semanticClone(value: unknown): SemanticJsonValue {
  return JSON.parse(canonicalJson(value)) as SemanticJsonValue;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

function baseCheck(
  code: string,
  passed: boolean,
  expected: SemanticJsonValue,
  actual: SemanticJsonValue,
  path: string | null = null
): SemanticEvaluationCheck {
  return { code, passed, path, expected, actual };
}

function resetBoundaryChecks(
  label: "before" | "after",
  evidence: SemanticResetBoundaryEvidence,
  expected: SemanticResetBoundaryContract
): readonly SemanticEvaluationCheck[] {
  const prefix = `${label}_reset`;
  return [
    baseCheck(`${prefix}_verified`, evidence.status === "verified", "verified", evidence.status),
    baseCheck(
      `${prefix}_fixture_id`,
      evidence.fixtureId === expected.fixtureId,
      expected.fixtureId,
      evidence.fixtureId
    ),
    baseCheck(
      `${prefix}_fixture_version`,
      evidence.fixtureVersion === expected.fixtureVersion,
      expected.fixtureVersion,
      evidence.fixtureVersion
    ),
    baseCheck(
      `${prefix}_fixture_seed`,
      evidence.fixtureSeed === expected.fixtureSeed,
      expected.fixtureSeed,
      evidence.fixtureSeed
    ),
    baseCheck(`${prefix}_revision_zero`, evidence.stateRevision === 0, 0, evidence.stateRevision),
    baseCheck(
      `${prefix}_state_hash`,
      evidence.stateHash === expected.stateHash,
      expected.stateHash,
      evidence.stateHash
    ),
    baseCheck(
      `${prefix}_expected_state_hash`,
      evidence.expectedStateHash === expected.stateHash &&
        evidence.expectedStateHash === evidence.stateHash,
      expected.stateHash,
      evidence.expectedStateHash
    ),
    baseCheck(
      `${prefix}_operation_ledger_empty`,
      evidence.operationLedgerCount === 0,
      0,
      evidence.operationLedgerCount
    ),
    baseCheck(
      `${prefix}_trajectory_empty`,
      evidence.currentTrajectoryCount === 0,
      0,
      evidence.currentTrajectoryCount
    ),
    baseCheck(
      `${prefix}_registry_hash`,
      evidence.registryHash === expected.registryHash,
      expected.registryHash,
      evidence.registryHash
    ),
    baseCheck(
      `${prefix}_catalog`,
      canonicalJson([...evidence.registeredToolNames].sort()) ===
        canonicalJson([...expected.registeredToolNames].sort()),
      [...expected.registeredToolNames].sort(),
      [...evidence.registeredToolNames].sort()
    )
  ];
}

function traceChecks(
  targetCall: SemanticObservedTargetCall,
  observation: SemanticTrialObservation,
  expectedCommitDisposition: "none" | "committed",
  boundary: SemanticResetBoundaryContract
): readonly SemanticEvaluationCheck[] {
  const trace = targetCall.trace;
  const canonicalArguments = trace.canonicalArguments;
  const rawResult = trace.rawResult;
  const canonicalResult = trace.canonicalResult;
  return [
    baseCheck("trace_source_native", trace.source === "native", "native", trace.source),
    baseCheck("trace_status_completed", trace.status === "completed", "completed", trace.status),
    baseCheck(
      "trace_commit_disposition",
      trace.commitDisposition === expectedCommitDisposition,
      expectedCommitDisposition,
      trace.commitDisposition
    ),
    baseCheck(
      "trace_error_absent",
      trace.error === null || trace.error.value === null,
      null,
      trace.error === null ? null : semanticClone(trace.error.value)
    ),
    baseCheck(
      "trace_cancellation_absent",
      !trace.cancellationObservedAfterCommit && !trace.cancellationObservedAfterCompletion,
      false,
      trace.cancellationObservedAfterCommit || trace.cancellationObservedAfterCompletion
    ),
    baseCheck(
      "trace_tool_link",
      trace.toolName === targetCall.tool,
      targetCall.tool,
      trace.toolName
    ),
    baseCheck(
      "trace_preverified",
      targetCall.traceVerification.status === "verified" &&
        targetCall.traceVerification.verifierVersion.trim().length > 0 &&
        /^[a-f0-9]{64}$/u.test(targetCall.traceVerification.traceHash),
      true,
      targetCall.traceVerification.status === "verified" &&
        /^[a-f0-9]{64}$/u.test(targetCall.traceVerification.traceHash)
    ),
    baseCheck(
      "trace_app_commit",
      trace.appCommit === boundary.appCommit,
      boundary.appCommit,
      trace.appCommit
    ),
    baseCheck(
      "trace_domain_version",
      trace.domainVersion === boundary.domainVersion,
      boundary.domainVersion,
      trace.domainVersion
    ),
    baseCheck(
      "trace_toolset_version",
      trace.toolsetVersion === boundary.toolsetVersion,
      boundary.toolsetVersion,
      trace.toolsetVersion
    ),
    baseCheck(
      "trace_handler_version",
      trace.handlerVersion === boundary.handlerVersionByTool[targetCall.tool],
      boundary.handlerVersionByTool[targetCall.tool] ?? MISSING_VALUE,
      trace.handlerVersion
    ),
    baseCheck(
      "trace_registry_link",
      trace.registryHash === boundary.registryHash,
      boundary.registryHash,
      trace.registryHash
    ),
    baseCheck(
      "trace_raw_canonical_arguments",
      canonicalArguments !== null &&
        trace.rawArguments.bytes === canonicalArguments.bytes &&
        trace.rawArguments.sha256 === canonicalArguments.sha256 &&
        canonicalJson(trace.rawArguments.value) === canonicalJson(targetCall.arguments),
      true,
      canonicalArguments !== null &&
        trace.rawArguments.bytes === canonicalArguments.bytes &&
        trace.rawArguments.sha256 === canonicalArguments.sha256 &&
        canonicalJson(trace.rawArguments.value) === canonicalJson(targetCall.arguments)
    ),
    baseCheck(
      "trace_raw_canonical_result",
      rawResult !== null &&
        canonicalResult !== null &&
        rawResult.bytes === canonicalResult.bytes &&
        rawResult.sha256 === canonicalResult.sha256 &&
        canonicalJson(rawResult.value) === canonicalJson(targetCall.result),
      true,
      rawResult !== null &&
        canonicalResult !== null &&
        rawResult.bytes === canonicalResult.bytes &&
        rawResult.sha256 === canonicalResult.sha256 &&
        canonicalJson(rawResult.value) === canonicalJson(targetCall.result)
    ),
    baseCheck(
      "trace_state_before_link",
      canonicalJson(trace.stateBefore.value) === canonicalJson(observation.stateBefore),
      observation.stateBefore,
      semanticClone(trace.stateBefore.value)
    ),
    baseCheck(
      "trace_state_after_link",
      canonicalJson(trace.stateAfter.value) === canonicalJson(observation.stateAfter),
      observation.stateAfter,
      semanticClone(trace.stateAfter.value)
    ),
    baseCheck(
      "trace_effect_link",
      canonicalJson(trace.effect) === canonicalJson(observation.effect),
      observation.effect,
      semanticClone(trace.effect)
    )
  ];
}

/** Scores one sealed observation. It never calls a model, invokes a tool, retries, or relabels. */
export function evaluateSemanticTrial(input: {
  readonly contract: SemanticContract;
  readonly scoredCase: SemanticScoredCase;
  readonly boundaryContract: SemanticResetBoundaryContract;
  readonly observation: SemanticTrialObservation;
}): SemanticEvaluationResult {
  const meaning = semanticMeaningForCase(input.contract, input.scoredCase);
  const expectation = meaning.expectation;
  const parsedDecision = observedDecisionSchema.safeParse(input.observation.decision);
  const decision = parsedDecision.success ? parsedDecision.data : null;
  const actionClass = observedActionClass(decision);
  const checks: SemanticEvaluationCheck[] = [
    ...resetBoundaryChecks("before", input.observation.beforeReset, input.boundaryContract),
    ...resetBoundaryChecks("after", input.observation.afterReset, input.boundaryContract)
  ];
  const effectSurfaces = observedEffectSurfaces(input.observation.effect);
  const disallowedEffectSurfaces = effectSurfaces.filter(
    (surface) => !meaning.allowedEffects.includes(surface)
  );
  const forbiddenEffectSurfaces = effectSurfaces.filter((surface) =>
    meaning.forbiddenEffects.includes(surface)
  );

  const resetCheckFailed = checks.some((check) => !check.passed);
  if (resetCheckFailed) {
    const infrastructureRetryEligible =
      input.observation.modelDecisionCount === 0 &&
      input.observation.usableStructuredDecisionCount === 0 &&
      input.observation.providerToolCallCount === 0 &&
      input.observation.nativeDispatchCount === 0 &&
      input.observation.handlerTraceCount === 0 &&
      input.observation.targetCalls.length === 0;
    const result: SemanticEvaluationResult = {
      version: SEMANTIC_EVALUATOR_VERSION,
      caseId: input.scoredCase.caseId,
      runnerCaseId: input.scoredCase.runnerCaseId,
      approvalClass: meaning.approvalClass,
      expectedActionClass: expectation.kind,
      observedActionClass: actionClass,
      disposition: "infrastructure-invalid",
      infrastructureRetryEligible,
      passed: false,
      score: null,
      checks,
      failureCodes: checks.filter((check) => !check.passed).map(({ code }) => code)
    };
    return deepFreeze(canonicalClone(result));
  }

  checks.push(
    baseCheck(
      "exactly_one_model_decision",
      input.observation.modelDecisionCount === 1,
      1,
      input.observation.modelDecisionCount
    ),
    baseCheck(
      "exactly_one_usable_structured_decision",
      input.observation.usableStructuredDecisionCount === 1 && parsedDecision.success,
      1,
      input.observation.usableStructuredDecisionCount
    ),
    baseCheck("decision_usable", parsedDecision.success, true, parsedDecision.success),
    baseCheck(
      "maximum_one_provider_tool_call",
      Number.isInteger(input.observation.providerToolCallCount) &&
        input.observation.providerToolCallCount >= 0 &&
        input.observation.providerToolCallCount <= 1,
      1,
      input.observation.providerToolCallCount
    ),
    baseCheck(
      "maximum_one_native_dispatch",
      Number.isInteger(input.observation.nativeDispatchCount) &&
        input.observation.nativeDispatchCount >= 0 &&
        input.observation.nativeDispatchCount <= 1,
      1,
      input.observation.nativeDispatchCount
    ),
    baseCheck(
      "maximum_one_handler_trace",
      Number.isInteger(input.observation.handlerTraceCount) &&
        input.observation.handlerTraceCount >= 0 &&
        input.observation.handlerTraceCount <= 1,
      1,
      input.observation.handlerTraceCount
    ),
    baseCheck(
      "maximum_one_target_call",
      input.observation.targetCalls.length <= 1,
      1,
      input.observation.targetCalls.length
    ),
    baseCheck(
      "decision_action_class",
      actionClass === expectation.kind,
      expectation.kind,
      actionClass
    ),
    baseCheck(
      "provider_tool_call_matches_decision",
      input.observation.providerToolCallCount === (decision?.kind === "call" ? 1 : 0),
      decision?.kind === "call" ? 1 : 0,
      input.observation.providerToolCallCount
    ),
    baseCheck(
      "native_dispatch_evidence_count",
      input.observation.nativeDispatchCount === input.observation.targetCalls.length,
      input.observation.targetCalls.length,
      input.observation.nativeDispatchCount
    ),
    baseCheck(
      "effect_surfaces_allowed",
      disallowedEffectSurfaces.length === 0,
      [...meaning.allowedEffects],
      [...effectSurfaces]
    ),
    baseCheck(
      "forbidden_effect_surfaces_absent",
      forbiddenEffectSurfaces.length === 0,
      [],
      forbiddenEffectSurfaces
    )
  );

  const stateChanged =
    canonicalJson(input.observation.stateBefore) !== canonicalJson(input.observation.stateAfter);
  checks.push(
    baseCheck(
      "state_change",
      expectation.stateChange === "required" ? stateChanged : !stateChanged,
      expectation.stateChange,
      stateChanged
    )
  );

  for (const predicate of expectation.stateBefore) {
    checks.push(
      evaluatePredicate(
        input.observation.stateBefore,
        predicate,
        input.observation.runnerOperationId
      )
    );
  }
  for (const predicate of expectation.stateAfter) {
    checks.push(
      evaluatePredicate(
        input.observation.stateAfter,
        predicate,
        input.observation.runnerOperationId
      )
    );
  }
  for (const predicate of expectation.effect) {
    checks.push(
      evaluatePredicate(input.observation.effect, predicate, input.observation.runnerOperationId)
    );
  }

  if (expectation.kind === "call") {
    checks.push(
      baseCheck(
        "exactly_one_target_call",
        input.observation.targetCalls.length === 1,
        1,
        input.observation.targetCalls.length
      ),
      baseCheck(
        "call_handler_trace",
        input.observation.handlerTraceCount === 1,
        1,
        input.observation.handlerTraceCount
      )
    );
    const targetCall = input.observation.targetCalls[0];
    checks.push(
      baseCheck("decision_is_call", decision?.kind === "call", "call", actionClass),
      baseCheck(
        "decision_tool",
        decision?.kind === "call" && decision.tool === expectation.tool,
        expectation.tool,
        decision?.kind === "call" ? decision.tool : actionClass
      ),
      baseCheck(
        "executed_tool",
        targetCall?.tool === expectation.tool,
        expectation.tool,
        targetCall?.tool ?? MISSING_VALUE
      )
    );

    if (decision?.kind === "call" && targetCall) {
      checks.push(
        baseCheck(
          "decision_execution_arguments",
          canonicalJson(decision.arguments) === canonicalJson(targetCall.arguments),
          asJsonRecord(decision.arguments),
          asJsonRecord(targetCall.arguments)
        )
      );
    } else {
      checks.push(
        baseCheck(
          "decision_execution_arguments",
          false,
          "matching-decision-and-execution",
          MISSING_VALUE
        )
      );
    }

    const argumentsValue = targetCall ? asJsonRecord(targetCall.arguments) : MISSING_VALUE;
    for (const predicate of expectation.arguments.predicates) {
      checks.push(
        evaluatePredicate(argumentsValue, predicate, input.observation.runnerOperationId)
      );
    }
    if (targetCall) {
      checks.push(
        ...traceChecks(
          targetCall,
          input.observation,
          expectation.stateChange === "required" ? "committed" : "none",
          input.boundaryContract
        )
      );
      const uncovered = collectLeafPointers(argumentsValue).filter(
        (leaf) =>
          !expectation.arguments.predicates.some((predicate) =>
            predicateCoversLeaf(predicate, leaf)
          )
      );
      checks.push(baseCheck("no_additional_arguments", uncovered.length === 0, [], uncovered));
      for (const predicate of expectation.result) {
        checks.push(
          evaluatePredicate(targetCall.result, predicate, input.observation.runnerOperationId)
        );
      }
    } else {
      checks.push(baseCheck("target_result_available", false, true, false));
    }
  } else {
    checks.push(
      baseCheck(
        "no_target_call",
        input.observation.targetCalls.length === 0,
        0,
        input.observation.targetCalls.length
      ),
      baseCheck(
        "no_handler_trace",
        input.observation.handlerTraceCount === 0,
        0,
        input.observation.handlerTraceCount
      )
    );
  }

  const passed = checks.every((check) => check.passed);
  const result: SemanticEvaluationResult = {
    version: SEMANTIC_EVALUATOR_VERSION,
    caseId: input.scoredCase.caseId,
    runnerCaseId: input.scoredCase.runnerCaseId,
    approvalClass: meaning.approvalClass,
    expectedActionClass: expectation.kind,
    observedActionClass: actionClass,
    disposition: "scored",
    infrastructureRetryEligible: false,
    passed,
    score: passed ? 1 : 0,
    checks,
    failureCodes: checks.filter((check) => !check.passed).map(({ code }) => code)
  };
  return deepFreeze(canonicalClone(result));
}

const RUNNER_OPERATION_ID_PLACEHOLDER = Object.freeze({
  $toolproofSemantic: "runner-owned-operation-id"
}) as SemanticJsonValue;

interface SemanticActionFact {
  readonly path: string;
  readonly value: SemanticJsonValue;
}

interface SemanticActionSignature {
  readonly kind: "call" | "clarify" | "no_action" | "malformed";
  readonly tool: string | null;
  readonly argumentFacts: readonly SemanticActionFact[];
}

function collectLeafFacts(value: SemanticJsonValue, path = ""): readonly SemanticActionFact[] {
  const pointers = collectLeafPointers(value, path);
  return pointers.map((pointer) => ({
    path: pointer,
    value: resolveJsonPointer(
      value,
      pointer.startsWith(path) ? pointer.slice(path.length) : pointer
    ).value
  }));
}

function expectedActionSignature(expectation: SemanticExpectation): SemanticActionSignature {
  if (expectation.kind !== "call") {
    return { kind: expectation.kind, tool: null, argumentFacts: [] };
  }
  const facts: SemanticActionFact[] = [];
  for (const predicate of expectation.arguments.predicates) {
    if (predicate.operator === "runner_operation_id") {
      facts.push({ path: predicate.path, value: RUNNER_OPERATION_ID_PLACEHOLDER });
    } else if (predicate.operator === "equals") {
      const nested = collectLeafFacts(predicate.value);
      if (nested.length === 0) {
        facts.push({ path: predicate.path, value: predicate.value });
      } else {
        for (const fact of nested) {
          facts.push({ path: `${predicate.path}${fact.path}`, value: fact.value });
        }
      }
    }
  }
  return {
    kind: "call",
    tool: expectation.tool,
    argumentFacts: facts.sort((left, right) => left.path.localeCompare(right.path))
  };
}

function observedActionSignature(
  decision: SemanticObservedDecision | null,
  runnerOperationId: string
): SemanticActionSignature {
  if (!decision) return { kind: "malformed", tool: null, argumentFacts: [] };
  if (decision.kind === "clarify") return { kind: "clarify", tool: null, argumentFacts: [] };
  if (decision.kind === "abstain") return { kind: "no_action", tool: null, argumentFacts: [] };
  return {
    kind: "call",
    tool: decision.tool,
    argumentFacts: collectLeafFacts(decision.arguments)
      .map((fact) => ({
        ...fact,
        value:
          fact.path === "/operationId" && fact.value === runnerOperationId
            ? RUNNER_OPERATION_ID_PLACEHOLDER
            : fact.value
      }))
      .sort((left, right) => left.path.localeCompare(right.path))
  };
}

function actionDelta(
  anchor: SemanticActionSignature,
  contrast: SemanticActionSignature
): SemanticJsonValue {
  const anchorFacts = new Map(anchor.argumentFacts.map((fact) => [fact.path, fact.value]));
  const contrastFacts = new Map(contrast.argumentFacts.map((fact) => [fact.path, fact.value]));
  const paths = [...new Set([...anchorFacts.keys(), ...contrastFacts.keys()])].sort();
  return {
    kind: {
      anchor: anchor.kind,
      contrast: contrast.kind,
      changed: anchor.kind !== contrast.kind
    },
    tool: {
      anchor: anchor.tool,
      contrast: contrast.tool,
      changed: anchor.tool !== contrast.tool
    },
    arguments: paths.map((path) => {
      const anchorValue = anchorFacts.get(path) ?? MISSING_VALUE;
      const contrastValue = contrastFacts.get(path) ?? MISSING_VALUE;
      return {
        path,
        anchor: anchorValue,
        contrast: contrastValue,
        changed: canonicalJson(anchorValue) !== canonicalJson(contrastValue)
      };
    })
  };
}

export interface SemanticMatchedPairEvaluationResult {
  readonly version: typeof SEMANTIC_EVALUATOR_VERSION;
  readonly pairId: string;
  readonly subset: SemanticScoredCase["subset"];
  readonly family: SemanticScoredCase["family"];
  readonly anchor: SemanticEvaluationResult;
  readonly contrast: SemanticEvaluationResult;
  readonly bothCasesPassed: boolean;
  readonly frozenActionsDiffer: boolean;
  readonly observedActionsDiffer: boolean;
  readonly observedDeltaMatchesFrozen: boolean;
  readonly expectedDelta: SemanticJsonValue;
  readonly observedDelta: SemanticJsonValue;
  readonly passed: boolean;
}

export class SemanticMatchedPairEvaluationError extends Error {
  constructor(readonly code: "not_a_single_intact_matched_pair") {
    super(code);
    this.name = "SemanticMatchedPairEvaluationError";
  }
}

/** Verifies sensitivity for both sides of one frozen matched-boundary pair. */
export function evaluateSemanticMatchedPair(input: {
  readonly contract: SemanticContract;
  readonly trials: readonly [
    {
      readonly scoredCase: SemanticScoredCase;
      readonly boundaryContract: SemanticResetBoundaryContract;
      readonly observation: SemanticTrialObservation;
    },
    {
      readonly scoredCase: SemanticScoredCase;
      readonly boundaryContract: SemanticResetBoundaryContract;
      readonly observation: SemanticTrialObservation;
    }
  ];
}): SemanticMatchedPairEvaluationResult {
  const [first, second] = input.trials;
  if (
    first.scoredCase.relationship.kind !== "matched_boundary" ||
    second.scoredCase.relationship.kind !== "matched_boundary" ||
    first.scoredCase.relationship.pairId !== second.scoredCase.relationship.pairId ||
    first.scoredCase.relationship.side === second.scoredCase.relationship.side ||
    first.scoredCase.subset !== second.scoredCase.subset ||
    first.scoredCase.family !== second.scoredCase.family
  ) {
    throw new SemanticMatchedPairEvaluationError("not_a_single_intact_matched_pair");
  }
  const pairId = first.scoredCase.relationship.pairId;
  const anchorTrial = first.scoredCase.relationship.side === "anchor" ? first : second;
  const contrastTrial = first.scoredCase.relationship.side === "contrast" ? first : second;
  const anchorMeaning = semanticMeaningForCase(input.contract, anchorTrial.scoredCase);
  const contrastMeaning = semanticMeaningForCase(input.contract, contrastTrial.scoredCase);
  const anchorResult = evaluateSemanticTrial({
    contract: input.contract,
    scoredCase: anchorTrial.scoredCase,
    boundaryContract: anchorTrial.boundaryContract,
    observation: anchorTrial.observation
  });
  const contrastResult = evaluateSemanticTrial({
    contract: input.contract,
    scoredCase: contrastTrial.scoredCase,
    boundaryContract: contrastTrial.boundaryContract,
    observation: contrastTrial.observation
  });
  const expectedAnchor = expectedActionSignature(anchorMeaning.expectation);
  const expectedContrast = expectedActionSignature(contrastMeaning.expectation);
  const anchorDecision = observedDecisionSchema.safeParse(anchorTrial.observation.decision);
  const contrastDecision = observedDecisionSchema.safeParse(contrastTrial.observation.decision);
  const observedAnchor = observedActionSignature(
    anchorDecision.success ? anchorDecision.data : null,
    anchorTrial.observation.runnerOperationId
  );
  const observedContrast = observedActionSignature(
    contrastDecision.success ? contrastDecision.data : null,
    contrastTrial.observation.runnerOperationId
  );
  const expectedDelta = actionDelta(expectedAnchor, expectedContrast);
  const observedDelta = actionDelta(observedAnchor, observedContrast);
  const frozenActionsDiffer = canonicalJson(expectedAnchor) !== canonicalJson(expectedContrast);
  const observedActionsDiffer = canonicalJson(observedAnchor) !== canonicalJson(observedContrast);
  const observedDeltaMatchesFrozen = canonicalJson(expectedDelta) === canonicalJson(observedDelta);
  const bothCasesPassed = anchorResult.passed && contrastResult.passed;
  return deepFreeze(
    canonicalClone({
      version: SEMANTIC_EVALUATOR_VERSION,
      pairId,
      subset: anchorTrial.scoredCase.subset,
      family: anchorTrial.scoredCase.family,
      anchor: anchorResult,
      contrast: contrastResult,
      bothCasesPassed,
      frozenActionsDiffer,
      observedActionsDiffer,
      observedDeltaMatchesFrozen,
      expectedDelta,
      observedDelta,
      passed:
        bothCasesPassed &&
        frozenActionsDiffer &&
        observedActionsDiffer &&
        observedDeltaMatchesFrozen
    })
  );
}

export function semanticEvaluatorContractHash(): Promise<string> {
  return canonicalSha256(SEMANTIC_EVALUATOR_CONTRACT);
}
