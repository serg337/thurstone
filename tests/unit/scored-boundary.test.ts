import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

import { createCheckoutFixture } from "@/lib/domain/checkout";
import { CHECKOUT_FIXTURE_STATE_HASH } from "@/lib/domain/checkout-reset";
import { canonicalJson } from "@/lib/evidence/digest";
import { PROBE_MODEL } from "@/lib/probe/policy";
import {
  createGate3ScoredTrialEnvelope,
  gate3ScoredRunnerCaseIds,
  getGate3ExpectationFreeCase
} from "@/lib/scored/case-source.server";
import {
  createScoredModelInput,
  verifyExpectationFreeScoredEnvelope,
  type ScoredTrialEnvelope
} from "@/lib/scored/envelope";
import {
  createScoredNativeAdmission,
  verifyScoredNativeAdmission
} from "@/lib/scored/native-admission";
import {
  ScoredProviderError,
  decideScoredWithOpenAi,
  verifyScoredProviderKnownReceipt
} from "@/lib/scored/openai-provider.server";
import {
  createScoredToolDecisionRequest,
  parseScoredToolDecisionResponse
} from "@/lib/scored/provider-decision";
import {
  GATE3_SEMANTIC_CONTRACT,
  GATE3_SEMANTIC_SUITE,
  meaningForScoredCase
} from "@/lib/semantic/checkout-candidate.server";
import { INITIAL_CHECKOUT_TOOL_NAMES } from "@/lib/webmcp/catalog";
import { createCheckoutLiveManifest } from "@/lib/webmcp/live-manifest.server";

const APP_COMMIT = "a".repeat(40);
const FREEZE_HASH = "f".repeat(64);
const RUN_ID = `run_${"r".repeat(22)}`;
const TRIAL_ID = `trial_${"t".repeat(22)}`;
const SAFETY_IDENTIFIER = "5".repeat(64);

let liveManifest: Awaited<ReturnType<typeof createCheckoutLiveManifest>>;

beforeAll(async () => {
  liveManifest = await createCheckoutLiveManifest(createCheckoutFixture(), APP_COMMIT);
});

function boundary() {
  return {
    fixtureId: "checkout-seed-v1" as const,
    fixtureVersion: "checkout-fixture@1.0.0" as const,
    fixtureSeed: "toolproof-checkout-seed-001" as const,
    stateRevision: 0 as const,
    stateHash: CHECKOUT_FIXTURE_STATE_HASH,
    manifestHash: liveManifest.manifestHash,
    registrationGeneration: 3,
    operationLedgerCount: 0 as const,
    currentTrajectoryCount: 0 as const,
    registeredToolNames: INITIAL_CHECKOUT_TOOL_NAMES
  } as const;
}

async function envelope(
  runnerCaseId = gate3ScoredRunnerCaseIds()[0]!,
  purpose: "baseline" | "revised" = "baseline"
): Promise<ScoredTrialEnvelope> {
  return createGate3ScoredTrialEnvelope({
    purpose,
    freezeHash: FREEZE_HASH,
    buildCommit: APP_COMMIT,
    runId: RUN_ID,
    runnerCaseId,
    trialId: TRIAL_ID,
    liveManifest,
    initialBoundary: boundary()
  });
}

function providerResponse(output: readonly unknown[]) {
  return {
    id: "resp_scored_fixture_001",
    object: "response",
    model: PROBE_MODEL,
    status: "completed",
    output,
    usage: { input_tokens: 80, output_tokens: 20, total_tokens: 100 }
  };
}

