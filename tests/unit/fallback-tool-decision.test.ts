import { describe, expect, it } from "vitest";

import {
  FALLBACK_CALIBRATION_ENVELOPE_VERSION,
  type FallbackCalibrationEnvelope
} from "@/lib/fallback/calibration-envelope";
import {
  createFallbackNoCallJsonSchema,
  createFallbackToolDecisionRequest,
  fallbackNoCallJsonSchemaHash,
  parseFallbackToolDecisionResponse
} from "@/lib/fallback/openai-tool-decision";
import { fallbackRunnerImplementationHash } from "@/lib/fallback/implementation-contract";
import {
  FALLBACK_IMPLEMENTATION,
  FALLBACK_RUNNER_PROMPT_VERSION,
  FALLBACK_RUNNER_SETTINGS_VERSION,
  FALLBACK_UPSTREAM_PIN,
  fallbackBrowserRuntimeContractHash,
  fallbackRunnerPromptHash,
  fallbackRunnerSettingsHash
} from "@/lib/fallback/runner-contract";
import {
  PROBE_FIXTURE_SYNOPSIS_VERSION,
  PROBE_LIVE_MANIFEST_VERSION,
  createProbeTransportBinding,
  type ProbeLiveManifest
} from "@/lib/probe/calibration-envelope";
import { probeFunctionToolDefinitionsHash } from "@/lib/probe/decision";

function manifest(): ProbeLiveManifest {
  return {
    version: PROBE_LIVE_MANIFEST_VERSION,
    manifestHash: "a".repeat(64),
    tools: [
      {
        name: "cart_get",
        title: "Read cart lines",
        description: "Return current cart line-item identities and quantities.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false }
      },
      {
        name: "cart_update",
        title: "Set cart quantity",
        description: "Set one current cart line to the requested quantity.",
        inputSchema: {
          type: "object",
          properties: {
            operationId: {
              type: "string",
              pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{15,63}$"
            },
            itemId: { type: "string", enum: ["field-notebook", "stoneware-mug"] },
            operation: { type: "string", enum: ["set_quantity"] },
            quantity: { type: "integer", minimum: 0, maximum: 10 }
          },
          required: ["operationId", "itemId", "operation", "quantity"],
          additionalProperties: false
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false }
      }
    ]
  };
}

async function envelope(): Promise<FallbackCalibrationEnvelope> {
  const identity = {
    runId: `run_${"r".repeat(22)}`,
    caseId: `case_${"c".repeat(22)}`,
    trialId: `trial_${"t".repeat(22)}`
  };
  const transport = await createProbeTransportBinding(identity);
  const liveManifest = manifest();
  return {
    version: FALLBACK_CALIBRATION_ENVELOPE_VERSION,
    purpose: "calibration",
    buildCommit: "b".repeat(40),
    ...identity,
    naturalLanguageRequest: "Set the Stoneware mug quantity in my cart to 3.",
    fixture: {
      version: PROBE_FIXTURE_SYNOPSIS_VERSION,
      simulated: true,
      fixtureId: "checkout-seed-v1",
      fixtureVersion: "checkout-fixture@1.0.0",
      stateRevision: 0,
      items: [
        { itemId: "field-notebook", name: "Field notebook" },
        { itemId: "stoneware-mug", name: "Stoneware mug" }
      ],
      pendingCheckout: false
    },
    liveManifest,
    runner: {
      implementation: FALLBACK_IMPLEMENTATION,
      implementationHash: await fallbackRunnerImplementationHash(),
      upstreamCommit: FALLBACK_UPSTREAM_PIN.commit,
      upstreamSubtree: FALLBACK_UPSTREAM_PIN.subtree,
      promptVersion: FALLBACK_RUNNER_PROMPT_VERSION,
      promptHash: await fallbackRunnerPromptHash(),
      settingsVersion: FALLBACK_RUNNER_SETTINGS_VERSION,
      settingsHash: await fallbackRunnerSettingsHash(),
      browserRuntimeHash: await fallbackBrowserRuntimeContractHash(),
      toolDefinitionsHash: await probeFunctionToolDefinitionsHash(liveManifest, transport),
      noCallSchemaHash: await fallbackNoCallJsonSchemaHash(),
      transport
    }
  };
}

function response(output: unknown[], status = "completed") {
  return {
    id: "resp_fallback_fixture",
    object: "response",
    model: "gpt-5.6-terra",
    status,
    output,
    usage: { input_tokens: 800, output_tokens: 40, total_tokens: 840 }
  };
}

