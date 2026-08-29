import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalJson } from "../lib/evidence/digest";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = process.cwd();
const referencePath = resolve(root, "evidence/toolproof-reference-evidence.json");
const samplePath = resolve(root, "evidence/sample-run.json");
const reportPath = resolve(root, "evidence/sample-report.md");
const [referenceBytes, sampleBytes, report] = await Promise.all([
  readFile(referencePath, "utf8"),
  readFile(samplePath, "utf8"),
  readFile(reportPath, "utf8")
]);
interface EvidenceRecord {
  readonly version: string;
  readonly subset: string;
  readonly family: string;
  readonly caseId: string;
  readonly ordinal: number;
  readonly request: string;
  readonly expectedAction: string;
  readonly observedAction: string;
  readonly passed: boolean;
  readonly failureCodes: readonly string[];
  readonly hashes: {
    readonly rowDigest: string;
    readonly stateBeforeHash: string;
    readonly stateAfterHash: string;
    readonly traceArgumentsHash: string;
    readonly traceResultHash: string;
  };
  readonly model: {
    readonly provider: string;
    readonly model: string;
    readonly decision: unknown;
    readonly decisionError: unknown;
    readonly durationMs: number;
    readonly rawResponseHash: string;
  };
  readonly runtime: {
    readonly argumentMode: string;
    readonly origin: string;
    readonly browserVersion: string;
  };
  readonly liveCatalog: { readonly manifestHash: string; readonly toolNames: readonly string[] };
  readonly execution: {
    readonly canonicalArguments: unknown;
    readonly nativeResult: {
      readonly ok: boolean;
      readonly fixtureId: string;
      readonly stateRevision: number;
      readonly subtotalCents: number;
      readonly totalCents: number;
      readonly checkoutStatus: string;
      readonly shipping: { readonly shippingCents: number; readonly deliveryWindow: string };
    };
    readonly effect: {
      readonly stateChanged: boolean;
      readonly revision: { readonly before: number; readonly after: number };
      readonly pendingCheckout: { readonly before: unknown; readonly after: unknown };
    };
  };
}

const reference = JSON.parse(referenceBytes) as {
  readonly packageDigest: string;
  readonly provenance?: { readonly revisedAppCommit?: string };
  readonly records: readonly EvidenceRecord[];
};
const sample = JSON.parse(sampleBytes) as Record<string, unknown> & {
  readonly version?: unknown;
  readonly source?: {
    readonly packageDigest?: unknown;
    readonly canonicalJsonSha256?: unknown;
  };
  readonly case?: {
    readonly version?: unknown;
    readonly subset?: unknown;
    readonly caseId?: unknown;
  };
  readonly limitations?: unknown;
};
const referenceSha256 = createHash("sha256").update(referenceBytes).digest("hex");

assert(sample.version === "toolproof-public-sample-run@1.0.0", "sample_version_invalid");
assert(
  sample.source?.packageDigest === reference.packageDigest &&
    sample.source?.canonicalJsonSha256 === referenceSha256,
  "sample_source_package_mismatch"
);
const record = reference.records.find(
  (candidate) =>
    candidate.version === sample.case?.version &&
    candidate.subset === sample.case?.subset &&
    candidate.caseId === sample.case?.caseId
);
assert(record, "sample_source_record_missing");
const expected = {
  source: {
    packageDigest: reference.packageDigest,
    canonicalJsonSha256: referenceSha256,
    rowDigest: record.hashes.rowDigest,
    measuredCommit: reference.provenance?.revisedAppCommit
  },
  case: {
    version: record.version,
    subset: record.subset,
    family: record.family,
    caseId: record.caseId,
    ordinal: record.ordinal,
    request: record.request,
    expectedAction: record.expectedAction,
    observedAction: record.observedAction,
    passed: record.passed,
    failureCodes: record.failureCodes
  },
  model: {
    provider: record.model.provider,
    model: record.model.model,
    decision: record.model.decision,
    decisionError: record.model.decisionError,
    durationMs: record.model.durationMs,
    rawResponseHash: record.model.rawResponseHash
  },
  nativeExecution: {
    argumentMode: record.runtime.argumentMode,
    canonicalArguments: record.execution.canonicalArguments,
    result: {
      ok: record.execution.nativeResult.ok,
      fixtureId: record.execution.nativeResult.fixtureId,
      stateRevision: record.execution.nativeResult.stateRevision,
      subtotalCents: record.execution.nativeResult.subtotalCents,
      shippingCents: record.execution.nativeResult.shipping.shippingCents,
      totalCents: record.execution.nativeResult.totalCents,
      deliveryWindow: record.execution.nativeResult.shipping.deliveryWindow,
      checkoutStatus: record.execution.nativeResult.checkoutStatus
    },
    effect: {
      stateChanged: record.execution.effect.stateChanged,
      revisionBefore: record.execution.effect.revision.before,
      revisionAfter: record.execution.effect.revision.after,
      pendingCheckoutBefore: record.execution.effect.pendingCheckout.before,
      pendingCheckoutAfter: record.execution.effect.pendingCheckout.after
    },
    stateBeforeHash: record.hashes.stateBeforeHash,
    stateAfterHash: record.hashes.stateAfterHash,
    traceArgumentsHash: record.hashes.traceArgumentsHash,
    traceResultHash: record.hashes.traceResultHash
  },
  runtime: {
    origin: record.runtime.origin,
    browser: record.runtime.browserVersion,
    manifestHash: record.liveCatalog.manifestHash,
    toolNames: record.liveCatalog.toolNames
  }
};
for (const [section, value] of Object.entries(expected)) {
  assert(canonicalJson(sample[section]) === canonicalJson(value), `sample_${section}_mismatch`);
}
for (const required of [
  reference.packageDigest,
  record.hashes.rowDigest,
  "Baseline: `23/24`",
  "Revised: `23/24`",
  "Measured improvement: none",
  "one-trial-per-case demonstration snapshot"
]) {
  assert(report.includes(required), `sample_report_missing:${required}`);
}
assert(
  Array.isArray(sample.limitations) && sample.limitations.length >= 4,
  "sample_limitations_missing"
);

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    mode: "sample-evidence",
    record: `${record.version}/${record.subset}/${record.caseId}`,
    rowDigest: record.hashes.rowDigest,
    packageDigest: reference.packageDigest
  })}\n`
);
