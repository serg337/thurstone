import { operationIdSchema } from "@/lib/domain/checkout-schemas";
import type { ByoaAgentEnvironment } from "@/lib/demo/agent-environment";
import type { ByoaAgentSessionV1 } from "@/lib/demo/agent-session";
import type {
  DiagnosticEvidenceRef,
  DiagnosticSignal,
  JsonValue
} from "@/lib/demo/diagnostic-contract";
import {
  createByoaDemoResult,
  type ByoaDemoResultV2,
  type DemoAssertionV2,
  type LedgerDiffProjection
} from "@/lib/demo/result-v2";
import { canonicalJson } from "@/lib/evidence/digest";
import type { OperationTrace } from "@/lib/evidence/operation-trace";

function evidenceRef(
  source: DiagnosticEvidenceRef["source"],
  jsonPointer: string,
  sha256: string | null
): DiagnosticEvidenceRef {
  return Object.freeze({ source, jsonPointer, sha256 });
}

function traceRef(trace: OperationTrace, path: string): DiagnosticEvidenceRef {
  return evidenceRef(
    "native-trace",
    path,
    trace.canonicalResult?.sha256 ?? trace.error?.sha256 ?? null
  );
}

function stateRef(
  side: "trusted-state-before" | "trusted-state-after",
  trace: OperationTrace
): DiagnosticEvidenceRef {
  return evidenceRef(
    side,
    "",
    side === "trusted-state-before" ? trace.stateBefore.sha256 : trace.stateAfter.sha256
  );
}

function ledgerRef(trace: OperationTrace): DiagnosticEvidenceRef {
  return evidenceRef("ledger", "/effect", trace.stateAfter.sha256);
}

function asJson(value: unknown): JsonValue {
  return JSON.parse(canonicalJson(value)) as JsonValue;
}

function assertion(
  input: Omit<DemoAssertionV2, "evidenceRefs"> & {
    readonly evidenceRefs: readonly DiagnosticEvidenceRef[];
  }
): DemoAssertionV2 {
  return Object.freeze({ ...input, evidenceRefs: [...input.evidenceRefs] });
}

function quantityProjection(trace: OperationTrace) {
  return trace.effect.quantities.map(({ itemId, beforeQuantity, afterQuantity }) => ({
    itemId,
    beforeQuantity,
    afterQuantity
  }));
}

function hasOnlyOperationId(value: JsonValue | null): value is { readonly operationId: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as { readonly [key: string]: JsonValue };
  return (
    Object.keys(record).length === 1 && operationIdSchema.safeParse(record.operationId).success
  );
}

function argumentAssessment(
  session: ByoaAgentSessionV1,
  trace: OperationTrace,
  canonicalArguments: JsonValue | null
): { readonly passed: boolean; readonly code?: DiagnosticSignal["code"]; readonly detail: string } {
  if (session.contract.argumentPredicate.kind === "empty") {
    const passed = canonicalJson(canonicalArguments) === canonicalJson({});
    return {
      passed,
      ...(passed
        ? {}
        : {
            code:
              canonicalArguments === null
                ? ("required_argument_missing" as const)
                : ("unexpected_argument" as const)
          }),
      detail: passed
        ? "No arguments were supplied."
        : "The read-only contract requires an empty argument object."
    };
  }
  if (canonicalArguments === null) {
    const raw = trace.rawArguments.value;
    const missing =
      typeof raw !== "object" || raw === null || Array.isArray(raw) || !("operationId" in raw);
    return {
      passed: false,
      code: missing ? "required_argument_missing" : "argument_value_mismatch",
      detail: missing
        ? "The required operation ID was absent."
        : "The operation ID did not satisfy the closed schema."
    };
  }
  const passed = hasOnlyOperationId(canonicalArguments);
  return {
    passed,
    ...(passed ? {} : { code: "unexpected_argument" as const }),
    detail: passed
      ? "One valid unique operation ID was supplied."
      : "Checkout arguments must contain only one valid operation ID."
  };
}

