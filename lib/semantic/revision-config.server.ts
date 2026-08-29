import "server-only";

import { canonicalJson } from "@/lib/evidence/digest";
import { createProbeRedis } from "@/lib/probe/ledger";
import { readRepairProviderReceipt } from "@/lib/repair/store.server";
import { readPermanentScoredRunById } from "@/lib/scored/run-store.server";
import {
  BASELINE_EVIDENCE_DIGEST_ENV,
  BASELINE_RUN_ID_ENV,
  REVISED_EVIDENCE_DIGEST_ENV,
  REVISED_RUN_ID_ENV
} from "@/lib/results/config";
import { createGate3TargetContractBinding } from "@/lib/semantic/checkout-candidate.server";
import {
  GATE3_FROZEN_PROTOCOL_HASH_ENV,
  configuredGate3FrozenProtocol
} from "@/lib/semantic/frozen-config.server";
import { readGate3Freeze } from "@/lib/semantic/freeze-store.server";
import {
  GATE5_SOURCE_DIFF_ENV,
  decodeGate5SourceDiffProofBase64Url
} from "@/lib/semantic/gate5-source-diff-proof";
import {
  GATE6_PRESENTATION_PROOF_ENV,
  decodeGate6PresentationProof
} from "@/lib/results/presentation-proof";
import {
  buildGate5RevisionFreeze,
  type Gate5RevisionFreeze,
  verifyGate5RevisionFreezeIntegrity
} from "@/lib/semantic/revision-freeze.server";
import { readGate5RevisionFreeze } from "@/lib/semantic/revision-store.server";

export const GATE5_REVISION_APPROVAL_ENV = "TOOLPROOF_GATE5_REVISION_APPROVAL_B64";
export const GATE5_REVISION_FREEZE_HASH_ENV = "TOOLPROOF_GATE5_REVISION_FREEZE_HASH";
export const GATE5_PRESENTATION_COMMIT_ENV = "TOOLPROOF_GATE5_PRESENTATION_COMMIT";
const SCORED_OPERATOR_PHASE_ENV = "TOOLPROOF_SCORED_OPERATOR_PHASE";

type EnvironmentLike = Readonly<Record<string, string | undefined>>;

export interface Gate5RevisionDependencies {
  readonly createProbeRedis: typeof createProbeRedis;
  readonly readRepairProviderReceipt: typeof readRepairProviderReceipt;
  readonly readPermanentScoredRunById: typeof readPermanentScoredRunById;
  readonly createGate3TargetContractBinding: typeof createGate3TargetContractBinding;
  readonly configuredGate3FrozenProtocol: typeof configuredGate3FrozenProtocol;
  readonly readGate3Freeze: typeof readGate3Freeze;
  readonly readGate5RevisionFreeze: typeof readGate5RevisionFreeze;
}

const DEFAULT_DEPENDENCIES: Gate5RevisionDependencies = Object.freeze({
  createProbeRedis,
  readRepairProviderReceipt,
  readPermanentScoredRunById,
  createGate3TargetContractBinding,
  configuredGate3FrozenProtocol,
  readGate3Freeze,
  readGate5RevisionFreeze
});

export interface Gate5RevisionConfiguration {
  readonly status: "awaiting-repair" | "awaiting-human" | "ready" | "invalid";
  readonly revision: Gate5RevisionFreeze | null;
  readonly issue: string | null;
}

export function assertGate5TerminalPresentationBinding(input: {
  readonly currentAppCommit: string;
  readonly allowedPresentationCommit: string | undefined;
  readonly scoredOperatorPhase: string | undefined;
  readonly revisedRunId: string | undefined;
  readonly revisedEvidenceDigest: string | undefined;
}): void {
  if (
    !/^[a-f0-9]{40}$/u.test(input.currentAppCommit) ||
    input.allowedPresentationCommit !== input.currentAppCommit ||
    Boolean(input.scoredOperatorPhase?.trim()) ||
    !/^run_[A-Za-z0-9_-]{22}$/u.test(input.revisedRunId ?? "") ||
    !/^[a-f0-9]{64}$/u.test(input.revisedEvidenceDigest ?? "")
  ) {
    throw new Error("gate5_terminal_presentation_binding_invalid");
  }
}

export function assertStoredGate5RevisionLineage(input: {
  readonly stored: Gate5RevisionFreeze;
  readonly rebuilt: Gate5RevisionFreeze;
  readonly activeCommit: string;
  readonly gate3FrozenProtocolHash: string;
  readonly baselineRunId: string;
  readonly baselineEvidenceDigest: string;
}): void {
  if (
    input.stored.v2AppCommit !== input.activeCommit ||
    input.stored.gate3FrozenProtocolHash !== input.gate3FrozenProtocolHash ||
    input.stored.baselineRunId !== input.baselineRunId ||
    input.stored.baselineEvidenceDigest !== input.baselineEvidenceDigest ||
    canonicalJson(input.stored) !== canonicalJson(input.rebuilt)
  ) {
    throw new Error("gate5_stored_revision_mismatch");
  }
}

