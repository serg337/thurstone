import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { canonicalSha256 } from "../lib/evidence/digest";
import type { ByoaDemoResultV2 } from "../lib/demo/result-v2";
import { verifyOwnerJourneyReport } from "../lib/demo/owner-journey-report";

const CURRENT_RESULT_PATH = "evidence/thurstone-current-result.json";
const INVOCATION_INTEGRITY_JSON_PATH = "evidence/thurstone-invocation-integrity.json";
const INVOCATION_INTEGRITY_MARKDOWN_PATH = "evidence/thurstone-invocation-integrity.md";
const SAMPLE_RUN_PATH = "evidence/sample-run.json";
const SAMPLE_REPORT_PATH = "evidence/sample-report.md";
const SEVEN_REQUEST_JOURNEY_PATH = "evidence/seven-request-journey.json";
const SEVEN_REQUEST_REPORT_PATH = "evidence/seven-request-journey.md";

const EXPECTED = Object.freeze({
  currentResultSha256: "63151d60484b3cb12cc20c8640d66430cd938437ef86f115f622753f7760e26c",
  currentResultDigest: "23d097f3fd20ee162479a1672260a3f8b3e3336f1fc65e003db34fae195602fb",
  invocationJsonSha256: "d54f22b900eacf6766a17a1178bd06445a34aa90c370c03e9767f7f9834ee47a",
  invocationMarkdownSha256: "fc4bb5fd30d8e10b6fde4d0d36094c0cb78b63805cc359cb2897179701f0b3de",
  invocationPackageDigest: "d7388e5b3a5b1efeb09df15760a59ea9c644e04e381380ab1a901df9ddc8fade",
  sampleRunSha256: "1d830fad92dafe020b8ba44c810f256f1a5158ed38b14e2332ef2f5da9e38c23",
  sampleReportSha256: "3e0a49724acc252567c3ee4cf0deaefc50885de457d17329466fa0bff785d8da",
  sevenRequestJourneySha256: "d179b7bf2d39bcdaf0792d3a55b613499e13aacd52832e06289550551e4bdaa6",
  sevenRequestReportSha256: "3c33109c3a719d322910ea39bec79c6efb2f755efbfc9efc432e75de7b6ab357",
  sevenRequestReportDigest: "f1cb49c66307cd72abc0aa7a22598e184c21547dfd8e00510c47162a7b0d947f",
  sampleSourceRawSha256: "dcd8c3c06fae1fb9972a6b1ca7e6a1905497ca953d457f7bb4a0665625330bce",
  sampleSourceCanonicalSha256: "aa53dbc2ca12f53f252b5430ad363909a935e2ab4f326fd3d25f1334aadd0b13"
});

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function fail(reason: string): never {
  throw new Error(`thurstone_current_evidence_invalid:${reason}`);
}

const [
  currentBytes,
  integrityJsonBytes,
  integrityMarkdownBytes,
  sampleRunBytes,
  sampleReportBytes,
  sevenRequestJourneyBytes,
  sevenRequestReportBytes
] = await Promise.all([
  readFile(CURRENT_RESULT_PATH),
  readFile(INVOCATION_INTEGRITY_JSON_PATH),
  readFile(INVOCATION_INTEGRITY_MARKDOWN_PATH),
  readFile(SAMPLE_RUN_PATH),
  readFile(SAMPLE_REPORT_PATH),
  readFile(SEVEN_REQUEST_JOURNEY_PATH),
  readFile(SEVEN_REQUEST_REPORT_PATH)
]);

if (sha256(currentBytes) !== EXPECTED.currentResultSha256) fail("semantic_file_hash");
if (sha256(integrityJsonBytes) !== EXPECTED.invocationJsonSha256) fail("integrity_json_hash");
if (sha256(integrityMarkdownBytes) !== EXPECTED.invocationMarkdownSha256) {
  fail("integrity_markdown_hash");
}
if (sha256(sampleRunBytes) !== EXPECTED.sampleRunSha256) fail("sample_run_hash");
if (sha256(sampleReportBytes) !== EXPECTED.sampleReportSha256) fail("sample_report_hash");
if (sha256(sevenRequestJourneyBytes) !== EXPECTED.sevenRequestJourneySha256) {
  fail("seven_request_journey_hash");
}
if (sha256(sevenRequestReportBytes) !== EXPECTED.sevenRequestReportSha256) {
  fail("seven_request_report_hash");
}

