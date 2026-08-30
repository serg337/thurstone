import "server-only";

import type { CheckoutState, MutationResult } from "@/lib/domain/checkout";
import {
  CheckoutSessionStore,
  type CheckoutSessionIdKind,
  type CheckoutSessionTraceEvent
} from "@/lib/domain/checkout-session";
import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  INVOCATION_INTEGRITY_CASES,
  INVOCATION_INTEGRITY_EXPECTED_RESULTS,
  INVOCATION_INTEGRITY_FINAL_STATE_SHA256,
  INVOCATION_INTEGRITY_FROZEN_CALLS,
  INVOCATION_INTEGRITY_INITIAL_STATE_SHA256,
  INVOCATION_INTEGRITY_PAYLOADS,
  type InvocationIntegrityCaseId,
  type InvocationIntegrityLedgerDiff
} from "@/lib/invocation-integrity/contract";

interface TrustedBoundary {
  readonly state: CheckoutState;
  readonly stateSha256: string;
  readonly operationLedgerCount: number;
  readonly tombstoneCount: number;
  readonly auditTraceCount: number;
  readonly subscriberCommitCount: number;
}

export interface TrustedInvocationObservation {
  readonly caseId: InvocationIntegrityCaseId;
  readonly callIndex: 1 | 2;
  readonly toolName: "cart_update" | "checkout_request";
  readonly input: Readonly<Record<string, unknown>>;
  readonly result: MutationResult;
  readonly trace: {
    readonly outcome: CheckoutSessionTraceEvent["outcome"];
    readonly commitDisposition: CheckoutSessionTraceEvent["commitDisposition"];
    readonly effectApplied: boolean;
    readonly operationId: string | null;
    readonly rawInput: unknown;
    readonly canonicalInput: unknown | null;
    readonly canonicalCommand: string | null;
    readonly stateBefore: CheckoutState;
    readonly stateAfter: CheckoutState;
  };
  readonly before: TrustedBoundary;
  readonly after: TrustedBoundary;
  readonly observationDigest: string;
}

export interface TrustedInvocationCaseRun {
  readonly caseId: InvocationIntegrityCaseId;
  readonly observations: readonly TrustedInvocationObservation[];
  readonly stateBefore: CheckoutState;
  readonly stateBeforeSha256: string;
  readonly stateAfter: CheckoutState;
  readonly stateAfterSha256: string;
  readonly domainOperationLedgerDiff: InvocationIntegrityLedgerDiff;
  readonly tombstoneDiff: InvocationIntegrityLedgerDiff;
  readonly auditTraceDiff: InvocationIntegrityLedgerDiff;
  readonly subscriberCommitCount: number;
}

export interface TrustedInvocationIntegrityRun {
  readonly cases: readonly TrustedInvocationCaseRun[];
  readonly finalState: CheckoutState;
  readonly finalStateSha256: string;
  readonly totalSubscriberCommitCount: number;
  readonly trustedRunDigest: string;
}

function ledgerDiff(before: number, after: number): InvocationIntegrityLedgerDiff {
  return Object.freeze({ before, after, delta: after - before });
}

function deterministicIdFactory(): (kind: CheckoutSessionIdKind) => string {
  let ordinal = 0;
  return (kind) => `${kind}_invocation_integrity_${String(++ordinal).padStart(4, "0")}`;
}

async function boundary(
  store: CheckoutSessionStore,
  subscriberCommitCount: number
): Promise<TrustedBoundary> {
  const inspection = store.inspect();
  return Object.freeze({
    state: inspection.state,
    stateSha256: await canonicalSha256(inspection.state),
    operationLedgerCount: inspection.currentOperationCount,
    tombstoneCount: inspection.retainedTombstoneCount,
    auditTraceCount: inspection.currentTraceCount,
    subscriberCommitCount
  });
}

async function observationDigest(
  observation: Omit<TrustedInvocationObservation, "observationDigest">
): Promise<string> {
  return canonicalSha256({
    caseId: observation.caseId,
    callIndex: observation.callIndex,
    toolName: observation.toolName,
    input: observation.input,
    result: observation.result,
    trace: observation.trace,
    before: observation.before,
    after: observation.after
  });
}

function requireCanonicalEqual(actual: unknown, expected: unknown, code: string): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(code);
}

/**
 * Executes exactly II-01 → II-02 → II-03 in a fresh server-only store. It accepts no caller
 * payload, expected value, tool name, schema, URL, state, or ledger and performs no persistence.
 */
