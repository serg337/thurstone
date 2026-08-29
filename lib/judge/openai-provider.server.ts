import "server-only";

import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import { fallbackRunnerPromptHash } from "@/lib/fallback/runner-contract";
import {
  createJudgeDemoDecisionRequest,
  parseJudgeDemoDecisionResponse,
  type JudgeDemoDecisionReceipt
} from "@/lib/judge/provider-decision";
import {
  judgeDemoRunnerSettingsHash,
  verifyJudgeDemoEnvelope,
  type JudgeDemoEnvelope
} from "@/lib/judge/envelope";
import {
  PROBE_MAX_INPUT_TOKENS,
  PROBE_MAX_OUTPUT_TOKENS,
  PROBE_MODEL,
  PROBE_PER_CALL_RESERVATION_NANO_USD,
  calculateProbeCostNanoUsd
} from "@/lib/probe/policy";
import { z } from "zod";

export const JUDGE_DEMO_OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";
export const JUDGE_DEMO_PROVIDER_TIMEOUT_MS = 20_000;
export const JUDGE_DEMO_MAX_PROVIDER_REQUEST_BYTES = 32 * 1_024;
export const JUDGE_DEMO_MAX_PROVIDER_RESPONSE_BYTES = 128 * 1_024;
export const JUDGE_DEMO_PROVIDER_RECEIPT_VERSION = "toolproof-judge-demo-provider@1.0.0";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

export const judgeDemoProviderUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    accountedNanoUsd: z.number().int().nonnegative(),
    costBasis: z.literal("frozen-list-price-plus-10pct-uplift")
  })
  .strict();

export const judgeDemoProviderKnownReceiptSchema = z
  .object({
    version: z.literal(JUDGE_DEMO_PROVIDER_RECEIPT_VERSION),
    provider: z.literal("OpenAI"),
    endpoint: z.literal(JUDGE_DEMO_OPENAI_ENDPOINT),
    model: z.literal(PROBE_MODEL),
    purpose: z.literal("judge"),
    envelopeHash: sha256,
    requestId: z.string().min(1).max(256).nullable(),
    responseId: z.string().min(1).max(256),
    responseStatus: z.string().min(1).max(64),
    requestBodyBytes: z.string().min(1).max(JUDGE_DEMO_MAX_PROVIDER_REQUEST_BYTES),
    requestBodyHash: sha256,
    rawResponseBytes: z.string().min(1).max(JUDGE_DEMO_MAX_PROVIDER_RESPONSE_BYTES),
    rawResponseHash: sha256,
    rawResponse: z.json(),
    outputText: z.string().max(4_000).nullable(),
    decision: z.json().nullable(),
    decisionError: z.string().max(160).nullable(),
    refusal: z.string().max(4_000).nullable(),
    toolCallId: z.string().max(256).nullable(),
    rawArgumentsBytes: z.string().max(16_000).nullable(),
    toolCallCount: z.number().int().min(0).max(32),
    usage: judgeDemoProviderUsageSchema,
    usageHash: sha256,
    promptHash: sha256,
    settingsHash: sha256,
    runnerHash: sha256,
    toolDefinitionsHash: sha256,
    noCallSchemaHash: sha256,
    transportBindingHash: sha256,
    modelInputHash: sha256,
    dispatchedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }),
    durationMs: z.number().int().nonnegative(),
    providerCallCount: z.literal(1),
    store: z.literal(false),
    previousResponseId: z.null(),
    conversationId: z.null()
  })
  .strict();

export type JudgeDemoProviderKnownReceipt = z.infer<typeof judgeDemoProviderKnownReceiptSchema>;

export class JudgeDemoProviderError extends Error {
  constructor(
    readonly code: string,
    readonly dispatch: "before_dispatch" | "after_dispatch_uncertain",
    readonly httpStatus: number | null = null,
    readonly rawResponseBytes: string | null = null
  ) {
    super(code);
    this.name = "JudgeDemoProviderError";
  }
}

export interface DecideJudgeDemoInput {
  readonly envelope: JudgeDemoEnvelope;
  readonly apiKey: string;
  readonly safetyIdentifier: string;
  readonly fetchImplementation?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly beforeDispatch: () => Promise<void>;
}