function activeCommit(environment: EnvironmentLike): string {
  const vercel = environment.VERCEL_GIT_COMMIT_SHA?.trim();
  const override = environment.TOOLPROOF_COMMIT_SHA?.trim();
  if (vercel && override && vercel !== override) throw new Error("gate5_commit_override_mismatch");
  const value = vercel ?? override ?? "";
  if (!/^[a-f0-9]{40}$/u.test(value)) throw new Error("gate5_app_commit_invalid");
  return value;
}

function decode(value: string): unknown {
  if (value.length < 1 || value.length > 8_192 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("gate5_revision_approval_encoding_invalid");
  }
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
}

export async function configuredGate5Revision(
  environment: EnvironmentLike = process.env,
  dependencies: Gate5RevisionDependencies = DEFAULT_DEPENDENCIES
): Promise<Gate5RevisionConfiguration> {
  try {
    const artifactSecret = environment.TOOLPROOF_SIGNING_SECRET?.trim();
    const gate3Hash = environment[GATE3_FROZEN_PROTOCOL_HASH_ENV]?.trim();
    if (!artifactSecret || !/^[a-f0-9]{64}$/u.test(gate3Hash ?? "")) {
      return Object.freeze({ status: "awaiting-repair", revision: null, issue: null });
    }
    const redis = dependencies.createProbeRedis(environment as NodeJS.ProcessEnv);
    const baselineRunId = environment[BASELINE_RUN_ID_ENV]?.trim();
    const baselineEvidenceDigest = environment[BASELINE_EVIDENCE_DIGEST_ENV]?.trim();
    if (
      !/^run_[A-Za-z0-9_-]{22}$/u.test(baselineRunId ?? "") ||
      !/^[a-f0-9]{64}$/u.test(baselineEvidenceDigest ?? "")
    ) {
      return Object.freeze({ status: "awaiting-repair", revision: null, issue: null });
    }
    const [gate3, frozen, baseline, repair] = await Promise.all([
      dependencies.readGate3Freeze(redis, { frozenProtocolHash: gate3Hash!, artifactSecret }),
      dependencies.configuredGate3FrozenProtocol(environment),
      dependencies.readPermanentScoredRunById(redis, {
        phase: "baseline",
        frozenProtocolHash: gate3Hash!,
        runId: baselineRunId!,
        artifactSecret
      }),
      dependencies.readRepairProviderReceipt(redis, {
        baselineEvidenceDigest: baselineEvidenceDigest!,
        artifactSecret
      })
    ]);
    if (
      !gate3 ||
      frozen.status !== "frozen" ||
      !frozen.protocol ||
      frozen.protocol.frozenProtocolHash !== gate3Hash ||
      gate3.frozenProtocol.frozenProtocolHash !== gate3Hash ||
      !baseline ||
      baseline.status !== "acknowledged" ||
      baseline.terminalStatus !== "terminal-complete" ||
      baseline.completedCount !== 24 ||
      baseline.evidenceDigest !== baselineEvidenceDigest ||
      baseline.identity.runId !== baselineRunId ||
      baseline.identity.appCommit !== gate3.reviewPackage.targetContract.appCommit ||
      baseline.identity.frozenProtocolHash !== gate3Hash ||
      baseline.identity.reviewPackageHash !== gate3.reviewPackage.packageHash ||
      baseline.identity.freezeCandidateHash !== gate3.reviewPackage.freezeHash
    ) {
      throw new Error("gate5_gate3_predecessor_missing");
    }
    if (!repair) return Object.freeze({ status: "awaiting-repair", revision: null, issue: null });
    const currentAppCommit = activeCommit(environment);
    const storedRevisionHash = environment[GATE5_REVISION_FREEZE_HASH_ENV]?.trim();
    const stored = storedRevisionHash
      ? await dependencies.readGate5RevisionFreeze(redis, {
          revisionFreezeHash: storedRevisionHash,
          artifactSecret
        })
      : null;
    if (storedRevisionHash && !stored) throw new Error("gate5_stored_revision_mismatch");
    const terminalPresentation = Boolean(stored && stored.v2AppCommit !== currentAppCommit);
    const revisedRunId = environment[REVISED_RUN_ID_ENV]?.trim();
    const revisedEvidenceDigest = environment[REVISED_EVIDENCE_DIGEST_ENV]?.trim();
    if (terminalPresentation && stored) {
      assertGate5TerminalPresentationBinding({
        currentAppCommit,
        allowedPresentationCommit: environment[GATE5_PRESENTATION_COMMIT_ENV]?.trim(),
        scoredOperatorPhase: environment[SCORED_OPERATOR_PHASE_ENV]?.trim(),
        revisedRunId,
        revisedEvidenceDigest
      });
      const presentationProof = await decodeGate6PresentationProof(
        environment[GATE6_PRESENTATION_PROOF_ENV]?.trim() ?? ""
      );
      if (
        environment.TOOLPROOF_GATE6_PRESENTATION_PROOF_HASH?.trim() !==
          presentationProof.proofHash ||
        presentationProof.measuredV2Commit !== stored!.v2AppCommit ||
        presentationProof.presentationCommit !== currentAppCommit ||
        presentationProof.baselineRawSha256 !==
          "edf0f0e3a2a3438be58a17e27594e57e6230f713c68501a3d26900cb731d7dfb" ||
        presentationProof.revisedRawSha256 !==
          "26c436e38fecd8a128a0204af510556b3edf555ceeb421254d0248c0b23302fa"
      ) {
        throw new Error("gate6_presentation_proof_binding_invalid");
      }
      await verifyGate5RevisionFreezeIntegrity(stored);
      const rebuiltStored = await buildGate5RevisionFreeze({
        gate3ReviewPackage: gate3.reviewPackage,
        gate3FrozenProtocol: gate3.frozenProtocol,
        baselineRunId: baselineRunId!,
        baselineEvidenceDigest: baselineEvidenceDigest!,
        repairBuilderReceipt: repair.repairBuilderReceipt,
        revisionApproval: stored.revisionApproval,
        v2TargetContract: stored.v2TargetContract,
        sourceDiffProof: stored.sourceDiffProof
      });
      assertStoredGate5RevisionLineage({
        stored,
        rebuilt: rebuiltStored,
        activeCommit: stored.v2AppCommit,
        gate3FrozenProtocolHash: gate3Hash!,
        baselineRunId: baselineRunId!,
        baselineEvidenceDigest: baselineEvidenceDigest!
      });
      const revised = await dependencies.readPermanentScoredRunById(redis, {
        phase: "revised",
        frozenProtocolHash: stored.revisionFreezeHash,
        runId: revisedRunId!,
        artifactSecret
      });
      if (
        !revised ||
        revised.status !== "acknowledged" ||
        revised.terminalStatus !== "terminal-complete" ||
        revised.completedCount !== 24 ||
        revised.evidenceDigest !== revisedEvidenceDigest ||
        revised.identity.appCommit !== stored.v2AppCommit ||
        revised.identity.frozenProtocolHash !== stored.revisionFreezeHash ||
        revised.identity.reviewPackageHash !== stored.gate3ReviewPackageHash ||
        revised.identity.freezeCandidateHash !== gate3.reviewPackage.freezeHash
      ) {
        throw new Error("gate5_terminal_presentation_evidence_mismatch");
      }
      return Object.freeze({ status: "ready", revision: stored, issue: null });
    }

    const approval = environment[GATE5_REVISION_APPROVAL_ENV]?.trim();
    if (!approval) return Object.freeze({ status: "awaiting-human", revision: null, issue: null });
    const sourceDiffProof = environment[GATE5_SOURCE_DIFF_ENV]?.trim();
    if (!sourceDiffProof) throw new Error("gate5_source_diff_proof_missing");
    const measuredV2Commit = stored?.v2AppCommit ?? currentAppCommit;
    const rebuilt = await buildGate5RevisionFreeze({
      gate3ReviewPackage: gate3.reviewPackage,
      gate3FrozenProtocol: gate3.frozenProtocol,
      baselineRunId: baselineRunId!,
      baselineEvidenceDigest: baselineEvidenceDigest!,
      repairBuilderReceipt: repair.repairBuilderReceipt,
      revisionApproval: decode(approval),
      v2TargetContract: await dependencies.createGate3TargetContractBinding(measuredV2Commit),
      sourceDiffProof: await decodeGate5SourceDiffProofBase64Url(sourceDiffProof)
    });
    if (stored) {
      assertStoredGate5RevisionLineage({
        stored,
        rebuilt,
        activeCommit: measuredV2Commit,
        gate3FrozenProtocolHash: gate3Hash!,
        baselineRunId: baselineRunId!,
        baselineEvidenceDigest: baselineEvidenceDigest!
      });
      return Object.freeze({ status: "ready", revision: stored, issue: null });
    }
    return Object.freeze({ status: "ready", revision: rebuilt, issue: null });
  } catch (error) {
    return Object.freeze({
      status: "invalid",
      revision: null,
      issue: error instanceof Error ? error.message : "gate5_revision_configuration_invalid"
    });
  }
}
