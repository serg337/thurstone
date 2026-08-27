import { describe, expect, it } from "vitest";

import {
  PROBE_GENERIC_RUNNER_PROMPT,
  PROBE_RUNNER_PROMPT_MANIFEST,
  PROBE_RUNNER_PROMPT_VERSION,
  PROBE_RUNNER_SETTINGS_MANIFEST,
  PROBE_RUNNER_SETTINGS_VERSION,
  probeRunnerContractHash,
  probeRunnerPromptHash,
  probeRunnerSettingsHash
} from "@/lib/probe/runner-contract";
import { probeLedgerScriptHash } from "@/lib/probe/ledger";
import { probePolicyHash } from "@/lib/probe/policy";

describe("frozen generic Probe runner contract", () => {
  it("contains one stateless decision and no case- or tool-specific steering", () => {
    expect(PROBE_RUNNER_PROMPT_MANIFEST).toEqual({
      version: PROBE_RUNNER_PROMPT_VERSION,
      prompt: PROBE_GENERIC_RUNNER_PROMPT
    });
    expect(PROBE_GENERIC_RUNNER_PROMPT).toContain("Return exactly one decision");
    expect(PROBE_GENERIC_RUNNER_PROMPT).toContain("live tool manifest");
    expect(PROBE_GENERIC_RUNNER_PROMPT).toContain("not to answer the request yourself");
    expect(PROBE_GENERIC_RUNNER_PROMPT).toContain("actionable tool use");
    expect(PROBE_GENERIC_RUNNER_PROMPT).toContain("does not fulfill the request");
    expect(PROBE_GENERIC_RUNNER_PROMPT).toContain("user-controlled intent or business parameters");
    expect(PROBE_GENERIC_RUNNER_PROMPT).toContain("Runner-owned transport");
    expect(PROBE_GENERIC_RUNNER_PROMPT).toContain("never ask the user for it");
    expect(PROBE_GENERIC_RUNNER_PROMPT).toContain('kind "call"');
    expect(PROBE_GENERIC_RUNNER_PROMPT).toContain('kind "clarify"');
    expect(PROBE_GENERIC_RUNNER_PROMPT).toContain('kind "abstain"');
    expect(PROBE_GENERIC_RUNNER_PROMPT).not.toMatch(
      /cart_get|order_review|cart_update|checkout_request|checkout_cancel|expected|development|holdout|score/iu
    );
    expect(PROBE_GENERIC_RUNNER_PROMPT).not.toMatch(
      /What items and quantities|Please review my current order|Stoneware mug|Open the simulated checkout for this cart/iu
    );
  });

  it("freezes exact one-call Responses settings without conversational carry-over", () => {
    expect(PROBE_RUNNER_SETTINGS_MANIFEST).toEqual({
      version: PROBE_RUNNER_SETTINGS_VERSION,
      provider: "OpenAI",
      model: "gpt-5.6-terra",
      api: "responses",
      store: false,
      reasoningEffort: "low",
      maximumInputTokens: 3_000,
      maximumOutputTokens: 400,
      maximumProviderCalls: 1,
      maximumTargetCalls: 1,
      responseFormat: "strict-json-schema",
      conversationId: null,
      previousResponseId: null,
      providerRetryCount: 0
    });
    expect(Object.isFrozen(PROBE_RUNNER_PROMPT_MANIFEST)).toBe(true);
    expect(Object.isFrozen(PROBE_RUNNER_SETTINGS_MANIFEST)).toBe(true);
  });

  it("produces stable canonical prompt, settings, and combined hashes", async () => {
    const [prompt, settings, combined] = await Promise.all([
      probeRunnerPromptHash(),
      probeRunnerSettingsHash(),
      probeRunnerContractHash()
    ]);
    expect(prompt).toMatch(/^[a-f0-9]{64}$/u);
    expect(settings).toMatch(/^[a-f0-9]{64}$/u);
    expect(combined).toMatch(/^[a-f0-9]{64}$/u);
    await expect(
      Promise.all([probeRunnerContractHash(), probeRunnerContractHash()])
    ).resolves.toEqual([combined, combined]);
  });

  it("does not couple the runner hash to a stale policy-migration generation", async () => {
    const [firstPolicy, secondPolicy, firstScript, secondScript] = await Promise.all([
      probePolicyHash(),
      probePolicyHash(),
      probeLedgerScriptHash(),
      probeLedgerScriptHash()
    ]);
    expect(firstPolicy).toMatch(/^[a-f0-9]{64}$/u);
    expect(firstScript).toMatch(/^[a-f0-9]{64}$/u);
    expect(secondPolicy).toBe(firstPolicy);
    expect(secondScript).toBe(firstScript);
  });
});
