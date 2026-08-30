import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import {
  INVOCATION_INTEGRITY_AMENDMENT_COMMIT,
  INVOCATION_INTEGRITY_AMENDMENT_PATH,
  INVOCATION_INTEGRITY_AMENDMENT_SHA256,
  INVOCATION_INTEGRITY_CASES,
  verifyInvocationIntegrityFailureReceipt,
  verifyInvocationIntegrityReceipt,
  type InvocationIntegrityCaseId,
  type InvocationIntegrityFailureReceipt,
  type InvocationIntegrityReceipt
} from "@/lib/invocation-integrity/contract";
import { PROBE_PRODUCTION_ORIGIN } from "@/lib/probe/policy";

export const INVOCATION_INTEGRITY_EVIDENCE_VERSION =
  "thurstone-invocation-integrity-evidence@1.0.0";
export const INVOCATION_INTEGRITY_FAILURE_EVIDENCE_VERSION =
  "thurstone-invocation-integrity-failure-evidence@1.0.0";
export const INVOCATION_INTEGRITY_RELEASE_BINDING_VERSION =
  "thurstone-invocation-integrity-release-binding@1.0.0";
export const INVOCATION_INTEGRITY_EXPORT_VERSION = "thurstone-invocation-integrity-export@1.0.0";

export const INVOCATION_INTEGRITY_AMENDMENT = Object.freeze({
  path: INVOCATION_INTEGRITY_AMENDMENT_PATH,
  commitSha: INVOCATION_INTEGRITY_AMENDMENT_COMMIT,
  fileSha256: INVOCATION_INTEGRITY_AMENDMENT_SHA256,
  relationship: "supplements-not-replaces-brief-v2" as const
});

export const INVOCATION_INTEGRITY_SEMANTIC_RECORD = Object.freeze({
  sealedEvidenceBuild: "768af2539ca20c29928a897644ad22ba897c580d",
  meaningMatrixCaseCount: 24 as const,
  baselineEarned: 23 as const,
  revisedEarned: 23 as const,
  possible: 24 as const,
  conclusion: "no measured improvement" as const,
  altered: false as const,
  includedInInvocationIntegrityDenominator: false as const
});

export const INVOCATION_INTEGRITY_POSITION =
  "Thurstone tests both sides of a declared WebMCP contract: whether benign requests produce the represented effects, and whether tested hostile invocations preserve site-defined invariants.";

export const INVOCATION_INTEGRITY_LIMITATIONS = Object.freeze([
  "Thurstone is a testing/audit system, not runtime enforcement.",
  "This result is not certification or guaranteed security.",
  "The result is limited to three frozen synthetic cases and the exact tested build; it is not arbitrary-site verification.",
  "Testing does not prove that a malicious website will behave identically after testing.",
  "The three-case score is separate from semantic accuracy and must never be combined with the Meaning Matrix denominator.",
  "Hashes establish internal consistency, not independent attestation."
] as const);

export interface InvocationIntegrityEvidencePackage {
  readonly version: typeof INVOCATION_INTEGRITY_EVIDENCE_VERSION;
  readonly packageDigest: string;
  readonly evidenceClass: "supplemental-invocation-integrity";
  readonly amendment: typeof INVOCATION_INTEGRITY_AMENDMENT;
  readonly summary: {
    readonly earned: 3;
    readonly possible: 3;
    readonly modelCallCount: 0;
    readonly includedInSemanticDenominator: false;
    readonly disclosure: "deterministic direct WebMCP invocations; no LLM prompts";
  };
  readonly execution: {
    readonly buildSha: string;
    readonly origin: typeof PROBE_PRODUCTION_ORIGIN;
    readonly adapter: "real-webmcp-discovery-execution";
    readonly trustedStateSource: "source-fixed-server-replay";
    readonly measuredAt: string;
  };
  readonly verifierReceipt: InvocationIntegrityReceipt;
  readonly semanticRecord: typeof INVOCATION_INTEGRITY_SEMANTIC_RECORD;
  readonly releaseBinding: {
    readonly mode: "external-release-receipt";
    readonly releaseSha: null;
    readonly reason: "git-commit-cannot-self-reference";
  };
  readonly position: typeof INVOCATION_INTEGRITY_POSITION;
  readonly limitations: typeof INVOCATION_INTEGRITY_LIMITATIONS;
}

