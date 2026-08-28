import { SCORED_TRIAL_ENVELOPE_VERSION, scoredTrialEnvelopeSchema } from "@/lib/scored/envelope";
import { scoredNativeAdmissionSchema } from "@/lib/scored/native-admission";
import { probeDecisionSchema } from "@/lib/probe/decision";
import { z } from "zod";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const documentId = z.string().regex(/^document_[A-Za-z0-9_-]{22,64}$/u);

export const scoredSessionStartBodySchema = z
  .object({
    intent: z.literal("start-frozen-toolproof-scored-run"),
    capability: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    phase: z.enum(["baseline", "revised"]),
    launchId: z.string().regex(/^launch_[A-Za-z0-9_-]{22,64}$/u),
    documentId
  })
  .strict();

export const scoredSessionRecoveryBodySchema = z
  .object({
    intent: z.literal("recover-frozen-toolproof-scored-run"),
    documentId
  })
  .strict();

export const scoredSessionResponseSchema = z
  .object({
    ok: z.literal(true),
    phase: z.enum(["baseline", "revised"]),
    path: z.enum(["/lab", "/results"]),
    buildCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    frozenProtocolHash: sha256,
    reviewPackageHash: sha256,
    csrfToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    sessionExpiresAt: z.number().int().positive(),
    recoveryExpiresAt: z.number().int().positive(),
    completedCount: z.number().int().min(0).max(24),
    remainingCount: z.number().int().min(0).max(24),
    currentOrdinal: z.number().int().min(0).max(24),
    currentAttempt: z.union([z.literal(0), z.literal(1)]),
    terminal: z.boolean()
  })
  .strict();
export type ScoredSessionResponse = z.infer<typeof scoredSessionResponseSchema>;

const boundarySchema = z
  .object({
    status: z.literal("verified"),
    catalogState: z.literal("initial"),
    fixtureId: z.literal("checkout-seed-v1"),
    fixtureSeed: z.literal("toolproof-checkout-seed-001"),
    stateRevision: z.literal(0),
    stateHash: sha256,
    manifestHash: sha256,
    registrationGeneration: z.number().int().positive(),
    operationLedgerCount: z.literal(0),
    currentTrajectoryCount: z.literal(0),
    resetId: z.string().min(16).max(128),
    resetReceipt: z.unknown(),
    registeredToolNames: z.array(z.string()).length(4)
  })
  .strict();

export const scoredIssueBodySchema = z
  .object({
    initialBoundary: boundarySchema,
    liveManifest: z.unknown()
  })
  .strict();

export const scoredAuthorizationResponseSchema = z
  .object({
    status: z.literal("issued"),
    runId: z.string().regex(/^run_[A-Za-z0-9_-]{22}$/u),
    caseId: z.string().regex(/^case_[A-Za-z0-9_-]{22}$/u),
    trialId: z.string().regex(/^trial_[A-Za-z0-9_-]{22}$/u),
    authorization: z
      .object({
        version: z.literal(1),
        probeToken: z.string().min(64).max(16_000),
        envelope: scoredTrialEnvelopeSchema,
        claimsHash: sha256
      })
      .strict()
  })
  .strict();

export const scoredDecisionBodySchema = z
  .object({
    probeToken: z.string().min(64).max(16_000),
    envelope: scoredTrialEnvelopeSchema
  })
  .strict();

export const scoredDecisionResponseSchema = z
  .object({
    context: z
      .object({
        kind: z.literal("fresh-stateless"),
        previousResponseId: z.null(),
        providerRequestCount: z.literal(1)
      })
      .strict(),
    rawModelResponse: z
      .string()
      .min(1)
      .max(128 * 1_024),
    providerReceipt: z.unknown(),
    decision: probeDecisionSchema.nullable()
  })
  .strict();

export const scoredNativeBodySchema = z
  .object({
    probeToken: z.string().min(64).max(16_000),
    envelope: scoredTrialEnvelopeSchema,
    decision: probeDecisionSchema,
    registrationGeneration: z.number().int().positive()
  })
  .strict();

export const scoredNativeResponseSchema = z
  .object({
    status: z.enum(["admitted", "already-admitted"]),
    admission: scoredNativeAdmissionSchema
  })
  .strict();

export const scoredCompleteBodySchema = z
  .object({
    probeToken: z.string().min(64).max(16_000),
    envelope: scoredTrialEnvelopeSchema,
    completion: z.unknown()
  })
  .strict();

export const scoredCompleteResponseSchema = z
  .object({
    status: z.literal("sealed"),
    completedCount: z.number().int().min(0).max(24),
    remainingCount: z.number().int().min(0).max(24),
    terminal: z.boolean(),
    runStatus: z.enum(["active", "terminal-complete", "terminal-invalid"])
  })
  .strict();

export const scoredFailureBodySchema = z
  .object({
    stage: z.string().min(1).max(64),
    code: z.string().min(1).max(160),
    message: z.string().min(1).max(1_000),
    inferencePerformed: z.boolean(),
    nativeCallMade: z.boolean(),
    probeToken: z.string().min(64).max(16_000).optional(),
    envelope: scoredTrialEnvelopeSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.probeToken === undefined) !== (value.envelope === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["probeToken"],
        message: "Failure authorization and envelope must be supplied together."
      });
    }
  });
export type ScoredFailureBody = z.infer<typeof scoredFailureBodySchema>;

export const scoredRevealBodySchema = z
  .object({ intent: z.literal("reveal-terminal-scored-run") })
  .strict();
export const scoredAcknowledgeBodySchema = z
  .object({
    intent: z.literal("acknowledge-verified-scored-run"),
    evidenceDigest: sha256
  })
  .strict();

export const SCORED_SERVICE_MAX_BODY_BYTES = 1_900_000;
export { SCORED_TRIAL_ENVELOPE_VERSION };
