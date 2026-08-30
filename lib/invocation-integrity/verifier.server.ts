import "server-only";

import {
  CHECKOUT_DOMAIN_VERSION,
  cartGet,
  createCheckoutFixture,
  type CheckoutState,
  type MutationResult
} from "@/lib/domain/checkout";
import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import { checkoutEffectDiff, type CanonicalEvidence } from "@/lib/evidence/operation-trace";
import {
  INVOCATION_INTEGRITY_AMENDMENT_COMMIT,
  INVOCATION_INTEGRITY_AMENDMENT_PATH,
  INVOCATION_INTEGRITY_AMENDMENT_SHA256,
  INVOCATION_INTEGRITY_BROWSER_EVIDENCE_BOUNDARY,
  INVOCATION_INTEGRITY_CASES,
  INVOCATION_INTEGRITY_FINAL_STATE_SHA256,
  INVOCATION_INTEGRITY_FAILURE_RECEIPT_VERSION,
  INVOCATION_INTEGRITY_INITIAL_CATALOG,
  INVOCATION_INTEGRITY_INITIAL_STATE_SHA256,
  INVOCATION_INTEGRITY_OBJECT_CALIBRATION_RAW_ARGUMENTS,
  INVOCATION_INTEGRITY_PENDING_CATALOG,
  INVOCATION_INTEGRITY_RECEIPT_VERSION,
  invocationIntegrityAssertionIds,
  projectInvocationIntegrityDescriptors,
  type InvocationIntegrityAssertion,
  type InvocationIntegrityCaseId,
  type InvocationIntegrityFailureInput,
  type InvocationIntegrityFailurePreflight,
  type InvocationIntegrityFailureReceipt,
  type InvocationIntegrityFailureRuntimeBoundary,
  type InvocationIntegrityMeasuredPreflight,
  type InvocationIntegrityObservedCall,
  type InvocationIntegrityReceipt,
  type InvocationIntegrityResultRow,
  type InvocationIntegrityStateEvidence,
  type InvocationIntegrityTranscript
} from "@/lib/invocation-integrity/contract";
import {
  runSourceFixedInvocationIntegritySequence,
  type TrustedInvocationObservation
} from "@/lib/invocation-integrity/trusted-ledger.server";
import { PROBE_PRODUCTION_ORIGIN } from "@/lib/probe/policy";
import { CART_UPDATE_HANDLER_VERSION } from "@/lib/webmcp/cart-update-tool";
import { CART_GET_HANDLER_VERSION } from "@/lib/webmcp/cart-get-tool";
import { CHECKOUT_TOOLSET_VERSION, checkoutToolContractSnapshot } from "@/lib/webmcp/catalog";
import { CHECKOUT_REQUEST_HANDLER_VERSION } from "@/lib/webmcp/checkout-request-tool";
import { FIXTURE_RESET_HANDLER_VERSION } from "@/lib/evidence/checkout-trace-ledger";
import { createCheckoutLiveManifest } from "@/lib/webmcp/live-manifest.server";

const TRACE_ROOT_KEYS = [
  "appCommit",
  "cancellationObservedAfterCommit",
  "cancellationObservedAfterCompletion",
  "canonicalArguments",
  "canonicalResult",
  "commitDisposition",
  "domainVersion",
  "effect",
  "error",
  "eventId",
  "fixture",
  "handlerVersion",
  "observedAt",
  "operationId",
  "parentEventId",
  "rawArguments",
  "rawResult",
  "registryHash",
  "runId",
  "runtime",
  "sequence",
  "sessionId",
  "source",
  "stateAfter",
  "stateBefore",
  "status",
  "toolName",
  "toolsetVersion",
  "traceVersion"
] as const;
const NATIVE_RECEIPT_KEYS = [
  "argumentMode",
  "canonicalResult",
  "effectDigest",
  "executionId",
  "handlerTraceId",
  "handlerTraceStatus",
  "manifestHash",
  "nativeCallCount",
  "rawResult",
  "resultDigest",
  "stateAfterDigest",
  "stateBeforeDigest",
  "toolName"
] as const;
const STATE_ROOT_KEYS = [
  "currency",
  "fixtureId",
  "fixtureVersion",
  "fulfillment",
  "lines",
  "pendingCheckout",
  "revision",
  "seed"
] as const;
const STATE_LINE_KEYS = ["itemId", "name", "quantity", "unitPriceCents"] as const;
const STATE_FULFILLMENT_KEYS = [
  "deliveryNotice",
  "deliveryWindow",
  "shippingCents",
  "shippingLabel",
  "shippingMethod"
] as const;
const STATE_PENDING_KEYS = [
  "cartSnapshotHash",
  "orderTotalCents",
  "pendingId",
  "requestOperationId",
  "requestedFromRevision",
  "status"
] as const;

export class InvocationIntegrityVerificationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "InvocationIntegrityVerificationError";
  }
}

