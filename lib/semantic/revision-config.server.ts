import "server-only";

import { canonicalJson } from "@/lib/evidence/digest";
import { createProbeRedis } from "@/lib/probe/ledger";
import { readRepairProviderReceipt } from "@/lib/repair/store.server";
import { readPermanentScoredRunById } from "@/lib/scored/run-store.server";
import {
  BASELINE_EVIDENCE_DIGEST_ENV,
  BASELINE_RUN_ID_ENV
} from "@/lib/results/semantic-results.server";
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
  buildGate5RevisionFreeze,
  type Gate5RevisionFreeze
} from "@/lib/semantic/revision-freeze.server";
import { readGate5RevisionFreeze } from "@/lib/semantic/revision-store.server";

export const GATE5_REVISION_APPROVAL_ENV = "TOOLPROOF_GATE5_REVISION_APPROVAL_B64";
export const GATE5_REVISION_FREEZE_HASH_ENV = "TOOLPROOF_GATE5_REVISION_FREEZE_HASH";

type EnvironmentLike = Readonly<Record<string, string | undefined>>;

export interface Gate5RevisionConfiguration {
  readonly status: "awaiting-repair" | "awaiting-human" | "ready" | "invalid";
  readonly revision: Gate5RevisionFreeze | null;
  readonly issue: string | null;
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
  environment: EnvironmentLike = process.env
): Promise<Gate5RevisionConfiguration> {
  try {
    const artifactSecret = environment.TOOLPROOF_SIGNING_SECRET?.trim();
    const gate3Hash = environment[GATE3_FROZEN_PROTOCOL_HASH_ENV]?.trim();
    if (!artifactSecret || !/^[a-f0-9]{64}$/u.test(gate3Hash ?? "")) {
      return Object.freeze({ status: "awaiting-repair", revision: null, issue: null });
    }
    const redis = createProbeRedis(environment as NodeJS.ProcessEnv);
    const baselineRunId = environment[BASELINE_RUN_ID_ENV]?.trim();
    const baselineEvidenceDigest = environment[BASELINE_EVIDENCE_DIGEST_ENV]?.trim();
    if (
      !/^run_[A-Za-z0-9_-]{22}$/u.test(baselineRunId ?? "") ||
      !/^[a-f0-9]{64}$/u.test(baselineEvidenceDigest ?? "")
    ) {
      return Object.freeze({ status: "awaiting-repair", revision: null, issue: null });
    }
    const [gate3, frozen, baseline, repair] = await Promise.all([
      readGate3Freeze(redis, { frozenProtocolHash: gate3Hash!, artifactSecret }),
      configuredGate3FrozenProtocol(environment),
      readPermanentScoredRunById(redis, {
        phase: "baseline",
        frozenProtocolHash: gate3Hash!,
        runId: baselineRunId!,
        artifactSecret
      }),
      readRepairProviderReceipt(redis, {
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
      baseline.completedCount !== 24 ||
      baseline.evidenceDigest !== baselineEvidenceDigest ||
      baseline.identity.runId !== baselineRunId ||
      baseline.identity.frozenProtocolHash !== gate3Hash ||
      baseline.identity.reviewPackageHash !== gate3.reviewPackage.packageHash
    ) {
      throw new Error("gate5_gate3_predecessor_missing");
    }
    if (!repair) return Object.freeze({ status: "awaiting-repair", revision: null, issue: null });
    const approval = environment[GATE5_REVISION_APPROVAL_ENV]?.trim();
    if (!approval) return Object.freeze({ status: "awaiting-human", revision: null, issue: null });
    const sourceDiffProof = environment[GATE5_SOURCE_DIFF_ENV]?.trim();
    if (!sourceDiffProof) throw new Error("gate5_source_diff_proof_missing");
    const revisionApproval = decode(approval);
    const rebuilt = await buildGate5RevisionFreeze({
      gate3ReviewPackage: gate3.reviewPackage,
      gate3FrozenProtocol: gate3.frozenProtocol,
      baselineRunId: baselineRunId!,
      baselineEvidenceDigest: baselineEvidenceDigest!,
      repairBuilderReceipt: repair.repairBuilderReceipt,
      revisionApproval,
      v2TargetContract: await createGate3TargetContractBinding(activeCommit(environment)),
      sourceDiffProof: await decodeGate5SourceDiffProofBase64Url(sourceDiffProof)
    });
    const storedRevisionHash = environment[GATE5_REVISION_FREEZE_HASH_ENV]?.trim();
    if (storedRevisionHash) {
      const stored = await readGate5RevisionFreeze(redis, {
        revisionFreezeHash: storedRevisionHash,
        artifactSecret
      });
      if (!stored) throw new Error("gate5_stored_revision_mismatch");
      assertStoredGate5RevisionLineage({
        stored,
        rebuilt,
        activeCommit: activeCommit(environment),
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
