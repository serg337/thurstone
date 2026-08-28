import {
  CHECKOUT_FIXTURE_ID,
  CHECKOUT_FIXTURE_SEED,
  CHECKOUT_FIXTURE_VERSION
} from "@/lib/domain/checkout";
import { CHECKOUT_FIXTURE_STATE_HASH } from "@/lib/domain/checkout-reset";
import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  fallbackRunnerImplementationHash,
  FALLBACK_IMPLEMENTATION
} from "@/lib/fallback/implementation-contract";
import { fallbackNoCallJsonSchemaHash } from "@/lib/fallback/openai-tool-decision";
import {
  FALLBACK_RUNNER_PROMPT_VERSION,
  FALLBACK_RUNNER_SETTINGS_VERSION,
  FALLBACK_UPSTREAM_PIN,
  fallbackBrowserRuntimeContractHash,
  fallbackRunnerContractHash,
  fallbackRunnerPromptHash,
  fallbackRunnerSettingsHash
} from "@/lib/fallback/runner-contract";
import { fallbackRunnerBindingSchema } from "@/lib/fallback/calibration-envelope";
import {
  PROBE_MODEL_INPUT_VERSION,
  assertNoProbeExpectationLeakage,
  createProbeTransportBinding,
  probeFixtureSynopsisSchema,
  probeLiveManifestSchema,
  probeModelInputSchema,
  type ProbeFixtureSynopsis,
  type ProbeLiveManifest,
  type ProbeModelInput,
  type ProbeTransportBinding
} from "@/lib/probe/calibration-envelope";
import { probeFunctionToolDefinitionsHash } from "@/lib/probe/decision";
import { INITIAL_CHECKOUT_TOOL_NAMES } from "@/lib/webmcp/catalog";
import { z } from "zod";

export const SCORED_TRIAL_ENVELOPE_VERSION = "toolproof-scored-trial-envelope@1.0.0";
export const SCORED_BOUNDARY_VERSION = "toolproof-scored-initial-boundary@1.0.0";
export const SCORED_CASE_BINDING_VERSION = "toolproof-scored-case-binding@1.0.0";
export const SCORED_ENVELOPE_BINDING_VERSION = "toolproof-scored-envelope-binding@1.0.0";

export const SCORED_PURPOSES = ["baseline", "revised"] as const;
export type ScoredPurpose = (typeof SCORED_PURPOSES)[number];
export type ScoredTargetPhase = "baseline-v1" | "revised-v2";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const gitCommit = z.string().regex(/^[a-f0-9]{40}$/u);
const runId = z.string().regex(/^run_[A-Za-z0-9_-]{22}$/u);
const runnerCaseId = z.string().regex(/^case_[A-Za-z0-9_-]{22}$/u);
const trialId = z.string().regex(/^trial_[A-Za-z0-9_-]{22}$/u);
const nonBlankRequest = z
  .string()
  .min(1)
  .max(2_000)
  .refine((value) => value.trim().length > 0, "Request must contain non-whitespace text.");

const exactInitialToolNames = Object.freeze([...INITIAL_CHECKOUT_TOOL_NAMES].sort());

export const scoredInitialBoundarySchema = z
  .object({
    version: z.literal(SCORED_BOUNDARY_VERSION),
    fixtureId: z.literal(CHECKOUT_FIXTURE_ID),
    fixtureVersion: z.literal(CHECKOUT_FIXTURE_VERSION),
    fixtureSeed: z.literal(CHECKOUT_FIXTURE_SEED),
    stateRevision: z.literal(0),
    stateHash: z.literal(CHECKOUT_FIXTURE_STATE_HASH),
    manifestHash: sha256,
    registrationGeneration: z.number().int().positive(),
    operationLedgerCount: z.literal(0),
    currentTrajectoryCount: z.literal(0),
    registeredToolNames: z
      .array(z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/u))
      .length(INITIAL_CHECKOUT_TOOL_NAMES.length),
    boundaryHash: sha256
  })
  .strict()
  .superRefine(({ registeredToolNames }, context) => {
    if (canonicalJson([...registeredToolNames].sort()) !== canonicalJson(exactInitialToolNames)) {
      context.addIssue({
        code: "custom",
        path: ["registeredToolNames"],
        message: "A scored trial must start with the exact initial ToolProof target catalog."
      });
    }
  });

