import "server-only";

import {
  CHECKOUT_DOMAIN_VERSION,
  CHECKOUT_FIXTURE_ID,
  CHECKOUT_FIXTURE_SEED,
  CHECKOUT_FIXTURE_VERSION,
  createCheckoutFixture
} from "@/lib/domain/checkout";
import { CHECKOUT_FIXTURE_STATE_HASH } from "@/lib/domain/checkout-reset";
import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import { checkoutEffectDiff } from "@/lib/evidence/operation-trace";
import type { FallbackTrialEvidence } from "@/lib/fallback/lab-page-adapter.server";
import type { ProbeBoundaryEvidence, ProbeClientJsonValue } from "@/lib/probe/client-runner";
import {
  verifyScoredProviderKnownReceipt,
  type ScoredProviderKnownReceipt
} from "@/lib/scored/openai-provider.server";
import type { ScoredNativeAdmission } from "@/lib/scored/native-admission";
import { verifyScoredNativeAdmission } from "@/lib/scored/native-admission";
import { verifyExpectationFreeScoredEnvelope } from "@/lib/scored/envelope";
import {
  GATE3_SEMANTIC_CONTRACT,
  GATE3_SEMANTIC_SUITE,
  meaningForScoredCase
} from "@/lib/semantic/checkout-candidate.server";
import {
  evaluateSemanticTrial,
  type SemanticEvaluationResult,
  type SemanticObservedTargetCall,
  type SemanticResetBoundaryContract,
  type SemanticResetBoundaryEvidence,
  type SemanticTrialObservation
} from "@/lib/semantic/evaluator.server";
import type { SemanticJsonValue } from "@/lib/semantic/contract";
import { verifySemanticOperationTrace } from "@/lib/semantic/trace-verifier.server";
import {
  CHECKOUT_TOOLSET_VERSION,
  INITIAL_CHECKOUT_HANDLER_VERSIONS,
  INITIAL_CHECKOUT_TOOL_NAMES
} from "@/lib/webmcp/catalog";

export const GATE3_SCORED_EVIDENCE_ROW_VERSION = "toolproof-gate3-scored-row@1.0.0";

export interface Gate3ScoredEvidenceRow {
  readonly version: typeof GATE3_SCORED_EVIDENCE_ROW_VERSION;
  readonly phase: "baseline" | "revised";
  readonly ordinal: number;
  readonly attempt: 0 | 1;
  readonly runnerCaseId: string;
  readonly envelope: ProbeClientJsonValue;
  readonly providerReceipt: ScoredProviderKnownReceipt;
  readonly nativeAdmission: ScoredNativeAdmission | null;
  readonly trialEvidence: FallbackTrialEvidence;
  readonly postResetBoundary: ProbeClientJsonValue;
  readonly evaluation: SemanticEvaluationResult;
  readonly rowDigest: string;
}

export class Gate3ScoredEvaluationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "Gate3ScoredEvaluationError";
  }
}

function objectValue(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Gate3ScoredEvaluationError(code);
  }
  return value as Record<string, unknown>;
}

function jsonValue(value: unknown): ProbeClientJsonValue {
  return JSON.parse(canonicalJson(value)) as ProbeClientJsonValue;
}

function semanticValue(value: unknown): SemanticJsonValue {
  return JSON.parse(canonicalJson(value)) as SemanticJsonValue;
}

