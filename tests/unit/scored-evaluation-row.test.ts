import {
  CHECKOUT_FIXTURE_ID,
  CHECKOUT_FIXTURE_SEED,
  createCheckoutFixture,
  orderReview
} from "@/lib/domain/checkout";
import { CHECKOUT_FIXTURE_STATE_HASH } from "@/lib/domain/checkout-reset";
import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { createOperationTrace } from "@/lib/evidence/operation-trace";
import {
  FALLBACK_LAB_PAGE_ADAPTER_VERSION,
  FALLBACK_TRIAL_EVIDENCE_VERSION,
  type FallbackTrialEvidence
} from "@/lib/fallback/lab-page-adapter.server";
import { createProbeFixtureSynopsis } from "@/lib/probe/calibration-envelope";
import { PROBE_MODEL } from "@/lib/probe/policy";
import { createGate3ScoredTrialEnvelope } from "@/lib/scored/case-source.server";
import { createScoredNativeAdmission } from "@/lib/scored/native-admission";
import { decideScoredWithOpenAi } from "@/lib/scored/openai-provider.server";
import { GATE3_SEMANTIC_SUITE } from "@/lib/semantic/checkout-candidate.server";
import { buildGate3ScoredEvidenceRow } from "@/lib/semantic/scored-evaluation.server";
import { createCheckoutLiveManifest } from "@/lib/webmcp/live-manifest.server";
import { describe, expect, it } from "vitest";

const APP_COMMIT = "a".repeat(40);
const FREEZE_HASH = "b".repeat(64);
const RUN_ID = `run_${"r".repeat(22)}`;
const TRIAL_ID = `trial_${"t".repeat(22)}`;

