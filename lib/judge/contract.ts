import { probeDecisionSchema } from "@/lib/probe/decision";
import { PROBE_MODEL } from "@/lib/probe/policy";
import { z } from "zod";

export const JUDGE_DEMO_LANE = "signed-out-fixed-read-only-judge-demo" as const;
export const JUDGE_DEMO_API_VERSION = "toolproof-judge-demo-api@1.0.0";
export const JUDGE_DEMO_RUN_INTENT = "run-fixed-read-only-judge-demo" as const;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const gitCommit = z.string().regex(/^[a-f0-9]{40}$/u);
const gitOid = z.string().regex(/^[a-f0-9]{40}$/u);
const judgeEvidenceRootCommit = "e2cf8d47375abfeeb4f32bd6f5973918acf4c091";
const judgeRecoveryImplementationCommit = "6211ebc63efe1e65992cfd04e36ebc438b545c9a";
const judgeRecoveryCiFinalizationCommit = "4443650f5513840dd1bf64b9378cc984bb5a706b";
const judgeRecoveryCiFinalizationTree = "248068b833fcb17cf28d6801553167412bdbe3be";
const recoveryCiFinalizationPaths = [
  "lib/judge/collateral-checkout-verifier.server.ts",
  "lib/judge/collateral-proof.ts",
  "lib/judge/contract.ts",
  "lib/judge/presentation-binding.server.ts",
  "tests/integration/judge-presentation.test.ts"
] as const;
const truthStatusFinalizationPaths = [
  "lib/judge/collateral-checkout-verifier.server.ts",
  "lib/judge/collateral-proof.ts",
  "lib/judge/contract.ts",
  "README.md",
  "tests/integration/judge-presentation.test.ts"
] as const;
const recoveryFinalizationPaths = [
  "lib/judge/collateral-checkout-verifier.server.ts",
  "lib/judge/collateral-proof.ts",
  "lib/judge/contract.ts",
  "lib/judge/presentation-binding.server.ts",
  "README.md",
  "tests/integration/judge-presentation.test.ts"
] as const;
const recoveryFinalizationPath = z.enum(recoveryFinalizationPaths);
const publicRecoveryTreeChangeSchema = z
  .object({
    path: recoveryFinalizationPath,
    status: z.enum(["A", "D", "M", "T"]),
    predecessorMode: z
      .string()
      .regex(/^[0-7]{6}$/u)
      .nullable(),
    successorMode: z
      .string()
      .regex(/^[0-7]{6}$/u)
      .nullable(),
    predecessorBlobOid: gitOid.nullable(),
    successorBlobOid: gitOid.nullable()
  })
  .strict();
const publicTruthStatusFinalizationSchema = z
  .object({
    version: z.literal("toolproof-judge-demo-truth-status-finalization@1.0.0"),
    kind: z.literal("truth-status-finalization"),
    predecessorCommit: gitCommit,
    predecessorTree: gitOid,
    activeCommit: gitCommit,
    activeTree: gitOid,
    changedPaths: z.array(recoveryFinalizationPath).length(truthStatusFinalizationPaths.length),
    treeChanges: z
      .array(publicRecoveryTreeChangeSchema)
      .length(truthStatusFinalizationPaths.length),
    gitTreeProjectionHash: sha256,
    expectedReadmeSentence: z.literal(
      "Its sole provider decision remains sealed on evidence root `e2cf8d47375abfeeb4f32bd6f5973918acf4c091`; recovery and native completion are deployment-bound and recorded by the live receipt and release manifest, not preclaimed by source."
    ),
    forbiddenReadmePhrase: z.literal(
      "while the archive-presentation recovery and a fresh current-build native replay remain required before Gate 7 can be called complete"
    ),
    providerCallsPerformed: z.literal(0),
    storeWritesPerformed: z.literal(0)
  })
  .strict();
