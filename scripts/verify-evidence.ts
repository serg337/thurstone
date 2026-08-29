import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { canonicalJson, canonicalSha256 } from "../lib/evidence/digest";
import {
  GATE6_EVIDENCE_PACKAGE_VERSION,
  computeGate6Metrics,
  createGate6EvidenceExports,
  type Gate6EvidencePackage
} from "../lib/results/evidence-package";

const jsonPath =
  process.env.TOOLPROOF_EVIDENCE_JSON_PATH?.trim() || "evidence/toolproof-reference-evidence.json";
const markdownPath =
  process.env.TOOLPROOF_EVIDENCE_MARKDOWN_PATH?.trim() ||
  "evidence/toolproof-reference-evidence.md";
const [jsonBytes, markdownBytes] = await Promise.all([
  readFile(jsonPath, "utf8"),
  readFile(markdownPath, "utf8")
]);
const evidence = JSON.parse(jsonBytes) as Gate6EvidencePackage;
const { packageDigest, ...payload } = evidence;
if (
  evidence.version !== GATE6_EVIDENCE_PACKAGE_VERSION ||
  jsonBytes !== `${canonicalJson(evidence)}\n` ||
  (await canonicalSha256(payload)) !== packageDigest ||
  evidence.records.length !== 48 ||
  evidence.summary.pairedCases !== 24 ||
  evidence.summary.baselinePassed !== 23 ||
  evidence.summary.revisedPassed !== 23 ||
  !evidence.summary.noMeasuredImprovement
) {
  throw new Error("gate6_public_evidence_identity_invalid");
}
for (const version of ["baseline", "revised"] as const) {
  const records = evidence.records.filter((record) => record.version === version);
  if (canonicalJson(computeGate6Metrics(records)) !== canonicalJson(evidence.metrics[version])) {
    throw new Error(`gate6_public_evidence_metric_mismatch:${version}`);
  }
}
const rebuilt = await createGate6EvidenceExports(evidence);
if (rebuilt.json !== jsonBytes || rebuilt.markdown !== markdownBytes) {
  throw new Error("gate6_public_evidence_export_mismatch");
}
const evidenceOrigin = (
  process.env.TOOLPROOF_EVIDENCE_ORIGIN?.trim() || "https://toolproof-rust.vercel.app"
).replace(/\/$/u, "");
{
  const fetchFresh = async (path: string) => {
    const response = await fetch(`${evidenceOrigin}${path}`, { cache: "no-store" });
    if (!response.ok || response.headers.get("cache-control") !== "no-store") {
      throw new Error(`gate6_clean_recompute_fetch_failed:${path}:${response.status}`);
    }
    return response.text();
  };
  const [firstJson, secondJson, firstMarkdown, secondMarkdown] = await Promise.all([
    fetchFresh("/api/evidence/reference"),
    fetchFresh("/api/evidence/reference"),
    fetchFresh("/api/evidence/reference/markdown"),
    fetchFresh("/api/evidence/reference/markdown")
  ]);
  if (
    firstJson !== secondJson ||
    firstMarkdown !== secondMarkdown ||
    firstJson !== jsonBytes ||
    firstMarkdown !== markdownBytes
  ) {
    throw new Error("gate6_clean_recompute_byte_mismatch");
  }
}
const forbiddenLiterals = [".toolproof-local", "authorizationJti"];
const localAbsolutePath = /\/(?:Users|Volumes|mnt)\/[A-Za-z0-9._-]+(?:\/|\b)/u;
if (
  forbiddenLiterals.some(
    (sentinel) => jsonBytes.includes(sentinel) || markdownBytes.includes(sentinel)
  ) ||
  localAbsolutePath.test(jsonBytes) ||
  localAbsolutePath.test(markdownBytes)
) {
  throw new Error("gate6_public_evidence_private_boundary_violation");
}
const coverage = new Set(
  evidence.records.map(
    ({ version, subset, family, passed }) =>
      `${version}:${subset}:${family}:${passed ? "pass" : "fail"}`
  )
);
for (const version of ["baseline", "revised"] as const) {
  for (const subset of ["development", "builder-blinded-holdout"] as const) {
    for (const family of new Set(evidence.records.map((record) => record.family))) {
      if (
        !evidence.records.some(
          (record) =>
            record.version === version && record.subset === subset && record.family === family
        )
      ) {
        throw new Error(
          `gate6_public_evidence_family_coverage_missing:${version}:${subset}:${family}`
        );
      }
    }
  }
}
if (![...coverage].some((key) => key.endsWith(":fail"))) {
  throw new Error("gate6_public_evidence_failure_sample_missing");
}
const sampleRecords = new Map<string, Gate6EvidencePackage["records"][number]>();
for (const record of evidence.records) {
  const group = `${record.version}:${record.subset}:${record.family}`;
  const current = sampleRecords.get(group);
  const rank = (candidate: typeof record) =>
    createHash("sha256")
      .update(`${evidence.packageDigest}:${candidate.version}:${candidate.runnerCaseId}`)
      .digest("hex");
  if (!current || rank(record) < rank(current)) sampleRecords.set(group, record);
}
for (const record of evidence.records.filter(({ passed }) => !passed)) {
  sampleRecords.set(`failure:${record.version}:${record.caseId}`, record);
}
const sample = [...sampleRecords.values()].map(
  ({ version, subset, family, caseId, passed, hashes }) => ({
    version,
    subset,
    family,
    caseId,
    passed,
    rowDigest: hashes.rowDigest
  })
);
process.stdout.write(
  `${JSON.stringify({
    ok: true,
    packageDigest,
    jsonSha256: rebuilt.jsonSha256,
    markdownSha256: rebuilt.markdownSha256,
    records: evidence.records.length,
    baseline: `${evidence.summary.baselinePassed}/24`,
    revised: `${evidence.summary.revisedPassed}/24`,
    deterministicTraceSample: sample
  })}\n`
);