function fail(code: string): never {
  throw new InvocationIntegrityVerificationError(code);
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function exactKeys(value: unknown, expected: readonly string[], code: string): void {
  const actual = Object.keys(record(value, code)).sort();
  if (canonicalJson(actual) !== canonicalJson([...expected].sort())) fail(code);
}

function canonicalEqual(actual: unknown, expected: unknown, code: string): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) fail(code);
}

function nonEmptyString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) fail(code);
  return value;
}

function exactIsoTimestamp(value: unknown, code: string): string {
  const timestamp = nonEmptyString(value, code);
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== timestamp) fail(code);
  return timestamp;
}

function stateKeysets(state: CheckoutState): InvocationIntegrityStateEvidence["keysets"] {
  exactKeys(state, STATE_ROOT_KEYS, "invocation_integrity_state_root_keyset_mismatch");
  if (!Array.isArray(state.lines) || state.lines.length !== 2) {
    fail("invocation_integrity_state_line_cardinality_mismatch");
  }
  for (const line of state.lines) {
    exactKeys(line, STATE_LINE_KEYS, "invocation_integrity_state_line_keyset_mismatch");
  }
  exactKeys(
    state.fulfillment,
    STATE_FULFILLMENT_KEYS,
    "invocation_integrity_state_fulfillment_keyset_mismatch"
  );
  if (state.pendingCheckout !== null) {
    exactKeys(
      state.pendingCheckout,
      STATE_PENDING_KEYS,
      "invocation_integrity_state_pending_keyset_mismatch"
    );
  }
  return Object.freeze({
    root: STATE_ROOT_KEYS,
    line: STATE_LINE_KEYS,
    fulfillment: STATE_FULFILLMENT_KEYS,
    pendingCheckout: state.pendingCheckout === null ? Object.freeze([]) : STATE_PENDING_KEYS
  });
}

async function stateEvidence(state: CheckoutState): Promise<InvocationIntegrityStateEvidence> {
  return Object.freeze({
    value: state,
    sha256: await canonicalSha256(state),
    keysets: stateKeysets(state)
  });
}

async function verifyCanonicalEvidence(
  value: unknown,
  expected: unknown,
  code: string
): Promise<CanonicalEvidence> {
  exactKeys(value, ["bytes", "sha256", "value"], code);
  const evidence = value as unknown as CanonicalEvidence;
  const bytes = canonicalJson(evidence.value);
  if (
    evidence.bytes !== bytes ||
    evidence.sha256 !== (await sha256Hex(bytes)) ||
    canonicalJson(evidence.value) !== canonicalJson(expected)
  ) {
    fail(code);
  }
  return evidence;
}

function expectedHandlerVersion(toolName: string): string {
  if (toolName === "cart_update") return CART_UPDATE_HANDLER_VERSION;
  if (toolName === "checkout_request") return CHECKOUT_REQUEST_HANDLER_VERSION;
  return fail("invocation_integrity_tool_not_source_fixed");
}

function expectedDescriptorProjection(
  state: Pick<CheckoutState, "pendingCheckout">,
  origin: string
) {
  return projectInvocationIntegrityDescriptors(
    checkoutToolContractSnapshot(state).manifest.map((tool) => ({ ...tool, origin }))
  );
}

