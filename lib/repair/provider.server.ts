import "server-only";

import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import {
  PROBE_MAX_INPUT_TOKENS,
  PROBE_MAX_OUTPUT_TOKENS,
  PROBE_MODEL,
  PROBE_PER_CALL_RESERVATION_NANO_USD,
  calculateProbeCostNanoUsd
} from "@/lib/probe/policy";
import type { RepairDevelopmentPackage } from "@/lib/repair/development-package.server";
import {
  GATE5_REPAIR_BUILDER_RECEIPT_VERSION,
  gate5RepairBuilderReceiptSchema,
  type Gate5RepairBuilderReceipt
} from "@/lib/semantic/revision-freeze.server";
import { z } from "zod";

export const REPAIR_BUILDER_PROMPT_VERSION = "toolproof-repair-builder-prompt@1.0.0";
export const REPAIR_BUILDER_SETTINGS_VERSION = "toolproof-repair-builder-settings@1.0.0";
export const REPAIR_OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";
export const REPAIR_PROVIDER_TIMEOUT_MS = 20_000;

export const REPAIR_BUILDER_PROMPT = [
  "You are a fresh, stateless ToolProof Repair Builder.",
  "You receive only a development-only semantic-evaluation package for a synthetic checkout sandbox.",
  "Propose exactly one replacement for checkout_request.description.",
  "Preserve the tool name, input schema, annotations, handlers, domain logic, fixture, cases, expectations, evaluator, runner, and retry policy.",
  "Make the explicit commitment boundary precise without adding hidden requirements, examples tailored to individual cases, or theatrical wording.",
  "Do not infer or discuss holdout prompts or results; none are supplied.",
  "Return only the strict structured response."
].join(" ");

const repairOutputSchema = z
  .object({
    proposedDescription: z.string().min(40).max(500),
    rationale: z.string().min(20).max(4_000)
  })
  .strict();

const responseSchema = z
  .object({
    id: z.string().min(1).max(256),
    object: z.literal("response"),
    model: z.string(),
    status: z.literal("completed"),
    output: z.array(z.unknown()).max(32),
    usage: z
      .object({
        input_tokens: z.number().int().nonnegative(),
        output_tokens: z.number().int().nonnegative(),
        total_tokens: z.number().int().nonnegative()
      })
      .passthrough()
  })
  .passthrough();

export interface RepairProviderKnownReceipt {
  readonly repairBuilderReceipt: Gate5RepairBuilderReceipt;
  readonly responseId: string;
  readonly rawResponseBytes: string;
  readonly rawResponseHash: string;
  readonly usageHash: string;
  readonly actualNanoUsd: number;
  readonly promptHash: string;
  readonly settingsHash: string;
  readonly providerCallCount: 1;
}

function repairBuilderModelPackage(developmentPackage: RepairDevelopmentPackage) {
  return Object.freeze({
    version: developmentPackage.version,
    evidenceLabel: developmentPackage.evidenceLabel,
    changedField: developmentPackage.changedField,
    currentDescription: developmentPackage.currentDescription,
    taskBoundary: developmentPackage.taskBoundary,
    liveManifest: developmentPackage.liveManifest,
    developmentCaseCount: developmentPackage.developmentCaseCount,
    developmentAggregate: developmentPackage.developmentAggregate,
    meaningContractTupleSchema: developmentPackage.meaningContractTupleSchema,
    meaningContracts: developmentPackage.meaningContracts,
    rowTupleSchema: developmentPackage.rowTupleSchema,
    traceTupleSchema: developmentPackage.traceTupleSchema,
    rows: developmentPackage.rows,
    holdoutDataIncluded: false as const
  });
}

