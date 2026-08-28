import "server-only";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import type { Gate3HumanReviewPackage } from "@/lib/semantic/checkout-candidate.server";
import {
  type Gate5SourceDiffProof,
  verifyGate5SourceDiffProof
} from "@/lib/semantic/gate5-source-diff-proof";
import type { Gate3FrozenProtocol } from "@/lib/semantic/human-freeze.server";
import {
  semanticTargetContractBindingSchema,
  type SemanticTargetContractBinding
} from "@/lib/semantic/protocol-freeze.server";
import { z } from "zod";

export const GATE5_REPAIR_BUILDER_RECEIPT_VERSION = "toolproof-gate5-repair-builder-receipt@1.0.0";
export const GATE5_REVISION_APPROVAL_VERSION = "toolproof-gate5-revision-approval@1.0.0";
export const GATE5_REVISION_FREEZE_VERSION = "toolproof-gate5-revision-freeze@1.0.0";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const timestamp = z.string().datetime({ offset: true });
const description = z
  .string()
  .min(40)
  .max(500)
  .refine((value) => value.trim().length === value.length);

export const gate5RepairBuilderReceiptSchema = z
  .object({
    version: z.literal(GATE5_REPAIR_BUILDER_RECEIPT_VERSION),
    contextId: z.string().regex(/^repair_[A-Za-z0-9_-]{22}$/u),
    contextClass: z.literal("fresh-stateless-application-api"),
    provider: z.literal("OpenAI"),
    model: z.literal("gpt-5.6-terra"),
    store: z.literal(false),
    baselineRunId: z.string().regex(/^run_[A-Za-z0-9_-]{22}$/u),
    baselineEvidenceDigest: sha256,
    developmentPackageHash: sha256,
    developmentCaseCount: z.literal(12),
    holdoutPromptCountReceived: z.literal(0),
    holdoutResultCountReceived: z.literal(0),
    filesystemAccess: z.literal(false),
    browserAccess: z.literal(false),
    sourceBriefAccess: z.literal(false),
    fullContractAccess: z.literal(false),
    proposedField: z.literal("checkout_request.description"),
    proposedDescription: description,
    rationale: z.string().min(20).max(4_000),
    createdAt: timestamp,
    receiptHash: sha256
  })
  .strict();

export type Gate5RepairBuilderReceipt = z.infer<typeof gate5RepairBuilderReceiptSchema>;

export const gate5RevisionApprovalSchema = z
  .object({
    version: z.literal(GATE5_REVISION_APPROVAL_VERSION),
    receiptId: z.string().regex(/^revision_[A-Za-z0-9_-]{22}$/u),
    reviewer: z.literal("Sergio Valencia"),
    authority: z.literal("human-semantic-authority"),
    decision: z.literal("approved"),
    repairBuilderReceiptHash: sha256,
    proposedField: z.literal("checkout_request.description"),
    approvedDescription: description,
    reviewedAt: timestamp,
    approvalText: z.string().min(1).max(4_000)
  })
  .strict();

export type Gate5RevisionApproval = z.infer<typeof gate5RevisionApprovalSchema>;

export interface Gate5RevisionFreeze {
  readonly version: typeof GATE5_REVISION_FREEZE_VERSION;
  readonly status: "frozen";
  readonly baselineRunId: string;
  readonly baselineEvidenceDigest: string;
  readonly gate3ReviewPackageHash: string;
  readonly gate3FrozenProtocolHash: string;
  readonly v1AppCommit: string;
  readonly v2AppCommit: string;
  readonly changedField: "checkout_request.description";
  readonly oldDescription: string;
  readonly newDescription: string;
  readonly sourceDiffProof: Gate5SourceDiffProof;
  readonly repairBuilderReceipt: Gate5RepairBuilderReceipt;
  readonly revisionApproval: Gate5RevisionApproval;
  readonly v2TargetContract: SemanticTargetContractBinding;
  readonly unchangedProtocolBindings: {
    readonly contractHash: string;
    readonly casesHash: string;
    readonly fixtureHash: string;
    readonly runnerHash: string;
    readonly evaluatorHash: string;
    readonly retryPolicyHash: string;
    readonly scheduleHash: string;
  };
  readonly revisionFreezeHash: string;
}

export class Gate5RevisionFreezeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "Gate5RevisionFreezeError";
  }
}

function withoutCheckoutDescription(target: SemanticTargetContractBinding) {
  return {
    toolsetVersion: target.toolsetVersion,
    domainVersion: target.domainVersion,
    initial: target.initialManifest.tools.map((tool) => ({
      ...tool,
      ...(tool.name === "checkout_request" ? { description: "<approved-variable>" } : {})
    })),
    pending: target.pendingManifest.tools.map((tool) => ({
      ...tool,
      ...(tool.name === "checkout_request" ? { description: "<approved-variable>" } : {})
    })),
    initialHandlerVersions: target.initialHandlerVersions,
    pendingHandlerVersions: target.pendingHandlerVersions
  };
}