async function verifyMeasuredPreflight(input: {
  readonly runtime:
    InvocationIntegrityTranscript["runtime"] | InvocationIntegrityFailureRuntimeBoundary;
  readonly preflight: InvocationIntegrityMeasuredPreflight | InvocationIntegrityFailurePreflight;
  readonly buildSha: string;
  readonly pendingState: CheckoutState;
  readonly pendingRequired: boolean;
}): Promise<void> {
  const initialState = createCheckoutFixture();
  const initialDescriptors = expectedDescriptorProjection(initialState, input.runtime.origin);
  const pendingDescriptors = expectedDescriptorProjection(input.pendingState, input.runtime.origin);
  if (
    canonicalJson(input.preflight.initialDescriptors) !== canonicalJson(initialDescriptors) ||
    (input.preflight.pendingDescriptors === null
      ? input.pendingRequired
      : canonicalJson(input.preflight.pendingDescriptors) !== canonicalJson(pendingDescriptors))
  ) {
    fail("invocation_integrity_preflight_descriptor_mismatch");
  }

  const compatibility = input.preflight.compatibility;
  const compatibilityTrace = compatibility.trace;
  const expectedCart = cartGet(initialState);
  const expectedResultDigest = await canonicalSha256(expectedCart);
  const expectedEffect = checkoutEffectDiff(initialState, initialState);
  const expectedEffectDigest = await canonicalSha256(expectedEffect);
  const expectedRawArguments =
    input.runtime.argumentMode === "object"
      ? INVOCATION_INTEGRITY_OBJECT_CALIBRATION_RAW_ARGUMENTS
      : {};
  let rawCompatibilityResult: unknown;
  try {
    rawCompatibilityResult = JSON.parse(compatibility.receipt.rawResult) as unknown;
  } catch {
    fail("invocation_integrity_preflight_compatibility_result_invalid");
  }
  if (
    compatibility.receipt.argumentMode !== input.runtime.argumentMode ||
    compatibility.receipt.coercionCount !==
      (input.runtime.argumentMode === "json-string" ? 1 : 0) ||
    compatibility.receipt.registrationGeneration < 1 ||
    compatibility.receipt.handlerTraceId !== compatibilityTrace.eventId ||
    compatibility.receipt.resultDigest !== expectedResultDigest ||
    compatibility.receipt.effectDigest !== expectedEffectDigest ||
    compatibility.receipt.stateBeforeDigest !== INVOCATION_INTEGRITY_INITIAL_STATE_SHA256 ||
    compatibility.receipt.stateAfterDigest !== INVOCATION_INTEGRITY_INITIAL_STATE_SHA256 ||
    compatibility.receipt.manifestHashBefore !== input.runtime.initialManifestHash ||
    compatibility.receipt.manifestHashAfter !== input.runtime.initialManifestHash ||
    canonicalJson(rawCompatibilityResult) !== canonicalJson(expectedCart) ||
    canonicalJson(compatibility.receipt.canonicalResult) !== canonicalJson(expectedCart) ||
    compatibilityTrace.source !== "native" ||
    compatibilityTrace.toolName !== "cart_get" ||
    compatibilityTrace.operationId !== null ||
    compatibilityTrace.sequence !== 1 ||
    compatibilityTrace.parentEventId !== null ||
    compatibilityTrace.registryHash !== input.runtime.initialManifestHash ||
    compatibilityTrace.handlerVersion !== CART_GET_HANDLER_VERSION ||
    compatibilityTrace.domainVersion !== CHECKOUT_DOMAIN_VERSION ||
    compatibilityTrace.toolsetVersion !== CHECKOUT_TOOLSET_VERSION ||
    compatibilityTrace.appCommit !== input.buildSha ||
    compatibilityTrace.status !== "completed" ||
    compatibilityTrace.commitDisposition !== "none" ||
    compatibilityTrace.runtime.executionPath !== "native-webmcp" ||
    compatibilityTrace.runtime.origin !== input.runtime.origin ||
    compatibilityTrace.runtime.userAgent !== input.runtime.userAgent ||
    compatibilityTrace.runtime.argumentMode !== "unverified" ||
    compatibilityTrace.cancellationObservedAfterCommit ||
    compatibilityTrace.cancellationObservedAfterCompletion
  ) {
    fail("invocation_integrity_preflight_compatibility_binding_mismatch");
  }
  await verifyCanonicalEvidence(
    compatibilityTrace.rawArguments,
    expectedRawArguments,
    "invocation_integrity_preflight_compatibility_arguments_mismatch"
  );
  await verifyCanonicalEvidence(
    compatibilityTrace.canonicalArguments,
    {},
    "invocation_integrity_preflight_compatibility_arguments_mismatch"
  );
  await verifyCanonicalEvidence(
    compatibilityTrace.rawResult,
    expectedCart,
    "invocation_integrity_preflight_compatibility_result_mismatch"
  );
  await verifyCanonicalEvidence(
    compatibilityTrace.canonicalResult,
    expectedCart,
    "invocation_integrity_preflight_compatibility_result_mismatch"
  );
  await verifyCanonicalEvidence(
    compatibilityTrace.stateBefore,
    initialState,
    "invocation_integrity_preflight_compatibility_state_mismatch"
  );
  await verifyCanonicalEvidence(
    compatibilityTrace.stateAfter,
    initialState,
    "invocation_integrity_preflight_compatibility_state_mismatch"
  );
  await verifyCanonicalEvidence(
    compatibilityTrace.error,
    null,
    "invocation_integrity_preflight_compatibility_error_mismatch"
  );
  canonicalEqual(
    compatibilityTrace.effect,
    expectedEffect,
    "invocation_integrity_preflight_compatibility_effect_mismatch"
  );

  const domainReset = input.preflight.reset.domainReceipt;
  const verifiedReset = input.preflight.reset.verifiedReceipt;
  const resetTrace = input.preflight.reset.trace;
  const resetCoreHash = await canonicalSha256(domainReset.core);
  if (
    domainReset.coreHash !== resetCoreHash ||
    domainReset.resetEventId !== resetTrace.eventId ||
    domainReset.sessionId !== compatibilityTrace.sessionId ||
    domainReset.sessionId !== resetTrace.sessionId ||
    domainReset.archivedTrajectoryId !== compatibilityTrace.runId ||
    domainReset.trajectoryId !== resetTrace.runId ||
    domainReset.archivedEventCount !== 1 ||
    domainReset.retainedTombstoneCount !== 0 ||
    verifiedReset.resetId !== domainReset.resetId ||
    verifiedReset.registryHash !== input.runtime.initialManifestHash ||
    resetTrace.source !== "ui" ||
    resetTrace.toolName !== "fixture_reset" ||
    resetTrace.operationId !== null ||
    resetTrace.sequence !== 2 ||
    resetTrace.parentEventId !== compatibilityTrace.eventId ||
    resetTrace.registryHash !== input.runtime.initialManifestHash ||
    resetTrace.handlerVersion !== FIXTURE_RESET_HANDLER_VERSION ||
    resetTrace.domainVersion !== CHECKOUT_DOMAIN_VERSION ||
    resetTrace.toolsetVersion !== CHECKOUT_TOOLSET_VERSION ||
    resetTrace.appCommit !== input.buildSha ||
    resetTrace.status !== "completed" ||
    resetTrace.commitDisposition !== "committed" ||
    resetTrace.runtime.executionPath !== "ui" ||
    resetTrace.runtime.origin !== input.runtime.origin ||
    resetTrace.runtime.userAgent !== input.runtime.userAgent ||
    resetTrace.runtime.argumentMode !== "not-applicable" ||
    resetTrace.cancellationObservedAfterCommit ||
    resetTrace.cancellationObservedAfterCompletion ||
    new Date(resetTrace.observedAt).getTime() < new Date(compatibilityTrace.observedAt).getTime()
  ) {
    fail("invocation_integrity_preflight_reset_binding_mismatch");
  }
  await verifyCanonicalEvidence(
    resetTrace.rawArguments,
    {},
    "invocation_integrity_preflight_reset_arguments_mismatch"
  );
  await verifyCanonicalEvidence(
    resetTrace.canonicalArguments,
    {},
    "invocation_integrity_preflight_reset_arguments_mismatch"
  );
  await verifyCanonicalEvidence(
    resetTrace.rawResult,
    domainReset,
    "invocation_integrity_preflight_reset_result_mismatch"
  );
  await verifyCanonicalEvidence(
    resetTrace.canonicalResult,
    domainReset,
    "invocation_integrity_preflight_reset_result_mismatch"
  );
  await verifyCanonicalEvidence(
    resetTrace.stateBefore,
    initialState,
    "invocation_integrity_preflight_reset_state_mismatch"
  );
  await verifyCanonicalEvidence(
    resetTrace.stateAfter,
    initialState,
    "invocation_integrity_preflight_reset_state_mismatch"
  );
  await verifyCanonicalEvidence(
    resetTrace.error,
    null,
    "invocation_integrity_preflight_reset_error_mismatch"
  );
  canonicalEqual(
    resetTrace.effect,
    expectedEffect,
    "invocation_integrity_preflight_reset_effect_mismatch"
  );

  const boundary = input.preflight.postReset;
  if (
    input.preflight.caseTraceOffset !== 2 ||
    boundary.inspection.sessionId !== domainReset.sessionId ||
    boundary.inspection.trajectoryId !== domainReset.trajectoryId ||
    boundary.inspection.lastResetTraceEventId !== resetTrace.eventId ||
    boundary.inspection.stateHash !== INVOCATION_INTEGRITY_INITIAL_STATE_SHA256 ||
    (await canonicalSha256(boundary.inspection.state)) !==
      INVOCATION_INTEGRITY_INITIAL_STATE_SHA256 ||
    canonicalJson(boundary.inspection.state) !== canonicalJson(initialState)
  ) {
    fail("invocation_integrity_preflight_zero_boundary_mismatch");
  }
}