export interface InvocationIntegrityFailureResultRow {
  readonly caseId: InvocationIntegrityCaseId;
  readonly title: string;
  readonly toolName: "cart_update" | "checkout_request";
  readonly exactInvocations: readonly Readonly<Record<string, unknown>>[];
  readonly expectedOutcome: readonly Readonly<Record<string, unknown>>[];
  readonly actualOutcome: readonly unknown[];
  readonly outcome: "pass" | "fail" | "not-reached";
  readonly observedCalls: InvocationIntegrityFailureReceipt["completedCalls"];
  readonly trustedState: {
    readonly before: unknown | null;
    readonly after: unknown | null;
    readonly terminalInspection: InvocationIntegrityFailureReceipt["terminalInspection"] | null;
  };
  readonly ledgerEvidence: readonly {
    readonly commitDisposition: string;
    readonly effect: unknown;
  }[];
  readonly assertions: readonly {
    readonly assertionId: "terminal_case_outcome";
    readonly status: "passed" | "failed" | "not-evaluated";
  }[];
  readonly error: InvocationIntegrityFailureReceipt["error"] | null;
  readonly buildSha: string;
  readonly timestamp: string;
}

export interface InvocationIntegrityFailureEvidencePackage {
  readonly version: typeof INVOCATION_INTEGRITY_FAILURE_EVIDENCE_VERSION;
  readonly packageDigest: string;
  readonly evidenceClass: "supplemental-invocation-integrity-failure";
  readonly amendment: typeof INVOCATION_INTEGRITY_AMENDMENT;
  readonly summary: {
    readonly earned: 0 | 1 | 2;
    readonly possible: 3;
    readonly modelCallCount: 0;
    readonly includedInSemanticDenominator: false;
    readonly disclosure: "terminal failure preserved; deterministic direct WebMCP invocations; no LLM prompts";
  };
  readonly execution: {
    readonly buildSha: string;
    readonly origin: typeof PROBE_PRODUCTION_ORIGIN;
    readonly adapter: "real-webmcp-discovery-execution";
    readonly trustedStateSource: "strict-terminal-failure-receipt";
    readonly measuredAt: string;
  };
  readonly verifierFailureReceipt: InvocationIntegrityFailureReceipt;
  readonly rows: readonly InvocationIntegrityFailureResultRow[];
  readonly semanticRecord: typeof INVOCATION_INTEGRITY_SEMANTIC_RECORD;
  readonly releaseBinding: {
    readonly mode: "external-release-receipt";
    readonly releaseSha: null;
    readonly reason: "git-commit-cannot-self-reference";
  };
  readonly position: null;
  readonly limitations: typeof INVOCATION_INTEGRITY_LIMITATIONS;
}

export type InvocationIntegritySupplementalEvidencePackage =
  InvocationIntegrityEvidencePackage | InvocationIntegrityFailureEvidencePackage;

export interface InvocationIntegrityReleaseBindingReceipt {
  readonly version: typeof INVOCATION_INTEGRITY_RELEASE_BINDING_VERSION;
  readonly bindingDigest: string;
  readonly evidencePackageDigest: string;
  readonly executionBuildSha: string;
  readonly releaseSha: string;
  readonly mode: "external-release-receipt";
}

export interface InvocationIntegrityEvidenceExports {
  readonly json: string;
  readonly markdown: string;
  readonly jsonSha256: string;
  readonly markdownSha256: string;
}

export interface InvocationIntegrityPendingRow {
  readonly caseId: InvocationIntegrityCaseId;
  readonly title: string;
  readonly toolName: "cart_update" | "checkout_request";
  readonly exactArguments: readonly Readonly<Record<string, unknown>>[];
  readonly expectedOutcome: readonly Readonly<Record<string, unknown>>[];
  readonly replayPolicy: string;
}

