import "server-only";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  GATE3_REVIEW_PACKAGE_VERSION,
  GATE3_SUCCESSOR_REVIEW_PACKAGE_VERSION,
  buildGate3HumanReviewPackage,
  type Gate3HumanReviewPackage
} from "@/lib/semantic/checkout-candidate.server";
import {
  GATE3_AUTHORING_CONTINUITY_VERSION,
  GATE3_AUTHORING_TERMINATION_VERSION,
  gate3AuthoringTerminationSchema,
  verifyGate3SuccessorLineage,
  type Gate3AuthoringContinuity,
  type Gate3AuthoringTerminationReceipt
} from "@/lib/semantic/gate3-successor-lineage.server";
import { z } from "zod";

export const GATE3_HUMAN_REVIEW_RECEIPT_VERSION = "toolproof-gate3-human-review-receipt@1.0.0";
export const GATE3_FROZEN_PROTOCOL_VERSION = "toolproof-gate3-frozen-protocol@1.0.0";
export const GATE3_SUCCESSOR_FROZEN_PROTOCOL_VERSION = "toolproof-gate3-frozen-protocol@1.1.0";

export {
  GATE3_AUTHORING_CONTINUITY_VERSION,
  GATE3_AUTHORING_TERMINATION_VERSION,
  gate3AuthoringTerminationSchema
};
export type { Gate3AuthoringContinuity, Gate3AuthoringTerminationReceipt };

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const exactTimestamp = z.string().datetime({ offset: true });

export const gate3HumanReviewReceiptSchema = z
  .object({
    version: z.literal(GATE3_HUMAN_REVIEW_RECEIPT_VERSION),
    receiptId: z.string().regex(/^review_[A-Za-z0-9_-]{22}$/u),
    reviewer: z.literal("Sergio Valencia"),
    authority: z.literal("human-semantic-authority"),
    decision: z.literal("approved"),
    channel: z.literal("sergio-explicit-user-message"),
    reviewPackageHash: sha256,
    freezeHash: sha256,
    reviewedAt: exactTimestamp,
    approvalText: z
      .string()
      .min(1)
      .max(4_000)
      .refine((value) => value.trim().length > 0),
    notes: z.string().max(2_000)
  })
  .strict();

export type Gate3HumanReviewReceipt = z.infer<typeof gate3HumanReviewReceiptSchema>;

export interface Gate3FrozenProtocol {
  readonly version:
    typeof GATE3_FROZEN_PROTOCOL_VERSION | typeof GATE3_SUCCESSOR_FROZEN_PROTOCOL_VERSION;
  readonly status: "frozen";
  readonly reviewPackageHash: string;
  readonly freezeCandidateHash: string;
  readonly humanReviewReceipt: Gate3HumanReviewReceipt;
  readonly humanReviewReceiptHash: string;
  readonly authoringTermination?: Gate3AuthoringTerminationReceipt;
  readonly authoringTerminationHash?: string;
  readonly successorLineageHash?: string;
  readonly authoringContinuity?: Gate3AuthoringContinuity;
  readonly authoringContinuityHash?: string;
  readonly frozenManifest: Omit<Gate3HumanReviewPackage["freezeManifest"], "status"> & {
    readonly status: "frozen";
  };
  readonly frozenAt: string;
  readonly frozenProtocolHash: string;
}

export class Gate3HumanFreezeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "Gate3HumanFreezeError";
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Gate3HumanFreezeError("gate3_review_package_invalid");
  }
  return value as Record<string, unknown>;
}

