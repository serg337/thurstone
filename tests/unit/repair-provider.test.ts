import { createCheckoutFixture } from "@/lib/domain/checkout";
import { buildRepairDevelopmentPackage } from "@/lib/repair/development-package.server";
import {
  REPAIR_MODEL_INPUT_MAX_BYTES,
  RepairProviderError,
  runRepairBuilder
} from "@/lib/repair/provider.server";
import type { SemanticResultsState } from "@/lib/results/semantic-results.server";
import { createCheckoutLiveManifest } from "@/lib/webmcp/live-manifest.server";
import { describe, expect, it, vi } from "vitest";

async function results(): Promise<
  Extract<SemanticResultsState, { status: "baseline-development-only" }>
> {
  const baselineAppCommit = "f".repeat(40);
  return {
    status: "baseline-development-only",
    disclosure: "one-trial demonstration snapshot",
    baselineRunId: `run_${"b".repeat(22)}`,
    baselineEvidenceDigest: "a".repeat(64),
    baselineAppCommit,
    taskBoundary:
      "One request permits one decision and at most one native call in a simulated checkout.",
    currentDescription:
      "Finalize the current cart by opening a simulated checkout request that remains pending for human approval when the user is ready to proceed.",
    supersededEvidence: null,
    reviewPackageHash: "c".repeat(64),
    frozenProtocolHash: "d".repeat(64),
    liveManifest: await createCheckoutLiveManifest(createCheckoutFixture(), baselineAppCommit),
    rows: Array.from({ length: 12 }, (_, index) => ({
      ordinal: index,
      caseId: `development_${index}`,
      runnerCaseId: `case_${String(index).padStart(22, "0")}`,
      family: "development-family",
      request: `Synthetic development request ${index}`,
      expectedAction: "call:checkout_request",
      observedAction: "clarify",
      passed: false,
      score: 0 as const,
      failureCodes: ["decision_action_class"],
      traceEventId: null,
      stateChanged: false
    })),
    repairRows: Array.from({ length: 12 }, (_, index) => ({
      ordinal: index,
      runnerCaseId: `case_${String(index).padStart(22, "0")}`,
      meaningId: "meaning_checkout_pending",
      request: `Synthetic development request ${index}`,
      expected: {
        approvedMeaning: "Open simulated checkout only after explicit user direction.",
        approvalClass: "human-gated-consequential-request",
        actionClass: "call",
        tool: "checkout_request",
        arguments: { additionalProperties: "forbidden", predicates: [] },
        stateChange: "required",
        allowedEffects: ["state-revision", "pending-checkout"],
        forbiddenEffects: ["cart-quantities", "unmodeled-state"]
      },
      observed: {
        actionClass: "clarify",
        decision: { kind: "clarify" as const, text: "Please confirm checkout." },
        decisionError: null,
        refusal: null,
        passed: false,
        score: 0 as const,
        failureCodes: ["decision_action_class"]
      },
      trace: null
    })),
    development: { earned: 0, possible: 12 },
    holdout: {
      status: "sealed",
      caseCount: 12,
      attemptCount: 12,
      commitmentDigest: "e".repeat(64),
      revealRule: "after-v2-freeze-and-revised-terminal"
    }
  };
}

