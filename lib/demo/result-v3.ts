import { z } from "zod";

import {
  BYOA_DEMO_TOOLSET_V2_VERSION,
  byoaContractV3Schema,
  byoaContractV3Digest,
  verifyByoaContractV3,
  type ByoaContractV3,
  type ByoaContractV3ExpectedLineage
} from "@/lib/demo/contract-v3";
import {
  diagnosticEnvelopeSchema,
  diagnosticSignalSchema,
  jsonValueSchema,
  type DiagnosticSignal,
  type JsonValue
} from "@/lib/demo/diagnostic-contract";
import { createDiagnosticEnvelope } from "@/lib/demo/diagnose-result";
import type { ByoaAgentEnvironmentManifestV2 } from "@/lib/demo/agent-environment-v2";
import {
  demoAssertionV2Schema,
  checkoutStateEvidenceSchema,
  createCheckoutStateEvidence,
  verifyCheckoutStateEvidence,
  type DemoAssertionV2
} from "@/lib/demo/result-v2";
import {
  THURSTONE_DEMO_FIXTURE_ID,
  THURSTONE_DEMO_SELECTABLE_TOOL_NAMES,
  THURSTONE_DEMO_TOOLSET_VERSION,
  THURSTONE_DEMO_TRUSTED_STATE_SOURCE
} from "@/lib/demo/reference-tool-templates";
import { CHECKOUT_DOMAIN_VERSION, type CheckoutState } from "@/lib/domain/checkout";
import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";

export const BYOA_RESULT_V3_VERSION = "thurstone-byoa-result@3" as const;
export const BYOA_SUPPORTED_CLIENT_ISOLATION_LIMITATION =
  "Answer-key withholding is enforced for Thurstone's supported, unmodified fresh-agent flow. The terminal settlement grant is client-asserted and is not a defense against a hostile or modified browser client." as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const idSuffixPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const runIdSchema = z.string().regex(new RegExp(`^byoa_run_${idSuffixPattern}$`, "u"));
const suiteIdSchema = z.string().regex(new RegExp(`^suite_${idSuffixPattern}$`, "u"));
const caseIdSchema = z.string().regex(new RegExp(`^case_${idSuffixPattern}$`, "u"));

export const byoaLaunchModeSchema = z.enum([
  "fresh-agent-handoff",
  "direct-browser-compatibility",
  "controlled-example"
]);

export const byoaEvidenceTierSchema = z.enum([
  "independent-agent-native",
  "native-plumbing-context-contaminated",
  "direct-browser-compatibility",
  "deterministic-controlled-example"
]);

export type ByoaLaunchMode = z.infer<typeof byoaLaunchModeSchema>;
export type ByoaEvidenceTier = z.infer<typeof byoaEvidenceTierSchema>;

export const byoaSourceTruthV3Schema = z
  .object({
    trustedStateSource: z.literal(THURSTONE_DEMO_TRUSTED_STATE_SOURCE),
    stateAuthority: z.literal("browser-local-site-owned-sandbox"),
    ledgerAuthority: z.literal("append-only-native-operation-ledger"),
    toolResponseRole: z.literal("corroborating-only")
  })
  .strict();

export const byoaEnvironmentManifestV2Schema = z
  .object({
    version: z.literal("thurstone-byoa-agent-environment-manifest@2"),
    toolsetVersion: z.literal(BYOA_DEMO_TOOLSET_V2_VERSION),
    catalogToolsetVersion: z.literal(THURSTONE_DEMO_TOOLSET_VERSION),
    domainVersion: z.literal(CHECKOUT_DOMAIN_VERSION),
    appCommit: commitSchema,
    catalogDigest: sha256Schema,
    fixtureId: z.literal(THURSTONE_DEMO_FIXTURE_ID),
    trustedStateSource: z.literal(THURSTONE_DEMO_TRUSTED_STATE_SOURCE),
    tools: z
      .array(
        z
          .object({
            name: z.enum(THURSTONE_DEMO_SELECTABLE_TOOL_NAMES),
            title: z.string().min(3).max(80),
            description: z.string().min(20).max(600),
            inputSchema: jsonValueSchema,
            annotations: z.object({ readOnlyHint: z.boolean() }).strict(),
            handlerVersion: z.string().min(1).max(80)
          })
          .strict()
      )
      .min(1)
      .max(4),
    handlerVersions: z
      .array(
        z
          .object({
            name: z.enum(THURSTONE_DEMO_SELECTABLE_TOOL_NAMES),
            version: z.string().min(1).max(80)
          })
          .strict()
      )
      .min(1)
      .max(4)
  })
  .strict();

