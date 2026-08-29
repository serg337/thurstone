import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { verifyJudgeDemoPresentationCheckout } from "@/lib/judge/collateral-checkout-verifier.server";
import {
  JUDGE_DEMO_CI_TIMEOUT_COUNT,
  JUDGE_DEMO_CI_TIMEOUT_MS,
  JUDGE_DEMO_CI_TIMEOUT_PATH,
  JUDGE_DEMO_CI_TIMEOUT_VALIDATION_VERSION,
  JUDGE_DEMO_CRITICAL_PATHS,
  JUDGE_DEMO_PRESENTATION_TRANSITION_VERSION,
  JUDGE_DEMO_RECOVERY_FINALIZATION_PATHS,
  JUDGE_DEMO_RECOVERY_IMPLEMENTATION_COMMIT,
  JUDGE_DEMO_RECOVERY_IMPLEMENTATION_TREE,
  JUDGE_DEMO_RECOVERY_PATHS,
  judgeDemoImmutableProjectionHash,
  verifyJudgeDemoPresentationTransition,
  type JudgeDemoCollateralTransition,
  type JudgeDemoPresentationTransition,
  type JudgeDemoRecoveryTransition
} from "@/lib/judge/collateral-proof";
import { createJudgeDemoEnvelope } from "@/lib/judge/envelope";
import {
  JUDGE_DEMO_GIT_PACK_ENV,
  JUDGE_DEMO_PRESENTATION_BINDING_ENV,
  JUDGE_DEMO_PRESENTATION_BINDING_HASH_ENV,
  JUDGE_DEMO_PRESENTATION_BINDING_VERSION,
  JUDGE_DEMO_SHARED_GIT_PACK_ENV,
  publicJudgeDemoPresentationBinding,
  verifyJudgeDemoPresentationBinding,
  type JudgeDemoPresentationBinding
} from "@/lib/judge/presentation-binding.server";
import { dependencyProjectionHash } from "@/lib/results/presentation-proof";
import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots: string[] = [];
const rootReceiptDigest = "b".repeat(64);
const rootArtifactDigest = "c".repeat(64);
const rootStoredProjectionDigest = "d".repeat(64);
const rootCapturedAt = "2026-08-29T14:24:37.377Z";
const rootEvidenceCommit = "e2cf8d47375abfeeb4f32bd6f5973918acf4c091";

function git(cwd: string, args: readonly string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=ToolProof Test", "-c", "user.email=test@example.invalid", ...args],
    { cwd, encoding: "utf8", maxBuffer: 8_388_608 }
  ).trim();
}

