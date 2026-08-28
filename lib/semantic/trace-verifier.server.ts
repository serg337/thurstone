import "server-only";

import { createHash } from "node:crypto";

import {
  CHECKOUT_CURRENCY,
  CHECKOUT_FIXTURE_ID,
  CHECKOUT_FIXTURE_SEED,
  CHECKOUT_FIXTURE_VERSION,
  type CheckoutState
} from "@/lib/domain/checkout";
import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  OPERATION_TRACE_VERSION,
  checkoutEffectDiff,
  type CanonicalEvidence,
  type OperationTrace
} from "@/lib/evidence/operation-trace";
import { PROBE_PRODUCTION_ORIGIN } from "@/lib/probe/policy";

export const SEMANTIC_TRACE_VERIFIER_VERSION = "toolproof-semantic-trace-verifier@1.0.0";

export interface SemanticTraceVerification {
  readonly status: "verified";
  readonly verifierVersion: typeof SEMANTIC_TRACE_VERIFIER_VERSION;
  readonly traceHash: string;
}

export class SemanticTraceVerificationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SemanticTraceVerificationError";
  }
}

function objectValue(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SemanticTraceVerificationError(code);
  }
  return value as Record<string, unknown>;
}

function verifyCanonicalEvidence(value: unknown, code: string): CanonicalEvidence {
  const evidence = objectValue(value, code);
  if (
    typeof evidence.bytes !== "string" ||
    typeof evidence.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(evidence.sha256) ||
    canonicalJson(evidence.value) !== evidence.bytes ||
    createHash("sha256").update(evidence.bytes).digest("hex") !== evidence.sha256
  ) {
    throw new SemanticTraceVerificationError(code);
  }
  return evidence as unknown as CanonicalEvidence;
}

function checkoutState(value: unknown): CheckoutState {
  const state = objectValue(value, "trace_state_invalid");
  if (
    state.fixtureId !== CHECKOUT_FIXTURE_ID ||
    state.fixtureVersion !== CHECKOUT_FIXTURE_VERSION ||
    state.seed !== CHECKOUT_FIXTURE_SEED ||
    state.currency !== CHECKOUT_CURRENCY ||
    !Number.isSafeInteger(state.revision) ||
    Number(state.revision) < 0 ||
    !Array.isArray(state.lines) ||
    state.lines.length !== 2 ||
    !state.fulfillment ||
    typeof state.fulfillment !== "object"
  ) {
    throw new SemanticTraceVerificationError("trace_state_invalid");
  }
  return JSON.parse(canonicalJson(state)) as CheckoutState;
}

function optionalEvidence(value: unknown, code: string): CanonicalEvidence | null {
  return value === null ? null : verifyCanonicalEvidence(value, code);
}

export async function verifySemanticOperationTrace(value: unknown): Promise<{
  readonly trace: OperationTrace;
  readonly verification: SemanticTraceVerification;
}> {
  const trace = objectValue(value, "trace_invalid");
  const fixture = objectValue(trace.fixture, "trace_fixture_invalid");
  const runtime = objectValue(trace.runtime, "trace_runtime_invalid");
  if (
    trace.traceVersion !== OPERATION_TRACE_VERSION ||
    typeof trace.eventId !== "string" ||
    typeof trace.sessionId !== "string" ||
    typeof trace.runId !== "string" ||
    !Number.isSafeInteger(trace.sequence) ||
    Number(trace.sequence) < 1 ||
    trace.source !== "native" ||
    typeof trace.toolName !== "string" ||
    typeof trace.observedAt !== "string" ||
    typeof trace.registryHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(trace.registryHash) ||
    typeof trace.handlerVersion !== "string" ||
    typeof trace.domainVersion !== "string" ||
    typeof trace.toolsetVersion !== "string" ||
    typeof trace.appCommit !== "string" ||
    !/^[a-f0-9]{40}$/u.test(trace.appCommit) ||
    fixture.fixtureId !== CHECKOUT_FIXTURE_ID ||
    fixture.fixtureVersion !== CHECKOUT_FIXTURE_VERSION ||
    fixture.fixtureSeed !== CHECKOUT_FIXTURE_SEED ||
    runtime.executionPath !== "native-webmcp" ||
    runtime.origin !== PROBE_PRODUCTION_ORIGIN ||
    typeof runtime.userAgent !== "string" ||
    runtime.userAgent.length < 1 ||
    (runtime.argumentMode !== "object" && runtime.argumentMode !== "json-string") ||
    ![
      "completed",
      "validation_error",
      "expected_error",
      "unexpected_error",
      "duplicate",
      "canceled",
      "partial"
    ].includes(String(trace.status)) ||
    !["none", "committed", "replayed", "partial"].includes(String(trace.commitDisposition)) ||
    typeof trace.cancellationObservedAfterCommit !== "boolean" ||
    typeof trace.cancellationObservedAfterCompletion !== "boolean"
  ) {
    throw new SemanticTraceVerificationError("trace_identity_invalid");
  }
  const rawArguments = verifyCanonicalEvidence(trace.rawArguments, "trace_arguments_invalid");
  const canonicalArguments = optionalEvidence(trace.canonicalArguments, "trace_arguments_invalid");
  const rawResult = optionalEvidence(trace.rawResult, "trace_result_invalid");
  const canonicalResult = optionalEvidence(trace.canonicalResult, "trace_result_invalid");
  const error = optionalEvidence(trace.error, "trace_error_invalid");
  const stateBeforeEvidence = verifyCanonicalEvidence(trace.stateBefore, "trace_state_invalid");
  const stateAfterEvidence = verifyCanonicalEvidence(trace.stateAfter, "trace_state_invalid");
  const stateBefore = checkoutState(stateBeforeEvidence.value);
  const stateAfter = checkoutState(stateAfterEvidence.value);
  if (
    canonicalJson(trace.effect) !== canonicalJson(checkoutEffectDiff(stateBefore, stateAfter)) ||
    (canonicalArguments !== null && rawArguments.bytes !== canonicalArguments.bytes) ||
    (canonicalArguments !== null && rawArguments.sha256 !== canonicalArguments.sha256) ||
    (rawResult !== null && canonicalResult !== null && rawResult.bytes !== canonicalResult.bytes) ||
    (rawResult !== null &&
      canonicalResult !== null &&
      rawResult.sha256 !== canonicalResult.sha256) ||
    (trace.status === "completed" && error !== null && error.value !== null)
  ) {
    throw new SemanticTraceVerificationError("trace_semantics_invalid");
  }
  const verified = JSON.parse(canonicalJson(trace)) as OperationTrace;
  return Object.freeze({
    trace: verified,
    verification: Object.freeze({
      status: "verified" as const,
      verifierVersion: SEMANTIC_TRACE_VERIFIER_VERSION,
      traceHash: await canonicalSha256(verified)
    })
  });
}
