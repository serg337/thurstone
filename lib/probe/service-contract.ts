import {
  probeCalibrationEnvelopeSchema,
  probeFixtureSynopsisSchema,
  probeLiveManifestSchema
} from "@/lib/probe/calibration-envelope";
import { PROBE_CLIENT_RUNNER_VERSION } from "@/lib/probe/client-runner";
import { z } from "zod";

export const PROBE_SERVICE_VERSION = "toolproof-probe-service@1.0.0";
export const PROBE_MAX_CONTINUATION_CHARACTERS = 1_800_000;

const opaqueId = z.string().regex(/^[A-Za-z0-9_-]{16,96}$/u);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const continuation = z.string().min(32).max(PROBE_MAX_CONTINUATION_CHARACTERS);
const registeredToolNames = z
  .array(z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/u))
  .min(1)
  .max(5);

export const probeResetEvidenceSchema = z
  .object({
    verification: z.json(),
    domainReceipt: z.json(),
    inspection: z.json(),
    domainArchives: z.array(z.json()),
    traceLedger: z.json()
  })
  .strict();

export const probeBoundaryEvidenceSchema = z
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
    resetId: opaqueId,
    resetReceipt: probeResetEvidenceSchema,
    registeredToolNames
  })
  .strict();

export const probeSessionStartBodySchema = z
  .object({ intent: z.literal("start-four-case-calibration") })
  .strict();

export const probeIssueBodySchema = z
  .object({
    continuation,
    initialBoundary: probeBoundaryEvidenceSchema,
    fixture: probeFixtureSynopsisSchema,
    liveManifest: probeLiveManifestSchema
  })
  .strict();

export const probeIssueResponseSchema = z
  .object({
    version: z.literal(PROBE_SERVICE_VERSION),
    status: z.literal("issued"),
    runId: z.string().regex(/^run_[A-Za-z0-9_-]{22}$/u),
    caseId: z.string().regex(/^case_[A-Za-z0-9_-]{22}$/u),
    trialId: z.string().regex(/^trial_[A-Za-z0-9_-]{22}$/u),
    authorization: z
      .object({
        version: z.literal(1),
        probeToken: z.string().min(32).max(16_384),
        envelope: probeCalibrationEnvelopeSchema,
        continuation
      })
      .strict()
  })
  .strict();

export const probeRecoveredCompletionResponseSchema = z
  .object({
    version: z.literal(PROBE_SERVICE_VERSION),
    status: z.literal("already-sealed"),
    continuation,
    completedCount: z.number().int().min(1).max(4),
    terminal: z.boolean()
  })
  .strict();

export const probeIssueResultSchema = z.union([
  probeIssueResponseSchema,
  probeRecoveredCompletionResponseSchema
]);

export const probeDecideBodySchema = z
  .object({
    probeToken: z.string().min(32).max(16_384),
    envelope: probeCalibrationEnvelopeSchema
  })
  .strict();

export const probeNativeAdmissionBodySchema = z
  .object({
    probeToken: z.string().min(32).max(16_384),
    envelope: probeCalibrationEnvelopeSchema,
    initialBoundary: probeBoundaryEvidenceSchema
  })
  .strict();

export const probeNativeAdmissionResponseSchema = z
  .object({
    status: z.enum(["admitted", "already-admitted"]),
    jti: z.string().regex(/^[A-Za-z0-9_-]{16,96}$/u),
    inferencePerformed: z.literal(false)
  })
  .strict();

export const probeFreshDecisionResponseSchema = z
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
      .max(256 * 1_024),
    providerReceipt: z.json(),
    decision: z.json()
  })
  .strict();

export const probeTerminalStatusSchema = z.enum([
  "call_completed",
  "call_failed",
  "clarified",
  "abstained",
  "unregistered_tool",
  "malformed_decision",
  "provider_failure",
  "boundary_drift"
]);

export const probeCompleteBodySchema = z
  .object({
    probeToken: z.string().min(32).max(16_384),
    envelope: probeCalibrationEnvelopeSchema,
    providerReceipt: z.json(),
    continuation,
    completion: z
      .object({
        runnerVersion: z.literal(PROBE_CLIENT_RUNNER_VERSION),
        claim: z
          .object({
            runId: z.string().regex(/^run_[A-Za-z0-9_-]{22}$/u),
            caseId: z.string().regex(/^case_[A-Za-z0-9_-]{22}$/u),
            trialId: z.string().regex(/^trial_[A-Za-z0-9_-]{22}$/u)
          })
          .strict(),
        terminalStatus: probeTerminalStatusSchema,
        nativeDispatchCount: z.union([z.literal(0), z.literal(1)]),
        evidence: z.json(),
        postResetBoundary: probeBoundaryEvidenceSchema
      })
      .strict()
  })
  .strict();

export const probeRevealBodySchema = z.object({ continuation }).strict();

export const probeCompleteResponseSchema = z
  .object({
    status: z.literal("sealed"),
    continuation,
    completedCount: z.number().int().min(1).max(4),
    terminal: z.boolean()
  })
  .strict();

export type ProbeBoundaryEvidence = z.infer<typeof probeBoundaryEvidenceSchema>;
export type ProbeResetEvidence = z.infer<typeof probeResetEvidenceSchema>;
export type ProbeIssueBody = z.infer<typeof probeIssueBodySchema>;
export type ProbeIssueResponse = z.infer<typeof probeIssueResponseSchema>;
export type ProbeIssueResult = z.infer<typeof probeIssueResultSchema>;
export type ProbeDecideBody = z.infer<typeof probeDecideBodySchema>;
export type ProbeFreshDecisionResponse = z.infer<typeof probeFreshDecisionResponseSchema>;
export type ProbeCompleteBody = z.infer<typeof probeCompleteBodySchema>;
export type ProbeCompleteResponse = z.infer<typeof probeCompleteResponseSchema>;