function checkoutDescription(target: SemanticTargetContractBinding): string {
  const initial = target.initialManifest.tools.find(({ name }) => name === "checkout_request");
  const pending = target.pendingManifest.tools.find(({ name }) => name === "checkout_request");
  if (!initial || !pending || initial.description !== pending.description) {
    throw new Gate5RevisionFreezeError("gate5_checkout_description_missing");
  }
  return initial.description;
}

export async function verifyGate5RepairBuilderReceipt(
  value: unknown
): Promise<Gate5RepairBuilderReceipt> {
  const receipt = gate5RepairBuilderReceiptSchema.parse(value);
  const { receiptHash, ...payload } = receipt;
  if ((await canonicalSha256(payload)) !== receiptHash) {
    throw new Gate5RevisionFreezeError("gate5_repair_receipt_hash_mismatch");
  }
  return receipt;
}

export async function buildGate5RevisionFreeze(input: {
  readonly gate3ReviewPackage: Gate3HumanReviewPackage;
  readonly gate3FrozenProtocol: Gate3FrozenProtocol;
  readonly baselineRunId: string;
  readonly baselineEvidenceDigest: string;
  readonly repairBuilderReceipt: unknown;
  readonly revisionApproval: unknown;
  readonly v2TargetContract: unknown;
  readonly sourceDiffProof: unknown;
}): Promise<Gate5RevisionFreeze> {
  const repairBuilderReceipt = await verifyGate5RepairBuilderReceipt(input.repairBuilderReceipt);
  const revisionApproval = gate5RevisionApprovalSchema.parse(input.revisionApproval);
  const v2TargetContract = semanticTargetContractBindingSchema.parse(input.v2TargetContract);
  const v1TargetContract = input.gate3ReviewPackage.targetContract;
  const oldDescription = checkoutDescription(v1TargetContract);
  const newDescription = checkoutDescription(v2TargetContract);
  const sourceDiffProof = await verifyGate5SourceDiffProof(input.sourceDiffProof, {
    v1AppCommit: v1TargetContract.appCommit,
    v2AppCommit: v2TargetContract.appCommit,
    oldDescription,
    newDescription
  });
  if (
    input.gate3FrozenProtocol.reviewPackageHash !== input.gate3ReviewPackage.packageHash ||
    repairBuilderReceipt.baselineRunId !== input.baselineRunId ||
    repairBuilderReceipt.baselineEvidenceDigest !== input.baselineEvidenceDigest ||
    revisionApproval.repairBuilderReceiptHash !== repairBuilderReceipt.receiptHash ||
    revisionApproval.approvedDescription !== repairBuilderReceipt.proposedDescription ||
    revisionApproval.approvedDescription !== newDescription ||
    oldDescription === newDescription ||
    v1TargetContract.appCommit === v2TargetContract.appCommit ||
    canonicalJson(withoutCheckoutDescription(v1TargetContract)) !==
      canonicalJson(withoutCheckoutDescription(v2TargetContract))
  ) {
    throw new Gate5RevisionFreezeError("gate5_one_variable_diff_mismatch");
  }
  const componentHashes = input.gate3ReviewPackage.freezeManifest.componentHashes;
  const payload: Omit<Gate5RevisionFreeze, "revisionFreezeHash"> = {
    version: GATE5_REVISION_FREEZE_VERSION,
    status: "frozen" as const,
    baselineRunId: input.baselineRunId,
    baselineEvidenceDigest: input.baselineEvidenceDigest,
    gate3ReviewPackageHash: input.gate3ReviewPackage.packageHash,
    gate3FrozenProtocolHash: input.gate3FrozenProtocol.frozenProtocolHash,
    v1AppCommit: v1TargetContract.appCommit,
    v2AppCommit: v2TargetContract.appCommit,
    changedField: "checkout_request.description" as const,
    oldDescription,
    newDescription,
    sourceDiffProof,
    repairBuilderReceipt,
    revisionApproval,
    v2TargetContract,
    unchangedProtocolBindings: {
      contractHash: componentHashes.contract,
      casesHash: componentHashes.cases,
      fixtureHash: componentHashes.fixture,
      runnerHash: componentHashes.runner,
      evaluatorHash: componentHashes.evaluator,
      retryPolicyHash: componentHashes.retryPolicy,
      scheduleHash: componentHashes.schedule
    }
  };
  return Object.freeze({
    ...payload,
    revisionFreezeHash: await canonicalSha256(payload)
  });
}

export async function verifyGate5RevisionFreezeIntegrity(
  value: Gate5RevisionFreeze
): Promise<void> {
  if (
    value.version !== GATE5_REVISION_FREEZE_VERSION ||
    value.status !== "frozen" ||
    value.changedField !== "checkout_request.description"
  ) {
    throw new Gate5RevisionFreezeError("gate5_revision_shape_invalid");
  }
  await verifyGate5SourceDiffProof(value.sourceDiffProof, {
    v1AppCommit: value.v1AppCommit,
    v2AppCommit: value.v2AppCommit,
    oldDescription: value.oldDescription,
    newDescription: value.newDescription
  });
  const { revisionFreezeHash, ...payload } = value;
  if ((await canonicalSha256(payload)) !== revisionFreezeHash) {
    throw new Gate5RevisionFreezeError("gate5_revision_digest_invalid");
  }
}
