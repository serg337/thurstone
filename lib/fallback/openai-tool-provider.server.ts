import "server-only";

import { canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import type { FallbackCalibrationEnvelope } from "@/lib/fallback/calibration-envelope";
import {
  createFallbackToolDecisionRequest,
  parseFallbackToolDecisionResponse,
  type FallbackToolDecisionReceipt
} from "@/lib/fallback/openai-tool-decision";
import {
  fallbackRunnerContractHash,
  fallbackRunnerPromptHash,
  fallbackRunnerSettingsHash
} from "@/lib/fallback/runner-contract";
import {
  PROBE_MAX_INPUT_TOKENS,
  PROBE_MAX_OUTPUT_TOKENS,
  PROBE_MODEL,
  PROBE_PER_CALL_RESERVATION_NANO_USD,
  calculateProbeCostNanoUsd
} from "@/lib/probe/policy";

export const FALLBACK_OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";
export const FALLBACK_PROVIDER_TIMEOUT_MS = 20_000;
export const FALLBACK_MAX_PROVIDER_REQUEST_BYTES = 32 * 1_024;
export const FALLBACK_MAX_PROVIDER_RESPONSE_BYTES = 128 * 1_024;
export const FALLBACK_PROVIDER_RECEIPT_VERSION = "toolproof-fallback-provider@1.0.0";

export class FallbackProviderError extends Error {
  constructor(
    readonly code: string,
    readonly dispatch: "before_dispatch" | "after_dispatch_uncertain",
    readonly httpStatus: number | null = null
  ) {
    super(code);
    this.name = "FallbackProviderError";
  }
}

export interface FallbackProviderUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly accountedNanoUsd: number;
  readonly costBasis: "frozen-list-price-plus-10pct-uplift";
}

export interface FallbackProviderKnownReceipt {
  readonly version: typeof FALLBACK_PROVIDER_RECEIPT_VERSION;
  readonly provider: "OpenAI";
  readonly endpoint: typeof FALLBACK_OPENAI_ENDPOINT;
  readonly model: typeof PROBE_MODEL;
  readonly requestId: string | null;
  readonly responseId: string;
  readonly responseStatus: string;
  readonly requestBodyBytes: string;
  readonly requestBodyHash: string;
  readonly rawResponseBytes: string;
  readonly rawResponseHash: string;
  readonly rawResponse: unknown;
  readonly outputText: string | null;
  readonly decision: FallbackToolDecisionReceipt["decision"];
  readonly decisionError: string | null;
  readonly refusal: string | null;
  readonly toolCallId: string | null;
  readonly rawArgumentsBytes: string | null;
  readonly toolCallCount: number;
  readonly usage: FallbackProviderUsage;
  readonly usageHash: string;
  readonly promptHash: string;
  readonly settingsHash: string;
  readonly runnerContractHash: string;
  readonly browserRuntimeHash: string;
  readonly toolDefinitionsHash: string;
  readonly noCallSchemaHash: string;
  readonly transportBindingHash: string;
  readonly modelInputHash: string;
  readonly dispatchedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly providerCallCount: 1;
  readonly store: false;
  readonly previousResponseId: null;
  readonly conversationId: null;
}

export interface DecideWithFallbackOpenAiInput {
  readonly envelope: FallbackCalibrationEnvelope;
  readonly apiKey: string;
  readonly safetyIdentifier: string;
  readonly fetchImplementation?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly beforeDispatch?: () => Promise<void>;
}

function exactTimestamp(value: number): string {
  return new Date(value).toISOString();
}

async function boundedResponseText(response: Response): Promise<string> {
  if (!response.body) {
    throw new FallbackProviderError("missing_provider_body", "after_dispatch_uncertain");
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsed = Number(declaredLength);
    if (
      !Number.isSafeInteger(parsed) ||
      parsed < 0 ||
      parsed > FALLBACK_MAX_PROVIDER_RESPONSE_BYTES
    ) {
      throw new FallbackProviderError("provider_response_too_large", "after_dispatch_uncertain");
    }
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > FALLBACK_MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel("provider_response_too_large");
        throw new FallbackProviderError("provider_response_too_large", "after_dispatch_uncertain");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new FallbackProviderError("invalid_provider_utf8", "after_dispatch_uncertain");
  }
}

function parseJson(source: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new FallbackProviderError("invalid_provider_json", "after_dispatch_uncertain");
  }
}

