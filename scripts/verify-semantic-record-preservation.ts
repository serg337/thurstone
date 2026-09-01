import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SEMANTIC_SOURCE_COMMIT = "1949d4eda334f716470b7948442644b3b661c270";
const INTEGRITY_SOURCE_COMMIT = "2e52711e4ac0f91c88df118d22d2db52842aadb1";
const expectedFiles = Object.freeze({
  "evidence/thurstone-current-result.json": Object.freeze({
    commit: SEMANTIC_SOURCE_COMMIT,
    sha256: "63151d60484b3cb12cc20c8640d66430cd938437ef86f115f622753f7760e26c"
  }),
  "evidence/thurstone-invocation-integrity.json": Object.freeze({
    commit: INTEGRITY_SOURCE_COMMIT,
    sha256: "d54f22b900eacf6766a17a1178bd06445a34aa90c370c03e9767f7f9834ee47a"
  }),
  "evidence/thurstone-invocation-integrity.md": Object.freeze({
    commit: INTEGRITY_SOURCE_COMMIT,
    sha256: "fc4bb5fd30d8e10b6fde4d0d36094c0cb78b63805cc359cb2897179701f0b3de"
  })
});

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function blobOid(value: Buffer): string {
  return createHash("sha1").update(`blob ${value.length}\0`).update(value).digest("hex");
}

function git(args: readonly string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function fail(reason: string): never {
  throw new Error(`semantic_record_preservation_failed:${reason}`);
}

const activeCommit =
  process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
  process.env.TOOLPROOF_COMMIT_SHA?.trim() ||
  git(["rev-parse", "HEAD"]);
if (!/^[a-f0-9]{40}$/u.test(activeCommit)) fail("active_commit");

for (const [path, identity] of Object.entries(expectedFiles)) {
  execFileSync("git", ["cat-file", "-e", `${identity.commit}^{commit}`], { stdio: "ignore" });
  const bytes = readFileSync(path);
  const sourceOid = git(["rev-parse", `${identity.commit}:${path}`]);
  const activeOid = git(["rev-parse", `${activeCommit}:${path}`]);
  if (sha256(bytes) !== identity.sha256) fail(`${path}:working_tree_hash`);
  if (sourceOid !== activeOid || activeOid !== blobOid(bytes)) fail(`${path}:tree_oid_drift`);
}

const semantic = JSON.parse(readFileSync("evidence/thurstone-current-result.json", "utf8")) as {
  readonly resultDigest?: unknown;
  readonly rows?: readonly { readonly passed?: unknown }[];
  readonly summary?: {
    readonly passed?: unknown;
    readonly failed?: unknown;
    readonly possible?: unknown;
  };
};
if (
  semantic.resultDigest !== "23d097f3fd20ee162479a1672260a3f8b3e3336f1fc65e003db34fae195602fb" ||
  semantic.summary?.passed !== 24 ||
  semantic.summary.failed !== 0 ||
  semantic.summary.possible !== 24 ||
  semantic.rows?.length !== 24 ||
  semantic.rows.some(({ passed }) => passed !== true)
) {
  fail("semantic_24_of_24");
}

const integrity = JSON.parse(
  readFileSync("evidence/thurstone-invocation-integrity.json", "utf8")
) as {
  readonly includedInSemanticDenominator?: unknown;
  readonly modelCallCount?: unknown;
  readonly score?: { readonly earned?: unknown; readonly possible?: unknown };
};
if (
  integrity.includedInSemanticDenominator !== false ||
  integrity.modelCallCount !== 0 ||
  integrity.score?.earned !== 3 ||
  integrity.score.possible !== 3
) {
  fail("separate_integrity_3_of_3");
}

process.stdout.write(
  `${JSON.stringify({
    status: "evidence-preserved",
    activeCommit,
    semanticSourceCommit: SEMANTIC_SOURCE_COMMIT,
    semanticResult: "24/24",
    integritySourceCommit: INTEGRITY_SOURCE_COMMIT,
    invocationIntegrityResult: "3/3 separate",
    artifacts: expectedFiles
  })}\n`
);
