import "server-only";

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import { canonicalJson } from "@/lib/evidence/digest";
import {
  JUDGE_DEMO_COLLATERAL_FIELD_PREFIXES,
  type JudgeDemoCollateralField,
  type JudgeDemoCollateralPath,
  type JudgeDemoCollateralProof
} from "@/lib/judge/collateral-proof";
import { dependencyProjectionHash } from "@/lib/results/presentation-proof";

function gitFile(cwd: string, commit: string, path: string): string | null {
  try {
    return execFileSync("git", ["show", `${commit}:${path}`], {
      cwd,
      encoding: "utf8",
      maxBuffer: 1_048_576
    });
  } catch {
    return null;
  }
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

export async function verifyJudgeDemoCollateralCheckout(input: {
  readonly proof: JudgeDemoCollateralProof;
  readonly cwd: string;
}): Promise<{
  readonly changedPathCount: number;
  readonly criticalFileCount: number;
  readonly dependencyProjectionHash: string;
}> {
  const predecessor = execFileSync(
    "git",
    ["rev-parse", "--verify", `${input.proof.predecessorCommit}^{commit}`],
    { cwd: input.cwd, encoding: "utf8", maxBuffer: 1_048_576 }
  ).trim();
  const successor = execFileSync(
    "git",
    ["rev-parse", "--verify", `${input.proof.successorCommit}^{commit}`],
    { cwd: input.cwd, encoding: "utf8", maxBuffer: 1_048_576 }
  ).trim();
  if (predecessor !== input.proof.predecessorCommit || successor !== input.proof.successorCommit) {
    throw new Error("judge_demo_presentation_git_identity_invalid");
  }
  execFileSync(
    "git",
    ["merge-base", "--is-ancestor", input.proof.predecessorCommit, input.proof.successorCommit],
    { cwd: input.cwd }
  );
  const changedPaths = execFileSync(
    "git",
    [
      "diff",
      "--name-only",
      "--no-ext-diff",
      "--no-renames",
      input.proof.predecessorCommit,
      input.proof.successorCommit,
      "--"
    ],
    { cwd: input.cwd, encoding: "utf8", maxBuffer: 1_048_576 }
  )
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();
  if (canonicalJson(changedPaths) !== canonicalJson(input.proof.changedPaths)) {
    throw new Error("judge_demo_presentation_actual_diff_mismatch");
  }

  const actualCollateralChanges: JudgeDemoCollateralProof["collateralChanges"][number][] = [];
  for (const path of input.proof.changedPaths) {
    const collateralPath = path as JudgeDemoCollateralPath;
    const predecessorSource = gitFile(input.cwd, input.proof.predecessorCommit, path);
    const successorSource = gitFile(input.cwd, input.proof.successorCommit, path);
    if (successorSource === null) {
      throw new Error("judge_demo_presentation_collateral_successor_missing");
    }
    const currentSource = await readFile(`${input.cwd}/${path}`, "utf8");
    if (currentSource !== successorSource) {
      throw new Error("judge_demo_presentation_collateral_checkout_mismatch");
    }
    const predecessorFields = collateralFields(predecessorSource);
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
      actualCollateralChanges.push({
        path: collateralPath,
        field,
        predecessorValue,
        successorValue
      });
    }
  }
  actualCollateralChanges.sort((left, right) =>
    left.path === right.path
      ? left.field.localeCompare(right.field)
      : left.path.localeCompare(right.path)
  );
  if (canonicalJson(actualCollateralChanges) !== canonicalJson(input.proof.collateralChanges)) {
    throw new Error("judge_demo_presentation_collateral_change_mismatch");
  }

  for (const file of input.proof.criticalFiles) {
    const bytes = await readFile(`${input.cwd}/${file.path}`);
    if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
      throw new Error(`judge_demo_presentation_critical_file_mismatch:${file.path}`);
    }
  }
  const packageJson = JSON.parse(await readFile(`${input.cwd}/package.json`, "utf8")) as {
    readonly dependencies?: unknown;
    readonly devDependencies?: unknown;
    readonly engines?: unknown;
  };
  const dependenciesHash = await dependencyProjectionHash({
    dependencies: packageJson.dependencies ?? null,
    devDependencies: packageJson.devDependencies ?? null,
    engines: packageJson.engines ?? null
  });
  if (dependenciesHash !== input.proof.dependencyProjectionHash) {
    throw new Error("judge_demo_presentation_dependency_mismatch");
  }
  return Object.freeze({
    changedPathCount: changedPaths.length,
    criticalFileCount: input.proof.criticalFiles.length,
    dependencyProjectionHash: dependenciesHash
  });
}
