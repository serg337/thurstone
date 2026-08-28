import { describe, expect, it, vi } from "vitest";

import {
  FALLBACK_CALIBRATION_ENVELOPE_VERSION,
  type FallbackCalibrationEnvelope
} from "@/lib/fallback/calibration-envelope";
import { fallbackNoCallJsonSchemaHash } from "@/lib/fallback/openai-tool-decision";
import { fallbackRunnerImplementationHash } from "@/lib/fallback/implementation-contract";
import {
  FallbackProviderError,
  decideWithFallbackOpenAi
} from "@/lib/fallback/openai-tool-provider.server";
import {
  FALLBACK_IMPLEMENTATION,
  FALLBACK_RUNNER_PROMPT_VERSION,
  FALLBACK_RUNNER_SETTINGS_VERSION,
  FALLBACK_UPSTREAM_PIN,
  fallbackBrowserRuntimeContractHash,
  fallbackRunnerContractHash,
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

function providerResponse() {
  return {
    id: "resp_fallback_provider",
    object: "response",
    model: "gpt-5.6-terra",
    status: "completed",
    output: [
      {
        type: "function_call",
        call_id: "call_fallback_provider",
        name: "cart_get",
        arguments: "{}"
      }
    ],
    usage: { input_tokens: 800, output_tokens: 40, total_tokens: 840 }
  };
}

describe("bounded fallback OpenAI provider adapter", () => {
  it("makes exactly one bounded request and preserves complete receipt bytes and costs", async () => {
    const fetchImplementation = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init).toMatchObject({ method: "POST", redirect: "error" });
      expect(String(init?.body)).toContain('"tool_choice":"auto"');
      return new Response(JSON.stringify(providerResponse()), {
        status: 200,
        headers: { "x-request-id": "request_fallback_provider" }
      });
    });
    const beforeDispatch = vi.fn(async () => undefined);
    const times = [1_800_000_000_000, 1_800_000_000_025];
    const receipt = await decideWithFallbackOpenAi({
      envelope: await envelope(),
      apiKey: "test-only-key",
      safetyIdentifier: "d".repeat(64),
      fetchImplementation,
      beforeDispatch,
      now: () => times.shift()!
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(beforeDispatch).toHaveBeenCalledTimes(1);
    expect(receipt).toMatchObject({
      version: "toolproof-fallback-provider@1.0.0",
      requestId: "request_fallback_provider",
      responseId: "resp_fallback_provider",
      decision: { kind: "call", tool: "cart_get", arguments: {} },
      toolCallCount: 1,
      providerCallCount: 1,
      durationMs: 25,
      usage: {
        inputTokens: 800,
        outputTokens: 40,
        totalTokens: 840,
        accountedNanoUsd: 2_288_000
      }
    });
    expect(receipt.rawResponseBytes).toBe(JSON.stringify(providerResponse()));
    expect(receipt.runnerContractHash).toBe(await fallbackRunnerContractHash());
    expect(receipt.requestBodyHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(receipt.rawResponseHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(receipt.usageHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("never dispatches on a missing key or invalid timeout", async () => {
    const fetchImplementation = vi.fn();
    for (const input of [
      { apiKey: "", timeoutMs: 20_000 },
      { apiKey: "test-only-key", timeoutMs: 20_001 }
    ]) {
      await expect(
        decideWithFallbackOpenAi({
          envelope: await envelope(),
          safetyIdentifier: "d".repeat(64),
          fetchImplementation,
          ...input
        })
      ).rejects.toBeInstanceOf(FallbackProviderError);
    }
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("marks post-dispatch transport and usage failures uncertain", async () => {
    const source = await envelope();
    await expect(
      decideWithFallbackOpenAi({
        envelope: source,
        apiKey: "test-only-key",
        safetyIdentifier: "d".repeat(64),
        fetchImplementation: vi.fn(async () => {
          throw new Error("network failure");
        })
      })
    ).rejects.toMatchObject({ dispatch: "after_dispatch_uncertain" });

    const invalidUsage = providerResponse();
    invalidUsage.usage.input_tokens = 3_001;
    invalidUsage.usage.total_tokens = 3_041;
    await expect(
      decideWithFallbackOpenAi({
        envelope: source,
        apiKey: "test-only-key",
        safetyIdentifier: "d".repeat(64),
        fetchImplementation: vi.fn(
          async () => new Response(JSON.stringify(invalidUsage), { status: 200 })
        )
      })
    ).rejects.toMatchObject({
      code: "provider_usage_out_of_policy",
      dispatch: "after_dispatch_uncertain"
    });
  });
});