export type InvocationIntegrityResultsState =
  | {
      readonly status: "pending";
      readonly rows: readonly InvocationIntegrityPendingRow[];
      readonly modelCallCount: 0;
    }
  | {
      readonly status: "invalid";
      readonly rows: readonly InvocationIntegrityPendingRow[];
      readonly modelCallCount: 0;
      readonly reason: "supplemental_evidence_invalid";
    }
  | {
      readonly status: "complete";
      readonly evidencePackage: InvocationIntegrityEvidencePackage;
      readonly releaseBinding: InvocationIntegrityReleaseBindingReceipt;
      readonly evidenceExports: InvocationIntegrityEvidenceExports;
    }
  | {
      readonly status: "failed";
      readonly evidencePackage: InvocationIntegrityFailureEvidencePackage;
      readonly releaseBinding: InvocationIntegrityReleaseBindingReceipt;
      readonly evidenceExports: InvocationIntegrityEvidenceExports;
    };

export const INVOCATION_INTEGRITY_PENDING_ROWS: readonly InvocationIntegrityPendingRow[] =
  Object.freeze(
    INVOCATION_INTEGRITY_CASES.map((item) =>
      Object.freeze({
        caseId: item.caseId,
        title: item.title,
        toolName: item.toolName,
        exactArguments: item.invocations,
        expectedOutcome: item.expectedResults,
        replayPolicy: item.replayPolicy
      })
    )
  );

const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;

function assertGitSha(value: unknown, code: string): asserts value is string {
  if (typeof value !== "string" || !GIT_SHA_PATTERN.test(value)) throw new Error(code);
}

function failureResultRows(
  receipt: InvocationIntegrityFailureReceipt
): readonly InvocationIntegrityFailureResultRow[] {
  return Object.freeze(
    INVOCATION_INTEGRITY_CASES.map((contract, index) => {
      const observedCalls = Object.freeze(
        receipt.completedCalls.filter(({ caseId }) => caseId === contract.caseId)
      );
      const outcome =
        index < receipt.score.earned
          ? "pass"
          : index === receipt.score.earned
            ? "fail"
            : "not-reached";
      return Object.freeze({
        caseId: contract.caseId,
        title: contract.title,
        toolName: contract.toolName,
        exactInvocations: contract.invocations,
        expectedOutcome: contract.expectedResults,
        actualOutcome: Object.freeze(
          observedCalls.map(({ receipt: nativeReceipt }) => nativeReceipt.canonicalResult)
        ),
        outcome,
        observedCalls,
        trustedState: Object.freeze({
          before: observedCalls[0]?.trace.stateBefore ?? null,
          after: observedCalls.at(-1)?.trace.stateAfter ?? null,
          terminalInspection: outcome === "fail" ? receipt.terminalInspection : null
        }),
        ledgerEvidence: Object.freeze(
          observedCalls.map(({ trace }) =>
            Object.freeze({
              commitDisposition: trace.commitDisposition,
              effect: trace.effect
            })
          )
        ),
        assertions: Object.freeze([
          Object.freeze({
            assertionId: "terminal_case_outcome" as const,
            status:
              outcome === "pass"
                ? ("passed" as const)
                : outcome === "fail"
                  ? ("failed" as const)
                  : ("not-evaluated" as const)
          })
        ]),
        error: outcome === "fail" ? receipt.error : null,
        buildSha: receipt.buildSha,
        timestamp: observedCalls.at(-1)?.trace.observedAt ?? receipt.failedAt
      });
    })
  );
}

