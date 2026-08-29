import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";

export const GATE6_EVIDENCE_PACKAGE_VERSION = "toolproof-gate6-evidence-package@1.0.0";

export type EvidenceVersion = "baseline" | "revised";
export type EvidenceSubset = "development" | "builder-blinded-holdout";

export interface Gate6TraceRecord {
  readonly version: EvidenceVersion;
  readonly ordinal: number;
  readonly caseId: string;
  readonly runnerCaseId: string;
  readonly subset: EvidenceSubset;
  readonly family: string;
  readonly relationship: {
    readonly kind: "equivalent_realization" | "matched_boundary";
    readonly id: string;
    readonly side: string | null;
  };
  readonly request: string;
  readonly expectedAction: string;
  readonly observedAction: string;
  readonly observedSignature: string;
  readonly expectedKind: "call" | "clarify" | "no_action";
  readonly expectedTool: string | null;
  readonly passed: boolean;
  readonly score: 0 | 1;
  readonly failureCodes: readonly string[];
  readonly errorClass:
    "none" | "semantic-action" | "semantic-argument" | "semantic-effect" | "infrastructure";
  readonly argumentPassed: boolean;
  readonly effectPassed: boolean;
  readonly consequentialOverAction: boolean;
  readonly clarification: {
    readonly expected: boolean;
    readonly observed: boolean;
    readonly text: string | null;
  };
  readonly liveCatalog: {
    readonly manifestHash: string;
    readonly toolNames: readonly string[];
    readonly registrationGeneration: number;
  };
  readonly model: {
    readonly provider: string;
    readonly model: string;
    readonly decision: unknown;
    readonly refusal: string | null;
    readonly decisionError: string | null;
    readonly promptHash: string;
    readonly settingsHash: string;
    readonly rawResponseHash: string;
    readonly dispatchedAt: string;
    readonly completedAt: string;
    readonly durationMs: number;
  };
  readonly execution: {
    readonly canonicalArguments: unknown;
    readonly nativeResult: unknown;
    readonly stateBefore: unknown;
    readonly stateAfter: unknown;
    readonly effect: unknown;
    readonly traceEventId: string | null;
    readonly traceStatus: string | null;
  };
  readonly runtime: {
    readonly browserVersion: string;
    readonly chromeForTesting: string;
    readonly runtimeContractHash: string;
    readonly adapterVersion: string;
    readonly origin: string;
    readonly argumentMode: string | null;
  };
  readonly hashes: {
    readonly rowDigest: string;
    readonly envelopeHash: string;
    readonly captureDigest: string;
    readonly providerReceiptHash: string;
    readonly traceArgumentsHash: string | null;
    readonly traceResultHash: string | null;
    readonly stateBeforeHash: string | null;
    readonly stateAfterHash: string | null;
  };
}

export interface MetricFraction {
  readonly numerator: number;
  readonly denominator: number;
}

export interface Gate6Metric {
  readonly id:
    | "equivalence-consistency"
    | "boundary-sensitivity"
    | "tool-action-accuracy"
    | "argument-fidelity"
    | "effect-fidelity"
    | "over-action-rate"
    | "clarification-quality";
  readonly label: string;
  readonly definition: string;
  readonly direction: "higher-is-better" | "lower-is-better" | "human-review-required";
  readonly overall: MetricFraction;
  readonly development: MetricFraction;
  readonly holdout: MetricFraction;
  readonly humanReviewStatus: "not-applicable" | "pending-final-claims-review";
}

