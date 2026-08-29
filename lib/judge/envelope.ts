import { createCheckoutFixture } from "@/lib/domain/checkout";
import { CHECKOUT_FIXTURE_STATE_HASH } from "@/lib/domain/checkout-reset";
import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { fallbackNoCallJsonSchemaHash } from "@/lib/fallback/openai-tool-decision";
import {
  FALLBACK_GENERIC_RUNNER_PROMPT,
  FALLBACK_RUNNER_PROMPT_VERSION,
  fallbackRunnerPromptHash
} from "@/lib/fallback/runner-contract";
import { JUDGE_DEMO_LANE } from "@/lib/judge/contract";
import {
  PROBE_FIXTURE_SYNOPSIS_VERSION,
  PROBE_MODEL_INPUT_VERSION,
  assertNoProbeExpectationLeakage,
  createProbeFixtureSynopsis,
  createProbeTransportBinding,
  probeFixtureSynopsisSchema,
  probeLiveManifestSchema,
  probeModelInputSchema,
  probeTransportBindingSchema,
  type ProbeModelInput
} from "@/lib/probe/calibration-envelope";
import { probeFunctionToolDefinitionsHash } from "@/lib/probe/decision";
import {
  PROBE_MAX_INPUT_TOKENS,
  PROBE_MAX_OUTPUT_TOKENS,
  PROBE_MODEL,
  PROBE_PROVIDER
} from "@/lib/probe/policy";
import { createCheckoutLiveManifest } from "@/lib/webmcp/live-manifest.server";
import { z } from "zod";

import frozenEvidenceRootEnvelopeJson from "../../evidence/judge-root-envelope.json";

export const JUDGE_DEMO_ENVELOPE_VERSION = "toolproof-judge-demo-envelope@1.0.0";
export const JUDGE_DEMO_CASE_ID = "judge_multi_quantity_lines_v1" as const;
export const JUDGE_DEMO_REQUEST =
  "Which current cart lines have a quantity greater than one?" as const;
export const JUDGE_DEMO_RUNNER_SETTINGS_VERSION = "toolproof-judge-demo-runner-settings@1.0.0";
export const JUDGE_DEMO_EVIDENCE_ROOT_COMMIT = "e2cf8d47375abfeeb4f32bd6f5973918acf4c091";
export const JUDGE_DEMO_EVIDENCE_ROOT_ENVELOPE_HASH =
  "bc8ef35d5df7136dc88d19ec6850d76bd804cbf6f52f343e7754bd25d9b26687";

export const JUDGE_DEMO_RUNNER_SETTINGS = Object.freeze({
  version: JUDGE_DEMO_RUNNER_SETTINGS_VERSION,
  provider: PROBE_PROVIDER,
  model: PROBE_MODEL,
  api: "responses" as const,
  store: false as const,
  reasoningEffort: "low" as const,
  maximumInputTokens: PROBE_MAX_INPUT_TOKENS,
  maximumOutputTokens: PROBE_MAX_OUTPUT_TOKENS,
  maximumProviderCalls: 1 as const,
  maximumTargetCallsPerDocument: 1 as const,
  toolChoice: "auto" as const,
  parallelToolCalls: false as const,
  functionStrictMode: true as const,
  noCallResponseFormat: "strict-json-schema" as const,
  conversationId: null,
  previousResponseId: null,
  providerRetryCount: 0 as const,
  nativeExecutionBoundary: "separate-current-browser-local-evidence" as const
});

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

export const judgeDemoRunnerBindingSchema = z
  .object({
    promptVersion: z.literal(FALLBACK_RUNNER_PROMPT_VERSION),
    promptHash: sha256,
    settingsVersion: z.literal(JUDGE_DEMO_RUNNER_SETTINGS_VERSION),
    settingsHash: sha256,
    toolDefinitionsHash: sha256,
    noCallSchemaHash: sha256,
    transport: probeTransportBindingSchema
  })
  .strict();

export const judgeDemoEnvelopeSchema = z
  .object({
    version: z.literal(JUDGE_DEMO_ENVELOPE_VERSION),
    lane: z.literal(JUDGE_DEMO_LANE),
    purpose: z.literal("judge"),
    sourceFixed: z.literal(true),
    arbitraryPromptAccepted: z.literal(false),
    buildCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    runId: z.string().regex(/^run_[A-Za-z0-9_-]{22}$/u),
    caseId: z.string().regex(/^case_[A-Za-z0-9_-]{22}$/u),
    trialId: z.string().regex(/^trial_[A-Za-z0-9_-]{22}$/u),
    publicCaseId: z.literal(JUDGE_DEMO_CASE_ID),
    naturalLanguageRequest: z.literal(JUDGE_DEMO_REQUEST),
    fixtureHash: z.literal(CHECKOUT_FIXTURE_STATE_HASH),
    fixture: probeFixtureSynopsisSchema,
    liveManifest: probeLiveManifestSchema,
    runner: judgeDemoRunnerBindingSchema,
    runnerHash: sha256,
    envelopeHash: sha256
  })
  .strict();

export type JudgeDemoEnvelope = z.infer<typeof judgeDemoEnvelopeSchema>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
  }
  return value;
}

function id(prefix: "run" | "case" | "trial", digest: string): string {
  return `${prefix}_${digest.slice(0, 22)}`;
}