export type ScoredInitialBoundary = z.infer<typeof scoredInitialBoundarySchema>;

const scoredRunBindingSchema = z
  .object({
    version: z.literal(SCORED_ENVELOPE_BINDING_VERSION),
    freezeHash: sha256,
    appCommit: gitCommit,
    fixtureHash: z.literal(CHECKOUT_FIXTURE_STATE_HASH),
    manifestHash: sha256,
    boundaryHash: sha256,
    runnerHash: sha256
  })
  .strict();

export const scoredTrialEnvelopeSchema = z
  .object({
    version: z.literal(SCORED_TRIAL_ENVELOPE_VERSION),
    purpose: z.enum(SCORED_PURPOSES),
    targetPhase: z.enum(["baseline-v1", "revised-v2"]),
    buildCommit: gitCommit,
    runId,
    caseId: runnerCaseId,
    trialId,
    naturalLanguageRequest: nonBlankRequest,
    fixture: probeFixtureSynopsisSchema,
    liveManifest: probeLiveManifestSchema,
    initialBoundary: scoredInitialBoundarySchema,
    runner: fallbackRunnerBindingSchema,
    runBinding: scoredRunBindingSchema,
    caseBindingHash: sha256,
    envelopeHash: sha256
  })
  .strict()
  .superRefine((envelope, context) => {
    const expectedPhase: ScoredTargetPhase =
      envelope.purpose === "baseline" ? "baseline-v1" : "revised-v2";
    if (envelope.targetPhase !== expectedPhase) {
      context.addIssue({
        code: "custom",
        path: ["targetPhase"],
        message: "Scored purpose and target phase do not match."
      });
    }
    if (
      envelope.runBinding.appCommit !== envelope.buildCommit ||
      envelope.runBinding.manifestHash !== envelope.liveManifest.manifestHash ||
      envelope.runBinding.manifestHash !== envelope.initialBoundary.manifestHash ||
      envelope.runBinding.boundaryHash !== envelope.initialBoundary.boundaryHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["runBinding"],
        message: "Scored run bindings do not match the current app, manifest, and boundary."
      });
    }
    if (
      envelope.fixture.fixtureId !== envelope.initialBoundary.fixtureId ||
      envelope.fixture.fixtureVersion !== envelope.initialBoundary.fixtureVersion ||
      envelope.fixture.stateRevision !== 0 ||
      envelope.fixture.pendingCheckout !== false
    ) {
      context.addIssue({
        code: "custom",
        path: ["fixture"],
        message: "Scored fixture synopsis does not match the verified clean initial boundary."
      });
    }
    const manifestNames = envelope.liveManifest.tools.map(({ name }) => name).sort();
    if (canonicalJson(manifestNames) !== canonicalJson(exactInitialToolNames)) {
      context.addIssue({
        code: "custom",
        path: ["liveManifest", "tools"],
        message: "Scored model selection requires the exact initial target catalog."
      });
    }
  });

export type ScoredTrialEnvelope = z.infer<typeof scoredTrialEnvelopeSchema>;

export interface ScoredBoundaryInput {
  readonly fixtureId: typeof CHECKOUT_FIXTURE_ID;
  readonly fixtureVersion: typeof CHECKOUT_FIXTURE_VERSION;
  readonly fixtureSeed: typeof CHECKOUT_FIXTURE_SEED;
  readonly stateRevision: 0;
  readonly stateHash: typeof CHECKOUT_FIXTURE_STATE_HASH;
  readonly manifestHash: string;
  readonly registrationGeneration: number;
  readonly operationLedgerCount: 0;
  readonly currentTrajectoryCount: 0;
  readonly registeredToolNames: readonly string[];
}