export interface Gate6EvidencePackage {
  readonly version: typeof GATE6_EVIDENCE_PACKAGE_VERSION;
  readonly packageDigest: string;
  readonly evidenceLabel: "authentic Custom Probe reference · one-trial demonstration snapshot";
  readonly repetitionCount: 1;
  readonly summary: {
    readonly pairedCases: 24;
    readonly baselinePassed: number;
    readonly revisedPassed: number;
    readonly possible: 24;
    readonly noMeasuredImprovement: boolean;
    readonly disclosure: string;
  };
  readonly metrics: Readonly<Record<EvidenceVersion, readonly Gate6Metric[]>>;
  readonly infrastructure: Readonly<
    Record<
      EvidenceVersion,
      {
        readonly logicalCases: 24;
        readonly attempts: number;
        readonly scoredOutcomes: number;
        readonly transportFailures: number;
        readonly retries: number;
        readonly incomplete: number;
        readonly indeterminate: number;
      }
    >
  >;
  readonly contractDiff: {
    readonly changedField: "checkout_request.description";
    readonly path: "lib/webmcp/checkout-request-tool.ts";
    readonly oldDescription: string;
    readonly newDescription: string;
    readonly sourceDiffProofHash: string;
    readonly revisionFreezeHash: string;
    readonly hunkCount: 1;
    readonly removedLineCount: 1;
    readonly addedLineCount: 1;
  };
  readonly provenance: {
    readonly baselineRunId: string;
    readonly baselineEvidenceDigest: string;
    readonly baselineAppCommit: string;
    readonly revisedRunId: string;
    readonly revisedEvidenceDigest: string;
    readonly revisedAppCommit: string;
    readonly reviewPackageHash: string;
    readonly gate3FrozenProtocolHash: string;
    readonly revisionFreezeHash: string;
    readonly provider: string;
    readonly model: string;
    readonly baselineManifestHash: string;
    readonly revisedManifestHash: string;
    readonly fixtureId: string;
    readonly fixtureVersion: string;
    readonly evaluatorVersion: string;
    readonly runnerHash: string;
    readonly promptHash: string;
    readonly settingsHash: string;
    readonly retryPolicyHash: string;
    readonly baselineStartedAt: string;
    readonly baselineCompletedAt: string;
    readonly revisedStartedAt: string;
    readonly revisedCompletedAt: string;
    readonly measuredV2Commit: string;
    readonly postEvidenceTestCommit: string;
    readonly testOnlyProjectionHash: string;
    readonly targetOrigin: string;
  };
  readonly namespaces: readonly {
    readonly id:
      "custom-probe" | "direct-chatgpt" | "calibration" | "native-plumbing" | "exploratory";
    readonly status: string;
    readonly includedInPrimaryDenominator: boolean;
  }[];
  readonly limitations: readonly string[];
  readonly records: readonly Gate6TraceRecord[];
}

export interface Gate6EvidenceExports {
  readonly json: string;
  readonly markdown: string;
  readonly jsonSha256: string;
  readonly markdownSha256: string;
}

function fraction(
  records: readonly Gate6TraceRecord[],
  predicate: (record: Gate6TraceRecord) => boolean
): MetricFraction {
  return Object.freeze({
    numerator: records.filter(predicate).length,
    denominator: records.length
  });
}

function splitMetric(
  records: readonly Gate6TraceRecord[],
  predicate: (record: Gate6TraceRecord) => boolean
): Pick<Gate6Metric, "overall" | "development" | "holdout"> {
  const development = records.filter(({ subset }) => subset === "development");
  const holdout = records.filter(({ subset }) => subset === "builder-blinded-holdout");
  return Object.freeze({
    overall: fraction(records, predicate),
    development: fraction(development, predicate),
    holdout: fraction(holdout, predicate)
  });
}

function boundaryMetric(
  records: readonly Gate6TraceRecord[]
): Pick<Gate6Metric, "overall" | "development" | "holdout"> {
  const pairs = new Map<string, Gate6TraceRecord[]>();
  for (const record of records.filter(
    ({ relationship }) => relationship.kind === "matched_boundary"
  )) {
    const current = pairs.get(record.relationship.id) ?? [];
    current.push(record);
    pairs.set(record.relationship.id, current);
  }
  const evaluate = (selected: readonly Gate6TraceRecord[]) => {
    const ids = new Set(
      selected
        .filter(({ relationship }) => relationship.kind === "matched_boundary")
        .map(({ relationship }) => relationship.id)
    );
    let numerator = 0;
    for (const id of ids) {
      const pair = pairs.get(id) ?? [];
      if (
        pair.length === 2 &&
        pair.every(({ passed }) => passed) &&
        pair[0]!.observedSignature !== pair[1]!.observedSignature
      ) {
        numerator += 1;
      }
    }
    return Object.freeze({ numerator, denominator: ids.size });
  };
  return Object.freeze({
    overall: evaluate(records),
    development: evaluate(records.filter(({ subset }) => subset === "development")),
    holdout: evaluate(records.filter(({ subset }) => subset === "builder-blinded-holdout"))
  });
}