async function boundedResponseText(response: Response): Promise<string> {
  if (!response.body) {
    throw new JudgeDemoProviderError("missing_provider_body", "after_dispatch_uncertain");
  }
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const parsed = Number(declared);
    if (
      !Number.isSafeInteger(parsed) ||
      parsed < 0 ||
      parsed > JUDGE_DEMO_MAX_PROVIDER_RESPONSE_BYTES
    ) {
      throw new JudgeDemoProviderError("provider_response_too_large", "after_dispatch_uncertain");
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
      if (total > JUDGE_DEMO_MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel("provider_response_too_large");
        throw new JudgeDemoProviderError("provider_response_too_large", "after_dispatch_uncertain");
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
    throw new JudgeDemoProviderError("invalid_provider_utf8", "after_dispatch_uncertain");
  }
}

function parseJson(source: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new JudgeDemoProviderError(
      "invalid_provider_json",
      "after_dispatch_uncertain",
      null,
      source
    );
  }
}

function exactIso(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function safetyIdentifierFromRequest(receipt: JudgeDemoProviderKnownReceipt): string {
  try {
    const parsed = JSON.parse(receipt.requestBodyBytes) as Record<string, unknown>;
    const value = parsed.safety_identifier;
    if (typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)) return value;
  } catch {
    // The caller receives a stable verification error below.
  }
  throw new JudgeDemoProviderError("provider_receipt_request_invalid", "after_dispatch_uncertain");
}

async function receiptHashes(input: {
  readonly preparedBody: string;
  readonly rawResponseBytes: string;
  readonly usage: z.infer<typeof judgeDemoProviderUsageSchema>;
  readonly envelope: JudgeDemoEnvelope;
}) {
  return Promise.all([
    sha256Hex(input.preparedBody),
    sha256Hex(input.rawResponseBytes),
    canonicalSha256(input.usage),
    fallbackRunnerPromptHash(),
    judgeDemoRunnerSettingsHash(),
    canonicalSha256(
      JSON.parse(String((JSON.parse(input.preparedBody) as { input: string }).input))
    ),
    canonicalSha256(input.envelope.runner)
  ]);
}

function usageFromDecision(decision: JudgeDemoDecisionReceipt) {
  if (
    !decision.usage ||
    decision.usage.total_tokens < decision.usage.input_tokens + decision.usage.output_tokens
  ) {
    throw new JudgeDemoProviderError("invalid_provider_usage", "after_dispatch_uncertain");
  }
  const accountedNanoUsd = calculateProbeCostNanoUsd({
    inputTokens: decision.usage.input_tokens,
    outputTokens: decision.usage.output_tokens
  });
  if (
    decision.usage.input_tokens > PROBE_MAX_INPUT_TOKENS ||
    decision.usage.output_tokens > PROBE_MAX_OUTPUT_TOKENS ||
    accountedNanoUsd > PROBE_PER_CALL_RESERVATION_NANO_USD
  ) {
    throw new JudgeDemoProviderError("provider_usage_out_of_policy", "after_dispatch_uncertain");
  }
  return judgeDemoProviderUsageSchema.parse({
    inputTokens: decision.usage.input_tokens,
    outputTokens: decision.usage.output_tokens,
    totalTokens: decision.usage.total_tokens,
    accountedNanoUsd,
    costBasis: "frozen-list-price-plus-10pct-uplift"
  });
}

export async function verifyJudgeDemoProviderKnownReceipt(input: {
  readonly receipt: unknown;
  readonly envelope: unknown;
}): Promise<JudgeDemoProviderKnownReceipt> {
  const envelope = await verifyJudgeDemoEnvelope(input.envelope);
  const receipt = judgeDemoProviderKnownReceiptSchema.parse(input.receipt);
  const prepared = await createJudgeDemoDecisionRequest({
    envelope,
    safetyIdentifier: safetyIdentifierFromRequest(receipt)
  });
  const rawResponse = parseJson(receipt.rawResponseBytes);
  const decision = await parseJudgeDemoDecisionResponse(rawResponse, envelope);
  const usage = usageFromDecision(decision);
  const [
    requestBodyHash,
    rawResponseHash,
    usageHash,
    promptHash,
    settingsHash,
    modelInputHash,
    runnerHash
  ] = await receiptHashes({
    preparedBody: prepared.requestBodyBytes,
    rawResponseBytes: receipt.rawResponseBytes,
    usage,
    envelope
  });
  if (
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
    receipt.toolDefinitionsHash !== envelope.runner.toolDefinitionsHash ||
    receipt.noCallSchemaHash !== envelope.runner.noCallSchemaHash ||
    receipt.transportBindingHash !== envelope.runner.transport.bindingHash ||
    receipt.modelInputHash !== modelInputHash ||
    receipt.envelopeHash !== envelope.envelopeHash ||
    !exactIso(receipt.dispatchedAt) ||
    !exactIso(receipt.completedAt) ||
    receipt.durationMs !== Date.parse(receipt.completedAt) - Date.parse(receipt.dispatchedAt)
  ) {
    throw new JudgeDemoProviderError("provider_receipt_mismatch", "after_dispatch_uncertain");
  }
  return Object.freeze(JSON.parse(canonicalJson(receipt)) as JudgeDemoProviderKnownReceipt);
}