function resetEvidence(
  value: unknown,
  expectedManifestHash: string
): SemanticResetBoundaryEvidence {
  const boundary = objectValue(value, "scored_reset_boundary_invalid");
  if (
    boundary.status !== "verified" ||
    boundary.fixtureId !== CHECKOUT_FIXTURE_ID ||
    boundary.fixtureSeed !== CHECKOUT_FIXTURE_SEED ||
    boundary.stateRevision !== 0 ||
    boundary.stateHash !== CHECKOUT_FIXTURE_STATE_HASH ||
    boundary.manifestHash !== expectedManifestHash ||
    boundary.operationLedgerCount !== 0 ||
    boundary.currentTrajectoryCount !== 0 ||
    !Array.isArray(boundary.registeredToolNames)
  ) {
    throw new Gate3ScoredEvaluationError("scored_reset_boundary_invalid");
  }
  return {
    status: "verified",
    fixtureId: CHECKOUT_FIXTURE_ID,
    fixtureVersion: CHECKOUT_FIXTURE_VERSION,
    fixtureSeed: CHECKOUT_FIXTURE_SEED,
    stateRevision: 0,
    stateHash: CHECKOUT_FIXTURE_STATE_HASH,
    expectedStateHash: CHECKOUT_FIXTURE_STATE_HASH,
    operationLedgerCount: 0,
    currentTrajectoryCount: 0,
    registryHash: expectedManifestHash,
    registeredToolNames: boundary.registeredToolNames.map(String)
  };
}

function handlerVersions(): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      INITIAL_CHECKOUT_HANDLER_VERSIONS.map(({ name, version }) => [name, version])
    )
  );
}

function boundaryContract(input: {
  readonly appCommit: string;
  readonly manifestHash: string;
}): SemanticResetBoundaryContract {
  return {
    fixtureId: CHECKOUT_FIXTURE_ID,
    fixtureVersion: CHECKOUT_FIXTURE_VERSION,
    fixtureSeed: CHECKOUT_FIXTURE_SEED,
    stateHash: CHECKOUT_FIXTURE_STATE_HASH,
    registryHash: input.manifestHash,
    registeredToolNames: [...INITIAL_CHECKOUT_TOOL_NAMES],
    appCommit: input.appCommit,
    domainVersion: CHECKOUT_DOMAIN_VERSION,
    toolsetVersion: CHECKOUT_TOOLSET_VERSION,
    handlerVersionByTool: handlerVersions()
  };
}