const revisionEffectSchema = z
  .object({
    before: z.number().int().min(0),
    after: z.number().int().min(0),
    delta: z.number().int(),
    changed: z.boolean()
  })
  .strict();

const quantityEffectSchema = z
  .object({
    itemId: z.enum(["field-notebook", "stoneware-mug"]),
    beforeQuantity: z.number().int().min(1).max(10).nullable(),
    afterQuantity: z.number().int().min(1).max(10).nullable(),
    delta: z.number().int().nullable(),
    changed: z.boolean()
  })
  .strict();

const pendingCheckoutEffectSchema = z
  .object({ before: jsonValueSchema, after: jsonValueSchema, changed: z.boolean() })
  .strict();

export const ledgerDiffV3Schema = z
  .object({
    eventCountBefore: z.number().int().min(0),
    eventCountAfter: z.number().int().min(0),
    eventCountDelta: z.number().int().min(0),
    stateTransitionCount: z.number().int().min(0),
    operationLedgerCountBefore: z.number().int().min(0),
    operationLedgerCountAfter: z.number().int().min(0),
    operationLedgerCountDelta: z.number().int().min(0),
    rejectedAdditionalAttempts: z.number().int().min(0),
    effect: z
      .object({
        stateChanged: z.boolean(),
        revision: revisionEffectSchema,
        quantities: z.array(quantityEffectSchema).max(2),
        pendingCheckout: pendingCheckoutEffectSchema,
        unmodeledStateChanged: z.boolean()
      })
      .strict()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.eventCountAfter - value.eventCountBefore !== value.eventCountDelta) {
      context.addIssue({
        code: "custom",
        path: ["eventCountDelta"],
        message: "Event-count delta is inconsistent."
      });
    }
    if (
      value.operationLedgerCountAfter - value.operationLedgerCountBefore !==
      value.operationLedgerCountDelta
    ) {
      context.addIssue({
        code: "custom",
        path: ["operationLedgerCountDelta"],
        message: "Operation-ledger delta is inconsistent."
      });
    }
    if (
      value.effect.revision.after - value.effect.revision.before !== value.effect.revision.delta ||
      value.effect.revision.changed !== (value.effect.revision.delta !== 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["effect", "revision"],
        message: "Revision effect is inconsistent."
      });
    }
  });

export type LedgerDiffV3 = z.infer<typeof ledgerDiffV3Schema>;

export const byoaHandlerOutcomeV3Schema = z
  .object({
    traceId: z.string().min(1).max(128),
    status: z.enum([
      "completed",
      "validation_error",
      "expected_error",
      "unexpected_error",
      "duplicate",
      "canceled",
      "partial"
    ]),
    commitDisposition: z.enum(["none", "committed", "replayed", "partial"]),
    handlerVersion: z.string().min(1).max(80),
    toolsetVersion: z.string().min(1).max(80),
    domainVersion: z.string().min(1).max(80),
    canonicalResult: jsonValueSchema.nullable(),
    error: jsonValueSchema.nullable()
  })
  .strict();