export async function decideJudgeDemoWithOpenAi(
  input: DecideJudgeDemoInput
): Promise<JudgeDemoProviderKnownReceipt> {
  if (!input.apiKey.trim()) {
    throw new JudgeDemoProviderError("missing_provider_key", "before_dispatch");
  }
  const envelope = await verifyJudgeDemoEnvelope(input.envelope);
  const prepared = await createJudgeDemoDecisionRequest({
    envelope,
    safetyIdentifier: input.safetyIdentifier
  });
  if (
    new TextEncoder().encode(prepared.requestBodyBytes).byteLength >
    JUDGE_DEMO_MAX_PROVIDER_REQUEST_BYTES
  ) {
    throw new JudgeDemoProviderError("provider_request_too_large", "before_dispatch");
  }
  const timeoutMs = input.timeoutMs ?? JUDGE_DEMO_PROVIDER_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > JUDGE_DEMO_PROVIDER_TIMEOUT_MS
  ) {
    throw new JudgeDemoProviderError("invalid_provider_timeout", "before_dispatch");
  }
  await input.beforeDispatch();

  const now = input.now ?? Date.now;
  const startedMs = now();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Judge provider timeout", "TimeoutError")),
    timeoutMs
  );
  let response: Response;
  try {
    response = await (input.fetchImplementation ?? globalThis.fetch)(JUDGE_DEMO_OPENAI_ENDPOINT, {
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
    throw new JudgeDemoProviderError("provider_dispatch_uncertain", "after_dispatch_uncertain");
  }

  let rawResponseBytes: string;
  try {
    if (!response.ok) {
      const errorBody = await boundedResponseText(response).catch(() => "");
      throw new JudgeDemoProviderError(
        "provider_http_error",
        "after_dispatch_uncertain",
        response.status,
        errorBody || null
      );
    }
    rawResponseBytes = await boundedResponseText(response);
  } finally {
    clearTimeout(timeout);
  }
  const completedMs = now();
  const rawResponse = parseJson(rawResponseBytes);
  let decision: JudgeDemoDecisionReceipt;
  try {
    decision = await parseJudgeDemoDecisionResponse(rawResponse, envelope);
  } catch {
    throw new JudgeDemoProviderError(
      "invalid_provider_envelope",
      "after_dispatch_uncertain",
      null,
      rawResponseBytes
    );
  }
  const usage = usageFromDecision(decision);
  const [
    requestBodyHash,
    rawResponseHash,
    usageHash,
    promptHash,
    settingsHash,
    modelInputHash,
    runnerHash
  ] = await receiptHashes({
    preparedBody: prepared.requestBodyBytes,
    rawResponseBytes,
    usage,
    envelope
  });
  return judgeDemoProviderKnownReceiptSchema.parse({
    version: JUDGE_DEMO_PROVIDER_RECEIPT_VERSION,
    provider: "OpenAI",
    endpoint: JUDGE_DEMO_OPENAI_ENDPOINT,
    model: PROBE_MODEL,
    purpose: "judge",
    envelopeHash: envelope.envelopeHash,
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
    usage,
    usageHash,
    promptHash,
    settingsHash,
    runnerHash,
    toolDefinitionsHash: envelope.runner.toolDefinitionsHash,
    noCallSchemaHash: envelope.runner.noCallSchemaHash,
    transportBindingHash: envelope.runner.transport.bindingHash,
    modelInputHash,
    dispatchedAt: new Date(startedMs).toISOString(),
    completedAt: new Date(completedMs).toISOString(),
    durationMs: Math.max(0, completedMs - startedMs),
    providerCallCount: 1,
    store: false,
    previousResponseId: null,
    conversationId: null
  });
}