export class RepairProviderError extends Error {
  constructor(
    readonly code: string,
    readonly dispatch: "before_dispatch" | "after_dispatch_uncertain"
  ) {
    super(code);
    this.name = "RepairProviderError";
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactOutputText(output: readonly unknown[]): string {
  const texts: string[] = [];
  let forbidden = false;
  for (const item of output) {
    const message = objectValue(item);
    if (!message || message.type !== "message" || !Array.isArray(message.content)) {
      if (message?.type === "function_call") forbidden = true;
      continue;
    }
    for (const itemContent of message.content) {
      const content = objectValue(itemContent);
      if (content?.type === "output_text" && typeof content.text === "string") {
        texts.push(content.text);
      } else if (content?.type === "refusal") {
        forbidden = true;
      }
    }
  }
  if (forbidden || texts.length !== 1 || texts[0]!.length > 8_000) {
    throw new RepairProviderError("repair_provider_output_invalid", "after_dispatch_uncertain");
  }
  return texts[0]!;
}

export async function runRepairBuilder(input: {
  readonly developmentPackage: RepairDevelopmentPackage;
  readonly apiKey: string;
  readonly contextId: string;
  readonly safetyIdentifier: string;
  readonly fetchImplementation?: typeof fetch;
  readonly beforeDispatch: () => Promise<void>;
  readonly now?: () => number;
}): Promise<RepairProviderKnownReceipt> {
  if (
    !input.apiKey.trim() ||
    !/^repair_[A-Za-z0-9_-]{22}$/u.test(input.contextId) ||
    !/^[a-f0-9]{64}$/u.test(input.safetyIdentifier)
  ) {
    throw new RepairProviderError("repair_provider_input_invalid", "before_dispatch");
  }
  const body = {
    model: PROBE_MODEL,
    instructions: REPAIR_BUILDER_PROMPT,
    input: canonicalJson(repairBuilderModelPackage(input.developmentPackage)),
    reasoning: { effort: "low" },
    text: {
      format: {
        type: "json_schema",
        name: "toolproof_repair_proposal_v1",
        strict: true,
        schema: {
          type: "object",
          properties: {
            proposedDescription: { type: "string", minLength: 40, maxLength: 500 },
            rationale: { type: "string", minLength: 20, maxLength: 4_000 }
          },
          required: ["proposedDescription", "rationale"],
          additionalProperties: false
        }
      },
      verbosity: "low"
    },
    max_output_tokens: PROBE_MAX_OUTPUT_TOKENS,
    store: false,
    truncation: "disabled",
    service_tier: "default",
    safety_identifier: input.safetyIdentifier
  };
  const requestBytes = canonicalJson(body);
  if (Buffer.byteLength(requestBytes, "utf8") > 64 * 1_024) {
    throw new RepairProviderError("repair_request_too_large", "before_dispatch");
  }
  await input.beforeDispatch();
  const now = input.now ?? Date.now;
  const startedAt = now();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Repair provider timeout", "TimeoutError")),
    REPAIR_PROVIDER_TIMEOUT_MS
  );
  let response: Response;
  try {
    response = await (input.fetchImplementation ?? globalThis.fetch)(REPAIR_OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: requestBytes,
      signal: controller.signal,
      redirect: "error"
    });
  } catch {
    clearTimeout(timeout);
    throw new RepairProviderError("repair_provider_dispatch_uncertain", "after_dispatch_uncertain");
  }
  let rawResponseBytes: string;
  try {
    rawResponseBytes = await response.text();
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok || Buffer.byteLength(rawResponseBytes, "utf8") > 128 * 1_024) {
    throw new RepairProviderError("repair_provider_http_error", "after_dispatch_uncertain");
  }
  let parsed: z.infer<typeof responseSchema>;
  try {
    parsed = responseSchema.parse(JSON.parse(rawResponseBytes));
  } catch {
    throw new RepairProviderError("repair_provider_response_invalid", "after_dispatch_uncertain");
  }
  const proposal = repairOutputSchema.parse(JSON.parse(exactOutputText(parsed.output)));
  const actualNanoUsd = calculateProbeCostNanoUsd({
    inputTokens: parsed.usage.input_tokens,
    outputTokens: parsed.usage.output_tokens
  });
  if (
    parsed.usage.input_tokens > PROBE_MAX_INPUT_TOKENS ||
    parsed.usage.output_tokens > PROBE_MAX_OUTPUT_TOKENS ||
    actualNanoUsd > PROBE_PER_CALL_RESERVATION_NANO_USD
  ) {
    throw new RepairProviderError("repair_provider_usage_invalid", "after_dispatch_uncertain");
  }
  const receiptPayload = {
    version: GATE5_REPAIR_BUILDER_RECEIPT_VERSION,
    contextId: input.contextId,
    contextClass: "fresh-stateless-application-api" as const,
    provider: "OpenAI" as const,
    model: PROBE_MODEL,
    store: false as const,
    baselineRunId: input.developmentPackage.baselineRunId,
    baselineEvidenceDigest: input.developmentPackage.baselineEvidenceDigest,
    developmentPackageHash: input.developmentPackage.packageHash,
    developmentCaseCount: 12 as const,
    holdoutPromptCountReceived: 0 as const,
    holdoutResultCountReceived: 0 as const,
    filesystemAccess: false as const,
    browserAccess: false as const,
    sourceBriefAccess: false as const,
    fullContractAccess: false as const,
    proposedField: "checkout_request.description" as const,
    proposedDescription: proposal.proposedDescription.trim(),
    rationale: proposal.rationale,
    createdAt: new Date(startedAt).toISOString()
  };
  const repairBuilderReceipt = gate5RepairBuilderReceiptSchema.parse({
    ...receiptPayload,
    receiptHash: await canonicalSha256(receiptPayload)
  });
  const usage = {
    inputTokens: parsed.usage.input_tokens,
    outputTokens: parsed.usage.output_tokens,
    totalTokens: parsed.usage.total_tokens,
    actualNanoUsd
  };
  return Object.freeze({
    repairBuilderReceipt,
    responseId: parsed.id,
    rawResponseBytes,
    rawResponseHash: await sha256Hex(rawResponseBytes),
    usageHash: await canonicalSha256(usage),
    actualNanoUsd,
    promptHash: await canonicalSha256({
      version: REPAIR_BUILDER_PROMPT_VERSION,
      prompt: REPAIR_BUILDER_PROMPT
    }),
    settingsHash: await canonicalSha256({
      version: REPAIR_BUILDER_SETTINGS_VERSION,
      model: PROBE_MODEL,
      reasoningEffort: "low",
      store: false,
      maxOutputTokens: PROBE_MAX_OUTPUT_TOKENS,
      previousResponseId: null,
      conversationId: null
    }),
    providerCallCount: 1
  });
}
