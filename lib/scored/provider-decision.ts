import { canonicalJson } from "@/lib/evidence/digest";
import {
  createFallbackNoCallJsonSchema,
  type FallbackToolDecisionReceipt
} from "@/lib/fallback/openai-tool-decision";
import {
  FALLBACK_GENERIC_RUNNER_PROMPT,
  FALLBACK_RUNNER_SETTINGS_MANIFEST
} from "@/lib/fallback/runner-contract";
import {
  assertNoProbeExpectationLeakage,
  type ProbeLiveManifest,
  type ProbeTransportBinding
} from "@/lib/probe/calibration-envelope";
import {
  createProbeFunctionToolDefinitions,
  parseProbeDecision,
  parseProbeDecisionOutput,
  type ProbeDecision
} from "@/lib/probe/decision";
import { PROBE_MAX_OUTPUT_TOKENS, PROBE_MODEL } from "@/lib/probe/policy";
import {
  createScoredModelInput,
  verifyExpectationFreeScoredEnvelope,
  type ScoredTrialEnvelope
} from "@/lib/scored/envelope";
import { z } from "zod";

export const SCORED_TOOL_DECISION_REQUEST_VERSION = "toolproof-scored-tool-decision-request@1.0.0";
export const SCORED_TOOL_DECISION_RECEIPT_VERSION = "toolproof-scored-tool-decision-receipt@1.0.0";

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
    model: z.string().min(1).max(256),
    status: z.enum(["completed", "failed", "in_progress", "cancelled", "queued", "incomplete"]),
    output: z.array(z.unknown()).max(32),
    usage: responseUsageSchema.nullable()
  })
  .passthrough();

export class ScoredToolDecisionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ScoredToolDecisionError";
  }
}

export interface PreparedScoredToolDecisionRequest {
  readonly version: typeof SCORED_TOOL_DECISION_REQUEST_VERSION;
  readonly envelope: ScoredTrialEnvelope;
  readonly body: Readonly<Record<string, unknown>>;
  readonly requestBodyBytes: string;
  readonly toolDefinitionsHash: string;
  readonly noCallSchemaHash: string;
}

export interface ScoredToolDecisionReceipt extends Omit<FallbackToolDecisionReceipt, "version"> {
  readonly version: typeof SCORED_TOOL_DECISION_RECEIPT_VERSION;
}