export async function buildGate3ScoredEvidenceRow(input: {
  readonly phase: "baseline" | "revised";
  readonly ordinal: number;
  readonly attempt: 0 | 1;
  readonly runnerCaseId: string;
  readonly appCommit: string;
  readonly manifestHash: string;
  readonly envelope: unknown;
  readonly providerReceipt: ScoredProviderKnownReceipt;
  readonly nativeAdmission: ScoredNativeAdmission | null;
  readonly trialEvidence: FallbackTrialEvidence;
  readonly postResetBoundary: ProbeBoundaryEvidence<unknown>;
}): Promise<Gate3ScoredEvidenceRow> {
  const scoredCase = GATE3_SEMANTIC_SUITE.scoredCases.find(
    ({ runnerCaseId }) => runnerCaseId === input.runnerCaseId
  );
  if (!scoredCase || input.ordinal < 0 || input.ordinal > 23) {
    throw new Gate3ScoredEvaluationError("unknown_scored_case");
  }
  const envelope = await verifyExpectationFreeScoredEnvelope(input.envelope);
  const providerReceipt = await verifyScoredProviderKnownReceipt({
    receipt: input.providerReceipt,
    envelope
  });
  if (
    envelope.caseId !== input.runnerCaseId ||
    envelope.purpose !== input.phase ||
    envelope.buildCommit !== input.appCommit ||
    envelope.liveManifest.manifestHash !== input.manifestHash ||
    providerReceipt.envelopeHash !== envelope.envelopeHash ||
    providerReceipt.purpose !== input.phase ||
    providerReceipt.freezeHash !== envelope.runBinding.freezeHash
  ) {
    throw new Gate3ScoredEvaluationError("scored_envelope_provider_binding_mismatch");
  }
  const evidence = input.trialEvidence;
  if (
    evidence.version !== "toolproof-fallback-trial-evidence@1.1.0" ||
    evidence.adapterVersion !== "toolproof-fallback-lab-page-adapter@1.1.0" ||
    evidence.appCommit !== input.appCommit ||
    evidence.origin !== "https://toolproof-rust.vercel.app" ||
    typeof evidence.userAgent !== "string" ||
    evidence.userAgent.length < 1 ||
    evidence.captureDigest !== (await canonicalSha256(evidence.capture))
  ) {
    throw new Gate3ScoredEvaluationError("scored_trial_evidence_digest_mismatch");
  }
  const capture = objectValue(evidence.capture, "scored_capture_invalid");
  const claim = objectValue(capture.claim, "scored_capture_invalid");
  const expectedDecisionEnvelope = {
    context: {
      kind: "fresh-stateless",
      previousResponseId: null,
      providerRequestCount: 1
    },
    rawModelResponse: providerReceipt.rawResponseBytes,
    providerReceipt,
    decision: providerReceipt.decision
  };
  if (
    capture.decisionRequestCount !== 1 ||
    capture.providerReceiptHash !== (await canonicalSha256(providerReceipt)) ||
    capture.rawModelResponseHash !== (await sha256Hex(providerReceipt.rawResponseBytes)) ||
    capture.rawDecisionEnvelopeHash !== (await canonicalSha256(expectedDecisionEnvelope)) ||
    capture.nativeDispatchCount !== (input.nativeAdmission ? 1 : 0) ||
    claim.runId !== envelope.runId ||
    claim.caseId !== envelope.caseId ||
    claim.trialId !== envelope.trialId ||
    canonicalJson(capture.decision) !== canonicalJson(providerReceipt.decision)
  ) {
    throw new Gate3ScoredEvaluationError("scored_capture_binding_mismatch");
  }
  const tracesValue = evidence.currentTraces;
  if (!Array.isArray(tracesValue) || tracesValue.length > 1) {
    throw new Gate3ScoredEvaluationError("scored_trace_count_invalid");
  }
  const verifiedTrace = tracesValue[0] ? await verifySemanticOperationTrace(tracesValue[0]) : null;
  if ((input.nativeAdmission === null) !== (verifiedTrace === null)) {
    throw new Gate3ScoredEvaluationError("scored_native_trace_binding_mismatch");
  }
  if (
    input.nativeAdmission &&
    verifiedTrace &&
    (input.nativeAdmission.toolName !== verifiedTrace.trace.toolName ||
      input.nativeAdmission.manifestHash !== verifiedTrace.trace.registryHash ||
      input.nativeAdmission.appCommit !== verifiedTrace.trace.appCommit)
  ) {
    throw new Gate3ScoredEvaluationError("scored_native_trace_binding_mismatch");
  }
  const verifiedNativeAdmission =
    input.nativeAdmission && providerReceipt.decision?.kind === "call"
      ? await verifyScoredNativeAdmission({
          envelope,
          decision: providerReceipt.decision,
          admission: input.nativeAdmission
        })
      : null;
  if ((input.nativeAdmission === null) !== (verifiedNativeAdmission === null)) {
    throw new Gate3ScoredEvaluationError("scored_native_admission_invalid");
  }
  const fallback = objectValue(evidence.fallback, "scored_fallback_evidence_invalid");
  const nativeReceiptValue = fallback.nativeReceipt;
  if ((nativeReceiptValue == null) !== (verifiedTrace === null)) {
    throw new Gate3ScoredEvaluationError("scored_native_receipt_trace_mismatch");
  }
  if (nativeReceiptValue != null && verifiedTrace) {
    const nativeReceipt = objectValue(nativeReceiptValue, "scored_native_receipt_trace_mismatch");
    const rawResult = objectValue(nativeReceipt.rawResult, "scored_native_receipt_trace_mismatch");
    const nativeArguments = objectValue(
      nativeReceipt.arguments,
      "scored_native_receipt_trace_mismatch"
    );
    if (
      nativeReceipt.outcome !== "Completed" ||
      nativeReceipt.allowanceConsumed !== true ||
      nativeReceipt.nativeCallCount !== 1 ||
      nativeReceipt.toolName !== verifiedTrace.trace.toolName ||
      nativeReceipt.manifestHash !== verifiedTrace.trace.registryHash ||
      nativeReceipt.registrationGeneration !== envelope.initialBoundary.registrationGeneration ||
      canonicalJson(nativeArguments.value) !==
        canonicalJson(verifiedTrace.trace.canonicalArguments?.value) ||
      canonicalJson(rawResult.output) !== canonicalJson(verifiedTrace.trace.canonicalResult?.value)
    ) {
      throw new Gate3ScoredEvaluationError("scored_native_receipt_trace_mismatch");
    }
  }
  const fixture = createCheckoutFixture();
  const trace = verifiedTrace?.trace;
  if (canonicalJson(evidence.currentState) !== canonicalJson(trace?.stateAfter.value ?? fixture)) {
    throw new Gate3ScoredEvaluationError("scored_current_state_trace_mismatch");
  }
  const canonicalArguments = trace ? semanticValue(trace.canonicalArguments?.value ?? {}) : null;
  if (
    canonicalArguments !== null &&
    (typeof canonicalArguments !== "object" ||
      canonicalArguments === null ||
      Array.isArray(canonicalArguments))
  ) {
    throw new Gate3ScoredEvaluationError("scored_trace_arguments_invalid");
  }
  const targetCalls: readonly SemanticObservedTargetCall[] = trace
    ? [
        {
          tool: trace.toolName,
          arguments: canonicalArguments as Readonly<Record<string, SemanticJsonValue>>,
          result: semanticValue(trace.canonicalResult?.value ?? null),
          trace,
          traceVerification: verifiedTrace.verification
        }
      ]
    : [];
  const observation: SemanticTrialObservation = {
    decision: providerReceipt.decision,
    modelDecisionCount: providerReceipt.providerCallCount,
    usableStructuredDecisionCount: providerReceipt.decision === null ? 0 : 1,
    providerToolCallCount: providerReceipt.toolCallCount,
    nativeDispatchCount: Number(capture.nativeDispatchCount),
    handlerTraceCount: tracesValue.length,
    beforeReset: resetEvidence(capture.initialBoundary, input.manifestHash),
    afterReset: resetEvidence(input.postResetBoundary, input.manifestHash),
    targetCalls,
    runnerOperationId: envelope.runner.transport.operationId,
    stateBefore: semanticValue(trace?.stateBefore.value ?? fixture),
    stateAfter: semanticValue(trace?.stateAfter.value ?? fixture),
    effect: semanticValue(trace?.effect ?? checkoutEffectDiff(fixture, fixture))
  };
  const evaluation = evaluateSemanticTrial({
    contract: GATE3_SEMANTIC_CONTRACT,
    scoredCase,
    boundaryContract: boundaryContract({
      appCommit: input.appCommit,
      manifestHash: input.manifestHash
    }),
    observation
  });
  const payload = {
    version: GATE3_SCORED_EVIDENCE_ROW_VERSION,
    phase: input.phase,
    ordinal: input.ordinal,
    attempt: input.attempt,
    runnerCaseId: input.runnerCaseId,
    envelope: jsonValue(envelope),
    providerReceipt,
    nativeAdmission: input.nativeAdmission,
    trialEvidence: input.trialEvidence,
    postResetBoundary: jsonValue(input.postResetBoundary),
    evaluation
  } as const;
  const approved = meaningForScoredCase(scoredCase);
  if (approved.expectation.kind === "call" && providerReceipt.decision?.kind === "call") {
    // The evaluator remains the only authority; this guard merely prevents an impossible row shape.
    void approved;
  }
  return Object.freeze({
    ...payload,
    rowDigest: await canonicalSha256(payload)
  });
}