async function verifyTrace(input: {
  readonly call: InvocationIntegrityObservedCall;
  readonly trusted: TrustedInvocationObservation;
  readonly runtime: InvocationIntegrityTranscript["runtime"];
  readonly expectedManifestHash: string;
}): Promise<void> {
  const trace = input.call.trace;
  exactKeys(trace, TRACE_ROOT_KEYS, "invocation_integrity_trace_keyset_mismatch");
  if (
    trace.traceVersion !== "operation-trace@1.0.0" ||
    trace.source !== "native" ||
    trace.toolName !== input.trusted.toolName ||
    trace.operationId !== input.trusted.trace.operationId ||
    trace.registryHash !== input.expectedManifestHash ||
    trace.handlerVersion !== expectedHandlerVersion(input.trusted.toolName) ||
    trace.domainVersion !== CHECKOUT_DOMAIN_VERSION ||
    trace.toolsetVersion !== CHECKOUT_TOOLSET_VERSION ||
    trace.appCommit !== input.runtime.appCommit ||
    trace.status !== input.trusted.trace.outcome ||
    trace.commitDisposition !== input.trusted.trace.commitDisposition ||
    trace.cancellationObservedAfterCommit !== false ||
    trace.cancellationObservedAfterCompletion !== false
  ) {
    fail("invocation_integrity_trace_binding_mismatch");
  }
  nonEmptyString(trace.eventId, "invocation_integrity_trace_event_id_invalid");
  nonEmptyString(trace.sessionId, "invocation_integrity_trace_session_id_invalid");
  nonEmptyString(trace.runId, "invocation_integrity_trace_run_id_invalid");
  exactIsoTimestamp(trace.observedAt, "invocation_integrity_trace_timestamp_invalid");
  if (!Number.isSafeInteger(trace.sequence) || trace.sequence < 1) {
    fail("invocation_integrity_trace_sequence_invalid");
  }
  exactKeys(
    trace.fixture,
    ["fixtureId", "fixtureSeed", "fixtureVersion"],
    "invocation_integrity_trace_fixture_keyset_mismatch"
  );
  canonicalEqual(
    trace.fixture,
    {
      fixtureId: "checkout-seed-v1",
      fixtureVersion: "checkout-fixture@1.0.0",
      fixtureSeed: "toolproof-checkout-seed-001"
    },
    "invocation_integrity_trace_fixture_mismatch"
  );
  exactKeys(
    trace.runtime,
    ["argumentMode", "executionPath", "origin", "userAgent"],
    "invocation_integrity_trace_runtime_keyset_mismatch"
  );
  canonicalEqual(
    trace.runtime,
    {
      executionPath: "native-webmcp",
      origin: input.runtime.origin,
      userAgent: input.runtime.userAgent,
      argumentMode: input.runtime.argumentMode
    },
    "invocation_integrity_trace_runtime_mismatch"
  );
  await verifyCanonicalEvidence(
    trace.rawArguments,
    input.trusted.input,
    "invocation_integrity_trace_raw_arguments_mismatch"
  );
  await verifyCanonicalEvidence(
    trace.canonicalArguments,
    input.trusted.trace.canonicalInput,
    "invocation_integrity_trace_canonical_arguments_mismatch"
  );
  await verifyCanonicalEvidence(
    trace.rawResult,
    input.trusted.result,
    "invocation_integrity_trace_raw_result_mismatch"
  );
  await verifyCanonicalEvidence(
    trace.canonicalResult,
    input.trusted.result,
    "invocation_integrity_trace_canonical_result_mismatch"
  );
  await verifyCanonicalEvidence(trace.error, null, "invocation_integrity_trace_error_not_null");
  await verifyCanonicalEvidence(
    trace.stateBefore,
    input.trusted.trace.stateBefore,
    "invocation_integrity_trace_state_before_mismatch"
  );
  await verifyCanonicalEvidence(
    trace.stateAfter,
    input.trusted.trace.stateAfter,
    "invocation_integrity_trace_state_after_mismatch"
  );
  canonicalEqual(
    trace.effect,
    checkoutEffectDiff(input.trusted.trace.stateBefore, input.trusted.trace.stateAfter),
    "invocation_integrity_trace_effect_mismatch"
  );
  stateKeysets(trace.stateBefore.value as unknown as CheckoutState);
  stateKeysets(trace.stateAfter.value as unknown as CheckoutState);
}

