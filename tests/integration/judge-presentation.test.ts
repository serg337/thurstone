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
  JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_COMMIT,
  JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_PATH,
  JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_SHA256,
  JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_TREE,
  JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_REQUIRED_PATHS,
  JUDGE_DEMO_INVOCATION_INTEGRITY_IMPLEMENTATION_REQUIRED_PATHS,
  JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_BINDING_ARTIFACT_SHA256,
  JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_BINDING_HASH,
  JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_COMMIT,
  JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_ENVELOPE_HASH,
  JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_TREE,
  JUDGE_DEMO_INVOCATION_INTEGRITY_PRESERVED_SEMANTIC_ARTIFACTS,
  JUDGE_DEMO_INVOCATION_INTEGRITY_PROTOCOL_PATHS,
  JUDGE_DEMO_INVOCATION_INTEGRITY_SEALED_EVIDENCE_BUILD,
  JUDGE_DEMO_INVOCATION_INTEGRITY_SEMANTIC_PACKAGE_DIGEST,
  JUDGE_DEMO_INVOCATION_INTEGRITY_TRANSITION_VERSION,
  JUDGE_DEMO_PRESENTATION_REBRAND_TRANSITION_VERSION,
  JUDGE_DEMO_PRESENTATION_TRANSITION_VERSION,
  JUDGE_DEMO_REBRAND_BRANDING_PATHS,
  JUDGE_DEMO_REBRAND_PREDECESSOR_BINDING_ARTIFACT_SHA256,
  JUDGE_DEMO_REBRAND_PREDECESSOR_BINDING_HASH,
  JUDGE_DEMO_REBRAND_PREDECESSOR_COMMIT,
  JUDGE_DEMO_REBRAND_PREDECESSOR_ENVELOPE_HASH,
  JUDGE_DEMO_REBRAND_PREDECESSOR_TRANSITION_PROOF_HASH,
  JUDGE_DEMO_REBRAND_PREDECESSOR_TREE,
  JUDGE_DEMO_REBRAND_PRESERVED_ARTIFACTS,
  JUDGE_DEMO_REBRAND_PROTOCOL_PATHS,
  JUDGE_DEMO_RECOVERY_CI_FINALIZATION_COMMIT,
  JUDGE_DEMO_RECOVERY_CI_FINALIZATION_TREE,
  JUDGE_DEMO_RECOVERY_FINALIZATION_PATHS,
  JUDGE_DEMO_RECOVERY_IMPLEMENTATION_COMMIT,
  JUDGE_DEMO_RECOVERY_IMPLEMENTATION_TREE,
  JUDGE_DEMO_RECOVERY_PATHS,
  JUDGE_DEMO_TRUTH_STATUS_EXPECTED_README_SENTENCE,
  JUDGE_DEMO_TRUTH_STATUS_FINALIZATION_PATHS,
  JUDGE_DEMO_TRUTH_STATUS_FINALIZATION_VERSION,
  JUDGE_DEMO_TRUTH_STATUS_FORBIDDEN_README_PHRASE,
  judgeDemoImmutableProjectionHash,
  verifyJudgeDemoPresentationTransition,
  type JudgeDemoCollateralTransition,
  type JudgeDemoPresentationTransition,
  type JudgeDemoRebrandTransition,
  type JudgeDemoRecoveryTransition
} from "@/lib/judge/collateral-proof";
import { createJudgeDemoEnvelope } from "@/lib/judge/envelope";
import {
  JUDGE_DEMO_GIT_PACK_ENV,
  JUDGE_DEMO_PRESENTATION_BINDING_ENV,
  JUDGE_DEMO_PRESENTATION_BINDING_HASH_ENV,
  JUDGE_DEMO_PRESENTATION_REBRAND_BINDING_VERSION,
  JUDGE_DEMO_PRESENTATION_BINDING_VERSION,
  JUDGE_DEMO_INVOCATION_INTEGRITY_BINDING_VERSION,
  JUDGE_DEMO_SHARED_GIT_PACK_ENV,
  configuredJudgeDemoPresentationBinding,
  judgeDemoPresentationOrderValid,
  publicJudgeDemoPresentationBinding,
  verifyJudgeDemoPresentationBinding,
  type JudgeDemoPresentationBinding
} from "@/lib/judge/presentation-binding.server";
import {
  GATE6_PRESENTATION_PROOF_ENV,
  GATE6_PRESENTATION_PROOF_VERSION,
  dependencyProjectionHash
} from "@/lib/results/presentation-proof";
import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots: string[] = [];
const rootReceiptDigest = "3c90e3ed158b4d1b7cdab115c5afa66b83a1c4e0453096a4129c6b790a1840f2";
const rootArtifactDigest = "6fedd98f28eaa9137da458b5a59b396fa1685c8d6f8bccafc2cfde457f993bdb";
const rootStoredProjectionDigest =
  "22c667eec119ddd46d31f764eef5e0e2fa4b4fc61bdddfdd9696be4ba1ac9655";
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
  ordinal: 0 | 1 | 2;
  version?:
    | typeof JUDGE_DEMO_PRESENTATION_TRANSITION_VERSION
    | typeof JUDGE_DEMO_PRESENTATION_REBRAND_TRANSITION_VERSION;
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
    version: input.version ?? JUDGE_DEMO_PRESENTATION_TRANSITION_VERSION,
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
  truthStatusFinalization?: NonNullable<
    NonNullable<
      JudgeDemoRecoveryTransition["recoveryContract"]["ciTimeoutValidation"]
    >["truthStatusFinalization"]
  >;
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
    ...(input.truthStatusFinalization === undefined
      ? {}
      : { truthStatusFinalization: input.truthStatusFinalization }),
    providerCallsPerformed: 0,
    storeWritesPerformed: 0
  };
}