export function computeGate6Metrics(records: readonly Gate6TraceRecord[]): readonly Gate6Metric[] {
  if (records.length !== 24) throw new Error("gate6_metric_case_denominator_invalid");
  const equivalence = records.filter(
    ({ relationship }) => relationship.kind === "equivalent_realization"
  );
  const calls = records.filter(({ expectedKind }) => expectedKind === "call");
  const nonConsequential = records.filter(
    ({ expectedKind, expectedTool }) => expectedKind !== "call" || expectedTool === "order_review"
  );
  const clarifications = records.filter(({ expectedKind }) => expectedKind === "clarify");
  const metrics: readonly Gate6Metric[] = [
    {
      id: "equivalence-consistency",
      label: "Equivalence consistency",
      definition:
        "Equivalent cases that individually match the approved action signature / all equivalent cases.",
      direction: "higher-is-better",
      ...splitMetric(equivalence, ({ passed }) => passed),
      humanReviewStatus: "not-applicable"
    },
    {
      id: "boundary-sensitivity",
      label: "Boundary sensitivity",
      definition:
        "Matched pairs where both sides pass and the required normalized action difference occurs / all matched pairs.",
      direction: "higher-is-better",
      ...boundaryMetric(records),
      humanReviewStatus: "not-applicable"
    },
    {
      id: "tool-action-accuracy",
      label: "Tool/action accuracy",
      definition: "Cases selecting the approved action class and tool / all scored cases.",
      direction: "higher-is-better",
      ...splitMetric(
        records,
        ({ failureCodes }) =>
          !failureCodes.includes("decision_action_class") && !failureCodes.includes("decision_tool")
      ),
      humanReviewStatus: "not-applicable"
    },
    {
      id: "argument-fidelity",
      label: "Argument fidelity",
      definition:
        "Call-required cases with canonical arguments satisfying the approved contract / all call-required cases.",
      direction: "higher-is-better",
      ...splitMetric(calls, ({ argumentPassed }) => argumentPassed),
      humanReviewStatus: "not-applicable"
    },
    {
      id: "effect-fidelity",
      label: "Effect fidelity",
      definition:
        "Cases whose before/after state and effect satisfy the approved predicate / all scored cases.",
      direction: "higher-is-better",
      ...splitMetric(records, ({ effectPassed }) => effectPassed),
      humanReviewStatus: "not-applicable"
    },
    {
      id: "over-action-rate",
      label: "Over-action rate",
      definition:
        "Consequential calls made where clarification or a read-only action was required / all such cases.",
      direction: "lower-is-better",
      ...splitMetric(nonConsequential, ({ consequentialOverAction }) => consequentialOverAction),
      humanReviewStatus: "not-applicable"
    },
    {
      id: "clarification-quality",
      label: "Clarification quality",
      definition:
        "Structured non-empty clarifications satisfying the frozen contract / all clarification-required cases; usefulness awaits human review.",
      direction: "human-review-required",
      ...splitMetric(
        clarifications,
        ({ clarification }) => clarification.observed && Boolean(clarification.text?.trim())
      ),
      humanReviewStatus: "pending-final-claims-review"
    }
  ];
  const expected = new Map([
    ["equivalence-consistency", 8],
    ["boundary-sensitivity", 8],
    ["tool-action-accuracy", 24],
    ["argument-fidelity", 20],
    ["effect-fidelity", 24],
    ["over-action-rate", 10],
    ["clarification-quality", 4]
  ]);
  for (const metric of metrics) {
    if (metric.overall.denominator !== expected.get(metric.id)) {
      throw new Error(`gate6_metric_denominator_invalid:${metric.id}`);
    }
  }
  return Object.freeze(metrics.map((metric) => Object.freeze(metric)));
}

