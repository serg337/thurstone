import "server-only";

import {
  cartGet,
  cartUpdate,
  checkoutRequest,
  createCheckoutFixture,
  orderReview,
  type CheckoutState
} from "@/lib/domain/checkout";
import { cartUpdateInputSchema, checkoutOperationInputSchema } from "@/lib/domain/checkout-schemas";
import { CHECKOUT_FIXTURE_STATE_HASH } from "@/lib/domain/checkout-reset";
import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { checkoutEffectDiff, type OperationTrace } from "@/lib/evidence/operation-trace";
import type { ProbeDecision } from "@/lib/probe/decision";
import { INITIAL_CHECKOUT_TOOL_NAMES, type CheckoutToolName } from "@/lib/webmcp/catalog";

export const PROBE_CALIBRATION_CASE_COUNT = 4;
export const PROBE_CALIBRATION_CATALOG_VERSION = "toolproof-probe-calibration-catalog@1.0.0";

export interface ProbeCalibrationCaseDefinition {
  readonly ordinal: 0 | 1 | 2 | 3;
  readonly internalTruthId: string;
  readonly naturalLanguageRequest: string;
  readonly expectedTool: CheckoutToolName;
}

const CALIBRATION_CASES: readonly ProbeCalibrationCaseDefinition[] = Object.freeze([
  Object.freeze({
    ordinal: 0 as const,
    internalTruthId: "calibration_truth_cart_lines",
    naturalLanguageRequest: "What items and quantities are currently in my cart?",
    expectedTool: "cart_get" as const
  }),
  Object.freeze({
    ordinal: 1 as const,
    internalTruthId: "calibration_truth_order_summary",
    naturalLanguageRequest:
      "Please review my current order, including line prices, shipping cost, delivery timing, and the total.",
    expectedTool: "order_review" as const
  }),
  Object.freeze({
    ordinal: 2 as const,
    internalTruthId: "calibration_truth_quantity_change",
    naturalLanguageRequest: "Set the Stoneware mug quantity in my cart to 3.",
    expectedTool: "cart_update" as const
  }),
  Object.freeze({
    ordinal: 3 as const,
    internalTruthId: "calibration_truth_checkout_request",
    naturalLanguageRequest:
      "I am ready to continue. Open the simulated checkout for this cart so it can remain pending for my approval.",
    expectedTool: "checkout_request" as const
  })
]);

export interface ProbeResetBoundaryObservation {
  readonly status: string;
  readonly stateRevision: number;
  readonly stateHash: string;
  readonly operationLedgerCount: number;
  readonly currentTrajectoryCount: number;
  readonly registeredToolNames: readonly string[];
}

export interface ProbeNativeExecutionObservation {
  readonly toolName: string;
  readonly nativeCallCount: number;
  readonly handlerTraceId: string | null;
  readonly resultDigest: string | null;
  readonly effectDigest: string | null;
  readonly stateBeforeDigest: string | null;
  readonly stateAfterDigest: string | null;
}

export interface ProbeCalibrationObservation {
  readonly decision: ProbeDecision | null;
  readonly decisionError: string | null;
  readonly nativeDispatchCount: number;
  readonly nativeExecution: ProbeNativeExecutionObservation | null;
  readonly trace: OperationTrace | null;
  readonly resetBefore: ProbeResetBoundaryObservation;
  readonly resetAfter: ProbeResetBoundaryObservation;
}

export interface ProbeCalibrationEvaluation {
  readonly version: "toolproof-probe-calibration-evaluation@1.0.0";
  readonly catalogVersion: typeof PROBE_CALIBRATION_CATALOG_VERSION;
  readonly ordinal: number;
  readonly internalTruthId: string;
  readonly expectedTool: CheckoutToolName;
  readonly observedDecisionKind: ProbeDecision["kind"] | "invalid";
  readonly observedTool: string | null;
  readonly passed: boolean;
  readonly calibrationOnly: true;
  readonly includedInBenchmark: false;
  readonly score: { readonly earned: 0 | 1; readonly possible: 1 };
  readonly failures: readonly string[];
}

