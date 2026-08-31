import "server-only";

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { brotliDecompressSync } from "node:zlib";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  JUDGE_DEMO_CI_TIMEOUT_COUNT,
  JUDGE_DEMO_CI_TIMEOUT_MS,
  JUDGE_DEMO_CI_TIMEOUT_PATH,
  JUDGE_DEMO_COLLATERAL_FIELD_PREFIXES,
  JUDGE_DEMO_CRITICAL_PATHS,
  JUDGE_DEMO_GATE9_CI_FINALIZATION_PATHS,
  JUDGE_DEMO_GATE9_CI_PORTABILITY_REPAIR_PATHS,
  JUDGE_DEMO_GATE9_COLLATERAL_PREPARATION_PATHS,
  JUDGE_DEMO_GATE9_PROTOCOL_FINALIZATION_PATHS,
  JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_FAILURE_EVIDENCE,
  JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_FAILURE_EVIDENCE_HASH,
  JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PATH,
  JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PREDECESSOR_COMMIT,
  JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PREDECESSOR_TEST_BLOB_OID,
  JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PREDECESSOR_TEST_BYTES,
  JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PREDECESSOR_TEST_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PREDECESSOR_TREE,
  JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_REPAIR_PATHS,
  JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_REPAIR_PATHS_HASH,
  JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_REPLACEMENTS,
  JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_REPLACEMENTS_HASH,
  JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_SUCCESSOR_TEST_BLOB_OID,
  JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_SUCCESSOR_TEST_BYTES,
  JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_SUCCESSOR_TEST_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_BLOB_OID,
  JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH,
  JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_FINAL_U_FILE_IDENTITIES,
  JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_BANNER_Q,
  JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_BANNER_U,
  JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_STATUS_Q,
  JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_STATUS_U,
  JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_CLIENT_IMPORT,
  JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_RETURN_Q,
  JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_RETURN_U,
  JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_RETURN_U_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_INVOCATION_HEADING_Q,
  JUDGE_DEMO_IMPACT_EXECUTION_INVOCATION_HEADING_U,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_MOUNT_ANCHOR,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_MOUNT_SNIPPET,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_MOUNT_SNIPPET_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_DIAGNOSTICS_MARKER,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_DIAGNOSTICS_SUMMARY,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_FULL_U_LENGTH,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_FULL_U_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_PORTAL_IMPORT,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_REACT_IMPORT_Q,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_REACT_IMPORT_U,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_REACT_IMPORT_U_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_RETURN_END_Q,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_RETURN_END_U,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_RETURN_START_Q,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_RETURN_START_U,
  JUDGE_DEMO_IMPACT_EXECUTION_LAB_CLIENT_IMPORT,
  JUDGE_DEMO_IMPACT_EXECUTION_LAB_CLIENT_U_BLOB_OID,
  JUDGE_DEMO_IMPACT_EXECUTION_LAB_CLIENT_U_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_LAB_RECEIPT_SELECTOR_COUNT,
  JUDGE_DEMO_IMPACT_EXECUTION_LAB_RECEIPT_SELECTOR_U,
  JUDGE_DEMO_IMPACT_EXECUTION_LAB_RETURN_Q,
  JUDGE_DEMO_IMPACT_EXECUTION_LAB_RETURN_U,
  JUDGE_DEMO_IMPACT_EXECUTION_LAB_RETURN_U_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_LAZY_HELPER_TEMPLATE,
  JUDGE_DEMO_IMPACT_EXECUTION_LAZY_HELPER_TEMPLATE_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_Q_MIXED_FILE_IDENTITIES,
  JUDGE_DEMO_IMPACT_EXECUTION_Q_ROUTE_IDENTITIES,
  JUDGE_DEMO_IMPACT_EXECUTION_Q_TEST_FILE_IDENTITIES,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_TEMPLATE,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_TEMPLATE_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_IMPORT_Q,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_IMPORT_U,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_RENDER,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_USAGE,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_COMPACT_END,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_COMPACT_START,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_COMPACT_BLOCK_TEMPLATE,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_COMPACT_BLOCK_TEMPLATE_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_COMPONENT_IMPORT_Q,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_COMPONENT_IMPORT_U,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_FUNCTION_Q,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_FUNCTION_U,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_FULL_QUERY,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_FULL_BRANCH,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_INVOCATION_ARTIFACT_IMPORT,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_INVOCATION_COMPONENT_IMPORT,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_SEMANTIC_ARTIFACT_IMPORT,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_SUMMARY_CALL,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_VIEW_SWITCH,
  JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_CLIENT_IMPORT,
  JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_PREFIX_LENGTH,
  JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_PREFIX_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_PRESENTATION_MARKER,
  JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_RETURN_Q,
  JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_RETURN_U,
  JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_RETURN_U_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_SUMMARY_TEMPLATE,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_SUMMARY_TEMPLATE_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_SESSION_SEGMENTS,
  JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_END,
  JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_START,
  JUDGE_DEMO_IMPACT_EXECUTION_TEST_REPLACEMENTS,
  JUDGE_DEMO_IMPACT_EXECUTION_TEST_REPLACEMENTS_HASH,
  JUDGE_DEMO_IMPACT_EXECUTION_U_PATCH_BROTLI_BASE64URL,
  JUDGE_DEMO_IMPACT_EXECUTION_U_PATCH_BROTLI_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_U_PATCH_RAW_BYTES,
  JUDGE_DEMO_IMPACT_EXECUTION_U_PATCH_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_U_PRESENTATION_PROJECTION_TREE,
  JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS,
  JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS_HASH,
  JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS,
  JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS_HASH,
  JUDGE_DEMO_ORIGIN_ALIAS_IMPLEMENTATION_PATHS,
  JUDGE_DEMO_ORIGIN_ALIAS_IMPLEMENTATION_PATHS_HASH,
  JUDGE_DEMO_ORIGIN_ALIAS_CHECKOUT_REPAIR_PATHS,
  JUDGE_DEMO_ORIGIN_ALIAS_CHECKOUT_REPAIR_PATHS_HASH,
  JUDGE_DEMO_ORIGIN_ALIAS_PREDECESSOR_COMMIT,
  JUDGE_DEMO_ORIGIN_ALIAS_PREDECESSOR_TREE,
  JUDGE_DEMO_ORIGIN_ALIAS_PROTOCOL_PATHS,
  JUDGE_DEMO_ORIGIN_ALIAS_PROTOCOL_PATHS_HASH,
  JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_COMMIT,
  JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_PATH,
  JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_SHA256,
  JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_TREE,
  JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_ALLOWED_PATHS,
  JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_PROTOCOL_PATHS,
  JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_REQUIRED_PATHS,
  JUDGE_DEMO_INVOCATION_INTEGRITY_IMPLEMENTATION_ALLOWED_PATHS,
  JUDGE_DEMO_INVOCATION_INTEGRITY_IMPLEMENTATION_REQUIRED_PATHS,
  JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_COMMIT,
  JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_BINDING_ARTIFACT_SHA256,
  JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_BINDING_HASH,
  JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_ENVELOPE_HASH,
  JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_REBRAND_PROOF_HASH,
  JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_TREE,
  JUDGE_DEMO_INVOCATION_INTEGRITY_PRESERVED_SEMANTIC_ARTIFACTS,
  JUDGE_DEMO_INVOCATION_INTEGRITY_PRIOR_PROTOCOL_COMMITS,
  JUDGE_DEMO_INVOCATION_INTEGRITY_PROTOCOL_PATHS,
  JUDGE_DEMO_INVOCATION_INTEGRITY_SEALED_EVIDENCE_BUILD,
  JUDGE_DEMO_REBRAND_BRANDING_PATHS,
  JUDGE_DEMO_REBRAND_PREDECESSOR_BINDING_HASH,
  JUDGE_DEMO_REBRAND_PREDECESSOR_COMMIT,
  JUDGE_DEMO_REBRAND_PREDECESSOR_TRANSITION_PROOF_HASH,
  JUDGE_DEMO_REBRAND_PREDECESSOR_TREE,
  JUDGE_DEMO_REBRAND_PRESERVED_ARTIFACTS,
  JUDGE_DEMO_REBRAND_PROTOCOL_PATHS,
  JUDGE_DEMO_RECOVERY_CI_FINALIZATION_COMMIT,
  JUDGE_DEMO_RECOVERY_CI_FINALIZATION_PATHS,
  JUDGE_DEMO_RECOVERY_CI_FINALIZATION_TREE,
  JUDGE_DEMO_RECOVERY_FINALIZATION_PATHS,
  JUDGE_DEMO_RECOVERY_IMPLEMENTATION_COMMIT,
  JUDGE_DEMO_RECOVERY_IMPLEMENTATION_TREE,
  JUDGE_DEMO_RECOVERY_PATHS,
  JUDGE_DEMO_TRUTH_STATUS_FINALIZATION_PATHS,
  judgeDemoInvocationIntegrityEvidencePathCompare,
  type JudgeDemoCollateralField,
  type JudgeDemoInvocationIntegrityEvidenceTransition,
  type JudgeDemoInvocationIntegrityTransition,
  type JudgeDemoPresentationTransition,
  type JudgeDemoRebrandTransition
} from "@/lib/judge/collateral-proof";
import type { JudgeDemoPresentationBinding } from "@/lib/judge/presentation-binding.server";
import { PROBE_PRODUCTION_ORIGIN } from "@/lib/probe/policy";
import { dependencyProjectionHash } from "@/lib/results/presentation-proof";

const MAX_GIT_BYTES = 8_388_608;
const ZERO_OID = "0".repeat(40);
const DEPLOYMENT_EXCLUDED_CONFIG_PATHS = new Set([
  "eslint.config.mjs",
  "playwright.config.ts",
  "tsconfig.typecheck.json",
  "vitest.config.ts"
]);

interface GitTreeEntry {
  readonly mode: string;
  readonly blobOid: string;
}

interface GitTreeChange {
  readonly path: string;
  readonly status: "A" | "D" | "M" | "T";
  readonly predecessorMode: string | null;
  readonly successorMode: string | null;
  readonly predecessorBlobOid: string | null;
  readonly successorBlobOid: string | null;
}

interface CriticalTreeEntry {
  readonly path: string;
  readonly predecessorBlobOid: string;
  readonly successorBlobOid: string;
}

interface VerifiedTransitionGit {
  readonly transition: JudgeDemoPresentationTransition;
  readonly treeChanges: readonly GitTreeChange[];
  readonly criticalEntries: readonly CriticalTreeEntry[];
}