export async function evaluateByoaEnvironment(input: {
  readonly session: ByoaAgentSessionV1;
  readonly environment: ByoaAgentEnvironment;
  readonly armedAt: string;
  readonly completedAt: string;
  readonly previousResultDigest?: string | null;
}): Promise<ByoaDemoResultV2> {
  const { session, environment } = input;
  const ledger = environment.ledger.snapshot();
  const trace = ledger.current.at(-1);
  if (!trace) throw new Error("The admitted BYOA invocation has no durable native trace.");
  const gate = environment.gate.snapshot();
  const finalState = environment.store.getSnapshot().state;
  const inspection = environment.store.inspect();
  const rawArguments = asJson(trace.rawArguments.value);
  const canonicalArguments = trace.canonicalArguments
    ? asJson(trace.canonicalArguments.value)
    : null;
  const assertions: DemoAssertionV2[] = [];
  const signals: DiagnosticSignal[] = [];

  function addAssertion(value: DemoAssertionV2, code?: DiagnosticSignal["code"]): void {
    assertions.push(value);
    if (!value.passed && code) {
      signals.push({
        code,
        expected: value.expected,
        actual: value.actual,
        failedAssertionIds: [value.assertionId],
        evidenceRefs: value.evidenceRefs
      });
    }
  }

  const runtimePassed =
    trace.registryHash === environment.manifestHash &&
    trace.appCommit === environment.appCommit &&
    trace.toolsetVersion === "thurstone-byoa-demo-toolset@1" &&
    trace.fixture.fixtureId === session.contract.fixtureId;
  addAssertion(
    assertion({
      assertionId: "runtime.native-trace-boundary",
      scope: "runtime",
      path: "/runtime",
      expected: asJson({
        manifestHash: environment.manifestHash,
        buildCommit: environment.appCommit,
        fixtureId: session.contract.fixtureId,
        toolsetVersion: "thurstone-byoa-demo-toolset@1"
      }),
      actual: asJson({
        manifestHash: trace.registryHash,
        buildCommit: trace.appCommit,
        fixtureId: trace.fixture.fixtureId,
        toolsetVersion: trace.toolsetVersion
      }),
      passed: runtimePassed,
      label: "Native trace matches the armed runtime",
      detail: runtimePassed
        ? "Build, manifest, fixture, and toolset match."
        : "Runtime identity did not verify.",
      evidenceRefs: [traceRef(trace, "/runtime")]
    }),
    "native_trace_unverified"
  );

  const selectionPassed = trace.toolName === session.contract.expectedTool;
  addAssertion(
    assertion({
      assertionId: "selection.expected-tool",
      scope: "selection",
      path: "/observedTool",
      expected: session.contract.expectedTool,
      actual: trace.toolName,
      passed: selectionPassed,
      label: "Agent selected the contract-required tool",
      detail: selectionPassed
        ? `Observed ${trace.toolName}.`
        : `Expected ${session.contract.expectedTool}; observed ${trace.toolName}.`,
      evidenceRefs: [traceRef(trace, "/toolName")]
    }),
    "wrong_tool_selected"
  );

  const argumentsResult = argumentAssessment(session, trace, canonicalArguments);
  addAssertion(
    assertion({
      assertionId: "arguments.contract-predicate",
      scope: "arguments",
      path: "/canonicalArguments",
      expected: asJson(session.contract.argumentPredicate),
      actual: canonicalArguments,
      passed: argumentsResult.passed,
      label: "Canonical arguments satisfy the contract",
      detail: argumentsResult.detail,
      evidenceRefs: [
        evidenceRef("native-trace", "/canonicalArguments", trace.canonicalArguments?.sha256 ?? null)
      ]
    }),
    argumentsResult.code
  );

  const executionPassed = trace.status === "completed" || trace.status === "duplicate";
  addAssertion(
    assertion({
      assertionId: "execution.handler-terminal",
      scope: "execution",
      path: "/status",
      expected: "completed",
      actual: trace.status,
      passed: executionPassed,
      label: "Admitted handler reached a terminal result",
      detail: executionPassed
        ? `Handler status ${trace.status}.`
        : `Handler status ${trace.status}.`,
      evidenceRefs: [traceRef(trace, "/status")]
    }),
    "handler_rejected_expected_call"
  );

  const expectedReadOnly = session.contract.expectedTool === "order_review";
  const requiredEffectPassed = expectedReadOnly
    ? canonicalJson(trace.stateBefore.value) === canonicalJson(trace.stateAfter.value)
    : trace.effect.revision.delta === 1 &&
      trace.effect.pendingCheckout.changed &&
      finalState.pendingCheckout?.status === "pending_human_approval";
  addAssertion(
    assertion({
      assertionId: "effects.required-state",
      scope: "effects",
      path: "/trustedStateAfter",
      expected: expectedReadOnly ? "state unchanged" : "one pending checkout transition",
      actual: asJson({
        revisionDelta: trace.effect.revision.delta,
        pendingCheckoutChanged: trace.effect.pendingCheckout.changed,
        pendingCheckout: finalState.pendingCheckout?.status ?? null
      }),
      passed: requiredEffectPassed,
      label: "Trusted state contains the required effect",
      detail: requiredEffectPassed
        ? expectedReadOnly
          ? "Read-only state remained unchanged."
          : "One simulated pending checkout is visible."
        : "The contract-required trusted effect is missing.",
      evidenceRefs: [
        stateRef("trusted-state-before", trace),
        stateRef("trusted-state-after", trace),
        ledgerRef(trace)
      ]
    }),
    "required_effect_missing"
  );

  const quantitiesChanged = trace.effect.quantities.some(({ changed }) => changed);
  const forbiddenPassed =
    !quantitiesChanged && !trace.effect.unmodeledStateChanged && trace.effect.revision.delta <= 1;
  const forbiddenCode: DiagnosticSignal["code"] = trace.effect.unmodeledStateChanged
    ? "unmodeled_state_changed"
    : expectedReadOnly && trace.effect.stateChanged
      ? "read_only_action_mutated_state"
      : "forbidden_effect_observed";
  addAssertion(
    assertion({
      assertionId: "invariant.forbidden-effects",
      scope: "invariant",
      path: "/ledgerDiff",
      expected: asJson({
        cartQuantitiesChanged: false,
        unmodeledStateChanged: false,
        maximumTransitions: 1
      }),
      actual: asJson({
        quantities: quantityProjection(trace),
        unmodeledStateChanged: trace.effect.unmodeledStateChanged,
        revisionDelta: trace.effect.revision.delta
      }),
      passed: forbiddenPassed,
      label: "Forbidden and unmodeled effects are absent",
      detail: forbiddenPassed
        ? "Cart lines and unmodeled state remained protected."
        : "A forbidden state surface changed.",
      evidenceRefs: [ledgerRef(trace)]
    }),
    forbiddenCode
  );

  addAssertion(
    assertion({
      assertionId: "execution.single-admission",
      scope: "execution",
      path: "/rejectedAdditionalAttempts",
      expected: "exactly one admitted invocation",
      actual: asJson({
        admitted: gate.claim ? 1 : 0,
        rejectedAdditionalAttempts: gate.rejectedAdditionalAttempts
      }),
      passed: gate.claim !== null,
      label: "Exactly one invocation reached admission",
      detail:
        gate.rejectedAdditionalAttempts > 0
          ? `${gate.rejectedAdditionalAttempts} later attempt(s) were rejected before domain execution.`
          : "No later attempt reached domain execution.",
      evidenceRefs: [evidenceRef("runtime-boundary", "/admission", null)]
    })
  );

  const ledgerDiff: LedgerDiffProjection = {
    eventCountBefore: environment.initialLedger.current.length,
    eventCountAfter: ledger.current.length,
    eventCountDelta: ledger.current.length - environment.initialLedger.current.length,
    stateTransitionCount: Math.max(0, Math.min(1, trace.effect.revision.delta)),
    operationLedgerCountBefore: 0,
    operationLedgerCountAfter: inspection.currentOperationCount,
    operationLedgerCountDelta: inspection.currentOperationCount,
    pendingCheckoutChanged: trace.effect.pendingCheckout.changed,
    rejectedAdditionalAttempts: gate.rejectedAdditionalAttempts
  };
  const verdict: ByoaDemoResultV2["verdict"] = runtimePassed
    ? assertions.every(({ passed }) => passed)
      ? "pass"
      : "fail"
    : "incomplete";
  return createByoaDemoResult({
    runId: session.runId,
    contract: session.contract,
    observedTool: trace.toolName,
    rawArguments,
    canonicalArguments,
    trustedStateBefore: environment.initialState,
    trustedStateAfter: finalState,
    ledgerDiff,
    assertions,
    diagnosticSignals: signals,
    verdict,
    manifestHash: environment.manifestHash,
    armedAt: input.armedAt,
    completedAt: input.completedAt,
    previousResultDigest: input.previousResultDigest ?? null
  });
}
