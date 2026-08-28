import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  assertNoProbeExpectationLeakage,
  createProbeTransportBinding,
  probeFixtureSynopsisSchema,
  probeLiveManifestSchema,
  probeModelInputSchema,
  probeTransportBindingSchema,
  type ProbeFixtureSynopsis,
  type ProbeLiveManifest,
  type ProbeModelInput,
  type ProbeTransportBinding
} from "@/lib/probe/calibration-envelope";
import {
  FALLBACK_IMPLEMENTATION,
  FALLBACK_RUNNER_PROMPT_VERSION,
  FALLBACK_RUNNER_SETTINGS_VERSION,
  FALLBACK_UPSTREAM_PIN
} from "@/lib/fallback/runner-contract";
import { z } from "zod";

export const FALLBACK_CALIBRATION_ENVELOPE_VERSION =
  "toolproof-fallback-calibration-envelope@1.0.0";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const identity = {
  buildCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  runId: z.string().regex(/^run_[A-Za-z0-9_-]{22}$/u),
  caseId: z.string().regex(/^case_[A-Za-z0-9_-]{22}$/u),
  trialId: z.string().regex(/^trial_[A-Za-z0-9_-]{22}$/u)
} as const;

export const fallbackRunnerBindingSchema = z
  .object({
    implementation: z.literal(FALLBACK_IMPLEMENTATION),
    upstreamCommit: z.literal(FALLBACK_UPSTREAM_PIN.commit),
    upstreamSubtree: z.literal(FALLBACK_UPSTREAM_PIN.subtree),
    promptVersion: z.literal(FALLBACK_RUNNER_PROMPT_VERSION),
    promptHash: sha256,
    settingsVersion: z.literal(FALLBACK_RUNNER_SETTINGS_VERSION),
    settingsHash: sha256,
    browserRuntimeHash: sha256,
    toolDefinitionsHash: sha256,
    noCallSchemaHash: sha256,
    transport: probeTransportBindingSchema
  })
  .strict();

export const fallbackCalibrationEnvelopeSchema = z
  .object({
    version: z.literal(FALLBACK_CALIBRATION_ENVELOPE_VERSION),
    purpose: z.literal("calibration"),
    ...identity,
    naturalLanguageRequest: z
      .string()
      .min(1)
      .max(2_000)
      .refine((value) => value.trim().length > 0),
    fixture: probeFixtureSynopsisSchema,
    liveManifest: probeLiveManifestSchema,
    runner: fallbackRunnerBindingSchema
  })
  .strict();

export type FallbackCalibrationEnvelope = z.infer<typeof fallbackCalibrationEnvelopeSchema>;
export type { ProbeFixtureSynopsis, ProbeLiveManifest, ProbeModelInput, ProbeTransportBinding };

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

function canonicalClone<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

export function parseExpectationFreeFallbackEnvelope(value: unknown): FallbackCalibrationEnvelope {
  assertNoProbeExpectationLeakage(value);
  return deepFreeze(canonicalClone(fallbackCalibrationEnvelopeSchema.parse(value)));
}

export async function verifyFallbackTransportBinding(
  value: FallbackCalibrationEnvelope
): Promise<ProbeTransportBinding> {
  const actual = probeTransportBindingSchema.parse(value.runner.transport);
  const expected = await createProbeTransportBinding(value);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error("fallback_transport_binding_mismatch");
  }
  return expected;
}

export function createFallbackModelInput(envelope: FallbackCalibrationEnvelope): ProbeModelInput {
  const parsed = parseExpectationFreeFallbackEnvelope(envelope);
  const projection = probeModelInputSchema.parse({
    version: "toolproof-probe-model-input@2.0.0",
    request: parsed.naturalLanguageRequest,
    fixture: parsed.fixture,
    tools: parsed.liveManifest.tools
  });
  assertNoProbeExpectationLeakage(projection);
  return deepFreeze(canonicalClone(projection));
}

export function fallbackCalibrationEnvelopeHash(value: unknown): Promise<string> {
  return canonicalSha256(parseExpectationFreeFallbackEnvelope(value));
}
