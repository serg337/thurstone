import "server-only";

import { createHmac } from "node:crypto";

import { canonicalSha256 } from "@/lib/evidence/digest";
import { PROBE_CALIBRATION_CASE_COUNT } from "@/lib/probe/calibration-catalog.server";
import { openProbeArtifact, sealProbeArtifact } from "@/lib/probe/server-artifact";
import type { ProbeSessionClaims } from "@/lib/probe/session";
import { z } from "zod";

export const PROBE_RUN_CONTINUATION_VERSION = 1;
export const PROBE_RUN_CONTINUATION_KIND = "run_continuation";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const runId = z.string().regex(/^run_[A-Za-z0-9_-]{22}$/u);
const opaqueId = z.string().regex(/^[A-Za-z0-9_-]{16,96}$/u);

export const probeCompletedCalibrationRowSchema = z
  .object({
    ordinal: z
      .number()
      .int()
      .min(0)
      .max(PROBE_CALIBRATION_CASE_COUNT - 1),
    jti: opaqueId,
    trialEvidence: z.json(),
    evaluation: z.json(),
    settlement: z.json()
  })
  .strict();

export const probeRunContinuationSchema = z
  .object({
    version: z.literal(PROBE_RUN_CONTINUATION_VERSION),
    activationHash: sha256,
    buildCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    sessionId: opaqueId,
    runId,
    nextOrdinal: z.number().int().min(0).max(PROBE_CALIBRATION_CASE_COUNT),
    rows: z.array(probeCompletedCalibrationRowSchema).max(PROBE_CALIBRATION_CASE_COUNT),
    lineageHash: sha256,
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    completedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
      .nullable()
  })
  .strict()
  .superRefine(({ nextOrdinal, rows, completedAt }, context) => {
    if (rows.length !== nextOrdinal) {
      context.addIssue({
        code: "custom",
        path: ["rows"],
        message: "Row count must equal ordinal."
      });
    }
    rows.forEach((row, index) => {
      if (row.ordinal !== index) {
        context.addIssue({
          code: "custom",
          path: ["rows", index, "ordinal"],
          message: "Rows must be an exact contiguous calibration prefix."
        });
      }
    });
    if ((nextOrdinal === PROBE_CALIBRATION_CASE_COUNT) !== (completedAt !== null)) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Completion timestamp must exist only for a terminal run."
      });
    }
  });

export type ProbeCompletedCalibrationRow = z.infer<typeof probeCompletedCalibrationRowSchema>;
export type ProbeRunContinuation = z.infer<typeof probeRunContinuationSchema>;

export class ProbeRunContinuationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProbeRunContinuationError";
  }
}

async function lineageHash(rows: readonly ProbeCompletedCalibrationRow[]): Promise<string> {
  return canonicalSha256(
    rows.map(({ ordinal, jti, trialEvidence, evaluation, settlement }) => ({
      ordinal,
      jti,
      trialEvidence,
      evaluation,
      settlement
    }))
  );
}

function assertSessionBinding(
  continuation: ProbeRunContinuation,
  session: ProbeSessionClaims,
  activationHash: string,
  buildCommit: string,
  nowMs: number
): void {
  const now = Math.floor(nowMs / 1_000);
  if (
    continuation.activationHash !== activationHash ||
    continuation.buildCommit !== buildCommit ||
    continuation.sessionId !== session.sessionId ||
    continuation.runId !== session.runId
  ) {
    throw new ProbeRunContinuationError("continuation_binding_mismatch");
  }
  if (
    continuation.issuedAt !== session.issuedAt ||
    continuation.expiresAt !== session.expiresAt ||
    continuation.expiresAt <= now
  ) {
    throw new ProbeRunContinuationError("continuation_expired");
  }
}