export async function buildInvocationIntegrityEvidencePackage(input: {
  readonly receipt: InvocationIntegrityReceipt;
}): Promise<InvocationIntegrityEvidencePackage> {
  const receipt = await verifyInvocationIntegrityReceipt(input.receipt);
  if (receipt.measuredTranscript.runtime.origin !== PROBE_PRODUCTION_ORIGIN) {
    throw new Error("invocation_integrity_evidence_origin_invalid");
  }
  const earned = receipt.score.earned;
  const payload = {
    version: INVOCATION_INTEGRITY_EVIDENCE_VERSION,
    evidenceClass: "supplemental-invocation-integrity" as const,
    amendment: INVOCATION_INTEGRITY_AMENDMENT,
    summary: Object.freeze({
      earned,
      possible: 3 as const,
      modelCallCount: 0 as const,
      includedInSemanticDenominator: false as const,
      disclosure: "deterministic direct WebMCP invocations; no LLM prompts" as const
    }),
    execution: Object.freeze({
      buildSha: receipt.buildSha,
      origin: PROBE_PRODUCTION_ORIGIN,
      adapter: "real-webmcp-discovery-execution" as const,
      trustedStateSource: "source-fixed-server-replay" as const,
      measuredAt: receipt.completedAt
    }),
    verifierReceipt: receipt,
    semanticRecord: INVOCATION_INTEGRITY_SEMANTIC_RECORD,
    releaseBinding: Object.freeze({
      mode: "external-release-receipt" as const,
      releaseSha: null,
      reason: "git-commit-cannot-self-reference" as const
    }),
    position: INVOCATION_INTEGRITY_POSITION,
    limitations: INVOCATION_INTEGRITY_LIMITATIONS
  } satisfies Omit<InvocationIntegrityEvidencePackage, "packageDigest">;
  return Object.freeze({ ...payload, packageDigest: await canonicalSha256(payload) });
}

export async function buildInvocationIntegrityFailureEvidencePackage(input: {
  readonly receipt: InvocationIntegrityFailureReceipt;
}): Promise<InvocationIntegrityFailureEvidencePackage> {
  const receipt = await verifyInvocationIntegrityFailureReceipt(input.receipt);
  if (
    receipt.origin !== PROBE_PRODUCTION_ORIGIN ||
    receipt.runtime.origin !== PROBE_PRODUCTION_ORIGIN
  ) {
    throw new Error("invocation_integrity_failure_evidence_origin_invalid");
  }
  const payload = {
    version: INVOCATION_INTEGRITY_FAILURE_EVIDENCE_VERSION,
    evidenceClass: "supplemental-invocation-integrity-failure" as const,
    amendment: INVOCATION_INTEGRITY_AMENDMENT,
    summary: Object.freeze({
      earned: receipt.score.earned,
      possible: 3 as const,
      modelCallCount: 0 as const,
      includedInSemanticDenominator: false as const,
      disclosure:
        "terminal failure preserved; deterministic direct WebMCP invocations; no LLM prompts" as const
    }),
    execution: Object.freeze({
      buildSha: receipt.buildSha,
      origin: PROBE_PRODUCTION_ORIGIN,
      adapter: "real-webmcp-discovery-execution" as const,
      trustedStateSource: "strict-terminal-failure-receipt" as const,
      measuredAt: receipt.failedAt
    }),
    verifierFailureReceipt: receipt,
    rows: failureResultRows(receipt),
    semanticRecord: INVOCATION_INTEGRITY_SEMANTIC_RECORD,
    releaseBinding: Object.freeze({
      mode: "external-release-receipt" as const,
      releaseSha: null,
      reason: "git-commit-cannot-self-reference" as const
    }),
    position: null,
    limitations: INVOCATION_INTEGRITY_LIMITATIONS
  } satisfies Omit<InvocationIntegrityFailureEvidencePackage, "packageDigest">;
  return Object.freeze({ ...payload, packageDigest: await canonicalSha256(payload) });
}

export async function validateInvocationIntegrityEvidencePackage(
  value: unknown
): Promise<InvocationIntegrityEvidencePackage> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invocation_integrity_package_invalid");
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== INVOCATION_INTEGRITY_EVIDENCE_VERSION ||
    candidate.evidenceClass !== "supplemental-invocation-integrity" ||
    canonicalJson(candidate.amendment) !== canonicalJson(INVOCATION_INTEGRITY_AMENDMENT) ||
    canonicalJson(candidate.semanticRecord) !==
      canonicalJson(INVOCATION_INTEGRITY_SEMANTIC_RECORD) ||
    canonicalJson(candidate.limitations) !== canonicalJson(INVOCATION_INTEGRITY_LIMITATIONS)
  ) {
    throw new Error("invocation_integrity_frozen_binding_invalid");
  }
  const receipt = await verifyInvocationIntegrityReceipt(candidate.verifierReceipt);
  const execution = candidate.execution as Record<string, unknown> | undefined;
  if (!execution || typeof execution.origin !== "string") {
    throw new Error("invocation_integrity_execution_invalid");
  }
  const rebuilt = await buildInvocationIntegrityEvidencePackage({ receipt });
  if (canonicalJson(rebuilt) !== canonicalJson(value)) {
    throw new Error("invocation_integrity_package_mismatch");
  }
  return rebuilt;
}