export class ProbeCalibrationCatalogError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProbeCalibrationCatalogError";
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function sameNames(actual: readonly string[]): boolean {
  const sorted = [...actual].sort();
  return (
    sorted.length === INITIAL_CHECKOUT_TOOL_NAMES.length &&
    sorted.every((name, index) => name === INITIAL_CHECKOUT_TOOL_NAMES[index])
  );
}

function validateReset(
  boundary: ProbeResetBoundaryObservation,
  prefix: "before" | "after",
  failures: string[]
): void {
  if (boundary.status !== "verified") failures.push(`${prefix}_reset_unverified`);
  if (boundary.stateRevision !== 0) failures.push(`${prefix}_reset_revision_mismatch`);
  if (boundary.stateHash !== CHECKOUT_FIXTURE_STATE_HASH) {
    failures.push(`${prefix}_reset_state_mismatch`);
  }
  if (boundary.operationLedgerCount !== 0 || boundary.currentTrajectoryCount !== 0) {
    failures.push(`${prefix}_reset_not_clean`);
  }
  if (!sameNames(boundary.registeredToolNames)) failures.push(`${prefix}_registry_mismatch`);
}

async function expectedExecution(
  tool: CheckoutToolName,
  trace: OperationTrace
): Promise<{
  readonly arguments: unknown;
  readonly result: unknown;
  readonly stateBefore: CheckoutState;
  readonly stateAfter: CheckoutState;
  readonly effect: ReturnType<typeof checkoutEffectDiff>;
  readonly commitDisposition: OperationTrace["commitDisposition"];
} | null> {
  const fixture = createCheckoutFixture();
  if (tool === "cart_get") {
    return {
      arguments: {},
      result: cartGet(fixture),
      stateBefore: fixture,
      stateAfter: fixture,
      effect: checkoutEffectDiff(fixture, fixture),
      commitDisposition: "none"
    };
  }
  if (tool === "order_review") {
    return {
      arguments: {},
      result: orderReview(fixture),
      stateBefore: fixture,
      stateAfter: fixture,
      effect: checkoutEffectDiff(fixture, fixture),
      commitDisposition: "none"
    };
  }
  if (tool === "cart_update") {
    const parsed = cartUpdateInputSchema.safeParse(trace.canonicalArguments?.value);
    if (
      !parsed.success ||
      parsed.data.operation !== "set_quantity" ||
      parsed.data.itemId !== "stoneware-mug" ||
      parsed.data.quantity !== 3
    ) {
      return null;
    }
    const mutation = cartUpdate(fixture, parsed.data);
    return {
      arguments: parsed.data,
      result: mutation.result,
      stateBefore: fixture,
      stateAfter: mutation.state,
      effect: checkoutEffectDiff(fixture, mutation.state),
      commitDisposition: "committed"
    };
  }
  if (tool === "checkout_request") {
    const parsed = checkoutOperationInputSchema.safeParse(trace.canonicalArguments?.value);
    if (!parsed.success) return null;
    const mutation = checkoutRequest(fixture, parsed.data, await canonicalSha256(fixture));
    return {
      arguments: parsed.data,
      result: mutation.result,
      stateBefore: fixture,
      stateAfter: mutation.state,
      effect: checkoutEffectDiff(fixture, mutation.state),
      commitDisposition: "committed"
    };
  }
  return null;
}

export function getProbeCalibrationCase(ordinal: number): ProbeCalibrationCaseDefinition {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= PROBE_CALIBRATION_CASE_COUNT) {
    throw new ProbeCalibrationCatalogError("invalid_calibration_ordinal");
  }
  const definition = CALIBRATION_CASES[ordinal];
  if (!definition) throw new ProbeCalibrationCatalogError("missing_calibration_case");
  return definition;
}