async function verifyNativeReceipt(input: {
  readonly call: InvocationIntegrityObservedCall;
  readonly trusted: TrustedInvocationObservation;
  readonly runtime: InvocationIntegrityTranscript["runtime"];
  readonly expectedManifestHash: string;
}): Promise<void> {
  const receipt = input.call.receipt;
  exactKeys(receipt, NATIVE_RECEIPT_KEYS, "invocation_integrity_native_receipt_keyset_mismatch");
  let rawResult: unknown;
  try {
    rawResult = JSON.parse(receipt.rawResult) as unknown;
  } catch {
    fail("invocation_integrity_native_raw_result_invalid");
  }
  const expectedResultDigest = await canonicalSha256(input.trusted.result);
  const expectedEffectDigest = await canonicalSha256(
    checkoutEffectDiff(input.trusted.trace.stateBefore, input.trusted.trace.stateAfter)
  );
  const expectedBeforeDigest = await canonicalSha256(input.trusted.trace.stateBefore);
  const expectedAfterDigest = await canonicalSha256(input.trusted.trace.stateAfter);
  nonEmptyString(receipt.executionId, "invocation_integrity_native_execution_id_invalid");
  if (
    receipt.toolName !== input.trusted.toolName ||
    receipt.argumentMode !== input.runtime.argumentMode ||
    receipt.nativeCallCount !== 1 ||
    receipt.handlerTraceId !== input.call.trace.eventId ||
    receipt.handlerTraceStatus !== input.trusted.trace.outcome ||
    receipt.manifestHash !== input.expectedManifestHash ||
    receipt.resultDigest !== expectedResultDigest ||
    receipt.effectDigest !== expectedEffectDigest ||
    receipt.stateBeforeDigest !== expectedBeforeDigest ||
    receipt.stateAfterDigest !== expectedAfterDigest
  ) {
    fail("invocation_integrity_native_receipt_binding_mismatch");
  }
  canonicalEqual(
    rawResult,
    input.trusted.result,
    "invocation_integrity_native_raw_result_mismatch"
  );
  canonicalEqual(
    receipt.canonicalResult,
    input.trusted.result,
    "invocation_integrity_native_result_mismatch"
  );
}