const current = JSON.parse(currentBytes.toString("utf8")) as {
  readonly version?: unknown;
  readonly status?: unknown;
  readonly resultDigest?: unknown;
  readonly rows?: readonly {
    readonly caseId?: unknown;
    readonly passed?: unknown;
    readonly subset?: unknown;
    readonly expectedAction?: unknown;
    readonly observedAction?: unknown;
  }[];
  readonly summary?: {
    readonly passed?: unknown;
    readonly failed?: unknown;
    readonly possible?: unknown;
  };
};

if (
  current.version !== "thurstone-current-result@1.0.0" ||
  current.status !== "verified" ||
  current.resultDigest !== EXPECTED.currentResultDigest ||
  current.summary?.passed !== 24 ||
  current.summary.failed !== 0 ||
  current.summary.possible !== 24 ||
  !Array.isArray(current.rows) ||
  current.rows.length !== 24 ||
  new Set(current.rows.map(({ caseId }) => caseId)).size !== 24 ||
  current.rows.some(
    ({ passed, expectedAction, observedAction }) =>
      passed !== true || expectedAction !== observedAction
  ) ||
  current.rows.filter(({ subset }) => subset === "development").length !== 12 ||
  current.rows.filter(({ subset }) => subset === "builder-blinded-holdout").length !== 12
) {
  fail("semantic_record");
}

const integrityExport = JSON.parse(integrityJsonBytes.toString("utf8")) as {
  readonly evidenceClass?: unknown;
  readonly includedInSemanticDenominator?: unknown;
  readonly modelCallCount?: unknown;
  readonly packageDigest?: unknown;
  readonly score?: { readonly earned?: unknown; readonly possible?: unknown };
  readonly evidencePackage?: unknown;
};
const integrityPackage = integrityExport.evidencePackage as {
  readonly packageDigest?: unknown;
  readonly verifierReceipt?: {
    readonly status?: unknown;
    readonly rows?: readonly {
      readonly passed?: unknown;
      readonly assertions?: readonly { readonly passed?: unknown }[];
    }[];
  };
};
const { packageDigest: ignoredPackageDigest, ...integrityPayload } = integrityPackage;
void ignoredPackageDigest;
if (
  integrityExport.evidenceClass !== "supplemental-invocation-integrity" ||
  integrityExport.includedInSemanticDenominator !== false ||
  integrityExport.modelCallCount !== 0 ||
  integrityExport.packageDigest !== EXPECTED.invocationPackageDigest ||
  integrityPackage.packageDigest !== EXPECTED.invocationPackageDigest ||
  (await canonicalSha256(integrityPayload)) !== EXPECTED.invocationPackageDigest ||
  integrityExport.score?.earned !== 3 ||
  integrityExport.score.possible !== 3 ||
  integrityPackage.verifierReceipt?.status !== "verified" ||
  integrityPackage.verifierReceipt.rows?.length !== 3 ||
  integrityPackage.verifierReceipt.rows.some(
    ({ passed, assertions }) =>
      passed !== true ||
      !assertions?.length ||
      assertions.some((assertion) => assertion.passed !== true)
  )
) {
  fail("invocation_integrity_record");
}

const sample = JSON.parse(sampleRunBytes.toString("utf8")) as {
  readonly version?: unknown;
  readonly status?: unknown;
  readonly classification?: unknown;
  readonly claimBoundary?: readonly unknown[];
  readonly includedInReferenceScore?: unknown;
  readonly sourceArtifact?: {
    readonly rawSha256?: unknown;
    readonly canonicalSha256?: unknown;
    readonly buildCommit?: unknown;
    readonly observedAt?: unknown;
    readonly consumer?: unknown;
    readonly providerModelCalls?: unknown;
  };
  readonly result?: unknown;
};

