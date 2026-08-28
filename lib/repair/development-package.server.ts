import "server-only";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import type { SemanticResultsState } from "@/lib/results/semantic-results.server";
import { GATE3_SEMANTIC_CONTRACT } from "@/lib/semantic/checkout-candidate.server";
import { CHECKOUT_REQUEST_METADATA } from "@/lib/webmcp/checkout-request-tool";

export const REPAIR_DEVELOPMENT_PACKAGE_VERSION = "toolproof-repair-development-package@1.1.0";

export interface RepairDevelopmentPackage {
  readonly version: typeof REPAIR_DEVELOPMENT_PACKAGE_VERSION;
  readonly baselineRunId: string;
  readonly baselineEvidenceDigest: string;
  readonly baselineAppCommit: string;
  readonly evidenceLabel: "one-trial demonstration snapshot";
  readonly changedField: "checkout_request.description";
  readonly currentDescription: string;
  readonly taskBoundary: string;
  readonly liveManifest: {
    readonly version: string;
    readonly manifestHash: string;
    readonly projection: "descriptors-plus-schema-hashes";
    readonly toolTupleSchema: readonly [
      "name",
      "title",
      "description",
      "readOnlyHint",
      "untrustedContentHint",
      "inputSchemaHash"
    ];
    readonly tools: readonly (readonly [string, string, string, boolean, boolean, string])[];
  };
  readonly developmentCaseCount: 12;
  readonly developmentAggregate: {
    readonly earned: number;
    readonly possible: 12;
  };
  readonly meaningContractTupleSchema: readonly [
    "meaningId",
    "approvedMeaning",
    "approvalClass",
    "actionClass",
    "tool",
    "arguments",
    "stateChange",
    "allowedEffects",
    "forbiddenEffects"
  ];
  readonly meaningContracts: readonly (readonly [
    string,
    string,
    string,
    string,
    string | null,
    unknown,
    string,
    readonly string[],
    readonly string[]
  ])[];
  readonly rowTupleSchema: readonly [
    "ordinal",
    "request",
    "meaningId",
    "observedActionClass",
    "decisionSummary",
    "score",
    "failureCodes",
    "trace"
  ];
  readonly traceTupleSchema: readonly ["eventId", "toolName", "canonicalArguments", "effect"];
  readonly rows: readonly (readonly [
    number,
    string,
    string,
    string,
    string,
    0 | 1,
    readonly string[],
    (
      | readonly [
          string,
          string,
          unknown,
          readonly [boolean, number, readonly (readonly [string, number])[], boolean, boolean]
        ]
      | null
    )
  ])[];
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
  const meaningContracts = new Map<string, (typeof results.repairRows)[number]["expected"]>();
  for (const row of results.repairRows) {
    const existing = meaningContracts.get(row.meaningId);
    if (existing && canonicalJson(existing) !== canonicalJson(row.expected)) {
      throw new Error("repair_development_contract_drift");
    }
    meaningContracts.set(row.meaningId, row.expected);
  }
  const liveManifest = {
    version: results.liveManifest.version,
    manifestHash: results.liveManifest.manifestHash,
    projection: "descriptors-plus-schema-hashes" as const,
    toolTupleSchema: [
      "name",
      "title",
      "description",
      "readOnlyHint",
      "untrustedContentHint",
      "inputSchemaHash"
    ] as const,
    tools: await Promise.all(
      results.liveManifest.tools.map(async (tool) =>
        Object.freeze([
          tool.name,
          tool.title,
          tool.description,
          tool.annotations.readOnlyHint,
          tool.annotations.untrustedContentHint,
          await canonicalSha256(tool.inputSchema)
        ] as const)
      )
    )
  };
  const payload: Omit<RepairDevelopmentPackage, "packageHash"> = {
    version: REPAIR_DEVELOPMENT_PACKAGE_VERSION,
    baselineRunId: results.baselineRunId,
    baselineEvidenceDigest: results.baselineEvidenceDigest,
    baselineAppCommit: results.baselineAppCommit,
    evidenceLabel: "one-trial demonstration snapshot" as const,
    changedField: "checkout_request.description" as const,
    currentDescription: CHECKOUT_REQUEST_METADATA.description,
    taskBoundary: GATE3_SEMANTIC_CONTRACT.taskBoundary,
    liveManifest,
    developmentCaseCount: 12 as const,
    developmentAggregate: results.development,
    meaningContractTupleSchema: [
      "meaningId",
      "approvedMeaning",
      "approvalClass",
      "actionClass",
      "tool",
      "arguments",
      "stateChange",
      "allowedEffects",
      "forbiddenEffects"
    ] as const,
    meaningContracts: [...meaningContracts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([meaningId, contract]) =>
        Object.freeze([
          meaningId,
          contract.approvedMeaning,
          contract.approvalClass,
          contract.actionClass,
          contract.tool,
          contract.arguments,
          contract.stateChange,
          contract.allowedEffects,
          contract.forbiddenEffects
        ] as const)
      ),
    rowTupleSchema: [
      "ordinal",
      "request",
      "meaningId",
      "observedActionClass",
      "decisionSummary",
      "score",
      "failureCodes",
      "trace"
    ] as const,
    traceTupleSchema: ["eventId", "toolName", "canonicalArguments", "effect"] as const,
    rows: results.repairRows.map(({ ordinal, meaningId, request, observed, trace }) =>
      Object.freeze([
        ordinal,
        request,
        meaningId,
        observed.actionClass,
        observed.decision?.kind === "call"
          ? `call:${observed.decision.tool}`
          : observed.decision?.kind === "clarify"
            ? `clarify:${observed.decision.text}`
            : observed.decision?.kind === "abstain"
              ? `abstain:${observed.decision.reason}`
              : `malformed:${observed.decisionError ?? observed.refusal ?? "no-decision"}`,
        observed.score,
        observed.failureCodes,
        trace
          ? ([
              trace.eventId,
              trace.toolName,
              trace.canonicalArguments,
              [
                trace.effect.stateChanged,
                trace.effect.revisionDelta,
                trace.effect.changedQuantities.map(({ itemId, delta }) => [itemId, delta] as const),
                trace.effect.pendingCheckoutChanged,
                trace.effect.unmodeledStateChanged
              ] as const
            ] as const)
          : null
      ] as const)
    ),
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