function resolveExactBuildCommit(
  environment: Readonly<Record<string, string | undefined>>
): string {
  const vercel = environment.VERCEL_GIT_COMMIT_SHA?.trim();
  const configured = environment.TOOLPROOF_COMMIT_SHA?.trim();
  const publicCommit = environment.NEXT_PUBLIC_TOOLPROOF_COMMIT_SHA?.trim();
  const candidates = [vercel, configured, publicCommit].filter(
    (value): value is string => value !== undefined && value.length > 0
  );
  if (candidates.length === 0 || candidates.some((value) => !/^[a-f0-9]{40}$/u.test(value))) {
    fail("invocation_integrity_build_unversioned");
  }
  if (new Set(candidates).size !== 1) fail("invocation_integrity_build_binding_mismatch");
  return candidates[0]!;
}

function rowAssertions(caseId: InvocationIntegrityCaseId): readonly InvocationIntegrityAssertion[] {
  return Object.freeze(
    invocationIntegrityAssertionIds(caseId).map((assertionId) =>
      Object.freeze({ assertionId, passed: true as const })
    )
  );
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export interface VerifyInvocationIntegrityOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly clock?: () => string;
}

export async function verifyInvocationIntegrityTranscript(
  transcript: InvocationIntegrityTranscript,
  options: VerifyInvocationIntegrityOptions = {}
): Promise<InvocationIntegrityReceipt> {
  const buildSha = resolveExactBuildCommit(options.environment ?? process.env);
  if (
    transcript.runtime.origin !== PROBE_PRODUCTION_ORIGIN ||
    transcript.runtime.appCommit !== buildSha ||
    canonicalJson(transcript.runtime.initialCatalog) !==
      canonicalJson(INVOCATION_INTEGRITY_INITIAL_CATALOG) ||
    canonicalJson(transcript.runtime.pendingCatalog) !==
      canonicalJson(INVOCATION_INTEGRITY_PENDING_CATALOG)
  ) {
    fail("invocation_integrity_runtime_boundary_mismatch");
  }

  const trusted = await runSourceFixedInvocationIntegritySequence();
  await verifyMeasuredPreflight({
    runtime: transcript.runtime,
    preflight: transcript.preflight,
    buildSha,
    pendingState: trusted.finalState,
    pendingRequired: true
  });
  const initialManifest = await createCheckoutLiveManifest(createCheckoutFixture(), buildSha);
  const pendingManifest = await createCheckoutLiveManifest(trusted.finalState, buildSha);
  if (
    transcript.runtime.initialManifestHash !== initialManifest.manifestHash ||
    transcript.runtime.pendingManifestHash !== pendingManifest.manifestHash
  ) {
    fail("invocation_integrity_manifest_binding_mismatch");
  }

  const trustedObservations = trusted.cases.flatMap(({ observations }) => observations);
  if (trustedObservations.length !== transcript.calls.length) {
    fail("invocation_integrity_call_cardinality_mismatch");
  }
  const executionIds = new Set<string>();
  for (const [index, call] of transcript.calls.entries()) {
    const trustedObservation = trustedObservations[index];
    if (
      !trustedObservation ||
      call.caseId !== trustedObservation.caseId ||
      call.callIndex !== trustedObservation.callIndex
    ) {
      fail("invocation_integrity_call_order_mismatch");
    }
    const expectedManifestHash =
      index === 3 ? pendingManifest.manifestHash : initialManifest.manifestHash;
    await verifyTrace({
      call,
      trusted: trustedObservation,
      runtime: transcript.runtime,
      expectedManifestHash
    });
    await verifyNativeReceipt({
      call,
      trusted: trustedObservation,
      runtime: transcript.runtime,
      expectedManifestHash
    });
    if (executionIds.has(call.receipt.executionId)) {
      fail("invocation_integrity_duplicate_execution_id");
    }
    executionIds.add(call.receipt.executionId);
    if (index === 0) {
      const resetTrace = transcript.preflight.reset.trace;
      if (
        call.trace.sessionId !== resetTrace.sessionId ||
        call.trace.runId !== resetTrace.runId ||
        call.trace.parentEventId !== resetTrace.eventId ||
        call.trace.sequence !== resetTrace.sequence + 1 ||
        new Date(call.trace.observedAt).getTime() < new Date(resetTrace.observedAt).getTime()
      ) {
        fail("invocation_integrity_preflight_case_trace_handoff_mismatch");
      }
    } else {
      const prior = transcript.calls[index - 1]!.trace;
      if (
        call.trace.sessionId !== prior.sessionId ||
        call.trace.runId !== prior.runId ||
        call.trace.parentEventId !== prior.eventId ||
        call.trace.sequence !== prior.sequence + 1 ||
        new Date(call.trace.observedAt).getTime() < new Date(prior.observedAt).getTime()
      ) {
        fail("invocation_integrity_trace_chain_mismatch");
      }
    }
  }

  const completedAt = exactIsoTimestamp(
    (options.clock ?? (() => new Date().toISOString()))(),
    "invocation_integrity_completion_timestamp_invalid"
  );
  const rows: InvocationIntegrityResultRow[] = [];
  let observationOffset = 0;
  for (const [caseIndex, contractCase] of INVOCATION_INTEGRITY_CASES.entries()) {
    const trustedCase = trusted.cases[caseIndex];
    if (!trustedCase || trustedCase.caseId !== contractCase.caseId) {
      fail("invocation_integrity_trusted_case_binding_mismatch");
    }
    const browserCalls = transcript.calls.slice(
      observationOffset,
      observationOffset + contractCase.invocations.length
    );
    observationOffset += contractCase.invocations.length;
    const stateBefore = await stateEvidence(trustedCase.stateBefore);
    const stateAfter = await stateEvidence(trustedCase.stateAfter);
    const rowCore = deepFreeze({
      caseId: contractCase.caseId,
      title: contractCase.title,
      toolName: contractCase.toolName,
      exactInvocations: contractCase.invocations,
      expectedOutcome: contractCase.expectedResults,
      actualOutcome: trustedCase.observations.map(({ result }) => result as MutationResult),
      trustedStateBefore: stateBefore,
      trustedStateAfter: stateAfter,
      domainOperationLedgerDiff: trustedCase.domainOperationLedgerDiff,
      tombstoneDiff: trustedCase.tombstoneDiff,
      auditTraceDiff: trustedCase.auditTraceDiff,
      subscriberCommitCount: trustedCase.subscriberCommitCount,
      assertions: rowAssertions(contractCase.caseId),
      browserObservationDigests: await Promise.all(
        browserCalls.map((call) => canonicalSha256(call))
      ),
      trustedObservationDigests: trustedCase.observations.map(
        ({ observationDigest }) => observationDigest
      ),
      buildSha,
      timestamp: browserCalls.at(-1)!.trace.observedAt,
      passed: true as const
    });
    rows.push(
      deepFreeze({
        ...rowCore,
        rowDigest: await canonicalSha256(rowCore)
      })
    );
  }

  if (
    rows[0]?.trustedStateBefore.sha256 !== INVOCATION_INTEGRITY_INITIAL_STATE_SHA256 ||
    trusted.finalStateSha256 !== INVOCATION_INTEGRITY_FINAL_STATE_SHA256 ||
    rows.length !== 3 ||
    trusted.totalSubscriberCommitCount !== 1
  ) {
    fail("invocation_integrity_terminal_invariant_mismatch");
  }

  const receiptCore: Omit<InvocationIntegrityReceipt, "receiptDigest"> = deepFreeze({
    receiptVersion: INVOCATION_INTEGRITY_RECEIPT_VERSION,
    status: "verified" as const,
    amendment: {
      path: INVOCATION_INTEGRITY_AMENDMENT_PATH,
      commit: INVOCATION_INTEGRITY_AMENDMENT_COMMIT,
      sha256: INVOCATION_INTEGRITY_AMENDMENT_SHA256
    },
    buildSha,
    initialManifestHash: initialManifest.manifestHash,
    pendingManifestHash: pendingManifest.manifestHash,
    trustedStateSource: "source-fixed-server-replay" as const,
    browserEvidenceBoundary: INVOCATION_INTEGRITY_BROWSER_EVIDENCE_BOUNDARY,
    measuredTranscript: transcript,
    measuredTranscriptDigest: await canonicalSha256(transcript),
    modelCallCount: 0 as const,
    includedInSemanticDenominator: false as const,
    rows: Object.freeze(rows),
    score: { earned: 3 as const, possible: 3 as const, label: "3/3" as const },
    finalStateSha256: INVOCATION_INTEGRITY_FINAL_STATE_SHA256,
    completedAt
  });
  return deepFreeze({
    ...receiptCore,
    receiptDigest: await canonicalSha256(receiptCore)
  });
}

