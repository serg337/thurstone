import { describe, expect, it, vi } from "vitest";

import {
  PROBE_CALIBRATION_ENVELOPE_VERSION,
  PROBE_FIXTURE_SYNOPSIS_VERSION,
  PROBE_LIVE_MANIFEST_VERSION,
  createProbeTransportBinding,
  type ProbeCalibrationEnvelope
} from "@/lib/probe/calibration-envelope";
import { decideWithOpenAi } from "@/lib/probe/openai";
import {
  PROBE_RUNNER_PROMPT_VERSION,
  PROBE_RUNNER_SETTINGS_VERSION
} from "@/lib/probe/runner-contract";

async function envelope(): Promise<ProbeCalibrationEnvelope> {
  const identity = {
    runId: `run_${"b".repeat(22)}`,
    caseId: `case_${"c".repeat(22)}`,
    trialId: `trial_${"d".repeat(22)}`
  };
  const transport = await createProbeTransportBinding(identity);
  return {
    version: PROBE_CALIBRATION_ENVELOPE_VERSION,
    purpose: "calibration",
    buildCommit: "a".repeat(40),
    ...identity,
    naturalLanguageRequest: "What is in my cart?",
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
    liveManifest: {
      version: PROBE_LIVE_MANIFEST_VERSION,
      manifestHash: "e".repeat(64),
      tools: [
        {
          name: "cart_get",
          title: "Read cart lines",
          description: "Return current cart identities and quantities.",
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
              quantity: { type: "integer", minimum: 1, maximum: 10 }
            },
            required: ["operationId", "quantity"],
            additionalProperties: false
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false }
        }
      ]
    },
    runner: {
      promptVersion: PROBE_RUNNER_PROMPT_VERSION,
      promptHash: "f".repeat(64),
      settingsVersion: PROBE_RUNNER_SETTINGS_VERSION,
      settingsHash: "1".repeat(64),
      decisionSchemaHash: "2".repeat(64),
      transport
    }
  };
}

function successPayload(
  content: unknown = {
    decision: { kind: "call", tool: "cart_get", arguments: {} }
  }
) {
  return {
    id: "resp_fixture_001",
    object: "response",
    created_at: 1_788_000_000,
    model: "gpt-5.6-terra",
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: JSON.stringify(content) }]
      }
    ],
    usage: { input_tokens: 900, output_tokens: 40, total_tokens: 940 }
  };
}

function response(payload: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json", "x-request-id": "req_fixture_001" },
    ...init
  });
}

