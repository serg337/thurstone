import { operationIdSchema } from "@/lib/domain/checkout-schemas";
import type { CheckoutState } from "@/lib/domain/checkout";
import type { ByoaAgentEnvironmentV2 } from "@/lib/demo/agent-environment-v2";
import { verifyByoaAgentSessionV2, type ByoaAgentSessionV2 } from "@/lib/demo/agent-session-v2";
import type {
  DiagnosticEvidenceRef,
  DiagnosticSignal,
  JsonValue
} from "@/lib/demo/diagnostic-contract";
import type { ThurstoneContractCaseArgumentPredicate } from "@/lib/demo/contract-suite";
import {
  createByoaDemoResultV3,
  type ByoaDemoResultV3,
  type ByoaEvidenceTier,
  type ByoaLaunchMode,
  type DemoAssertionV3,
  type LedgerDiffV3
} from "@/lib/demo/result-v3";
import { canonicalJson } from "@/lib/evidence/digest";
import type { OperationTrace } from "@/lib/evidence/operation-trace";

function asJson(value: unknown): JsonValue {
  return JSON.parse(canonicalJson(value)) as JsonValue;
}

function evidenceRef(
  source: DiagnosticEvidenceRef["source"],
  jsonPointer: string,
  sha256: string | null
): DiagnosticEvidenceRef {
  return Object.freeze({ source, jsonPointer, sha256 });
}

function traceRef(trace: OperationTrace, path: string): DiagnosticEvidenceRef {
  void trace;
  // OperationTrace v1 does not expose a digest for an arbitrary JSON pointer. Keep the pointer
  // useful and the digest explicitly unknown instead of attaching an unrelated result/error hash.
  return evidenceRef("native-trace", path, null);
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
  void trace;
  // The state-after digest is not the digest of /effect. Result v3 therefore leaves it unset.
  return evidenceRef("ledger", "/effect", null);
}

function assertion(
  input: Omit<DemoAssertionV3, "evidenceRefs"> & {
    readonly evidenceRefs: readonly DiagnosticEvidenceRef[];
  }
): DemoAssertionV3 {
  return Object.freeze({ ...input, evidenceRefs: [...input.evidenceRefs] });
}

function isJsonObject(value: JsonValue | null): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: { readonly [key: string]: JsonValue }, expected: readonly string[]) {
  return canonicalJson(Object.keys(value).sort()) === canonicalJson([...expected].sort());
}

function argumentAssessment(
  predicate: ThurstoneContractCaseArgumentPredicate,
  trace: OperationTrace,
  canonicalArguments: JsonValue | null
): {
  readonly passed: boolean;
  readonly code?: DiagnosticSignal["code"];
  readonly detail: string;
} {
  if (predicate.kind === "empty") {
    const passed = isJsonObject(canonicalArguments) && exactKeys(canonicalArguments, []);
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
        ? "The canonical argument object is empty."
        : "This read-only contract requires an empty argument object."
    };
  }

  if (!isJsonObject(canonicalArguments)) {
    const raw = trace.rawArguments.value;
    const missing =
      typeof raw !== "object" || raw === null || Array.isArray(raw) || !("operationId" in raw);
    return {
      passed: false,
      code: missing ? "required_argument_missing" : "argument_value_mismatch",
      detail: missing
        ? "The required operation ID was absent."
        : "Arguments did not satisfy the closed native schema."
    };
  }

  if (!Object.hasOwn(canonicalArguments, "operationId")) {
    return {
      passed: false,
      code: "required_argument_missing",
      detail: "The required operation ID was absent."
    };
  }

  if (predicate.kind === "checkout_request") {
    const validOperationId = operationIdSchema.safeParse(canonicalArguments.operationId).success;
    const passed = exactKeys(canonicalArguments, ["operationId"]) && validOperationId;
    return {
      passed,
      ...(passed
        ? {}
        : {
            code: exactKeys(canonicalArguments, ["operationId"])
              ? ("argument_value_mismatch" as const)
              : ("unexpected_argument" as const)
          }),
      detail: passed
        ? "One schema-valid operation ID was supplied; uniqueness is corroborated by the clean ledger and committed transition."
        : "Checkout arguments must contain only one schema-valid operation ID."
    };
  }

  const keysMatch = exactKeys(canonicalArguments, [
    "operationId",
    "operation",
    "itemId",
    "quantity"
  ]);
  const valuesMatch =
    operationIdSchema.safeParse(canonicalArguments.operationId).success &&
    canonicalArguments.operation === "set_quantity" &&
    canonicalArguments.itemId === predicate.itemId &&
    canonicalArguments.quantity === predicate.quantity;
  const passed = keysMatch && valuesMatch;
  return {
    passed,
    ...(passed
      ? {}
      : {
          code: keysMatch ? ("argument_value_mismatch" as const) : ("unexpected_argument" as const)
        }),
    detail: passed
      ? `Arguments select ${predicate.itemId} quantity ${predicate.quantity} with a schema-valid operation ID.`
      : "Cart-update arguments did not match the exact contracted item and quantity."
  };
}

