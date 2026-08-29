import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import { canonicalJson } from "../lib/evidence/digest";
import {
  GATE6_PRESENTATION_PROOF_ENV,
  decodeGate6PresentationProof,
  dependencyProjectionHash
} from "../lib/results/presentation-proof";

function assertFirstParentAncestor(ancestor: string, descendant: string): void {
  let cursor = descendant;
  for (let depth = 0; depth <= 512; depth += 1) {
    if (cursor === ancestor) return;
    const parents = execFileSync("git", ["cat-file", "-p", cursor], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 1_048_576
    })
      .split(/\r?\n/u)
      .flatMap((line) => (/^parent ([a-f0-9]{40})$/u.exec(line)?.[1] ? [line.slice(7)] : []));
    if (parents.length !== 1) throw new Error("gate6_presentation_non_linear_ancestry");
    cursor = parents[0]!;
  }
  throw new Error("gate6_presentation_ancestry_depth_exceeded");
}

const activeCommit =
  process.env.VERCEL_GIT_COMMIT_SHA?.trim() ?? process.env.TOOLPROOF_COMMIT_SHA?.trim() ?? "";
const measuredV2 = "251c44be34456ecc022839da6c8b85fe1c10e1fc";
if (activeCommit === measuredV2) {
  process.stdout.write(
    `${JSON.stringify({ ok: true, mode: "gate6-presentation", status: "measured-v2" })}\n`
  );
} else {
  const encoded = process.env[GATE6_PRESENTATION_PROOF_ENV]?.trim();
  if (!encoded) throw new Error("gate6_presentation_proof_missing");
  const proof = await decodeGate6PresentationProof(encoded);
  const packEncoded = process.env.TOOLPROOF_GATE6_GIT_PACK_B64?.trim() ?? "";
  if (process.env.TOOLPROOF_GATE6_PRESENTATION_PROOF_HASH?.trim() !== proof.proofHash) {
    throw new Error("gate6_presentation_proof_root_invalid");
  }
  let gitProofTransport: "verified-pack" | "full-local-history";
  if (packEncoded) {
    const pack = Buffer.from(packEncoded, "base64url");
    if (
      pack.length < 1 ||
      pack.toString("base64url") !== packEncoded ||
      createHash("sha256").update(pack).digest("hex") !== proof.gitProofPackSha256
    ) {
      throw new Error("gate6_presentation_proof_root_invalid");
    }
    execFileSync("git", ["init", "-q"], { cwd: process.cwd() });
    const indexed = spawnSync("git", ["index-pack", "--stdin", "--fix-thin"], {
      cwd: process.cwd(),
      input: pack,
      maxBuffer: 1_048_576
    });
    if (indexed.status !== 0) {
      throw new Error("gate6_presentation_git_pack_invalid");
    }
    gitProofTransport = "verified-pack";
  } else {
    const measuredAvailable = spawnSync(
      "git",
      ["cat-file", "-e", `${proof.measuredV2Commit}^{commit}`],
      { cwd: process.cwd() }
    ).status;
    const presentationAvailable = spawnSync(
      "git",
      ["cat-file", "-e", `${proof.presentationCommit}^{commit}`],
      { cwd: process.cwd() }
    ).status;
    if (measuredAvailable !== 0 || presentationAvailable !== 0) {
      throw new Error("gate6_presentation_verified_git_objects_missing");
    }
    gitProofTransport = "full-local-history";
  }
  assertFirstParentAncestor(proof.measuredV2Commit, activeCommit);
  const actualChangedPaths = execFileSync(
    "git",
    [
      "diff",
      "--name-only",
      "--no-ext-diff",
      "--no-renames",
      proof.measuredV2Commit,
      activeCommit,
      "--"
    ],
    { cwd: process.cwd(), encoding: "utf8", maxBuffer: 1_048_576 }
  )
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();
  if (canonicalJson(actualChangedPaths) !== canonicalJson(proof.changedPaths)) {
    throw new Error("gate6_presentation_actual_diff_mismatch");
  }
  if (
    proof.measuredV2Commit !== measuredV2 ||
    proof.presentationCommit !== activeCommit ||
    process.env.TOOLPROOF_GATE5_PRESENTATION_COMMIT?.trim() !== activeCommit ||
    proof.baselineRawSha256 !==
      "edf0f0e3a2a3438be58a17e27594e57e6230f713c68501a3d26900cb731d7dfb" ||
    proof.revisedRawSha256 !== "26c436e38fecd8a128a0204af510556b3edf555ceeb421254d0248c0b23302fa"
  ) {
    throw new Error("gate6_presentation_proof_binding_invalid");
  }
  for (const file of proof.criticalFiles) {
    const bytes = await readFile(file.path);
    if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
      throw new Error(`gate6_presentation_critical_file_mismatch:${file.path}`);
    }
  }
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    readonly dependencies?: unknown;
    readonly devDependencies?: unknown;
    readonly engines?: unknown;
  };
  const dependencyHash = await dependencyProjectionHash({
    dependencies: packageJson.dependencies ?? null,
    devDependencies: packageJson.devDependencies ?? null,
    engines: packageJson.engines ?? null
  });
  if (dependencyHash !== proof.dependencyProjectionHash) {
    throw new Error("gate6_presentation_dependency_mismatch");
  }
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      mode: "gate6-presentation",
      status: "verified-terminal-reference-presentation",
      measuredV2Commit: proof.measuredV2Commit,
      presentationCommit: proof.presentationCommit,
      changedPathCount: proof.changedPaths.length,
      criticalFileCount: proof.criticalFiles.length,
      criticalProjectionHash: proof.criticalProjectionHash,
      dependencyProjectionHash: proof.dependencyProjectionHash,
      gitProofPackSha256: proof.gitProofPackSha256,
      gitProofTransport,
      proofHash: proof.proofHash
    })}\n`
  );
}