describe("OpenAI Probe decision adapter", () => {
  it("makes one stateless, fixed-model request and preserves exact raw evidence", async () => {
    const fetchImplementation = vi.fn(async () => response(successPayload()));
    const source = await envelope();
    const receipt = await decideWithOpenAi({
      envelope: source,
      apiKey: "sk-test-not-real",
      safetyIdentifier: "3".repeat(64),
      fetchImplementation,
      now: (() => {
        let value = 1_788_000_000_000;
        return () => (value += 25);
      })()
    });

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const [, request] = fetchImplementation.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "gpt-5.6-terra",
      store: false,
      parallel_tool_calls: false,
      max_output_tokens: 400,
      truncation: "disabled",
      reasoning: { effort: "low" },
      safety_identifier: "3".repeat(64)
    });
    expect(body).not.toHaveProperty("conversation");
    expect(body).not.toHaveProperty("previous_response_id");
    expect(body).not.toHaveProperty("tools");
    expect((body.text as { format: { schema: unknown } }).format.schema).toMatchObject({
      type: "object",
      required: ["decision"],
      additionalProperties: false
    });
    const modelInput = JSON.parse(String(body.input)) as Record<string, unknown>;
    expect(modelInput.fixture).toEqual(source.fixture);
    expect(JSON.stringify(modelInput.fixture)).not.toMatch(
      /quantity|unitPrice|subtotal|shipping|total|operationId|bindingHash/iu
    );
    expect(JSON.stringify(modelInput)).not.toContain(source.runner.transport.operationId);
    expect(JSON.stringify(modelInput)).not.toMatch(/bindingHash|expectedTool/iu);
    const decisionBranches = (
      body.text as { format: { schema: { properties: { decision: { anyOf: unknown[] } } } } }
    ).format.schema.properties.decision.anyOf as Array<{
      properties?: { tool?: { enum?: string[] }; arguments?: unknown };
    }>;
    const mutationBranch = decisionBranches.find(
      (branch) => branch.properties?.tool?.enum?.[0] === "cart_update"
    );
    expect(mutationBranch?.properties?.arguments).toMatchObject({
      properties: {
        operationId: { enum: [source.runner.transport.operationId] }
      }
    });
    expect(receipt.decision).toEqual({ kind: "call", tool: "cart_get", arguments: {} });
    expect(receipt.rawResponse).toEqual(successPayload());
    expect(receipt.rawResponseBytes).toBe(JSON.stringify(successPayload()));
    expect(receipt.providerCallCount).toBe(1);
    expect(receipt.transportBindingHash).toBe(source.runner.transport.bindingHash);
    expect(receipt.decisionSchemaHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(receipt.usage.accountedNanoUsd).toBeLessThanOrEqual(62_500_000);
    expect(receipt.usage.costBasis).toBe("frozen-list-price-plus-10pct-uplift");
  });

  it("preserves known refusal, incomplete, and malformed decisions as failures", async () => {
    const refusal = structuredClone(successPayload()) as { output: unknown[]; status: string };
    refusal.output = [
      { type: "message", content: [{ type: "refusal", refusal: "Cannot comply." }] }
    ];
    const refused = await decideWithOpenAi({
      envelope: await envelope(),
      apiKey: "sk-test-not-real",
      safetyIdentifier: "4".repeat(64),
      fetchImplementation: async () => response(refusal)
    });
    expect(refused.decision).toBeNull();
    expect(refused.decisionError).toBe("provider_refusal");
    expect(refused.refusal).toBe("Cannot comply.");

    const incomplete = structuredClone(successPayload()) as { output: unknown[]; status: string };
    incomplete.status = "incomplete";
    const incompleteReceipt = await decideWithOpenAi({
      envelope: await envelope(),
      apiKey: "sk-test-not-real",
      safetyIdentifier: "5".repeat(64),
      fetchImplementation: async () => response(incomplete)
    });
    expect(incompleteReceipt.decision).toBeNull();
    expect(incompleteReceipt.decisionError).toBe("provider_incomplete");

    const malformed = await decideWithOpenAi({
      envelope: await envelope(),
      apiKey: "sk-test-not-real",
      safetyIdentifier: "6".repeat(64),
      fetchImplementation: async () => response(successPayload({ decision: { kind: "other" } }))
    });
    expect(malformed.decision).toBeNull();
    expect(malformed.decisionError).toBe("invalid_structured_decision");
  });

  it("classifies HTTP, network, and oversized-response failures as uncertain after dispatch", async () => {
    const cases: Array<() => Promise<unknown>> = [
      async () =>
        decideWithOpenAi({
          envelope: await envelope(),
          apiKey: "sk-test-not-real",
          safetyIdentifier: "7".repeat(64),
          fetchImplementation: async () =>
            response({ error: { type: "server_error" } }, { status: 500 })
        }),
      async () =>
        decideWithOpenAi({
          envelope: await envelope(),
          apiKey: "sk-test-not-real",
          safetyIdentifier: "8".repeat(64),
          fetchImplementation: async () => {
            throw new Error("network detail must not escape");
          }
        }),
      async () =>
        decideWithOpenAi({
          envelope: await envelope(),
          apiKey: "sk-test-not-real",
          safetyIdentifier: "9".repeat(64),
          fetchImplementation: async () =>
            new Response("x", {
              status: 200,
              headers: { "content-length": String(128 * 1_024 + 1) }
            })
        })
    ];
    for (const run of cases) {
      await expect(run()).rejects.toMatchObject({
        dispatch: "after_dispatch_uncertain"
      });
    }
  });

  it("rejects invalid inputs before dispatch", async () => {
    const fetchImplementation = vi.fn();
    const beforeDispatch = vi.fn(async () => undefined);
    await expect(
      decideWithOpenAi({
        envelope: await envelope(),
        apiKey: "",
        safetyIdentifier: "a".repeat(64),
        fetchImplementation,
        beforeDispatch
      })
    ).rejects.toMatchObject({ dispatch: "before_dispatch", code: "missing_provider_key" });
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(beforeDispatch).not.toHaveBeenCalled();

    const tampered = structuredClone(await envelope());
    (tampered.runner.transport as { operationId: string }).operationId = `probe_${"0".repeat(58)}`;
    await expect(
      decideWithOpenAi({
        envelope: tampered,
        apiKey: "sk-test-not-real",
        safetyIdentifier: "a".repeat(64),
        fetchImplementation,
        beforeDispatch
      })
    ).rejects.toThrow("transport_binding_mismatch");
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(beforeDispatch).not.toHaveBeenCalled();
  });

  it("grants exactly once after preflight and prevents fetch when the grant fails", async () => {
    const order: string[] = [];
    const successfulFetch = vi.fn(async () => {
      order.push("fetch");
      return response(successPayload());
    });
    await decideWithOpenAi({
      envelope: await envelope(),
      apiKey: "sk-test-not-real",
      safetyIdentifier: "c".repeat(64),
      beforeDispatch: async () => {
        order.push("grant");
      },
      fetchImplementation: successfulFetch
    });
    expect(order).toEqual(["grant", "fetch"]);
    expect(successfulFetch).toHaveBeenCalledTimes(1);

    const blockedFetch = vi.fn();
    await expect(
      decideWithOpenAi({
        envelope: await envelope(),
        apiKey: "sk-test-not-real",
        safetyIdentifier: "d".repeat(64),
        beforeDispatch: async () => {
          throw new Error("fixture grant denied");
        },
        fetchImplementation: blockedFetch
      })
    ).rejects.toThrowError(/fixture grant denied/u);
    expect(blockedFetch).not.toHaveBeenCalled();
  });

  it("keeps the timeout active through provider delivery and never retries", async () => {
    const fetchImplementation = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("fixture timeout", "AbortError")),
            { once: true }
          );
        })
    );
    await expect(
      decideWithOpenAi({
        envelope: await envelope(),
        apiKey: "sk-test-not-real",
        safetyIdentifier: "b".repeat(64),
        fetchImplementation,
        timeoutMs: 1
      })
    ).rejects.toMatchObject({
      code: "provider_dispatch_uncertain",
      dispatch: "after_dispatch_uncertain"
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
});
