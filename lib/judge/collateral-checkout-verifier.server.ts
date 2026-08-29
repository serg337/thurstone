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
  JUDGE_DEMO_RECOVERY_FINALIZATION_PATHS,
  JUDGE_DEMO_RECOVERY_IMPLEMENTATION_COMMIT,
  JUDGE_DEMO_RECOVERY_IMPLEMENTATION_TREE,
  JUDGE_DEMO_RECOVERY_PATHS,
  type JudgeDemoCollateralField,
  type JudgeDemoCollateralPath,
  type JudgeDemoPresentationTransition
} from "@/lib/judge/collateral-proof";
import type { JudgeDemoPresentationBinding } from "@/lib/judge/presentation-binding.server";
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

function gitText(cwd: string, commit: string, path: string): string | null {
  const bytes = gitBlobBytes(cwd, commit, path);
  return bytes === null ? null : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
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

function collateralFields(source: string | null): {
  readonly remainder: string;
  readonly values: Readonly<Partial<Record<JudgeDemoCollateralField, string>>>;
} {
  const values: Partial<Record<JudgeDemoCollateralField, string>> = {};
  const remainder: string[] = [];
  for (const line of source?.split(/\r?\n/u) ?? []) {
    const match = Object.entries(JUDGE_DEMO_COLLATERAL_FIELD_PREFIXES).find(([, prefix]) =>
      line.startsWith(prefix)
    ) as [JudgeDemoCollateralField, string] | undefined;
    if (!match) {
      remainder.push(line);
      continue;
    }
    const [field, prefix] = match;
    if (values[field] !== undefined) {
      throw new Error("judge_demo_presentation_collateral_field_duplicate");
    }
    const value = line.slice(prefix.length).trim();
    if (!value) throw new Error("judge_demo_presentation_collateral_field_empty");
    values[field] = value;
  }
  return Object.freeze({ remainder: remainder.join("\n"), values: Object.freeze(values) });
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

async function verifyRecoveryFinalization(input: {
  readonly cwd: string;
  readonly transition: Extract<
    JudgeDemoPresentationTransition,
    { kind: "sealed-reader-compatibility-recovery" }
  >;
  readonly firstParentChain: readonly string[];
}): Promise<void> {
  const validation = input.transition.recoveryContract.ciTimeoutValidation ?? null;
  if (validation === null) {
    if (input.firstParentChain.length !== 2) {
      throw new Error("judge_demo_presentation_transition_not_direct_child");
    }
    return;
  }
  if (
    input.firstParentChain.length !== 3 ||
    input.firstParentChain[0] !== input.transition.predecessorCommit ||
    input.firstParentChain[1] !== JUDGE_DEMO_RECOVERY_IMPLEMENTATION_COMMIT ||
    input.firstParentChain[2] !== input.transition.successorCommit ||
    validation.implementationCommit !== JUDGE_DEMO_RECOVERY_IMPLEMENTATION_COMMIT ||
    validation.implementationTree !== JUDGE_DEMO_RECOVERY_IMPLEMENTATION_TREE ||
    commitTree(input.cwd, validation.implementationCommit) !== validation.implementationTree ||
    validation.activeCommit !== input.transition.successorCommit ||
    commitTree(input.cwd, validation.activeCommit) !== validation.activeTree
  ) {
    throw new Error("judge_demo_presentation_recovery_finalization_identity_invalid");
  }

  const actualChanges = gitTreeChanges(
    input.cwd,
    validation.implementationCommit,
    validation.activeCommit
  );
  const actualPaths = actualChanges.map(({ path }) => path);
  if (
    canonicalJson(actualPaths) !== canonicalJson(JUDGE_DEMO_RECOVERY_FINALIZATION_PATHS) ||
    canonicalJson(validation.changedPaths) !== canonicalJson(actualPaths) ||
    canonicalJson(validation.treeChanges) !== canonicalJson(actualChanges) ||
    (await canonicalSha256(actualChanges)) !== validation.gitTreeProjectionHash
  ) {
    throw new Error("judge_demo_presentation_recovery_finalization_tree_invalid");
  }

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

async function verifyCollateralChanges(
  cwd: string,
  transition: Extract<JudgeDemoPresentationTransition, { kind: "collateral-links" }>,
  activeCommit: string
): Promise<void> {
  if (transition.successorCommit !== activeCommit) {
    throw new Error("judge_demo_presentation_collateral_not_terminal");
  }
  const actual: (typeof transition.collateralChanges)[number][] = [];
  const changedPaths = [...new Set(transition.collateralChanges.map(({ path }) => path))].sort();
  for (const path of changedPaths) {
    const predecessorFields = collateralFields(gitText(cwd, transition.predecessorCommit, path));
    let successorSource: string;
    try {
      successorSource = await readFile(`${cwd}/${path}`, "utf8");
    } catch {
      throw new Error("judge_demo_presentation_collateral_successor_missing");
    }
    const successorFields = collateralFields(successorSource);
    if (predecessorFields.remainder !== successorFields.remainder) {
      throw new Error("judge_demo_presentation_non_link_change");
    }
    for (const field of Object.keys(
      JUDGE_DEMO_COLLATERAL_FIELD_PREFIXES
    ).sort() as JudgeDemoCollateralField[]) {
      const predecessorValue = predecessorFields.values[field] ?? null;
      const successorValue = successorFields.values[field] ?? null;
      if (predecessorValue === successorValue) continue;
      if (successorValue === null) {
        throw new Error("judge_demo_presentation_collateral_successor_missing");
      }
      actual.push({
        path: path as JudgeDemoCollateralPath,
        field,
        predecessorValue,
        successorValue
      });
    }
  }
  actual.sort((left, right) =>
    left.path === right.path
      ? left.field.localeCompare(right.field)
      : left.path.localeCompare(right.path)
  );
  if (canonicalJson(actual) !== canonicalJson(transition.collateralChanges)) {
    throw new Error("judge_demo_presentation_collateral_change_mismatch");
  }
}

async function verifyTransitionGit(input: {
  readonly transition: JudgeDemoPresentationTransition;
  readonly activeCommit: string;
  readonly cwd: string;
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
      firstParentChain: actualFirstParentChain
    });
  } else if (actualFirstParentChain.length !== 2) {
    throw new Error("judge_demo_presentation_transition_not_direct_child");
  }
  if ((await canonicalSha256(actualFirstParentChain)) !== input.transition.firstParentChainHash) {
    throw new Error("judge_demo_presentation_first_parent_chain_mismatch");
  }
  const actualTreeChanges = gitTreeChanges(input.cwd, predecessor, successor);
  if ((await canonicalSha256(actualTreeChanges)) !== input.transition.gitTreeProjectionHash) {
    throw new Error("judge_demo_presentation_git_tree_projection_mismatch");
  }
  const actualChangedPaths = actualTreeChanges.map(({ path }) => path).sort();
  const expectedChangedPaths =
    input.transition.kind === "sealed-reader-compatibility-recovery"
      ? JUDGE_DEMO_RECOVERY_PATHS
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
  if (
    (input.transition.kind === "sealed-reader-compatibility-recovery" &&
      changedCriticalPaths.some((path) => !JUDGE_DEMO_RECOVERY_PATHS.includes(path))) ||
    (input.transition.kind === "collateral-links" && changedCriticalPaths.length !== 0)
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
  for (const path of paths) {
    const expected = treeEntry(input.cwd, input.binding.activeCommit, path);
    const isCritical = JUDGE_DEMO_CRITICAL_PATHS.includes(path);
    const excluded = judgeDemoPathExcludedFromDeployment(path);
    if (excluded && !isCritical) continue;
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

  for (const verified of input.verifiedTransitions) {
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
  for (const transition of input.binding.transitions) {
    const result = await verifyTransitionGit({
      transition,
      activeCommit: input.binding.activeCommit,
      cwd: input.cwd
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
