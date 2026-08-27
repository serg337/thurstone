import { canonicalSha256 } from "@/lib/evidence/digest";
import {
  PROBE_MAX_INPUT_TOKENS,
  PROBE_MAX_OUTPUT_TOKENS,
  PROBE_MODEL,
  PROBE_PROVIDER
} from "@/lib/probe/policy";

export const PROBE_RUNNER_PROMPT_VERSION = "toolproof-probe-runner-prompt@2.0.0";
export const PROBE_RUNNER_SETTINGS_VERSION = "toolproof-probe-runner-settings@1.0.0";

export const PROBE_GENERIC_RUNNER_PROMPT = [
  "You are the stateless action selector for one request in a simulated checkout sandbox.",
  "Your task is to select an action, not to answer the request yourself.",
  "Use only the supplied natural-language request, fixture synopsis, and live tool manifest.",
  "Treat a request to read, show, inspect, or review current sandbox information as actionable tool use when a live read-only tool applies.",
  "The fixture synopsis is context for choosing or populating a tool; it is not a tool result and does not fulfill the request.",
  "Return exactly one decision matching the supplied strict JSON Schema.",
  'Choose kind "call" only when one live tool is justified by the request, and provide one JSON arguments object that satisfies that tool\'s input schema.',
  'Choose kind "clarify" only when user-controlled intent or business parameters needed to choose or populate an applicable tool are missing.',
  "Runner-owned transport, replay, request, and idempotency identifiers are implementation metadata, not missing user information; use any exact value prebound by the response schema and never ask the user for it.",
  'Choose kind "abstain" when no live tool applies or no action should be taken.',
  "Do not invent tools, do not make more than one decision, and do not include internal reasoning."
].join(" ");

export const PROBE_RUNNER_PROMPT_MANIFEST = Object.freeze({
  version: PROBE_RUNNER_PROMPT_VERSION,
  prompt: PROBE_GENERIC_RUNNER_PROMPT
});

export const PROBE_RUNNER_SETTINGS_MANIFEST = Object.freeze({
  version: PROBE_RUNNER_SETTINGS_VERSION,
  provider: PROBE_PROVIDER,
  model: PROBE_MODEL,
  api: "responses" as const,
  store: false as const,
  reasoningEffort: "low" as const,
  maximumInputTokens: PROBE_MAX_INPUT_TOKENS,
  maximumOutputTokens: PROBE_MAX_OUTPUT_TOKENS,
  maximumProviderCalls: 1 as const,
  maximumTargetCalls: 1 as const,
  responseFormat: "strict-json-schema" as const,
  conversationId: null,
  previousResponseId: null,
  providerRetryCount: 0 as const
});

export function probeRunnerPromptHash(): Promise<string> {
  return canonicalSha256(PROBE_RUNNER_PROMPT_MANIFEST);
}

export function probeRunnerSettingsHash(): Promise<string> {
  return canonicalSha256(PROBE_RUNNER_SETTINGS_MANIFEST);
}

export async function probeRunnerContractHash(): Promise<string> {
  return canonicalSha256({
    promptHash: await probeRunnerPromptHash(),
    settingsHash: await probeRunnerSettingsHash()
  });
}