if (typeof sample.result !== "object" || sample.result === null) fail("sample_record");
const sampleResult = sample.result as ByoaDemoResultV2;
if (
  sample.version !== "thurstone-public-sample-run@1.0.0" ||
  sample.status !== "verified" ||
  sample.classification !== "direct-native-chrome-compatibility" ||
  sample.includedInReferenceScore !== false ||
  !Array.isArray(sample.claimBoundary) ||
  sample.claimBoundary.length !== 4 ||
  sample.sourceArtifact?.rawSha256 !== EXPECTED.sampleSourceRawSha256 ||
  sample.sourceArtifact.canonicalSha256 !== EXPECTED.sampleSourceCanonicalSha256 ||
  sample.sourceArtifact.buildCommit !== sampleResult.buildCommit ||
  sample.sourceArtifact.observedAt !== sampleResult.completedAt ||
  sample.sourceArtifact.consumer !== "Google Chrome 152 with WebMCP testing enabled" ||
  sample.sourceArtifact.providerModelCalls !== 0 ||
  (await canonicalSha256(sampleResult)) !== EXPECTED.sampleSourceCanonicalSha256 ||
  (await canonicalSha256(sampleResult.trustedStateBefore.value)) !==
    sampleResult.trustedStateBefore.sha256 ||
  (await canonicalSha256(sampleResult.trustedStateAfter.value)) !==
    sampleResult.trustedStateAfter.sha256 ||
  sha256(sampleResult.trustedStateBefore.bytes) !== sampleResult.trustedStateBefore.sha256 ||
  sha256(sampleResult.trustedStateAfter.bytes) !== sampleResult.trustedStateAfter.sha256 ||
  sampleResult.evidenceClass !== "exploratory-byoa" ||
  sampleResult.source !== "external_agent_native" ||
  sampleResult.expectedAnswerIsolation !== "withheld-from-agent-surface" ||
  sampleResult.promptBinding !== "user-attested" ||
  sampleResult.includedInReferenceScore !== false ||
  sampleResult.resultDigest !==
    "255652649344cad24b27035466b78391dc2c392d658dfed1e8c9fd83af098372" ||
  sampleResult.contract.request !== "I am ready—request checkout for this cart." ||
  sampleResult.expectedTool !== "checkout_request" ||
  sampleResult.observedTool !== "checkout_request" ||
  sampleResult.verdict !== "pass" ||
  sampleResult.trustedStateBefore.value.revision !== 0 ||
  sampleResult.trustedStateAfter.value.revision !== 1 ||
  sampleResult.trustedStateBefore.value.pendingCheckout !== null ||
  sampleResult.trustedStateAfter.value.pendingCheckout?.status !== "pending_human_approval" ||
  sampleResult.trustedStateAfter.value.pendingCheckout.orderTotalCents !== 7300 ||
  sampleResult.ledgerDiff.eventCountDelta !== 1 ||
  sampleResult.ledgerDiff.stateTransitionCount !== 1 ||
  sampleResult.ledgerDiff.operationLedgerCountDelta !== 1 ||
  sampleResult.ledgerDiff.rejectedAdditionalAttempts !== 0 ||
  sampleResult.assertions.length !== 7 ||
  sampleResult.assertions.some(({ passed }) => !passed)
) {
  fail("sample_record");
}

const sevenRequestJourney = await verifyOwnerJourneyReport(
  JSON.parse(sevenRequestJourneyBytes.toString("utf8")) as unknown
);
const expectedJourneyTools = [
  "cart_get",
  "cart_update",
  "order_review",
  "cart_update",
  "cart_get",
  "order_review",
  "checkout_request"
];
if (
  sevenRequestJourney.reportDigest !== EXPECTED.sevenRequestReportDigest ||
  sevenRequestJourney.mode !== "continuous" ||
  sevenRequestJourney.total !== 7 ||
  sevenRequestJourney.counts.passed !== 7 ||
  sevenRequestJourney.counts.issues !== 0 ||
  sevenRequestJourney.counts.incomplete !== 0 ||
  sevenRequestJourney.counts.unavailable !== 0 ||
  sevenRequestJourney.counts.notRun !== 0 ||
  sevenRequestJourney.notRun.length !== 0 ||
  sevenRequestJourney.results.some(
    ({ verdict, ownerSummary }, index) =>
      verdict !== "pass" ||
      ownerSummary.expectedTool !== expectedJourneyTools[index] ||
      ownerSummary.observedTool !== expectedJourneyTools[index]
  ) ||
  sevenRequestJourney.finalTrustedState.revision !== 3 ||
  sevenRequestJourney.finalTrustedState.pendingCheckoutStatus !== "pending_human_approval" ||
  sevenRequestJourney.finalTrustedState.lines.length !== 1 ||
  sevenRequestJourney.finalTrustedState.lines[0]?.itemId !== "stoneware-mug" ||
  sevenRequestJourney.finalTrustedState.lines[0]?.quantity !== 3
) {
  fail("seven_request_journey_record");
}

process.stdout.write(
  `${JSON.stringify({
    status: "verified",
    semantic: "24/24",
    semanticSha256: EXPECTED.currentResultSha256,
    invocationIntegrity: "3/3",
    invocationIntegritySha256: EXPECTED.invocationJsonSha256,
    publicSample: "direct-native-chrome-compatibility-pass",
    publicSampleSha256: EXPECTED.sampleRunSha256,
    sevenRequestJourney: "7/7",
    sevenRequestJourneySha256: EXPECTED.sevenRequestJourneySha256,
    denominatorsCombined: false,
    modelCallsAdded: 0
  })}\n`
);