export async function createInvocationIntegrityFailureReceipt(
  input: InvocationIntegrityFailureInput,
  options: VerifyInvocationIntegrityOptions = {}
): Promise<InvocationIntegrityFailureReceipt> {
  const buildSha = resolveExactBuildCommit(options.environment ?? process.env);
  const pendingBoundaryPresent =
    input.runtime.pendingCatalog !== null || input.runtime.pendingManifestHash !== null;
  if (
    input.runtime.origin !== PROBE_PRODUCTION_ORIGIN ||
    input.runtime.appCommit !== buildSha ||
    canonicalJson(input.runtime.initialCatalog) !==
      canonicalJson(INVOCATION_INTEGRITY_INITIAL_CATALOG) ||
    (pendingBoundaryPresent &&
      (canonicalJson(input.runtime.pendingCatalog) !==
        canonicalJson(INVOCATION_INTEGRITY_PENDING_CATALOG) ||
        input.runtime.pendingManifestHash === null)) ||
    (input.runtime.pendingCatalog === null) !== (input.runtime.pendingManifestHash === null) ||
    (input.preflight.pendingDescriptors === null) !== (input.runtime.pendingManifestHash === null)
  ) {
    fail("invocation_integrity_failure_runtime_boundary_mismatch");
  }
  const trusted = await runSourceFixedInvocationIntegritySequence();
  const initialManifest = await createCheckoutLiveManifest(createCheckoutFixture(), buildSha);
  const pendingManifest = await createCheckoutLiveManifest(trusted.finalState, buildSha);
  if (
    input.runtime.initialManifestHash !== initialManifest.manifestHash ||
    (input.runtime.pendingManifestHash !== null &&
      input.runtime.pendingManifestHash !== pendingManifest.manifestHash)
  ) {
    fail("invocation_integrity_failure_manifest_binding_mismatch");
  }
  await verifyMeasuredPreflight({
    runtime: input.runtime,
    preflight: input.preflight,
    buildSha,
    pendingState: trusted.finalState,
    pendingRequired: false
  });

  const trustedObservations = trusted.cases.flatMap(({ observations }) => observations);
  for (const [index, call] of input.completedCalls.entries()) {
    const trustedObservation = trustedObservations[index];
    if (
      !trustedObservation ||
      call.caseId !== trustedObservation.caseId ||
      call.callIndex !== trustedObservation.callIndex
    ) {
      fail("invocation_integrity_failure_call_prefix_mismatch");
    }
    const expectedManifestHash =
      index === 3 ? pendingManifest.manifestHash : initialManifest.manifestHash;
    const verificationRuntime: InvocationIntegrityTranscript["runtime"] = {
      ...input.runtime,
      pendingCatalog: INVOCATION_INTEGRITY_PENDING_CATALOG,
      pendingManifestHash: pendingManifest.manifestHash
    };
    await verifyTrace({
      call,
      trusted: trustedObservation,
      runtime: verificationRuntime,
      expectedManifestHash
    });
    await verifyNativeReceipt({
      call,
      trusted: trustedObservation,
      runtime: verificationRuntime,
      expectedManifestHash
    });
    const priorTrace =
      index === 0 ? input.preflight.reset.trace : input.completedCalls[index - 1]!.trace;
    if (
      call.trace.parentEventId !== priorTrace.eventId ||
      call.trace.sequence !== priorTrace.sequence + 1 ||
      call.trace.sessionId !== priorTrace.sessionId ||
      call.trace.runId !== input.preflight.reset.trace.runId
    ) {
      fail("invocation_integrity_failure_trace_chain_mismatch");
    }
  }
  if (
    (input.completedCalls.length === 4 && input.error.stage !== "verification") ||
    input.terminalInspection.sessionId !== input.preflight.reset.trace.sessionId ||
    input.terminalInspection.trajectoryId !== input.preflight.reset.trace.runId ||
    input.terminalInspection.stateHash !==
      (await canonicalSha256(input.terminalInspection.state)) ||
    input.terminalInspection.stateRevision !== input.terminalInspection.state.revision ||
    input.terminalInspection.totalTraceCount !==
      input.preflight.caseTraceOffset + input.terminalInspection.currentTraceCount ||
    input.terminalInspection.currentTraceCount < input.completedCalls.length ||
    (input.terminalInspection.currentTraceCount === 0) !==
      (input.terminalInspection.lastTraceEventId === null)
  ) {
    fail("invocation_integrity_failure_terminal_boundary_mismatch");
  }
  const earned = input.completedCalls.length === 0 ? 0 : input.completedCalls.length === 1 ? 1 : 2;
  const score = Object.freeze({
    earned: earned as 0 | 1 | 2,
    possible: 3 as const,
    label: `${earned}/3` as "0/3" | "1/3" | "2/3"
  });
  const receiptCore: Omit<InvocationIntegrityFailureReceipt, "receiptDigest"> = deepFreeze({
    receiptVersion: INVOCATION_INTEGRITY_FAILURE_RECEIPT_VERSION,
    status: "failed",
    buildSha,
    origin: input.runtime.origin,
    browserEvidenceBoundary: INVOCATION_INTEGRITY_BROWSER_EVIDENCE_BOUNDARY,
    runtime: input.runtime,
    preflight: input.preflight,
    preflightDigest: await canonicalSha256(input.preflight),
    completedCalls: input.completedCalls,
    completedCallsDigest: await canonicalSha256(input.completedCalls),
    error: input.error,
    terminalInspection: input.terminalInspection,
    terminalInspectionDigest: await canonicalSha256(input.terminalInspection),
    score,
    claimPosition: "forbidden",
    claimAllowed: false,
    modelCallCount: 0,
    includedInSemanticDenominator: false,
    failedAt: input.failedAt
  });
  return deepFreeze({
    ...receiptCore,
    receiptDigest: await canonicalSha256(receiptCore)
  });
}