export async function validateInvocationIntegrityFailureEvidencePackage(
  value: unknown
): Promise<InvocationIntegrityFailureEvidencePackage> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invocation_integrity_failure_package_invalid");
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== INVOCATION_INTEGRITY_FAILURE_EVIDENCE_VERSION ||
    candidate.evidenceClass !== "supplemental-invocation-integrity-failure" ||
    candidate.position !== null ||
    canonicalJson(candidate.amendment) !== canonicalJson(INVOCATION_INTEGRITY_AMENDMENT) ||
    canonicalJson(candidate.semanticRecord) !==
      canonicalJson(INVOCATION_INTEGRITY_SEMANTIC_RECORD) ||
    canonicalJson(candidate.limitations) !== canonicalJson(INVOCATION_INTEGRITY_LIMITATIONS)
  ) {
    throw new Error("invocation_integrity_failure_frozen_binding_invalid");
  }
  const receipt = await verifyInvocationIntegrityFailureReceipt(candidate.verifierFailureReceipt);
  const rebuilt = await buildInvocationIntegrityFailureEvidencePackage({ receipt });
  if (canonicalJson(rebuilt) !== canonicalJson(value)) {
    throw new Error("invocation_integrity_failure_package_mismatch");
  }
  return rebuilt;
}

export async function validateInvocationIntegritySupplementalEvidencePackage(
  value: unknown
): Promise<InvocationIntegritySupplementalEvidencePackage> {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { readonly evidenceClass?: unknown }).evidenceClass ===
      "supplemental-invocation-integrity-failure"
  ) {
    return validateInvocationIntegrityFailureEvidencePackage(value);
  }
  return validateInvocationIntegrityEvidencePackage(value);
}

export async function createInvocationIntegrityReleaseBinding(
  evidence: InvocationIntegritySupplementalEvidencePackage,
  releaseSha: string
): Promise<InvocationIntegrityReleaseBindingReceipt> {
  assertGitSha(releaseSha, "invocation_integrity_release_sha_invalid");
  const payload = {
    version: INVOCATION_INTEGRITY_RELEASE_BINDING_VERSION,
    evidencePackageDigest: evidence.packageDigest,
    executionBuildSha: evidence.execution.buildSha,
    releaseSha,
    mode: "external-release-receipt" as const
  } satisfies Omit<InvocationIntegrityReleaseBindingReceipt, "bindingDigest">;
  return Object.freeze({ ...payload, bindingDigest: await canonicalSha256(payload) });
}

