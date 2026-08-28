import "server-only";

import { canonicalSha256 } from "@/lib/evidence/digest";
import type { SemanticResultsState } from "@/lib/results/semantic-results.server";
import { GATE3_SEMANTIC_CONTRACT } from "@/lib/semantic/checkout-candidate.server";
import { CHECKOUT_REQUEST_METADATA } from "@/lib/webmcp/checkout-request-tool";

export const REPAIR_DEVELOPMENT_PACKAGE_VERSION = "toolproof-repair-development-package@1.0.0";

export interface RepairDevelopmentPackage {
  readonly version: typeof REPAIR_DEVELOPMENT_PACKAGE_VERSION;
  readonly baselineRunId: string;
  readonly baselineEvidenceDigest: string;
  readonly evidenceLabel: "one-trial demonstration snapshot";
  readonly changedField: "checkout_request.description";
  readonly currentDescription: string;
  readonly taskBoundary: string;
  readonly developmentCaseCount: 12;
  readonly rows: Extract<
    SemanticResultsState,
    { status: "baseline-development-only" }
  >["repairRows"];
  readonly holdout: {
    readonly promptsIncluded: 0;
    readonly labelsIncluded: 0;
    readonly rowsIncluded: 0;
    readonly aggregatesIncluded: 0;
    readonly hintsIncluded: 0;
  };
  readonly packageHash: string;
}

export async function buildRepairDevelopmentPackage(
  results: SemanticResultsState
): Promise<RepairDevelopmentPackage> {
  if (
    results.status !== "baseline-development-only" ||
    results.rows.length !== 12 ||
    results.repairRows.length !== 12
  ) {
    throw new Error("repair_development_results_unavailable");
  }
  const payload: Omit<RepairDevelopmentPackage, "packageHash"> = {
    version: REPAIR_DEVELOPMENT_PACKAGE_VERSION,
    baselineRunId: results.baselineRunId,
    baselineEvidenceDigest: results.baselineEvidenceDigest,
    evidenceLabel: "one-trial demonstration snapshot" as const,
    changedField: "checkout_request.description" as const,
    currentDescription: CHECKOUT_REQUEST_METADATA.description,
    taskBoundary: GATE3_SEMANTIC_CONTRACT.taskBoundary,
    developmentCaseCount: 12 as const,
    rows: results.repairRows,
    holdout: {
      promptsIncluded: 0 as const,
      labelsIncluded: 0 as const,
      rowsIncluded: 0 as const,
      aggregatesIncluded: 0 as const,
      hintsIncluded: 0 as const
    }
  };
  return Object.freeze({ ...payload, packageHash: await canonicalSha256(payload) });
}