export async function decideWithFallbackOpenAi(
  input: DecideWithFallbackOpenAiInput
): Promise<FallbackProviderKnownReceipt> {
  if (!input.apiKey.trim()) {
    throw new FallbackProviderError("missing_provider_key", "before_dispatch");
  }
  const prepared = await createFallbackToolDecisionRequest({
    envelope: input.envelope,
    safetyIdentifier: input.safetyIdentifier
  });
  if (
    new TextEncoder().encode(prepared.requestBodyBytes).byteLength >
    FALLBACK_MAX_PROVIDER_REQUEST_BYTES
  ) {
    throw new FallbackProviderError("provider_request_too_large", "before_dispatch");
  }
  const timeoutMs = input.timeoutMs ?? FALLBACK_PROVIDER_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > FALLBACK_PROVIDER_TIMEOUT_MS
  ) {
    throw new FallbackProviderError("invalid_provider_timeout", "before_dispatch");
  }
  if (input.beforeDispatch) await input.beforeDispatch();

  const now = input.now ?? Date.now;
  const startedMs = now();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Fallback provider timeout", "TimeoutError")),
    timeoutMs
  );
  let response: Response;
  try {
    response = await (input.fetchImplementation ?? globalThis.fetch)(FALLBACK_OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: prepared.requestBodyBytes,
      signal: controller.signal,
      redirect: "error"
    });
  } catch {
    clearTimeout(timeout);
    throw new FallbackProviderError("provider_dispatch_uncertain", "after_dispatch_uncertain");
  }

  let rawResponseBytes: string;
  try {
    if (!response.ok) {
      await boundedResponseText(response).catch(() => "");
      throw new FallbackProviderError(
        "provider_http_error",
        "after_dispatch_uncertain",
        response.status
      );
    }
    rawResponseBytes = await boundedResponseText(response);
  } finally {
    clearTimeout(timeout);
  }
  const completedMs = now();
  const rawResponse = parseJson(rawResponseBytes);
  let decision: FallbackToolDecisionReceipt;
  try {
    decision = parseFallbackToolDecisionResponse(rawResponse, prepared.envelope);
  } catch {
    throw new FallbackProviderError("invalid_provider_envelope", "after_dispatch_uncertain");
  }
  const usage = decision.usage;
  if (!usage || usage.total_tokens < usage.input_tokens + usage.output_tokens) {
    throw new FallbackProviderError("invalid_provider_usage", "after_dispatch_uncertain");
  }
  const accountedNanoUsd = calculateProbeCostNanoUsd({
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens
  });
  if (
    usage.input_tokens > PROBE_MAX_INPUT_TOKENS ||
    usage.output_tokens > PROBE_MAX_OUTPUT_TOKENS ||
    accountedNanoUsd > PROBE_PER_CALL_RESERVATION_NANO_USD
  ) {
    throw new FallbackProviderError("provider_usage_out_of_policy", "after_dispatch_uncertain");
  }
  const usageReceipt: FallbackProviderUsage = Object.freeze({
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
    accountedNanoUsd,
    costBasis: "frozen-list-price-plus-10pct-uplift"
  });
  const [
    requestBodyHash,
    rawResponseHash,
    usageHash,
    promptHash,
    settingsHash,
    runnerContractHash
  ] = await Promise.all([
    sha256Hex(prepared.requestBodyBytes),
    sha256Hex(rawResponseBytes),
    canonicalSha256(usageReceipt),
    fallbackRunnerPromptHash(),
    fallbackRunnerSettingsHash(),
    fallbackRunnerContractHash()
  ]);

  return Object.freeze({
    version: FALLBACK_PROVIDER_RECEIPT_VERSION,
    provider: "OpenAI",
    endpoint: FALLBACK_OPENAI_ENDPOINT,
    model: PROBE_MODEL,
    requestId: response.headers.get("x-request-id"),
    responseId: decision.responseId,
    responseStatus: decision.responseStatus,
    requestBodyBytes: prepared.requestBodyBytes,
    requestBodyHash,
    rawResponseBytes,
    rawResponseHash,
    rawResponse,
    outputText: decision.outputText,
    decision: decision.decision,
    decisionError: decision.decisionError,
    refusal: decision.refusal,
    toolCallId: decision.toolCallId,
    rawArgumentsBytes: decision.rawArgumentsBytes,
    toolCallCount: decision.toolCallCount,
    usage: usageReceipt,
    usageHash,
    promptHash,
    settingsHash,
    runnerContractHash,
    browserRuntimeHash: prepared.envelope.runner.browserRuntimeHash,
    toolDefinitionsHash: prepared.toolDefinitionsHash,
    noCallSchemaHash: prepared.noCallSchemaHash,
    transportBindingHash: prepared.envelope.runner.transport.bindingHash,
    modelInputHash: await canonicalSha256(JSON.parse(String(prepared.body.input)) as unknown),
    dispatchedAt: exactTimestamp(startedMs),
    completedAt: exactTimestamp(completedMs),
    durationMs: Math.max(0, completedMs - startedMs),
    providerCallCount: 1,
    store: false,
    previousResponseId: null,
    conversationId: null
  });
}
