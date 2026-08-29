import {
  buildGate6EvidencePackage,
  computeGate6Metrics,
  createGate6EvidenceExports,
  type Gate6TraceRecord
} from "@/lib/results/evidence-package";
import { describe, expect, it } from "vitest";

function records(version: "baseline" | "revised"): Gate6TraceRecord[] {
  return Array.from({ length: 24 }, (_, index) => {
    const equivalent = index < 8;
    const boundaryIndex = index - 8;
    const pair = Math.floor(boundaryIndex / 2);
    const subset = index % 12 < 6 ? "development" : "builder-blinded-holdout";
    const clarification = !equivalent && [0, 4, 8, 12].includes(boundaryIndex);
    const readOnly = !clarification && [0, 1, 4, 5, 6, 7].includes(index);
    const failed = index === 20;
    const expectedKind = clarification ? "clarify" : "call";
    return {
      version,
      ordinal: index,
      caseId: `case-${index}`,
      runnerCaseId: `case_${String(index).padStart(22, "0")}`,
      subset,
      family: equivalent ? "equivalent" : `boundary-${pair}`,
      relationship: equivalent
        ? { kind: "equivalent_realization", id: `equivalent-${Math.floor(index / 2)}`, side: null }
        : { kind: "matched_boundary", id: `pair-${pair}`, side: index % 2 ? "contrast" : "anchor" },
      request: `Synthetic request ${index}`,
      expectedAction: clarification
        ? "clarify"
        : readOnly
          ? "call:order_review"
          : "call:cart_update",
      observedAction: failed
        ? "no_action"
        : clarification
          ? "clarify"
          : readOnly
            ? "call:order_review"
            : "call:cart_update",
      observedSignature: failed
        ? "no_action"
        : clarification
          ? "clarify"
          : `call:${readOnly ? "order_review" : "cart_update"}:${index % 2}`,
      expectedKind,
      expectedTool: expectedKind === "call" ? (readOnly ? "order_review" : "cart_update") : null,
      passed: !failed,
      score: failed ? 0 : 1,
      failureCodes: failed ? ["decision_action_class"] : [],
      errorClass: failed ? "semantic-action" : "none",
      argumentPassed: true,
      effectPassed: true,
      consequentialOverAction: false,
      clarification: {
        expected: clarification,
        observed: clarification && !failed,
        text: clarification && !failed ? "Which item should change?" : null
      },
      liveCatalog: {
        manifestHash: "a".repeat(64),
        toolNames: ["cart_update"],
        registrationGeneration: 1
      },
      model: {
        provider: "OpenAI",
        model: "gpt-5.6-terra",
        decision: null,
        refusal: null,
        decisionError: null,
        promptHash: "b".repeat(64),
        settingsHash: "c".repeat(64),
        rawResponseHash: `${index.toString(16).padStart(2, "0")}${"d".repeat(62)}`,
        dispatchedAt: "2026-08-29T00:00:00.000Z",
        completedAt: "2026-08-29T00:00:01.000Z",
        durationMs: 1
      },
      execution: {
        canonicalArguments: null,
        nativeResult: null,
        stateBefore: {},
        stateAfter: {},
        effect: { stateChanged: false },
        traceEventId: null,
        traceStatus: null
      },
      runtime: {
        browserVersion: "Chrome/151.0.0.0",
        chromeForTesting: "151.0.0.0",
        runtimeContractHash: "e".repeat(64),
        adapterVersion: "adapter@1",
        origin: "https://example.test",
        argumentMode: null
      },
      hashes: {
        rowDigest: "f".repeat(64),
        envelopeHash: "1".repeat(64),
        captureDigest: "2".repeat(64),
        providerReceiptHash: "3".repeat(64),
        traceArgumentsHash: null,
        traceResultHash: null,
        stateBeforeHash: null,
        stateAfterHash: null
      }
    };
  });
}

