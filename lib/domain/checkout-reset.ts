import type {
  CheckoutResetReceipt as CheckoutDomainResetReceipt,
  CheckoutSessionInspection,
  CheckoutTrajectoryArchive
} from "@/lib/domain/checkout-session";
import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import type { OperationTrace } from "@/lib/evidence/operation-trace";
import { INITIAL_CHECKOUT_TOOL_NAMES } from "@/lib/webmcp/catalog";

export const CHECKOUT_RESET_RECEIPT_VERSION = "checkout-reset@1";
export const CHECKOUT_FIXTURE_STATE_HASH =
  "a9889565b0e5c8a60c7667cab2110f058774e72c1e89c08d1f255124c07ea457";

export interface ResetRegistryObservation {
  readonly verified: boolean;
  readonly registryHash: string;
  readonly registeredToolNames: readonly string[];
}

export interface CheckoutResetVerificationInput {
  readonly domainReceipt: CheckoutDomainResetReceipt;
  readonly inspection: CheckoutSessionInspection;
  readonly archives: readonly CheckoutTrajectoryArchive[];
  readonly traceLedger: {
    readonly current: readonly OperationTrace[];
    readonly archives: readonly {
      readonly trajectoryId: string;
      readonly archivedByResetId: string;
      readonly traces: readonly OperationTrace[];
    }[];
    readonly resetTraces: readonly OperationTrace[];
    readonly lastResetTrace: OperationTrace | null;
  };
  readonly registry: ResetRegistryObservation;
  readonly checkedAt: string;
}

export interface VerifiedCheckoutResetReceipt {
  readonly receiptVersion: typeof CHECKOUT_RESET_RECEIPT_VERSION;
  readonly status: "verified";
  readonly resetId: string;
  readonly fixtureId: "checkout-seed-v1";
  readonly fixtureVersion: "checkout-fixture@1.0.0";
  readonly seed: "toolproof-checkout-seed-001";
  readonly stateRevision: 0;
  readonly stateHash: string;
  readonly expectedStateHash: typeof CHECKOUT_FIXTURE_STATE_HASH;
  readonly registryHash: string;
  readonly registeredToolNames: readonly (typeof INITIAL_CHECKOUT_TOOL_NAMES)[number][];
  readonly operationLedgerCount: 0;
  readonly currentTrajectoryCount: 0;
  readonly checkedAt: string;
}

export interface InvalidCheckoutResetReceipt {
  readonly receiptVersion: typeof CHECKOUT_RESET_RECEIPT_VERSION;
  readonly status: "invalid";
  readonly resetId: string;
  readonly fixtureId: string;
  readonly stateRevision: number;
  readonly stateHash: string;
  readonly expectedStateHash: typeof CHECKOUT_FIXTURE_STATE_HASH;
  readonly registryHash: string;
  readonly registeredToolNames: readonly string[];
  readonly operationLedgerCount: number;
  readonly currentTrajectoryCount: number;
  readonly checkedAt: string;
  readonly errors: readonly string[];
}

export type CheckoutResetReceipt = VerifiedCheckoutResetReceipt | InvalidCheckoutResetReceipt;

function sameNames(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((name, index) => name === expected[index])
  );
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(freezeDeep);
  }
  return value;
}