export async function createScoredToolDecisionRequest(input: {
  readonly envelope: unknown;
  readonly safetyIdentifier: string;
}): Promise<PreparedScoredToolDecisionRequest> {
  if (!/^[a-f0-9]{64}$/u.test(input.safetyIdentifier)) {
    throw new ScoredToolDecisionError("invalid_safety_identifier");
  }
  const envelope = await verifyExpectationFreeScoredEnvelope(input.envelope);
  const modelInput = createScoredModelInput(envelope);
  const tools = createProbeFunctionToolDefinitions(
    envelope.liveManifest,
    envelope.runner.transport
  );
  const noCall = createFallbackNoCallJsonSchema();
  if (
    envelope.runner.toolDefinitionsHash.length !== 64 ||
    envelope.runner.noCallSchemaHash.length !== 64
  ) {
    throw new ScoredToolDecisionError("scored_runner_binding_mismatch");
  }
  const body = Object.freeze({
    model: PROBE_MODEL,
    instructions: FALLBACK_GENERIC_RUNNER_PROMPT,
    input: canonicalJson(modelInput),
    reasoning: { effort: FALLBACK_RUNNER_SETTINGS_MANIFEST.reasoningEffort },
    tools,
    tool_choice: "auto" as const,
    parallel_tool_calls: false as const,
    text: {
      format: {
        type: "json_schema" as const,
        name: noCall.name,
        strict: noCall.strict,
        schema: noCall.schema
      },
      verbosity: "low" as const
    },
    max_output_tokens: PROBE_MAX_OUTPUT_TOKENS,
    store: false as const,
    truncation: "disabled" as const,
    service_tier: "default" as const,
    safety_identifier: input.safetyIdentifier
  });
  assertNoProbeExpectationLeakage(body);
  return Object.freeze({
    version: SCORED_TOOL_DECISION_REQUEST_VERSION,
    envelope,
    body,
    requestBodyBytes: canonicalJson(body),
    toolDefinitionsHash: envelope.runner.toolDefinitionsHash,
    noCallSchemaHash: envelope.runner.noCallSchemaHash
  });
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractResponseDecision(output: readonly unknown[]): {
  readonly functionCalls: readonly Record<string, unknown>[];
  readonly outputTexts: readonly string[];
  readonly refusals: readonly string[];
} {
  const functionCalls: Record<string, unknown>[] = [];
  const outputTexts: string[] = [];
  const refusals: string[] = [];
  for (const item of output) {
    const object = objectValue(item);
    if (!object) continue;
    if (object.type === "function_call") {
      functionCalls.push(object);
      continue;
    }
    if (object.type !== "message" || !Array.isArray(object.content)) continue;
    for (const entry of object.content) {
      const content = objectValue(entry);
      if (content?.type === "output_text" && typeof content.text === "string") {
        outputTexts.push(content.text);
      }
      if (content?.type === "refusal" && typeof content.refusal === "string") {
        refusals.push(content.refusal);
      }
    }
  }
  return { functionCalls, outputTexts, refusals };
}

function callDecision(
  call: Record<string, unknown>,
  manifest: ProbeLiveManifest,
  transport: ProbeTransportBinding
): {
  readonly decision: ProbeDecision | null;
  readonly error: string | null;
  readonly toolCallId: string | null;
  readonly rawArgumentsBytes: string | null;
} {
  if (
    typeof call.name !== "string" ||
    typeof call.arguments !== "string" ||
    typeof call.call_id !== "string"
  ) {
    return {
      decision: null,
      error: "invalid_function_call",
      toolCallId: null,
      rawArgumentsBytes: null
    };
  }
  try {
    return {
      decision: parseProbeDecision(
        {
          kind: "call",
          tool: call.name,
          arguments: JSON.parse(call.arguments) as unknown
        },
        manifest,
        transport
      ),
      error: null,
      toolCallId: call.call_id,
      rawArgumentsBytes: call.arguments
    };
  } catch {
    return {
      decision: null,
      error: "invalid_function_call",
      toolCallId: call.call_id,
      rawArgumentsBytes: call.arguments
    };
  }
}

export async function parseScoredToolDecisionResponse(
  value: unknown,
  envelopeValue: unknown
): Promise<ScoredToolDecisionReceipt> {
  const envelope = await verifyExpectationFreeScoredEnvelope(envelopeValue);
  const parsed = responseEnvelopeSchema.safeParse(value);
  if (!parsed.success || parsed.data.model !== PROBE_MODEL) {
    throw new ScoredToolDecisionError("invalid_provider_envelope");
  }
  const extracted = extractResponseDecision(parsed.data.output);
  let decision: ProbeDecision | null = null;
  let decisionError: string | null = null;
  let refusal: string | null = null;
  let toolCallId: string | null = null;
  let rawArgumentsBytes: string | null = null;
  let outputText: string | null = null;

  if (parsed.data.status !== "completed") {
    decisionError = `provider_${parsed.data.status}`;
  } else if (extracted.refusals.length > 0) {
    refusal = extracted.refusals.join("\n").slice(0, 4_000);
    decisionError = "provider_refusal";
  } else if (extracted.functionCalls.length === 1 && extracted.outputTexts.length === 0) {
    const parsedCall = callDecision(
      extracted.functionCalls[0]!,
      envelope.liveManifest,
      envelope.runner.transport
    );
    decision = parsedCall.decision;
    decisionError = parsedCall.error;
    toolCallId = parsedCall.toolCallId;
    rawArgumentsBytes = parsedCall.rawArgumentsBytes;
  } else if (extracted.functionCalls.length === 0 && extracted.outputTexts.length === 1) {
    outputText = extracted.outputTexts[0]!;
    try {
      const parsedDecision = parseProbeDecisionOutput(
        JSON.parse(outputText) as unknown,
        envelope.liveManifest,
        envelope.runner.transport
      );
      if (parsedDecision.kind === "call") throw new Error("text_call_forbidden");
      decision = parsedDecision;
    } catch {
      decisionError = "invalid_no_call_output";
    }
  } else {
    decisionError = "invalid_decision_output_count";
  }

  return Object.freeze({
    version: SCORED_TOOL_DECISION_RECEIPT_VERSION,
    responseId: parsed.data.id,
    responseStatus: parsed.data.status,
    model: PROBE_MODEL,
    decision,
    decisionError,
    refusal,
    toolCallId,
    rawArgumentsBytes,
    outputText,
    providerCallCount: 1 as const,
    toolCallCount: extracted.functionCalls.length,
    store: false as const,
    previousResponseId: null,
    conversationId: null,
    usage: parsed.data.usage
  });
}
