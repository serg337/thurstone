import { probeDecisionSchema } from "@/lib/probe/decision";
import { PROBE_MODEL } from "@/lib/probe/policy";
import { z } from "zod";

export const JUDGE_DEMO_LANE = "signed-out-fixed-read-only-judge-demo" as const;
export const JUDGE_DEMO_API_VERSION = "toolproof-judge-demo-api@1.0.0";
export const JUDGE_DEMO_RUN_INTENT = "run-fixed-read-only-judge-demo" as const;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const gitCommit = z.string().regex(/^[a-f0-9]{40}$/u);

export const judgeDemoRunBodySchema = z
  .object({ intent: z.literal(JUDGE_DEMO_RUN_INTENT) })
  .strict();

export const judgeDemoUsageProjectionSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    accountedNanoUsd: z.number().int().nonnegative(),
    costBasis: z.literal("frozen-list-price-plus-10pct-uplift")
  })
  .strict();

export const judgeDemoProjectionSchema = z
  .object({
    version: z.literal("toolproof-judge-demo-public-receipt@1.0.0"),
    lane: z.literal(JUDGE_DEMO_LANE),
    evidenceClass: z.literal("non-scored-model-selection"),
    sourceFixed: z.literal(true),
    arbitraryPromptAccepted: z.literal(false),
    globalProviderCall: z.literal(1),
    nativeExecutionIncluded: z.literal(false),
    replayPolicy: z.literal("archived-decision-may-be-executed-locally-without-model-call"),
    appCommit: gitCommit,
    evidenceAppCommit: gitCommit,
    caseId: z.literal("judge_cart_inventory_v1"),
    naturalLanguageRequest: z.literal(
      "Before discussing checkout, produce a two-column inventory of the simulated cart: product name and unit count only."
    ),
    fixtureHash: sha256,
    manifestHash: sha256,
    evidenceManifestHash: sha256,
    envelopeHash: sha256,
    runnerHash: sha256,
    provider: z.literal("OpenAI"),
    model: z.literal(PROBE_MODEL),
    providerResponseHash: sha256,
    requestBodyHash: sha256,
    usageHash: sha256,
    usage: judgeDemoUsageProjectionSchema,
    decision: probeDecisionSchema.nullable(),
    decisionError: z.string().min(1).max(160).nullable(),
    responseStatus: z.string().min(1).max(64),
    capturedAt: z.string().datetime({ offset: true }),
    presentationBinding: z
      .object({
        version: z.literal("toolproof-judge-demo-public-presentation-binding@1.0.0"),
        predecessorCommit: gitCommit,
        successorCommit: gitCommit,
        predecessorEnvelopeHash: sha256,
        successorEnvelopeHash: sha256,
        predecessorReceiptDigest: sha256,
        immutableProjectionHash: sha256,
        collateralProofHash: sha256,
        bindingHash: sha256,
        providerCallsPerformed: z.literal(0),
        replayOnly: z.literal(true)
      })
      .strict()
      .nullable(),
    receiptDigest: sha256
  })
  .strict()
  .superRefine((projection, context) => {
    if (projection.presentationBinding === null) {
      if (
        projection.appCommit !== projection.evidenceAppCommit ||
        projection.manifestHash !== projection.evidenceManifestHash
      ) {
        context.addIssue({
          code: "custom",
          path: ["presentationBinding"],
          message: "An unpresented receipt must use its evidence build and manifest."
        });
      }
      return;
    }
    if (
      projection.presentationBinding.predecessorCommit !== projection.evidenceAppCommit ||
      projection.presentationBinding.successorCommit !== projection.appCommit ||
      projection.presentationBinding.predecessorEnvelopeHash !== projection.envelopeHash ||
      projection.presentationBinding.predecessorCommit ===
        projection.presentationBinding.successorCommit
    ) {
      context.addIssue({
        code: "custom",
        path: ["presentationBinding"],
        message: "A presentation receipt must bind distinct evidence and successor builds."
      });
    }
  });

export type JudgeDemoProjection = z.infer<typeof judgeDemoProjectionSchema>;

const statusCommon = {
  version: z.literal(JUDGE_DEMO_API_VERSION),
  lane: z.literal(JUDGE_DEMO_LANE),
  sourceFixed: z.literal(true),
  arbitraryPromptAccepted: z.literal(false),
  inferencePerformed: z.literal(false),
  reason: z.string().min(1).max(500)
} as const;

function terminalStatus(status: "disabled" | "running" | "uncertain" | "closed" | "unavailable") {
  return z
    .object({
      ...statusCommon,
      status: z.literal(status),
      remainingModelCalls: z.literal(0),
      projection: z.null()
    })
    .strict();
}

export const judgeDemoStatusSchema = z.discriminatedUnion("status", [
  terminalStatus("disabled"),
  z
    .object({
      ...statusCommon,
      status: z.literal("available"),
      remainingModelCalls: z.literal(1),
      projection: z.null()
    })
    .strict(),
  terminalStatus("running"),
  z
    .object({
      ...statusCommon,
      status: z.literal("recoverable"),
      remainingModelCalls: z.literal(0),
      projection: judgeDemoProjectionSchema
    })
    .strict(),
  z
    .object({
      ...statusCommon,
      status: z.literal("sealed"),
      remainingModelCalls: z.literal(0),
      projection: judgeDemoProjectionSchema
    })
    .strict(),
  terminalStatus("uncertain"),
  terminalStatus("closed"),
  terminalStatus("unavailable")
]);

export type JudgeDemoStatus = z.infer<typeof judgeDemoStatusSchema>;

export const judgeDemoDecisionResponseSchema = z.discriminatedUnion("status", [
  z
    .object({
      version: z.literal(JUDGE_DEMO_API_VERSION),
      lane: z.literal(JUDGE_DEMO_LANE),
      status: z.literal("fresh"),
      inferencePerformed: z.literal(true),
      projection: judgeDemoProjectionSchema.refine(
        ({ presentationBinding }) => presentationBinding === null,
        "A fresh decision cannot be a cross-commit presentation."
      )
    })
    .strict(),
  z
    .object({
      version: z.literal(JUDGE_DEMO_API_VERSION),
      lane: z.literal(JUDGE_DEMO_LANE),
      status: z.literal("archived"),
      inferencePerformed: z.literal(false),
      projection: judgeDemoProjectionSchema
    })
    .strict()
]);

export type JudgeDemoDecisionResponse = z.infer<typeof judgeDemoDecisionResponseSchema>;