describe("Gate 6 evidence package", () => {
  it("keeps every required metric separate with exact denominators and deterministic exports", async () => {
    const baseline = records("baseline");
    const metrics = Object.fromEntries(
      computeGate6Metrics(baseline).map((metric) => [metric.id, metric.overall])
    );
    expect(metrics).toEqual({
      "equivalence-consistency": { numerator: 8, denominator: 8 },
      "boundary-sensitivity": { numerator: 7, denominator: 8 },
      "tool-action-accuracy": { numerator: 23, denominator: 24 },
      "argument-fidelity": { numerator: 20, denominator: 20 },
      "effect-fidelity": { numerator: 24, denominator: 24 },
      "over-action-rate": { numerator: 0, denominator: 10 },
      "clarification-quality": { numerator: 3, denominator: 4 }
    });
    const evidence = await buildGate6EvidencePackage({
      evidenceLabel: "authentic Custom Probe reference · one-trial demonstration snapshot",
      repetitionCount: 1,
      infrastructure: {
        baseline: {
          logicalCases: 24,
          attempts: 24,
          scoredOutcomes: 24,
          transportFailures: 0,
          retries: 0,
          incomplete: 0,
          indeterminate: 0
        },
        revised: {
          logicalCases: 24,
          attempts: 24,
          scoredOutcomes: 24,
          transportFailures: 0,
          retries: 0,
          incomplete: 0,
          indeterminate: 0
        }
      },
      contractDiff: {
        changedField: "checkout_request.description",
        path: "lib/webmcp/checkout-request-tool.ts",
        oldDescription: "Old description long enough for a deterministic synthetic fixture.",
        newDescription: "New description long enough for a deterministic synthetic fixture.",
        sourceDiffProofHash: "4".repeat(64),
        revisionFreezeHash: "5".repeat(64),
        hunkCount: 1,
        removedLineCount: 1,
        addedLineCount: 1
      },
      provenance: {
        baselineRunId: `run_${"a".repeat(22)}`,
        baselineEvidenceDigest: "6".repeat(64),
        baselineAppCommit: "7".repeat(40),
        revisedRunId: `run_${"b".repeat(22)}`,
        revisedEvidenceDigest: "8".repeat(64),
        revisedAppCommit: "9".repeat(40),
        reviewPackageHash: "a".repeat(64),
        gate3FrozenProtocolHash: "b".repeat(64),
        revisionFreezeHash: "c".repeat(64),
        provider: "OpenAI",
        model: "gpt-5.6-terra",
        baselineManifestHash: "d".repeat(64),
        revisedManifestHash: "e".repeat(64),
        fixtureId: "checkout-seed-v1",
        fixtureVersion: "checkout-fixture@1.0.0",
        evaluatorVersion: "evaluator@1",
        runnerHash: "f".repeat(64),
        promptHash: "1".repeat(64),
        settingsHash: "2".repeat(64),
        retryPolicyHash: "3".repeat(64),
        baselineStartedAt: "2026-08-29T00:00:00.000Z",
        baselineCompletedAt: "2026-08-29T00:01:00.000Z",
        revisedStartedAt: "2026-08-29T00:02:00.000Z",
        revisedCompletedAt: "2026-08-29T00:03:00.000Z",
        measuredV2Commit: "4".repeat(40),
        postEvidenceTestCommit: "5".repeat(40),
        testOnlyProjectionHash: "6".repeat(64),
        targetOrigin: "https://example.test"
      },
      namespaces: [
        { id: "custom-probe", status: "complete", includedInPrimaryDenominator: true },
        { id: "direct-chatgpt", status: "pending", includedInPrimaryDenominator: false }
      ],
      limitations: ["One trial per case."],
      records: [...baseline, ...records("revised")]
    });
    expect(evidence.summary).toMatchObject({
      baselinePassed: 23,
      revisedPassed: 23,
      noMeasuredImprovement: true
    });
    const first = await createGate6EvidenceExports(evidence);
    const second = await createGate6EvidenceExports(evidence);
    expect(second).toEqual(first);
    expect(first.json).toContain(evidence.packageDigest);
    expect(first.markdown).toContain("23/24 → 23/24; no measured improvement");
  });
});