const publicCiTimeoutValidationSchema = z
  .object({
    version: z.literal("toolproof-judge-demo-ci-timeout-validation@1.0.0"),
    kind: z.literal("recovery-finalization"),
    implementationCommit: gitCommit,
    implementationTree: gitOid,
    activeCommit: gitCommit,
    activeTree: gitOid,
    changedPaths: z
      .array(recoveryFinalizationPath)
      .min(recoveryCiFinalizationPaths.length)
      .max(recoveryFinalizationPaths.length),
    treeChanges: z
      .array(publicRecoveryTreeChangeSchema)
      .min(recoveryCiFinalizationPaths.length)
      .max(recoveryFinalizationPaths.length),
    gitTreeProjectionHash: sha256,
    timeoutPath: z.literal("tests/integration/judge-presentation.test.ts"),
    timeoutMs: z.literal(20_000),
    timeoutCount: z.literal(3),
    truthStatusFinalization: publicTruthStatusFinalizationSchema.nullable().optional(),
    providerCallsPerformed: z.literal(0),
    storeWritesPerformed: z.literal(0)
  })
  .strict()
  .superRefine((validation, context) => {
    const truthStatus = validation.truthStatusFinalization ?? null;
    const expectedPaths =
      truthStatus === null ? recoveryCiFinalizationPaths : recoveryFinalizationPaths;
    const exactPaths = expectedPaths.every(
      (path, index) =>
        validation.changedPaths[index] === path && validation.treeChanges[index]?.path === path
    );
    if (
      validation.implementationCommit !== "6211ebc63efe1e65992cfd04e36ebc438b545c9a" ||
      validation.implementationTree !== "239082df68b195bc6f901e51dfcd90b2dd5bec6b" ||
      validation.activeCommit === validation.implementationCommit ||
      validation.changedPaths.length !== expectedPaths.length ||
      validation.treeChanges.length !== expectedPaths.length ||
      (truthStatus === null
        ? validation.activeCommit !== judgeRecoveryCiFinalizationCommit ||
          validation.activeTree !== judgeRecoveryCiFinalizationTree
        : truthStatus.predecessorCommit !== judgeRecoveryCiFinalizationCommit ||
          truthStatus.predecessorTree !== judgeRecoveryCiFinalizationTree ||
          truthStatus.activeCommit !== validation.activeCommit ||
          truthStatus.activeTree !== validation.activeTree ||
          !truthStatusFinalizationPaths.every(
            (path, index) =>
              truthStatus.changedPaths[index] === path &&
              truthStatus.treeChanges[index]?.path === path
          )) ||
      !exactPaths
    ) {
      context.addIssue({
        code: "custom",
        message: "The recovery finalization identity must match the frozen bounded transition."
      });
    }
  });

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