describe("Gate 3 scored row evaluation", () => {
  it("derives a passing review row only from the verified envelope, receipt, trace, state, and reset evidence", async () => {
    const fixture = createCheckoutFixture();
    const manifest = await createCheckoutLiveManifest(fixture, APP_COMMIT);
    const scoredCase = GATE3_SEMANTIC_SUITE.scoredCases.find(
      ({ caseId }) => caseId === "review_dev_01"
    );
    if (!scoredCase) throw new Error("Review candidate missing.");
    const registeredToolNames = ["cart_get", "cart_update", "checkout_request", "order_review"];
    const boundary = {
      status: "verified" as const,
      catalogState: "initial" as const,
      fixtureId: CHECKOUT_FIXTURE_ID,
      fixtureSeed: CHECKOUT_FIXTURE_SEED,
      stateRevision: 0 as const,
      stateHash: CHECKOUT_FIXTURE_STATE_HASH,
      manifestHash: manifest.manifestHash,
      registrationGeneration: 1,
      operationLedgerCount: 0 as const,
      currentTrajectoryCount: 0 as const,
      resetId: "reset_semantic_row_test",
      resetReceipt: { synthetic: true },
      registeredToolNames
    };
    const envelope = await createGate3ScoredTrialEnvelope({
      purpose: "baseline",
      freezeHash: FREEZE_HASH,
      buildCommit: APP_COMMIT,
      runId: RUN_ID,
      runnerCaseId: scoredCase.runnerCaseId,
      trialId: TRIAL_ID,
      liveManifest: manifest,
      initialBoundary: {
        fixtureId: CHECKOUT_FIXTURE_ID,
        fixtureVersion: "checkout-fixture@1.0.0",
        fixtureSeed: CHECKOUT_FIXTURE_SEED,
        stateRevision: 0,
        stateHash: CHECKOUT_FIXTURE_STATE_HASH,
        manifestHash: manifest.manifestHash,
        registrationGeneration: 1,
        operationLedgerCount: 0,
        currentTrajectoryCount: 0,
        registeredToolNames
      }
    });
    const rawProviderResponse = JSON.stringify({
      id: "resp_scored_row_fixture",
      object: "response",
      model: PROBE_MODEL,
      status: "completed",
      output: [
        {
          type: "function_call",
          name: "order_review",
          call_id: "call_scored_row_fixture",
          arguments: "{}"
        }
      ],
      usage: { input_tokens: 80, output_tokens: 20, total_tokens: 100 }
    });
    const providerReceipt = await decideScoredWithOpenAi({
      envelope,
      apiKey: "fixture-key-never-dispatched",
      safetyIdentifier: "5".repeat(64),
      beforeDispatch: async () => undefined,
      fetchImplementation: async () =>
        new Response(rawProviderResponse, {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-length": String(new TextEncoder().encode(rawProviderResponse).byteLength),
            "x-request-id": "req_scored_row_fixture"
          }
        }),
      now: (() => {
        const times = [1_000, 1_010];
        return () => times.shift() ?? 1_010;
      })()
    });
    const trace = await createOperationTrace({
      eventId: "event_scored_review_test",
      sessionId: "session_scored_review_test",
      runId: "trajectory_scored_review_test",
      sequence: 1,
      source: "native",
      toolName: "order_review",
      observedAt: "2026-08-28T21:00:00.000Z",
      registryHash: manifest.manifestHash,
      handlerVersion: "order_review@1.0.0",
      domainVersion: "checkout-domain@1.0.0",
      toolsetVersion: "checkout-toolset-v1@1.0.0",
      appCommit: APP_COMMIT,
      runtime: {
        executionPath: "native-webmcp",
        origin: "https://toolproof-rust.vercel.app",
        userAgent: "Synthetic scored test",
        argumentMode: "json-string"
      },
      status: "completed",
      commitDisposition: "none",
      rawArguments: {},
      canonicalArguments: {},
      rawResult: orderReview(fixture),
      canonicalResult: orderReview(fixture),
      error: null,
      stateBefore: fixture,
      stateAfter: fixture
    });
    const decisionEnvelope = {
      context: {
        kind: "fresh-stateless",
        previousResponseId: null,
        providerRequestCount: 1
      },
      rawModelResponse: providerReceipt.rawResponseBytes,
      providerReceipt,
      decision: providerReceipt.decision
    };
    const capture = {
      runnerVersion: "toolproof-probe-client-runner@2.0.0",
      claim: { runId: RUN_ID, caseId: scoredCase.runnerCaseId, trialId: TRIAL_ID },
      initialBoundary: boundary,
      liveBoundary: boundary,
      decisionRequestCount: 1,
      rawDecisionEnvelopeHash: await canonicalSha256(decisionEnvelope),
      rawModelResponseHash: providerReceipt.rawResponseHash,
      providerReceiptHash: await canonicalSha256(providerReceipt),
      decision: providerReceipt.decision,
      selectedToolName: "order_review",
      rawArguments: {},
      nativeAllowanceConsumed: true,
      nativeDispatchCount: 1,
      executionResult: { outcome: "Completed" },
      terminalStatus: "call_completed",
      errors: { provider: null, decision: null, liveBoundary: null, execution: null },
      timings: {
        startedAtMs: 1,
        initialBoundaryVerifiedAtMs: 2,
        claimIssuedAtMs: 3,
        decisionCompletedAtMs: 4,
        liveReverifiedAtMs: 5,
        nativeCompletedAtMs: 6,
        captureStartedAtMs: 7
      }
    };
    const trialEvidence: FallbackTrialEvidence = {
      version: FALLBACK_TRIAL_EVIDENCE_VERSION,
      adapterVersion: FALLBACK_LAB_PAGE_ADAPTER_VERSION,
      appCommit: APP_COMMIT,
      origin: "https://toolproof-rust.vercel.app",
      userAgent: "Synthetic scored test",
      capturedAt: "2026-08-28T21:00:01.000Z",
      capture,
      currentState: JSON.parse(canonicalJson(fixture)),
      currentInspection: { currentOperationCount: 0 },
      currentTraces: JSON.parse(canonicalJson([trace])),
      fallback: JSON.parse(
        canonicalJson({
          nativeReceipt: {
            version: "toolproof-fallback-native-bridge@1.1.0",
            outcome: "Completed",
            allowanceConsumed: true,
            nativeCallCount: 1,
            toolName: "order_review",
            manifestHash: manifest.manifestHash,
            registrationGeneration: 1,
            arguments: {
              value: {},
              bytes: "{}",
              sha256: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"
            },
            rawResult: { output: orderReview(fixture) }
          }
        })
      ),
      captureDigest: await canonicalSha256(capture)
    };
    const nativeAdmission = await createScoredNativeAdmission({
      envelope,
      decision: providerReceipt.decision!
    });
    const row = await buildGate3ScoredEvidenceRow({
      phase: "baseline",
      ordinal: 0,
      attempt: 0,
      runnerCaseId: scoredCase.runnerCaseId,
      appCommit: APP_COMMIT,
      manifestHash: manifest.manifestHash,
      envelope,
      providerReceipt,
      nativeAdmission,
      trialEvidence,
      postResetBoundary: boundary
    });
    expect(row.evaluation).toMatchObject({
      disposition: "scored",
      expectedActionClass: "call",
      observedActionClass: "call",
      passed: true,
      score: 1,
      failureCodes: []
    });
    expect(row.rowDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(createProbeFixtureSynopsis(fixture).fixtureId).toBe(CHECKOUT_FIXTURE_ID);
  });
});