function independentEffect(before: CheckoutState, after: CheckoutState): LedgerDiffV3["effect"] {
  const quantities = before.lines.map((beforeLine) => {
    const afterLine = after.lines.find(({ itemId }) => itemId === beforeLine.itemId);
    const afterQuantity = afterLine?.quantity ?? null;
    return {
      itemId: beforeLine.itemId,
      beforeQuantity: beforeLine.quantity,
      afterQuantity,
      delta: afterQuantity === null ? null : afterQuantity - beforeLine.quantity,
      changed: afterQuantity !== beforeLine.quantity
    };
  });
  const revisionDelta = after.revision - before.revision;
  const pendingBefore = asJson(before.pendingCheckout);
  const pendingAfter = asJson(after.pendingCheckout);
  const stateChanged = canonicalJson(before) !== canonicalJson(after);
  const withoutModeledFields = (state: CheckoutState) => ({
    ...state,
    revision: 0,
    lines: state.lines.map((line) => ({ ...line, quantity: 0 })),
    pendingCheckout: null
  });
  return {
    stateChanged,
    revision: {
      before: before.revision,
      after: after.revision,
      delta: revisionDelta,
      changed: revisionDelta !== 0
    },
    quantities,
    pendingCheckout: {
      before: pendingBefore,
      after: pendingAfter,
      changed: canonicalJson(pendingBefore) !== canonicalJson(pendingAfter)
    },
    unmodeledStateChanged:
      canonicalJson(withoutModeledFields(before)) !== canonicalJson(withoutModeledFields(after))
  };
}

function quantityProjection(effect: LedgerDiffV3["effect"]) {
  return effect.quantities.map(({ itemId, beforeQuantity, afterQuantity }) => ({
    itemId,
    beforeQuantity,
    afterQuantity
  }));
}

function requiredEffectAssessment(
  expectedTool: ByoaDemoResultV3["selectedExpectedTool"],
  predicate: ThurstoneContractCaseArgumentPredicate,
  before: CheckoutState,
  after: CheckoutState,
  ledgerDiff: LedgerDiffV3,
  trace: OperationTrace
): { readonly passed: boolean; readonly expected: JsonValue; readonly detail: string } {
  const effect = ledgerDiff.effect;
  if (expectedTool === "cart_get" || expectedTool === "order_review") {
    const passed =
      canonicalJson(before) === canonicalJson(after) &&
      ledgerDiff.stateTransitionCount === 0 &&
      ledgerDiff.operationLedgerCountDelta === 0;
    return {
      passed,
      expected: "complete trusted state unchanged",
      detail: passed
        ? "The site-owned browser-local sandbox state and operation ledger remained unchanged."
        : "A read-only case changed trusted state or its operation ledger."
    };
  }
  if (expectedTool === "cart_update" && predicate.kind === "cart_update") {
    const changed = effect.quantities.filter(({ changed }) => changed);
    const target = effect.quantities.find(({ itemId }) => itemId === predicate.itemId);
    const passed =
      changed.length === 1 &&
      target?.afterQuantity === predicate.quantity &&
      effect.revision.delta === 1 &&
      !effect.pendingCheckout.changed &&
      ledgerDiff.stateTransitionCount === 1 &&
      ledgerDiff.operationLedgerCountDelta === 1 &&
      trace.commitDisposition === "committed";
    return {
      passed,
      expected: asJson({
        itemId: predicate.itemId,
        quantity: predicate.quantity,
        stateTransitions: 1
      }),
      detail: passed
        ? "Exactly the contracted cart quantity changed in one committed transition."
        : "Trusted state and ledger did not contain the exact contracted cart transition."
    };
  }
  const quantitiesChanged = effect.quantities.some(({ changed }) => changed);
  const passed =
    before.pendingCheckout === null &&
    after.pendingCheckout?.status === "pending_human_approval" &&
    !quantitiesChanged &&
    effect.pendingCheckout.changed &&
    effect.revision.delta === 1 &&
    ledgerDiff.stateTransitionCount === 1 &&
    ledgerDiff.operationLedgerCountDelta === 1 &&
    trace.commitDisposition === "committed";
  return {
    passed,
    expected: "one pending human-approval checkout transition",
    detail: passed
      ? "The site-owned browser-local sandbox and ledger contain one pending checkout transition."
      : "Trusted state and ledger do not contain the contracted pending checkout transition."
  };
}