export async function createInitialProbeRunContinuation(input: {
  readonly session: ProbeSessionClaims;
  readonly signingSecret: string;
}): Promise<string> {
  const rows: readonly ProbeCompletedCalibrationRow[] = Object.freeze([]);
  const continuation = probeRunContinuationSchema.parse({
    version: PROBE_RUN_CONTINUATION_VERSION,
    activationHash: input.session.activationHash,
    buildCommit: input.session.buildCommit,
    sessionId: input.session.sessionId,
    runId: input.session.runId,
    nextOrdinal: 0,
    rows,
    lineageHash: await lineageHash(rows),
    issuedAt: input.session.issuedAt,
    expiresAt: input.session.expiresAt,
    completedAt: null
  });
  return sealProbeArtifact(PROBE_RUN_CONTINUATION_KIND, continuation, input.signingSecret);
}

export async function openProbeRunContinuation(input: {
  readonly token: string;
  readonly signingSecret: string;
  readonly session: ProbeSessionClaims;
  readonly activationHash: string;
  readonly buildCommit: string;
  readonly nowMs?: number;
}): Promise<ProbeRunContinuation> {
  let continuation: ProbeRunContinuation;
  try {
    continuation = probeRunContinuationSchema.parse(
      openProbeArtifact(PROBE_RUN_CONTINUATION_KIND, input.token, input.signingSecret)
    );
  } catch {
    throw new ProbeRunContinuationError("invalid_continuation");
  }
  assertSessionBinding(
    continuation,
    input.session,
    input.activationHash,
    input.buildCommit,
    input.nowMs ?? Date.now()
  );
  if (continuation.lineageHash !== (await lineageHash(continuation.rows))) {
    throw new ProbeRunContinuationError("continuation_lineage_mismatch");
  }
  return continuation;
}

export async function advanceProbeRunContinuation(input: {
  readonly current: ProbeRunContinuation;
  readonly row: ProbeCompletedCalibrationRow;
  readonly signingSecret: string;
  readonly completedAt?: string;
}): Promise<{ readonly token: string; readonly continuation: ProbeRunContinuation }> {
  if (
    input.current.nextOrdinal >= PROBE_CALIBRATION_CASE_COUNT ||
    input.row.ordinal !== input.current.nextOrdinal ||
    input.current.rows.some(({ jti }) => jti === input.row.jti)
  ) {
    throw new ProbeRunContinuationError("invalid_continuation_advance");
  }
  const rows = Object.freeze([
    ...input.current.rows,
    probeCompletedCalibrationRowSchema.parse(input.row)
  ]);
  const continuation = probeRunContinuationSchema.parse({
    ...input.current,
    nextOrdinal: input.current.nextOrdinal + 1,
    rows,
    lineageHash: await lineageHash(rows),
    completedAt:
      input.current.nextOrdinal + 1 === PROBE_CALIBRATION_CASE_COUNT ? input.completedAt : null
  });
  return Object.freeze({
    token: sealProbeArtifact(PROBE_RUN_CONTINUATION_KIND, continuation, input.signingSecret),
    continuation
  });
}

export function deriveProbeTrialOpaqueIds(input: {
  readonly runId: string;
  readonly ordinal: number;
  readonly activationSecret: string;
}): { readonly caseId: string; readonly trialId: string; readonly jti: string } {
  if (!runId.safeParse(input.runId).success) {
    throw new ProbeRunContinuationError("invalid_run_id");
  }
  if (
    !Number.isSafeInteger(input.ordinal) ||
    input.ordinal < 0 ||
    input.ordinal >= PROBE_CALIBRATION_CASE_COUNT
  ) {
    throw new ProbeRunContinuationError("invalid_calibration_ordinal");
  }
  const key = Buffer.from(input.activationSecret, "base64url");
  if (key.byteLength !== 32 || key.toString("base64url") !== input.activationSecret) {
    throw new ProbeRunContinuationError("invalid_activation_secret");
  }
  const digest = (label: string) =>
    createHmac("sha256", key)
      .update(`toolproof.probe.trial.v1.${label}.${input.runId}.${input.ordinal}`)
      .digest("base64url")
      .slice(0, 22);
  return Object.freeze({
    caseId: `case_${digest("case")}`,
    trialId: `trial_${digest("trial")}`,
    jti: `jti_${digest("authorization")}`
  });
}
