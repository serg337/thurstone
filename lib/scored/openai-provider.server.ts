import "server-only";

import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
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
import {
  createScoredToolDecisionRequest,
  parseScoredToolDecisionResponse,
  type ScoredToolDecisionReceipt
} from "@/lib/scored/provider-decision";

export const SCORED_OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";
export const SCORED_PROVIDER_TIMEOUT_MS = 20_000;
export const SCORED_MAX_PROVIDER_REQUEST_BYTES = 32 * 1_024;
export const SCORED_MAX_PROVIDER_RESPONSE_BYTES = 128 * 1_024;
export const SCORED_PROVIDER_RECEIPT_VERSION = "toolproof-scored-provider@1.0.0";

export interface ScoredProviderErrorEvidence {
  readonly rawResponseBytes: string;
}

export class ScoredProviderError extends Error {
  constructor(
    readonly code: string,
    readonly dispatch: "before_dispatch" | "after_dispatch_uncertain",
    readonly httpStatus: number | null = null,
    readonly evidence: ScoredProviderErrorEvidence | null = null
  ) {
    super(code);
    this.name = "ScoredProviderError";
  }
}

export interface ScoredProviderUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly accountedNanoUsd: number;
  readonly costBasis: "frozen-list-price-plus-10pct-uplift";
}

export interface ScoredProviderKnownReceipt {
  readonly version: typeof SCORED_PROVIDER_RECEIPT_VERSION;
  readonly provider: "OpenAI";
  readonly endpoint: typeof SCORED_OPENAI_ENDPOINT;
  readonly model: typeof PROBE_MODEL;
  readonly purpose: "baseline" | "revised";
  readonly freezeHash: string;
  readonly envelopeHash: string;
  readonly requestId: string | null;
  readonly responseId: string;
  readonly responseStatus: string;
  readonly requestBodyBytes: string;
  readonly requestBodyHash: string;
  readonly rawResponseBytes: string;
  readonly rawResponseHash: string;
  readonly rawResponse: unknown;
  readonly outputText: string | null;
  readonly decision: ScoredToolDecisionReceipt["decision"];
  readonly decisionError: string | null;
  readonly refusal: string | null;
  readonly toolCallId: string | null;
  readonly rawArgumentsBytes: string | null;
  readonly toolCallCount: number;
  readonly usage: ScoredProviderUsage;
  readonly usageHash: string;
  readonly promptHash: string;
  readonly settingsHash: string;
  readonly runnerHash: string;
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

export interface DecideScoredWithOpenAiInput {
  readonly envelope: unknown;
  readonly apiKey: string;
  readonly safetyIdentifier: string;
  readonly fetchImplementation?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  /** Must durably acquire the one allowed provider grant before any network dispatch. */
  readonly beforeDispatch?: () => Promise<void>;
}

const PROVIDER_RECEIPT_KEYS = Object.freeze(
  [
    "browserRuntimeHash",
    "completedAt",
    "conversationId",
    "decision",
    "decisionError",
    "dispatchedAt",
    "durationMs",
    "endpoint",
    "envelopeHash",
    "freezeHash",
    "model",
    "modelInputHash",
    "noCallSchemaHash",
    "outputText",
    "previousResponseId",
    "promptHash",
    "provider",
    "providerCallCount",
    "purpose",
    "rawArgumentsBytes",
    "rawResponse",
    "rawResponseBytes",
    "rawResponseHash",
    "refusal",
    "requestBodyBytes",
    "requestBodyHash",
    "requestId",
    "responseId",
    "responseStatus",
    "runnerHash",
    "settingsHash",
    "store",
    "toolCallCount",
    "toolCallId",
    "toolDefinitionsHash",
    "transportBindingHash",
    "usage",
    "usageHash",
    "version"
  ].sort()
);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return canonicalJson(Object.keys(value).sort()) === canonicalJson(expected);
}

function exactIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export async function verifyScoredProviderKnownReceipt(input: {
  readonly receipt: unknown;
  readonly envelope: unknown;
}): Promise<ScoredProviderKnownReceipt> {
  const receiptRecord = record(input.receipt);
  if (!receiptRecord || !exactKeys(receiptRecord, PROVIDER_RECEIPT_KEYS)) {
    throw new ScoredProviderError("provider_receipt_invalid", "after_dispatch_uncertain");
  }
  const receipt = input.receipt as ScoredProviderKnownReceipt;
  const requestBody = (() => {
    try {
      return record(JSON.parse(receipt.requestBodyBytes));
    } catch {
      return null;
    }
  })();
  const safetyIdentifier = requestBody?.safety_identifier;
  if (typeof safetyIdentifier !== "string" || !/^[a-f0-9]{64}$/u.test(safetyIdentifier)) {
    throw new ScoredProviderError("provider_receipt_request_invalid", "after_dispatch_uncertain");
  }
  const prepared = await createScoredToolDecisionRequest({
    envelope: input.envelope,
    safetyIdentifier
  });
  let rawResponse: unknown;
  try {
    rawResponse = JSON.parse(receipt.rawResponseBytes) as unknown;
  } catch {
    throw new ScoredProviderError("provider_receipt_response_invalid", "after_dispatch_uncertain");
  }
  const decision = await parseScoredToolDecisionResponse(rawResponse, prepared.envelope);
  if (!decision.usage) {
    throw new ScoredProviderError("provider_receipt_usage_invalid", "after_dispatch_uncertain");
  }
  const accountedNanoUsd = calculateProbeCostNanoUsd({
    inputTokens: decision.usage.input_tokens,
    outputTokens: decision.usage.output_tokens
  });
  const usage: ScoredProviderUsage = {
    inputTokens: decision.usage.input_tokens,
    outputTokens: decision.usage.output_tokens,
    totalTokens: decision.usage.total_tokens,
    accountedNanoUsd,
    costBasis: "frozen-list-price-plus-10pct-uplift"
  };
  const [
    requestBodyHash,
    rawResponseHash,
    usageHash,
    promptHash,
    settingsHash,
    runnerHash,
    modelInputHash
  ] = await Promise.all([
    sha256Hex(prepared.requestBodyBytes),
    sha256Hex(receipt.rawResponseBytes),
    canonicalSha256(usage),
    fallbackRunnerPromptHash(),
    fallbackRunnerSettingsHash(),
    fallbackRunnerContractHash(),
    canonicalSha256(JSON.parse(String(prepared.body.input)) as unknown)
  ]);
  const dispatchedAtMs = Date.parse(receipt.dispatchedAt);
  const completedAtMs = Date.parse(receipt.completedAt);
  const requestIdValid =
    receipt.requestId === null ||
    (typeof receipt.requestId === "string" &&
      receipt.requestId.length >= 1 &&
      receipt.requestId.length <= 256);
  if (
    receipt.version !== SCORED_PROVIDER_RECEIPT_VERSION ||
    receipt.provider !== "OpenAI" ||
    receipt.endpoint !== SCORED_OPENAI_ENDPOINT ||
    receipt.model !== PROBE_MODEL ||
    receipt.purpose !== prepared.envelope.purpose ||
    receipt.freezeHash !== prepared.envelope.runBinding.freezeHash ||
    receipt.envelopeHash !== prepared.envelope.envelopeHash ||
    !requestIdValid ||
    receipt.requestBodyBytes !== prepared.requestBodyBytes ||
    receipt.requestBodyHash !== requestBodyHash ||
    receipt.rawResponseHash !== rawResponseHash ||
    canonicalJson(receipt.rawResponse) !== canonicalJson(rawResponse) ||
    receipt.responseId !== decision.responseId ||
    receipt.responseStatus !== decision.responseStatus ||
    canonicalJson(receipt.decision) !== canonicalJson(decision.decision) ||
    receipt.decisionError !== decision.decisionError ||
    receipt.refusal !== decision.refusal ||
    receipt.toolCallId !== decision.toolCallId ||
    receipt.rawArgumentsBytes !== decision.rawArgumentsBytes ||
    receipt.outputText !== decision.outputText ||
    receipt.toolCallCount !== decision.toolCallCount ||
    canonicalJson(receipt.usage) !== canonicalJson(usage) ||
    receipt.usageHash !== usageHash ||
    receipt.promptHash !== promptHash ||
    receipt.settingsHash !== settingsHash ||
    receipt.runnerHash !== runnerHash ||
    receipt.browserRuntimeHash !== prepared.envelope.runner.browserRuntimeHash ||
    receipt.toolDefinitionsHash !== prepared.toolDefinitionsHash ||
    receipt.noCallSchemaHash !== prepared.noCallSchemaHash ||
    receipt.transportBindingHash !== prepared.envelope.runner.transport.bindingHash ||
    receipt.modelInputHash !== modelInputHash ||
    !exactIso(receipt.dispatchedAt) ||
    !exactIso(receipt.completedAt) ||
    completedAtMs < dispatchedAtMs ||
    receipt.durationMs !== completedAtMs - dispatchedAtMs ||
    receipt.providerCallCount !== 1 ||
    receipt.store !== false ||
    receipt.previousResponseId !== null ||
    receipt.conversationId !== null
  ) {
    throw new ScoredProviderError("provider_receipt_mismatch", "after_dispatch_uncertain");
  }
  return Object.freeze(JSON.parse(canonicalJson(receipt)) as ScoredProviderKnownReceipt);
}