const publicRebrandVerificationSchema = z
  .object({
    productNameBefore: z.literal("ToolProof"),
    productNameAfter: z.literal("Thurstone"),
    adoptedAt: z.literal("2026-08-29"),
    legacyProtocolNamespace: z.literal("toolproof"),
    predecessorBindingHash: sha256,
    predecessorBindingArtifactSha256: sha256,
    protocolExtensionCommit: gitCommit,
    protocolProjectionHash: sha256,
    brandingProjectionHash: sha256,
    preservedArtifactsHash: sha256,
    gate6PresentationProofHash: sha256,
    gate6CriticalProjectionHash: sha256,
    scoredCallsPerformed: z.literal(0)
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
    caseId: z.literal("judge_multi_quantity_lines_v1"),
    naturalLanguageRequest: z.literal("Which current cart lines have a quantity greater than one?"),
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
        version: z.enum([
          "toolproof-judge-demo-public-presentation-lineage@2.0.0",
          "toolproof-judge-demo-public-presentation-lineage@3.0.0"
        ]),
        rootEvidenceCommit: gitCommit,
        activeCommit: gitCommit,
        rootEnvelopeHash: sha256,
        activeEnvelopeHash: sha256,
        rootReceiptDigest: sha256,
        rootArtifactDigest: sha256,
        rootStoredProjectionDigest: sha256,
        rootCapturedAt: z.string().datetime({ offset: true }),
        immutableProjectionHash: sha256,
        transitions: z
          .array(
            z
              .object({
                kind: z.enum([
                  "sealed-reader-compatibility-recovery",
                  "presentation-rebrand",
                  "collateral-links"
                ]),
                ordinal: z.number().int().min(0).max(2),
                predecessorCommit: gitCommit,
                successorCommit: gitCommit,
                predecessorEnvelopeHash: sha256,
                successorEnvelopeHash: sha256,
                firstParentChainHash: sha256,
                gitTreeProjectionHash: sha256,
                criticalProjectionHash: sha256,
                dependencyProjectionHash: sha256,
                proofHash: sha256,
                ciTimeoutValidation: publicCiTimeoutValidationSchema.nullable(),
                rebrandVerification: publicRebrandVerificationSchema.nullable().optional(),
                providerCallsPerformed: z.literal(0),
                storeWritesPerformed: z.literal(0),
                replayOnly: z.literal(true)
              })
              .strict()
          )
          .min(1)
          .max(3),
        gitProofPackSha256: sha256,
        lineageHash: sha256,
        bindingHash: sha256,
        providerCallsPerformed: z.literal(0),
        storeWritesPerformed: z.literal(0),
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
    const binding = projection.presentationBinding;
    const transitions = binding.transitions;
    const legacyKindsValid =
      binding.version === "toolproof-judge-demo-public-presentation-lineage@2.0.0" &&
      transitions[0]?.kind === "sealed-reader-compatibility-recovery" &&
      (transitions.length === 1 ||
        (transitions.length === 2 && transitions[1]?.kind === "collateral-links"));
    const rebrandKindsValid =
      binding.version === "toolproof-judge-demo-public-presentation-lineage@3.0.0" &&
      transitions[0]?.kind === "sealed-reader-compatibility-recovery" &&
      transitions[1]?.kind === "presentation-rebrand" &&
      (transitions.length === 2 ||
        (transitions.length === 3 && transitions[2]?.kind === "collateral-links"));
    const continuityValid = transitions.every((transition, index) => {
      const priorCommit =
        index === 0 ? binding.rootEvidenceCommit : transitions[index - 1]!.successorCommit;
      const priorEnvelopeHash =
        index === 0 ? binding.rootEnvelopeHash : transitions[index - 1]!.successorEnvelopeHash;
      return (
        transition.ordinal === index &&
        transition.predecessorCommit === priorCommit &&
        transition.predecessorEnvelopeHash === priorEnvelopeHash &&
        (index !== 0 || transition.kind === "sealed-reader-compatibility-recovery") &&
        (transition.kind === "sealed-reader-compatibility-recovery" ||
          transition.ciTimeoutValidation === null) &&
        (transition.kind === "presentation-rebrand"
          ? transition.rebrandVerification !== null && transition.rebrandVerification !== undefined
          : (transition.rebrandVerification ?? null) === null) &&
        (binding.rootEvidenceCommit !== judgeEvidenceRootCommit ||
          transition.kind !== "sealed-reader-compatibility-recovery" ||
          (transition.successorCommit === judgeRecoveryImplementationCommit
            ? transition.ciTimeoutValidation === null
            : transition.ciTimeoutValidation !== null)) &&
        (transition.ciTimeoutValidation === null ||
          (transition.ciTimeoutValidation.implementationCommit ===
            judgeRecoveryImplementationCommit &&
            transition.ciTimeoutValidation.implementationTree ===
              "239082df68b195bc6f901e51dfcd90b2dd5bec6b" &&
            transition.ciTimeoutValidation.activeCommit === transition.successorCommit))
      );
    });
    if (
      binding.rootEvidenceCommit !== projection.evidenceAppCommit ||
      binding.activeCommit !== projection.appCommit ||
      binding.rootEnvelopeHash !== projection.envelopeHash ||
      binding.rootCapturedAt !== projection.capturedAt ||
      binding.rootEvidenceCommit === binding.activeCommit ||
      binding.lineageHash !== binding.bindingHash ||
      transitions.at(-1)?.successorCommit !== binding.activeCommit ||
      transitions.at(-1)?.successorEnvelopeHash !== binding.activeEnvelopeHash ||
      (!legacyKindsValid && !rebrandKindsValid) ||
      !continuityValid
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