async function truthStatusFinalization(input: {
  cwd: string;
  activeCommit: string;
}): Promise<
  NonNullable<
    NonNullable<
      JudgeDemoRecoveryTransition["recoveryContract"]["ciTimeoutValidation"]
    >["truthStatusFinalization"]
  >
> {
  const treeChanges = rawTreeChanges(
    input.cwd,
    JUDGE_DEMO_RECOVERY_CI_FINALIZATION_COMMIT,
    input.activeCommit
  );
  return {
    version: JUDGE_DEMO_TRUTH_STATUS_FINALIZATION_VERSION,
    kind: "truth-status-finalization",
    predecessorCommit: JUDGE_DEMO_RECOVERY_CI_FINALIZATION_COMMIT,
    predecessorTree: JUDGE_DEMO_RECOVERY_CI_FINALIZATION_TREE,
    activeCommit: input.activeCommit,
    activeTree: git(input.cwd, ["rev-parse", `${input.activeCommit}^{tree}`]),
    changedPaths: treeChanges.map(
      ({ path }) => path
    ) as (typeof JUDGE_DEMO_TRUTH_STATUS_FINALIZATION_PATHS)[number][],
    treeChanges: treeChanges as NonNullable<
      NonNullable<
        JudgeDemoRecoveryTransition["recoveryContract"]["ciTimeoutValidation"]
      >["truthStatusFinalization"]
    >["treeChanges"],
    gitTreeProjectionHash: await canonicalSha256(treeChanges),
    expectedReadmeSentence: JUDGE_DEMO_TRUTH_STATUS_EXPECTED_README_SENTENCE,
    forbiddenReadmePhrase: JUDGE_DEMO_TRUTH_STATUS_FORBIDDEN_README_PHRASE,
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
  ordinal?: 1 | 2;
  version?:
    | typeof JUDGE_DEMO_PRESENTATION_TRANSITION_VERSION
    | typeof JUDGE_DEMO_PRESENTATION_REBRAND_TRANSITION_VERSION;
}): Promise<JudgeDemoCollateralTransition> {
  const common = await transitionCommon({
    cwd: input.cwd,
    rootCommit: input.rootCommit,
    predecessorCommit: input.recoveryCommit,
    successorCommit: input.releaseCommit,
    ordinal: input.ordinal ?? 1,
    ...(input.version ? { version: input.version } : {})
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

async function rebrandTransition(input: {
  cwd: string;
  rootCommit: string;
  protocolCommit: string;
  rebrandCommit: string;
}) {
  const common = await transitionCommon({
    cwd: input.cwd,
    rootCommit: input.rootCommit,
    predecessorCommit: JUDGE_DEMO_REBRAND_PREDECESSOR_COMMIT,
    successorCommit: input.rebrandCommit,
    ordinal: 1,
    version: JUDGE_DEMO_PRESENTATION_REBRAND_TRANSITION_VERSION
  });
  const protocolChanges = rawTreeChanges(
    input.cwd,
    JUDGE_DEMO_REBRAND_PREDECESSOR_COMMIT,
    input.protocolCommit
  );
  const brandingChanges = rawTreeChanges(input.cwd, input.protocolCommit, input.rebrandCommit);
  const brandingFiles = JUDGE_DEMO_REBRAND_BRANDING_PATHS.map((path) => {
    const bytes = gitFile(input.cwd, input.rebrandCommit, path);
    if (!bytes) throw new Error(`missing_branding_file:${path}`);
    return { path, sha256: sha256(bytes) };
  });
  const preservedArtifacts = JUDGE_DEMO_REBRAND_PRESERVED_ARTIFACTS.map((artifact) => {
    const bytes = gitFile(input.cwd, input.rebrandCommit, artifact.path);
    if (!bytes || sha256(bytes) !== artifact.sha256) {
      throw new Error(`preserved_artifact_drift:${artifact.path}`);
    }
    return artifact;
  });
  const gate6CriticalFiles = Array.from({ length: 20 }, (_, index) => ({
    path: `lib/domain/rebrand-critical-${String(index).padStart(2, "0")}.ts`,
    sha256: index.toString(16).padStart(64, "0")
  }));
  const gate6Payload = {
    version: GATE6_PRESENTATION_PROOF_VERSION,
    measuredV2Commit: "a".repeat(40),
    presentationCommit: input.rebrandCommit,
    changedPaths: ["app/page.tsx"],
    criticalFiles: gate6CriticalFiles,
    criticalProjectionHash: await canonicalSha256(gate6CriticalFiles),
    dependencyProjectionHash: common.dependencyProjectionHash,
    gitProofPackSha256: "a".repeat(64),
    baselineRawSha256: "edf0f0e3a2a3438be58a17e27594e57e6230f713c68501a3d26900cb731d7dfb",
    revisedRawSha256: "26c436e38fecd8a128a0204af510556b3edf555ceeb421254d0248c0b23302fa"
  };
  const gate6Proof = {
    ...gate6Payload,
    proofHash: await canonicalSha256(gate6Payload)
  };
  const payload = {
    ...common,
    kind: "presentation-rebrand" as const,
    predecessorBinding: {
      activeCommit: JUDGE_DEMO_REBRAND_PREDECESSOR_COMMIT,
      activeTree: JUDGE_DEMO_REBRAND_PREDECESSOR_TREE,
      activeEnvelopeHash: JUDGE_DEMO_REBRAND_PREDECESSOR_ENVELOPE_HASH,
      bindingHash: JUDGE_DEMO_REBRAND_PREDECESSOR_BINDING_HASH,
      reviewedArtifactSha256: JUDGE_DEMO_REBRAND_PREDECESSOR_BINDING_ARTIFACT_SHA256,
      recoveryTransitionProofHash: JUDGE_DEMO_REBRAND_PREDECESSOR_TRANSITION_PROOF_HASH
    },
    protocolExtension: {
      commit: input.protocolCommit,
      tree: git(input.cwd, ["rev-parse", `${input.protocolCommit}^{tree}`]),
      changedPaths: [...JUDGE_DEMO_REBRAND_PROTOCOL_PATHS],
      treeChanges: protocolChanges,
      gitTreeProjectionHash: await canonicalSha256(protocolChanges)
    },
    branding: {
      productNameBefore: "ToolProof" as const,
      productNameAfter: "Thurstone" as const,
      adoptedAt: "2026-08-29" as const,
      legacyProtocolNamespace: "toolproof" as const,
      packageName: "toolproof" as const,
      productionOrigin: "https://toolproof-rust.vercel.app" as const,
      repositorySlug: "serg337/toolproof" as const,
      tree: git(input.cwd, ["rev-parse", `${input.rebrandCommit}^{tree}`]),
      changedPaths: [...JUDGE_DEMO_REBRAND_BRANDING_PATHS],
      treeChanges: brandingChanges,
      gitTreeProjectionHash: await canonicalSha256(brandingChanges),
      files: brandingFiles,
      filesProjectionHash: await canonicalSha256(brandingFiles)
    },
    preservedArtifacts,
    preservedArtifactsHash: await canonicalSha256(preservedArtifacts),
    gate6PresentationProofHash: gate6Proof.proofHash,
    gate6CriticalProjectionHash: gate6Proof.criticalProjectionHash,
    baselineRawSha256: "edf0f0e3a2a3438be58a17e27594e57e6230f713c68501a3d26900cb731d7dfb",
    revisedRawSha256: "26c436e38fecd8a128a0204af510556b3edf555ceeb421254d0248c0b23302fa",
    scoredCallsPerformed: 0 as const
  };
  const transition = (await verifyJudgeDemoPresentationTransition({
    ...payload,
    proofHash: await canonicalSha256(payload)
  })) as JudgeDemoRebrandTransition;
  return { transition, gate6Proof };
}

async function bindingFor(input: {
  rootCommit: string;
  activeCommit: string;
  transitions: readonly JudgeDemoPresentationTransition[];
  version?:
    | typeof JUDGE_DEMO_PRESENTATION_BINDING_VERSION
    | typeof JUDGE_DEMO_PRESENTATION_REBRAND_BINDING_VERSION;
}): Promise<JudgeDemoPresentationBinding> {
  const [rootEnvelope, activeEnvelope] = await Promise.all([
    createJudgeDemoEnvelope(input.rootCommit),
    createJudgeDemoEnvelope(input.activeCommit)
  ]);
  const payload = {
    version: input.version ?? JUDGE_DEMO_PRESENTATION_BINDING_VERSION,
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
  git(cwd, ["checkout", "-q", JUDGE_DEMO_RECOVERY_CI_FINALIZATION_COMMIT]);
  const activeCommit = JUDGE_DEMO_RECOVERY_CI_FINALIZATION_COMMIT;
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

async function truthStatusFinalizationFixture(options: { staleReadme?: boolean } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), "toolproof-judge-truth-status-"));
  temporaryRoots.push(cwd);
  git(cwd, ["clone", "-q", "--no-hardlinks", resolve("."), "."]);
  git(cwd, ["checkout", "-q", JUDGE_DEMO_RECOVERY_CI_FINALIZATION_COMMIT]);
  for (const path of JUDGE_DEMO_TRUTH_STATUS_FINALIZATION_PATHS) {
    const bytes = await readFile(resolve(path));
    const nextBytes =
      path === "README.md" && options.staleReadme
        ? Buffer.from(
            bytes
              .toString("utf8")
              .replace(
                JUDGE_DEMO_TRUTH_STATUS_EXPECTED_README_SENTENCE,
                `${JUDGE_DEMO_TRUTH_STATUS_EXPECTED_README_SENTENCE} ${JUDGE_DEMO_TRUTH_STATUS_FORBIDDEN_README_PHRASE}.`
              )
          )
        : bytes;
    await writeFile(join(cwd, path), nextBytes);
  }
  git(cwd, ["add", "--", ...JUDGE_DEMO_TRUTH_STATUS_FINALIZATION_PATHS]);
  git(cwd, ["commit", "-q", "-m", "finalize recovery truth status"]);
  const activeCommit = git(cwd, ["rev-parse", "HEAD"]);
  const truthStatus = await truthStatusFinalization({ cwd, activeCommit });
  const validation = await ciTimeoutValidation({
    cwd,
    activeCommit,
    truthStatusFinalization: truthStatus
  });
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
    ciFinalizationCommit: JUDGE_DEMO_RECOVERY_CI_FINALIZATION_COMMIT,
    activeCommit,
    validation,
    truthStatus,
    recovery
  };
}

async function presentationRebrandFixture() {
  const cwd = await mkdtemp(join(tmpdir(), "toolproof-judge-rebrand-"));
  temporaryRoots.push(cwd);
  git(cwd, ["clone", "-q", "--no-hardlinks", resolve("."), "."]);
  git(cwd, ["checkout", "-q", JUDGE_DEMO_REBRAND_PREDECESSOR_COMMIT]);

  const truthStatus = await truthStatusFinalization({
    cwd,
    activeCommit: JUDGE_DEMO_REBRAND_PREDECESSOR_COMMIT
  });
  const validation = await ciTimeoutValidation({
    cwd,
    activeCommit: JUDGE_DEMO_REBRAND_PREDECESSOR_COMMIT,
    truthStatusFinalization: truthStatus
  });
  const recovery = await recoveryTransition({
    cwd,
    rootCommit: rootEvidenceCommit,
    recoveryCommit: JUDGE_DEMO_REBRAND_PREDECESSOR_COMMIT,
    ciTimeoutValidation: validation
  });
  if (recovery.proofHash !== JUDGE_DEMO_REBRAND_PREDECESSOR_TRANSITION_PROOF_HASH) {
    throw new Error("test_rebrand_recovery_anchor_mismatch");
  }

  for (const path of JUDGE_DEMO_REBRAND_PROTOCOL_PATHS) {
    const source = await readFile(resolve(path), "utf8");
    await write(cwd, path, `${source}\n// presentation-rebrand protocol fixture: ${path}\n`);
  }
  git(cwd, ["add", "--", ...JUDGE_DEMO_REBRAND_PROTOCOL_PATHS]);
  git(cwd, ["commit", "-q", "-m", "add presentation rebrand protocol"]);
  const protocolCommit = git(cwd, ["rev-parse", "HEAD"]);

  for (const path of JUDGE_DEMO_REBRAND_BRANDING_PATHS) {
    if (path === "lib/brand.ts") {
      await write(
        cwd,
        path,
        [
          'export const PRODUCT_NAME = "Thurstone" as const;',
          'export const PRODUCT_BYLINE = "Thurstone by Invarra — created by Sergio Valencia." as const;',
          'export const LEGACY_PROTOCOL_NAMESPACE = "toolproof" as const;',
          ""
        ].join("\n")
      );
      continue;
    }
    if (path === "public/thurstone-results.jpg") {
      await write(cwd, path, "synthetic Thurstone presentation JPEG fixture\n");
      continue;
    }
    const source = await readFile(join(cwd, path), "utf8");
    await write(cwd, path, `${source}\nThurstone presentation fixture: ${path}\n`);
  }
  git(cwd, ["add", "--", ...JUDGE_DEMO_REBRAND_BRANDING_PATHS]);
  git(cwd, ["commit", "-q", "-m", "rename presentation to Thurstone"]);
  const rebrandCommit = git(cwd, ["rev-parse", "HEAD"]);
  const { transition: rebrand, gate6Proof } = await rebrandTransition({
    cwd,
    rootCommit: rootEvidenceCommit,
    protocolCommit,
    rebrandCommit
  });
  return {
    cwd,
    rootCommit: rootEvidenceCommit,
    recovery,
    protocolCommit,
    rebrandCommit,
    rebrand,
    gate6Proof
  };
}

function boundedTreeChange(path: string, added = false) {
  return {
    path,
    status: added ? ("A" as const) : ("M" as const),
    predecessorMode: added ? null : "100644",
    successorMode: "100644",
    predecessorBlobOid: added ? null : "1".repeat(40),
    successorBlobOid: "2".repeat(40)
  };
}

async function invocationIntegrityTransitionFixture() {
  const protocolCommit = "d".repeat(40);
  const implementationCommit = "e".repeat(40);
  const rootProjectionHash = "2".repeat(64);
  const activeProjectionHash = "3".repeat(64);
  const protocolChanges = JUDGE_DEMO_INVOCATION_INTEGRITY_PROTOCOL_PATHS.map((path) =>
    boundedTreeChange(path)
  );
  const implementationChanges = JUDGE_DEMO_INVOCATION_INTEGRITY_IMPLEMENTATION_REQUIRED_PATHS.map(
    (path) => boundedTreeChange(path, true)
  );
  const amendmentChange = boundedTreeChange(JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_PATH, true);
  const payload = {
    version: JUDGE_DEMO_INVOCATION_INTEGRITY_TRANSITION_VERSION,
    kind: "invocation-integrity" as const,
    ordinal: 2,
    predecessorCommit: JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_COMMIT,
    successorCommit: implementationCommit,
    predecessorEnvelopeHash: JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_ENVELOPE_HASH,
    successorEnvelopeHash: "1".repeat(64),
    rootEvidenceCommit,
    rootEnvelopeHash: "4".repeat(64),
    rootReceiptDigest,
    rootArtifactDigest,
    rootStoredProjectionDigest,
    rootCapturedAt,
    immutableProjectionHash: rootProjectionHash,
    firstParentChainHash: await canonicalSha256([
      JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_COMMIT,
      JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_COMMIT,
      protocolCommit,
      implementationCommit
    ]),
    gitTreeProjectionHash: "5".repeat(64),
    criticalProjectionHash: "6".repeat(64),
    dependencyProjectionHash: "7".repeat(64),
    providerCallsPerformed: 0 as const,
    storeWritesPerformed: 0 as const,
    replayOnly: true as const,
    predecessorBinding: {
      activeCommit: JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_COMMIT,
      activeTree: JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_TREE,
      activeEnvelopeHash: JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_ENVELOPE_HASH,
      bindingHash: JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_BINDING_HASH,
      reviewedArtifactSha256: JUDGE_DEMO_INVOCATION_INTEGRITY_PREDECESSOR_BINDING_ARTIFACT_SHA256
    },
    amendment: {
      commit: JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_COMMIT,
      tree: JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_TREE,
      path: JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_PATH,
      fileSha256: JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_SHA256,
      treeChange: amendmentChange,
      gitTreeProjectionHash: await canonicalSha256([amendmentChange])
    },
    protocolExtension: {
      commit: protocolCommit,
      commitCount: 1,
      tree: "8".repeat(40),
      changedPaths: [...JUDGE_DEMO_INVOCATION_INTEGRITY_PROTOCOL_PATHS],
      treeChanges: protocolChanges,
      gitTreeProjectionHash: await canonicalSha256(protocolChanges)
    },
    implementation: {
      tree: "9".repeat(40),
      changedPaths: implementationChanges.map(({ path }) => path),
      treeChanges: implementationChanges,
      requiredPathsHash: await canonicalSha256(
        JUDGE_DEMO_INVOCATION_INTEGRITY_IMPLEMENTATION_REQUIRED_PATHS
      ),
      gitTreeProjectionHash: await canonicalSha256(implementationChanges)
    },
    invocationContract: {
      amendmentStatus: "prospective-frozen-supplement" as const,
      caseIds: ["II-01" as const, "II-02" as const, "II-03" as const],
      invocationCount: 4 as const,
      scoreDenominator: 3 as const,
      itemIdPattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" as const,
      itemIdMinLength: 1 as const,
      itemIdMaxLength: 64 as const,
      fixtureMembership: "server-authoritative" as const,
      successfulItemIdentity: "trusted-fixture-CartItemId" as const,
      contractSourceSha256: "a".repeat(64)
    },
    immutableProjectionDelta: {
      predecessorProjectionHash: rootProjectionHash,
      successorProjectionHash: activeProjectionHash,
      changedTool: "cart_update" as const,
      changedField: "inputSchema.properties.itemId" as const,
      judgeTargetTool: "cart_get" as const,
      judgeTargetContractChanged: false as const,
      semanticMeaningMatrixChanged: false as const
    },
    semanticEvidence: {
      sealedEvidenceBuildCommit: JUDGE_DEMO_INVOCATION_INTEGRITY_SEALED_EVIDENCE_BUILD,
      packageDigest: JUDGE_DEMO_INVOCATION_INTEGRITY_SEMANTIC_PACKAGE_DIGEST,
      baselinePassed: 23 as const,
      revisedPassed: 23 as const,
      possible: 24 as const,
      noMeasuredImprovement: true as const,
      meaningMatrixCaseCount: 24 as const,
      meaningMatrixModified: false as const,
      artifacts: JUDGE_DEMO_INVOCATION_INTEGRITY_PRESERVED_SEMANTIC_ARTIFACTS,
      artifactsProjectionHash: await canonicalSha256(
        JUDGE_DEMO_INVOCATION_INTEGRITY_PRESERVED_SEMANTIC_ARTIFACTS
      )
    },
    gate6PresentationProofHash: "b".repeat(64),
    gate6CriticalProjectionHash: "c".repeat(64),
    modelCallsPerformed: 0 as const,
    scoredCallsPerformed: 0 as const
  };
  return verifyJudgeDemoPresentationTransition({
    ...payload,
    proofHash: await canonicalSha256(payload)
  });
}

async function invocationIntegrityEvidenceTransitionFixture() {
  const predecessorCommit = "e".repeat(40);
  const successorCommit = "f".repeat(40);
  const changes = JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_REQUIRED_PATHS.map((path) =>
    boundedTreeChange(path, true)
  );
  const payload = {
    version: JUDGE_DEMO_INVOCATION_INTEGRITY_TRANSITION_VERSION,
    kind: "invocation-integrity-evidence" as const,
    ordinal: 3,
    predecessorCommit,
    successorCommit,
    predecessorEnvelopeHash: "1".repeat(64),
    successorEnvelopeHash: "2".repeat(64),
    rootEvidenceCommit,
    rootEnvelopeHash: "4".repeat(64),
    rootReceiptDigest,
    rootArtifactDigest,
    rootStoredProjectionDigest,
    rootCapturedAt,
    immutableProjectionHash: "3".repeat(64),
    firstParentChainHash: await canonicalSha256([predecessorCommit, successorCommit]),
    gitTreeProjectionHash: await canonicalSha256(changes),
    criticalProjectionHash: "6".repeat(64),
    dependencyProjectionHash: "7".repeat(64),
    providerCallsPerformed: 0 as const,
    storeWritesPerformed: 0 as const,
    replayOnly: true as const,
    evidence: {
      executionBuildCommit: predecessorCommit,
      tree: "8".repeat(40),
      changedPaths: changes.map(({ path }) => path),
      treeChanges: changes,
      requiredPathsHash: await canonicalSha256(
        JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_REQUIRED_PATHS
      ),
      gitTreeProjectionHash: await canonicalSha256(changes),
      supplementalPackageDigest: "9".repeat(64),
      jsonExportSha256: "a".repeat(64),
      markdownExportSha256: "b".repeat(64),
      measuredSourceSha256: "c".repeat(64),
      scoreEarned: 3 as const,
      scorePossible: 3 as const,
      modelCallCount: 0 as const,
      includedInSemanticDenominator: false as const,
      semanticEvidenceBuildCommit: JUDGE_DEMO_INVOCATION_INTEGRITY_SEALED_EVIDENCE_BUILD,
      semanticPackageDigest: JUDGE_DEMO_INVOCATION_INTEGRITY_SEMANTIC_PACKAGE_DIGEST,
      semanticBaselinePassed: 23 as const,
      semanticRevisedPassed: 23 as const,
      semanticPossible: 24 as const,
      semanticNoMeasuredImprovement: true as const,
      immutableProjectionHash: "d".repeat(64)
    },
    gate6PresentationProofHash: "e".repeat(64),
    gate6CriticalProjectionHash: "f".repeat(64),
    modelCallsPerformed: 0 as const,
    scoredCallsPerformed: 0 as const
  };
  return verifyJudgeDemoPresentationTransition({
    ...payload,
    proofHash: await canonicalSha256(payload)
  });
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("judge provider-free presentation lineage", () => {
  it("preserves v2/v3 order and accepts only the exact v4 material/evidence/collateral order", () => {
    const recovery = { kind: "sealed-reader-compatibility-recovery" as const };
    const rebrand = { kind: "presentation-rebrand" as const };
    const integrity = { kind: "invocation-integrity" as const };
    const evidence = { kind: "invocation-integrity-evidence" as const };
    const collateral = { kind: "collateral-links" as const };

    expect(
      judgeDemoPresentationOrderValid(JUDGE_DEMO_PRESENTATION_BINDING_VERSION, [recovery])
    ).toBe(true);
    expect(
      judgeDemoPresentationOrderValid(JUDGE_DEMO_PRESENTATION_REBRAND_BINDING_VERSION, [
        recovery,
        rebrand,
        collateral
      ])
    ).toBe(true);
    for (const transitions of [
      [recovery, rebrand, integrity],
      [recovery, rebrand, integrity, evidence],
      [recovery, rebrand, integrity, collateral],
      [recovery, rebrand, integrity, evidence, collateral]
    ]) {
      expect(
        judgeDemoPresentationOrderValid(
          JUDGE_DEMO_INVOCATION_INTEGRITY_BINDING_VERSION,
          transitions
        )
      ).toBe(true);
    }
    for (const transitions of [
      [recovery, rebrand],
      [recovery, rebrand, evidence, integrity],
      [recovery, rebrand, integrity, collateral, evidence],
      [recovery, rebrand, integrity, evidence, evidence]
    ]) {
      expect(
        judgeDemoPresentationOrderValid(
          JUDGE_DEMO_INVOCATION_INTEGRITY_BINDING_VERSION,
          transitions
        )
      ).toBe(false);
    }
  });

  it("verifies digest-bound v4 integrity and supplemental-evidence transition contracts", async () => {
    await expect(invocationIntegrityTransitionFixture()).resolves.toMatchObject({
      kind: "invocation-integrity",
      ordinal: 2,
      modelCallsPerformed: 0,
      scoredCallsPerformed: 0,
      providerCallsPerformed: 0,
      storeWritesPerformed: 0,
      replayOnly: true
    });
    const finalizedProtocol = structuredClone(await invocationIntegrityTransitionFixture());
    if (finalizedProtocol.kind !== "invocation-integrity") {
      throw new Error("test_transition_kind_mismatch");
    }
    finalizedProtocol.protocolExtension.commitCount = 2;
    const finalizedPayload: Record<string, unknown> = { ...finalizedProtocol };
    delete finalizedPayload.proofHash;
    await expect(
      verifyJudgeDemoPresentationTransition({
        ...finalizedPayload,
        proofHash: await canonicalSha256(finalizedPayload)
      })
    ).resolves.toMatchObject({
      kind: "invocation-integrity",
      protocolExtension: { commitCount: 2 }
    });
    await expect(invocationIntegrityEvidenceTransitionFixture()).resolves.toMatchObject({
      kind: "invocation-integrity-evidence",
      ordinal: 3,
      evidence: {
        scoreEarned: 3,
        scorePossible: 3,
        modelCallCount: 0,
        includedInSemanticDenominator: false
      }
    });

    const tampered = structuredClone(await invocationIntegrityTransitionFixture());
    if (tampered.kind !== "invocation-integrity") throw new Error("test_transition_kind_mismatch");
    tampered.implementation.changedPaths = tampered.implementation.changedPaths.slice(1);
    tampered.implementation.treeChanges = tampered.implementation.treeChanges.slice(1);
    tampered.implementation.gitTreeProjectionHash = await canonicalSha256(
      tampered.implementation.treeChanges
    );
    const payload: Record<string, unknown> = { ...tampered };
    delete payload.proofHash;
    await expect(
      verifyJudgeDemoPresentationTransition({
        ...payload,
        proofHash: await canonicalSha256(payload)
      })
    ).rejects.toThrow(/invocation_integrity|too_small/u);
  });

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
    const finalizedPublicBinding = publicJudgeDemoPresentationBinding(finalizedBinding);
    const legacyTransition = finalizedPublicBinding.transitions[0]!;
    expect(Object.hasOwn(legacyTransition, "rebrandVerification")).toBe(false);
    expect(Object.keys(legacyTransition).sort()).toEqual(
      [
        "ciTimeoutValidation",
        "criticalProjectionHash",
        "dependencyProjectionHash",
        "firstParentChainHash",
        "gitTreeProjectionHash",
        "kind",
        "ordinal",
        "predecessorCommit",
        "predecessorEnvelopeHash",
        "proofHash",
        "providerCallsPerformed",
        "replayOnly",
        "storeWritesPerformed",
        "successorCommit",
        "successorEnvelopeHash"
      ].sort()
    );
    expect(legacyTransition.ciTimeoutValidation).toMatchObject({
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

    const truthFinalized = await truthStatusFinalizationFixture();
    const truthFinalizedBinding = await bindingFor({
      rootCommit: truthFinalized.rootCommit,
      activeCommit: truthFinalized.activeCommit,
      transitions: [truthFinalized.recovery]
    });
    await expect(
      verifyJudgeDemoPresentationCheckout({
        cwd: truthFinalized.cwd,
        binding: truthFinalizedBinding
      })
    ).resolves.toMatchObject({
      transitionCount: 1,
      changedPathCount: JUDGE_DEMO_RECOVERY_PATHS.length
    });
    expect(
      publicJudgeDemoPresentationBinding(truthFinalizedBinding).transitions[0]?.ciTimeoutValidation
        ?.truthStatusFinalization
    ).toEqual(truthFinalized.truthStatus);
  }, 20_000);

  it("verifies ordered recovery then collateral links without changing critical bytes", async () => {
    const value = await truthStatusFinalizationFixture();
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

  it("rejects collateral mode, newline, relocation, and whitespace drift", async () => {
    const predecessorValue = "reserved for the verified Gate 9 link-only release commit";
    const successorValue = "https://github.com/serg337/toolproof";
    const predecessorLine = `Public repository: ${predecessorValue}`;
    const successorLine = `Public repository: ${successorValue}`;
    for (const scenario of ["mode", "crlf", "relocation", "whitespace"] as const) {
      const value = await truthStatusFinalizationFixture();
      const source = await readFile(join(value.cwd, "README.md"), "utf8");
      let successor = source.replace(predecessorLine, successorLine);
      if (scenario === "crlf") successor = successor.replace(/\n/gu, "\r\n");
      if (scenario === "relocation") {
        const lines = successor.split("\n");
        const index = lines.indexOf(successorLine);
        if (index < 0) throw new Error("test_collateral_line_missing");
        lines.splice(index, 1);
        lines.push(successorLine);
        successor = lines.join("\n");
      }
      if (scenario === "whitespace") {
        successor = successor.replace(successorLine, `${successorLine} `);
      }
      await write(value.cwd, "README.md", successor);
      git(value.cwd, ["add", "--", "README.md"]);
      if (scenario === "mode") {
        git(value.cwd, ["update-index", "--chmod=+x", "README.md"]);
      }
      git(value.cwd, ["commit", "-q", "-m", `invalid collateral ${scenario}`]);
      const releaseCommit = git(value.cwd, ["rev-parse", "HEAD"]);
      const collateral = await collateralTransition({
        cwd: value.cwd,
        rootCommit: value.rootCommit,
        recoveryCommit: value.activeCommit,
        releaseCommit,
        collateralChanges: [
          {
            path: "README.md",
            field: "public_repository",
            predecessorValue,
            successorValue
          }
        ]
      });
      const binding = await bindingFor({
        rootCommit: value.rootCommit,
        activeCommit: releaseCommit,
        transitions: [value.recovery, collateral]
      });
      await expect(
        verifyJudgeDemoPresentationCheckout({ cwd: value.cwd, binding }),
        scenario
      ).rejects.toThrow(
        scenario === "mode"
          ? /judge_demo_presentation_collateral_tree_mode_invalid/u
          : /judge_demo_presentation_non_link_change/u
      );
    }
  }, 19_000);

  it("verifies recovery then a provider-free presentation rebrand anchored to build768", async () => {
    const value = await presentationRebrandFixture();
    const binding = await bindingFor({
      rootCommit: value.rootCommit,
      activeCommit: value.rebrandCommit,
      transitions: [value.recovery, value.rebrand],
      version: JUDGE_DEMO_PRESENTATION_REBRAND_BINDING_VERSION
    });
    await expect(
      verifyJudgeDemoPresentationCheckout({ cwd: value.cwd, binding })
    ).resolves.toMatchObject({
      transitionCount: 2,
      criticalFileCount: JUDGE_DEMO_CRITICAL_PATHS.length
    });
    const [rootEnvelope, activeEnvelope] = await Promise.all([
      createJudgeDemoEnvelope(value.rootCommit),
      createJudgeDemoEnvelope(value.rebrandCommit)
    ]);
    const configuredEnvironment = {
      [JUDGE_DEMO_PRESENTATION_BINDING_ENV]: gzipSync(Buffer.from(canonicalJson(binding))).toString(
        "base64url"
      ),
      [JUDGE_DEMO_PRESENTATION_BINDING_HASH_ENV]: binding.bindingHash,
      [GATE6_PRESENTATION_PROOF_ENV]: gzipSync(
        Buffer.from(canonicalJson(value.gate6Proof))
      ).toString("base64url"),
      TOOLPROOF_GATE6_PRESENTATION_PROOF_HASH: value.gate6Proof.proofHash
    };
    await expect(
      configuredJudgeDemoPresentationBinding({
        environment: configuredEnvironment,
        rootEnvelope,
        activeEnvelope,
        rootReceiptDigest,
        rootArtifactDigest,
        rootStoredProjectionDigest,
        rootCapturedAt
      })
    ).resolves.toEqual(binding);
    await expect(
      configuredJudgeDemoPresentationBinding({
        environment: {
          ...configuredEnvironment,
          TOOLPROOF_GATE6_PRESENTATION_PROOF_HASH: "f".repeat(64)
        },
        rootEnvelope,
        activeEnvelope,
        rootReceiptDigest,
        rootArtifactDigest,
        rootStoredProjectionDigest,
        rootCapturedAt
      })
    ).rejects.toThrow(/judge_demo_presentation_rebrand_gate6_mismatch/u);
    const publicBinding = publicJudgeDemoPresentationBinding(binding);
    expect(publicBinding).toMatchObject({
      version: "toolproof-judge-demo-public-presentation-lineage@3.0.0",
      transitions: [
        { kind: "sealed-reader-compatibility-recovery" },
        {
          kind: "presentation-rebrand",
          rebrandVerification: {
            productNameBefore: "ToolProof",
            productNameAfter: "Thurstone",
            predecessorBindingHash: JUDGE_DEMO_REBRAND_PREDECESSOR_BINDING_HASH,
            predecessorBindingArtifactSha256:
              JUDGE_DEMO_REBRAND_PREDECESSOR_BINDING_ARTIFACT_SHA256,
            scoredCallsPerformed: 0
          }
        }
      ],
      providerCallsPerformed: 0,
      storeWritesPerformed: 0
    });
    expect(Object.hasOwn(publicBinding.transitions[0]!, "rebrandVerification")).toBe(false);
    expect(Object.hasOwn(publicBinding.transitions[1]!, "rebrandVerification")).toBe(true);
  }, 19_000);

  it("allows only a direct-child ordinal-two collateral hop after the rebrand", async () => {
    const value = await presentationRebrandFixture();
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
    git(value.cwd, ["commit", "-q", "-m", "add final public links"]);
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
      recoveryCommit: value.rebrandCommit,
      releaseCommit,
      collateralChanges,
      ordinal: 2,
      version: JUDGE_DEMO_PRESENTATION_REBRAND_TRANSITION_VERSION
    });
    const binding = await bindingFor({
      rootCommit: value.rootCommit,
      activeCommit: releaseCommit,
      transitions: [value.recovery, value.rebrand, collateral],
      version: JUDGE_DEMO_PRESENTATION_REBRAND_BINDING_VERSION
    });
    await expect(
      verifyJudgeDemoPresentationCheckout({ cwd: value.cwd, binding })
    ).resolves.toMatchObject({ transitionCount: 3 });

    await expect(
      collateralTransition({
        cwd: value.cwd,
        rootCommit: value.rootCommit,
        recoveryCommit: value.rebrandCommit,
        releaseCommit,
        collateralChanges,
        ordinal: 1,
        version: JUDGE_DEMO_PRESENTATION_REBRAND_TRANSITION_VERSION
      })
    ).rejects.toThrow();
  }, 19_000);

  it("rejects rebrand projection substitution, nonzero scored work, and active drift", async () => {
    const value = await presentationRebrandFixture();
    const unsigned = { ...value.rebrand };
    delete (unsigned as Partial<typeof value.rebrand>).proofHash;
    await expect(
      verifyJudgeDemoPresentationTransition({
        ...unsigned,
        scoredCallsPerformed: 1,
        proofHash: await canonicalSha256({ ...unsigned, scoredCallsPerformed: 1 })
      })
    ).rejects.toThrow();
    const wrongArtifactUnsigned = {
      ...unsigned,
      predecessorBinding: {
        ...value.rebrand.predecessorBinding,
        reviewedArtifactSha256: "f".repeat(64)
      }
    };
    await expect(
      verifyJudgeDemoPresentationTransition({
        ...wrongArtifactUnsigned,
        proofHash: await canonicalSha256(wrongArtifactUnsigned)
      })
    ).rejects.toThrow();

    const alteredTreeChanges = value.rebrand.branding.treeChanges.map((change, index) =>
      index === 0 ? { ...change, successorBlobOid: "f".repeat(40) } : change
    );
    const alteredBranding = {
      ...value.rebrand.branding,
      treeChanges: alteredTreeChanges,
      gitTreeProjectionHash: await canonicalSha256(alteredTreeChanges)
    };
    const alteredUnsigned = { ...unsigned, branding: alteredBranding };
    const altered = (await verifyJudgeDemoPresentationTransition({
      ...alteredUnsigned,
      proofHash: await canonicalSha256(alteredUnsigned)
    })) as JudgeDemoRebrandTransition;
    const alteredBinding = await bindingFor({
      rootCommit: value.rootCommit,
      activeCommit: value.rebrandCommit,
      transitions: [value.recovery, altered],
      version: JUDGE_DEMO_PRESENTATION_REBRAND_BINDING_VERSION
    });
    await expect(
      verifyJudgeDemoPresentationCheckout({ cwd: value.cwd, binding: alteredBinding })
    ).rejects.toThrow(/judge_demo_rebrand_step_projection_invalid/u);

    const binding = await bindingFor({
      rootCommit: value.rootCommit,
      activeCommit: value.rebrandCommit,
      transitions: [value.recovery, value.rebrand],
      version: JUDGE_DEMO_PRESENTATION_REBRAND_BINDING_VERSION
    });
    await write(value.cwd, "package.json", '{"name":"thurstone"}\n');
    await expect(verifyJudgeDemoPresentationCheckout({ cwd: value.cwd, binding })).rejects.toThrow(
      /judge_demo_rebrand_compatibility_identity_invalid/u
    );
  }, 19_000);

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

    await expect(
      recoveryTransition({
        cwd: finalized.cwd,
        rootCommit: finalized.rootCommit,
        recoveryCommit: finalized.implementationCommit,
        ciTimeoutValidation: {
          ...finalized.validation,
          activeCommit: finalized.implementationCommit,
          activeTree: JUDGE_DEMO_RECOVERY_IMPLEMENTATION_TREE
        }
      })
    ).rejects.toThrow(/judge_demo_recovery_transition_invalid/u);

    const truthFinalized = await truthStatusFinalizationFixture();
    const tamperedTruthChanges = truthFinalized.truthStatus.treeChanges.map((change, index) =>
      index === 0 ? { ...change, successorBlobOid: "f".repeat(40) } : change
    );
    const tamperedTruth = {
      ...truthFinalized.truthStatus,
      treeChanges: tamperedTruthChanges,
      gitTreeProjectionHash: await canonicalSha256(tamperedTruthChanges)
    };
    const tamperedTruthRecovery = await recoveryTransition({
      cwd: truthFinalized.cwd,
      rootCommit: truthFinalized.rootCommit,
      recoveryCommit: truthFinalized.activeCommit,
      ciTimeoutValidation: {
        ...truthFinalized.validation,
        truthStatusFinalization: tamperedTruth
      }
    });
    const tamperedTruthBinding = await bindingFor({
      rootCommit: truthFinalized.rootCommit,
      activeCommit: truthFinalized.activeCommit,
      transitions: [tamperedTruthRecovery]
    });
    await expect(
      verifyJudgeDemoPresentationCheckout({
        cwd: truthFinalized.cwd,
        binding: tamperedTruthBinding
      })
    ).rejects.toThrow(/judge_demo_presentation_truth_status_tree_invalid/u);

    const stale = await truthStatusFinalizationFixture({ staleReadme: true });
    const staleBinding = await bindingFor({
      rootCommit: stale.rootCommit,
      activeCommit: stale.activeCommit,
      transitions: [stale.recovery]
    });
    await expect(
      verifyJudgeDemoPresentationCheckout({ cwd: stale.cwd, binding: staleBinding })
    ).rejects.toThrow(/judge_demo_presentation_truth_status_readme_invalid/u);

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
