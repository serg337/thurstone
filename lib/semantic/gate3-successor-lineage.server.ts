import "server-only";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  gate5RepairBuilderReceiptSchema,
  verifyGate5RepairBuilderReceipt
} from "@/lib/semantic/revision-freeze.server";
import type {
  SemanticFixtureBinding,
  SemanticTargetContractBinding
} from "@/lib/semantic/protocol-freeze.server";
import { z } from "zod";

export const GATE3_AUTHORING_TERMINATION_VERSION = "toolproof-gate3-authoring-termination@1.0.0";
export const GATE3_AUTHORING_CONTINUITY_VERSION = "toolproof-gate3-authoring-continuity@1.0.0";
export const GATE3_SUCCESSOR_LINEAGE_VERSION = "toolproof-gate3-successor-lineage@1.1.0";
export const GATE3_V1_TARGET_SEMANTIC_PROJECTION_VERSION =
  "toolproof-gate3-v1-target-semantic-projection@1.0.0";
export const GATE3_SUCCESSOR_LINEAGE_ENV = "TOOLPROOF_GATE3_SUCCESSOR_LINEAGE_B64";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const exactTimestamp = z.string().datetime({ offset: true });

export const gate3AuthoringTerminationSchema = z
  .object({
    version: z.literal(GATE3_AUTHORING_TERMINATION_VERSION),
    contextId: z.literal("/root/gate3_authoring_builder"),
    status: z.literal("terminated"),
    reviewPackageHash: sha256,
    completedBeforeApproval: z.literal(true),
    contextCannotResumeForRepair: z.literal(true),
    holdoutSeenDuringAuthoring: z.literal(true),
    terminatedAt: exactTimestamp,
    evidenceNote: z
      .string()
      .min(1)
      .max(1_000)
      .refine((value) => value.trim().length > 0)
  })
  .strict();

export type Gate3AuthoringTerminationReceipt = z.infer<typeof gate3AuthoringTerminationSchema>;

export const gate3AuthoringContinuitySchema = z
  .object({
    version: z.literal(GATE3_AUTHORING_CONTINUITY_VERSION),
    disposition: z.literal("original-authoring-context-permanently-terminated"),
    originalReviewPackageHash: sha256,
    originalAuthoringTermination: gate3AuthoringTerminationSchema,
    originalAuthoringTerminationHash: sha256,
    originalAuthoringContextReauthorized: z.literal(false),
    successorReauthoringPerformed: z.literal(false),
    successorAuthoringTerminationMinted: z.literal(false)
  })
  .strict();

export type Gate3AuthoringContinuity = z.infer<typeof gate3AuthoringContinuitySchema>;

export const gate3SuccessorLineageSchema = z
  .object({
    version: z.literal(GATE3_SUCCESSOR_LINEAGE_VERSION),
    disposition: z.literal("superseded-protocol"),
    predecessor: z
      .object({
        reviewPackageHash: sha256,
        frozenProtocolHash: sha256,
        freezeCandidateHash: sha256,
        runId: z.string().regex(/^run_[A-Za-z0-9_-]{22}$/u),
        evidenceDigest: sha256,
        acknowledgementStatus: z.literal("acknowledged"),
        terminalStatus: z.literal("terminal-complete"),
        completedCaseCount: z.literal(24),
        providerCallCount: z.literal(24)
      })
      .strict(),
    semanticContinuity: z
      .object({
        contractHash: sha256,
        casesHash: sha256,
        scoredCasesHash: sha256,
        calibrationCasesHash: sha256,
        fixtureHash: sha256,
        runnerHash: sha256,
        evaluatorHash: sha256,
        retryPolicyHash: sha256,
        scheduleHash: sha256,
        targetContractSemanticProjectionHash: sha256
      })
      .strict(),
    priorRepair: z
      .object({
        repairBuilderReceipt: gate5RepairBuilderReceiptSchema,
        repairBuilderReceiptHash: sha256,
        providerCallCount: z.literal(1)
      })
      .strict(),
    phaseCallOffsets: z
      .object({
        baseline: z.literal(24),
        repair: z.literal(1),
        revised: z.literal(0)
      })
      .strict(),
    authoringContinuity: gate3AuthoringContinuitySchema,
    lineageHash: sha256
  })
  .strict();

export type Gate3SuccessorLineage = z.infer<typeof gate3SuccessorLineageSchema>;

export class Gate3SuccessorLineageError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "Gate3SuccessorLineageError";
  }
}

export interface Gate3SuccessorSemanticComponentHashes {
  readonly contract: string;
  readonly cases: string;
  readonly scoredCases: string;
  readonly calibrationCases: string;
  readonly fixture: string;
  readonly runner: string;
  readonly evaluator: string;
  readonly retryPolicy: string;
  readonly schedule: string;
}