export interface CreateScoredTrialEnvelopeInput {
  readonly purpose: ScoredPurpose;
  readonly freezeHash: string;
  readonly buildCommit: string;
  readonly runId: string;
  readonly caseId: string;
  readonly trialId: string;
  readonly naturalLanguageRequest: string;
  readonly fixture: ProbeFixtureSynopsis;
  readonly liveManifest: ProbeLiveManifest;
  readonly initialBoundary: ScoredBoundaryInput;
}

export class ScoredEnvelopeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ScoredEnvelopeError";
  }
}

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

function boundaryPayload(input: ScoredBoundaryInput) {
  return {
    version: SCORED_BOUNDARY_VERSION,
    fixtureId: input.fixtureId,
    fixtureVersion: input.fixtureVersion,
    fixtureSeed: input.fixtureSeed,
    stateRevision: input.stateRevision,
    stateHash: input.stateHash,
    manifestHash: input.manifestHash,
    registrationGeneration: input.registrationGeneration,
    operationLedgerCount: input.operationLedgerCount,
    currentTrajectoryCount: input.currentTrajectoryCount,
    registeredToolNames: [...input.registeredToolNames].sort()
  } as const;
}

function caseBindingPayload(envelope: {
  readonly purpose: ScoredPurpose;
  readonly freezeHash: string;
  readonly buildCommit: string;
  readonly runId: string;
  readonly caseId: string;
  readonly trialId: string;
  readonly naturalLanguageRequest: string;
}) {
  return {
    version: SCORED_CASE_BINDING_VERSION,
    purpose: envelope.purpose,
    freezeHash: envelope.freezeHash,
    buildCommit: envelope.buildCommit,
    runId: envelope.runId,
    caseId: envelope.caseId,
    trialId: envelope.trialId,
    naturalLanguageRequest: envelope.naturalLanguageRequest
  } as const;
}

async function expectedRunnerBinding(
  liveManifest: ProbeLiveManifest,
  transport: ProbeTransportBinding
) {
  const [
    implementationHash,
    promptHash,
    settingsHash,
    browserRuntimeHash,
    toolDefinitionsHash,
    noCallSchemaHash
  ] = await Promise.all([
    fallbackRunnerImplementationHash(),
    fallbackRunnerPromptHash(),
    fallbackRunnerSettingsHash(),
    fallbackBrowserRuntimeContractHash(),
    probeFunctionToolDefinitionsHash(liveManifest, transport),
    fallbackNoCallJsonSchemaHash()
  ]);
  return {
    implementation: FALLBACK_IMPLEMENTATION,
    implementationHash,
    upstreamCommit: FALLBACK_UPSTREAM_PIN.commit,
    upstreamSubtree: FALLBACK_UPSTREAM_PIN.subtree,
    promptVersion: FALLBACK_RUNNER_PROMPT_VERSION,
    promptHash,
    settingsVersion: FALLBACK_RUNNER_SETTINGS_VERSION,
    settingsHash,
    browserRuntimeHash,
    toolDefinitionsHash,
    noCallSchemaHash,
    transport
  } as const;
}

