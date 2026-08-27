import { CHECKOUT_CURRENCY, CHECKOUT_FIXTURE_ID, type CheckoutState } from "@/lib/domain/checkout";
import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  PROBE_RUNNER_PROMPT_VERSION,
  PROBE_RUNNER_SETTINGS_VERSION
} from "@/lib/probe/runner-contract";
import { z } from "zod";

export const PROBE_CALIBRATION_ENVELOPE_VERSION = "toolproof-probe-calibration-envelope@1.0.0";
export const PROBE_FIXTURE_SYNOPSIS_VERSION = "toolproof-probe-fixture-synopsis@1.0.0";
export const PROBE_LIVE_MANIFEST_VERSION = "toolproof-probe-live-manifest@1.0.0";
export const PROBE_MODEL_INPUT_VERSION = "toolproof-probe-model-input@1.0.0";

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

const probeFixtureLineSchema = z
  .object({
    itemId: z.enum(["field-notebook", "stoneware-mug"]),
    name: z.enum(["Field notebook", "Stoneware mug"]),
    quantity: z.number().int().min(1).max(10)
  })
  .strict();

export const probeFixtureSynopsisSchema = z
  .object({
    version: z.literal(PROBE_FIXTURE_SYNOPSIS_VERSION),
    simulated: z.literal(true),
    fixtureId: z.literal(CHECKOUT_FIXTURE_ID),
    stateRevision: z.number().int().nonnegative(),
    currency: z.literal(CHECKOUT_CURRENCY),
    lines: z.array(probeFixtureLineSchema).length(2),
    pendingCheckout: z.literal(false)
  })
  .strict()
  .superRefine(({ lines }, context) => {
    const expectedNames = new Map([
      ["field-notebook", "Field notebook"],
      ["stoneware-mug", "Stoneware mug"]
    ]);
    const names = new Set<string>();
    for (const [index, line] of lines.entries()) {
      if (names.has(line.itemId)) {
        context.addIssue({
          code: "custom",
          path: ["lines", index, "itemId"],
          message: "Fixture synopsis item IDs must be unique."
        });
      }
      names.add(line.itemId);
      if (expectedNames.get(line.itemId) !== line.name) {
        context.addIssue({
          code: "custom",
          path: ["lines", index, "name"],
          message: "Fixture synopsis item identity does not match its synthetic name."
        });
      }
    }
    if (names.size !== expectedNames.size) {
      context.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Fixture synopsis must contain both declared synthetic items."
      });
    }
  });

export const probeRunnerBindingSchema = z
  .object({
    promptVersion: z.literal(PROBE_RUNNER_PROMPT_VERSION),
    promptHash: sha256Schema,
    settingsVersion: z.literal(PROBE_RUNNER_SETTINGS_VERSION),
    settingsHash: sha256Schema,
    decisionSchemaHash: sha256Schema
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
export type ProbeCalibrationEnvelope = z.infer<typeof probeCalibrationEnvelopeSchema>;
export type ProbeModelInput = z.infer<typeof probeModelInputSchema>;

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
      stateRevision: state.revision,
      currency: state.currency,
      lines: state.lines.map(({ itemId, name, quantity }) => ({ itemId, name, quantity })),
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

export function probeCalibrationEnvelopeHash(value: unknown): Promise<string> {
  return canonicalSha256(parseExpectationFreeCalibrationEnvelope(value));
}