export function judgeDemoRunnerSettingsHash(): Promise<string> {
  return canonicalSha256(JUDGE_DEMO_RUNNER_SETTINGS);
}

export async function judgeDemoRunnerHash(): Promise<string> {
  return canonicalSha256({
    version: "toolproof-judge-demo-runner@1.0.0",
    prompt: { version: FALLBACK_RUNNER_PROMPT_VERSION, text: FALLBACK_GENERIC_RUNNER_PROMPT },
    promptHash: await fallbackRunnerPromptHash(),
    settingsHash: await judgeDemoRunnerSettingsHash()
  });
}

async function frozenEvidenceRootEnvelope(): Promise<JudgeDemoEnvelope> {
  assertNoProbeExpectationLeakage(frozenEvidenceRootEnvelopeJson);
  const parsed = judgeDemoEnvelopeSchema.parse(frozenEvidenceRootEnvelopeJson);
  const { envelopeHash, ...unsigned } = parsed;
  if (
    parsed.buildCommit !== JUDGE_DEMO_EVIDENCE_ROOT_COMMIT ||
    envelopeHash !== JUDGE_DEMO_EVIDENCE_ROOT_ENVELOPE_HASH ||
    (await canonicalSha256(unsigned)) !== envelopeHash
  ) {
    throw new Error("judge_demo_root_envelope_binding_invalid");
  }
  return deepFreeze(JSON.parse(canonicalJson(parsed)) as JudgeDemoEnvelope);
}

export async function createJudgeDemoEnvelope(appCommit: string): Promise<JudgeDemoEnvelope> {
  if (!/^[a-f0-9]{40}$/u.test(appCommit)) throw new TypeError("judge_demo_commit_invalid");
  if (appCommit === JUDGE_DEMO_EVIDENCE_ROOT_COMMIT) {
    return frozenEvidenceRootEnvelope();
  }
  const identitySeed = await canonicalSha256({
    version: JUDGE_DEMO_ENVELOPE_VERSION,
    lane: JUDGE_DEMO_LANE,
    appCommit,
    publicCaseId: JUDGE_DEMO_CASE_ID,
    request: JUDGE_DEMO_REQUEST
  });
  const identity = {
    runId: id("run", await canonicalSha256({ identitySeed, kind: "run" })),
    caseId: id("case", await canonicalSha256({ identitySeed, kind: "case" })),
    trialId: id("trial", await canonicalSha256({ identitySeed, kind: "trial" }))
  };
  const fixture = createCheckoutFixture();
  const liveManifest = await createCheckoutLiveManifest(fixture, appCommit);
  const transport = await createProbeTransportBinding(identity);
  const [promptHash, settingsHash, toolDefinitionsHash, noCallSchemaHash, runnerHash] =
    await Promise.all([
      fallbackRunnerPromptHash(),
      judgeDemoRunnerSettingsHash(),
      probeFunctionToolDefinitionsHash(liveManifest, transport),
      fallbackNoCallJsonSchemaHash(),
      judgeDemoRunnerHash()
    ]);
  const unsigned = {
    version: JUDGE_DEMO_ENVELOPE_VERSION,
    lane: JUDGE_DEMO_LANE,
    purpose: "judge" as const,
    sourceFixed: true as const,
    arbitraryPromptAccepted: false as const,
    buildCommit: appCommit,
    ...identity,
    publicCaseId: JUDGE_DEMO_CASE_ID,
    naturalLanguageRequest: JUDGE_DEMO_REQUEST,
    fixtureHash: CHECKOUT_FIXTURE_STATE_HASH,
    fixture: createProbeFixtureSynopsis(fixture),
    liveManifest,
    runner: {
      promptVersion: FALLBACK_RUNNER_PROMPT_VERSION,
      promptHash,
      settingsVersion: JUDGE_DEMO_RUNNER_SETTINGS_VERSION,
      settingsHash,
      toolDefinitionsHash,
      noCallSchemaHash,
      transport
    },
    runnerHash
  };
  const envelope = judgeDemoEnvelopeSchema.parse({
    ...unsigned,
    envelopeHash: await canonicalSha256(unsigned)
  });
  assertNoProbeExpectationLeakage(envelope);
  return deepFreeze(JSON.parse(canonicalJson(envelope)) as JudgeDemoEnvelope);
}

export async function verifyJudgeDemoEnvelope(value: unknown): Promise<JudgeDemoEnvelope> {
  assertNoProbeExpectationLeakage(value);
  const parsed = judgeDemoEnvelopeSchema.parse(value);
  const expected = await createJudgeDemoEnvelope(parsed.buildCommit);
  if (canonicalJson(parsed) !== canonicalJson(expected)) {
    throw new Error("judge_demo_envelope_binding_mismatch");
  }
  return expected;
}

export function createJudgeDemoModelInput(envelope: JudgeDemoEnvelope): ProbeModelInput {
  const input = probeModelInputSchema.parse({
    version: PROBE_MODEL_INPUT_VERSION,
    request: envelope.naturalLanguageRequest,
    fixture: envelope.fixture,
    tools: envelope.liveManifest.tools
  });
  assertNoProbeExpectationLeakage(input);
  return deepFreeze(JSON.parse(canonicalJson(input)) as ProbeModelInput);
}

if (PROBE_FIXTURE_SYNOPSIS_VERSION.length < 1) {
  throw new Error("judge_demo_fixture_contract_missing");
}