export async function verifyGate3HumanReviewPackage(
  value: unknown
): Promise<Gate3HumanReviewPackage> {
  const candidate = objectValue(value);
  const source = objectValue(candidate.source);
  const evaluator = objectValue(candidate.evaluator);
  const successorLineage =
    candidate.version === GATE3_SUCCESSOR_REVIEW_PACKAGE_VERSION
      ? await verifyGate3SuccessorLineage(candidate.successorLineage)
      : undefined;
  if (
    (candidate.version !== GATE3_REVIEW_PACKAGE_VERSION && !successorLineage) ||
    (candidate.version === GATE3_REVIEW_PACKAGE_VERSION &&
      Object.hasOwn(candidate, "successorLineage"))
  ) {
    throw new Gate3HumanFreezeError("gate3_review_package_version_mismatch");
  }
  const expected = await buildGate3HumanReviewPackage({
    source: source as Gate3HumanReviewPackage["source"],
    canonicalizerSourceSha256: String(evaluator.canonicalizerSourceSha256 ?? ""),
    ...(successorLineage ? { successorLineage } : {})
  });
  if (canonicalJson(candidate) !== canonicalJson(expected)) {
    throw new Gate3HumanFreezeError("gate3_review_package_mismatch");
  }
  return expected;
}

export async function finalizeGate3HumanFreeze(input: {
  readonly reviewPackage: unknown;
  readonly humanReviewReceipt: unknown;
  readonly authoringTermination?: unknown;
}): Promise<Gate3FrozenProtocol> {
  const review = await verifyGate3HumanReviewPackage(input.reviewPackage);
  const humanReviewReceipt = gate3HumanReviewReceiptSchema.parse(input.humanReviewReceipt);
  if (
    humanReviewReceipt.reviewPackageHash !== review.packageHash ||
    humanReviewReceipt.freezeHash !== review.freezeHash
  ) {
    throw new Gate3HumanFreezeError("gate3_human_receipt_binding_mismatch");
  }
  const frozenManifest = {
    ...review.freezeManifest,
    status: "frozen" as const
  };
  const humanReviewReceiptHash = await canonicalSha256(humanReviewReceipt);
  let payload: Omit<Gate3FrozenProtocol, "frozenProtocolHash">;
  if (review.successorLineage) {
    const successorLineage = await verifyGate3SuccessorLineage(review.successorLineage);
    const authoringContinuity = successorLineage.authoringContinuity;
    if (input.authoringTermination !== undefined) {
      const supplied = gate3AuthoringTerminationSchema.parse(input.authoringTermination);
      if (
        canonicalJson(supplied) !== canonicalJson(authoringContinuity.originalAuthoringTermination)
      ) {
        throw new Gate3HumanFreezeError("gate3_successor_authoring_termination_mismatch");
      }
    }
    if (
      Date.parse(authoringContinuity.originalAuthoringTermination.terminatedAt) >
      Date.parse(humanReviewReceipt.reviewedAt)
    ) {
      throw new Gate3HumanFreezeError("gate3_authoring_termination_order_invalid");
    }
    payload = {
      version: GATE3_SUCCESSOR_FROZEN_PROTOCOL_VERSION,
      status: "frozen" as const,
      reviewPackageHash: review.packageHash,
      freezeCandidateHash: review.freezeHash,
      humanReviewReceipt,
      humanReviewReceiptHash,
      successorLineageHash: successorLineage.lineageHash,
      authoringContinuity,
      authoringContinuityHash: await canonicalSha256(authoringContinuity),
      frozenManifest,
      frozenAt: humanReviewReceipt.reviewedAt
    };
  } else {
    const authoringTermination = gate3AuthoringTerminationSchema.parse(input.authoringTermination);
    if (authoringTermination.reviewPackageHash !== review.packageHash) {
      throw new Gate3HumanFreezeError("gate3_human_receipt_binding_mismatch");
    }
    if (Date.parse(authoringTermination.terminatedAt) > Date.parse(humanReviewReceipt.reviewedAt)) {
      throw new Gate3HumanFreezeError("gate3_authoring_termination_order_invalid");
    }
    payload = {
      version: GATE3_FROZEN_PROTOCOL_VERSION,
      status: "frozen" as const,
      reviewPackageHash: review.packageHash,
      freezeCandidateHash: review.freezeHash,
      humanReviewReceipt,
      humanReviewReceiptHash,
      authoringTermination,
      authoringTerminationHash: await canonicalSha256(authoringTermination),
      frozenManifest,
      frozenAt: humanReviewReceipt.reviewedAt
    };
  }
  return Object.freeze({
    ...payload,
    frozenProtocolHash: await canonicalSha256(payload)
  });
}
