import {
  CHECKOUT_FIXTURE_ID,
  CHECKOUT_FIXTURE_VERSION,
  type CheckoutState
} from "@/lib/domain/checkout";
import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  PROBE_RUNNER_PROMPT_VERSION,
  PROBE_RUNNER_SETTINGS_VERSION
} from "@/lib/probe/runner-contract";
import { z } from "zod";

export const PROBE_CALIBRATION_ENVELOPE_VERSION = "toolproof-probe-calibration-envelope@2.0.0";
export const PROBE_FIXTURE_SYNOPSIS_VERSION = "toolproof-probe-fixture-synopsis@2.0.0";
export const PROBE_LIVE_MANIFEST_VERSION = "toolproof-probe-live-manifest@1.0.0";
export const PROBE_MODEL_INPUT_VERSION = "toolproof-probe-model-input@2.0.0";
export const PROBE_TRANSPORT_BINDING_VERSION = "toolproof-probe-transport-binding@1.0.0";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const gitCommitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const opaqueRunIdSchema = z.string().regex(/^run_[A-Za-z0-9_-]{22}$/u);
const opaqueCaseIdSchema = z.string().regex(/^case_[A-Za-z0-9_-]{22}$/u);
const opaqueTrialIdSchema = z.string().regex(/^trial_[A-Za-z0-9_-]{22}$/u);
const nonBlankString = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim().length > 0, "Value must contain non-whitespace text.");

const jsonObjectSchema = z.record(z.string(), z.json());

export const probeLiveToolSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/u),
    title: nonBlankString(160),
    description: nonBlankString(500),
    inputSchema: jsonObjectSchema,
    annotations: z
      .object({
        readOnlyHint: z.boolean(),
        untrustedContentHint: z.boolean()
      })
      .strict()
  })
  .strict()
  .superRefine(({ inputSchema }, context) => {
    if (inputSchema.type !== "object") {
      context.addIssue({
        code: "custom",
        path: ["inputSchema", "type"],
        message: "A live tool input schema must have object at its root."
      });
    }
    if (inputSchema.additionalProperties !== false) {
      context.addIssue({
        code: "custom",
        path: ["inputSchema", "additionalProperties"],
        message: "A live tool input schema must reject undeclared properties."
      });
    }
  });

export const probeLiveManifestSchema = z
  .object({
    version: z.literal(PROBE_LIVE_MANIFEST_VERSION),
    manifestHash: sha256Schema,
    tools: z.array(probeLiveToolSchema).min(1).max(5)
  })
  .strict()
  .superRefine(({ tools }, context) => {
    const names = new Set<string>();
    for (const [index, tool] of tools.entries()) {
      if (names.has(tool.name)) {
        context.addIssue({
          code: "custom",
          path: ["tools", index, "name"],
          message: "Live tool names must be unique."
        });
      }
      names.add(tool.name);
    }
  });

const probeFixtureItemSchema = z
  .object({
    itemId: z.enum(["field-notebook", "stoneware-mug"]),
    name: z.enum(["Field notebook", "Stoneware mug"])
  })
  .strict();

export const probeFixtureSynopsisSchema = z
  .object({
    version: z.literal(PROBE_FIXTURE_SYNOPSIS_VERSION),
    simulated: z.literal(true),
    fixtureId: z.literal(CHECKOUT_FIXTURE_ID),
    fixtureVersion: z.literal(CHECKOUT_FIXTURE_VERSION),
    stateRevision: z.number().int().nonnegative(),
    items: z.array(probeFixtureItemSchema).length(2),
    pendingCheckout: z.literal(false)
  })
  .strict()
  .superRefine(({ items }, context) => {
    const expectedNames = new Map([
      ["field-notebook", "Field notebook"],
      ["stoneware-mug", "Stoneware mug"]
    ]);
    const names = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (names.has(item.itemId)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "itemId"],
          message: "Fixture synopsis item IDs must be unique."
        });
      }
      names.add(item.itemId);
      if (expectedNames.get(item.itemId) !== item.name) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "name"],
          message: "Fixture synopsis item identity does not match its synthetic name."
        });
      }
    }
    if (names.size !== expectedNames.size) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Fixture synopsis must contain both declared synthetic items."
      });
    }
  });

export const probeTransportBindingSchema = z
  .object({
    version: z.literal(PROBE_TRANSPORT_BINDING_VERSION),
    ownership: z.literal("runner"),
    operationId: z.string().regex(/^probe_[a-f0-9]{58}$/u),
    bindingHash: sha256Schema
  })
  .strict();

export const probeRunnerBindingSchema = z
  .object({
    promptVersion: z.literal(PROBE_RUNNER_PROMPT_VERSION),
    promptHash: sha256Schema,
    settingsVersion: z.literal(PROBE_RUNNER_SETTINGS_VERSION),
    settingsHash: sha256Schema,
    decisionSchemaHash: sha256Schema,
    transport: probeTransportBindingSchema
  })
  .strict();

export const probeCalibrationEnvelopeSchema = z
  .object({
    version: z.literal(PROBE_CALIBRATION_ENVELOPE_VERSION),
    purpose: z.literal("calibration"),
    buildCommit: gitCommitSchema,
    runId: opaqueRunIdSchema,
    caseId: opaqueCaseIdSchema,
    trialId: opaqueTrialIdSchema,
    naturalLanguageRequest: nonBlankString(2_000),
    fixture: probeFixtureSynopsisSchema,
    liveManifest: probeLiveManifestSchema,
    runner: probeRunnerBindingSchema
  })
  .strict();