describe("expectation-free scored envelope", () => {
  it("resolves only the exact 24 approved opaque runner IDs and binds both run purposes", async () => {
    const runnerIds = gate3ScoredRunnerCaseIds();
    expect(runnerIds).toHaveLength(24);
    expect(new Set(runnerIds).size).toBe(24);
    expect(runnerIds).toEqual(
      GATE3_SEMANTIC_SUITE.scoredCases.map(({ runnerCaseId }) => runnerCaseId)
    );

    for (const runnerCaseId of runnerIds) {
      const projected = getGate3ExpectationFreeCase(runnerCaseId);
      const source = GATE3_SEMANTIC_SUITE.scoredCases.find(
        (candidate) => candidate.runnerCaseId === runnerCaseId
      )!;
      expect(projected).toEqual({
        version: "toolproof-gate3-expectation-free-case-source@1.0.0",
        runnerCaseId,
        naturalLanguageRequest: source.naturalLanguageRequest,
        fixtureId: "checkout-seed-v1"
      });
    }
    expect(() => getGate3ExpectationFreeCase(`case_${"x".repeat(22)}`)).toThrowError(
      /unknown_scored_runner_case/u
    );

    const baseline = await envelope(runnerIds[0], "baseline");
    const revised = await envelope(runnerIds[0], "revised");
    expect(baseline.targetPhase).toBe("baseline-v1");
    expect(revised.targetPhase).toBe("revised-v2");
    expect(baseline.runBinding).toMatchObject({
      freezeHash: FREEZE_HASH,
      appCommit: APP_COMMIT,
      fixtureHash: CHECKOUT_FIXTURE_STATE_HASH,
      manifestHash: liveManifest.manifestHash,
      boundaryHash: baseline.initialBoundary.boundaryHash
    });
    await expect(verifyExpectationFreeScoredEnvelope(baseline)).resolves.toEqual(baseline);
    await expect(verifyExpectationFreeScoredEnvelope(revised)).resolves.toEqual(revised);
  });

  it("rejects tampering with request, freeze, manifest, boundary, transport, or envelope hashes", async () => {
    const original = await envelope();
    const tampered = [
      { ...original, naturalLanguageRequest: `${original.naturalLanguageRequest} changed` },
      { ...original, runBinding: { ...original.runBinding, freezeHash: "e".repeat(64) } },
      {
        ...original,
        liveManifest: { ...original.liveManifest, manifestHash: "d".repeat(64) }
      },
      {
        ...original,
        initialBoundary: {
          ...original.initialBoundary,
          registrationGeneration: original.initialBoundary.registrationGeneration + 1
        }
      },
      {
        ...original,
        runner: {
          ...original.runner,
          transport: { ...original.runner.transport, bindingHash: "c".repeat(64) }
        }
      },
      { ...original, envelopeHash: "b".repeat(64) }
    ];
    for (const candidate of tampered) {
      await expect(verifyExpectationFreeScoredEnvelope(candidate)).rejects.toThrow();
    }
  });

  it("projects no opaque IDs or integrity metadata into the model input", async () => {
    const current = await envelope();
    const input = createScoredModelInput(current);
    const bytes = canonicalJson(input);
    expect(input).toEqual({
      version: "toolproof-probe-model-input@2.0.0",
      request: current.naturalLanguageRequest,
      fixture: current.fixture,
      tools: current.liveManifest.tools
    });
    for (const secretBoundaryValue of [
      current.runId,
      current.caseId,
      current.trialId,
      current.runBinding.freezeHash,
      current.buildCommit,
      current.envelopeHash,
      current.initialBoundary.boundaryHash
    ]) {
      expect(bytes).not.toContain(secretBoundaryValue);
    }
  });
});