export async function evaluateProbeCalibrationCase(
  ordinal: number,
  observation: ProbeCalibrationObservation
): Promise<ProbeCalibrationEvaluation> {
  const definition = getProbeCalibrationCase(ordinal);
  const failures: string[] = [];
  validateReset(observation.resetBefore, "before", failures);
  validateReset(observation.resetAfter, "after", failures);

  const observedKind = observation.decision?.kind ?? "invalid";
  const observedTool = observation.decision?.kind === "call" ? observation.decision.tool : null;
  if (observation.decisionError !== null) failures.push("decision_error");
  if (observation.decision?.kind !== "call") failures.push("decision_not_call");
  if (observedTool !== definition.expectedTool) failures.push("wrong_tool");
  if (observation.nativeDispatchCount !== 1) failures.push("native_dispatch_count_mismatch");

  const trace = observation.trace;
  const execution = observation.nativeExecution;
  if (!trace) failures.push("handler_trace_missing");
  if (!execution) failures.push("native_receipt_missing");
  if (trace && execution) {
    if (
      execution.toolName !== definition.expectedTool ||
      execution.nativeCallCount !== 1 ||
      execution.handlerTraceId !== trace.eventId ||
      execution.resultDigest !== trace.canonicalResult?.sha256 ||
      execution.effectDigest !== (await canonicalSha256(trace.effect)) ||
      execution.stateBeforeDigest !== trace.stateBefore.sha256 ||
      execution.stateAfterDigest !== trace.stateAfter.sha256
    ) {
      failures.push("native_receipt_trace_mismatch");
    }

    if (
      !trace.canonicalArguments ||
      !sameJson(trace.rawArguments.value, trace.canonicalArguments.value)
    ) {
      failures.push("raw_arguments_mismatch");
    }
    if (
      !trace.rawResult ||
      !trace.canonicalResult ||
      !sameJson(trace.rawResult.value, trace.canonicalResult.value)
    ) {
      failures.push("raw_result_mismatch");
    }
    if (trace.error?.value !== null) failures.push("handler_error_present");

    const expected = await expectedExecution(definition.expectedTool, trace);
    if (!expected) {
      failures.push("arguments_mismatch");
    } else {
      if (
        trace.source !== "native" ||
        trace.toolName !== definition.expectedTool ||
        trace.status !== "completed" ||
        trace.commitDisposition !== expected.commitDisposition ||
        trace.cancellationObservedAfterCommit ||
        trace.cancellationObservedAfterCompletion
      ) {
        failures.push("trace_status_mismatch");
      }
      if (!sameJson(trace.canonicalArguments?.value, expected.arguments)) {
        failures.push("arguments_mismatch");
      }
      if (!sameJson(trace.canonicalResult?.value, expected.result)) {
        failures.push("result_mismatch");
      }
      if (!sameJson(trace.stateBefore.value, expected.stateBefore)) {
        failures.push("state_before_mismatch");
      }
      if (!sameJson(trace.stateAfter.value, expected.stateAfter)) {
        failures.push("state_after_mismatch");
      }
      if (!sameJson(trace.effect, expected.effect)) failures.push("effect_mismatch");
    }
  }

  const uniqueFailures = Object.freeze([...new Set(failures)].sort());
  const passed = uniqueFailures.length === 0;
  return Object.freeze({
    version: "toolproof-probe-calibration-evaluation@1.0.0",
    catalogVersion: PROBE_CALIBRATION_CATALOG_VERSION,
    ordinal,
    internalTruthId: definition.internalTruthId,
    expectedTool: definition.expectedTool,
    observedDecisionKind: observedKind,
    observedTool,
    passed,
    calibrationOnly: true,
    includedInBenchmark: false,
    score: Object.freeze({ earned: passed ? (1 as const) : (0 as const), possible: 1 as const }),
    failures: uniqueFailures
  });
}
