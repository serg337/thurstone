import "server-only";

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  JUDGE_DEMO_CI_TIMEOUT_COUNT,
  JUDGE_DEMO_CI_TIMEOUT_MS,
  JUDGE_DEMO_CI_TIMEOUT_PATH,
  JUDGE_DEMO_COLLATERAL_FIELD_PREFIXES,
  JUDGE_DEMO_CRITICAL_PATHS,
  JUDGE_DEMO_GATE9_CI_FINALIZATION_PATHS,
  JUDGE_DEMO_GATE9_COLLATERAL_PREPARATION_PATHS,
  JUDGE_DEMO_GATE9_PROTOCOL_FINALIZATION_PATHS,
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

function blobOid(bytes: Buffer): string {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
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
    if (
      validation.timeoutPath !== JUDGE_DEMO_CI_TIMEOUT_PATH ||
      validation.timeoutMs !== JUDGE_DEMO_CI_TIMEOUT_MS ||
      validation.timeoutCount !== JUDGE_DEMO_CI_TIMEOUT_COUNT ||
      timeoutCount !== JUDGE_DEMO_CI_TIMEOUT_COUNT
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

export async function verifyInvocationIntegrityEvidenceCheckout(input: {
  readonly cwd: string;
  readonly transition: JudgeDemoInvocationIntegrityEvidenceTransition;
  readonly firstParentChain: readonly string[];
}): Promise<void> {
  const protocolCommit = input.transition.protocolExtension.commit;
  const terminal = input.transition.terminalFinalization ?? null;
  const ciFinalization = terminal?.ciFinalization ?? null;
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
          ...(ciFinalization === null ? [] : [ciFinalization.successorCommit])
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
          commitTree(input.cwd, ciFinalization.successorCommit) !== ciFinalization.successorTree)))
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
              ciFinalization.gitTreeProjectionHash))))
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
  if (ciFinalization !== null) {
    const testSource = new TextDecoder("utf-8", { fatal: true }).decode(
      await activeCheckoutBlobBytes(
        input.cwd,
        ciFinalization.successorCommit,
        "tests/integration/judge-presentation.test.ts"
      )
    );
    const setCount = testSource.match(/const predecessorBlobOids = new Set\(/gu)?.length ?? 0;
    const uniqueLoopCount =
      testSource.match(/for \(const predecessorBlobOid of predecessorBlobOids\)/gu)?.length ?? 0;
    if (setCount !== 2 || uniqueLoopCount !== 2) {
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
                  ...(input.transition.terminalFinalization?.ciFinalization?.changedPaths ?? [])
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
          !(transition.terminalFinalization?.ciFinalization?.changedPaths.includes(path) ?? false)
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