describe("fallback Responses function-tool decision contract", () => {
  it("builds one expectation-free request with strict live tools and a no-call schema", async () => {
    const source = await envelope();
    const prepared = await createFallbackToolDecisionRequest({
      envelope: source,
      safetyIdentifier: "d".repeat(64)
    });
    expect(prepared.body).toMatchObject({
      model: "gpt-5.6-terra",
      tool_choice: "auto",
      parallel_tool_calls: false,
      store: false,
      reasoning: { effort: "low" },
      safety_identifier: "d".repeat(64)
    });
    const tools = prepared.body.tools as Array<Record<string, unknown>>;
    expect(tools.map(({ name }) => name)).toEqual(["cart_get", "cart_update"]);
    expect(tools.every(({ type, strict }) => type === "function" && strict === true)).toBe(true);
    expect(tools[1]?.parameters).toMatchObject({
      properties: { operationId: { enum: [source.runner.transport.operationId] } }
    });
    const modelInput = JSON.parse(String(prepared.body.input)) as Record<string, unknown>;
    expect(modelInput).not.toHaveProperty("runId");
    expect(JSON.stringify(modelInput)).not.toContain(source.runner.transport.operationId);
    expect(prepared.requestBodyBytes).not.toMatch(
      /expectedTool|internalTruthId|calibration_truth_|expectedCall/iu
    );
    expect(createFallbackNoCallJsonSchema().schema).toMatchObject({
      type: "object",
      required: ["decision"],
      additionalProperties: false
    });
  });

  it("parses one native provider function call and revalidates its bound arguments", async () => {
    const source = await envelope();
    const argumentsValue = {
      operationId: source.runner.transport.operationId,
      itemId: "stoneware-mug",
      operation: "set_quantity",
      quantity: 3
    };
    const receipt = parseFallbackToolDecisionResponse(
      response([
        { type: "reasoning", id: "reasoning_1", summary: [] },
        {
          type: "function_call",
          call_id: "call_fixture_1",
          name: "cart_update",
          arguments: JSON.stringify(argumentsValue)
        }
      ]),
      source
    );
    expect(receipt.decision).toEqual({
      kind: "call",
      tool: "cart_update",
      arguments: argumentsValue
    });
    expect(receipt.decisionError).toBeNull();
    expect(receipt.toolCallId).toBe("call_fixture_1");
    expect(receipt.rawArgumentsBytes).toBe(JSON.stringify(argumentsValue));
    expect(receipt.toolCallCount).toBe(1);
  });

  it("accepts one strict clarification or abstention only as text output", async () => {
    for (const decision of [
      { kind: "clarify", text: "Which item should change?" },
      { kind: "abstain", reason: "No live function applies." }
    ]) {
      const receipt = parseFallbackToolDecisionResponse(
        response([
          {
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify({ decision }) }]
          }
        ]),
        await envelope()
      );
      expect(receipt.decision).toEqual(decision);
      expect(receipt.decisionError).toBeNull();
      expect(receipt.toolCallCount).toBe(0);
    }
  });

  it("preserves refusal and rejects multiple, unregistered, or transport-drifted calls", async () => {
    const source = await envelope();
    const refused = parseFallbackToolDecisionResponse(
      response([{ type: "message", content: [{ type: "refusal", refusal: "Cannot comply." }] }]),
      source
    );
    expect(refused).toMatchObject({
      decision: null,
      decisionError: "provider_refusal",
      refusal: "Cannot comply."
    });

    const invalidOutputs = [
      [
        { type: "function_call", call_id: "one", name: "cart_get", arguments: "{}" },
        { type: "function_call", call_id: "two", name: "cart_get", arguments: "{}" }
      ],
      [{ type: "function_call", call_id: "one", name: "missing_tool", arguments: "{}" }],
      [
        {
          type: "function_call",
          call_id: "one",
          name: "cart_update",
          arguments: JSON.stringify({
            operationId: `probe_${"0".repeat(58)}`,
            itemId: "stoneware-mug",
            operation: "set_quantity",
            quantity: 3
          })
        }
      ]
    ];
    for (const output of invalidOutputs) {
      const receipt = parseFallbackToolDecisionResponse(response(output), source);
      expect(receipt.decision).toBeNull();
      expect(receipt.decisionError).toMatch(/invalid_/u);
    }
  });
});
