import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { canonicalJson } from "../lib/evidence/digest";
import {
  GATE5_SOURCE_DIFF_PATH,
  buildGate5SourceDiffProof
} from "../lib/semantic/gate5-source-diff-proof";
import { configuredGate5Revision } from "../lib/semantic/revision-config.server";

const execFile = promisify(execFileCallback);

async function git(args: readonly string[]): Promise<string> {
  const result = await execFile("git", [...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 1_048_576
  });
  return result.stdout;
}

function patchArguments(v1AppCommit: string, v2AppCommit: string): string[] {
  return [
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
  ];
}

const configured = await configuredGate5Revision();

if (configured.status === "awaiting-repair" || configured.status === "awaiting-human") {
  process.stdout.write(
    `${JSON.stringify({ ok: true, mode: "gate5-one-variable", status: configured.status })}\n`
  );
} else if (configured.status !== "ready" || !configured.revision) {
  throw new Error(configured.issue ?? "gate5_revision_configuration_invalid");
} else {
  const revision = configured.revision;
  const activeCommit =
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ?? process.env.TOOLPROOF_COMMIT_SHA?.trim() ?? "";
  const terminalPresentation = activeCommit !== revision.v2AppCommit;
  if (
    terminalPresentation &&
    (process.env.TOOLPROOF_GATE5_PRESENTATION_COMMIT?.trim() !== activeCommit ||
      process.env.TOOLPROOF_SCORED_OPERATOR_PHASE?.trim() ||
      !/^run_[A-Za-z0-9_-]{22}$/u.test(process.env.TOOLPROOF_REVISED_RUN_ID?.trim() ?? "") ||
      !/^[a-f0-9]{64}$/u.test(process.env.TOOLPROOF_REVISED_EVIDENCE_DIGEST?.trim() ?? ""))
  ) {
    throw new Error("gate5_terminal_presentation_binding_invalid");
  }
  if (terminalPresentation) {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        mode: "gate5-one-variable",
        status: "verified-terminal-reference-presentation",
        changedField: revision.changedField,
        file: GATE5_SOURCE_DIFF_PATH,
        v1AppCommit: revision.v1AppCommit,
        v2AppCommit: revision.v2AppCommit,
        presentationCommit: activeCommit,
        sourceDiffProofHash: revision.sourceDiffProof.proofHash,
        revisionFreezeHash: revision.revisionFreezeHash
      })}\n`
    );
  } else {
    const [resolvedV1, resolvedV2, v1RawSource, v2RawSource, patch, changedNames] =
      await Promise.all([
        git(["rev-parse", "--verify", `${revision.v1AppCommit}^{commit}`]),
        git(["rev-parse", "--verify", `${revision.v2AppCommit}^{commit}`]),
        git(["show", `${revision.v1AppCommit}:${GATE5_SOURCE_DIFF_PATH}`]),
        git(["show", `${revision.v2AppCommit}:${GATE5_SOURCE_DIFF_PATH}`]),
        git(patchArguments(revision.v1AppCommit, revision.v2AppCommit)),
        git([
          "-c",
          "core.quotePath=false",
          "diff",
          "--name-only",
          "--no-ext-diff",
          "--no-renames",
          revision.v1AppCommit,
          revision.v2AppCommit,
          "--"
        ])
      ]);
    const changedPaths = changedNames
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .filter(Boolean);
    const rebuilt = await buildGate5SourceDiffProof({
      changedPaths,
      v1AppCommit: resolvedV1.trim(),
      v2AppCommit: resolvedV2.trim(),
      oldJsonStringLiteral: JSON.stringify(revision.oldDescription),
      newJsonStringLiteral: JSON.stringify(revision.newDescription),
      v1RawSource,
      v2RawSource,
      patch
    });
    if (
      activeCommit !== revision.v2AppCommit ||
      resolvedV1.trim() !== revision.v1AppCommit ||
      resolvedV2.trim() !== revision.v2AppCommit ||
      canonicalJson(rebuilt) !== canonicalJson(revision.sourceDiffProof)
    ) {
      throw new Error("gate5_source_diff_not_exactly_one_description");
    }
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        mode: "gate5-one-variable",
        status: "verified",
        changedField: revision.changedField,
        file: GATE5_SOURCE_DIFF_PATH,
        v1AppCommit: revision.v1AppCommit,
        v2AppCommit: revision.v2AppCommit,
        presentationCommit: activeCommit,
        terminalPresentation: false,
        sourceDiffProofHash: revision.sourceDiffProof.proofHash,
        revisionFreezeHash: revision.revisionFreezeHash
      })}\n`
    );
  }
}
