import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { canonicalJson } from "../lib/evidence/digest";
import {
  GATE5_SOURCE_DIFF_ENV,
  GATE5_SOURCE_DIFF_PATH,
  buildGate5SourceDiffProof,
  extractGate5DescriptionJsonLiteral
} from "../lib/semantic/gate5-source-diff-proof";

const execFile = promisify(execFileCallback);

async function git(args: readonly string[]): Promise<string> {
  const result = await execFile("git", [...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 1_048_576
  });
  return result.stdout;
}

const [v1Input, v2Input, ...unexpected] = process.argv.slice(2);
if (!v1Input || !v2Input || unexpected.length > 0) {
  throw new Error("usage: prepare-gate5-source-diff <v1-commit> <v2-commit>");
}
const [v1AppCommit, v2AppCommit] = await Promise.all([
  git(["rev-parse", "--verify", `${v1Input}^{commit}`]).then((value) => value.trim()),
  git(["rev-parse", "--verify", `${v2Input}^{commit}`]).then((value) => value.trim())
]);
const [v1RawSource, v2RawSource, patch, changedNames] = await Promise.all([
  git(["show", `${v1AppCommit}:${GATE5_SOURCE_DIFF_PATH}`]),
  git(["show", `${v2AppCommit}:${GATE5_SOURCE_DIFF_PATH}`]),
  git([
    "-c",
    "core.quotePath=false",
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--no-renames",
    "--full-index",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--unified=3",
    "--diff-algorithm=myers",
    "--no-indent-heuristic",
    v1AppCommit,
    v2AppCommit,
    "--",
    GATE5_SOURCE_DIFF_PATH
  ]),
  git([
    "-c",
    "core.quotePath=false",
    "diff",
    "--name-only",
    "--no-ext-diff",
    "--no-renames",
    v1AppCommit,
    v2AppCommit,
    "--"
  ])
]);
const sourceDiffProof = await buildGate5SourceDiffProof({
  changedPaths: changedNames
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean),
  v1AppCommit,
  v2AppCommit,
  oldJsonStringLiteral: extractGate5DescriptionJsonLiteral(v1RawSource),
  newJsonStringLiteral: extractGate5DescriptionJsonLiteral(v2RawSource),
  v1RawSource,
  v2RawSource,
  patch
});
process.stdout.write(
  `${JSON.stringify({
    ok: true,
    mode: "gate5-source-diff-prepare",
    environmentName: GATE5_SOURCE_DIFF_ENV,
    sourceDiffProofHash: sourceDiffProof.proofHash,
    base64Url: Buffer.from(canonicalJson(sourceDiffProof), "utf8").toString("base64url")
  })}\n`
);