export async function verifyCheckoutReset(
  input: CheckoutResetVerificationInput
): Promise<CheckoutResetReceipt> {
  const { domainReceipt, inspection, registry } = input;
  const stateHash = await canonicalSha256(inspection.state);
  const domainCoreHash = await canonicalSha256(domainReceipt.core);
  const currentCore = {
    fixtureId: inspection.state.fixtureId,
    fixtureVersion: inspection.state.fixtureVersion,
    fixtureSeed: inspection.state.seed,
    stateRevision: inspection.state.revision,
    stateHash,
    pendingCheckout: inspection.state.pendingCheckout,
    lines: inspection.state.lines.map(({ itemId, quantity }) => ({ itemId, quantity })),
    currentOperationCount: inspection.currentOperationCount
  };
  const registeredToolNames = [...registry.registeredToolNames].sort();
  const expectedToolNames = [...INITIAL_CHECKOUT_TOOL_NAMES];
  const errors: string[] = [];

  if (
    domainReceipt.receiptScope !== "domain_core" ||
    domainReceipt.registryVerification !== "pending"
  ) {
    errors.push("domain_reset_scope_mismatch");
  }
  if (domainReceipt.coreHash !== domainCoreHash) errors.push("domain_core_hash_mismatch");
  if (canonicalJson(domainReceipt.core) !== canonicalJson(currentCore)) {
    errors.push("domain_core_projection_mismatch");
  }
  if (domainReceipt.sessionId !== inspection.sessionId) errors.push("reset_session_mismatch");
  if (domainReceipt.trajectoryId !== inspection.trajectoryId) {
    errors.push("reset_trajectory_mismatch");
  }
  if (inspection.haltedReason !== null) errors.push("reset_session_halted");
  const lastResetTrace = inspection.lastResetTrace;
  if (
    !lastResetTrace ||
    lastResetTrace.eventId !== domainReceipt.resetEventId ||
    lastResetTrace.sessionId !== domainReceipt.sessionId ||
    lastResetTrace.trajectoryId !== domainReceipt.trajectoryId ||
    lastResetTrace.toolName !== "fixture_reset" ||
    lastResetTrace.outcome !== "completed" ||
    lastResetTrace.commitDisposition !== "committed" ||
    lastResetTrace.cancellation !== "none" ||
    lastResetTrace.stateRevisionAfter !== 0 ||
    !lastResetTrace.effectApplied
  ) {
    errors.push("reset_trace_mismatch");
  }
  const latestArchive = input.archives.at(-1);
  if (
    input.archives.length !== inspection.archivedTrajectoryCount ||
    !latestArchive ||
    latestArchive.trajectoryId !== domainReceipt.archivedTrajectoryId ||
    latestArchive.archivedByResetId !== domainReceipt.resetId ||
    latestArchive.archivedAt !== domainReceipt.resetAt ||
    latestArchive.eventCount !== domainReceipt.archivedEventCount ||
    latestArchive.entries.length !== domainReceipt.archivedEventCount
  ) {
    errors.push("reset_archive_mismatch");
  }
  const fullResetTrace = input.traceLedger.lastResetTrace;
  const fullArchive = input.traceLedger.archives.at(-1);
  if (
    input.traceLedger.current.length !== 0 ||
    !fullResetTrace ||
    canonicalJson(input.traceLedger.resetTraces.at(-1)) !== canonicalJson(fullResetTrace) ||
    fullResetTrace.eventId !== domainReceipt.resetEventId ||
    fullResetTrace.sessionId !== domainReceipt.sessionId ||
    fullResetTrace.runId !== domainReceipt.trajectoryId ||
    fullResetTrace.toolName !== "fixture_reset" ||
    fullResetTrace.status !== "completed" ||
    fullResetTrace.commitDisposition !== "committed" ||
    fullResetTrace.cancellationObservedAfterCommit ||
    fullResetTrace.cancellationObservedAfterCompletion ||
    fullResetTrace.stateAfter.sha256 !== stateHash ||
    input.traceLedger.archives.length !== input.archives.length ||
    !fullArchive ||
    fullArchive.trajectoryId !== domainReceipt.archivedTrajectoryId ||
    fullArchive.archivedByResetId !== domainReceipt.resetId ||
    fullArchive.traces.length !== domainReceipt.archivedEventCount ||
    fullArchive.traces.some(
      ({ eventId }, index) => eventId !== latestArchive?.entries[index]?.eventId
    )
  ) {
    errors.push("reset_evidence_mismatch");
  }
  if (domainReceipt.retainedTombstoneCount !== inspection.retainedTombstoneCount) {
    errors.push("retained_tombstone_count_mismatch");
  }
  if (inspection.state.fixtureId !== domainReceipt.core.fixtureId) {
    errors.push("fixture_id_mismatch");
  }
  if (inspection.state.fixtureVersion !== domainReceipt.core.fixtureVersion) {
    errors.push("fixture_version_mismatch");
  }
  if (inspection.state.seed !== domainReceipt.core.fixtureSeed)
    errors.push("fixture_seed_mismatch");
  if (inspection.state.revision !== 0 || domainReceipt.core.stateRevision !== 0) {
    errors.push("state_revision_not_reset");
  }
  if (
    stateHash !== domainReceipt.core.stateHash ||
    stateHash !== CHECKOUT_FIXTURE_STATE_HASH ||
    domainReceipt.core.stateHash !== CHECKOUT_FIXTURE_STATE_HASH
  ) {
    errors.push("fixture_state_hash_mismatch");
  }
  if (inspection.state.pendingCheckout !== null) errors.push("pending_checkout_not_cleared");
  if (inspection.currentOperationCount !== 0) errors.push("operation_ledger_not_empty");
  if (inspection.currentTraceCount !== 0) errors.push("current_trajectory_not_empty");
  if (!registry.verified) errors.push("registry_not_verified");
  if (registry.registryHash.trim().length === 0) errors.push("registry_hash_missing");
  if (!sameNames(registeredToolNames, expectedToolNames)) errors.push("registry_catalog_mismatch");
  if (input.checkedAt.trim().length === 0) errors.push("checked_at_missing");

  if (errors.length > 0) {
    return freezeDeep({
      receiptVersion: CHECKOUT_RESET_RECEIPT_VERSION,
      status: "invalid" as const,
      resetId: domainReceipt.resetId,
      fixtureId: inspection.state.fixtureId,
      stateRevision: inspection.state.revision,
      stateHash,
      expectedStateHash: CHECKOUT_FIXTURE_STATE_HASH,
      registryHash: registry.registryHash,
      registeredToolNames,
      operationLedgerCount: inspection.currentOperationCount,
      currentTrajectoryCount: inspection.currentTraceCount,
      checkedAt: input.checkedAt,
      errors
    });
  }

  return freezeDeep({
    receiptVersion: CHECKOUT_RESET_RECEIPT_VERSION,
    status: "verified" as const,
    resetId: domainReceipt.resetId,
    fixtureId: inspection.state.fixtureId,
    fixtureVersion: inspection.state.fixtureVersion,
    seed: inspection.state.seed,
    stateRevision: 0 as const,
    stateHash,
    expectedStateHash: CHECKOUT_FIXTURE_STATE_HASH,
    registryHash: registry.registryHash,
    registeredToolNames: Object.freeze([...INITIAL_CHECKOUT_TOOL_NAMES]),
    operationLedgerCount: 0 as const,
    currentTrajectoryCount: 0 as const,
    checkedAt: input.checkedAt
  });
}