export async function buildGate6EvidencePackage(
  input: Omit<Gate6EvidencePackage, "version" | "packageDigest" | "metrics" | "summary">
): Promise<Gate6EvidencePackage> {
  const baseline = input.records.filter(({ version }) => version === "baseline");
  const revised = input.records.filter(({ version }) => version === "revised");
  if (baseline.length !== 24 || revised.length !== 24)
    throw new Error("gate6_record_denominator_invalid");
  const baselinePassed = baseline.filter(({ passed }) => passed).length;
  const revisedPassed = revised.filter(({ passed }) => passed).length;
  const payload = {
    version: GATE6_EVIDENCE_PACKAGE_VERSION,
    evidenceLabel: input.evidenceLabel,
    repetitionCount: input.repetitionCount,
    summary: Object.freeze({
      pairedCases: 24 as const,
      baselinePassed,
      revisedPassed,
      possible: 24 as const,
      noMeasuredImprovement: revisedPassed <= baselinePassed,
      disclosure: `${baselinePassed}/24 baseline → ${revisedPassed}/24 revised; no measured improvement in this one-trial snapshot.`
    }),
    metrics: Object.freeze({
      baseline: computeGate6Metrics(baseline),
      revised: computeGate6Metrics(revised)
    }),
    infrastructure: input.infrastructure,
    contractDiff: input.contractDiff,
    provenance: input.provenance,
    namespaces: input.namespaces,
    limitations: input.limitations,
    records: input.records
  } satisfies Omit<Gate6EvidencePackage, "packageDigest">;
  return Object.freeze({ ...payload, packageDigest: await canonicalSha256(payload) });
}

function metricLine(metric: Gate6Metric): string {
  return `| ${metric.label} | ${metric.overall.numerator}/${metric.overall.denominator} | ${metric.development.numerator}/${metric.development.denominator} | ${metric.holdout.numerator}/${metric.holdout.denominator} |`;
}

export async function createGate6EvidenceExports(
  evidence: Gate6EvidencePackage
): Promise<Gate6EvidenceExports> {
  const json = `${canonicalJson(evidence)}\n`;
  const lines = [
    "# ToolProof authentic Custom Probe reference evidence",
    "",
    `- Evidence package: \`${evidence.packageDigest}\``,
    `- Baseline: \`${evidence.provenance.baselineRunId}\` / \`${evidence.provenance.baselineEvidenceDigest}\``,
    `- Revised: \`${evidence.provenance.revisedRunId}\` / \`${evidence.provenance.revisedEvidenceDigest}\``,
    `- Outcome: **${evidence.summary.baselinePassed}/24 → ${evidence.summary.revisedPassed}/24; no measured improvement.**`,
    `- Repetition: ${evidence.repetitionCount} trial per case and version (demonstration snapshot, not stability evidence).`,
    "",
    "## Metrics",
    "",
    "| Metric | Overall | Development | Builder-blinded holdout |",
    "| --- | ---: | ---: | ---: |",
    ...evidence.metrics.baseline.map(metricLine),
    "",
    "The revised metrics have the same denominators and values in this snapshot.",
    "",
    "## One-description contract diff",
    "",
    `- Field: \`${evidence.contractDiff.changedField}\``,
    `- Old: ${evidence.contractDiff.oldDescription}`,
    `- New: ${evidence.contractDiff.newDescription}`,
    `- Source proof: \`${evidence.contractDiff.sourceDiffProofHash}\``,
    "",
    "## Case outcomes",
    "",
    "| Version | Subset | Case | Family | Expected | Observed | Outcome | Error |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...evidence.records.map(
      (record) =>
        `| ${record.version} | ${record.subset} | ${record.caseId} | ${record.family} | ${record.expectedAction} | ${record.observedAction} | ${record.passed ? "Pass" : "Fail"} | ${record.failureCodes.join(", ") || "none"} |`
    ),
    "",
    "## Limitations",
    "",
    ...evidence.limitations.map((limitation) => `- ${limitation}`),
    "",
    "Hashes establish internal consistency, not independent attestation."
  ];
  const markdown = `${lines.join("\n")}\n`;
  return Object.freeze({
    json,
    markdown,
    jsonSha256: await sha256Hex(json),
    markdownSha256: await sha256Hex(markdown)
  });
}