function exactTimestamp(value: number): string {
  return new Date(value).toISOString();
}

async function boundedResponseText(response: Response): Promise<string> {
  if (!response.body) {
    throw new ScoredProviderError("missing_provider_body", "after_dispatch_uncertain");
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsed = Number(declaredLength);
    if (
      !Number.isSafeInteger(parsed) ||
      parsed < 0 ||
      parsed > SCORED_MAX_PROVIDER_RESPONSE_BYTES
    ) {
      throw new ScoredProviderError("provider_response_too_large", "after_dispatch_uncertain");
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
      if (total > SCORED_MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel("provider_response_too_large");
        throw new ScoredProviderError("provider_response_too_large", "after_dispatch_uncertain");
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
    throw new ScoredProviderError("invalid_provider_utf8", "after_dispatch_uncertain");
  }
}

function parseJson(source: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new ScoredProviderError("invalid_provider_json", "after_dispatch_uncertain", null, {
      rawResponseBytes: source
    });
  }
}

export async function decideScoredWithOpenAi(
  input: DecideScoredWithOpenAiInput
): Promise<ScoredProviderKnownReceipt> {
  if (!input.apiKey.trim()) {
    throw new ScoredProviderError("missing_provider_key", "before_dispatch");
  }
  const prepared = await createScoredToolDecisionRequest({
    envelope: input.envelope,
    safetyIdentifier: input.safetyIdentifier
  });
  if (
    new TextEncoder().encode(prepared.requestBodyBytes).byteLength >
    SCORED_MAX_PROVIDER_REQUEST_BYTES
  ) {
    throw new ScoredProviderError("provider_request_too_large", "before_dispatch");
  }
  const timeoutMs = input.timeoutMs ?? SCORED_PROVIDER_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > SCORED_PROVIDER_TIMEOUT_MS) {
    throw new ScoredProviderError("invalid_provider_timeout", "before_dispatch");
  }
  if (input.beforeDispatch) await input.beforeDispatch();

  const now = input.now ?? Date.now;
  const startedMs = now();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Scored provider timeout", "TimeoutError")),
    timeoutMs
  );
  let response: Response;
  try {
    response = await (input.fetchImplementation ?? globalThis.fetch)(SCORED_OPENAI_ENDPOINT, {
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
    throw new ScoredProviderError("provider_dispatch_uncertain", "after_dispatch_uncertain");
  }

  let rawResponseBytes: string;
  try {
    if (!response.ok) {
      const errorBody = await boundedResponseText(response).catch(() => "");
      throw new ScoredProviderError(
        "provider_http_error",
        "after_dispatch_uncertain",
        response.status,
        errorBody === "" ? null : { rawResponseBytes: errorBody }
      );
    }
    rawResponseBytes = await boundedResponseText(response);
  } finally {
    clearTimeout(timeout);
  }
  const completedMs = now();
  const rawResponse = parseJson(rawResponseBytes);
  let decision: ScoredToolDecisionReceipt;
  try {
    decision = await parseScoredToolDecisionResponse(rawResponse, prepared.envelope);
  } catch {
    throw new ScoredProviderError("invalid_provider_envelope", "after_dispatch_uncertain", null, {
      rawResponseBytes
    });
  }
  const usage = decision.usage;
  if (!usage || usage.total_tokens < usage.input_tokens + usage.output_tokens) {
    throw new ScoredProviderError("invalid_provider_usage", "after_dispatch_uncertain", null, {
      rawResponseBytes
    });
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
    throw new ScoredProviderError(
      "provider_usage_out_of_policy",
      "after_dispatch_uncertain",
      null,
      {
        rawResponseBytes
      }
    );
  }
  const usageReceipt: ScoredProviderUsage = Object.freeze({
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
    accountedNanoUsd,
    costBasis: "frozen-list-price-plus-10pct-uplift"
  });
  const [requestBodyHash, rawResponseHash, usageHash, promptHash, settingsHash, runnerHash] =
    await Promise.all([
      sha256Hex(prepared.requestBodyBytes),
      sha256Hex(rawResponseBytes),
      canonicalSha256(usageReceipt),
      fallbackRunnerPromptHash(),
      fallbackRunnerSettingsHash(),
      fallbackRunnerContractHash()
    ]);

  return Object.freeze({
    version: SCORED_PROVIDER_RECEIPT_VERSION,
    provider: "OpenAI",
    endpoint: SCORED_OPENAI_ENDPOINT,
    model: PROBE_MODEL,
    purpose: prepared.envelope.purpose,
    freezeHash: prepared.envelope.runBinding.freezeHash,
    envelopeHash: prepared.envelope.envelopeHash,
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
    runnerHash,
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