function jsonBlock(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

export async function createInvocationIntegrityEvidenceExports(
  evidence: InvocationIntegritySupplementalEvidencePackage,
  releaseBinding: InvocationIntegrityReleaseBindingReceipt
): Promise<InvocationIntegrityEvidenceExports> {
  if (
    releaseBinding.evidencePackageDigest !== evidence.packageDigest ||
    releaseBinding.executionBuildSha !== evidence.execution.buildSha
  ) {
    throw new Error("invocation_integrity_release_binding_mismatch");
  }
  const exportPayload = Object.freeze({
    version: INVOCATION_INTEGRITY_EXPORT_VERSION,
    evidencePackage: evidence,
    releaseBinding
  });
  const json = `${canonicalJson(exportPayload)}\n`;
  const success = evidence.evidenceClass === "supplemental-invocation-integrity" ? evidence : null;
  const failure =
    evidence.evidenceClass === "supplemental-invocation-integrity-failure" ? evidence : null;
  const matrixRows = success
    ? success.verifierReceipt.rows.map((row) => ({
        caseId: row.caseId,
        title: row.title,
        toolName: row.toolName,
        callCount: row.exactInvocations.length,
        outcome: "Pass",
        buildSha: row.buildSha,
        timestamp: row.timestamp
      }))
    : failure!.rows.map((row) => ({
        caseId: row.caseId,
        title: row.title,
        toolName: row.toolName,
        callCount: row.observedCalls.length,
        outcome: row.outcome === "pass" ? "Pass" : row.outcome === "fail" ? "Fail" : "Not reached",
        buildSha: row.buildSha,
        timestamp: row.timestamp
      }));
  const lines = [
    "# Thurstone supplemental Invocation Integrity evidence",
    "",
    `- Evidence package: \`${evidence.packageDigest}\``,
    `- Execution build: \`${evidence.execution.buildSha}\``,
    `- External release binding: \`${releaseBinding.releaseSha}\` / \`${releaseBinding.bindingDigest}\``,
    `- Amendment: \`${evidence.amendment.commitSha}\` / \`${evidence.amendment.fileSha256}\``,
    `- Score: **${evidence.summary.earned}/${evidence.summary.possible}**`,
    "- Model calls: **0**",
    "- Semantic denominator: **separate; not included**",
    `- Preserved semantic result: **${evidence.semanticRecord.baselineEarned}/24 → ${evidence.semanticRecord.revisedEarned}/24; ${evidence.semanticRecord.conclusion}.**`,
    "",
    "## Invocation Integrity Matrix",
    "",
    "| Case | Tool | Exact calls | Outcome | Build | Timestamp |",
    "| --- | --- | ---: | --- | --- | --- |",
    ...matrixRows.map(
      (row) =>
        `| ${row.caseId} — ${row.title} | ${row.toolName} | ${row.callCount} | ${row.outcome} | ${row.buildSha} | ${row.timestamp} |`
    ),
    "",
    ...(success
      ? success.verifierReceipt.rows.flatMap((row) => [
          `## ${row.caseId} — ${row.title}`,
          "",
          "### Exact invocation",
          "",
          jsonBlock(row.exactInvocations),
          "",
          "### Expected outcome",
          "",
          jsonBlock(row.expectedOutcome),
          "",
          "### Actual outcome",
          "",
          jsonBlock(row.actualOutcome),
          "",
          "### Trusted before/after state",
          "",
          jsonBlock({ before: row.trustedStateBefore, after: row.trustedStateAfter }),
          "",
          "### Ledger diff",
          "",
          jsonBlock({
            domainOperationLedger: row.domainOperationLedgerDiff,
            tombstones: row.tombstoneDiff,
            auditTrace: row.auditTraceDiff,
            subscriberCommitCount: row.subscriberCommitCount
          }),
          "",
          "### Assertions",
          "",
          jsonBlock(row.assertions),
          ""
        ])
      : [
          ...failure!.rows.flatMap((row) => [
            `## ${row.caseId} — ${row.title}`,
            "",
            "### Exact invocation",
            "",
            jsonBlock(row.exactInvocations),
            "",
            "### Expected outcome",
            "",
            jsonBlock(row.expectedOutcome),
            "",
            "### Actual outcome",
            "",
            jsonBlock(row.actualOutcome),
            "",
            "### Trusted state and terminal boundary",
            "",
            jsonBlock(row.trustedState),
            "",
            "### Ledger evidence",
            "",
            jsonBlock(row.ledgerEvidence),
            "",
            "### Assertions",
            "",
            jsonBlock(row.assertions),
            ""
          ]),
          "## Terminal failure evidence",
          "",
          "The measured sequence terminated and is preserved as a failure; it is not pending and cannot validate as 3/3.",
          "",
          jsonBlock(failure!.verifierFailureReceipt),
          ""
        ]),
    ...(success
      ? [
          "## Full measured browser transcript",
          "",
          "Descriptors, preflight, compatibility/reset evidence, and all four native receipts and traces are retained below.",
          "",
          jsonBlock(success.verifierReceipt.measuredTranscript),
          ""
        ]
      : []),
    "## Limitations",
    "",
    ...evidence.limitations.map((limitation) => `- ${limitation}`),
    "",
    ...(evidence.position ? ["## Position", "", `**${evidence.position}**`, ""] : []),
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
