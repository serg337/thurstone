import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SEALED_EVIDENCE_BUILD = "768af2539ca20c29928a897644ad22ba897c580d";
const EXPECTED_PACKAGE_DIGEST = "a449db4b1faacdbaab58777923d2ddbde75396b70fa4744b29d0eb8e97089a46";

const expectedFiles = Object.freeze({
  "evidence/toolproof-reference-evidence.json":
    "fb272a4a68d9c1d3d4542a668b86b23f293cd55e714c1b826af32c7fcac0be26",
  "evidence/toolproof-reference-evidence.md":
    "8301efa790f193060296d68a78b0553cf30d0c207b15864cf13609c65f2931fa",
  "evidence/sample-run.json": "6d2835c5bfa580a4a8fdb79d4dfe6ee74b3eaf48dc11a8f4f5cfe86573e954ee",
  "evidence/sample-report.md": "d627627b464e64a46c8809fbb6d76be883b269aca181417b2337ddd8cfd74abe"
});

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function blobOid(value: Buffer): string {
  return createHash("sha1").update(`blob ${value.length}\0`).update(value).digest("hex");
}

function fail(message: string): never {
  throw new Error(`semantic_record_preservation_failed:${message}`);
}

const root = process.cwd();
const activeCommit =
  process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
  process.env.TOOLPROOF_COMMIT_SHA?.trim() ||
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
if (!/^[a-f0-9]{40}$/u.test(activeCommit)) fail("active_commit");

execFileSync("git", ["cat-file", "-e", `${SEALED_EVIDENCE_BUILD}^{commit}`], {
  cwd: root,
  stdio: "ignore"
});

for (const [path, expectedHash] of Object.entries(expectedFiles)) {
  const current = readFileSync(resolve(root, path));
  const sealedOid = execFileSync("git", ["rev-parse", `${SEALED_EVIDENCE_BUILD}:${path}`], {
    cwd: root,
    encoding: "utf8"
  }).trim();
  const activeOid = execFileSync("git", ["rev-parse", `${activeCommit}:${path}`], {
    cwd: root,
    encoding: "utf8"
  }).trim();
  if (sha256(current) !== expectedHash) fail(`${path}:current_hash`);
  if (sealedOid !== activeOid || activeOid !== blobOid(current)) fail(`${path}:tree_oid_drift`);
}

const reference = JSON.parse(
  readFileSync(resolve(root, "evidence/toolproof-reference-evidence.json"), "utf8")
) as {
  readonly packageDigest?: unknown;
  readonly summary?: {
    readonly baselinePassed?: unknown;
    readonly revisedPassed?: unknown;
    readonly possible?: unknown;
    readonly pairedCases?: unknown;
    readonly noMeasuredImprovement?: unknown;
  };
  readonly records?: readonly { readonly version?: unknown; readonly passed?: unknown }[];
};

if (reference.packageDigest !== EXPECTED_PACKAGE_DIGEST) fail("package_digest");
if (
  reference.summary?.baselinePassed !== 23 ||
  reference.summary.revisedPassed !== 23 ||
  reference.summary.possible !== 24 ||
  reference.summary.pairedCases !== 24 ||
  reference.summary.noMeasuredImprovement !== true
) {
  fail("summary");
}
if (!Array.isArray(reference.records) || reference.records.length !== 48) fail("record_count");

for (const version of ["baseline", "revised"] as const) {
  const records = reference.records.filter((record) => record.version === version);
  if (records.length !== 24) fail(`${version}_record_count`);
  if (records.filter((record) => record.passed === true).length !== 23) {
    fail(`${version}_passed_count`);
  }
}

console.log(
  JSON.stringify({
    status: "semantic-record-preserved",
    sealedEvidenceBuild: SEALED_EVIDENCE_BUILD,
    packageDigest: EXPECTED_PACKAGE_DIGEST,
    artifacts: expectedFiles,
    records: 48,
    result: "23/24 -> 23/24",
    noMeasuredImprovement: true
  })
);
