import { canonicalSha256 } from "@/lib/evidence/digest";
import {
  FALLBACK_IMPLEMENTATION,
  FALLBACK_RUNNER_IMPLEMENTATION_MANIFEST,
  fallbackRunnerImplementationHash,
  type FallbackRunnerImplementationManifest
} from "@/lib/fallback/implementation-contract";
import {
  PROBE_MAX_INPUT_TOKENS,
  PROBE_MAX_OUTPUT_TOKENS,
  PROBE_MODEL,
  PROBE_PRODUCTION_ORIGIN,
  PROBE_PROVIDER
} from "@/lib/probe/policy";

export const FALLBACK_RUNNER_PROMPT_VERSION = "toolproof-fallback-runner-prompt@1.0.0";
export const FALLBACK_RUNNER_SETTINGS_VERSION = "toolproof-fallback-runner-settings@1.1.0";
export { FALLBACK_IMPLEMENTATION } from "@/lib/fallback/implementation-contract";
export const FALLBACK_RUNNER_CONTRACT_VERSION = "toolproof-fallback-runner-contract@1.1.0";
export const FALLBACK_BROWSER_RUNTIME_CONTRACT_VERSION =
  "toolproof-fallback-browser-contract@1.0.0";

export const FALLBACK_UPSTREAM_PIN = Object.freeze({
  repository: "https://github.com/GoogleChromeLabs/webmcp-tools",
  commit: "bcb6e93939d7fcf05747ccde913ed77a688e3b94",
  subtree: "b3329060567a1358b45490874a8d4eb0183d5731",
  browserSourceSha256: "d70f9ab511ecb5ab70f21000f12a56030f49e96c3cbb27557248a55ff7657bca",
  lockfileSha256: "90c24149dbe0d19ea46cc83d59ae776a8c28a0a41ff938455dadb28fdefed0b6",
  puppeteerCore: "25.4.0",
  chromeForTesting: "151.0.7922.47",
  chromePlatform: "linux64" as const,
  chromeArchiveUrl:
    "https://storage.googleapis.com/chrome-for-testing-public/151.0.7922.47/linux64/chrome-linux64.zip",
  chromeArchiveSha256: "14ac03a67e154e3f8bbc57e03ef03315fda8fedff8e045eee8b31500283a33f4",
  chromeExecutableSha256: "3b0be9872ea937893cb1e1523fde071d38c1ed4ef866b3f7976240094a868c93",
  protocol: "cdp" as const
});

export const FALLBACK_BROWSER_RUNTIME_CONTRACT = Object.freeze({
  version: FALLBACK_BROWSER_RUNTIME_CONTRACT_VERSION,
  executableSha256: FALLBACK_UPSTREAM_PIN.chromeExecutableSha256,
  browserVersion: `Chrome/${FALLBACK_UPSTREAM_PIN.chromeForTesting}`,
  targetOrigin: PROBE_PRODUCTION_ORIGIN,
  targetPath: "/lab" as const,
  navigationTimeoutMs: 20_000,
  headless: true as const,
  protocol: FALLBACK_UPSTREAM_PIN.protocol,
  args: Object.freeze(["--enable-features=WebMCP"]),
  requestBoundary: "same-origin-only" as const,
  additionalTargetPolicy: "terminate-trial" as const,
  isolatedProcessPerTrial: true as const,
  isolatedProfilePerTrial: true as const
});

export function fallbackBrowserRuntimeContractHash(): Promise<string> {
  return canonicalSha256(FALLBACK_BROWSER_RUNTIME_CONTRACT);
}

export const FALLBACK_GENERIC_RUNNER_PROMPT = [
  "You are the stateless action selector for one request in a simulated checkout sandbox.",
  "Your task is to select and call an applicable supplied function, not to answer the request yourself.",
  "Use only the supplied natural-language request, fixture synopsis, and live function tools.",
  "Treat a request to read, show, inspect, or review current sandbox information as actionable tool use when a live read-only function applies.",
  "The fixture synopsis is context for choosing or populating a function; it is not a function result and does not fulfill the request.",
  "Call exactly one supplied function when the request and all user-controlled parameters justify it.",
  "Runner-owned transport, replay, request, and idempotency identifiers are already bound into function schemas and are not missing user information.",
  "If user-controlled intent or business parameters required for an applicable function are missing, return exactly one clarification matching the supplied no-call schema.",
  "If no supplied function applies or no action should be taken, return exactly one abstention matching the supplied no-call schema.",
  "Never call more than one function, never emit both a function call and text, never invent a function, and never include internal reasoning."
].join(" ");

export const FALLBACK_RUNNER_PROMPT_MANIFEST = Object.freeze({
  version: FALLBACK_RUNNER_PROMPT_VERSION,
  prompt: FALLBACK_GENERIC_RUNNER_PROMPT
});

export const FALLBACK_RUNNER_SETTINGS_MANIFEST = Object.freeze({
  version: FALLBACK_RUNNER_SETTINGS_VERSION,
  implementation: FALLBACK_IMPLEMENTATION,
  upstream: FALLBACK_UPSTREAM_PIN,
  provider: PROBE_PROVIDER,
  model: PROBE_MODEL,
  api: "responses" as const,
  store: false as const,
  reasoningEffort: "low" as const,
  maximumInputTokens: PROBE_MAX_INPUT_TOKENS,
  maximumOutputTokens: PROBE_MAX_OUTPUT_TOKENS,
  maximumProviderCalls: 1 as const,
  maximumTargetCalls: 1 as const,
  toolChoice: "auto" as const,
  parallelToolCalls: false as const,
  functionStrictMode: true as const,
  noCallResponseFormat: "strict-json-schema" as const,
  conversationId: null,
  previousResponseId: null,
  providerRetryCount: 0 as const,
  browserRuntime: FALLBACK_BROWSER_RUNTIME_CONTRACT
});

export function fallbackRunnerPromptHash(): Promise<string> {
  return canonicalSha256(FALLBACK_RUNNER_PROMPT_MANIFEST);
}

export function fallbackRunnerSettingsHash(): Promise<string> {
  return canonicalSha256(FALLBACK_RUNNER_SETTINGS_MANIFEST);
}

export async function fallbackRunnerContractHash(
  implementationManifest: FallbackRunnerImplementationManifest = FALLBACK_RUNNER_IMPLEMENTATION_MANIFEST
): Promise<string> {
  return canonicalSha256({
    version: FALLBACK_RUNNER_CONTRACT_VERSION,
    promptHash: await fallbackRunnerPromptHash(),
    settingsHash: await fallbackRunnerSettingsHash(),
    implementationHash: await fallbackRunnerImplementationHash(implementationManifest)
  });
}