export const byoaDemoResultV3Schema = z
  .object({
    version: z.literal(BYOA_RESULT_V3_VERSION),
    evidenceClass: z.literal("exploratory-byoa"),
    includedInReferenceScore: z.literal(false),
    runId: runIdSchema,
    launchMode: byoaLaunchModeSchema,
    evidenceTier: byoaEvidenceTierSchema,
    answerKeyIsolation: z.enum(["verified-withheld", "context-contaminated", "not-applicable"]),
    source: z.literal("native-webmcp"),
    sourceTruth: byoaSourceTruthV3Schema,
    suiteId: suiteIdSchema,
    suiteDigest: sha256Schema,
    caseId: caseIdSchema,
    caseDigest: sha256Schema,
    catalogDigest: sha256Schema,
    contract: byoaContractV3Schema,
    contractDigest: sha256Schema,
    selectedExpectedTool: z.enum(THURSTONE_DEMO_SELECTABLE_TOOL_NAMES),
    observedTool: z.enum(THURSTONE_DEMO_SELECTABLE_TOOL_NAMES).nullable(),
    rawArguments: jsonValueSchema.nullable(),
    canonicalArguments: jsonValueSchema.nullable(),
    trustedStateBefore: checkoutStateEvidenceSchema,
    trustedStateAfter: checkoutStateEvidenceSchema,
    ledgerDiff: ledgerDiffV3Schema,
    handlerOutcome: byoaHandlerOutcomeV3Schema.nullable(),
    assertions: z.array(demoAssertionV2Schema).min(1).max(32),
    diagnosticSignals: z.array(diagnosticSignalSchema).max(19),
    diagnostic: diagnosticEnvelopeSchema,
    verdict: z.enum(["pass", "issue", "incomplete", "unavailable"]),
    replayMeasurement: z.literal("not-measured-single-admitted-call"),
    buildCommit: commitSchema,
    manifest: byoaEnvironmentManifestV2Schema,
    manifestHash: sha256Schema,
    armedAt: z.string().datetime({ offset: false }).nullable(),
    completedAt: z.string().datetime({ offset: false }),
    previousResultDigest: sha256Schema.nullable(),
    resultDigest: sha256Schema
  })
  .strict()
  .superRefine((value, context) => {
    const expectedAnswerIsolation =
      value.evidenceTier === "independent-agent-native"
        ? "verified-withheld"
        : value.evidenceTier === "native-plumbing-context-contaminated"
          ? "context-contaminated"
          : "not-applicable";
    if (value.answerKeyIsolation !== expectedAnswerIsolation) {
      context.addIssue({
        code: "custom",
        path: ["answerKeyIsolation"],
        message: "Answer-key isolation must match the evidence tier."
      });
    }
    const launchTierValid =
      (value.launchMode === "fresh-agent-handoff" &&
        ["independent-agent-native", "native-plumbing-context-contaminated"].includes(
          value.evidenceTier
        )) ||
      (value.launchMode === "direct-browser-compatibility" &&
        value.evidenceTier === "direct-browser-compatibility") ||
      (value.launchMode === "controlled-example" &&
        value.evidenceTier === "deterministic-controlled-example");
    if (!launchTierValid) {
      context.addIssue({
        code: "custom",
        path: ["evidenceTier"],
        message: "Evidence tier is incompatible with the recorded launch mode."
      });
    }
    for (const field of [
      "suiteId",
      "suiteDigest",
      "caseId",
      "caseDigest",
      "catalogDigest"
    ] as const) {
      if (value[field] !== value.contract[field]) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} must match Contract v3.`
        });
      }
    }
    if (
      value.selectedExpectedTool !== value.contract.expectedTool ||
      value.buildCommit !== value.contract.buildCommit ||
      value.manifest.appCommit !== value.buildCommit ||
      value.manifest.catalogDigest !== value.catalogDigest ||
      value.sourceTruth.trustedStateSource !== value.contract.trustedStateSource
    ) {
      context.addIssue({
        code: "custom",
        message: "Result identity must match Contract v3, manifest, and source truth."
      });
    }
    if (value.armedAt !== null && Date.parse(value.completedAt) < Date.parse(value.armedAt)) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Result completion cannot precede arm."
      });
    }
    if (
      value.armedAt === null &&
      (value.verdict !== "unavailable" ||
        value.observedTool !== null ||
        value.handlerOutcome !== null ||
        value.ledgerDiff.eventCountDelta !== 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["armedAt"],
        message: "Only a pre-arm UNAVAILABLE result may omit the arm timestamp."
      });
    }
    const assertionIds = value.assertions.map(({ assertionId }) => assertionId);
    const signalCodes = value.diagnosticSignals.map(({ code }) => code);
    if (new Set(assertionIds).size !== assertionIds.length) {
      context.addIssue({
        code: "custom",
        path: ["assertions"],
        message: "Assertion IDs must be unique."
      });
    }
    if (new Set(signalCodes).size !== signalCodes.length) {
      context.addIssue({
        code: "custom",
        path: ["diagnosticSignals"],
        message: "Diagnostic signal codes must be unique."
      });
    }
    if (
      value.diagnostic.contractDigest !== value.contractDigest ||
      value.diagnostic.buildCommit !== value.buildCommit ||
      value.diagnostic.completedAt !== value.completedAt
    ) {
      context.addIssue({
        code: "custom",
        path: ["diagnostic"],
        message: "Diagnostic identity must match the terminal result identity."
      });
    }
    const everyPassed = value.assertions.every(({ passed }) => passed);
    if (value.verdict === "pass" && (!everyPassed || value.observedTool === null)) {
      context.addIssue({
        code: "custom",
        path: ["verdict"],
        message: "PASS requires one observed tool and every assertion passing."
      });
    }
    if (value.verdict === "issue" && (everyPassed || value.observedTool === null)) {
      context.addIssue({
        code: "custom",
        path: ["verdict"],
        message: "ISSUE requires an observed tool and at least one measured mismatch."
      });
    }
    if (
      value.verdict === "pass" &&
      (value.diagnostic.status !== "not-needed" ||
        value.diagnostic.releaseGuidance !== "case-passed")
    ) {
      context.addIssue({
        code: "custom",
        path: ["diagnostic"],
        message: "PASS requires a not-needed diagnosis."
      });
    }
    if (value.verdict === "issue" && value.diagnostic.status !== "diagnosed") {
      context.addIssue({
        code: "custom",
        path: ["diagnostic"],
        message: "ISSUE requires diagnosed terminal evidence."
      });
    }
    if (
      (value.verdict === "incomplete" || value.verdict === "unavailable") &&
      (value.diagnostic.releaseGuidance !== "rerun-required" ||
        !["inconclusive", "invalid-evidence"].includes(value.diagnostic.status))
    ) {
      context.addIssue({
        code: "custom",
        path: ["diagnostic"],
        message: "INCOMPLETE and UNAVAILABLE require rerun guidance."
      });
    }
  });

export type ByoaDemoResultV3 = z.infer<typeof byoaDemoResultV3Schema>;
export type DemoAssertionV3 = DemoAssertionV2;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function answerKeyIsolationForTier(tier: ByoaEvidenceTier): ByoaDemoResultV3["answerKeyIsolation"] {
  if (tier === "independent-agent-native") return "verified-withheld";
  if (tier === "native-plumbing-context-contaminated") return "context-contaminated";
  return "not-applicable";
}

function resultCore(value: Omit<ByoaDemoResultV3, "resultDigest"> | ByoaDemoResultV3) {
  const { diagnostic, resultDigest, ...core } = value as ByoaDemoResultV3;
  void diagnostic;
  void resultDigest;
  return core;
}

function resultWithoutDigest(value: ByoaDemoResultV3) {
  const { resultDigest, ...rest } = value;
  void resultDigest;
  return rest;
}

async function createResultV3Diagnostic(input: Parameters<typeof createDiagnosticEnvelope>[0]) {
  const diagnostic = await createDiagnosticEnvelope(input);
  return Object.freeze({
    ...diagnostic,
    limitations: Object.freeze([
      ...diagnostic.limitations,
      BYOA_SUPPORTED_CLIENT_ISOLATION_LIMITATION
    ])
  });
}

export interface CreateByoaResultV3Input {
  readonly runId: string;
  readonly contract: ByoaContractV3;
  readonly expectedLineage: ByoaContractV3ExpectedLineage;
  readonly launchMode: ByoaLaunchMode;
  readonly evidenceTier: ByoaEvidenceTier;
  readonly observedTool: ByoaDemoResultV3["observedTool"];
  readonly rawArguments: JsonValue | null;
  readonly canonicalArguments: JsonValue | null;
  readonly trustedStateBefore: CheckoutState;
  readonly trustedStateAfter: CheckoutState;
  readonly ledgerDiff: LedgerDiffV3;
  readonly handlerOutcome: ByoaDemoResultV3["handlerOutcome"];
  readonly assertions: readonly DemoAssertionV3[];
  readonly diagnosticSignals: readonly DiagnosticSignal[];
  readonly verdict: ByoaDemoResultV3["verdict"];
  readonly manifest: ByoaAgentEnvironmentManifestV2;
  readonly manifestHash: string;
  readonly armedAt: string | null;
  readonly completedAt: string;
  readonly previousResultDigest?: string | null;
}

export async function createByoaDemoResultV3(
  input: CreateByoaResultV3Input
): Promise<ByoaDemoResultV3> {
  const contract = await verifyByoaContractV3(input.contract, input.expectedLineage);
  const contractDigest = await byoaContractV3Digest(contract, input.expectedLineage);
  const manifest = byoaEnvironmentManifestV2Schema.parse(input.manifest);
  if ((await canonicalSha256(manifest)) !== input.manifestHash) {
    throw new Error("BYOA Result v3 manifest hash does not match canonical manifest bytes.");
  }
  const trustedStateBefore = await createCheckoutStateEvidence(input.trustedStateBefore);
  const trustedStateAfter = await createCheckoutStateEvidence(input.trustedStateAfter);
  const diagnosticSignals = input.diagnosticSignals.map((signal) =>
    diagnosticSignalSchema.parse(signal)
  );
  const core = {
    version: BYOA_RESULT_V3_VERSION,
    evidenceClass: "exploratory-byoa" as const,
    includedInReferenceScore: false as const,
    runId: input.runId,
    launchMode: input.launchMode,
    evidenceTier: input.evidenceTier,
    answerKeyIsolation: answerKeyIsolationForTier(input.evidenceTier),
    source: "native-webmcp" as const,
    sourceTruth: {
      trustedStateSource: THURSTONE_DEMO_TRUSTED_STATE_SOURCE,
      stateAuthority: "browser-local-site-owned-sandbox" as const,
      ledgerAuthority: "append-only-native-operation-ledger" as const,
      toolResponseRole: "corroborating-only" as const
    },
    suiteId: contract.suiteId,
    suiteDigest: contract.suiteDigest,
    caseId: contract.caseId,
    caseDigest: contract.caseDigest,
    catalogDigest: contract.catalogDigest,
    contract,
    contractDigest,
    selectedExpectedTool: contract.expectedTool,
    observedTool: input.observedTool,
    rawArguments: input.rawArguments,
    canonicalArguments: input.canonicalArguments,
    trustedStateBefore,
    trustedStateAfter,
    ledgerDiff: ledgerDiffV3Schema.parse(input.ledgerDiff),
    handlerOutcome:
      input.handlerOutcome === null ? null : byoaHandlerOutcomeV3Schema.parse(input.handlerOutcome),
    assertions: input.assertions.map((assertion) => demoAssertionV2Schema.parse(assertion)),
    diagnosticSignals,
    verdict: input.verdict,
    replayMeasurement: "not-measured-single-admitted-call" as const,
    buildCommit: contract.buildCommit,
    manifest,
    manifestHash: input.manifestHash,
    armedAt: input.armedAt,
    completedAt: input.completedAt,
    previousResultDigest: input.previousResultDigest ?? null
  };
  const sourceResultDigest = await canonicalSha256(core);
  const diagnostic = await createResultV3Diagnostic({
    sourceResultDigest,
    contractDigest,
    buildCommit: contract.buildCommit,
    completedAt: input.completedAt,
    signals: diagnosticSignals
  });
  const withoutDigest = { ...core, diagnostic };
  const resultDigest = await canonicalSha256(withoutDigest);
  return verifyByoaDemoResultV3({ ...withoutDigest, resultDigest });
}

export function parseByoaDemoResultV3(value: unknown): ByoaDemoResultV3 {
  return deepFreeze(
    JSON.parse(canonicalJson(byoaDemoResultV3Schema.parse(value))) as ByoaDemoResultV3
  );
}

export async function verifyByoaDemoResultV3(value: unknown): Promise<ByoaDemoResultV3> {
  const parsed = parseByoaDemoResultV3(value);
  const expectedLineage = {
    suiteId: parsed.suiteId,
    suiteDigest: parsed.suiteDigest,
    caseId: parsed.caseId,
    catalogDigest: parsed.catalogDigest
  };
  await verifyByoaContractV3(parsed.contract, expectedLineage);
  if ((await byoaContractV3Digest(parsed.contract, expectedLineage)) !== parsed.contractDigest) {
    throw new Error("BYOA Result v3 contract digest does not match Contract v3.");
  }
  await verifyCheckoutStateEvidence(parsed.trustedStateBefore);
  await verifyCheckoutStateEvidence(parsed.trustedStateAfter);
  if ((await canonicalSha256(parsed.manifest)) !== parsed.manifestHash) {
    throw new Error("BYOA Result v3 manifest digest does not match canonical manifest bytes.");
  }
  const sourceResultDigest = await canonicalSha256(resultCore(parsed));
  if (sourceResultDigest !== parsed.diagnostic.sourceResultDigest) {
    throw new Error("BYOA Result v3 diagnostic source digest does not match the result core.");
  }
  const recomputedDiagnostic = await createResultV3Diagnostic({
    sourceResultDigest,
    contractDigest: parsed.contractDigest,
    buildCommit: parsed.buildCommit,
    completedAt: parsed.completedAt,
    signals: parsed.diagnosticSignals
  });
  if (canonicalJson(recomputedDiagnostic) !== canonicalJson(parsed.diagnostic)) {
    throw new Error("BYOA Result v3 diagnostic does not match deterministic diagnostic signals.");
  }
  if ((await canonicalSha256(resultWithoutDigest(parsed))) !== parsed.resultDigest) {
    throw new Error("BYOA Result v3 digest does not match the terminal result bytes.");
  }
  return parsed;
}