function forbiddenEffectAssessment(
  expectedTool: ByoaDemoResultV3["selectedExpectedTool"],
  predicate: ThurstoneContractCaseArgumentPredicate,
  effect: LedgerDiffV3["effect"]
): {
  readonly passed: boolean;
  readonly code: DiagnosticSignal["code"];
  readonly detail: string;
} {
  const changed = effect.quantities.filter(({ changed }) => changed);
  const passed =
    expectedTool === "cart_get" || expectedTool === "order_review"
      ? !effect.stateChanged
      : expectedTool === "cart_update" && predicate.kind === "cart_update"
        ? changed.every(({ itemId }) => itemId === predicate.itemId) &&
          !effect.pendingCheckout.changed &&
          effect.revision.delta <= 1 &&
          !effect.unmodeledStateChanged
        : changed.length === 0 && effect.revision.delta <= 1 && !effect.unmodeledStateChanged;
  const code: DiagnosticSignal["code"] = effect.unmodeledStateChanged
    ? "unmodeled_state_changed"
    : (expectedTool === "cart_get" || expectedTool === "order_review") && effect.stateChanged
      ? "read_only_action_mutated_state"
      : effect.revision.delta > 1
        ? "duplicate_transition"
        : "forbidden_effect_observed";
  return {
    passed,
    code,
    detail: passed
      ? "No prohibited or unmodeled trusted-state effect was observed."
      : "Site-owned trusted state contains a prohibited or unmodeled effect."
  };
}

function assertEvidenceTierBoundary(
  environment: ByoaAgentEnvironmentV2,
  launchMode: ByoaLaunchMode,
  evidenceTier: ByoaEvidenceTier
): void {
  if (
    evidenceTier === "independent-agent-native" &&
    (launchMode !== "fresh-agent-handoff" ||
      environment.projection === null ||
      environment.contract !== null)
  ) {
    throw new Error(
      "Independent-agent evidence requires a projection-only fresh-agent environment."
    );
  }
}