export const probeModelInputSchema = z
  .object({
    version: z.literal(PROBE_MODEL_INPUT_VERSION),
    request: nonBlankString(2_000),
    fixture: probeFixtureSynopsisSchema,
    tools: z.array(probeLiveToolSchema).min(1).max(5)
  })
  .strict();

export type ProbeLiveTool = z.infer<typeof probeLiveToolSchema>;
export type ProbeLiveManifest = z.infer<typeof probeLiveManifestSchema>;
export type ProbeFixtureSynopsis = z.infer<typeof probeFixtureSynopsisSchema>;
export type ProbeTransportBinding = z.infer<typeof probeTransportBindingSchema>;
export type ProbeCalibrationEnvelope = z.infer<typeof probeCalibrationEnvelopeSchema>;
export type ProbeModelInput = z.infer<typeof probeModelInputSchema>;

export interface ProbeSignedTrialIdentity {
  readonly runId: string;
  readonly caseId: string;
  readonly trialId: string;
}

const FORBIDDEN_LEAKAGE_KEYS = new Set([
  "answer",
  "answerkey",
  "approvedaction",
  "boundarylabel",
  "canonicalaction",
  "contract",
  "development",
  "expected",
  "expectedaction",
  "expectedanswer",
  "expectedarguments",
  "expectedeffect",
  "expectedtool",
  "expectedtrajectory",
  "expectation",
  "family",
  "holdout",
  "label",
  "matrix",
  "priorcase",
  "priorresult",
  "repairhint",
  "score",
  "scoring",
  "semanticfamily",
  "subset"
]);

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

export class ProbeExpectationLeakageError extends Error {
  constructor(
    readonly code: "forbidden_key",
    readonly path: string
  ) {
    super(`Expectation-bearing field is forbidden at ${path}.`);
    this.name = "ProbeExpectationLeakageError";
  }
}

export class ProbeTransportBindingError extends Error {
  constructor(readonly code: "transport_binding_mismatch") {
    super(code);
    this.name = "ProbeTransportBindingError";
  }
}

export function assertNoProbeExpectationLeakage(value: unknown, path = "$root"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoProbeExpectationLeakage(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object" || value === null) return;

  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;
    if (FORBIDDEN_LEAKAGE_KEYS.has(normalizedKey(key))) {
      throw new ProbeExpectationLeakageError("forbidden_key", nestedPath);
    }
    assertNoProbeExpectationLeakage(nested, nestedPath);
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

function signedTrialIdentity(value: ProbeSignedTrialIdentity): ProbeSignedTrialIdentity {
  return Object.freeze({
    runId: opaqueRunIdSchema.parse(value.runId),
    caseId: opaqueCaseIdSchema.parse(value.caseId),
    trialId: opaqueTrialIdSchema.parse(value.trialId)
  });
}

export async function createProbeTransportBinding(
  value: ProbeSignedTrialIdentity
): Promise<ProbeTransportBinding> {
  const identity = signedTrialIdentity(value);
  const identityDigest = await canonicalSha256({
    version: PROBE_TRANSPORT_BINDING_VERSION,
    identity
  });
  const operationId = `probe_${identityDigest.slice(0, 58)}`;
  return deepFreeze(
    probeTransportBindingSchema.parse({
      version: PROBE_TRANSPORT_BINDING_VERSION,
      ownership: "runner",
      operationId,
      bindingHash: await canonicalSha256({
        version: PROBE_TRANSPORT_BINDING_VERSION,
        identity,
        operationId
      })
    })
  );
}

export async function verifyProbeTransportBinding(
  value: Pick<ProbeCalibrationEnvelope, "runId" | "caseId" | "trialId" | "runner">
): Promise<ProbeTransportBinding> {
  const actual = probeTransportBindingSchema.parse(value.runner.transport);
  const expected = await createProbeTransportBinding(value);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new ProbeTransportBindingError("transport_binding_mismatch");
  }
  return expected;
}

export function parseExpectationFreeCalibrationEnvelope(value: unknown): ProbeCalibrationEnvelope {
  assertNoProbeExpectationLeakage(value);
  return deepFreeze(canonicalClone(probeCalibrationEnvelopeSchema.parse(value)));
}

export function createProbeFixtureSynopsis(state: CheckoutState): ProbeFixtureSynopsis {
  return deepFreeze(
    probeFixtureSynopsisSchema.parse({
      version: PROBE_FIXTURE_SYNOPSIS_VERSION,
      simulated: true,
      fixtureId: state.fixtureId,
      fixtureVersion: state.fixtureVersion,
      stateRevision: state.revision,
      items: state.lines.map(({ itemId, name }) => ({ itemId, name })),
      pendingCheckout: state.pendingCheckout !== null
    })
  );
}

export function createProbeModelInput(envelope: ProbeCalibrationEnvelope): ProbeModelInput {
  const parsed = parseExpectationFreeCalibrationEnvelope(envelope);
  const projection = probeModelInputSchema.parse({
    version: PROBE_MODEL_INPUT_VERSION,
    request: parsed.naturalLanguageRequest,
    fixture: parsed.fixture,
    tools: parsed.liveManifest.tools
  });
  assertNoProbeExpectationLeakage(projection);
  return deepFreeze(canonicalClone(projection));
}

export async function probeCalibrationEnvelopeHash(value: unknown): Promise<string> {
  const envelope = parseExpectationFreeCalibrationEnvelope(value);
  await verifyProbeTransportBinding(envelope);
  return canonicalSha256(envelope);
}