function gitFile(cwd: string, commit: string, path: string): Buffer | null {
  const result = spawnSync("git", ["show", `${commit}:${path}`], {
    cwd,
    encoding: null,
    maxBuffer: 8_388_608
  });
  return result.status === 0 && Buffer.isBuffer(result.stdout) ? result.stdout : null;
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function write(cwd: string, path: string, contents: string): Promise<void> {
  const target = join(cwd, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
}

async function dependencyHashAt(cwd: string, commit: string): Promise<string> {
  const source = gitFile(cwd, commit, "package.json");
  if (source === null) throw new Error("missing_package_json");
  const parsed = JSON.parse(source.toString("utf8")) as {
    dependencies?: unknown;
    devDependencies?: unknown;
    engines?: unknown;
  };
  return dependencyProjectionHash({
    dependencies: parsed.dependencies ?? null,
    devDependencies: parsed.devDependencies ?? null,
    engines: parsed.engines ?? null
  });
}

function rawTreeChanges(cwd: string, predecessorCommit: string, successorCommit: string) {
  return git(cwd, [
    "diff-tree",
    "--raw",
    "-r",
    "--no-renames",
    "--no-commit-id",
    "--abbrev=40",
    predecessorCommit,
    successorCommit,
    "--"
  ])
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      const match = /^:([0-7]{6}) ([0-7]{6}) ([a-f0-9]{40}) ([a-f0-9]{40}) ([ADMT])\t(.+)$/u.exec(
        line
      );
      if (!match) throw new Error("invalid_test_tree_projection");
      return {
        path: match[6]!,
        status: match[5]! as "A" | "D" | "M" | "T",
        predecessorMode: match[1] === "000000" ? null : match[1]!,
        successorMode: match[2] === "000000" ? null : match[2]!,
        predecessorBlobOid: match[3] === "0".repeat(40) ? null : match[3]!,
        successorBlobOid: match[4] === "0".repeat(40) ? null : match[4]!
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function transitionCommon(input: {
  cwd: string;
  rootCommit: string;
  predecessorCommit: string;
  successorCommit: string;
  ordinal: 0 | 1;
}) {
  const [rootEnvelope, predecessorEnvelope, successorEnvelope] = await Promise.all([
    createJudgeDemoEnvelope(input.rootCommit),
    createJudgeDemoEnvelope(input.predecessorCommit),
    createJudgeDemoEnvelope(input.successorCommit)
  ]);
  const gitTreeChanges = rawTreeChanges(input.cwd, input.predecessorCommit, input.successorCommit);
  const criticalFiles = JUDGE_DEMO_CRITICAL_PATHS.map((path) => {
    const predecessor = gitFile(input.cwd, input.predecessorCommit, path);
    const successor = gitFile(input.cwd, input.successorCommit, path);
    if (predecessor === null || successor === null) throw new Error(`missing_critical:${path}`);
    return {
      path,
      predecessorBlobOid: git(input.cwd, ["rev-parse", `${input.predecessorCommit}:${path}`]),
      successorBlobOid: git(input.cwd, ["rev-parse", `${input.successorCommit}:${path}`]),
      successorSha256: sha256(successor)
    };
  });
  const firstParentCommitChain = [
    input.predecessorCommit,
    ...git(input.cwd, [
      "rev-list",
      "--first-parent",
      "--reverse",
      `${input.predecessorCommit}..${input.successorCommit}`
    ])
      .split(/\r?\n/u)
      .filter(Boolean)
  ];
  return {
    version: JUDGE_DEMO_PRESENTATION_TRANSITION_VERSION,
    ordinal: input.ordinal,
    predecessorCommit: input.predecessorCommit,
    successorCommit: input.successorCommit,
    predecessorEnvelopeHash: predecessorEnvelope.envelopeHash,
    successorEnvelopeHash: successorEnvelope.envelopeHash,
    rootEvidenceCommit: input.rootCommit,
    rootEnvelopeHash: rootEnvelope.envelopeHash,
    rootReceiptDigest,
    rootArtifactDigest,
    rootStoredProjectionDigest,
    rootCapturedAt,
    immutableProjectionHash: await judgeDemoImmutableProjectionHash(rootEnvelope),
    firstParentChainHash: await canonicalSha256(firstParentCommitChain),
    gitTreeProjectionHash: await canonicalSha256(gitTreeChanges),
    criticalProjectionHash: await canonicalSha256(criticalFiles),
    dependencyProjectionHash: await dependencyHashAt(input.cwd, input.predecessorCommit),
    providerCallsPerformed: 0 as const,
    storeWritesPerformed: 0 as const,
    replayOnly: true as const
  };
}

async function recoveryTransition(input: {
  cwd: string;
  rootCommit: string;
  recoveryCommit: string;
  ciTimeoutValidation?: NonNullable<
    JudgeDemoRecoveryTransition["recoveryContract"]["ciTimeoutValidation"]
  > | null;
}): Promise<JudgeDemoRecoveryTransition> {
  const common = await transitionCommon({
    cwd: input.cwd,
    rootCommit: input.rootCommit,
    predecessorCommit: input.rootCommit,
    successorCommit: input.recoveryCommit,
    ordinal: 0
  });
  const payload = {
    ...common,
    kind: "sealed-reader-compatibility-recovery" as const,
    recoveryContract: {
      failureMode: "redis-json-auto-deserialization" as const,
      acceptedProjectionRepresentations: ["json-string" as const, "preparsed-json-value" as const],
      strictSchemaValidationPreserved: true as const,
      projectionDigestValidationPreserved: true as const,
      permanentReceiptMutation: "none" as const,
      ...(input.ciTimeoutValidation === undefined
        ? {}
        : { ciTimeoutValidation: input.ciTimeoutValidation })
    }
  };
  return (await verifyJudgeDemoPresentationTransition({
    ...payload,
    proofHash: await canonicalSha256(payload)
  })) as JudgeDemoRecoveryTransition;
}

async function ciTimeoutValidation(input: {
  cwd: string;
  activeCommit: string;
}): Promise<NonNullable<JudgeDemoRecoveryTransition["recoveryContract"]["ciTimeoutValidation"]>> {
  const treeChanges = rawTreeChanges(
    input.cwd,
    JUDGE_DEMO_RECOVERY_IMPLEMENTATION_COMMIT,
    input.activeCommit
  );
  return {
    version: JUDGE_DEMO_CI_TIMEOUT_VALIDATION_VERSION,
    kind: "recovery-finalization",
    implementationCommit: JUDGE_DEMO_RECOVERY_IMPLEMENTATION_COMMIT,
    implementationTree: JUDGE_DEMO_RECOVERY_IMPLEMENTATION_TREE,
    activeCommit: input.activeCommit,
    activeTree: git(input.cwd, ["rev-parse", `${input.activeCommit}^{tree}`]),
    changedPaths: treeChanges.map(
      ({ path }) => path
    ) as (typeof JUDGE_DEMO_RECOVERY_FINALIZATION_PATHS)[number][],
    treeChanges: treeChanges as NonNullable<
      JudgeDemoRecoveryTransition["recoveryContract"]["ciTimeoutValidation"]
    >["treeChanges"],
    gitTreeProjectionHash: await canonicalSha256(treeChanges),
    timeoutPath: JUDGE_DEMO_CI_TIMEOUT_PATH,
    timeoutMs: JUDGE_DEMO_CI_TIMEOUT_MS,
    timeoutCount: JUDGE_DEMO_CI_TIMEOUT_COUNT,
    providerCallsPerformed: 0,
    storeWritesPerformed: 0
  };
}

async function collateralTransition(input: {
  cwd: string;
  rootCommit: string;
  recoveryCommit: string;
  releaseCommit: string;
  collateralChanges?: JudgeDemoCollateralTransition["collateralChanges"];
}): Promise<JudgeDemoCollateralTransition> {
  const common = await transitionCommon({
    cwd: input.cwd,
    rootCommit: input.rootCommit,
    predecessorCommit: input.recoveryCommit,
    successorCommit: input.releaseCommit,
    ordinal: 1
  });
  const collateralChanges =
    input.collateralChanges ??
    ([
      {
        path: "README.md" as const,
        field: "live_app" as const,
        predecessorValue: "pending",
        successorValue: "https://toolproof.example"
      },
      {
        path: "submission/devpost.md" as const,
        field: "live_app" as const,
        predecessorValue: "pending",
        successorValue: "https://toolproof.example"
      }
    ] satisfies JudgeDemoCollateralTransition["collateralChanges"]);
  const payload = {
    ...common,
    kind: "collateral-links" as const,
    collateralChanges,
    collateralChangesHash: await canonicalSha256(collateralChanges)
  };
  return (await verifyJudgeDemoPresentationTransition({
    ...payload,
    proofHash: await canonicalSha256(payload)
  })) as JudgeDemoCollateralTransition;
}

async function bindingFor(input: {
  rootCommit: string;
  activeCommit: string;
  transitions: readonly JudgeDemoPresentationTransition[];
}): Promise<JudgeDemoPresentationBinding> {
  const [rootEnvelope, activeEnvelope] = await Promise.all([
    createJudgeDemoEnvelope(input.rootCommit),
    createJudgeDemoEnvelope(input.activeCommit)
  ]);
  const payload = {
    version: JUDGE_DEMO_PRESENTATION_BINDING_VERSION,
    rootEvidenceCommit: input.rootCommit,
    activeCommit: input.activeCommit,
    rootEnvelopeHash: rootEnvelope.envelopeHash,
    activeEnvelopeHash: activeEnvelope.envelopeHash,
    rootReceiptDigest,
    rootArtifactDigest,
    rootStoredProjectionDigest,
    rootCapturedAt,
    immutableProjectionHash: await judgeDemoImmutableProjectionHash(rootEnvelope),
    transitions: input.transitions,
    gitProofPackSha256: "a".repeat(64),
    providerCallsPerformed: 0 as const,
    storeWritesPerformed: 0 as const,
    replayOnly: true as const
  };
  const lineageHash = await canonicalSha256(payload);
  return verifyJudgeDemoPresentationBinding({
    value: { ...payload, lineageHash, bindingHash: lineageHash },
    rootEnvelope,
    activeEnvelope,
    rootReceiptDigest,
    rootArtifactDigest,
    rootStoredProjectionDigest,
    rootCapturedAt
  });
}

async function fixture(
  options: { nonLinkReleaseChange?: boolean; hiddenIntermediateChange?: boolean } = {}
) {
  const cwd = await mkdtemp(join(tmpdir(), "toolproof-judge-presentation-"));
  temporaryRoots.push(cwd);
  git(cwd, ["init", "-q"]);
  for (const [index, path] of JUDGE_DEMO_CRITICAL_PATHS.entries()) {
    await write(cwd, path, `critical:${index}:${path}\n`);
  }
  for (const path of JUDGE_DEMO_RECOVERY_PATHS) {
    try {
      await readFile(join(cwd, path));
    } catch {
      await write(cwd, path, `recovery-source:${path}\n`);
    }
  }
  const packageProjection = {
    dependencies: { zod: "4.4.3" },
    devDependencies: { typescript: "6.0.3" },
    engines: { node: "22.x" }
  };
  await write(cwd, "package.json", `${JSON.stringify(packageProjection)}\n`);
  await write(cwd, "README.md", "ToolProof\nLive app: pending\n");
  await write(cwd, "submission/devpost.md", "Submission\nLive app: pending\n");
  git(cwd, ["add", "--", "."]);
  git(cwd, ["commit", "-q", "-m", "judge evidence build"]);
  const rootCommit = git(cwd, ["rev-parse", "HEAD"]);

  if (options.hiddenIntermediateChange) {
    await write(
      cwd,
      "package.json",
      `${JSON.stringify({ ...packageProjection, dependencies: { zod: "0.0.0-forbidden" } })}\n`
    );
    git(cwd, ["add", "--", "package.json"]);
    git(cwd, ["commit", "-q", "-m", "forbidden transient dependency drift"]);
    await write(cwd, "package.json", `${JSON.stringify(packageProjection)}\n`);
    git(cwd, ["add", "--", "package.json"]);
  }

  for (const path of JUDGE_DEMO_RECOVERY_PATHS) {
    const source = await readFile(join(cwd, path), "utf8");
    await write(cwd, path, `${source}sealed-reader-recovery:${path}\n`);
  }
  git(cwd, ["add", "--", ...JUDGE_DEMO_RECOVERY_PATHS]);
  git(cwd, ["commit", "-q", "-m", "recover sealed judge receipt"]);
  const recoveryCommit = git(cwd, ["rev-parse", "HEAD"]);
  const recovery = await recoveryTransition({ cwd, rootCommit, recoveryCommit });

  await write(
    cwd,
    "README.md",
    `${options.nonLinkReleaseChange ? "Changed ToolProof" : "ToolProof"}\nLive app: https://toolproof.example\nsealed-reader-recovery:README.md\n`
  );
  await write(
    cwd,
    "submission/devpost.md",
    "Submission\nLive app: https://toolproof.example\nsealed-reader-recovery:submission/devpost.md\n"
  );
  git(cwd, ["add", "--", "README.md", "submission/devpost.md"]);
  git(cwd, ["commit", "-q", "-m", "release collateral"]);
  const releaseCommit = git(cwd, ["rev-parse", "HEAD"]);
  const collateral = await collateralTransition({
    cwd,
    rootCommit,
    recoveryCommit,
    releaseCommit
  });
  return { cwd, rootCommit, recoveryCommit, releaseCommit, recovery, collateral };
}

async function recoveryFinalizationFixture() {
  const cwd = await mkdtemp(join(tmpdir(), "toolproof-judge-finalization-"));
  temporaryRoots.push(cwd);
  git(cwd, ["clone", "-q", "--no-hardlinks", resolve("."), "."]);
  git(cwd, ["checkout", "-q", JUDGE_DEMO_RECOVERY_IMPLEMENTATION_COMMIT]);
  for (const path of JUDGE_DEMO_RECOVERY_FINALIZATION_PATHS) {
    await writeFile(join(cwd, path), await readFile(resolve(path)));
  }
  git(cwd, ["add", "--", ...JUDGE_DEMO_RECOVERY_FINALIZATION_PATHS]);
  git(cwd, ["commit", "-q", "-m", "finalize recovery CI validation"]);
  const activeCommit = git(cwd, ["rev-parse", "HEAD"]);
  const validation = await ciTimeoutValidation({ cwd, activeCommit });
  const recovery = await recoveryTransition({
    cwd,
    rootCommit: rootEvidenceCommit,
    recoveryCommit: activeCommit,
    ciTimeoutValidation: validation
  });
  return {
    cwd,
    rootCommit: rootEvidenceCommit,
    implementationCommit: JUDGE_DEMO_RECOVERY_IMPLEMENTATION_COMMIT,
    activeCommit,
    validation,
    recovery
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("judge provider-free presentation lineage", () => {
  it("verifies the exact e2-style sealed-reader recovery and active checkout", async () => {
    const value = await fixture();
    git(value.cwd, ["reset", "--hard", "-q", value.recoveryCommit]);
    await rm(join(value.cwd, ".env.example"), { force: true });
    const binding = await bindingFor({
      rootCommit: value.rootCommit,
      activeCommit: value.recoveryCommit,
      transitions: [value.recovery]
    });
    await expect(
      verifyJudgeDemoPresentationCheckout({ cwd: value.cwd, binding })
    ).resolves.toMatchObject({
      transitionCount: 1,
      changedPathCount: JUDGE_DEMO_RECOVERY_PATHS.length
    });

    const script = spawnSync(
      resolve("node_modules/.bin/tsx"),
      [
        "--tsconfig",
        resolve("tsconfig.operator.json"),
        resolve("scripts/verify-judge-presentation.ts")
      ],
      {
        cwd: value.cwd,
        env: {
          ...process.env,
          TOOLPROOF_JUDGE_LANE_MODE: "enabled",
          TOOLPROOF_JUDGE_PRESENTATION_MODE: "successor",
          TOOLPROOF_JUDGE_ACTIVE_COMMIT: value.recoveryCommit,
          TOOLPROOF_COMMIT_SHA: value.recoveryCommit,
          VERCEL_GIT_COMMIT_SHA: value.recoveryCommit,
          [JUDGE_DEMO_PRESENTATION_BINDING_ENV]: gzipSync(
            Buffer.from(canonicalJson(binding))
          ).toString("base64url"),
          [JUDGE_DEMO_PRESENTATION_BINDING_HASH_ENV]: binding.bindingHash
        },
        encoding: "utf8",
        maxBuffer: 8_388_608
      }
    );
    expect(script.status, script.stderr).toBe(0);
    expect(script.stdout).toContain('"status":"verified-provider-free-lineage"');
    expect(script.stdout).toContain('"storeWritesPerformed":0');

    for (const judgePack of [undefined, "AA"] as const) {
      const production = spawnSync(
        resolve("node_modules/.bin/tsx"),
        [
          "--tsconfig",
          resolve("tsconfig.operator.json"),
          resolve("scripts/verify-judge-presentation.ts")
        ],
        {
          cwd: value.cwd,
          env: {
            ...process.env,
            VERCEL: "1",
            TOOLPROOF_JUDGE_LANE_MODE: "enabled",
            TOOLPROOF_JUDGE_PRESENTATION_MODE: "successor",
            TOOLPROOF_JUDGE_ACTIVE_COMMIT: value.recoveryCommit,
            TOOLPROOF_COMMIT_SHA: value.recoveryCommit,
            VERCEL_GIT_COMMIT_SHA: value.recoveryCommit,
            [JUDGE_DEMO_PRESENTATION_BINDING_ENV]: gzipSync(
              Buffer.from(canonicalJson(binding))
            ).toString("base64url"),
            [JUDGE_DEMO_PRESENTATION_BINDING_HASH_ENV]: binding.bindingHash,
            [JUDGE_DEMO_SHARED_GIT_PACK_ENV]: "",
            [JUDGE_DEMO_GIT_PACK_ENV]: judgePack ?? ""
          },
          encoding: "utf8",
          maxBuffer: 8_388_608
        }
      );
      expect(production.status).not.toBe(0);
      expect(production.stderr).toContain("judge_demo_presentation_shared_git_pack_required");
    }

    const finalized = await recoveryFinalizationFixture();
    const finalizedBinding = await bindingFor({
      rootCommit: finalized.rootCommit,
      activeCommit: finalized.activeCommit,
      transitions: [finalized.recovery]
    });
    await expect(
      verifyJudgeDemoPresentationCheckout({ cwd: finalized.cwd, binding: finalizedBinding })
    ).resolves.toMatchObject({
      transitionCount: 1,
      changedPathCount: JUDGE_DEMO_RECOVERY_PATHS.length
    });
    expect(
      publicJudgeDemoPresentationBinding(finalizedBinding).transitions[0]?.ciTimeoutValidation
    ).toMatchObject({
      kind: "recovery-finalization",
      implementationCommit: JUDGE_DEMO_RECOVERY_IMPLEMENTATION_COMMIT,
      implementationTree: JUDGE_DEMO_RECOVERY_IMPLEMENTATION_TREE,
      activeCommit: finalized.activeCommit,
      timeoutPath: JUDGE_DEMO_CI_TIMEOUT_PATH,
      timeoutMs: JUDGE_DEMO_CI_TIMEOUT_MS,
      timeoutCount: JUDGE_DEMO_CI_TIMEOUT_COUNT,
      providerCallsPerformed: 0,
      storeWritesPerformed: 0
    });
  }, 20_000);

  it("verifies ordered recovery then collateral links without changing critical bytes", async () => {
    const value = await recoveryFinalizationFixture();
    const predecessorValue = "reserved for the verified Gate 9 link-only release commit";
    const successorValue = "https://github.com/serg337/toolproof";
    for (const path of ["README.md", "submission/devpost.md"] as const) {
      const source = await readFile(join(value.cwd, path), "utf8");
      await write(
        value.cwd,
        path,
        source.replace(
          `Public repository: ${predecessorValue}`,
          `Public repository: ${successorValue}`
        )
      );
    }
    git(value.cwd, ["add", "--", "README.md", "submission/devpost.md"]);
    git(value.cwd, ["commit", "-q", "-m", "release collateral"]);
    const releaseCommit = git(value.cwd, ["rev-parse", "HEAD"]);
    const collateralChanges = ["README.md", "submission/devpost.md"].map((path) => ({
      path: path as "README.md" | "submission/devpost.md",
      field: "public_repository" as const,
      predecessorValue,
      successorValue
    }));
    const collateral = await collateralTransition({
      cwd: value.cwd,
      rootCommit: value.rootCommit,
      recoveryCommit: value.activeCommit,
      releaseCommit,
      collateralChanges
    });
    const binding = await bindingFor({
      rootCommit: value.rootCommit,
      activeCommit: releaseCommit,
      transitions: [value.recovery, collateral]
    });
    await expect(
      verifyJudgeDemoPresentationCheckout({ cwd: value.cwd, binding })
    ).resolves.toMatchObject({ transitionCount: 2 });

    await write(value.cwd, "lib/judge/service.server.ts", "tampered active checkout\n");
    await expect(verifyJudgeDemoPresentationCheckout({ cwd: value.cwd, binding })).rejects.toThrow(
      /judge_demo_presentation_active_checkout_mismatch/u
    );
  }, 20_000);

  it("rejects tree substitution, chain discontinuity, writes, and non-link release edits", async () => {
    const value = await fixture();
    const recoveryBase = { ...value.recovery };
    delete (recoveryBase as Partial<typeof value.recovery>).proofHash;
    const wrongTreePayload = {
      ...recoveryBase,
      gitTreeProjectionHash: "f".repeat(64)
    };
    const wrongTree = (await verifyJudgeDemoPresentationTransition({
      ...wrongTreePayload,
      proofHash: await canonicalSha256(wrongTreePayload)
    })) as JudgeDemoRecoveryTransition;
    const wrongTreeBinding = await bindingFor({
      rootCommit: value.rootCommit,
      activeCommit: value.recoveryCommit,
      transitions: [wrongTree]
    });
    git(value.cwd, ["reset", "--hard", "-q", value.recoveryCommit]);
    await expect(
      verifyJudgeDemoPresentationCheckout({ cwd: value.cwd, binding: wrongTreeBinding })
    ).rejects.toThrow(/judge_demo_presentation_git_tree_projection_mismatch/u);

    const finalized = await recoveryFinalizationFixture();
    const unboundIntermediate = await recoveryTransition({
      cwd: finalized.cwd,
      rootCommit: finalized.rootCommit,
      recoveryCommit: finalized.activeCommit,
      ciTimeoutValidation: null
    });
    const unboundIntermediateBinding = await bindingFor({
      rootCommit: finalized.rootCommit,
      activeCommit: finalized.activeCommit,
      transitions: [unboundIntermediate]
    });
    await expect(
      verifyJudgeDemoPresentationCheckout({
        cwd: finalized.cwd,
        binding: unboundIntermediateBinding
      })
    ).rejects.toThrow(/judge_demo_presentation_transition_not_direct_child/u);

    const tamperedTreeChanges = finalized.validation.treeChanges.map((change, index) =>
      index === 0 ? { ...change, successorBlobOid: "f".repeat(40) } : change
    );
    const tamperedValidation = {
      ...finalized.validation,
      treeChanges: tamperedTreeChanges,
      gitTreeProjectionHash: await canonicalSha256(tamperedTreeChanges)
    };
    const tamperedRecovery = await recoveryTransition({
      cwd: finalized.cwd,
      rootCommit: finalized.rootCommit,
      recoveryCommit: finalized.activeCommit,
      ciTimeoutValidation: tamperedValidation
    });
    const tamperedFinalizationBinding = await bindingFor({
      rootCommit: finalized.rootCommit,
      activeCommit: finalized.activeCommit,
      transitions: [tamperedRecovery]
    });
    await expect(
      verifyJudgeDemoPresentationCheckout({
        cwd: finalized.cwd,
        binding: tamperedFinalizationBinding
      })
    ).rejects.toThrow(/judge_demo_presentation_recovery_finalization_tree_invalid/u);

    const directWithValidation = await recoveryTransition({
      cwd: finalized.cwd,
      rootCommit: finalized.rootCommit,
      recoveryCommit: finalized.implementationCommit,
      ciTimeoutValidation: {
        ...finalized.validation,
        activeCommit: finalized.implementationCommit,
        activeTree: JUDGE_DEMO_RECOVERY_IMPLEMENTATION_TREE
      }
    });
    const directWithValidationBinding = await bindingFor({
      rootCommit: finalized.rootCommit,
      activeCommit: finalized.implementationCommit,
      transitions: [directWithValidation]
    });
    git(finalized.cwd, ["reset", "--hard", "-q", finalized.implementationCommit]);
    await expect(
      verifyJudgeDemoPresentationCheckout({
        cwd: finalized.cwd,
        binding: directWithValidationBinding
      })
    ).rejects.toThrow(/judge_demo_presentation_recovery_finalization_identity_invalid/u);

    await expect(
      verifyJudgeDemoPresentationTransition({ ...value.recovery, storeWritesPerformed: 1 })
    ).rejects.toThrow();

    const collateralBase = { ...value.collateral };
    delete (collateralBase as Partial<typeof value.collateral>).proofHash;
    const discontinuousPayload = {
      ...collateralBase,
      predecessorCommit: value.rootCommit
    };
    await expect(
      verifyJudgeDemoPresentationTransition({
        ...discontinuousPayload,
        proofHash: await canonicalSha256(discontinuousPayload)
      })
    ).resolves.toBeDefined();
    await expect(
      bindingFor({
        rootCommit: value.rootCommit,
        activeCommit: value.releaseCommit,
        transitions: [
          value.recovery,
          {
            ...discontinuousPayload,
            proofHash: await canonicalSha256(discontinuousPayload)
          } as JudgeDemoCollateralTransition
        ]
      })
    ).rejects.toThrow(/judge_demo_presentation_transition_continuity_invalid/u);

    const hidden = await fixture({ hiddenIntermediateChange: true });
    const hiddenBinding = await bindingFor({
      rootCommit: hidden.rootCommit,
      activeCommit: hidden.recoveryCommit,
      transitions: [hidden.recovery]
    });
    git(hidden.cwd, ["reset", "--hard", "-q", hidden.recoveryCommit]);
    await expect(
      verifyJudgeDemoPresentationCheckout({ cwd: hidden.cwd, binding: hiddenBinding })
    ).rejects.toThrow(/judge_demo_presentation_transition_not_direct_child/u);

    const nonLink = await fixture({ nonLinkReleaseChange: true });
    const nonLinkBinding = await bindingFor({
      rootCommit: nonLink.rootCommit,
      activeCommit: nonLink.releaseCommit,
      transitions: [nonLink.recovery, nonLink.collateral]
    });
    await expect(
      verifyJudgeDemoPresentationCheckout({ cwd: nonLink.cwd, binding: nonLinkBinding })
    ).rejects.toThrow(/judge_demo_presentation_non_link_change/u);
  }, 20_000);
});