describe("fresh isolated Repair Builder provider", () => {
  it("reports same-origin boundary failures without entering the repair service", async () => {
    const response = await repairRoute(
      new Request("https://toolproof-rust.vercel.app/api/repair/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ capability: "x".repeat(43) })
      })
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "request_rejected",
      inferencePerformed: false
    });
  });

  it("sends compact development-only evidence and returns one hash-bound proposal", async () => {
    const baselineResults = await results();
    const developmentPackage = await buildRepairDevelopmentPackage(baselineResults);
    expect(JSON.stringify(developmentPackage)).not.toContain("commitmentDigest");
    expect(developmentPackage.holdout).toEqual({
      promptsIncluded: 0,
      labelsIncluded: 0,
      rowsIncluded: 0,
      aggregatesIncluded: 0,
      hintsIncluded: 0
    });
    const beforeDispatch = vi.fn(async () => undefined);
    let requestBody = "";
    const fetchImplementation = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          id: "resp_repair_test",
          object: "response",
          model: "gpt-5.6-terra",
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    proposedDescription:
                      "Open a simulated pending checkout only when the user explicitly directs checkout; never use this tool for review-only requests.",
                    rationale:
                      "Development evidence indicates that explicit commitment should be distinguished from review and tentative wording."
                  })
                }
              ]
            }
          ],
          usage: { input_tokens: 1_000, output_tokens: 100, total_tokens: 1_100 }
        }),
        { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_1" } }
      );
    });
    const receipt = await runRepairBuilder({
      developmentPackage,
      apiKey: "test-key",
      contextId: `repair_${"r".repeat(22)}`,
      safetyIdentifier: "f".repeat(64),
      fetchImplementation: fetchImplementation as typeof fetch,
      beforeDispatch,
      now: () => 1_787_950_000_000
    });
    expect(beforeDispatch).toHaveBeenCalledOnce();
    expect(receipt.repairBuilderReceipt).toMatchObject({
      contextClass: "fresh-stateless-application-api",
      holdoutPromptCountReceived: 0,
      holdoutResultCountReceived: 0,
      filesystemAccess: false,
      browserAccess: false,
      proposedField: "checkout_request.description"
    });
    expect(receipt.repairBuilderReceipt.receiptHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(requestBody).not.toContain(baselineResults.holdout.commitmentDigest);
    expect(requestBody).toContain("Synthetic development request 0");
    expect(requestBody).toContain("decision_action_class");
    expect(requestBody).toContain("toolproof-probe-live-manifest@1.0.0");
    const modelInput = JSON.parse(requestBody) as { readonly input: string };
    const modelPackage = JSON.parse(modelInput.input) as {
      readonly liveManifest: {
        readonly tools: readonly { readonly name: string; readonly inputSchema: unknown }[];
      };
      readonly traceTupleSchema: readonly string[];
    };
    expect(
      modelPackage.liveManifest.tools.find(({ name }) => name === "checkout_request")
    ).toHaveProperty("inputSchema");
    expect(modelPackage.traceTupleSchema).toEqual(["toolName", "canonicalArguments", "effect"]);
    expect(Buffer.byteLength(modelInput.input, "utf8")).toBeLessThanOrEqual(
      REPAIR_MODEL_INPUT_MAX_BYTES
    );
    expect(Buffer.byteLength(requestBody, "utf8")).toBeLessThanOrEqual(64 * 1_024);
  });

  it.each([
    {
      label: "wrong model",
      model: "gpt-5.6-terra-impostor",
      usage: { input_tokens: 1_000, output_tokens: 100, total_tokens: 1_100 },
      output: {
        proposedDescription:
          "Open the simulated checkout request only after the user explicitly directs checkout.",
        rationale: "This keeps the explicit commitment boundary precise and review-safe."
      },
      code: "repair_provider_identity_invalid"
    },
    {
      label: "inconsistent usage",
      model: "gpt-5.6-terra",
      usage: { input_tokens: 1_000, output_tokens: 100, total_tokens: 1_099 },
      output: {
        proposedDescription:
          "Open the simulated checkout request only after the user explicitly directs checkout.",
        rationale: "This keeps the explicit commitment boundary precise and review-safe."
      },
      code: "repair_provider_identity_invalid"
    },
    {
      label: "trim-invalid structured output",
      model: "gpt-5.6-terra",
      usage: { input_tokens: 1_000, output_tokens: 100, total_tokens: 1_100 },
      output: {
        proposedDescription: "                                        x",
        rationale: "This rationale is long enough before trimming."
      },
      code: "repair_provider_output_invalid"
    }
  ])("marks $label as uncertain after dispatch", async ({ model, usage, output, code }) => {
    const developmentPackage = await buildRepairDevelopmentPackage(await results());
    const beforeDispatch = vi.fn(async () => undefined);
    const fetchImplementation = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "resp_repair_invalid",
            object: "response",
            model,
            status: "completed",
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: JSON.stringify(output) }]
              }
            ],
            usage
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );
    await expect(
      runRepairBuilder({
        developmentPackage,
        apiKey: "test-key",
        contextId: `repair_${"r".repeat(22)}`,
        safetyIdentifier: "f".repeat(64),
        fetchImplementation: fetchImplementation as typeof fetch,
        beforeDispatch
      })
    ).rejects.toMatchObject({
      code,
      dispatch: "after_dispatch_uncertain"
    } satisfies Partial<RepairProviderError>);
    expect(beforeDispatch).toHaveBeenCalledOnce();
  });
});
import { POST as repairRoute } from "@/app/api/repair/run/route";