export async function createScoredTrialEnvelope(
  input: CreateScoredTrialEnvelopeInput
): Promise<ScoredTrialEnvelope> {
  const identity = { runId: input.runId, caseId: input.caseId, trialId: input.trialId };
  const transport = await createProbeTransportBinding(identity);
  const initialBoundaryPayload = boundaryPayload(input.initialBoundary);
  const boundaryHash = await canonicalSha256(initialBoundaryPayload);
  const runner = await expectedRunnerBinding(input.liveManifest, transport);
  const runnerHash = await fallbackRunnerContractHash();
  const targetPhase: ScoredTargetPhase =
    input.purpose === "baseline" ? "baseline-v1" : "revised-v2";
  const caseBindingHash = await canonicalSha256(
    caseBindingPayload({
      purpose: input.purpose,
      freezeHash: input.freezeHash,
      buildCommit: input.buildCommit,
      runId: input.runId,
      caseId: input.caseId,
      trialId: input.trialId,
      naturalLanguageRequest: input.naturalLanguageRequest
    })
  );
  const unsigned = {
    version: SCORED_TRIAL_ENVELOPE_VERSION,
    purpose: input.purpose,
    targetPhase,
    buildCommit: input.buildCommit,
    runId: input.runId,
    caseId: input.caseId,
    trialId: input.trialId,
    naturalLanguageRequest: input.naturalLanguageRequest,
    fixture: input.fixture,
    liveManifest: input.liveManifest,
    initialBoundary: { ...initialBoundaryPayload, boundaryHash },
    runner,
    runBinding: {
      version: SCORED_ENVELOPE_BINDING_VERSION,
      freezeHash: input.freezeHash,
      appCommit: input.buildCommit,
      fixtureHash: CHECKOUT_FIXTURE_STATE_HASH,
      manifestHash: input.liveManifest.manifestHash,
      boundaryHash,
      runnerHash
    },
    caseBindingHash
  } as const;
  const envelope = scoredTrialEnvelopeSchema.parse({
    ...unsigned,
    envelopeHash: await canonicalSha256(unsigned)
  });
  assertNoProbeExpectationLeakage(envelope);
  return deepFreeze(canonicalClone(envelope));
}

export function parseExpectationFreeScoredEnvelope(value: unknown): ScoredTrialEnvelope {
  assertNoProbeExpectationLeakage(value);
  return deepFreeze(canonicalClone(scoredTrialEnvelopeSchema.parse(value)));
}

export async function verifyExpectationFreeScoredEnvelope(
  value: unknown
): Promise<ScoredTrialEnvelope> {
  const envelope = parseExpectationFreeScoredEnvelope(value);
  const boundary = { ...envelope.initialBoundary };
  delete (boundary as Partial<ScoredInitialBoundary>).boundaryHash;
  const unsigned = { ...envelope };
  delete (unsigned as Partial<ScoredTrialEnvelope>).envelopeHash;
  const [boundaryHash, caseBindingHash, envelopeHash, transport, runner, runnerHash] =
    await Promise.all([
      canonicalSha256(boundary),
      canonicalSha256(
        caseBindingPayload({
          purpose: envelope.purpose,
          freezeHash: envelope.runBinding.freezeHash,
          buildCommit: envelope.buildCommit,
          runId: envelope.runId,
          caseId: envelope.caseId,
          trialId: envelope.trialId,
          naturalLanguageRequest: envelope.naturalLanguageRequest
        })
      ),
      canonicalSha256(unsigned),
      createProbeTransportBinding(envelope),
      expectedRunnerBinding(envelope.liveManifest, envelope.runner.transport),
      fallbackRunnerContractHash()
    ]);
  if (
    envelope.initialBoundary.boundaryHash !== boundaryHash ||
    envelope.runBinding.boundaryHash !== boundaryHash ||
    envelope.caseBindingHash !== caseBindingHash ||
    envelope.envelopeHash !== envelopeHash ||
    canonicalJson(envelope.runner.transport) !== canonicalJson(transport) ||
    canonicalJson(envelope.runner) !== canonicalJson(runner) ||
    envelope.runBinding.runnerHash !== runnerHash
  ) {
    throw new ScoredEnvelopeError("scored_envelope_binding_mismatch");
  }
  return envelope;
}

export function createScoredModelInput(envelopeValue: unknown): ProbeModelInput {
  const envelope = parseExpectationFreeScoredEnvelope(envelopeValue);
  const input = probeModelInputSchema.parse({
    version: PROBE_MODEL_INPUT_VERSION,
    request: envelope.naturalLanguageRequest,
    fixture: envelope.fixture,
    tools: envelope.liveManifest.tools
  });
  assertNoProbeExpectationLeakage(input);
  return deepFreeze(canonicalClone(input));
}

export async function scoredEnvelopeHash(value: unknown): Promise<string> {
  const envelope = await verifyExpectationFreeScoredEnvelope(value);
  return envelope.envelopeHash;
}