export function buildGate3V1TargetContractSemanticProjection(
  targetContract: SemanticTargetContractBinding,
  fixture: SemanticFixtureBinding
) {
  const { appCommit: _appCommit, initialManifest, pendingManifest, ...target } = targetContract;
  const { manifestHash: _initialManifestHash, ...initial } = initialManifest;
  const { manifestHash: _pendingManifestHash, ...pending } = pendingManifest;
  void _appCommit;
  void _initialManifestHash;
  void _pendingManifestHash;
  return JSON.parse(
    canonicalJson({
      version: GATE3_V1_TARGET_SEMANTIC_PROJECTION_VERSION,
      fixture,
      targetContract: {
        ...target,
        initialManifest: { catalogState: "initial", ...initial },
        pendingManifest: { catalogState: "pending", ...pending }
      }
    })
  ) as {
    readonly version: typeof GATE3_V1_TARGET_SEMANTIC_PROJECTION_VERSION;
    readonly fixture: SemanticFixtureBinding;
    readonly targetContract: Omit<
      SemanticTargetContractBinding,
      "appCommit" | "initialManifest" | "pendingManifest"
    > & {
      readonly initialManifest: Omit<
        SemanticTargetContractBinding["initialManifest"],
        "manifestHash"
      > & { readonly catalogState: "initial" };
      readonly pendingManifest: Omit<
        SemanticTargetContractBinding["pendingManifest"],
        "manifestHash"
      > & { readonly catalogState: "pending" };
    };
  };
}

export async function gate3V1TargetContractSemanticProjectionHash(
  targetContract: SemanticTargetContractBinding,
  fixture: SemanticFixtureBinding
): Promise<string> {
  return canonicalSha256(buildGate3V1TargetContractSemanticProjection(targetContract, fixture));
}

export function assertGate3SuccessorSemanticContinuity(
  lineage: Gate3SuccessorLineage,
  componentHashes: Gate3SuccessorSemanticComponentHashes,
  targetContractSemanticProjectionHash: string
): void {
  const expected = lineage.semanticContinuity;
  if (
    expected.contractHash !== componentHashes.contract ||
    expected.casesHash !== componentHashes.cases ||
    expected.scoredCasesHash !== componentHashes.scoredCases ||
    expected.calibrationCasesHash !== componentHashes.calibrationCases ||
    expected.fixtureHash !== componentHashes.fixture ||
    expected.runnerHash !== componentHashes.runner ||
    expected.evaluatorHash !== componentHashes.evaluator ||
    expected.retryPolicyHash !== componentHashes.retryPolicy ||
    expected.scheduleHash !== componentHashes.schedule ||
    expected.targetContractSemanticProjectionHash !== targetContractSemanticProjectionHash
  ) {
    throw new Gate3SuccessorLineageError("gate3_successor_semantic_continuity_mismatch");
  }
}

export async function verifyGate3SuccessorLineage(value: unknown): Promise<Gate3SuccessorLineage> {
  let lineage: Gate3SuccessorLineage;
  try {
    lineage = gate3SuccessorLineageSchema.parse(value);
  } catch {
    throw new Gate3SuccessorLineageError("gate3_successor_lineage_schema_invalid");
  }
  const { lineageHash, ...payload } = lineage;
  const continuity = lineage.authoringContinuity;
  const repair = lineage.priorRepair.repairBuilderReceipt;
  try {
    await verifyGate5RepairBuilderReceipt(repair);
  } catch {
    throw new Gate3SuccessorLineageError("gate3_successor_repair_receipt_invalid");
  }
  if (
    (await canonicalSha256(payload)) !== lineageHash ||
    (await canonicalSha256(continuity.originalAuthoringTermination)) !==
      continuity.originalAuthoringTerminationHash ||
    continuity.originalAuthoringTermination.reviewPackageHash !==
      continuity.originalReviewPackageHash ||
    continuity.originalReviewPackageHash !== lineage.predecessor.reviewPackageHash ||
    repair.receiptHash !== lineage.priorRepair.repairBuilderReceiptHash ||
    repair.baselineRunId !== lineage.predecessor.runId ||
    repair.baselineEvidenceDigest !== lineage.predecessor.evidenceDigest
  ) {
    throw new Gate3SuccessorLineageError("gate3_successor_lineage_binding_mismatch");
  }
  return JSON.parse(canonicalJson(lineage)) as Gate3SuccessorLineage;
}

export async function decodeGate3SuccessorLineageBase64Url(
  encoded: string
): Promise<Gate3SuccessorLineage> {
  if (encoded.length < 1 || encoded.length > 16_384 || !/^[A-Za-z0-9_-]+$/u.test(encoded)) {
    throw new Gate3SuccessorLineageError("gate3_successor_lineage_encoding_invalid");
  }
  const bytes = Buffer.from(encoded, "base64url");
  if (
    bytes.byteLength < 1 ||
    bytes.byteLength > 12_288 ||
    bytes.toString("base64url") !== encoded
  ) {
    throw new Gate3SuccessorLineageError("gate3_successor_lineage_size_invalid");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Gate3SuccessorLineageError("gate3_successor_lineage_json_invalid");
  }
  return verifyGate3SuccessorLineage(parsed);
}
