import "server-only";

import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import {
  createProbeDecisionJsonSchema,
  parseProbeDecisionOutput,
  type ProbeDecision
} from "@/lib/probe/decision";
import {
  assertNoProbeExpectationLeakage,
  createProbeModelInput,
  parseExpectationFreeCalibrationEnvelope,
  verifyProbeTransportBinding,
  type ProbeCalibrationEnvelope
} from "@/lib/probe/calibration-envelope";
import {
  PROBE_MAX_INPUT_TOKENS,
  PROBE_MAX_OUTPUT_TOKENS,
  PROBE_MODEL,
  PROBE_PER_CALL_RESERVATION_NANO_USD,
  calculateProbeCostNanoUsd
} from "@/lib/probe/policy";
import {
  PROBE_GENERIC_RUNNER_PROMPT,
  PROBE_RUNNER_SETTINGS_MANIFEST,
  probeRunnerPromptHash,
  probeRunnerSettingsHash
} from "@/lib/probe/runner-contract";
import { z } from "zod";

export const PROBE_OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";
export const PROBE_PROVIDER_TIMEOUT_MS = 20_000;
export const PROBE_MAX_PROVIDER_RESPONSE_BYTES = 128 * 1_024;
export const PROBE_MAX_PROVIDER_REQUEST_BYTES = 32 * 1_024;

const responseUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative()
  })
  .passthrough();

const responseEnvelopeSchema = z
  .object({
    id: z.string().min(1).max(256),
    object: z.literal("response"),
    created_at: z.number().int().nonnegative(),
    model: z.string().min(1).max(256),
    status: z.enum(["completed", "failed", "in_progress", "cancelled", "queued", "incomplete"]),
    output: z.array(z.unknown()).max(32),
    usage: responseUsageSchema.nullable()
  })
  .passthrough();

export interface ProbeProviderUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly accountedNanoUsd: number;
  readonly costBasis: "frozen-list-price-plus-10pct-uplift";
}

export interface ProbeProviderKnownReceipt {
  readonly version: "toolproof-probe-provider@1.0.0";
  readonly provider: "OpenAI";
  readonly endpoint: typeof PROBE_OPENAI_ENDPOINT;
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
  readonly decision: ProbeDecision | null;
  readonly decisionError: string | null;
  readonly refusal: string | null;
  readonly usage: ProbeProviderUsage;
  readonly usageHash: string;
  readonly promptHash: string;
  readonly settingsHash: string;
  readonly decisionSchemaHash: string;
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

export class ProbeProviderError extends Error {
  constructor(
    readonly code: string,
    readonly dispatch: "before_dispatch" | "after_dispatch_uncertain",
    readonly httpStatus: number | null = null
  ) {
    super(code);
    this.name = "ProbeProviderError";
  }
}

export interface DecideWithOpenAiInput {
  readonly envelope: ProbeCalibrationEnvelope;
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

function extractOutput(response: z.infer<typeof responseEnvelopeSchema>): {
  readonly outputText: string | null;
  readonly refusal: string | null;
  readonly error: string | null;
} {
  const outputTexts: string[] = [];
  const refusals: string[] = [];
  for (const item of response.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const entry of content) {
      if (!entry || typeof entry !== "object") continue;
      const type = (entry as { type?: unknown }).type;
      if (type === "output_text" && typeof (entry as { text?: unknown }).text === "string") {
        outputTexts.push((entry as { text: string }).text);
      }
      if (type === "refusal" && typeof (entry as { refusal?: unknown }).refusal === "string") {
        refusals.push((entry as { refusal: string }).refusal);
      }
    }
  }
  if (refusals.length > 0) {
    return {
      outputText: outputTexts.length === 1 ? (outputTexts[0] ?? null) : null,
      refusal: refusals.join("\n").slice(0, 4_000),
      error: "provider_refusal"
    };
  }
  if (outputTexts.length !== 1) {
    return { outputText: null, refusal: null, error: "invalid_output_count" };
  }
  return { outputText: outputTexts[0] as string, refusal: null, error: null };
}

async function boundedResponseText(response: Response): Promise<string> {
  if (!response.body)
    throw new ProbeProviderError("missing_provider_body", "after_dispatch_uncertain");
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > PROBE_MAX_PROVIDER_RESPONSE_BYTES) {
      throw new ProbeProviderError("provider_response_too_large", "after_dispatch_uncertain");
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
      if (total > PROBE_MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel("provider_response_too_large");
        throw new ProbeProviderError("provider_response_too_large", "after_dispatch_uncertain");
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
    throw new ProbeProviderError("invalid_provider_utf8", "after_dispatch_uncertain");
  }
}

function parseJson(source: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new ProbeProviderError("invalid_provider_json", "after_dispatch_uncertain");
  }
}

async function requestBody(input: {
  readonly envelope: ProbeCalibrationEnvelope;
  readonly safetyIdentifier: string;
}) {
  const envelope = parseExpectationFreeCalibrationEnvelope(input.envelope);
  const transport = await verifyProbeTransportBinding(envelope);
  const modelInput = createProbeModelInput(envelope);
  const format = createProbeDecisionJsonSchema(envelope.liveManifest, transport);
  const body = {
    model: PROBE_MODEL,
    instructions: PROBE_GENERIC_RUNNER_PROMPT,
    input: canonicalJson(modelInput),
    reasoning: { effort: PROBE_RUNNER_SETTINGS_MANIFEST.reasoningEffort },
    text: {
      format: {
        type: "json_schema",
        name: format.name,
        strict: format.strict,
        schema: format.schema
      },
      verbosity: "low"
    },
    max_output_tokens: PROBE_MAX_OUTPUT_TOKENS,
    parallel_tool_calls: false,
    store: false,
    truncation: "disabled",
    service_tier: "default",
    safety_identifier: input.safetyIdentifier
  } as const;
  assertNoProbeExpectationLeakage(modelInput);
  return { envelope, transport, modelInput, format, body };
}