export function judgeDemoPathExcludedFromDeployment(path: string): boolean {
  return (
    path.startsWith(".env") ||
    path === ".gitignore" ||
    path.startsWith(".github/") ||
    DEPLOYMENT_EXCLUDED_CONFIG_PATHS.has(path)
  );
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function impactExecutionProspectivePatch(): Buffer {
  const compressed = Buffer.from(JUDGE_DEMO_IMPACT_EXECUTION_U_PATCH_BROTLI_BASE64URL, "base64url");
  if (sha256(compressed) !== JUDGE_DEMO_IMPACT_EXECUTION_U_PATCH_BROTLI_SHA256) {
    throw new Error("judge_demo_impact_execution_patch_transport_invalid");
  }
  const patch = brotliDecompressSync(compressed);
  if (
    patch.length !== JUDGE_DEMO_IMPACT_EXECUTION_U_PATCH_RAW_BYTES ||
    sha256(patch) !== JUDGE_DEMO_IMPACT_EXECUTION_U_PATCH_SHA256
  ) {
    throw new Error("judge_demo_impact_execution_patch_invalid");
  }
  return patch;
}

function impactExecutionGitPatch(input: {
  readonly cwd: string;
  readonly predecessorCommit: string;
  readonly successorCommit: string;
}): Buffer | null {
  const result = spawnSync(
    "git",
    [
      "diff",
      "--binary",
      "--full-index",
      input.predecessorCommit,
      input.successorCommit,
      "--",
      ...JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS
    ],
    { cwd: input.cwd, encoding: null, maxBuffer: 4_194_304 }
  );
  return result.status === 0 && Buffer.isBuffer(result.stdout) ? result.stdout : null;
}

const ORIGIN_ALIAS_SHELL_CANONICAL_BLOCK = `  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://thurstone.invarra.ai"
  );
`;
const ORIGIN_ALIAS_SHELL_REQUEST_BLOCK = `  const brandedOrigin = await request.post("/api/probe/issue", {
    headers: { ...headers, Origin: "https://thurstone.invarra.ai" },
    data: {}
  });
  expect(brandedOrigin.status()).toBe(503);
  await expect(brandedOrigin.json()).resolves.toEqual({
    error: "probe_disabled",
    inferencePerformed: false
  });

`;

async function historicalImpactCheckoutBytes(input: {
  readonly cwd: string;
  readonly commit: string;
  readonly path: string;
}): Promise<Buffer | null> {
  const available = availableGitBlobBytes(input.cwd, input.commit, input.path);
  if (available !== null) return available;
  if (input.path !== "tests/browser/shell.spec.ts") return null;
  const current = await readFile(join(input.cwd, input.path), "utf8");
  if (
    current.split(ORIGIN_ALIAS_SHELL_CANONICAL_BLOCK).length !== 2 ||
    current.split(ORIGIN_ALIAS_SHELL_REQUEST_BLOCK).length !== 2
  ) {
    throw new Error("judge_demo_origin_alias_shell_projection_invalid");
  }
  const reconstructed = Buffer.from(
    current
      .replace(ORIGIN_ALIAS_SHELL_CANONICAL_BLOCK, "")
      .replace(ORIGIN_ALIAS_SHELL_REQUEST_BLOCK, "")
  );
  const expected = treeEntry(input.cwd, input.commit, input.path);
  if (expected?.mode !== "100644" || expected.blobOid !== blobOid(reconstructed)) {
    throw new Error("judge_demo_origin_alias_shell_reconstruction_invalid");
  }
  return reconstructed;
}

function blobOid(bytes: Buffer): string {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

async function verifyImpactExecutionPatchEffect(input: {
  readonly cwd: string;
  readonly predecessorCommit: string;
  readonly successorCommit: string;
  readonly expectedPatch: Buffer;
  readonly historicalCheckoutPaths?: readonly string[];
}): Promise<"git-diff" | "reverse-reconstruction"> {
  const actualPatch = impactExecutionGitPatch(input);
  if (actualPatch !== null) {
    if (!actualPatch.equals(input.expectedPatch)) {
      throw new Error("judge_demo_impact_execution_patch_checkout_invalid");
    }
    return "git-diff";
  }

  const directory = await mkdtemp(join(tmpdir(), "thurstone-impact-patch-"));
  try {
    for (const path of JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS) {
      const bytes = input.historicalCheckoutPaths?.includes(path)
        ? await historicalImpactCheckoutBytes({
            cwd: input.cwd,
            commit: input.successorCommit,
            path
          })
        : await activeCheckoutBlobBytes(input.cwd, input.successorCommit, path);
      if (bytes === null) {
        throw new Error(`judge_demo_impact_execution_patch_blob_missing:${path}`);
      }
      const target = join(directory, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, { mode: 0o600 });
    }
    const environment = { ...process.env };
    delete environment.GIT_DIR;
    delete environment.GIT_WORK_TREE;
    const reversed = spawnSync(
      "git",
      ["apply", "--no-index", "--reverse", "--binary", "--whitespace=nowarn", "-"],
      {
        cwd: directory,
        env: environment,
        input: input.expectedPatch,
        encoding: null,
        maxBuffer: 4_194_304
      }
    );
    if (reversed.status !== 0) {
      throw new Error("judge_demo_impact_execution_patch_reconstruction_failed");
    }
    for (const path of JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS) {
      const predecessorEntry = treeEntry(input.cwd, input.predecessorCommit, path);
      const reconstructed = await readFile(join(directory, path));
      if (
        predecessorEntry?.mode !== "100644" ||
        predecessorEntry.blobOid !== blobOid(reconstructed)
      ) {
        throw new Error(`judge_demo_impact_execution_patch_reconstruction_invalid:${path}`);
      }
    }
    return "reverse-reconstruction";
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

interface ProjectedGitTreeNode {
  readonly files: Map<string, GitTreeEntry>;
  readonly directories: Map<string, ProjectedGitTreeNode>;
}

function projectedGitTreeOid(entries: ReadonlyMap<string, GitTreeEntry>): string {
  const root: ProjectedGitTreeNode = {
    files: new Map(),
    directories: new Map()
  };
  for (const [path, entry] of entries) {
    const segments = path.split("/");
    const filename = segments.pop();
    if (!filename || segments.some((segment) => segment.length === 0)) {
      throw new Error("judge_demo_impact_execution_projected_tree_path_invalid");
    }
    let directory = root;
    for (const segment of segments) {
      let child = directory.directories.get(segment);
      if (!child) {
        child = { files: new Map(), directories: new Map() };
        directory.directories.set(segment, child);
      }
      directory = child;
    }
    directory.files.set(filename, entry);
  }

  const hashTree = (directory: ProjectedGitTreeNode): string => {
    const children = [
      ...[...directory.files].map(([name, entry]) => ({
        name,
        mode: entry.mode,
        oid: entry.blobOid,
        directory: false
      })),
      ...[...directory.directories].map(([name, child]) => ({
        name,
        mode: "40000",
        oid: hashTree(child),
        directory: true
      }))
    ].sort((left, right) =>
      Buffer.compare(
        Buffer.from(`${left.name}${left.directory ? "/" : ""}`, "utf8"),
        Buffer.from(`${right.name}${right.directory ? "/" : ""}`, "utf8")
      )
    );
    const body = Buffer.concat(
      children.flatMap((child) => [
        Buffer.from(`${child.mode} ${child.name}\0`, "utf8"),
        Buffer.from(child.oid, "hex")
      ])
    );
    return createHash("sha1").update(`tree ${body.length}\0`).update(body).digest("hex");
  };

  return hashTree(root);
}

function impactExecutionPresentationProjectionTree(input: {
  readonly cwd: string;
  readonly predecessorCommit: string;
  readonly successorCommit: string;
}): string {
  const result = spawnSync("git", ["ls-tree", "-r", "-z", "--full-tree", input.predecessorCommit], {
    cwd: input.cwd,
    encoding: null,
    maxBuffer: MAX_GIT_BYTES
  });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new Error("judge_demo_impact_execution_projected_tree_unavailable");
  }
  const source = new TextDecoder("utf-8", { fatal: true }).decode(result.stdout);
  const entries = new Map<string, GitTreeEntry>();
  for (const record of source.split("\0")) {
    if (record.length === 0) continue;
    const match = /^([0-7]{6}) (?:blob|commit) ([a-f0-9]{40})\t(.+)$/u.exec(record);
    if (!match) throw new Error("judge_demo_impact_execution_projected_tree_entry_invalid");
    entries.set(match[3]!, { mode: match[1]!, blobOid: match[2]! });
  }
  for (const path of JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS) {
    const entry = treeEntry(input.cwd, input.successorCommit, path);
    if (entry?.mode !== "100644") {
      throw new Error(`judge_demo_impact_execution_projected_tree_entry_invalid:${path}`);
    }
    entries.set(path, entry);
  }
  return projectedGitTreeOid(entries);
}

function treeEntry(cwd: string, commit: string, path: string): GitTreeEntry | null {
  const result = spawnSync("git", ["ls-tree", "-z", commit, "--", path], {
    cwd,
    encoding: null,
    maxBuffer: 1_048_576
  });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new Error(`judge_demo_presentation_git_tree_unavailable:${commit}:${path}`);
  }
  if (result.stdout.length === 0) return null;
  const text = new TextDecoder("utf-8", { fatal: true }).decode(result.stdout);
  const match = /^([0-7]{6}) blob ([a-f0-9]{40})\t([^\0]+)\0$/u.exec(text);
  if (!match || match[3] !== path) {
    throw new Error(`judge_demo_presentation_git_tree_entry_invalid:${path}`);
  }
  return Object.freeze({ mode: match[1]!, blobOid: match[2]! });
}

function gitBlobBytes(cwd: string, commit: string, path: string): Buffer | null {
  if (treeEntry(cwd, commit, path) === null) return null;
  const result = spawnSync("git", ["show", `${commit}:${path}`], {
    cwd,
    encoding: null,
    maxBuffer: MAX_GIT_BYTES
  });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new Error(`judge_demo_presentation_referenced_blob_missing:${commit}:${path}`);
  }
  return result.stdout;
}

/**
 * Returns historical bytes when the object store contains them. A transport-only checkout may
 * intentionally retain the exact commit/tree/blob identity without carrying that historical blob;
 * callers must still require a separately frozen digest and verify the bytes in the full source
 * repository before producing the transport.
 */
function availableGitBlobBytes(cwd: string, commit: string, path: string): Buffer | null {
  const entry = treeEntry(cwd, commit, path);
  if (entry === null) return null;
  const available = spawnSync("git", ["cat-file", "-e", `${entry.blobOid}^{blob}`], {
    cwd,
    encoding: null,
    maxBuffer: 1_048_576
  });
  return available.status === 0 ? gitBlobBytes(cwd, commit, path) : null;
}

/** Bind an active regular checkout file to the blob OID named by a transported Git tree. */
async function activeCheckoutBlobBytes(cwd: string, commit: string, path: string): Promise<Buffer> {
  const [expected, actual] = await Promise.all([
    Promise.resolve(treeEntry(cwd, commit, path)),
    checkoutEntry(cwd, path)
  ]);
  if (
    expected === null ||
    actual === null ||
    expected.mode !== "100644" ||
    actual.mode !== "100644" ||
    expected.blobOid !== blobOid(actual.bytes)
  ) {
    throw new Error(`judge_demo_presentation_active_checkout_mismatch:${path}`);
  }
  return actual.bytes;
}

function firstParentCommitChain(cwd: string, ancestor: string, descendant: string): string[] {
  const reversed = [descendant];
  let cursor = descendant;
  for (let depth = 0; depth < 64; depth += 1) {
    if (cursor === ancestor) return reversed.reverse();
    const result = spawnSync("git", ["cat-file", "-p", cursor], {
      cwd,
      encoding: "utf8",
      maxBuffer: 1_048_576
    });
    if (result.status !== 0) {
      throw new Error("judge_demo_presentation_commit_object_missing");
    }
    const parents = result.stdout
      .split(/\r?\n/u)
      .flatMap((line) => (/^parent ([a-f0-9]{40})$/u.exec(line)?.[1] ? [line.slice(7)] : []));
    if (parents.length !== 1) {
      throw new Error("judge_demo_presentation_non_linear_ancestry");
    }
    cursor = parents[0]!;
    reversed.push(cursor);
  }
  throw new Error("judge_demo_presentation_ancestry_depth_exceeded");
}

function replaceCollateralFieldLineExactlyOnce(input: {
  readonly source: string;
  readonly field: JudgeDemoCollateralField;
  readonly predecessorValue: string | null;
  readonly successorValue: string;
  readonly direction?: "forward" | "reverse";
}): string {
  if (input.predecessorValue === null) {
    throw new Error("judge_demo_presentation_collateral_predecessor_field_missing");
  }
  const prefix = JUDGE_DEMO_COLLATERAL_FIELD_PREFIXES[input.field];
  const predecessorLine = `${prefix}${input.predecessorValue}`;
  const successorLine = `${prefix}${input.successorValue}`;
  const sourceLine = input.direction === "reverse" ? successorLine : predecessorLine;
  const replacementLine = input.direction === "reverse" ? predecessorLine : successorLine;
  const lines = input.source.split("\n");
  const indexes = lines.flatMap((line, index) => (line === sourceLine ? [index] : []));
  if (indexes.length !== 1) {
    if (input.direction === "reverse") {
      throw new Error("judge_demo_presentation_non_link_change");
    }
    throw new Error("judge_demo_presentation_collateral_field_not_exactly_once");
  }
  lines[indexes[0]!] = replacementLine;
  return lines.join("\n");
}

function gitTreeChanges(
  cwd: string,
  predecessorCommit: string,
  successorCommit: string
): readonly GitTreeChange[] {
  const result = spawnSync(
    "git",
    [
      "diff-tree",
      "--raw",
      "-r",
      "--no-renames",
      "--no-commit-id",
      "--abbrev=40",
      predecessorCommit,
      successorCommit,
      "--"
    ],
    { cwd, encoding: "utf8", maxBuffer: 1_048_576 }
  );
  if (result.status !== 0) throw new Error("judge_demo_presentation_git_tree_diff_unavailable");
  return result.stdout
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      const match = /^:([0-7]{6}) ([0-7]{6}) ([a-f0-9]{40}) ([a-f0-9]{40}) ([ADMT])\t(.+)$/u.exec(
        line
      );
      if (!match) throw new Error("judge_demo_presentation_git_tree_diff_invalid");
      return {
        path: match[6]!,
        status: match[5]! as "A" | "D" | "M" | "T",
        predecessorMode: match[1] === "000000" ? null : match[1]!,
        successorMode: match[2] === "000000" ? null : match[2]!,
        predecessorBlobOid: match[3] === ZERO_OID ? null : match[3]!,
        successorBlobOid: match[4] === ZERO_OID ? null : match[4]!
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function commitTree(cwd: string, commit: string): string {
  const result = spawnSync("git", ["rev-parse", "--verify", `${commit}^{tree}`], {
    cwd,
    encoding: "utf8",
    maxBuffer: 1_048_576
  });
  if (result.status !== 0 || !/^[a-f0-9]{40}\n?$/u.test(result.stdout)) {
    throw new Error("judge_demo_presentation_git_tree_unavailable");
  }
  return result.stdout.trim();
}

function commitHeaderTree(cwd: string, commit: string): string {
  const result = spawnSync("git", ["cat-file", "-p", commit], {
    cwd,
    encoding: "utf8",
    maxBuffer: 1_048_576
  });
  const tree = /^tree ([a-f0-9]{40})$/mu.exec(result.stdout)?.[1];
  if (result.status !== 0 || !tree) {
    throw new Error("judge_demo_presentation_commit_tree_header_unavailable");
  }
  return tree;
}

async function verifyRecoveryFinalization(input: {
  readonly cwd: string;
  readonly transition: Extract<
    JudgeDemoPresentationTransition,
    { kind: "sealed-reader-compatibility-recovery" }
  >;
  readonly firstParentChain: readonly string[];
  readonly terminalActiveCommit: string;
  readonly predecessorBindingAnchored: boolean;
}): Promise<void> {
  const validation = input.transition.recoveryContract.ciTimeoutValidation ?? null;
  if (validation === null) {
    if (input.firstParentChain.length !== 2) {
      throw new Error("judge_demo_presentation_transition_not_direct_child");
    }
    return;
  }
  const truthStatus = validation.truthStatusFinalization ?? null;
  const expectedChain =
    truthStatus === null
      ? [
          input.transition.predecessorCommit,
          JUDGE_DEMO_RECOVERY_IMPLEMENTATION_COMMIT,
          JUDGE_DEMO_RECOVERY_CI_FINALIZATION_COMMIT
        ]
      : [
          input.transition.predecessorCommit,
          JUDGE_DEMO_RECOVERY_IMPLEMENTATION_COMMIT,
          JUDGE_DEMO_RECOVERY_CI_FINALIZATION_COMMIT,
          input.transition.successorCommit
        ];
  if (
    canonicalJson(input.firstParentChain) !== canonicalJson(expectedChain) ||
    validation.implementationCommit !== JUDGE_DEMO_RECOVERY_IMPLEMENTATION_COMMIT ||
    validation.implementationTree !== JUDGE_DEMO_RECOVERY_IMPLEMENTATION_TREE ||
    commitTree(input.cwd, validation.implementationCommit) !== validation.implementationTree ||
    validation.activeCommit !== input.transition.successorCommit ||
    commitTree(input.cwd, validation.activeCommit) !== validation.activeTree ||
    (truthStatus === null
      ? validation.activeCommit !== JUDGE_DEMO_RECOVERY_CI_FINALIZATION_COMMIT ||
        validation.activeTree !== JUDGE_DEMO_RECOVERY_CI_FINALIZATION_TREE
      : truthStatus.predecessorCommit !== JUDGE_DEMO_RECOVERY_CI_FINALIZATION_COMMIT ||
        truthStatus.predecessorTree !== JUDGE_DEMO_RECOVERY_CI_FINALIZATION_TREE ||
        commitTree(input.cwd, truthStatus.predecessorCommit) !== truthStatus.predecessorTree ||
        truthStatus.activeCommit !== validation.activeCommit ||
        truthStatus.activeTree !== validation.activeTree)
  ) {
    throw new Error("judge_demo_presentation_recovery_finalization_identity_invalid");
  }

  const actualChanges = gitTreeChanges(
    input.cwd,
    validation.implementationCommit,
    validation.activeCommit
  );
  const actualPaths = actualChanges.map(({ path }) => path);
  const expectedFinalizationPaths =
    truthStatus === null
      ? JUDGE_DEMO_RECOVERY_CI_FINALIZATION_PATHS
      : JUDGE_DEMO_RECOVERY_FINALIZATION_PATHS;
  if (
    canonicalJson(actualPaths) !== canonicalJson(expectedFinalizationPaths) ||
    canonicalJson(validation.changedPaths) !== canonicalJson(actualPaths) ||
    canonicalJson(validation.treeChanges) !== canonicalJson(actualChanges) ||
    (await canonicalSha256(actualChanges)) !== validation.gitTreeProjectionHash
  ) {
    throw new Error("judge_demo_presentation_recovery_finalization_tree_invalid");
  }

  if (truthStatus !== null) {
    const truthStatusChanges = gitTreeChanges(
      input.cwd,
      truthStatus.predecessorCommit,
      truthStatus.activeCommit
    );
    if (
      canonicalJson(truthStatusChanges.map(({ path }) => path)) !==
        canonicalJson(JUDGE_DEMO_TRUTH_STATUS_FINALIZATION_PATHS) ||
      canonicalJson(truthStatus.changedPaths) !==
        canonicalJson(JUDGE_DEMO_TRUTH_STATUS_FINALIZATION_PATHS) ||
      canonicalJson(truthStatus.treeChanges) !== canonicalJson(truthStatusChanges) ||
      (await canonicalSha256(truthStatusChanges)) !== truthStatus.gitTreeProjectionHash
    ) {
      throw new Error("judge_demo_presentation_truth_status_tree_invalid");
    }
    if (!input.predecessorBindingAnchored) {
      const expectedReadme = treeEntry(input.cwd, input.terminalActiveCommit, "README.md");
      const checkedOutReadme = await checkoutEntry(input.cwd, "README.md");
      if (
        expectedReadme === null ||
        checkedOutReadme === null ||
        expectedReadme.mode !== checkedOutReadme.mode ||
        expectedReadme.blobOid !== blobOid(checkedOutReadme.bytes)
      ) {
        throw new Error("judge_demo_presentation_truth_status_readme_checkout_invalid");
      }
      const readme = new TextDecoder("utf-8", { fatal: true }).decode(checkedOutReadme.bytes);
      if (
        !readme.includes(truthStatus.expectedReadmeSentence) ||
        readme.includes(truthStatus.forbiddenReadmePhrase)
      ) {
        throw new Error("judge_demo_presentation_truth_status_readme_invalid");
      }
    }
  }

  if (!input.predecessorBindingAnchored) {
    const expectedTest = treeEntry(input.cwd, validation.activeCommit, JUDGE_DEMO_CI_TIMEOUT_PATH);
    const checkedOutTest = await checkoutEntry(input.cwd, JUDGE_DEMO_CI_TIMEOUT_PATH);
    if (
      expectedTest === null ||
      checkedOutTest === null ||
      expectedTest.mode !== checkedOutTest.mode ||
      expectedTest.blobOid !== blobOid(checkedOutTest.bytes)
    ) {
      throw new Error("judge_demo_presentation_recovery_finalization_test_missing");
    }
    const testSource = new TextDecoder("utf-8", { fatal: true }).decode(checkedOutTest.bytes);
    const timeoutCount = testSource.match(/\}, 20_000\);/gu)?.length ?? 0;
    const exactImpactExecutionCiTimeoutRepairSource =
      checkedOutTest.bytes.byteLength ===
        JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_SUCCESSOR_TEST_BYTES &&
      blobOid(checkedOutTest.bytes) ===
        JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_SUCCESSOR_TEST_BLOB_OID &&
      sha256(checkedOutTest.bytes) === JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_SUCCESSOR_TEST_SHA256;
    const originAliasProtocolSource = [
      "JUDGE_DEMO_ORIGIN_ALIAS_FINALIZATION_VERSION",
      "JUDGE_DEMO_ORIGIN_ALIAS_PROTOCOL_PATHS_HASH",
      "JUDGE_DEMO_ORIGIN_ALIAS_IMPLEMENTATION_PATHS_HASH",
      "test_origin_alias_impact_finalization_missing"
    ].every((marker) => occurrenceCount(testSource, marker) >= 1);
    if (
      validation.timeoutPath !== JUDGE_DEMO_CI_TIMEOUT_PATH ||
      validation.timeoutMs !== JUDGE_DEMO_CI_TIMEOUT_MS ||
      validation.timeoutCount !== JUDGE_DEMO_CI_TIMEOUT_COUNT ||
      timeoutCount !==
        (exactImpactExecutionCiTimeoutRepairSource || originAliasProtocolSource
          ? JUDGE_DEMO_CI_TIMEOUT_COUNT - 1
          : JUDGE_DEMO_CI_TIMEOUT_COUNT)
    ) {
      throw new Error("judge_demo_presentation_recovery_finalization_timeout_invalid");
    }
  }
}

async function verifyCollateralChanges(
  cwd: string,
  transition: Extract<JudgeDemoPresentationTransition, { kind: "collateral-links" }>,
  activeCommit: string
): Promise<void> {
  if (transition.successorCommit !== activeCommit) {
    throw new Error("judge_demo_presentation_collateral_not_terminal");
  }
  const changedPaths = [...new Set(transition.collateralChanges.map(({ path }) => path))].sort();
  for (const path of changedPaths) {
    const [predecessorEntry, successorEntry, successorCheckout] = await Promise.all([
      Promise.resolve(treeEntry(cwd, transition.predecessorCommit, path)),
      Promise.resolve(treeEntry(cwd, transition.successorCommit, path)),
      checkoutEntry(cwd, path)
    ]);
    if (predecessorEntry === null || predecessorEntry.mode !== "100644") {
      throw new Error("judge_demo_presentation_collateral_predecessor_missing");
    }
    if (
      successorEntry === null ||
      successorEntry.mode !== "100644" ||
      successorCheckout === null ||
      successorCheckout.mode !== "100644"
    ) {
      throw new Error("judge_demo_presentation_collateral_successor_missing");
    }
    if (successorEntry.blobOid !== blobOid(successorCheckout.bytes)) {
      throw new Error("judge_demo_presentation_non_link_change");
    }
    const successorSource = new TextDecoder("utf-8", { fatal: true }).decode(
      successorCheckout.bytes
    );
    const changes = transition.collateralChanges.filter(
      ({ path: candidate }) => candidate === path
    );
    let reconstructedPredecessor = successorSource;
    for (const change of [...changes].reverse()) {
      reconstructedPredecessor = replaceCollateralFieldLineExactlyOnce({
        source: reconstructedPredecessor,
        field: change.field,
        predecessorValue: change.predecessorValue,
        successorValue: change.successorValue,
        direction: "reverse"
      });
    }
    const reconstructedBytes = Buffer.from(reconstructedPredecessor, "utf8");
    if (blobOid(reconstructedBytes) !== predecessorEntry.blobOid) {
      throw new Error("judge_demo_presentation_non_link_change");
    }
    let expectedSuccessor = reconstructedPredecessor;
    for (const change of changes) {
      expectedSuccessor = replaceCollateralFieldLineExactlyOnce({
        source: expectedSuccessor,
        field: change.field,
        predecessorValue: change.predecessorValue,
        successorValue: change.successorValue
      });
    }
    if (!successorCheckout.bytes.equals(Buffer.from(expectedSuccessor, "utf8"))) {
      throw new Error("judge_demo_presentation_non_link_change");
    }
  }
}

function assertExpectedTreeMutation(
  change: GitTreeChange,
  input: { readonly added: boolean }
): void {
  const expected = input.added
    ? change.status === "A" &&
      change.predecessorMode === null &&
      change.predecessorBlobOid === null &&
      change.successorMode === "100644" &&
      change.successorBlobOid !== null
    : change.status === "M" &&
      change.predecessorMode === "100644" &&
      change.successorMode === "100644" &&
      change.predecessorBlobOid !== null &&
      change.successorBlobOid !== null;
  if (!expected) throw new Error(`judge_demo_rebrand_tree_mode_invalid:${change.path}`);
}

async function verifyPresentationRebrand(input: {
  readonly cwd: string;
  readonly transition: JudgeDemoRebrandTransition;
  readonly firstParentChain: readonly string[];
  readonly terminalActiveCommit: string;
}): Promise<void> {
  const protocolCommit = input.transition.protocolExtension.commit;
  const expectedChain = [
    JUDGE_DEMO_REBRAND_PREDECESSOR_COMMIT,
    protocolCommit,
    input.transition.successorCommit
  ];
  if (
    canonicalJson(input.firstParentChain) !== canonicalJson(expectedChain) ||
    commitTree(input.cwd, JUDGE_DEMO_REBRAND_PREDECESSOR_COMMIT) !==
      JUDGE_DEMO_REBRAND_PREDECESSOR_TREE ||
    commitTree(input.cwd, protocolCommit) !== input.transition.protocolExtension.tree ||
    commitTree(input.cwd, input.transition.successorCommit) !== input.transition.branding.tree
  ) {
    throw new Error("judge_demo_rebrand_chain_invalid");
  }

  const protocolChanges = gitTreeChanges(
    input.cwd,
    JUDGE_DEMO_REBRAND_PREDECESSOR_COMMIT,
    protocolCommit
  );
  const brandingChanges = gitTreeChanges(
    input.cwd,
    protocolCommit,
    input.transition.successorCommit
  );
  if (
    canonicalJson(protocolChanges.map(({ path }) => path)) !==
      canonicalJson(JUDGE_DEMO_REBRAND_PROTOCOL_PATHS) ||
    canonicalJson(protocolChanges) !==
      canonicalJson(input.transition.protocolExtension.treeChanges) ||
    (await canonicalSha256(protocolChanges)) !==
      input.transition.protocolExtension.gitTreeProjectionHash ||
    canonicalJson(brandingChanges.map(({ path }) => path)) !==
      canonicalJson(JUDGE_DEMO_REBRAND_BRANDING_PATHS) ||
    canonicalJson(brandingChanges) !== canonicalJson(input.transition.branding.treeChanges) ||
    (await canonicalSha256(brandingChanges)) !== input.transition.branding.gitTreeProjectionHash
  ) {
    throw new Error("judge_demo_rebrand_step_projection_invalid");
  }
  for (const change of protocolChanges) assertExpectedTreeMutation(change, { added: false });
  for (const change of brandingChanges) {
    assertExpectedTreeMutation(change, {
      added: ["lib/brand.ts", "public/thurstone-results.jpg"].includes(change.path)
    });
  }

  const brandingFiles = await Promise.all(
    input.transition.branding.files.map(async ({ path }) => {
      const referencedEntry = treeEntry(input.cwd, input.transition.successorCommit, path);
      const terminalEntry = treeEntry(input.cwd, input.terminalActiveCommit, path);
      const useActiveCheckout =
        !judgeDemoPathExcludedFromDeployment(path) &&
        referencedEntry !== null &&
        terminalEntry !== null &&
        referencedEntry.mode === terminalEntry.mode &&
        referencedEntry.blobOid === terminalEntry.blobOid;
      const bytes = useActiveCheckout
        ? await activeCheckoutBlobBytes(input.cwd, input.terminalActiveCommit, path)
        : gitBlobBytes(input.cwd, input.transition.successorCommit, path);
      if (!bytes) throw new Error(`judge_demo_rebrand_branding_file_missing:${path}`);
      return { path, sha256: sha256(bytes) };
    })
  );
  if (
    canonicalJson(brandingFiles) !== canonicalJson(input.transition.branding.files) ||
    (await canonicalSha256(brandingFiles)) !== input.transition.branding.filesProjectionHash
  ) {
    throw new Error("judge_demo_rebrand_branding_projection_invalid");
  }

  const brandSource = await readFile(`${input.cwd}/lib/brand.ts`, "utf8");
  if (
    !brandSource.includes('PRODUCT_NAME = "Thurstone"') ||
    !brandSource.includes(
      'PRODUCT_BYLINE = "Thurstone by Invarra — created by Sergio Valencia."'
    ) ||
    !brandSource.includes('LEGACY_PROTOCOL_NAMESPACE = "toolproof"')
  ) {
    throw new Error("judge_demo_rebrand_brand_contract_invalid");
  }
  const packageJson = JSON.parse(await readFile(`${input.cwd}/package.json`, "utf8")) as {
    readonly name?: unknown;
  };
  const testingDocumentation = await readFile(`${input.cwd}/docs/testing.md`, "utf8");
  if (
    packageJson.name !== input.transition.branding.packageName ||
    PROBE_PRODUCTION_ORIGIN !== input.transition.branding.productionOrigin ||
    !testingDocumentation.includes(input.transition.branding.repositorySlug)
  ) {
    throw new Error("judge_demo_rebrand_compatibility_identity_invalid");
  }

  const preservedArtifacts = await Promise.all(
    JUDGE_DEMO_REBRAND_PRESERVED_ARTIFACTS.map(async ({ path }) => ({
      path,
      sha256: sha256(await readFile(`${input.cwd}/${path}`))
    }))
  );
  if (
    canonicalJson(preservedArtifacts) !== canonicalJson(input.transition.preservedArtifacts) ||
    (await canonicalSha256(preservedArtifacts)) !== input.transition.preservedArtifactsHash
  ) {
    throw new Error("judge_demo_rebrand_preserved_artifact_mismatch");
  }
}

function assertSafeMaterialTreeMutation(change: GitTreeChange, code: string): void {
  const modified =
    change.status === "M" &&
    change.predecessorMode === "100644" &&
    change.successorMode === "100644" &&
    change.predecessorBlobOid !== null &&
    change.successorBlobOid !== null;
  const added =
    change.status === "A" &&
    change.predecessorMode === null &&
    change.successorMode === "100644" &&
    change.predecessorBlobOid === null &&
    change.successorBlobOid !== null;
  if (!modified && !added) throw new Error(`${code}:${change.path}`);
}

async function verifyInvocationIntegrity(input: {
  readonly cwd: string;
  readonly transition: JudgeDemoInvocationIntegrityTransition;
  readonly firstParentChain: readonly string[];
}): Promise<void> {
  const protocolCommit = input.transition.protocolExtension.commit;
  const protocolCommits = input.firstParentChain.slice(2, -1);
  if (
    input.firstParentChain.length !== input.transition.protocolExtension.commitCount + 3 ||
    input.firstParentChain[0] !== JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_COMMIT ||
    input.firstParentChain[1] !== JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_COMMIT ||
    protocolCommits.length !== input.transition.protocolExtension.commitCount ||
    protocolCommits.at(-1) !== protocolCommit ||
    input.firstParentChain.at(-1) !== input.transition.successorCommit ||
    commitTree(input.cwd, JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_COMMIT) !==
      JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_TREE ||
    commitTree(input.cwd, JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_COMMIT) !==
      JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_TREE ||
    commitTree(input.cwd, protocolCommit) !== input.transition.protocolExtension.tree ||
    commitTree(input.cwd, input.transition.successorCommit) !==
      input.transition.implementation.tree ||
    input.transition.predecessorEnvelopeHash !==
      JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_ENVELOPE_HASH
  ) {
    throw new Error("judge_demo_invocation_integrity_chain_invalid");
  }

  const amendmentChanges = gitTreeChanges(
    input.cwd,
    JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_COMMIT,
    JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_COMMIT
  );
  const protocolChanges = gitTreeChanges(
    input.cwd,
    JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_COMMIT,
    protocolCommit
  );
  const implementationChanges = gitTreeChanges(
    input.cwd,
    protocolCommit,
    input.transition.successorCommit
  );
  const priorProtocolCommits = protocolCommits.slice(0, -1);
  if (
    canonicalJson(priorProtocolCommits) !==
      canonicalJson(
        JUDGE_DEMO_INVOCATION_INTEGRITY_PRIOR_PROTOCOL_COMMITS.map(({ commit }) => commit)
      ) ||
    JUDGE_DEMO_INVOCATION_INTEGRITY_PRIOR_PROTOCOL_COMMITS.some(
      ({ commit, tree }) => commitHeaderTree(input.cwd, commit) !== tree
    )
  ) {
    throw new Error("judge_demo_invocation_prior_protocol_identity_invalid");
  }
  if (
    amendmentChanges.length !== 1 ||
    amendmentChanges[0]?.path !== JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_PATH ||
    canonicalJson(amendmentChanges[0]) !== canonicalJson(input.transition.amendment.treeChange) ||
    (await canonicalSha256(amendmentChanges)) !==
      input.transition.amendment.gitTreeProjectionHash ||
    canonicalJson(protocolChanges.map(({ path }) => path)) !==
      canonicalJson(JUDGE_DEMO_INVOCATION_INTEGRITY_PROTOCOL_PATHS) ||
    canonicalJson(protocolChanges) !==
      canonicalJson(input.transition.protocolExtension.treeChanges) ||
    (await canonicalSha256(protocolChanges)) !==
      input.transition.protocolExtension.gitTreeProjectionHash ||
    canonicalJson(implementationChanges.map(({ path }) => path)) !==
      canonicalJson(input.transition.implementation.changedPaths) ||
    canonicalJson(implementationChanges) !==
      canonicalJson(input.transition.implementation.treeChanges) ||
    implementationChanges.some(
      ({ path }) => !JUDGE_DEMO_INVOCATION_INTEGRITY_IMPLEMENTATION_ALLOWED_PATHS.includes(path)
    ) ||
    JUDGE_DEMO_INVOCATION_INTEGRITY_IMPLEMENTATION_REQUIRED_PATHS.some(
      (path) => !implementationChanges.some((change) => change.path === path)
    ) ||
    (await canonicalSha256(implementationChanges)) !==
      input.transition.implementation.gitTreeProjectionHash
  ) {
    throw new Error("judge_demo_invocation_integrity_step_projection_invalid");
  }
  assertSafeMaterialTreeMutation(
    amendmentChanges[0]!,
    "judge_demo_invocation_amendment_mode_invalid"
  );
  for (const change of implementationChanges) {
    assertSafeMaterialTreeMutation(change, "judge_demo_invocation_implementation_mode_invalid");
  }

  const [amendmentBytes, contractBytes, schemaBytes, domainBytes] = await Promise.all([
    activeCheckoutBlobBytes(
      input.cwd,
      input.transition.successorCommit,
      JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_PATH
    ),
    activeCheckoutBlobBytes(
      input.cwd,
      input.transition.successorCommit,
      "lib/invocation-integrity/contract.ts"
    ),
    activeCheckoutBlobBytes(
      input.cwd,
      input.transition.successorCommit,
      "lib/domain/checkout-schemas.ts"
    ),
    activeCheckoutBlobBytes(input.cwd, input.transition.successorCommit, "lib/domain/checkout.ts")
  ]);
  const amendmentEntry = treeEntry(
    input.cwd,
    JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_COMMIT,
    JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_PATH
  );
  const activeAmendmentEntry = treeEntry(
    input.cwd,
    input.transition.successorCommit,
    JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_PATH
  );
  const schemaSource = new TextDecoder("utf-8", { fatal: true }).decode(schemaBytes);
  const domainSource = new TextDecoder("utf-8", { fatal: true }).decode(domainBytes);
  if (
    amendmentEntry === null ||
    activeAmendmentEntry === null ||
    amendmentEntry.blobOid !== activeAmendmentEntry.blobOid ||
    sha256(amendmentBytes) !== JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_SHA256 ||
    sha256(contractBytes) !== input.transition.invocationContract.contractSourceSha256 ||
    !schemaSource.includes('CART_ITEM_ID_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$"') ||
    !schemaSource.includes(".min(1).max(64)") ||
    !schemaSource.includes("pattern: CART_ITEM_ID_PATTERN") ||
    !domainSource.includes("itemId: line.itemId")
  ) {
    throw new Error("judge_demo_invocation_integrity_contract_delta_invalid");
  }

  const preserved = await Promise.all(
    JUDGE_DEMO_INVOCATION_INTEGRITY_PRESERVED_SEMANTIC_ARTIFACTS.map(
      async ({ path, sha256: expectedSha256 }) => {
        const sealedEntry = treeEntry(
          input.cwd,
          JUDGE_DEMO_INVOCATION_INTEGRITY_SEALED_EVIDENCE_BUILD,
          path
        );
        const activeEntry = treeEntry(input.cwd, input.transition.successorCommit, path);
        const bytes = await activeCheckoutBlobBytes(
          input.cwd,
          input.transition.successorCommit,
          path
        );
        if (
          sealedEntry === null ||
          activeEntry === null ||
          sealedEntry.blobOid !== activeEntry.blobOid ||
          sha256(bytes) !== expectedSha256
        ) {
          throw new Error(`judge_demo_invocation_semantic_artifact_mismatch:${path}`);
        }
        return { path, sha256: expectedSha256 };
      }
    )
  );
  if (
    canonicalJson(preserved) !== canonicalJson(input.transition.semanticEvidence.artifacts) ||
    (await canonicalSha256(preserved)) !== input.transition.semanticEvidence.artifactsProjectionHash
  ) {
    throw new Error("judge_demo_invocation_semantic_preservation_invalid");
  }
}

type ImpactExecutionFinalization = NonNullable<
  NonNullable<
    JudgeDemoInvocationIntegrityEvidenceTransition["terminalFinalization"]
  >["impactExecutionFinalization"]
>;

function occurrenceCount(source: string, value: string): number {
  if (value.length === 0) return 0;
  return source.split(value).length - 1;
}

function jsxTagIndexes(source: string, name: string): readonly number[] {
  return [...source.matchAll(new RegExp(`<\\s*${name}\\b`, "gu"))].map((match) => match.index);
}

function identifierCount(source: string, name: string): number {
  return source.match(new RegExp(`\\b${name}\\b`, "gu"))?.length ?? 0;
}

function routeWrapperUsesDynamicConstruction(source: string): boolean {
  return /\b(?:eval|Function)\s*\(|\b(?:React\.)?createElement\s*\(|\bReflect\.(?:get|construct)\b|\b(?:globalThis|window|document)\s*\[/u.test(
    source
  );
}

function exactImportPresent(source: string, exactImport: string, modulePath: string): boolean {
  return occurrenceCount(source, exactImport) === 1 && occurrenceCount(source, modulePath) === 1;
}

function replaceExactOnce(source: string, expected: string, replacement: string, label: string) {
  if (occurrenceCount(source, expected) !== 1) {
    throw new Error(`judge_demo_impact_execution_normalization_invalid:${label}`);
  }
  return source.replace(expected, replacement);
}

function replaceExactCount(
  source: string,
  expected: string,
  replacement: string,
  expectedOccurrenceCount: number,
  label: string
) {
  if (occurrenceCount(source, expected) !== expectedOccurrenceCount) {
    throw new Error(`judge_demo_impact_execution_normalization_invalid:${label}`);
  }
  return source.split(expected).join(replacement);
}

function normalizeImpactExecutionTest(path: string, source: string): string {
  const start = source.indexOf(JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_START);
  const end = source.indexOf(JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_END);
  if (
    start < 0 ||
    end <= start ||
    source.slice(start - 2, start) !== "\n\n" ||
    source[start - 3] === "\n" ||
    occurrenceCount(source, JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_START) !== 1 ||
    occurrenceCount(source, JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_END) !== 1
  ) {
    throw new Error(`judge_demo_impact_execution_test_marker_invalid:${path}`);
  }
  const block = source.slice(start, end + JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_END.length);
  const trailing = source.slice(end + JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_END.length);
  if (
    (trailing !== "" && trailing !== "\n") ||
    block
      .replace(JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_START, "")
      .replace(JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_END, "")
      .trim().length === 0 ||
    !/\b(?:test|it)\(/u.test(block) ||
    !/\bexpect\(/u.test(block) ||
    /\b(?:test|it|describe)\.(?:skip|fixme|only|beforeEach|afterEach|beforeAll|afterAll|use)\b|\bdescribe\.configure\b|\btest\.setTimeout\b|\btimeout\s*:|\.slow\(/u.test(
      block
    )
  ) {
    throw new Error(`judge_demo_impact_execution_test_block_invalid:${path}`);
  }
  let normalized = source.slice(0, start - 1);
  if (
    path === "tests/browser/lab-sandbox.spec.ts" &&
    occurrenceCount(normalized, JUDGE_DEMO_IMPACT_EXECUTION_LAB_RECEIPT_SELECTOR_U) !==
      JUDGE_DEMO_IMPACT_EXECUTION_LAB_RECEIPT_SELECTOR_COUNT
  ) {
    throw new Error("judge_demo_impact_execution_normalization_invalid:lab-receipt-selector-count");
  }
  for (const replacement of JUDGE_DEMO_IMPACT_EXECUTION_TEST_REPLACEMENTS) {
    if (replacement.path !== path) continue;
    normalized = replaceExactCount(
      normalized,
      replacement.successor,
      replacement.predecessor,
      replacement.expectedOccurrenceCount,
      `test-replacement:${replacement.label}`
    );
  }
  if (
    path === "tests/browser/results.spec.ts" ||
    path === "tests/browser/invocation-integrity-results.spec.ts"
  ) {
    normalized = replaceExactOnce(
      normalized,
      `page.goto("${JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_FULL_QUERY}")`,
      'page.goto("/results")',
      `results-query:${path}`
    );
  }
  return normalized;
}

function normalizeImpactExecutionMixedSource(path: string, source: string): string {
  let normalized = source;
  if (path === "components/lab/judge-demo-panel.tsx") {
    normalized = replaceExactOnce(
      normalized,
      JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_REACT_IMPORT_U,
      JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_REACT_IMPORT_Q,
      "judge-react-import"
    );
    normalized = replaceExactOnce(
      normalized,
      JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_PORTAL_IMPORT,
      "",
      "judge-import"
    );
    normalized = replaceExactOnce(
      normalized,
      JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_MOUNT_SNIPPET,
      JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_MOUNT_ANCHOR,
      "judge-mount"
    );
    normalized = replaceExactOnce(
      normalized,
      JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_RETURN_START_U,
      JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_RETURN_START_Q,
      "judge-return-start"
    );
    normalized = replaceExactOnce(
      normalized,
      JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_RETURN_END_U,
      JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_RETURN_END_Q,
      "judge-return-end"
    );
  } else if (path === "components/invocation-integrity/invocation-integrity-client.tsx") {
    normalized = replaceExactOnce(
      normalized,
      JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_STATUS_U,
      JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_STATUS_Q,
      "integrity-status"
    );
    normalized = replaceExactOnce(
      normalized,
      JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_BANNER_U,
      JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_BANNER_Q,
      "integrity-banner"
    );
  } else if (path === "components/results/invocation-integrity-results.tsx") {
    normalized = replaceExactOnce(
      normalized,
      JUDGE_DEMO_IMPACT_EXECUTION_INVOCATION_HEADING_U,
      JUDGE_DEMO_IMPACT_EXECUTION_INVOCATION_HEADING_Q,
      "invocation-heading"
    );
  } else if (path === "components/results/semantic-paired-results.tsx") {
    normalized = replaceExactOnce(
      normalized,
      JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_TEMPLATE,
      "",
      "results-bridge"
    );
    normalized = replaceExactOnce(
      normalized,
      JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_IMPORT_U,
      JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_IMPORT_Q,
      "results-bridge-import"
    );
  } else if (path === "lib/results/meta-tools.ts") {
    normalized = replaceExactOnce(
      normalized,
      JUDGE_DEMO_IMPACT_EXECUTION_LAZY_HELPER_TEMPLATE,
      "",
      "lazy-helper"
    );
  }
  return normalized;
}

function normalizeImpactExecutionRouteSource(path: string, source: string): string {
  let normalized = source;
  if (path === "app/lab/page.tsx") {
    normalized = replaceExactOnce(
      normalized,
      JUDGE_DEMO_IMPACT_EXECUTION_LAB_RETURN_U,
      JUDGE_DEMO_IMPACT_EXECUTION_LAB_RETURN_Q,
      "lab-route"
    );
  } else if (path === "app/studio/page.tsx") {
    normalized = replaceExactOnce(
      normalized,
      JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_RETURN_U,
      JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_RETURN_Q,
      "studio-route"
    );
  } else if (path === "app/invocation-integrity/page.tsx") {
    normalized = replaceExactOnce(
      normalized,
      JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_RETURN_U,
      JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_RETURN_Q,
      "integrity-route"
    );
  } else if (path === "app/results/page.tsx") {
    normalized = replaceExactOnce(
      normalized,
      `${JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_SEMANTIC_ARTIFACT_IMPORT}\n${JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_INVOCATION_ARTIFACT_IMPORT}\n`,
      "",
      "results-artifact-imports"
    );
    normalized = replaceExactOnce(
      normalized,
      JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_COMPONENT_IMPORT_U,
      JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_COMPONENT_IMPORT_Q,
      "results-component-import"
    );
    normalized = replaceExactOnce(
      normalized,
      JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_SUMMARY_TEMPLATE,
      "",
      "results-summary"
    );
    normalized = replaceExactOnce(
      normalized,
      JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_FUNCTION_U,
      JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_FUNCTION_Q,
      "results-function"
    );
    normalized = replaceExactOnce(
      normalized,
      `${JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_COMPACT_BLOCK_TEMPLATE}\n`,
      "",
      "results-compact-block"
    );
  }
  return normalized;
}

export async function verifyImpactExecutionOperationalSourceProjection(input: {
  readonly path: string;
  readonly source: string;
}): Promise<void> {
  const finalIdentity = JUDGE_DEMO_IMPACT_EXECUTION_FINAL_U_FILE_IDENTITIES.find(
    ({ path }) => path === input.path
  );
  if (
    finalIdentity !== undefined &&
    Buffer.byteLength(input.source, "utf8") === finalIdentity.length &&
    sha256(input.source) === finalIdentity.sha256
  ) {
    return;
  }
  const mixed = JUDGE_DEMO_IMPACT_EXECUTION_Q_MIXED_FILE_IDENTITIES.find(
    ({ path }) => path === input.path
  );
  if (mixed !== undefined) {
    if (input.path === "components/lab/judge-demo-panel.tsx") {
      if (
        Buffer.byteLength(input.source, "utf8") !==
          JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_FULL_U_LENGTH ||
        sha256(input.source) !== JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_FULL_U_SHA256
      ) {
        throw new Error(`judge_demo_impact_execution_operational_projection_invalid:${mixed.path}`);
      }
    } else {
      const normalized = normalizeImpactExecutionMixedSource(input.path, input.source);
      if (
        Buffer.byteLength(normalized, "utf8") !== mixed.length ||
        sha256(normalized) !== mixed.sha256
      ) {
        throw new Error(`judge_demo_impact_execution_operational_projection_invalid:${mixed.path}`);
      }
    }
  }
  if (input.path === "components/lab/judge-demo-panel.tsx") {
    const detailsStart = input.source.indexOf('<details className="judge-diagnostics">');
    const detailsEnd = input.source.indexOf("      </details>", detailsStart);
    const primary = input.source.indexOf('className="button button-primary"');
    const refresh = input.source.indexOf("Refresh judge status");
    const rawReceipt = input.source.indexOf('className="runtime-receipt"');
    const statusSummary = input.source.indexOf("judge-status-summary");
    if (
      occurrenceCount(input.source, JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_DIAGNOSTICS_MARKER) !== 1 ||
      occurrenceCount(input.source, JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_DIAGNOSTICS_SUMMARY) !== 1 ||
      occurrenceCount(input.source, '<details className="judge-diagnostics">') !== 1 ||
      occurrenceCount(input.source, "judge-status-summary") !== 2 ||
      detailsStart < 0 ||
      detailsEnd <= detailsStart ||
      primary < 0 ||
      primary >= detailsStart ||
      statusSummary < primary ||
      statusSummary >= detailsStart ||
      refresh <= detailsStart ||
      refresh >= detailsEnd ||
      rawReceipt <= detailsStart ||
      rawReceipt >= detailsEnd ||
      input.source.indexOf("The server accepts no prompt", detailsStart) <= detailsStart
    ) {
      throw new Error("judge_demo_impact_execution_judge_disclosure_invalid");
    }
  }
  const route = JUDGE_DEMO_IMPACT_EXECUTION_Q_ROUTE_IDENTITIES.find(
    ({ path }) => path === input.path
  );
  if (route !== undefined) {
    const normalized = normalizeImpactExecutionRouteSource(input.path, input.source);
    if (
      Buffer.byteLength(normalized, "utf8") !== route.length ||
      sha256(normalized) !== route.sha256
    ) {
      throw new Error(`judge_demo_impact_execution_route_projection_invalid:${route.path}`);
    }
  }
  const expected = JUDGE_DEMO_IMPACT_EXECUTION_Q_TEST_FILE_IDENTITIES.find(
    ({ path }) => path === input.path
  );
  if (
    expected !== undefined &&
    sha256(normalizeImpactExecutionTest(input.path, input.source)) !== expected.sha256
  ) {
    throw new Error(`judge_demo_impact_execution_test_projection_invalid:${expected.path}`);
  }
  const session = JUDGE_DEMO_IMPACT_EXECUTION_SESSION_SEGMENTS.find(
    ({ path }) => path === input.path
  );
  if (session !== undefined) {
    const start = input.source.indexOf(session.startMarker);
    const end = session.useLastEnd
      ? input.source.lastIndexOf(session.endMarker)
      : input.source.indexOf(session.endMarker);
    const value = start < 0 || end <= start ? "" : input.source.slice(start, end);
    if (Buffer.byteLength(value, "utf8") !== session.length || sha256(value) !== session.sha256) {
      throw new Error(`judge_demo_impact_execution_session_projection_invalid:${input.path}`);
    }
  }
  if (
    input.path === "app/results/page.tsx" &&
    occurrenceCount(input.source, JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_SUMMARY_TEMPLATE) !== 1
  ) {
    throw new Error("judge_demo_impact_execution_results_summary_invalid");
  }
  if (input.path === "app/results/page.tsx") {
    for (const token of [
      JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_SEMANTIC_ARTIFACT_IMPORT,
      JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_INVOCATION_ARTIFACT_IMPORT,
      JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_COMPONENT_IMPORT_U,
      JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_VIEW_SWITCH,
      JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_SUMMARY_CALL,
      JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_RENDER,
      JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_COMPACT_START,
      JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_COMPACT_END
    ]) {
      if (occurrenceCount(input.source, token) !== 1) {
        throw new Error("judge_demo_impact_execution_results_composition_invalid");
      }
    }
    const compactStart = input.source.indexOf(JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_COMPACT_START);
    const compactEnd = input.source.indexOf(JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_COMPACT_END);
    const compact = input.source.slice(compactStart, compactEnd);
    const bridgeTags = jsxTagIndexes(input.source, "PairedResultsToolBridge");
    const semanticTags = jsxTagIndexes(input.source, "SemanticPairedResults");
    const integrityTags = jsxTagIndexes(input.source, "InvocationIntegrityResults");
    if (
      compactStart < 0 ||
      compactEnd <= compactStart ||
      !compact.includes("return (") ||
      !compact.includes(JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_USAGE) ||
      /SemanticPairedResults|InvocationIntegrityResults|readSemanticResults|readInvocationIntegrityResults/u.test(
        compact
      ) ||
      input.source.indexOf("const semanticResults = await readSemanticResults") < compactEnd ||
      input.source.indexOf(
        "const invocationIntegrityResults = await readInvocationIntegrityResults"
      ) < compactEnd ||
      bridgeTags.length !== 1 ||
      semanticTags.length !== 1 ||
      integrityTags.length !== 1 ||
      identifierCount(input.source, "PairedResultsToolBridge") !== 2 ||
      identifierCount(input.source, "SemanticPairedResults") !== 2 ||
      identifierCount(input.source, "InvocationIntegrityResults") !== 2 ||
      routeWrapperUsesDynamicConstruction(input.source) ||
      !exactImportPresent(
        input.source,
        JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_COMPONENT_IMPORT_U,
        "@/components/results/semantic-paired-results"
      ) ||
      !exactImportPresent(
        input.source,
        JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_INVOCATION_COMPONENT_IMPORT,
        "@/components/results/invocation-integrity-results"
      ) ||
      !input.source.includes(JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_FULL_BRANCH) ||
      /23\s*\/\s*24|3\s*\/\s*3|no measured improvement|commitment_holdout_anchor/iu.test(compact)
    ) {
      throw new Error("judge_demo_impact_execution_results_composition_invalid");
    }
  }
  if (input.path === "app/lab/page.tsx") {
    const labTags = jsxTagIndexes(input.source, "LabClient");
    const mount = input.source.indexOf('id="impact-execution-judge-action"');
    if (
      occurrenceCount(input.source, 'id="impact-execution-judge-action"') !== 1 ||
      labTags.length !== 1 ||
      identifierCount(input.source, "LabClient") !== 2 ||
      routeWrapperUsesDynamicConstruction(input.source) ||
      mount < 0 ||
      mount > labTags[0]! ||
      !exactImportPresent(
        input.source,
        JUDGE_DEMO_IMPACT_EXECUTION_LAB_CLIENT_IMPORT,
        "@/components/lab/lab-client"
      )
    ) {
      throw new Error("judge_demo_impact_execution_lab_composition_invalid");
    }
  }
  if (input.path === "app/studio/page.tsx") {
    const marker = input.source.indexOf(JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_PRESENTATION_MARKER);
    const prefix = marker < 0 ? "" : input.source.slice(0, marker);
    const wrapper =
      marker < 0
        ? ""
        : input.source.slice(
            marker + JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_PRESENTATION_MARKER.length
          );
    if (
      occurrenceCount(input.source, JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_PRESENTATION_MARKER) !== 1 ||
      Buffer.byteLength(prefix, "utf8") !== JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_PREFIX_LENGTH ||
      sha256(prefix) !== JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_PREFIX_SHA256 ||
      jsxTagIndexes(input.source, "StudioClient").length !== 1 ||
      identifierCount(input.source, "StudioClient") !== 2 ||
      routeWrapperUsesDynamicConstruction(wrapper) ||
      !wrapper.includes(
        "<StudioClient target={LAST_VERIFIED_TARGET} reviewPackage={reviewPackage} />"
      ) ||
      /\b(?:fetch|registerTool|executeTool|useEffect|useState|useMemo|onClick|onSubmit)\b/u.test(
        wrapper
      ) ||
      !exactImportPresent(
        input.source,
        JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_CLIENT_IMPORT,
        "@/components/studio/studio-client"
      )
    ) {
      throw new Error("judge_demo_impact_execution_studio_composition_invalid");
    }
  }
  if (
    input.path === "app/invocation-integrity/page.tsx" &&
    (jsxTagIndexes(input.source, "InvocationIntegrityClient").length !== 1 ||
      identifierCount(input.source, "InvocationIntegrityClient") !== 2 ||
      routeWrapperUsesDynamicConstruction(input.source) ||
      !exactImportPresent(
        input.source,
        JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_CLIENT_IMPORT,
        "@/components/invocation-integrity/invocation-integrity-client"
      ))
  ) {
    throw new Error("judge_demo_impact_execution_integrity_composition_invalid");
  }
  if (finalIdentity !== undefined) {
    throw new Error(`judge_demo_impact_execution_final_u_file_invalid:${input.path}`);
  }
}

async function verifyImpactExecutionOperationalProjections(input: {
  readonly cwd: string;
  readonly successorCommit: string;
  readonly historicalCheckoutPaths?: readonly string[];
}): Promise<void> {
  if (
    sha256(JUDGE_DEMO_IMPACT_EXECUTION_LAZY_HELPER_TEMPLATE) !==
      JUDGE_DEMO_IMPACT_EXECUTION_LAZY_HELPER_TEMPLATE_SHA256 ||
    sha256(JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_TEMPLATE) !==
      JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_TEMPLATE_SHA256 ||
    sha256(JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_SUMMARY_TEMPLATE) !==
      JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_SUMMARY_TEMPLATE_SHA256 ||
    sha256(JUDGE_DEMO_IMPACT_EXECUTION_LAB_RETURN_U) !==
      JUDGE_DEMO_IMPACT_EXECUTION_LAB_RETURN_U_SHA256 ||
    sha256(JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_RETURN_U) !==
      JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_RETURN_U_SHA256 ||
    sha256(JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_RETURN_U) !==
      JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_RETURN_U_SHA256 ||
    sha256(JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_COMPACT_BLOCK_TEMPLATE) !==
      JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_COMPACT_BLOCK_TEMPLATE_SHA256 ||
    sha256(JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_REACT_IMPORT_U) !==
      JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_REACT_IMPORT_U_SHA256 ||
    sha256(JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_MOUNT_SNIPPET) !==
      JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_MOUNT_SNIPPET_SHA256 ||
    (await canonicalSha256(JUDGE_DEMO_IMPACT_EXECUTION_TEST_REPLACEMENTS)) !==
      JUDGE_DEMO_IMPACT_EXECUTION_TEST_REPLACEMENTS_HASH
  ) {
    throw new Error("judge_demo_impact_execution_template_hash_invalid");
  }
  impactExecutionProspectivePatch();
  const paths = JUDGE_DEMO_IMPACT_EXECUTION_FINAL_U_FILE_IDENTITIES.map(({ path }) => path);
  for (const path of paths) {
    const bytes = input.historicalCheckoutPaths?.includes(path)
      ? await historicalImpactCheckoutBytes({
          cwd: input.cwd,
          commit: input.successorCommit,
          path
        })
      : await activeCheckoutBlobBytes(input.cwd, input.successorCommit, path);
    if (bytes === null) {
      throw new Error(`judge_demo_impact_execution_historical_blob_missing:${path}`);
    }
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    await verifyImpactExecutionOperationalSourceProjection({ path, source });
  }
}

function impactExecutionTimeoutLiteral(value: number): string {
  return value.toLocaleString("en-US").replaceAll(",", "_");
}

function applyImpactExecutionCiTimeoutReplacements(source: string): string {
  let result = source;
  for (const replacement of JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_REPLACEMENTS) {
    const marker = `  it("${replacement.test}",`;
    const start = result.indexOf(marker);
    const next = result.indexOf('\n  it("', start + marker.length);
    const end = next < 0 ? result.length : next;
    if (start < 0 || end <= start) {
      throw new Error("judge_demo_impact_execution_ci_timeout_test_missing");
    }
    const block = result.slice(start, end);
    const predecessor = `}, ${impactExecutionTimeoutLiteral(replacement.predecessorTimeoutMs)});`;
    const successor = `}, ${impactExecutionTimeoutLiteral(replacement.successorTimeoutMs)});`;
    if (block.split(predecessor).length !== 2 || block.includes(successor)) {
      throw new Error("judge_demo_impact_execution_ci_timeout_predecessor_invalid");
    }
    result = `${result.slice(0, start)}${block.replace(predecessor, successor)}${result.slice(end)}`;
  }
  return result;
}

export async function verifyImpactExecutionFinalizationCheckout(input: {
  readonly cwd: string;
  readonly finalization: ImpactExecutionFinalization;
}): Promise<{
  readonly protocolChanges: readonly GitTreeChange[];
  readonly presentationChanges: readonly GitTreeChange[];
  readonly ciTimeoutRepairChanges: readonly GitTreeChange[];
}> {
  const ciTimeoutRepair = input.finalization.ciTimeoutRepair ?? null;
  const originAliasFinalization = input.finalization.originAliasFinalization ?? null;
  const terminalCheckoutCommit =
    originAliasFinalization?.checkoutRepair?.successorCommit ??
    originAliasFinalization?.implementation.successorCommit ??
    ciTimeoutRepair?.successorCommit ??
    input.finalization.presentation.successorCommit;
  const expectedChain = [
    input.finalization.protocol.predecessorCommit,
    input.finalization.protocol.successorCommit,
    input.finalization.presentation.successorCommit,
    ...(ciTimeoutRepair === null ? [] : [ciTimeoutRepair.successorCommit])
  ];
  if (
    canonicalJson(
      firstParentCommitChain(
        input.cwd,
        input.finalization.protocol.predecessorCommit,
        ciTimeoutRepair?.successorCommit ?? input.finalization.presentation.successorCommit
      )
    ) !== canonicalJson(expectedChain) ||
    commitTree(input.cwd, input.finalization.protocol.predecessorCommit) !==
      input.finalization.protocol.predecessorTree ||
    commitTree(input.cwd, input.finalization.protocol.successorCommit) !==
      input.finalization.protocol.successorTree ||
    input.finalization.protocol.successorCommit !==
      input.finalization.presentation.predecessorCommit ||
    input.finalization.protocol.successorTree !== input.finalization.presentation.predecessorTree ||
    commitTree(input.cwd, input.finalization.presentation.successorCommit) !==
      input.finalization.presentation.successorTree ||
    (ciTimeoutRepair !== null &&
      (JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PREDECESSOR_COMMIT !==
        input.finalization.presentation.successorCommit ||
        JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PREDECESSOR_TREE !==
          input.finalization.presentation.successorTree ||
        commitTree(input.cwd, ciTimeoutRepair.successorCommit) !== ciTimeoutRepair.successorTree))
  ) {
    throw new Error("judge_demo_impact_execution_chain_invalid");
  }
  const protocolChanges = [
    ...gitTreeChanges(
      input.cwd,
      input.finalization.protocol.predecessorCommit,
      input.finalization.protocol.successorCommit
    )
  ].sort((left, right) => judgeDemoInvocationIntegrityEvidencePathCompare(left.path, right.path));
  const presentationChanges = [
    ...gitTreeChanges(
      input.cwd,
      input.finalization.presentation.predecessorCommit,
      input.finalization.presentation.successorCommit
    )
  ].sort((left, right) => judgeDemoInvocationIntegrityEvidencePathCompare(left.path, right.path));
  const ciTimeoutRepairChanges =
    ciTimeoutRepair === null
      ? []
      : [
          ...gitTreeChanges(
            input.cwd,
            JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PREDECESSOR_COMMIT,
            ciTimeoutRepair.successorCommit
          )
        ].sort((left, right) =>
          judgeDemoInvocationIntegrityEvidencePathCompare(left.path, right.path)
        );
  const validMutation = (change: GitTreeChange) =>
    change.status === "M" &&
    change.predecessorMode === "100644" &&
    change.successorMode === "100644" &&
    change.predecessorBlobOid !== null &&
    change.successorBlobOid !== null &&
    change.predecessorBlobOid !== change.successorBlobOid;
  if (
    canonicalJson(protocolChanges.map(({ path }) => path)) !==
      canonicalJson(JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS) ||
    canonicalJson(presentationChanges.map(({ path }) => path)) !==
      canonicalJson(JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS) ||
    (await canonicalSha256(JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS)) !==
      JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS_HASH ||
    (await canonicalSha256(JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS)) !==
      JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS_HASH ||
    (await canonicalSha256(protocolChanges)) !==
      input.finalization.protocol.gitTreeProjectionHash ||
    (await canonicalSha256(presentationChanges)) !==
      input.finalization.presentation.gitTreeProjectionHash ||
    protocolChanges.some((change) => !validMutation(change)) ||
    presentationChanges.some((change) => !validMutation(change)) ||
    (ciTimeoutRepair !== null &&
      (canonicalJson(ciTimeoutRepairChanges.map(({ path }) => path)) !==
        canonicalJson(JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_REPAIR_PATHS) ||
        canonicalJson(ciTimeoutRepairChanges) !== canonicalJson(ciTimeoutRepair.treeChanges) ||
        (await canonicalSha256(JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_REPAIR_PATHS)) !==
          JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_REPAIR_PATHS_HASH ||
        (await canonicalSha256(ciTimeoutRepairChanges)) !== ciTimeoutRepair.gitTreeProjectionHash ||
        ciTimeoutRepairChanges.some((change) => !validMutation(change))))
  ) {
    throw new Error("judge_demo_impact_execution_projection_invalid");
  }
  const expectedPatch = impactExecutionProspectivePatch();
  await verifyImpactExecutionPatchEffect({
    cwd: input.cwd,
    predecessorCommit: input.finalization.protocol.successorCommit,
    successorCommit: input.finalization.presentation.successorCommit,
    expectedPatch,
    historicalCheckoutPaths:
      originAliasFinalization === null
        ? []
        : [
            ...JUDGE_DEMO_ORIGIN_ALIAS_IMPLEMENTATION_PATHS,
            ...JUDGE_DEMO_ORIGIN_ALIAS_CHECKOUT_REPAIR_PATHS
          ]
  });
  if (
    impactExecutionPresentationProjectionTree({
      cwd: input.cwd,
      predecessorCommit: input.finalization.protocol.predecessorCommit,
      successorCommit: input.finalization.presentation.successorCommit
    }) !== JUDGE_DEMO_IMPACT_EXECUTION_U_PRESENTATION_PROJECTION_TREE
  ) {
    throw new Error("judge_demo_impact_execution_presentation_projection_tree_invalid");
  }
  for (const path of JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS) {
    const protocolEntry = treeEntry(input.cwd, input.finalization.protocol.successorCommit, path);
    const presentationEntry = treeEntry(
      input.cwd,
      input.finalization.presentation.successorCommit,
      path
    );
    if (
      protocolEntry === null ||
      presentationEntry === null ||
      protocolEntry.mode !== "100644" ||
      canonicalJson(protocolEntry) !== canonicalJson(presentationEntry)
    ) {
      throw new Error(`judge_demo_impact_execution_protocol_checkout_drift:${path}`);
    }
    await activeCheckoutBlobBytes(input.cwd, terminalCheckoutCommit, path);
  }
  for (const path of JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS) {
    await activeCheckoutBlobBytes(input.cwd, terminalCheckoutCommit, path);
  }
  const frozenLabPredecessorEntry = treeEntry(
    input.cwd,
    input.finalization.protocol.successorCommit,
    JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH
  );
  const frozenLabPredecessorBytes = availableGitBlobBytes(
    input.cwd,
    input.finalization.protocol.successorCommit,
    JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH
  );
  if (
    input.finalization.presentation.frozenLabClientPath !==
      JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH ||
    input.finalization.presentation.frozenLabClientBlobOid !==
      JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_BLOB_OID ||
    input.finalization.presentation.frozenLabClientSha256 !==
      JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_SHA256 ||
    frozenLabPredecessorEntry?.mode !== "100644" ||
    frozenLabPredecessorEntry.blobOid !== JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_BLOB_OID ||
    (frozenLabPredecessorBytes !== null &&
      sha256(frozenLabPredecessorBytes) !== JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_SHA256)
  ) {
    throw new Error("judge_demo_impact_execution_lab_client_predecessor_invalid");
  }
  const frozenLabEntry = treeEntry(
    input.cwd,
    input.finalization.presentation.successorCommit,
    JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH
  );
  const frozenLabBytes = await activeCheckoutBlobBytes(
    input.cwd,
    terminalCheckoutCommit,
    JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH
  );
  if (
    frozenLabEntry?.mode !== "100644" ||
    frozenLabEntry.blobOid !== JUDGE_DEMO_IMPACT_EXECUTION_LAB_CLIENT_U_BLOB_OID ||
    sha256(frozenLabBytes) !== JUDGE_DEMO_IMPACT_EXECUTION_LAB_CLIENT_U_SHA256
  ) {
    throw new Error("judge_demo_impact_execution_lab_client_presentation_invalid");
  }
  await verifyImpactExecutionOperationalProjections({
    cwd: input.cwd,
    successorCommit: input.finalization.presentation.successorCommit,
    historicalCheckoutPaths:
      originAliasFinalization === null
        ? []
        : [
            ...JUDGE_DEMO_ORIGIN_ALIAS_IMPLEMENTATION_PATHS,
            ...JUDGE_DEMO_ORIGIN_ALIAS_CHECKOUT_REPAIR_PATHS
          ]
  });
  if (ciTimeoutRepair !== null) {
    if (originAliasFinalization === null) {
      for (const path of JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_REPAIR_PATHS) {
        await activeCheckoutBlobBytes(input.cwd, ciTimeoutRepair.successorCommit, path);
      }
    }
    const predecessorEntry = treeEntry(
      input.cwd,
      JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PREDECESSOR_COMMIT,
      JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PATH
    );
    const predecessorBytes = availableGitBlobBytes(
      input.cwd,
      JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PREDECESSOR_COMMIT,
      JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PATH
    );
    const successorEntry = treeEntry(
      input.cwd,
      ciTimeoutRepair.successorCommit,
      JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PATH
    );
    const successorBytes =
      originAliasFinalization === null
        ? await activeCheckoutBlobBytes(
            input.cwd,
            ciTimeoutRepair.successorCommit,
            JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PATH
          )
        : availableGitBlobBytes(
            input.cwd,
            ciTimeoutRepair.successorCommit,
            JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PATH
          );
    if (
      JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_REPAIR_PATHS.some((path) =>
        JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS.includes(path)
      ) ||
      (await canonicalSha256(JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_FAILURE_EVIDENCE)) !==
        JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_FAILURE_EVIDENCE_HASH ||
      (await canonicalSha256(JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_REPLACEMENTS)) !==
        JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_REPLACEMENTS_HASH ||
      predecessorEntry?.mode !== "100644" ||
      predecessorEntry.blobOid !==
        JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PREDECESSOR_TEST_BLOB_OID ||
      (predecessorBytes !== null &&
        successorBytes !== null &&
        (predecessorBytes.byteLength !==
          JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PREDECESSOR_TEST_BYTES ||
          sha256(predecessorBytes) !==
            JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PREDECESSOR_TEST_SHA256 ||
          applyImpactExecutionCiTimeoutReplacements(predecessorBytes.toString("utf8")) !==
            successorBytes.toString("utf8"))) ||
      successorEntry?.mode !== "100644" ||
      successorEntry.blobOid !== JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_SUCCESSOR_TEST_BLOB_OID ||
      (successorBytes !== null &&
        (successorBytes.byteLength !==
          JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_SUCCESSOR_TEST_BYTES ||
          sha256(successorBytes) !== JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_SUCCESSOR_TEST_SHA256))
    ) {
      throw new Error("judge_demo_impact_execution_ci_timeout_checkout_invalid");
    }
  }
  return Object.freeze({ protocolChanges, presentationChanges, ciTimeoutRepairChanges });
}

export async function verifyInvocationIntegrityEvidenceCheckout(input: {
  readonly cwd: string;
  readonly transition: JudgeDemoInvocationIntegrityEvidenceTransition;
  readonly firstParentChain: readonly string[];
}): Promise<void> {
  const protocolCommit = input.transition.protocolExtension.commit;
  const terminal = input.transition.terminalFinalization ?? null;
  const ciFinalization = terminal?.ciFinalization ?? null;
  const ciPortabilityRepair = terminal?.ciPortabilityRepair ?? null;
  const impactExecutionFinalization = terminal?.impactExecutionFinalization ?? null;
  const impactExecutionCiTimeoutRepair = impactExecutionFinalization?.ciTimeoutRepair ?? null;
  const originAliasFinalization = impactExecutionFinalization?.originAliasFinalization ?? null;
  const originAliasCheckoutRepair = originAliasFinalization?.checkoutRepair ?? null;
  const evidenceMaterialCommit =
    terminal?.evidenceMaterialCommit ?? input.transition.successorCommit;
  const expectedChain =
    terminal === null
      ? [input.transition.predecessorCommit, protocolCommit, input.transition.successorCommit]
      : [
          input.transition.predecessorCommit,
          protocolCommit,
          evidenceMaterialCommit,
          terminal.protocolFinalization.successorCommit,
          terminal.collateralPreparation.successorCommit,
          ...(ciFinalization === null ? [] : [ciFinalization.successorCommit]),
          ...(ciPortabilityRepair === null ? [] : [ciPortabilityRepair.successorCommit]),
          ...(impactExecutionFinalization === null
            ? []
            : [
                impactExecutionFinalization.protocol.successorCommit,
                impactExecutionFinalization.presentation.successorCommit,
                ...(impactExecutionCiTimeoutRepair === null
                  ? []
                  : [impactExecutionCiTimeoutRepair.successorCommit]),
                ...(originAliasFinalization === null
                  ? []
                  : [
                      ...originAliasFinalization.protocol.commits,
                      originAliasFinalization.implementation.successorCommit,
                      ...(originAliasCheckoutRepair === null
                        ? []
                        : [...originAliasCheckoutRepair.commits])
                    ])
              ])
        ];
  if (
    canonicalJson(input.firstParentChain) !== canonicalJson(expectedChain) ||
    input.transition.evidence.executionBuildCommit !== input.transition.predecessorCommit ||
    commitTree(input.cwd, protocolCommit) !== input.transition.protocolExtension.tree ||
    commitTree(input.cwd, evidenceMaterialCommit) !== input.transition.evidence.tree ||
    (terminal !== null &&
      (terminal.evidenceMaterialTree !== input.transition.evidence.tree ||
        commitTree(input.cwd, terminal.protocolFinalization.successorCommit) !==
          terminal.protocolFinalization.successorTree ||
        commitTree(input.cwd, terminal.collateralPreparation.successorCommit) !==
          terminal.collateralPreparation.successorTree ||
        (ciFinalization !== null &&
          commitTree(input.cwd, ciFinalization.successorCommit) !== ciFinalization.successorTree) ||
        (ciPortabilityRepair !== null &&
          commitTree(input.cwd, ciPortabilityRepair.successorCommit) !==
            ciPortabilityRepair.successorTree) ||
        (impactExecutionFinalization !== null &&
          (commitTree(input.cwd, impactExecutionFinalization.protocol.successorCommit) !==
            impactExecutionFinalization.protocol.successorTree ||
            commitTree(input.cwd, impactExecutionFinalization.presentation.successorCommit) !==
              impactExecutionFinalization.presentation.successorTree ||
            (impactExecutionCiTimeoutRepair !== null &&
              commitTree(input.cwd, impactExecutionCiTimeoutRepair.successorCommit) !==
                impactExecutionCiTimeoutRepair.successorTree) ||
            (originAliasFinalization !== null &&
              (commitTree(input.cwd, originAliasFinalization.protocol.successorCommit) !==
                originAliasFinalization.protocol.successorTree ||
                commitTree(input.cwd, originAliasFinalization.implementation.successorCommit) !==
                  originAliasFinalization.implementation.successorTree ||
                (originAliasCheckoutRepair !== null &&
                  commitTree(input.cwd, originAliasCheckoutRepair.successorCommit) !==
                    originAliasCheckoutRepair.successorTree)))))))
  ) {
    throw new Error("judge_demo_invocation_evidence_chain_invalid");
  }
  const protocolChanges = [
    ...gitTreeChanges(input.cwd, input.transition.predecessorCommit, protocolCommit)
  ].sort((left, right) => judgeDemoInvocationIntegrityEvidencePathCompare(left.path, right.path));
  const evidenceChanges = [
    ...gitTreeChanges(input.cwd, protocolCommit, evidenceMaterialCommit)
  ].sort((left, right) => judgeDemoInvocationIntegrityEvidencePathCompare(left.path, right.path));
  const finalizationChanges =
    terminal === null
      ? []
      : [
          ...gitTreeChanges(
            input.cwd,
            evidenceMaterialCommit,
            terminal.protocolFinalization.successorCommit
          )
        ].sort((left, right) =>
          judgeDemoInvocationIntegrityEvidencePathCompare(left.path, right.path)
        );
  const preparationChanges =
    terminal === null
      ? []
      : [
          ...gitTreeChanges(
            input.cwd,
            terminal.protocolFinalization.successorCommit,
            terminal.collateralPreparation.successorCommit
          )
        ].sort((left, right) =>
          judgeDemoInvocationIntegrityEvidencePathCompare(left.path, right.path)
        );
  const ciFinalizationChanges =
    ciFinalization === null
      ? []
      : [
          ...gitTreeChanges(
            input.cwd,
            ciFinalization.predecessorCommit,
            ciFinalization.successorCommit
          )
        ].sort((left, right) =>
          judgeDemoInvocationIntegrityEvidencePathCompare(left.path, right.path)
        );
  const ciPortabilityRepairChanges =
    ciPortabilityRepair === null
      ? []
      : [
          ...gitTreeChanges(
            input.cwd,
            ciPortabilityRepair.predecessorCommit,
            ciPortabilityRepair.successorCommit
          )
        ].sort((left, right) =>
          judgeDemoInvocationIntegrityEvidencePathCompare(left.path, right.path)
        );
  const impactExecutionCheckout =
    impactExecutionFinalization === null
      ? null
      : await verifyImpactExecutionFinalizationCheckout({
          cwd: input.cwd,
          finalization: impactExecutionFinalization
        });
  const impactExecutionProtocolChanges = impactExecutionCheckout?.protocolChanges ?? [];
  const impactExecutionPresentationChanges = impactExecutionCheckout?.presentationChanges ?? [];
  const impactExecutionCiTimeoutRepairChanges =
    impactExecutionCheckout?.ciTimeoutRepairChanges ?? [];
  const originAliasProtocolChanges =
    originAliasFinalization === null
      ? []
      : [
          ...gitTreeChanges(
            input.cwd,
            originAliasFinalization.protocol.predecessorCommit,
            originAliasFinalization.protocol.successorCommit
          )
        ].sort((left, right) =>
          judgeDemoInvocationIntegrityEvidencePathCompare(left.path, right.path)
        );
  const originAliasImplementationChanges =
    originAliasFinalization === null
      ? []
      : [
          ...gitTreeChanges(
            input.cwd,
            originAliasFinalization.implementation.predecessorCommit,
            originAliasFinalization.implementation.successorCommit
          )
        ].sort((left, right) =>
          judgeDemoInvocationIntegrityEvidencePathCompare(left.path, right.path)
        );
  const originAliasCheckoutRepairChanges =
    originAliasCheckoutRepair === null
      ? []
      : [
          ...gitTreeChanges(
            input.cwd,
            originAliasCheckoutRepair.predecessorCommit,
            originAliasCheckoutRepair.successorCommit
          )
        ].sort((left, right) =>
          judgeDemoInvocationIntegrityEvidencePathCompare(left.path, right.path)
        );
  if (
    canonicalJson(protocolChanges.map(({ path }) => path)) !==
      canonicalJson(JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_PROTOCOL_PATHS) ||
    canonicalJson(protocolChanges) !==
      canonicalJson(input.transition.protocolExtension.treeChanges) ||
    (await canonicalSha256(protocolChanges)) !==
      input.transition.protocolExtension.gitTreeProjectionHash ||
    canonicalJson(evidenceChanges.map(({ path }) => path)) !==
      canonicalJson(input.transition.evidence.changedPaths) ||
    canonicalJson(evidenceChanges) !== canonicalJson(input.transition.evidence.treeChanges) ||
    evidenceChanges.some(
      ({ path }) => !JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_ALLOWED_PATHS.includes(path)
    ) ||
    JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_REQUIRED_PATHS.some(
      (path) => !evidenceChanges.some((change) => change.path === path)
    ) ||
    (await canonicalSha256(evidenceChanges)) !== input.transition.evidence.gitTreeProjectionHash ||
    (terminal !== null &&
      (canonicalJson(finalizationChanges.map(({ path }) => path)) !==
        canonicalJson(JUDGE_DEMO_GATE9_PROTOCOL_FINALIZATION_PATHS) ||
        canonicalJson(finalizationChanges) !==
          canonicalJson(terminal.protocolFinalization.treeChanges) ||
        (await canonicalSha256(finalizationChanges)) !==
          terminal.protocolFinalization.gitTreeProjectionHash ||
        canonicalJson(preparationChanges.map(({ path }) => path)) !==
          canonicalJson(JUDGE_DEMO_GATE9_COLLATERAL_PREPARATION_PATHS) ||
        canonicalJson(preparationChanges) !==
          canonicalJson(terminal.collateralPreparation.treeChanges) ||
        (await canonicalSha256(preparationChanges)) !==
          terminal.collateralPreparation.gitTreeProjectionHash ||
        (ciFinalization !== null &&
          (canonicalJson(ciFinalizationChanges.map(({ path }) => path)) !==
            canonicalJson(JUDGE_DEMO_GATE9_CI_FINALIZATION_PATHS) ||
            canonicalJson(ciFinalizationChanges) !== canonicalJson(ciFinalization.treeChanges) ||
            (await canonicalSha256(ciFinalizationChanges)) !==
              ciFinalization.gitTreeProjectionHash)) ||
        (ciPortabilityRepair !== null &&
          (canonicalJson(ciPortabilityRepairChanges.map(({ path }) => path)) !==
            canonicalJson(JUDGE_DEMO_GATE9_CI_PORTABILITY_REPAIR_PATHS) ||
            canonicalJson(ciPortabilityRepairChanges) !==
              canonicalJson(ciPortabilityRepair.treeChanges) ||
            (await canonicalSha256(ciPortabilityRepairChanges)) !==
              ciPortabilityRepair.gitTreeProjectionHash)) ||
        (impactExecutionFinalization !== null &&
          (canonicalJson(impactExecutionProtocolChanges.map(({ path }) => path)) !==
            canonicalJson(JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS) ||
            canonicalJson(impactExecutionPresentationChanges.map(({ path }) => path)) !==
              canonicalJson(JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS) ||
            (await canonicalSha256(JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS)) !==
              impactExecutionFinalization.protocol.changedPathsHash ||
            (await canonicalSha256(JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS)) !==
              impactExecutionFinalization.presentation.changedPathsHash ||
            (await canonicalSha256(impactExecutionProtocolChanges)) !==
              impactExecutionFinalization.protocol.gitTreeProjectionHash ||
            (await canonicalSha256(impactExecutionPresentationChanges)) !==
              impactExecutionFinalization.presentation.gitTreeProjectionHash ||
            (impactExecutionCiTimeoutRepair !== null &&
              (canonicalJson(impactExecutionCiTimeoutRepairChanges.map(({ path }) => path)) !==
                canonicalJson(JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_REPAIR_PATHS) ||
                canonicalJson(impactExecutionCiTimeoutRepairChanges) !==
                  canonicalJson(impactExecutionCiTimeoutRepair.treeChanges) ||
                (await canonicalSha256(impactExecutionCiTimeoutRepairChanges)) !==
                  impactExecutionCiTimeoutRepair.gitTreeProjectionHash)) ||
            (originAliasFinalization !== null &&
              (originAliasFinalization.protocol.predecessorCommit !==
                JUDGE_DEMO_ORIGIN_ALIAS_PREDECESSOR_COMMIT ||
                originAliasFinalization.protocol.predecessorTree !==
                  JUDGE_DEMO_ORIGIN_ALIAS_PREDECESSOR_TREE ||
                canonicalJson(originAliasFinalization.protocol.commits) !==
                  canonicalJson(
                    firstParentCommitChain(
                      input.cwd,
                      originAliasFinalization.protocol.predecessorCommit,
                      originAliasFinalization.protocol.successorCommit
                    ).slice(1)
                  ) ||
                canonicalJson(originAliasProtocolChanges.map(({ path }) => path)) !==
                  canonicalJson(JUDGE_DEMO_ORIGIN_ALIAS_PROTOCOL_PATHS) ||
                canonicalJson(originAliasImplementationChanges.map(({ path }) => path)) !==
                  canonicalJson(JUDGE_DEMO_ORIGIN_ALIAS_IMPLEMENTATION_PATHS) ||
                (await canonicalSha256(JUDGE_DEMO_ORIGIN_ALIAS_PROTOCOL_PATHS)) !==
                  JUDGE_DEMO_ORIGIN_ALIAS_PROTOCOL_PATHS_HASH ||
                (await canonicalSha256(JUDGE_DEMO_ORIGIN_ALIAS_IMPLEMENTATION_PATHS)) !==
                  JUDGE_DEMO_ORIGIN_ALIAS_IMPLEMENTATION_PATHS_HASH ||
                (await canonicalSha256(originAliasProtocolChanges)) !==
                  originAliasFinalization.protocol.gitTreeProjectionHash ||
                (await canonicalSha256(originAliasImplementationChanges)) !==
                  originAliasFinalization.implementation.gitTreeProjectionHash ||
                (originAliasCheckoutRepair !== null &&
                  (originAliasCheckoutRepair.predecessorCommit !==
                    originAliasFinalization.implementation.successorCommit ||
                    originAliasCheckoutRepair.predecessorTree !==
                      originAliasFinalization.implementation.successorTree ||
                    canonicalJson(originAliasCheckoutRepair.commits) !==
                      canonicalJson(
                        firstParentCommitChain(
                          input.cwd,
                          originAliasCheckoutRepair.predecessorCommit,
                          originAliasCheckoutRepair.successorCommit
                        ).slice(1)
                      ) ||
                    canonicalJson(originAliasCheckoutRepairChanges.map(({ path }) => path)) !==
                      canonicalJson(JUDGE_DEMO_ORIGIN_ALIAS_CHECKOUT_REPAIR_PATHS) ||
                    (await canonicalSha256(JUDGE_DEMO_ORIGIN_ALIAS_CHECKOUT_REPAIR_PATHS)) !==
                      JUDGE_DEMO_ORIGIN_ALIAS_CHECKOUT_REPAIR_PATHS_HASH ||
                    (await canonicalSha256(originAliasCheckoutRepairChanges)) !==
                      originAliasCheckoutRepair.gitTreeProjectionHash))))))))
  ) {
    throw new Error("judge_demo_invocation_evidence_projection_invalid");
  }
  for (const change of protocolChanges) {
    const valid =
      change.status === "M" &&
      change.predecessorMode === "100644" &&
      change.successorMode === "100644" &&
      change.predecessorBlobOid !== null &&
      change.successorBlobOid !== null &&
      change.predecessorBlobOid !== change.successorBlobOid;
    if (!valid) {
      throw new Error(`judge_demo_invocation_evidence_protocol_mode_invalid:${change.path}`);
    }
  }
  for (const change of evidenceChanges) {
    assertSafeMaterialTreeMutation(change, "judge_demo_invocation_evidence_mode_invalid");
  }
  for (const change of finalizationChanges) {
    if (
      change.status !== "M" ||
      change.predecessorMode !== "100644" ||
      change.successorMode !== "100644" ||
      change.predecessorBlobOid === null ||
      change.successorBlobOid === null
    ) {
      throw new Error(`judge_demo_gate9_protocol_finalization_mode_invalid:${change.path}`);
    }
  }
  for (const change of preparationChanges) {
    assertSafeMaterialTreeMutation(change, "judge_demo_gate9_collateral_preparation_mode_invalid");
  }
  for (const change of ciFinalizationChanges) {
    if (
      change.status !== "M" ||
      change.predecessorMode !== "100644" ||
      change.successorMode !== "100644" ||
      change.predecessorBlobOid === null ||
      change.successorBlobOid === null
    ) {
      throw new Error(`judge_demo_gate9_ci_finalization_mode_invalid:${change.path}`);
    }
  }
  for (const change of ciPortabilityRepairChanges) {
    if (
      change.status !== "M" ||
      change.predecessorMode !== "100644" ||
      change.successorMode !== "100644" ||
      change.predecessorBlobOid === null ||
      change.successorBlobOid === null
    ) {
      throw new Error(`judge_demo_gate9_ci_portability_mode_invalid:${change.path}`);
    }
  }
  for (const change of impactExecutionProtocolChanges) {
    if (
      change.status !== "M" ||
      change.predecessorMode !== "100644" ||
      change.successorMode !== "100644" ||
      change.predecessorBlobOid === null ||
      change.successorBlobOid === null ||
      change.predecessorBlobOid === change.successorBlobOid
    ) {
      throw new Error(`judge_demo_impact_execution_protocol_mode_invalid:${change.path}`);
    }
  }
  for (const change of impactExecutionPresentationChanges) {
    if (
      change.status !== "M" ||
      change.predecessorMode !== "100644" ||
      change.successorMode !== "100644" ||
      change.predecessorBlobOid === null ||
      change.successorBlobOid === null ||
      change.predecessorBlobOid === change.successorBlobOid
    ) {
      throw new Error(`judge_demo_impact_execution_presentation_mode_invalid:${change.path}`);
    }
  }
  for (const change of impactExecutionCiTimeoutRepairChanges) {
    if (
      change.status !== "M" ||
      change.predecessorMode !== "100644" ||
      change.successorMode !== "100644" ||
      change.predecessorBlobOid === null ||
      change.successorBlobOid === null ||
      change.predecessorBlobOid === change.successorBlobOid
    ) {
      throw new Error(`judge_demo_impact_execution_ci_timeout_mode_invalid:${change.path}`);
    }
  }
  for (const change of [
    ...originAliasProtocolChanges,
    ...originAliasImplementationChanges,
    ...originAliasCheckoutRepairChanges
  ]) {
    if (
      change.status !== "M" ||
      change.predecessorMode !== "100644" ||
      change.successorMode !== "100644" ||
      change.predecessorBlobOid === null ||
      change.successorBlobOid === null ||
      change.predecessorBlobOid === change.successorBlobOid
    ) {
      throw new Error(`judge_demo_origin_alias_mode_invalid:${change.path}`);
    }
  }
  const terminalImpactCommit =
    originAliasCheckoutRepair?.successorCommit ??
    originAliasFinalization?.implementation.successorCommit ??
    impactExecutionCiTimeoutRepair?.successorCommit ??
    impactExecutionFinalization?.presentation.successorCommit ??
    null;
  if (impactExecutionFinalization !== null && terminalImpactCommit !== null) {
    for (const path of JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS) {
      const protocolEntry = treeEntry(
        input.cwd,
        impactExecutionFinalization.protocol.successorCommit,
        path
      );
      const presentationEntry = treeEntry(
        input.cwd,
        impactExecutionFinalization.presentation.successorCommit,
        path
      );
      if (
        protocolEntry === null ||
        presentationEntry === null ||
        protocolEntry.mode !== "100644" ||
        canonicalJson(protocolEntry) !== canonicalJson(presentationEntry)
      ) {
        throw new Error(`judge_demo_impact_execution_protocol_checkout_drift:${path}`);
      }
      await activeCheckoutBlobBytes(input.cwd, terminalImpactCommit, path);
    }
    for (const path of JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS) {
      await activeCheckoutBlobBytes(input.cwd, terminalImpactCommit, path);
    }
    const frozenLabEntry = treeEntry(
      input.cwd,
      impactExecutionFinalization.presentation.successorCommit,
      JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH
    );
    const frozenLabBytes = await activeCheckoutBlobBytes(
      input.cwd,
      terminalImpactCommit,
      JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH
    );
    if (
      frozenLabEntry?.mode !== "100644" ||
      frozenLabEntry.blobOid !== JUDGE_DEMO_IMPACT_EXECUTION_LAB_CLIENT_U_BLOB_OID ||
      sha256(frozenLabBytes) !== JUDGE_DEMO_IMPACT_EXECUTION_LAB_CLIENT_U_SHA256
    ) {
      throw new Error("judge_demo_impact_execution_lab_client_presentation_invalid");
    }
    if (impactExecutionCiTimeoutRepair !== null) {
      if (originAliasFinalization === null) {
        for (const path of JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_REPAIR_PATHS) {
          await activeCheckoutBlobBytes(
            input.cwd,
            impactExecutionCiTimeoutRepair.successorCommit,
            path
          );
        }
      }
    }
  }
  if (originAliasFinalization !== null) {
    for (const path of JUDGE_DEMO_ORIGIN_ALIAS_PROTOCOL_PATHS) {
      const protocolEntry = treeEntry(
        input.cwd,
        originAliasFinalization.protocol.successorCommit,
        path
      );
      const implementationEntry = treeEntry(
        input.cwd,
        originAliasFinalization.implementation.successorCommit,
        path
      );
      if (
        protocolEntry === null ||
        implementationEntry === null ||
        protocolEntry.mode !== "100644" ||
        canonicalJson(protocolEntry) !== canonicalJson(implementationEntry)
      ) {
        throw new Error(`judge_demo_origin_alias_protocol_drift:${path}`);
      }
    }
    for (const path of JUDGE_DEMO_ORIGIN_ALIAS_IMPLEMENTATION_PATHS) {
      await activeCheckoutBlobBytes(
        input.cwd,
        originAliasFinalization.implementation.successorCommit,
        path
      );
    }
    if (originAliasCheckoutRepair !== null) {
      for (const path of JUDGE_DEMO_ORIGIN_ALIAS_CHECKOUT_REPAIR_PATHS) {
        await activeCheckoutBlobBytes(input.cwd, originAliasCheckoutRepair.successorCommit, path);
      }
    }
  }
  if (ciFinalization !== null) {
    const testSource = new TextDecoder("utf-8", { fatal: true }).decode(
      await activeCheckoutBlobBytes(
        input.cwd,
        originAliasCheckoutRepair?.successorCommit ??
          originAliasFinalization?.implementation.successorCommit ??
          impactExecutionCiTimeoutRepair?.successorCommit ??
          impactExecutionFinalization?.presentation.successorCommit ??
          ciPortabilityRepair?.successorCommit ??
          ciFinalization.successorCommit,
        "tests/integration/judge-presentation.test.ts"
      )
    );
    const setCount = testSource.match(/const predecessorBlobOids = new Set\(/gu)?.length ?? 0;
    const uniqueLoopCount =
      testSource.match(/for \(const predecessorBlobOid of predecessorBlobOids\)/gu)?.length ?? 0;
    const packedRepackCount =
      testSource.match(/git\(value\.cwd, \["repack", "-a", "-d"\]\);/gu)?.length ?? 0;
    const packedPruneCount =
      testSource.match(/git\(value\.cwd, \["prune-packed"\]\);/gu)?.length ?? 0;
    const enoentOnlyCount =
      testSource.match(
        /if \(\(error as NodeJS\.ErrnoException\)\.code !== "ENOENT"\) throw error;/gu
      )?.length ?? 0;
    const packedPresenceCount =
      testSource.match(
        /expect\(\(\) => git\(value\.cwd, \["cat-file", "-e", predecessorBlobOid\]\)\)\.not\.toThrow\(\);/gu
      )?.length ?? 0;
    const missingAbsenceCount =
      testSource.match(
        /expect\(\(\) => git\(value\.cwd, \["cat-file", "-e", predecessorBlobOid\]\)\)\.toThrow\(\);/gu
      )?.length ?? 0;
    if (
      setCount !== 2 ||
      uniqueLoopCount !== 2 ||
      (ciPortabilityRepair !== null &&
        (packedRepackCount !== 1 ||
          packedPruneCount !== 1 ||
          enoentOnlyCount !== 1 ||
          packedPresenceCount !== 1 ||
          missingAbsenceCount !== 1))
    ) {
      throw new Error("judge_demo_gate9_ci_finalization_dedupe_invariant_invalid");
    }
  }
  const [jsonBytes, markdownBytes, measuredBytes] = await Promise.all([
    activeCheckoutBlobBytes(
      input.cwd,
      input.transition.successorCommit,
      "evidence/thurstone-invocation-integrity.json"
    ),
    activeCheckoutBlobBytes(
      input.cwd,
      input.transition.successorCommit,
      "evidence/thurstone-invocation-integrity.md"
    ),
    activeCheckoutBlobBytes(
      input.cwd,
      input.transition.successorCommit,
      "lib/results/invocation-integrity-measured.ts"
    )
  ]);
  if (
    sha256(jsonBytes) !== input.transition.evidence.jsonExportSha256 ||
    sha256(markdownBytes) !== input.transition.evidence.markdownExportSha256 ||
    sha256(measuredBytes) !== input.transition.evidence.measuredSourceSha256
  ) {
    throw new Error("judge_demo_invocation_evidence_file_digest_invalid");
  }
  let document: Record<string, unknown>;
  try {
    document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(jsonBytes)) as Record<
      string,
      unknown
    >;
  } catch {
    throw new Error("judge_demo_invocation_evidence_json_invalid");
  }
  const score = document.score as Record<string, unknown> | undefined;
  if (
    document.evidenceClass !== "supplemental-invocation-integrity" ||
    document.modelCallCount !== 0 ||
    document.includedInSemanticDenominator !== false ||
    document.packageDigest !== input.transition.evidence.supplementalPackageDigest ||
    score?.earned !== 3 ||
    score.possible !== 3
  ) {
    throw new Error("judge_demo_invocation_evidence_claim_invalid");
  }
}

async function verifyTransitionGit(input: {
  readonly transition: JudgeDemoPresentationTransition;
  readonly activeCommit: string;
  readonly cwd: string;
  readonly predecessorBindingAnchored?: boolean;
}): Promise<{
  readonly treeChanges: readonly GitTreeChange[];
  readonly criticalEntries: readonly CriticalTreeEntry[];
}> {
  const predecessor = execFileSync(
    "git",
    ["rev-parse", "--verify", `${input.transition.predecessorCommit}^{commit}`],
    { cwd: input.cwd, encoding: "utf8", maxBuffer: 1_048_576 }
  ).trim();
  const successor = execFileSync(
    "git",
    ["rev-parse", "--verify", `${input.transition.successorCommit}^{commit}`],
    { cwd: input.cwd, encoding: "utf8", maxBuffer: 1_048_576 }
  ).trim();
  if (
    predecessor !== input.transition.predecessorCommit ||
    successor !== input.transition.successorCommit
  ) {
    throw new Error("judge_demo_presentation_git_identity_invalid");
  }
  const actualFirstParentChain = firstParentCommitChain(input.cwd, predecessor, successor);
  if (input.transition.kind === "sealed-reader-compatibility-recovery") {
    await verifyRecoveryFinalization({
      cwd: input.cwd,
      transition: input.transition,
      firstParentChain: actualFirstParentChain,
      terminalActiveCommit: input.activeCommit,
      predecessorBindingAnchored: input.predecessorBindingAnchored ?? false
    });
  } else if (input.transition.kind === "presentation-rebrand") {
    await verifyPresentationRebrand({
      cwd: input.cwd,
      transition: input.transition,
      firstParentChain: actualFirstParentChain,
      terminalActiveCommit: input.activeCommit
    });
  } else if (input.transition.kind === "invocation-integrity") {
    await verifyInvocationIntegrity({
      cwd: input.cwd,
      transition: input.transition,
      firstParentChain: actualFirstParentChain
    });
  } else if (input.transition.kind === "invocation-integrity-evidence") {
    await verifyInvocationIntegrityEvidenceCheckout({
      cwd: input.cwd,
      transition: input.transition,
      firstParentChain: actualFirstParentChain
    });
  } else if (actualFirstParentChain.length !== 2) {
    throw new Error("judge_demo_presentation_transition_not_direct_child");
  }
  if ((await canonicalSha256(actualFirstParentChain)) !== input.transition.firstParentChainHash) {
    throw new Error("judge_demo_presentation_first_parent_chain_mismatch");
  }
  const rawTreeChanges = gitTreeChanges(input.cwd, predecessor, successor);
  const actualTreeChanges =
    input.transition.kind === "invocation-integrity-evidence"
      ? [...rawTreeChanges].sort((left, right) =>
          judgeDemoInvocationIntegrityEvidencePathCompare(left.path, right.path)
        )
      : rawTreeChanges;
  if (
    input.transition.kind === "collateral-links" &&
    actualTreeChanges.some(
      (change) =>
        change.status !== "M" ||
        change.predecessorMode !== "100644" ||
        change.successorMode !== "100644" ||
        change.predecessorBlobOid === null ||
        change.successorBlobOid === null
    )
  ) {
    throw new Error("judge_demo_presentation_collateral_tree_mode_invalid");
  }
  if ((await canonicalSha256(actualTreeChanges)) !== input.transition.gitTreeProjectionHash) {
    throw new Error("judge_demo_presentation_git_tree_projection_mismatch");
  }
  const actualChangedPaths = actualTreeChanges.map(({ path }) => path);
  actualChangedPaths.sort(
    input.transition.kind === "invocation-integrity-evidence"
      ? judgeDemoInvocationIntegrityEvidencePathCompare
      : undefined
  );
  const expectedChangedPaths =
    input.transition.kind === "sealed-reader-compatibility-recovery"
      ? JUDGE_DEMO_RECOVERY_PATHS
      : input.transition.kind === "presentation-rebrand"
        ? [...JUDGE_DEMO_REBRAND_PROTOCOL_PATHS, ...JUDGE_DEMO_REBRAND_BRANDING_PATHS].sort()
        : input.transition.kind === "invocation-integrity"
          ? [
              JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_PATH,
              ...JUDGE_DEMO_INVOCATION_INTEGRITY_PROTOCOL_PATHS,
              ...input.transition.implementation.changedPaths
            ].sort()
          : input.transition.kind === "invocation-integrity-evidence"
            ? [
                ...new Set([
                  ...JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_PROTOCOL_PATHS,
                  ...input.transition.evidence.changedPaths,
                  ...(input.transition.terminalFinalization?.protocolFinalization.changedPaths ??
                    []),
                  ...(input.transition.terminalFinalization?.collateralPreparation.changedPaths ??
                    []),
                  ...(input.transition.terminalFinalization?.ciFinalization?.changedPaths ?? []),
                  ...(input.transition.terminalFinalization?.ciPortabilityRepair?.changedPaths ??
                    []),
                  ...(input.transition.terminalFinalization?.impactExecutionFinalization ===
                  undefined
                    ? []
                    : [
                        ...JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS,
                        ...JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS,
                        ...(input.transition.terminalFinalization?.impactExecutionFinalization
                          ?.ciTimeoutRepair === undefined
                          ? []
                          : JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_REPAIR_PATHS),
                        ...(input.transition.terminalFinalization?.impactExecutionFinalization
                          ?.originAliasFinalization === undefined
                          ? []
                          : [
                              ...JUDGE_DEMO_ORIGIN_ALIAS_PROTOCOL_PATHS,
                              ...JUDGE_DEMO_ORIGIN_ALIAS_IMPLEMENTATION_PATHS,
                              ...(input.transition.terminalFinalization.impactExecutionFinalization
                                .originAliasFinalization.checkoutRepair === undefined
                                ? []
                                : JUDGE_DEMO_ORIGIN_ALIAS_CHECKOUT_REPAIR_PATHS)
                            ])
                      ])
                ])
              ].sort(judgeDemoInvocationIntegrityEvidencePathCompare)
            : [...new Set(input.transition.collateralChanges.map(({ path }) => path))].sort();
  if (canonicalJson(actualChangedPaths) !== canonicalJson(expectedChangedPaths)) {
    throw new Error("judge_demo_presentation_actual_diff_mismatch");
  }

  const criticalEntries = JUDGE_DEMO_CRITICAL_PATHS.map((path) => {
    const predecessorEntry = treeEntry(input.cwd, predecessor, path);
    const successorEntry = treeEntry(input.cwd, successor, path);
    if (predecessorEntry === null || successorEntry === null) {
      throw new Error(`judge_demo_presentation_critical_file_missing:${path}`);
    }
    return {
      path,
      predecessorBlobOid: predecessorEntry.blobOid,
      successorBlobOid: successorEntry.blobOid
    };
  });
  const changedCriticalPaths = criticalEntries
    .filter(({ predecessorBlobOid, successorBlobOid }) => predecessorBlobOid !== successorBlobOid)
    .map(({ path }) => path);
  const transition = input.transition;
  if (
    (transition.kind === "sealed-reader-compatibility-recovery" &&
      changedCriticalPaths.some((path) => !JUDGE_DEMO_RECOVERY_PATHS.includes(path))) ||
    (transition.kind === "presentation-rebrand" &&
      changedCriticalPaths.some(
        (path) =>
          !JUDGE_DEMO_REBRAND_PROTOCOL_PATHS.includes(
            path as (typeof JUDGE_DEMO_REBRAND_PROTOCOL_PATHS)[number]
          ) &&
          !JUDGE_DEMO_REBRAND_BRANDING_PATHS.includes(
            path as (typeof JUDGE_DEMO_REBRAND_BRANDING_PATHS)[number]
          )
      )) ||
    (transition.kind === "invocation-integrity" &&
      changedCriticalPaths.some(
        (path) =>
          path !== JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_PATH &&
          !JUDGE_DEMO_INVOCATION_INTEGRITY_PROTOCOL_PATHS.includes(path) &&
          !transition.implementation.changedPaths.includes(path)
      )) ||
    (transition.kind === "invocation-integrity-evidence" &&
      changedCriticalPaths.some(
        (path) =>
          !JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_PROTOCOL_PATHS.includes(path) &&
          !transition.evidence.changedPaths.includes(path) &&
          !(
            transition.terminalFinalization?.protocolFinalization.changedPaths.includes(path) ??
            false
          ) &&
          !(
            transition.terminalFinalization?.collateralPreparation.changedPaths.includes(path) ??
            false
          ) &&
          !(
            transition.terminalFinalization?.ciFinalization?.changedPaths.includes(path) ?? false
          ) &&
          !(
            transition.terminalFinalization?.ciPortabilityRepair?.changedPaths.includes(path) ??
            false
          ) &&
          !(
            transition.terminalFinalization?.impactExecutionFinalization !== undefined &&
            (JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS.includes(path) ||
              JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS.includes(path) ||
              (transition.terminalFinalization.impactExecutionFinalization.ciTimeoutRepair !==
                undefined &&
                JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_REPAIR_PATHS.includes(path)) ||
              (transition.terminalFinalization.impactExecutionFinalization
                .originAliasFinalization !== undefined &&
                (JUDGE_DEMO_ORIGIN_ALIAS_PROTOCOL_PATHS.includes(path) ||
                  JUDGE_DEMO_ORIGIN_ALIAS_IMPLEMENTATION_PATHS.includes(path) ||
                  (transition.terminalFinalization.impactExecutionFinalization
                    .originAliasFinalization.checkoutRepair !== undefined &&
                    JUDGE_DEMO_ORIGIN_ALIAS_CHECKOUT_REPAIR_PATHS.includes(path)))))
          )
      )) ||
    (transition.kind === "collateral-links" && changedCriticalPaths.length !== 0)
  ) {
    throw new Error("judge_demo_presentation_critical_invariant_mismatch");
  }
  if (input.transition.kind === "collateral-links") {
    await verifyCollateralChanges(input.cwd, input.transition, input.activeCommit);
  }
  return Object.freeze({ treeChanges: actualTreeChanges, criticalEntries });
}

async function checkoutEntry(
  cwd: string,
  path: string
): Promise<{
  readonly bytes: Buffer;
  readonly mode: string;
} | null> {
  try {
    const [bytes, metadata] = await Promise.all([
      readFile(`${cwd}/${path}`),
      lstat(`${cwd}/${path}`)
    ]);
    if (!metadata.isFile()) throw new Error(`judge_demo_presentation_active_checkout_type:${path}`);
    return Object.freeze({
      bytes,
      mode: (metadata.mode & 0o111) === 0 ? "100644" : "100755"
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function assertCheckoutMatchesActive(input: {
  readonly binding: JudgeDemoPresentationBinding;
  readonly verifiedTransitions: readonly VerifiedTransitionGit[];
  readonly cwd: string;
}): Promise<string> {
  const paths = [
    ...new Set([
      ...JUDGE_DEMO_CRITICAL_PATHS,
      ...input.verifiedTransitions.flatMap(({ treeChanges: changes }) =>
        changes.map(({ path }) => path)
      )
    ])
  ].sort();
  const activeCriticalSha256 = new Map<string, string>();
  const invocationTransition = input.binding.transitions.find(
    ({ kind }) => kind === "invocation-integrity"
  );
  const rebrandTransition = input.binding.transitions.find(
    ({ kind }) => kind === "presentation-rebrand"
  );
  for (const path of paths) {
    const expected = treeEntry(input.cwd, input.binding.activeCommit, path);
    const isCritical = JUDGE_DEMO_CRITICAL_PATHS.includes(path);
    const excluded = judgeDemoPathExcludedFromDeployment(path);
    if (excluded && !isCritical) continue;
    if (
      excluded &&
      isCritical &&
      path === ".env.example" &&
      invocationTransition?.kind === "invocation-integrity" &&
      rebrandTransition?.kind === "presentation-rebrand"
    ) {
      const rebrandEntry = treeEntry(input.cwd, rebrandTransition.successorCommit, path);
      const sealedFile = rebrandTransition.branding.files.find((file) => file.path === path);
      if (
        expected === null ||
        rebrandEntry === null ||
        expected.mode !== "100644" ||
        rebrandEntry.mode !== expected.mode ||
        rebrandEntry.blobOid !== expected.blobOid ||
        !sealedFile
      ) {
        throw new Error(`judge_demo_presentation_active_checkout_mismatch:${path}`);
      }
      activeCriticalSha256.set(path, sealedFile.sha256);
      continue;
    }
    const actual = excluded
      ? (() => {
          const bytes = gitBlobBytes(input.cwd, input.binding.activeCommit, path);
          return bytes === null ? null : { bytes, mode: expected?.mode ?? "" };
        })()
      : await checkoutEntry(input.cwd, path);
    if (
      (expected === null && actual !== null) ||
      (expected !== null && actual === null) ||
      (expected !== null &&
        actual !== null &&
        (expected.mode !== actual.mode || expected.blobOid !== blobOid(actual.bytes)))
    ) {
      throw new Error(`judge_demo_presentation_active_checkout_mismatch:${path}`);
    }
    if (actual !== null && isCritical) {
      activeCriticalSha256.set(path, sha256(actual.bytes));
    }
  }

  const activeMaterialTransition = [...input.verifiedTransitions]
    .reverse()
    .find(({ transition }) => transition.kind !== "collateral-links");
  if (!activeMaterialTransition) {
    throw new Error("judge_demo_presentation_active_material_transition_missing");
  }
  for (const verified of [activeMaterialTransition]) {
    const criticalProjection = verified.criticalEntries.map((file) => {
      const activeEntry = treeEntry(input.cwd, input.binding.activeCommit, file.path);
      const activeSha256 = activeCriticalSha256.get(file.path);
      if (activeEntry === null || !activeSha256 || file.successorBlobOid !== activeEntry.blobOid) {
        throw new Error(`judge_demo_presentation_active_critical_mismatch:${file.path}`);
      }
      return { ...file, successorSha256: activeSha256 };
    });
    if (
      (await canonicalSha256(criticalProjection)) !== verified.transition.criticalProjectionHash
    ) {
      throw new Error("judge_demo_presentation_critical_projection_mismatch");
    }
  }

  const packageSource = await readFile(`${input.cwd}/package.json`, "utf8");
  const packageJson = JSON.parse(packageSource) as {
    readonly dependencies?: unknown;
    readonly devDependencies?: unknown;
    readonly engines?: unknown;
  };
  const currentDependencyHash = await dependencyProjectionHash({
    dependencies: packageJson.dependencies ?? null,
    devDependencies: packageJson.devDependencies ?? null,
    engines: packageJson.engines ?? null
  });
  if (
    input.binding.transitions.some(
      ({ dependencyProjectionHash: expected }) => expected !== currentDependencyHash
    )
  ) {
    throw new Error("judge_demo_presentation_dependency_mismatch");
  }
  return currentDependencyHash;
}

export async function verifyJudgeDemoPresentationCheckout(input: {
  readonly binding: JudgeDemoPresentationBinding;
  readonly cwd: string;
}): Promise<{
  readonly transitionCount: number;
  readonly changedPathCount: number;
  readonly criticalFileCount: number;
  readonly dependencyProjectionHash: string;
}> {
  const verifiedTransitions: VerifiedTransitionGit[] = [];
  const rebrandTransition = input.binding.transitions.find(
    ({ kind }) => kind === "presentation-rebrand"
  );
  const rebrandPredecessorBindingValid =
    rebrandTransition?.kind === "presentation-rebrand" &&
    rebrandTransition.predecessorBinding.bindingHash ===
      JUDGE_DEMO_REBRAND_PREDECESSOR_BINDING_HASH &&
    input.binding.transitions[0]?.proofHash ===
      JUDGE_DEMO_REBRAND_PREDECESSOR_TRANSITION_PROOF_HASH;
  if (rebrandTransition && !rebrandPredecessorBindingValid) {
    throw new Error("judge_demo_rebrand_predecessor_binding_invalid");
  }
  const invocationTransition = input.binding.transitions.find(
    ({ kind }) => kind === "invocation-integrity"
  );
  const invocationPredecessorBindingValid =
    invocationTransition?.kind === "invocation-integrity" &&
    invocationTransition.predecessorCommit === JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_COMMIT &&
    invocationTransition.predecessorBinding.bindingHash ===
      JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_BINDING_HASH &&
    invocationTransition.predecessorBinding.reviewedArtifactSha256 ===
      JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_BINDING_ARTIFACT_SHA256 &&
    rebrandTransition?.kind === "presentation-rebrand" &&
    rebrandTransition.successorCommit === JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_COMMIT;
  if (invocationTransition && !invocationPredecessorBindingValid) {
    throw new Error("judge_demo_invocation_predecessor_binding_invalid");
  }
  const recoveryTerminalCheckoutDeferred = input.binding.transitions.length > 1;
  for (const transition of input.binding.transitions) {
    if (invocationTransition && transition.kind === "sealed-reader-compatibility-recovery") {
      if (transition.proofHash !== JUDGE_DEMO_REBRAND_PREDECESSOR_TRANSITION_PROOF_HASH) {
        throw new Error("judge_demo_invocation_sealed_recovery_invalid");
      }
      verifiedTransitions.push({ transition, treeChanges: [], criticalEntries: [] });
      continue;
    }
    if (invocationTransition && transition.kind === "presentation-rebrand") {
      if (transition.proofHash !== JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_REBRAND_PROOF_HASH) {
        throw new Error("judge_demo_invocation_sealed_rebrand_invalid");
      }
      const treeChanges = [
        ...transition.protocolExtension.treeChanges,
        ...transition.branding.treeChanges
      ].sort((left, right) => left.path.localeCompare(right.path));
      verifiedTransitions.push({ transition, treeChanges, criticalEntries: [] });
      continue;
    }
    const result = await verifyTransitionGit({
      transition,
      activeCommit: input.binding.activeCommit,
      cwd: input.cwd,
      predecessorBindingAnchored:
        recoveryTerminalCheckoutDeferred &&
        transition.kind === "sealed-reader-compatibility-recovery"
    });
    verifiedTransitions.push({ transition, ...result });
  }
  const currentDependencyHash = await assertCheckoutMatchesActive({
    ...input,
    verifiedTransitions
  });
  return Object.freeze({
    transitionCount: input.binding.transitions.length,
    changedPathCount: verifiedTransitions.reduce(
      (sum, { treeChanges: changes }) => sum + changes.length,
      0
    ),
    criticalFileCount: JUDGE_DEMO_CRITICAL_PATHS.length,
    dependencyProjectionHash: currentDependencyHash
  });
}

/** Compatibility helper for focused transition tests. */
export async function verifyJudgeDemoCollateralCheckout(input: {
  readonly proof: JudgeDemoPresentationTransition;
  readonly cwd: string;
}): Promise<{
  readonly changedPathCount: number;
  readonly criticalFileCount: number;
  readonly dependencyProjectionHash: string;
}> {
  const result = await verifyTransitionGit({
    transition: input.proof,
    activeCommit: input.proof.successorCommit,
    cwd: input.cwd
  });
  return Object.freeze({
    changedPathCount: result.treeChanges.length,
    criticalFileCount: result.criticalEntries.length,
    dependencyProjectionHash: input.proof.dependencyProjectionHash
  });
}
