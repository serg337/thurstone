import { canonicalJson } from "@/lib/evidence/digest";
import {
  createFallbackNoCallJsonSchema,
  type FallbackToolDecisionReceipt
} from "@/lib/fallback/openai-tool-decision";
import { FALLBACK_GENERIC_RUNNER_PROMPT } from "@/lib/fallback/runner-contract";
import {
  JUDGE_DEMO_RUNNER_SETTINGS,
  createJudgeDemoModelInput,
  verifyJudgeDemoEnvelope,
  type JudgeDemoEnvelope
} from "@/lib/judge/envelope";
import { assertNoProbeExpectationLeakage } from "@/lib/probe/calibration-envelope";
import {
  createProbeFunctionToolDefinitions,
  parseProbeDecision,
  parseProbeDecisionOutput,
  type ProbeDecision
} from "@/lib/probe/decision";
import { PROBE_MAX_OUTPUT_TOKENS, PROBE_MODEL } from "@/lib/probe/policy";
import { z } from "zod";

export const JUDGE_DEMO_DECISION_REQUEST_VERSION = "toolproof-judge-demo-decision-request@1.0.0";
export const JUDGE_DEMO_DECISION_RECEIPT_VERSION = "toolproof-judge-demo-decision-receipt@1.0.0";

const usageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative()
  })
  .passthrough();

const responseSchema = z
  .object({
    id: z.string().min(1).max(256),
    object: z.literal("response"),
    model: z.string().min(1).max(256),
    status: z.enum(["completed", "failed", "in_progress", "cancelled", "queued", "incomplete"]),
    output: z.array(z.unknown()).max(32),
    usage: usageSchema.nullable()
  })
  .passthrough();

export interface JudgeDemoPreparedRequest {
  readonly version: typeof JUDGE_DEMO_DECISION_REQUEST_VERSION;
  readonly envelope: JudgeDemoEnvelope;
  readonly body: Readonly<Record<string, unknown>>;
  readonly requestBodyBytes: string;
}

export interface JudgeDemoDecisionReceipt extends Omit<FallbackToolDecisionReceipt, "version"> {
  readonly version: typeof JUDGE_DEMO_DECISION_RECEIPT_VERSION;
}

export async function createJudgeDemoDecisionRequest(input: {
  readonly envelope: unknown;
  readonly safetyIdentifier: string;
}): Promise<JudgeDemoPreparedRequest> {
  if (!/^[a-f0-9]{64}$/u.test(input.safetyIdentifier)) {
    throw new Error("judge_demo_safety_identifier_invalid");
  }
  const envelope = await verifyJudgeDemoEnvelope(input.envelope);
  const noCall = createFallbackNoCallJsonSchema();
  const body = Object.freeze({
    model: PROBE_MODEL,
    instructions: FALLBACK_GENERIC_RUNNER_PROMPT,
    input: canonicalJson(createJudgeDemoModelInput(envelope)),
    reasoning: { effort: JUDGE_DEMO_RUNNER_SETTINGS.reasoningEffort },
    tools: createProbeFunctionToolDefinitions(envelope.liveManifest, envelope.runner.transport),
    tool_choice: "auto" as const,
    parallel_tool_calls: false as const,
    text: {
      format: {
        type: "json_schema" as const,
        name: noCall.name,
        strict: true as const,
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
    version: JUDGE_DEMO_DECISION_REQUEST_VERSION,
    envelope,
    body,
    requestBodyBytes: canonicalJson(body)
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extract(output: readonly unknown[]) {
  const calls: Record<string, unknown>[] = [];
  const texts: string[] = [];
  const refusals: string[] = [];
  for (const item of output) {
    const outer = record(item);
    if (!outer) continue;
    if (outer.type === "function_call") {
      calls.push(outer);
      continue;
    }
    if (outer.type !== "message" || !Array.isArray(outer.content)) continue;
    for (const itemContent of outer.content) {
      const content = record(itemContent);
      if (content?.type === "output_text" && typeof content.text === "string") {
        texts.push(content.text);
      }
      if (content?.type === "refusal" && typeof content.refusal === "string") {
        refusals.push(content.refusal);
      }
    }
  }
  return { calls, texts, refusals };
}

export async function parseJudgeDemoDecisionResponse(
  value: unknown,
  envelopeValue: unknown
): Promise<JudgeDemoDecisionReceipt> {
  const envelope = await verifyJudgeDemoEnvelope(envelopeValue);
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success || parsed.data.model !== PROBE_MODEL) {
    throw new Error("judge_demo_provider_envelope_invalid");
  }
  const output = extract(parsed.data.output);
  let decision: ProbeDecision | null = null;
  let decisionError: string | null = null;
  let refusal: string | null = null;
  let toolCallId: string | null = null;
  let rawArgumentsBytes: string | null = null;
  let outputText: string | null = null;

  if (parsed.data.status !== "completed") {
    decisionError = `provider_${parsed.data.status}`;
  } else if (output.refusals.length > 0) {
    refusal = output.refusals.join("\n").slice(0, 4_000);
    decisionError = "provider_refusal";
  } else if (output.calls.length === 1 && output.texts.length === 0) {
    const call = output.calls[0]!;
    if (
      typeof call.name !== "string" ||
      typeof call.arguments !== "string" ||
      typeof call.call_id !== "string"
    ) {
      decisionError = "invalid_function_call";
    } else {
      toolCallId = call.call_id;
      rawArgumentsBytes = call.arguments;
      try {
        decision = parseProbeDecision(
          { kind: "call", tool: call.name, arguments: JSON.parse(call.arguments) as unknown },
          envelope.liveManifest,
          envelope.runner.transport
        );
      } catch {
        decisionError = "invalid_function_call";
      }
    }
  } else if (output.calls.length === 0 && output.texts.length === 1) {
    outputText = output.texts[0]!;
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
    version: JUDGE_DEMO_DECISION_RECEIPT_VERSION,
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
    toolCallCount: output.calls.length,
    store: false as const,
    previousResponseId: null,
    conversationId: null,
    usage: parsed.data.usage
  });
}