describe("scored provider leakage boundary", () => {
  it("includes only the current one of 24 prompts and never includes semantic truth", async () => {
    const cases = GATE3_SEMANTIC_SUITE.scoredCases;
    const forbiddenTruth = new Set<string>([
      ...GATE3_SEMANTIC_CONTRACT.meanings.flatMap((meaning) => [
        meaning.meaningId,
        meaning.label,
        meaning.approvedMeaning
      ]),
      ...cases.flatMap((candidate) => [
        candidate.caseId,
        candidate.meaningId,
        candidate.family,
        candidate.subset,
        candidate.relationship.kind,
        ...(candidate.relationship.kind === "equivalent_realization"
          ? [candidate.relationship.groupId]
          : [
              candidate.relationship.pairId,
              candidate.relationship.side,
              candidate.relationship.materialDifference
            ])
      ])
    ]);
    const canonicalToolCatalog = canonicalJson(
      [...liveManifest.tools].map(({ name }) => name).sort()
    );

    for (const currentCase of cases) {
      const currentEnvelope = await envelope(currentCase.runnerCaseId);
      const prepared = await createScoredToolDecisionRequest({
        envelope: currentEnvelope,
        safetyIdentifier: SAFETY_IDENTIFIER
      });
      const requestBytes = prepared.requestBodyBytes;
      const modelInput = JSON.parse(String(prepared.body.input)) as { request: string };
      expect(modelInput.request).toBe(currentCase.naturalLanguageRequest);
      expect(requestBytes).not.toContain(currentCase.runnerCaseId);
      for (const candidate of cases) {
        if (candidate.runnerCaseId === currentCase.runnerCaseId) {
          expect(requestBytes).toContain(candidate.naturalLanguageRequest);
        } else {
          expect(requestBytes).not.toContain(candidate.naturalLanguageRequest);
        }
      }
      for (const truth of forbiddenTruth) {
        if (truth.length > 3) expect(requestBytes).not.toContain(truth);
      }
      const tools = prepared.body.tools as readonly { readonly name: string }[];
      expect(canonicalJson(tools.map(({ name }) => name).sort())).toBe(canonicalToolCatalog);
      const expected = meaningForScoredCase(currentCase).expectation;
      if (expected.kind === "call") {
        // The expected tool is present only as one member of the unchanged full live catalog.
        expect(tools.filter(({ name }) => name === expected.tool)).toHaveLength(1);
      }
      expect(Object.keys(prepared.body)).not.toContain("expectedTool");
      expect(Object.keys(prepared.body)).not.toContain("score");
      expect(Object.keys(prepared.body)).not.toContain("subset");
      expect(Object.keys(prepared.body)).not.toContain("family");
    }
  });

  it("keeps provider modules structurally independent of candidate and evaluator truth", async () => {
    for (const relative of [
      "lib/scored/envelope.ts",
      "lib/scored/provider-decision.ts",
      "lib/scored/openai-provider.server.ts",
      "lib/scored/native-admission.ts"
    ]) {
      const source = await readFile(resolve(process.cwd(), relative), "utf8");
      expect(source).not.toMatch(/semantic\/(?:checkout-candidate|evaluator)/u);
      expect(source).not.toContain("GATE3_SEMANTIC_CONTRACT");
      expect(source).not.toContain("GATE3_SEMANTIC_SUITE");
      expect(source).not.toContain("expectedTool");
    }
  });
});

