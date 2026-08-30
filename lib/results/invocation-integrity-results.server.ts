import "server-only";

import {
  INVOCATION_INTEGRITY_PENDING_ROWS,
  createInvocationIntegrityEvidenceExports,
  createInvocationIntegrityReleaseBinding,
  validateInvocationIntegritySupplementalEvidencePackage,
  type InvocationIntegrityResultsState
} from "@/lib/results/invocation-integrity-evidence";
import { MEASURED_INVOCATION_INTEGRITY_EVIDENCE } from "@/lib/results/invocation-integrity-measured";

type EnvironmentLike = Readonly<Record<string, string | undefined>>;

export function resolveInvocationIntegrityReleaseSha(environment: EnvironmentLike): string {
  const candidates = [
    ["TOOLPROOF_COMMIT_SHA", environment.TOOLPROOF_COMMIT_SHA],
    ["VERCEL_GIT_COMMIT_SHA", environment.VERCEL_GIT_COMMIT_SHA],
    ["NEXT_PUBLIC_TOOLPROOF_COMMIT_SHA", environment.NEXT_PUBLIC_TOOLPROOF_COMMIT_SHA]
  ].flatMap(([, value]) => (value === undefined ? [] : [value.trim()]));
  if (
    candidates.length === 0 ||
    candidates.some((value) => !/^[a-f0-9]{40}$/u.test(value)) ||
    new Set(candidates).size !== 1
  ) {
    throw new Error("invocation_integrity_release_build_binding_invalid");
  }
  return candidates[0]!;
}

export async function readInvocationIntegrityResults(
  environment: EnvironmentLike = process.env
): Promise<InvocationIntegrityResultsState> {
  if (MEASURED_INVOCATION_INTEGRITY_EVIDENCE === null) {
    return Object.freeze({
      status: "pending" as const,
      rows: INVOCATION_INTEGRITY_PENDING_ROWS,
      modelCallCount: 0 as const
    });
  }
  try {
    const evidencePackage = await validateInvocationIntegritySupplementalEvidencePackage(
      MEASURED_INVOCATION_INTEGRITY_EVIDENCE
    );
    const releaseBinding = await createInvocationIntegrityReleaseBinding(
      evidencePackage,
      resolveInvocationIntegrityReleaseSha(environment)
    );
    const evidenceExports = await createInvocationIntegrityEvidenceExports(
      evidencePackage,
      releaseBinding
    );
    return evidencePackage.evidenceClass === "supplemental-invocation-integrity-failure"
      ? Object.freeze({
          status: "failed" as const,
          evidencePackage,
          releaseBinding,
          evidenceExports
        })
      : Object.freeze({
          status: "complete" as const,
          evidencePackage,
          releaseBinding,
          evidenceExports
        });
  } catch {
    return Object.freeze({
      status: "invalid" as const,
      rows: INVOCATION_INTEGRITY_PENDING_ROWS,
      modelCallCount: 0 as const,
      reason: "supplemental_evidence_invalid" as const
    });
  }
}
