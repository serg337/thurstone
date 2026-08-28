import { canonicalSha256 } from "@/lib/evidence/digest";
import { parseProbeDecision, type ProbeDecision } from "@/lib/probe/decision";
import { verifyExpectationFreeScoredEnvelope, type ScoredPurpose } from "@/lib/scored/envelope";
import { z } from "zod";

export const SCORED_NATIVE_ADMISSION_VERSION = "toolproof-scored-native-admission@1.0.0";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

export const scoredNativeAdmissionSchema = z
  .object({
    version: z.literal(SCORED_NATIVE_ADMISSION_VERSION),
    purpose: z.enum(["baseline", "revised"]),
    runId: z.string().regex(/^run_[A-Za-z0-9_-]{22}$/u),
    caseId: z.string().regex(/^case_[A-Za-z0-9_-]{22}$/u),
    trialId: z.string().regex(/^trial_[A-Za-z0-9_-]{22}$/u),
    freezeHash: sha256,
    appCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    envelopeHash: sha256,
    manifestHash: sha256,
    registrationGeneration: z.number().int().positive(),
    transportBindingHash: sha256,
    decisionHash: sha256,
    toolName: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/u),
    argumentsHash: sha256,
    bindingHash: sha256
  })
  .strict();

export type ScoredNativeAdmission = z.infer<typeof scoredNativeAdmissionSchema>;

export class ScoredNativeAdmissionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ScoredNativeAdmissionError";
  }
}

function admissionPayload(input: Omit<ScoredNativeAdmission, "bindingHash">) {
  return {
    version: input.version,
    purpose: input.purpose,
    runId: input.runId,
    caseId: input.caseId,
    trialId: input.trialId,
    freezeHash: input.freezeHash,
    appCommit: input.appCommit,
    envelopeHash: input.envelopeHash,
    manifestHash: input.manifestHash,
    registrationGeneration: input.registrationGeneration,
    transportBindingHash: input.transportBindingHash,
    decisionHash: input.decisionHash,
    toolName: input.toolName,
    argumentsHash: input.argumentsHash
  } as const;
}

/**
 * Binds the one observed call to the opaque scored claim and live catalog. It deliberately knows
 * nothing about the expected tool or score; a durable single-writer store consumes this once.
 */
export async function createScoredNativeAdmission(input: {
  readonly envelope: unknown;
  readonly decision: ProbeDecision;
}): Promise<ScoredNativeAdmission> {
  const envelope = await verifyExpectationFreeScoredEnvelope(input.envelope);
  const decision = parseProbeDecision(
    input.decision,
    envelope.liveManifest,
    envelope.runner.transport
  );
  if (decision.kind !== "call") {
    throw new ScoredNativeAdmissionError("scored_native_call_required");
  }
  const payload = admissionPayload({
    version: SCORED_NATIVE_ADMISSION_VERSION,
    purpose: envelope.purpose,
    runId: envelope.runId,
    caseId: envelope.caseId,
    trialId: envelope.trialId,
    freezeHash: envelope.runBinding.freezeHash,
    appCommit: envelope.buildCommit,
    envelopeHash: envelope.envelopeHash,
    manifestHash: envelope.liveManifest.manifestHash,
    registrationGeneration: envelope.initialBoundary.registrationGeneration,
    transportBindingHash: envelope.runner.transport.bindingHash,
    decisionHash: await canonicalSha256(decision),
    toolName: decision.tool,
    argumentsHash: await canonicalSha256(decision.arguments)
  });
  return Object.freeze(
    scoredNativeAdmissionSchema.parse({
      ...payload,
      bindingHash: await canonicalSha256(payload)
    })
  );
}

export async function verifyScoredNativeAdmission(input: {
  readonly envelope: unknown;
  readonly decision: ProbeDecision;
  readonly admission: unknown;
}): Promise<ScoredNativeAdmission> {
  const envelope = await verifyExpectationFreeScoredEnvelope(input.envelope);
  const decision = parseProbeDecision(
    input.decision,
    envelope.liveManifest,
    envelope.runner.transport
  );
  if (decision.kind !== "call") {
    throw new ScoredNativeAdmissionError("scored_native_call_required");
  }
  const admission = scoredNativeAdmissionSchema.parse(input.admission);
  const payload = admissionPayload(admission);
  if (
    admission.purpose !== (envelope.purpose as ScoredPurpose) ||
    admission.runId !== envelope.runId ||
    admission.caseId !== envelope.caseId ||
    admission.trialId !== envelope.trialId ||
    admission.freezeHash !== envelope.runBinding.freezeHash ||
    admission.appCommit !== envelope.buildCommit ||
    admission.envelopeHash !== envelope.envelopeHash ||
    admission.manifestHash !== envelope.liveManifest.manifestHash ||
    admission.registrationGeneration !== envelope.initialBoundary.registrationGeneration ||
    admission.transportBindingHash !== envelope.runner.transport.bindingHash ||
    admission.decisionHash !== (await canonicalSha256(decision)) ||
    admission.toolName !== decision.tool ||
    admission.argumentsHash !== (await canonicalSha256(decision.arguments)) ||
    admission.bindingHash !== (await canonicalSha256(payload)) ||
    !envelope.liveManifest.tools.some(({ name }) => name === admission.toolName)
  ) {
    throw new ScoredNativeAdmissionError("scored_native_binding_mismatch");
  }
  return admission;
}