describe("one-decision and one-native-call plumbing", () => {
  it("parses one live function call and binds it for one native admission", async () => {
    const current = await envelope();
    const response = providerResponse([
      {
        type: "function_call",
        name: "order_review",
        call_id: "call_scored_001",
        arguments: "{}"
      }
    ]);
    const parsed = await parseScoredToolDecisionResponse(response, current);
    expect(parsed).toMatchObject({
      decision: { kind: "call", tool: "order_review", arguments: {} },
      decisionError: null,
      toolCallCount: 1,
      providerCallCount: 1
    });
    const admission = await createScoredNativeAdmission({
      envelope: current,
      decision: parsed.decision!
    });
    await expect(
      verifyScoredNativeAdmission({ envelope: current, decision: parsed.decision!, admission })
    ).resolves.toEqual(admission);
    await expect(
      verifyScoredNativeAdmission({
        envelope: current,
        decision: parsed.decision!,
        admission: { ...admission, toolName: "cart_get" }
      })
    ).rejects.toThrow(/scored_native_binding_mismatch/u);
  });

  it("preserves multiple calls as one malformed decision and never admits a no-call", async () => {
    const current = await envelope();
    const call = {
      type: "function_call",
      name: "order_review",
      call_id: "call_scored_duplicate",
      arguments: "{}"
    };
    const parsed = await parseScoredToolDecisionResponse(providerResponse([call, call]), current);
    expect(parsed).toMatchObject({
      decision: null,
      decisionError: "invalid_decision_output_count",
      toolCallCount: 2
    });

    const noCall = await parseScoredToolDecisionResponse(
      providerResponse([
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({ decision: { kind: "clarify", text: "Which quantity?" } })
            }
          ]
        }
      ]),
      current
    );
    expect(noCall.decision).toEqual({ kind: "clarify", text: "Which quantity?" });
    await expect(
      createScoredNativeAdmission({ envelope: current, decision: noCall.decision! })
    ).rejects.toThrow(/scored_native_call_required/u);
  });

  it("accepts only the runner-bound operation ID for a mutating decision", async () => {
    const current = await envelope();
    const responseFor = (operationId: string) =>
      providerResponse([
        {
          type: "function_call",
          name: "cart_update",
          call_id: "call_scored_mutation_001",
          arguments: JSON.stringify({
            operationId,
            operation: "set_quantity",
            itemId: "field-notebook",
            quantity: 2
          })
        }
      ]);
    const exact = await parseScoredToolDecisionResponse(
      responseFor(current.runner.transport.operationId),
      current
    );
    expect(exact).toMatchObject({
      decisionError: null,
      decision: {
        kind: "call",
        tool: "cart_update",
        arguments: { operationId: current.runner.transport.operationId }
      }
    });
    const invented = await parseScoredToolDecisionResponse(
      responseFor("probe_invented_operation_0001"),
      current
    );
    expect(invented).toMatchObject({
      decision: null,
      decisionError: "invalid_function_call",
      toolCallCount: 1
    });
  });

  it("uses exactly one injected provider request after the durable pre-dispatch hook", async () => {
    const current = await envelope();
    const beforeDispatch = vi.fn(async () => undefined);
    const fetchImplementation = vi.fn(async () => {
      const body = JSON.stringify(
        providerResponse([
          {
            type: "function_call",
            name: "order_review",
            call_id: "call_scored_provider_001",
            arguments: "{}"
          }
        ])
      );
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(new TextEncoder().encode(body).byteLength),
          "x-request-id": "req_scored_fixture_001"
        }
      });
    });
    const times = [1_000, 1_017];
    const receipt = await decideScoredWithOpenAi({
      envelope: current,
      apiKey: "fixture-key-never-dispatched",
      safetyIdentifier: SAFETY_IDENTIFIER,
      fetchImplementation,
      beforeDispatch,
      now: () => times.shift() ?? 1_017
    });
    expect(beforeDispatch).toHaveBeenCalledTimes(1);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(receipt).toMatchObject({
      purpose: "baseline",
      freezeHash: FREEZE_HASH,
      envelopeHash: current.envelopeHash,
      providerCallCount: 1,
      toolCallCount: 1,
      decision: { kind: "call", tool: "order_review", arguments: {} },
      requestId: "req_scored_fixture_001",
      durationMs: 17,
      store: false,
      previousResponseId: null,
      conversationId: null
    });
    await expect(verifyScoredProviderKnownReceipt({ receipt, envelope: current })).resolves.toEqual(
      receipt
    );
    await expect(
      verifyScoredProviderKnownReceipt({
        receipt: { ...receipt, rawResponseHash: "0".repeat(64) },
        envelope: current
      })
    ).rejects.toThrow(/provider_receipt_mismatch/u);
  });

  it("retains a bounded raw response when a dispatched provider envelope is invalid", async () => {
    const current = await envelope();
    const rawResponseBytes = '{"not":"a responses envelope"}';
    try {
      await decideScoredWithOpenAi({
        envelope: current,
        apiKey: "fixture-key-never-dispatched",
        safetyIdentifier: SAFETY_IDENTIFIER,
        beforeDispatch: async () => undefined,
        fetchImplementation: async () =>
          new Response(rawResponseBytes, {
            status: 200,
            headers: {
              "content-type": "application/json",
              "content-length": String(new TextEncoder().encode(rawResponseBytes).byteLength)
            }
          })
      });
      throw new Error("expected invalid provider envelope");
    } catch (error) {
      expect(error).toBeInstanceOf(ScoredProviderError);
      expect(error).toMatchObject({
        code: "invalid_provider_envelope",
        dispatch: "after_dispatch_uncertain",
        evidence: { rawResponseBytes }
      });
    }
  });
});