export async function decideWithOpenAi(
  input: DecideWithOpenAiInput
): Promise<ProbeProviderKnownReceipt> {
  if (!input.apiKey.trim()) throw new ProbeProviderError("missing_provider_key", "before_dispatch");
  if (!/^[a-f0-9]{64}$/u.test(input.safetyIdentifier)) {
    throw new ProbeProviderError("invalid_safety_identifier", "before_dispatch");
  }
  const prepared = await requestBody(input);
  const requestBodyBytes = canonicalJson(prepared.body);
  if (new TextEncoder().encode(requestBodyBytes).byteLength > PROBE_MAX_PROVIDER_REQUEST_BYTES) {
    throw new ProbeProviderError("provider_request_too_large", "before_dispatch");
  }
  const fetchImplementation = input.fetchImplementation ?? globalThis.fetch;
  const timeoutMs = input.timeoutMs ?? PROBE_PROVIDER_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > PROBE_PROVIDER_TIMEOUT_MS) {
    throw new ProbeProviderError("invalid_provider_timeout", "before_dispatch");
  }
  const now = input.now ?? Date.now;
  if (input.beforeDispatch) await input.beforeDispatch();
  const startedMs = now();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Probe provider timeout", "TimeoutError")),
    timeoutMs
  );
  let response: Response;
  try {
    response = await fetchImplementation(PROBE_OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: requestBodyBytes,
      signal: controller.signal,
      redirect: "error"
    });
  } catch {
    clearTimeout(timeout);
    throw new ProbeProviderError("provider_dispatch_uncertain", "after_dispatch_uncertain");
  }

  let rawResponseBytes: string;
  try {
    if (!response.ok) {
      await boundedResponseText(response).catch(() => "");
      throw new ProbeProviderError(
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
  const parsedResponse = responseEnvelopeSchema.safeParse(rawResponse);
  if (!parsedResponse.success) {
    throw new ProbeProviderError("invalid_provider_envelope", "after_dispatch_uncertain");
  }
  if (parsedResponse.data.model !== PROBE_MODEL) {
    throw new ProbeProviderError("provider_model_mismatch", "after_dispatch_uncertain");
  }
  const usage = parsedResponse.data.usage;
  if (!usage) throw new ProbeProviderError("missing_provider_usage", "after_dispatch_uncertain");
  if (usage.total_tokens < usage.input_tokens + usage.output_tokens) {
    throw new ProbeProviderError("invalid_provider_usage", "after_dispatch_uncertain");
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
    throw new ProbeProviderError("provider_usage_out_of_policy", "after_dispatch_uncertain");
  }

  const extracted = extractOutput(parsedResponse.data);
  let decision: ProbeDecision | null = null;
  let decisionError = extracted.error;
  if (parsedResponse.data.status !== "completed") {
    decisionError = `provider_${parsedResponse.data.status}`;
  } else if (!decisionError && extracted.outputText !== null) {
    try {
      decision = parseProbeDecisionOutput(
        JSON.parse(extracted.outputText),
        prepared.envelope.liveManifest,
        prepared.transport
      );
    } catch {
      decisionError = "invalid_structured_decision";
    }
  }
  const usageReceipt: ProbeProviderUsage = Object.freeze({
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
    accountedNanoUsd,
    costBasis: "frozen-list-price-plus-10pct-uplift"
  });
  const requestBodyHash = await sha256Hex(requestBodyBytes);
  const rawResponseHash = await sha256Hex(rawResponseBytes);
  const usageHash = await canonicalSha256(usageReceipt);
  const decisionSchemaHash = await canonicalSha256(prepared.format);
  const modelInputHash = await canonicalSha256(prepared.modelInput);

  return Object.freeze({
    version: "toolproof-probe-provider@1.0.0",
    provider: "OpenAI",
    endpoint: PROBE_OPENAI_ENDPOINT,
    model: PROBE_MODEL,
    requestId: response.headers.get("x-request-id"),
    responseId: parsedResponse.data.id,
    responseStatus: parsedResponse.data.status,
    requestBodyBytes,
    requestBodyHash,
    rawResponseBytes,
    rawResponseHash,
    rawResponse,
    outputText: extracted.outputText,
    decision,
    decisionError,
    refusal: extracted.refusal,
    usage: usageReceipt,
    usageHash,
    promptHash: await probeRunnerPromptHash(),
    settingsHash: await probeRunnerSettingsHash(),
    decisionSchemaHash,
    transportBindingHash: prepared.transport.bindingHash,
    modelInputHash,
    dispatchedAt: exactTimestamp(startedMs),
    completedAt: exactTimestamp(completedMs),
    durationMs: Math.max(0, completedMs - startedMs),
    providerCallCount: 1,
    store: false,
    previousResponseId: null,
    conversationId: null
  });
}
