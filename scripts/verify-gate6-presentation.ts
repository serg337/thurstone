import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { brotliDecompressSync } from "node:zlib";

import { canonicalJson } from "../lib/evidence/digest";
import {
  GATE6_PRESENTATION_PROOF_ENV,
  decodeGate6PresentationProof,
  dependencyProjectionHash
} from "../lib/results/presentation-proof";

const MAX_GIT_PACK_TRANSPORT_CHARACTERS = 60_000;
const MAX_EXPANDED_GIT_PACK_BYTES = 65_536;

function decodeGitProofPack(
  encoded: string,
  expectedSha256: string
): { readonly bytes: Buffer; readonly encoding: "raw" | "brotli" } {
  if (
    encoded.length < 1 ||
    encoded.length > MAX_GIT_PACK_TRANSPORT_CHARACTERS ||
    !/^[A-Za-z0-9_-]+$/u.test(encoded)
  ) {
    throw new Error("gate6_presentation_git_pack_encoding_invalid");
  }
  const transported = Buffer.from(encoded, "base64url");
  if (transported.toString("base64url") !== encoded) {
    throw new Error("gate6_presentation_git_pack_encoding_invalid");
  }
  const raw = transported.subarray(0, 4).toString("ascii") === "PACK";
  let bytes: Buffer;
  try {
    bytes = raw
      ? transported
      : brotliDecompressSync(transported, { maxOutputLength: MAX_EXPANDED_GIT_PACK_BYTES });
  } catch {
    throw new Error("gate6_presentation_git_pack_encoding_invalid");
  }
  if (
    bytes.length < 12 ||
    bytes.length > MAX_EXPANDED_GIT_PACK_BYTES ||
    bytes.subarray(0, 4).toString("ascii") !== "PACK" ||
    createHash("sha256").update(bytes).digest("hex") !== expectedSha256
  ) {
    throw new Error("gate6_presentation_proof_root_invalid");
  }
  return Object.freeze({ bytes, encoding: raw ? "raw" : "brotli" });
}

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
  let gitProofPackEncoding: "raw" | "brotli" | null = null;
  if (packEncoded) {
    const pack = decodeGitProofPack(packEncoded, proof.gitProofPackSha256);
    execFileSync("git", ["init", "-q"], { cwd: process.cwd() });
    const indexed = spawnSync("git", ["index-pack", "--stdin", "--fix-thin"], {
      cwd: process.cwd(),
      input: pack.bytes,
      maxBuffer: 1_048_576
    });
    if (indexed.status !== 0) {
      throw new Error("gate6_presentation_git_pack_invalid");
    }
    gitProofTransport = "verified-pack";
    gitProofPackEncoding = pack.encoding;
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
      gitProofPackEncoding,
      proofHash: proof.proofHash
    })}\n`
  );
}
