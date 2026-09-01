import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { canonicalSha256 } from "../lib/evidence/digest";

const CURRENT_RESULT_PATH = "evidence/thurstone-current-result.json";
const INVOCATION_INTEGRITY_JSON_PATH = "evidence/thurstone-invocation-integrity.json";
const INVOCATION_INTEGRITY_MARKDOWN_PATH = "evidence/thurstone-invocation-integrity.md";

const EXPECTED = Object.freeze({
  currentResultSha256: "63151d60484b3cb12cc20c8640d66430cd938437ef86f115f622753f7760e26c",
  currentResultDigest: "23d097f3fd20ee162479a1672260a3f8b3e3336f1fc65e003db34fae195602fb",
  invocationJsonSha256: "d54f22b900eacf6766a17a1178bd06445a34aa90c370c03e9767f7f9834ee47a",
  invocationMarkdownSha256: "fc4bb5fd30d8e10b6fde4d0d36094c0cb78b63805cc359cb2897179701f0b3de",
  invocationPackageDigest: "d7388e5b3a5b1efeb09df15760a59ea9c644e04e381380ab1a901df9ddc8fade"
});

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function fail(reason: string): never {
  throw new Error(`thurstone_current_evidence_invalid:${reason}`);
}

const [currentBytes, integrityJsonBytes, integrityMarkdownBytes] = await Promise.all([
  readFile(CURRENT_RESULT_PATH),
  readFile(INVOCATION_INTEGRITY_JSON_PATH),
  readFile(INVOCATION_INTEGRITY_MARKDOWN_PATH)
]);

if (sha256(currentBytes) !== EXPECTED.currentResultSha256) fail("semantic_file_hash");
if (sha256(integrityJsonBytes) !== EXPECTED.invocationJsonSha256) fail("integrity_json_hash");
if (sha256(integrityMarkdownBytes) !== EXPECTED.invocationMarkdownSha256) {
  fail("integrity_markdown_hash");
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

process.stdout.write(
  `${JSON.stringify({
    status: "verified",
    semantic: "24/24",
    semanticSha256: EXPECTED.currentResultSha256,
    invocationIntegrity: "3/3",
    invocationIntegritySha256: EXPECTED.invocationJsonSha256,
    denominatorsCombined: false,
    modelCallsAdded: 0
  })}\n`
);