export async function runSourceFixedInvocationIntegritySequence(): Promise<TrustedInvocationIntegrityRun> {
  const events: CheckoutSessionTraceEvent[] = [];
  let subscriberCommitCount = 0;
  let tick = 0;
  const store = new CheckoutSessionStore({
    clock: () => `2026-08-29T12:00:${String(tick++).padStart(2, "0")}.000Z`,
    idFactory: deterministicIdFactory(),
    traceSink: {
      append: (event) => {
        events.push(event);
      }
    }
  });
  store.subscribe(({ kind }) => {
    if (kind === "mutation") subscriberCommitCount += 1;
  });

  const observations: TrustedInvocationObservation[] = [];
  async function execute(
    caseId: InvocationIntegrityCaseId,
    callIndex: 1 | 2,
    toolName: "cart_update" | "checkout_request",
    input: Readonly<Record<string, unknown>>
  ): Promise<void> {
    const before = await boundary(store, subscriberCommitCount);
    const eventCount = events.length;
    const result =
      toolName === "cart_update"
        ? await store.cartUpdate(input, { source: "native" })
        : await store.checkoutRequest(input, { source: "native" });
    const after = await boundary(store, subscriberCommitCount);
    if (events.length !== eventCount + 1) {
      throw new Error("invocation_integrity_trusted_trace_count_mismatch");
    }
    const event = events[eventCount];
    if (!event || event.toolName !== toolName || event.source !== "native") {
      throw new Error("invocation_integrity_trusted_trace_binding_mismatch");
    }
    const trace = Object.freeze({
      outcome: event.outcome,
      commitDisposition: event.commitDisposition,
      effectApplied: event.effectApplied,
      operationId: event.operationId ?? null,
      rawInput: event.rawInput,
      canonicalInput: event.canonicalInput,
      canonicalCommand: event.canonicalCommand,
      stateBefore: event.stateBefore,
      stateAfter: event.stateAfter
    });
    const core = Object.freeze({
      caseId,
      callIndex,
      toolName,
      input,
      result,
      trace,
      before,
      after
    });
    observations.push(Object.freeze({ ...core, observationDigest: await observationDigest(core) }));
  }

  await execute("II-01", 1, "checkout_request", INVOCATION_INTEGRITY_PAYLOADS["II-01"]);
  await execute("II-02", 1, "cart_update", INVOCATION_INTEGRITY_PAYLOADS["II-02"]);
  await execute("II-03", 1, "checkout_request", INVOCATION_INTEGRITY_PAYLOADS["II-03"]);
  await execute("II-03", 2, "checkout_request", INVOCATION_INTEGRITY_PAYLOADS["II-03"]);

  for (const [index, observation] of observations.entries()) {
    const expected = INVOCATION_INTEGRITY_FROZEN_CALLS[index];
    if (!expected) throw new Error("invocation_integrity_trusted_call_projection_missing");
    requireCanonicalEqual(
      {
        caseId: observation.caseId,
        callIndex: observation.callIndex,
        toolName: observation.toolName,
        input: observation.input,
        result: observation.result,
        trace: {
          status: observation.trace.outcome,
          commitDisposition: observation.trace.commitDisposition,
          effectApplied: observation.trace.effectApplied,
          operationId: observation.trace.operationId,
          canonicalInput: observation.trace.canonicalInput,
          canonicalCommand: observation.trace.canonicalCommand
        },
        before: {
          stateSha256: observation.before.stateSha256,
          operationLedgerCount: observation.before.operationLedgerCount,
          tombstoneCount: observation.before.tombstoneCount,
          auditTraceCount: observation.before.auditTraceCount,
          subscriberCommitCount: observation.before.subscriberCommitCount
        },
        after: {
          stateSha256: observation.after.stateSha256,
          operationLedgerCount: observation.after.operationLedgerCount,
          tombstoneCount: observation.after.tombstoneCount,
          auditTraceCount: observation.after.auditTraceCount,
          subscriberCommitCount: observation.after.subscriberCommitCount
        }
      },
      {
        caseId: expected.caseId,
        callIndex: expected.callIndex,
        toolName: expected.toolName,
        input: expected.payload,
        result: expected.result,
        trace: {
          status: expected.trace.status,
          commitDisposition: expected.trace.commitDisposition,
          effectApplied: expected.trace.effectApplied,
          operationId: expected.trace.operationId,
          canonicalInput: expected.trace.canonicalInput,
          canonicalCommand: expected.trace.canonicalCommand
        },
        before: {
          stateSha256:
            expected.before.state === "initial"
              ? INVOCATION_INTEGRITY_INITIAL_STATE_SHA256
              : INVOCATION_INTEGRITY_FINAL_STATE_SHA256,
          operationLedgerCount: expected.before.operationLedgerCount,
          tombstoneCount: expected.before.tombstoneCount,
          auditTraceCount: expected.before.auditTraceCount,
          subscriberCommitCount: expected.before.subscriberCommitCount
        },
        after: {
          stateSha256:
            expected.after.state === "initial"
              ? INVOCATION_INTEGRITY_INITIAL_STATE_SHA256
              : INVOCATION_INTEGRITY_FINAL_STATE_SHA256,
          operationLedgerCount: expected.after.operationLedgerCount,
          tombstoneCount: expected.after.tombstoneCount,
          auditTraceCount: expected.after.auditTraceCount,
          subscriberCommitCount: expected.after.subscriberCommitCount
        }
      },
      `invocation_integrity_trusted_call_${index + 1}_projection_mismatch`
    );
  }

  const grouped = INVOCATION_INTEGRITY_CASES.map((contractCase) => {
    const caseObservations = observations.filter(({ caseId }) => caseId === contractCase.caseId);
    const first = caseObservations[0];
    const last = caseObservations.at(-1);
    if (!first || !last || caseObservations.length !== contractCase.invocations.length) {
      throw new Error("invocation_integrity_trusted_case_cardinality_mismatch");
    }
    requireCanonicalEqual(
      caseObservations.map(({ result }) => result),
      INVOCATION_INTEGRITY_EXPECTED_RESULTS[contractCase.caseId],
      `invocation_integrity_trusted_${contractCase.caseId.toLowerCase()}_result_mismatch`
    );
    const result: TrustedInvocationCaseRun = Object.freeze({
      caseId: contractCase.caseId,
      observations: Object.freeze(caseObservations),
      stateBefore: first.before.state,
      stateBeforeSha256: first.before.stateSha256,
      stateAfter: last.after.state,
      stateAfterSha256: last.after.stateSha256,
      domainOperationLedgerDiff: ledgerDiff(
        first.before.operationLedgerCount,
        last.after.operationLedgerCount
      ),
      tombstoneDiff: ledgerDiff(first.before.tombstoneCount, last.after.tombstoneCount),
      auditTraceDiff: ledgerDiff(first.before.auditTraceCount, last.after.auditTraceCount),
      subscriberCommitCount: last.after.subscriberCommitCount - first.before.subscriberCommitCount
    });
    requireCanonicalEqual(
      {
        stateBeforeSha256: result.stateBeforeSha256,
        stateAfterSha256: result.stateAfterSha256,
        revisionBefore: result.stateBefore.revision,
        revisionAfter: result.stateAfter.revision,
        operationBefore: result.domainOperationLedgerDiff.before,
        operationAfter: result.domainOperationLedgerDiff.after,
        tombstoneBefore: result.tombstoneDiff.before,
        tombstoneAfter: result.tombstoneDiff.after,
        auditBefore: result.auditTraceDiff.before,
        auditAfter: result.auditTraceDiff.after,
        subscriberCommitCount: result.subscriberCommitCount
      },
      {
        stateBeforeSha256: contractCase.preconditions.stateSha256,
        stateAfterSha256: contractCase.postconditions.stateSha256,
        revisionBefore: contractCase.preconditions.revision,
        revisionAfter: contractCase.postconditions.revision,
        operationBefore: contractCase.preconditions.operationLedgerCount,
        operationAfter: contractCase.postconditions.operationLedgerCount,
        tombstoneBefore: contractCase.preconditions.tombstoneCount,
        tombstoneAfter: contractCase.postconditions.tombstoneCount,
        auditBefore: contractCase.preconditions.auditTraceCount,
        auditAfter: contractCase.postconditions.auditTraceCount,
        subscriberCommitCount: contractCase.postconditions.subscriberCommitCount
      },
      `invocation_integrity_trusted_${contractCase.caseId.toLowerCase()}_boundary_mismatch`
    );
    return result;
  });

  const finalState = store.getSnapshot().state;
  const finalStateSha256 = await canonicalSha256(finalState);
  if (
    observations[0]?.before.stateSha256 !== INVOCATION_INTEGRITY_INITIAL_STATE_SHA256 ||
    finalStateSha256 !== INVOCATION_INTEGRITY_FINAL_STATE_SHA256 ||
    subscriberCommitCount !== 1
  ) {
    throw new Error("invocation_integrity_trusted_terminal_invariant_mismatch");
  }
  const trustedRunCore = Object.freeze({
    cases: Object.freeze(grouped),
    finalState,
    finalStateSha256,
    totalSubscriberCommitCount: subscriberCommitCount
  });
  return Object.freeze({
    ...trustedRunCore,
    trustedRunDigest: await canonicalSha256(trustedRunCore)
  });
}
