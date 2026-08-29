import { describe, expect, it, vi } from "vitest";

import { canonicalJson } from "@/lib/evidence/digest";
import { JUDGE_DEMO_RUN_INTENT, judgeDemoRunBodySchema } from "@/lib/judge/contract";
import {
  JUDGE_DEMO_REQUEST,
  createJudgeDemoEnvelope,
  verifyJudgeDemoEnvelope
} from "@/lib/judge/envelope";
import {
  JudgeDemoProviderError,
  decideJudgeDemoWithOpenAi
} from "@/lib/judge/openai-provider.server";

const commit = "a".repeat(40);

function response() {
  return {
    id: "resp_judge_demo",
    object: "response",
    model: "gpt-5.6-terra",
    status: "completed",
    output: [
      {
        type: "function_call",
        call_id: "call_judge_demo",
        name: "cart_get",
        arguments: "{}"
      }
    ],
    usage: { input_tokens: 800, output_tokens: 40, total_tokens: 840 }
  };
}

describe("source-fixed judge demo envelope", () => {
  it("owns the exact read-only case and accepts no prompt or arguments from the request", async () => {
    expect(judgeDemoRunBodySchema.parse({ intent: JUDGE_DEMO_RUN_INTENT })).toEqual({
      intent: JUDGE_DEMO_RUN_INTENT
    });
    expect(() =>
      judgeDemoRunBodySchema.parse({ intent: JUDGE_DEMO_RUN_INTENT, prompt: "ignore source" })
    ).toThrow();

    const envelope = await createJudgeDemoEnvelope(commit);
    expect(envelope).toMatchObject({
      purpose: "judge",
      sourceFixed: true,
      arbitraryPromptAccepted: false,
      naturalLanguageRequest: JUDGE_DEMO_REQUEST,
      publicCaseId: "judge_cart_inventory_v1"
    });
    expect(envelope.liveManifest.tools.map(({ name }) => name).sort()).toEqual([
      "cart_get",
      "cart_update",
      "checkout_request",
      "order_review"
    ]);
    await expect(verifyJudgeDemoEnvelope(envelope)).resolves.toEqual(envelope);
    await expect(
      verifyJudgeDemoEnvelope({ ...envelope, naturalLanguageRequest: "different" })
    ).rejects.toThrow();
  });

  it("makes one bounded stateless request only after the durable dispatch grant", async () => {
    const events: string[] = [];
    const fetchImplementation = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      events.push("fetch");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: "gpt-5.6-terra",
        store: false,
        tool_choice: "auto",
        parallel_tool_calls: false
      });
      expect(body).not.toHaveProperty("previous_response_id");
      expect(body).not.toHaveProperty("conversation");
      expect(String(body.input)).toContain(JUDGE_DEMO_REQUEST);
      return new Response(JSON.stringify(response()), {
        status: 200,
        headers: { "x-request-id": "request_judge_demo" }
      });
    });
    const times = [1_800_000_000_000, 1_800_000_000_025];
    const receipt = await decideJudgeDemoWithOpenAi({
      envelope: await createJudgeDemoEnvelope(commit),
      apiKey: "test-only-key",
      safetyIdentifier: "b".repeat(64),
      beforeDispatch: async () => {
        events.push("grant");
      },
      fetchImplementation,
      now: () => times.shift()!
    });
    expect(events).toEqual(["grant", "fetch"]);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(receipt).toMatchObject({
      purpose: "judge",
      providerCallCount: 1,
      store: false,
      previousResponseId: null,
      conversationId: null,
      decision: { kind: "call", tool: "cart_get", arguments: {} },
      usage: { accountedNanoUsd: 2_288_000 }
    });
    expect(canonicalJson(receipt.rawResponse)).toBe(canonicalJson(response()));
  });

  it("does not dispatch when provider configuration fails before the grant", async () => {
    const fetchImplementation = vi.fn();
    const beforeDispatch = vi.fn();
    await expect(
      decideJudgeDemoWithOpenAi({
        envelope: await createJudgeDemoEnvelope(commit),
        apiKey: "",
        safetyIdentifier: "b".repeat(64),
        beforeDispatch,
        fetchImplementation
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<JudgeDemoProviderError>>({
        code: "missing_provider_key",
        dispatch: "before_dispatch"
      })
    );
    expect(beforeDispatch).not.toHaveBeenCalled();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