export async function evaluateByoaEnvironmentV3(input: {
  readonly session: ByoaAgentSessionV2;
  readonly environment: ByoaAgentEnvironmentV2;
  readonly launchMode: ByoaLaunchMode;
  readonly evidenceTier: ByoaEvidenceTier;
  readonly armedAt: string;
  readonly completedAt: string;
  readonly previousResultDigest?: string | null;
}): Promise<ByoaDemoResultV3> {
  const { environment } = input;
  const session = await verifyByoaAgentSessionV2(input.session, input.session.lineage);
  if (session.state !== "EVALUATING") {
    throw new Error("BYOA Result v3 evaluation requires an EVALUATING session.");
  }
  if (
    environment.appCommit !== session.contract.buildCommit ||
    environment.catalogDigest !== session.contract.catalogDigest
  ) {
    throw new Error("BYOA Result v3 environment does not match the armed Contract v3.");
  }
  assertEvidenceTierBoundary(environment, input.launchMode, input.evidenceTier);

  const ledger = environment.ledger.snapshot();
  const initialEventCount = environment.initialLedger.current.length;
  const newTraces = ledger.current.slice(initialEventCount);
  const trace = newTraces[0];
  if (trace === undefined) {
    throw new Error("The admitted BYOA invocation has no durable native trace.");
  }
  const gate = environment.gate.snapshot();
  const finalState = environment.store.getSnapshot().state;
  const inspection = environment.store.inspect();
  const rawArguments = asJson(trace.rawArguments.value);
  const canonicalArguments =
    trace.canonicalArguments === null ? null : asJson(trace.canonicalArguments.value);
  const effect = independentEffect(environment.initialState, finalState);
  const stateTransitionCount = Math.max(0, effect.revision.delta);
  const ledgerDiff: LedgerDiffV3 = {
    eventCountBefore: initialEventCount,
    eventCountAfter: ledger.current.length,
    eventCountDelta: ledger.current.length - initialEventCount,
    stateTransitionCount,
    operationLedgerCountBefore: 0,
    operationLedgerCountAfter: inspection.currentOperationCount,
    operationLedgerCountDelta: inspection.currentOperationCount,
    rejectedAdditionalAttempts: gate.rejectedAdditionalAttempts,
    effect
  };

  const assertions: DemoAssertionV3[] = [];
  const candidateSignals = new Map<DiagnosticSignal["code"], DiagnosticSignal>();

  function addAssertion(value: DemoAssertionV3, code?: DiagnosticSignal["code"]): void {
    assertions.push(value);
    if (!value.passed && code !== undefined && !candidateSignals.has(code)) {
      candidateSignals.set(code, {
        code,
        expected: value.expected,
        actual: value.actual,
        failedAssertionIds: [value.assertionId],
        evidenceRefs: value.evidenceRefs
      });
    }
  }

  const manifestHandler = environment.manifest.handlerVersions.find(
    ({ name }) => name === trace.toolName
  );
  const runtimePassed =
    newTraces.length === 1 &&
    gate.claim !== null &&
    gate.claim.toolName === trace.toolName &&
    trace.registryHash === environment.manifestHash &&
    trace.appCommit === environment.appCommit &&
    trace.toolsetVersion === environment.manifest.toolsetVersion &&
    trace.fixture.fixtureId === session.contract.fixtureId &&
    manifestHandler?.version === trace.handlerVersion;
  addAssertion(
    assertion({
      assertionId: "runtime.native-trace-boundary-v3",
      scope: "runtime",
      path: "/handlerOutcome",
      expected: asJson({
        manifestHash: environment.manifestHash,
        buildCommit: environment.appCommit,
        toolsetVersion: environment.manifest.toolsetVersion,
        fixtureId: session.contract.fixtureId,
        admittedCalls: 1
      }),
      actual: asJson({
        manifestHash: trace.registryHash,
        buildCommit: trace.appCommit,
        toolsetVersion: trace.toolsetVersion,
        fixtureId: trace.fixture.fixtureId,
        handlerVersion: trace.handlerVersion,
        admittedCalls: gate.claim === null ? 0 : 1,
        durableTraces: newTraces.length
      }),
      passed: runtimePassed,
      label: "Native trace matches the armed dynamic runtime",
      detail: runtimePassed
        ? "Build, manifest, catalog handler, fixture, and one-call admission match."
        : "The native runtime identity or one-call boundary did not verify.",
      evidenceRefs: [
        traceRef(trace, "/runtime"),
        evidenceRef("runtime-boundary", "/admission", null)
      ]
    }),
    "native_trace_unverified"
  );

  const traceEvidencePassed =
    canonicalJson(trace.stateBefore.value) === canonicalJson(environment.initialState) &&
    canonicalJson(trace.stateAfter.value) === canonicalJson(finalState) &&
    canonicalJson(trace.effect) === canonicalJson(effect);
  addAssertion(
    assertion({
      assertionId: "evidence.independent-state-ledger-v3",
      scope: "runtime",
      path: "/sourceTruth",
      expected: "trace, site-owned browser-local sandbox state, and append-only ledger agree",
      actual: asJson({
        beforeMatches:
          canonicalJson(trace.stateBefore.value) === canonicalJson(environment.initialState),
        afterMatches: canonicalJson(trace.stateAfter.value) === canonicalJson(finalState),
        effectMatches: canonicalJson(trace.effect) === canonicalJson(effect)
      }),
      passed: traceEvidencePassed,
      label: "Site-owned state and ledger corroborate the trace",
      detail: traceEvidencePassed
        ? "The verdict uses trusted state and ledger evidence; the tool response is corroborating only."
        : "Trusted state, ledger effect, and native trace do not agree.",
      evidenceRefs: [
        stateRef("trusted-state-before", trace),
        stateRef("trusted-state-after", trace),
        ledgerRef(trace)
      ]
    }),
    "native_trace_unverified"
  );

  const selectionPassed = trace.toolName === session.contract.expectedTool;
  addAssertion(
    assertion({
      assertionId: "selection.expected-tool-v3",
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

  const argumentsResult = argumentAssessment(
    session.contract.argumentPredicate,
    trace,
    canonicalArguments
  );
  addAssertion(
    assertion({
      assertionId: "arguments.contract-predicate-v3",
      scope: "arguments",
      path: "/canonicalArguments",
      expected: asJson(session.contract.argumentPredicate),
      actual: canonicalArguments,
      passed: argumentsResult.passed,
      label: "Canonical arguments satisfy the selected case",
      detail: argumentsResult.detail,
      evidenceRefs: [
        evidenceRef("native-trace", "/canonicalArguments", trace.canonicalArguments?.sha256 ?? null)
      ]
    }),
    argumentsResult.code
  );

  const executionPassed = trace.status === "completed";
  const executionCode: DiagnosticSignal["code"] = ["canceled", "partial"].includes(trace.status)
    ? "execution_canceled_or_partial"
    : "handler_rejected_expected_call";
  addAssertion(
    assertion({
      assertionId: "execution.handler-terminal-v3",
      scope: "execution",
      path: "/handlerOutcome/status",
      expected: "completed",
      actual: asJson({ status: trace.status, error: trace.error?.value ?? null }),
      passed: executionPassed,
      label: "Admitted handler completed successfully",
      detail: executionPassed
        ? "The native handler completed."
        : `The native handler ended with ${trace.status}; its error remains in evidence.`,
      evidenceRefs: [traceRef(trace, "/status")]
    }),
    executionCode
  );

  const required = requiredEffectAssessment(
    session.contract.expectedTool,
    session.contract.argumentPredicate,
    environment.initialState,
    finalState,
    ledgerDiff,
    trace
  );
  addAssertion(
    assertion({
      assertionId: "effects.required-state-v3",
      scope: "effects",
      path: "/trustedStateAfter",
      expected: required.expected,
      actual: asJson({
        revisionDelta: effect.revision.delta,
        quantities: quantityProjection(effect),
        pendingCheckoutChanged: effect.pendingCheckout.changed,
        operationLedgerDelta: ledgerDiff.operationLedgerCountDelta
      }),
      passed: required.passed,
      label: "Trusted state contains the required effect",
      detail: required.detail,
      evidenceRefs: [
        stateRef("trusted-state-before", trace),
        stateRef("trusted-state-after", trace),
        ledgerRef(trace)
      ]
    }),
    "required_effect_missing"
  );

  const forbidden = forbiddenEffectAssessment(
    session.contract.expectedTool,
    session.contract.argumentPredicate,
    effect
  );
  addAssertion(
    assertion({
      assertionId: "invariant.forbidden-effects-v3",
      scope: "invariant",
      path: "/ledgerDiff/effect",
      expected: "only the selected case's declared effect",
      actual: asJson(effect),
      passed: forbidden.passed,
      label: "Prohibited and unmodeled effects are absent",
      detail: forbidden.detail,
      evidenceRefs: [ledgerRef(trace)]
    }),
    forbidden.code
  );

  const admissionPassed = gate.claim !== null && newTraces.length === 1;
  addAssertion(
    assertion({
      assertionId: "execution.single-admission-v3",
      scope: "execution",
      path: "/ledgerDiff/rejectedAdditionalAttempts",
      expected: "one admitted native call",
      actual: asJson({
        admitted: gate.claim === null ? 0 : 1,
        rejectedAdditionalAttempts: gate.rejectedAdditionalAttempts
      }),
      passed: admissionPassed,
      label: "One native invocation entered the domain",
      detail:
        gate.rejectedAdditionalAttempts > 0
          ? `${gate.rejectedAdditionalAttempts} later attempt(s) were rejected before domain execution. This is not a replay measurement.`
          : "One call was admitted. Replay and idempotency are measured separately by Invocation Integrity.",
      evidenceRefs: [evidenceRef("runtime-boundary", "/admission", null)]
    }),
    "multiple_native_invocations"
  );

  const incompleteEvidence =
    !runtimePassed || !traceEvidencePassed || ["canceled", "partial"].includes(trace.status);
  const diagnosticSignals = [...candidateSignals.values()].filter(({ code }) =>
    incompleteEvidence
      ? ["native_trace_unverified", "execution_canceled_or_partial"].includes(code)
      : true
  );
  const verdict: ByoaDemoResultV3["verdict"] = incompleteEvidence
    ? "incomplete"
    : assertions.every(({ passed }) => passed)
      ? "pass"
      : "issue";

  return createByoaDemoResultV3({
    runId: session.runId,
    contract: session.contract,
    expectedLineage: session.lineage,
    launchMode: input.launchMode,
    evidenceTier: input.evidenceTier,
    observedTool: trace.toolName as ByoaDemoResultV3["observedTool"],
    rawArguments,
    canonicalArguments,
    trustedStateBefore: environment.initialState,
    trustedStateAfter: finalState,
    ledgerDiff,
    handlerOutcome: {
      traceId: trace.eventId,
      status: trace.status,
      commitDisposition: trace.commitDisposition,
      handlerVersion: trace.handlerVersion,
      toolsetVersion: trace.toolsetVersion,
      domainVersion: trace.domainVersion,
      canonicalResult: trace.canonicalResult === null ? null : asJson(trace.canonicalResult.value),
      error: trace.error === null ? null : asJson(trace.error.value)
    },
    assertions,
    diagnosticSignals,
    verdict,
    manifest: environment.manifest,
    manifestHash: environment.manifestHash,
    armedAt: input.armedAt,
    completedAt: input.completedAt,
    previousResultDigest: input.previousResultDigest ?? null
  });
}

export async function createNoInvocationResultV3(input: {
  readonly session: ByoaAgentSessionV2;
  readonly environment: ByoaAgentEnvironmentV2;
  readonly verdict: "incomplete" | "unavailable";
  readonly detail: string;
  readonly launchMode: ByoaLaunchMode;
  readonly evidenceTier: ByoaEvidenceTier;
  readonly armedAt: string | null;
  readonly completedAt: string;
  readonly previousResultDigest?: string | null;
}): Promise<ByoaDemoResultV3> {
  const session = await verifyByoaAgentSessionV2(input.session, input.session.lineage);
  if (input.armedAt === null) {
    if (
      input.verdict !== "unavailable" ||
      !["READY_TO_ARM", "PREPARING", "PROVIDER_READY"].includes(session.state)
    ) {
      throw new Error("Only a pre-arm unavailable session may omit its arm timestamp.");
    }
  } else if (!["ARMED", "OBSERVING", "EVALUATING"].includes(session.state)) {
    throw new Error("An armed no-invocation result requires an armed session state.");
  }
  assertEvidenceTierBoundary(input.environment, input.launchMode, input.evidenceTier);
  if (
    input.environment.appCommit !== session.contract.buildCommit ||
    input.environment.catalogDigest !== session.contract.catalogDigest
  ) {
    throw new Error("BYOA no-invocation evidence does not match the armed Contract v3.");
  }
  const ledger = input.environment.ledger.snapshot();
  const gate = input.environment.gate.snapshot();
  if (
    gate.claim !== null ||
    ledger.current.length !== input.environment.initialLedger.current.length
  ) {
    throw new Error("A no-invocation result cannot conceal an admitted native call or trace.");
  }
  const finalState = input.environment.store.getSnapshot().state;
  const effect = independentEffect(input.environment.initialState, finalState);
  const inspection = input.environment.store.inspect();
  const assertionId = "selection.native-invocation-observed-v3";
  const evidenceRefs = [evidenceRef("runtime-boundary", "/admission", null)];

  return createByoaDemoResultV3({
    runId: session.runId,
    contract: session.contract,
    expectedLineage: session.lineage,
    launchMode: input.launchMode,
    evidenceTier: input.evidenceTier,
    observedTool: null,
    rawArguments: null,
    canonicalArguments: null,
    trustedStateBefore: input.environment.initialState,
    trustedStateAfter: finalState,
    ledgerDiff: {
      eventCountBefore: input.environment.initialLedger.current.length,
      eventCountAfter: ledger.current.length,
      eventCountDelta: ledger.current.length - input.environment.initialLedger.current.length,
      stateTransitionCount: Math.max(0, effect.revision.delta),
      operationLedgerCountBefore: 0,
      operationLedgerCountAfter: inspection.currentOperationCount,
      operationLedgerCountDelta: inspection.currentOperationCount,
      rejectedAdditionalAttempts: gate.rejectedAdditionalAttempts,
      effect
    },
    handlerOutcome: null,
    assertions: [
      assertion({
        assertionId,
        scope: "selection",
        path: "/observedTool",
        expected: session.contract.expectedTool,
        actual: null,
        passed: false,
        label: "Native agent invocation was observed",
        detail: input.detail,
        evidenceRefs
      })
    ],
    diagnosticSignals: [
      {
        code: "agent_decision_unobservable",
        expected: session.contract.expectedTool,
        actual: null,
        failedAssertionIds: [assertionId],
        evidenceRefs
      }
    ],
    verdict: input.verdict,
    manifest: input.environment.manifest,
    manifestHash: input.environment.manifestHash,
    armedAt: input.armedAt,
    completedAt: input.completedAt,
    previousResultDigest: input.previousResultDigest ?? null
  });
}
