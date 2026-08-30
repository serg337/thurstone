import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { brotliCompressSync, brotliDecompressSync, gzipSync } from "node:zlib";
import { ESLint } from "eslint";
import { check as prettierCheck, resolveConfig as resolvePrettierConfig } from "prettier";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  verifyImpactExecutionFinalizationCheckout,
  verifyImpactExecutionOperationalSourceProjection,
  verifyInvocationIntegrityEvidenceCheckout,
  verifyJudgeDemoCollateralCheckout,
  verifyJudgeDemoPresentationCheckout
} from "@/lib/judge/collateral-checkout-verifier.server";
import {
  applyImpactExecutionJudgeDiagnosticsPresentation,
  JUDGE_DEMO_CI_TIMEOUT_COUNT,
  JUDGE_DEMO_CI_TIMEOUT_MS,
  JUDGE_DEMO_CI_TIMEOUT_PATH,
  JUDGE_DEMO_CI_TIMEOUT_VALIDATION_VERSION,
  JUDGE_DEMO_COLLATERAL_FIELD_PREFIXES,
  JUDGE_DEMO_CRITICAL_PATHS,
  JUDGE_DEMO_GATE9_COLLATERAL_PREPARATION_PATHS,
  JUDGE_DEMO_GATE9_COLLATERAL_PREPARATION_VERSION,
  JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_BINDING_HASH,
  JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_COMMIT,
  JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_TRANSITION_PROOF_HASH,
  JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_TREE,
  JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_BINDING_HASH,
  JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_COMMIT,
  JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_PROOF_HASH,
  JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_TRANSITION_PROOF_HASH,
  JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_TREE,
  JUDGE_DEMO_GATE9_CI_FINALIZATION_PATHS,
  JUDGE_DEMO_GATE9_CI_FINALIZATION_VERSION,
  JUDGE_DEMO_GATE9_CI_PORTABILITY_FAILURE_CLASS,
  JUDGE_DEMO_GATE9_CI_PORTABILITY_INVARIANT,
  JUDGE_DEMO_GATE9_CI_PORTABILITY_REPAIR_PATHS,
  JUDGE_DEMO_GATE9_CI_PORTABILITY_REPAIR_VERSION,
  JUDGE_DEMO_GATE9_COLLATERAL_PREDECESSOR_VALUE,
  JUDGE_DEMO_GATE9_EVIDENCE_BINDING_HASH,
  JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_COMMIT,
  JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_TREE,
  JUDGE_DEMO_GATE9_EVIDENCE_TRANSITION_PROOF_HASH,
  JUDGE_DEMO_GATE9_GIT_PACK_TRANSPORT,
  JUDGE_DEMO_GATE9_PROTOCOL_FINALIZATION_PATHS,
  JUDGE_DEMO_GATE9_PROTOCOL_FINALIZATION_VERSION,
  JUDGE_DEMO_GATE9_PUBLIC_REPOSITORY_URL,
  JUDGE_DEMO_GATE9_RELEASE_URL,
  JUDGE_DEMO_IMPACT_EXECUTION_ACTIVE_IMMUTABLE_PROJECTION_HASH,
  JUDGE_DEMO_IMPACT_EXECUTION_DEPENDENCY_PROJECTION_HASH,
  JUDGE_DEMO_IMPACT_EXECUTION_FINALIZATION_VERSION,
  JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_BLOB_OID,
  JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH,
  JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_FINAL_U_FILE_IDENTITIES,
  JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_BANNER_Q,
  JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_BANNER_U,
  JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_RETURN_Q,
  JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_RETURN_U,
  JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_STATUS_Q,
  JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_STATUS_U,
  JUDGE_DEMO_IMPACT_EXECUTION_INVOCATION_HEADING_Q,
  JUDGE_DEMO_IMPACT_EXECUTION_INVOCATION_HEADING_U,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_MOUNT_ANCHOR,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_MOUNT_SNIPPET,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_DIAGNOSTICS_MARKER,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_DIAGNOSTICS_SUMMARY,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_FULL_U_LENGTH,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_FULL_U_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_PORTAL_IMPORT,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_REACT_IMPORT_Q,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_REACT_IMPORT_U,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_RETURN_END_Q,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_RETURN_END_U,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_RETURN_START_Q,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_RETURN_START_U,
  JUDGE_DEMO_IMPACT_EXECUTION_LAB_RETURN_Q,
  JUDGE_DEMO_IMPACT_EXECUTION_LAB_RETURN_U,
  JUDGE_DEMO_IMPACT_EXECUTION_LAB_RECEIPT_SELECTOR_COUNT,
  JUDGE_DEMO_IMPACT_EXECUTION_LAB_RECEIPT_SELECTOR_U,
  JUDGE_DEMO_IMPACT_EXECUTION_LAZY_HELPER_TEMPLATE,
  JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_BINDING_HASH,
  JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_COMMIT,
  JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_ENVELOPE_HASH,
  JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_GATE6_PROOF_HASH,
  JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_TRANSITION_PROOF_HASH,
  JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_TREE,
  JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS,
  JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS_HASH,
  JUDGE_DEMO_IMPACT_EXECUTION_Q_MIXED_FILE_IDENTITIES,
  JUDGE_DEMO_IMPACT_EXECUTION_Q_ROUTE_IDENTITIES,
  JUDGE_DEMO_IMPACT_EXECUTION_Q_TEST_FILE_IDENTITIES,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_IMPORT_Q,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_IMPORT_U,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_RENDER,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_TEMPLATE,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_COMPACT_BLOCK_TEMPLATE,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_COMPONENT_IMPORT_U,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_FULL_QUERY,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_FUNCTION_U,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_INVOCATION_ARTIFACT_IMPORT,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_SEMANTIC_ARTIFACT_IMPORT,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_SUMMARY_CALL,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_SUMMARY_TEMPLATE,
  JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS,
  JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS_HASH,
  JUDGE_DEMO_IMPACT_EXECUTION_ROOT_IMMUTABLE_PROJECTION_HASH,
  JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_PRESENTATION_MARKER,
  JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_RETURN_Q,
  JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_RETURN_U,
  JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_END,
  JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_START,
  JUDGE_DEMO_IMPACT_EXECUTION_TEST_REPLACEMENTS,
  JUDGE_DEMO_IMPACT_EXECUTION_U_PATCH_BROTLI_BASE64URL,
  JUDGE_DEMO_IMPACT_EXECUTION_U_PATCH_BROTLI_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_U_PATCH_RAW_BYTES,
  JUDGE_DEMO_IMPACT_EXECUTION_U_PATCH_SHA256,
  JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_COMMIT,
  JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_PATH,
  JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_SHA256,
  JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_TREE,
  JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_ALLOWED_PATHS,
  JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_PROTOCOL_PATHS,
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
  judgeDemoInvocationIntegrityEvidencePathCompare,
  judgeDemoImmutableProjectionHash,
  verifyJudgeDemoPresentationTransition,
  type JudgeDemoCollateralTransition,
  type JudgeDemoInvocationIntegrityEvidenceTransition,
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
  dependencyProjectionHash,
  gate6PresentationPathAllowed
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

function evidenceTreeChanges(cwd: string, predecessorCommit: string, successorCommit: string) {
  return [...rawTreeChanges(cwd, predecessorCommit, successorCommit)].sort((left, right) =>
    judgeDemoInvocationIntegrityEvidencePathCompare(left.path, right.path)
  );
}

async function transitionCommon(input: {
  cwd: string;
  rootCommit: string;
  predecessorCommit: string;
  successorCommit: string;
  ordinal: 0 | 1 | 2 | 3 | 4;
  version?:
    | typeof JUDGE_DEMO_PRESENTATION_TRANSITION_VERSION
    | typeof JUDGE_DEMO_PRESENTATION_REBRAND_TRANSITION_VERSION
    | typeof JUDGE_DEMO_INVOCATION_INTEGRITY_TRANSITION_VERSION;
}) {
  const [rootEnvelope, predecessorEnvelope, successorEnvelope] = await Promise.all([
    createJudgeDemoEnvelope(input.rootCommit, { historicalPresentation: true }),
    createJudgeDemoEnvelope(input.predecessorCommit, { historicalPresentation: true }),
    createJudgeDemoEnvelope(input.successorCommit, { historicalPresentation: true })
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
  ordinal?: 1 | 2 | 3 | 4;
  version?:
    | typeof JUDGE_DEMO_PRESENTATION_TRANSITION_VERSION
    | typeof JUDGE_DEMO_PRESENTATION_REBRAND_TRANSITION_VERSION
    | typeof JUDGE_DEMO_INVOCATION_INTEGRITY_TRANSITION_VERSION;
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
  gitProofPackSha256?: string;
}): Promise<JudgeDemoPresentationBinding> {
  const [rootEnvelope, activeEnvelope] = await Promise.all([
    createJudgeDemoEnvelope(input.rootCommit, { historicalPresentation: true }),
    createJudgeDemoEnvelope(input.activeCommit, { historicalPresentation: true })
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
    gitProofPackSha256: input.gitProofPackSha256 ?? "a".repeat(64),
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
  const protocolCommit = "d".repeat(40);
  const successorCommit = "f".repeat(40);
  const protocolChanges = JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_PROTOCOL_PATHS.map((path) =>
    boundedTreeChange(path)
  );
  const evidencePaths = [
    "PLAN.md",
    "README.md",
    ...JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_REQUIRED_PATHS
  ].sort(judgeDemoInvocationIntegrityEvidencePathCompare);
  const changes = evidencePaths.map((path) => boundedTreeChange(path, true));
  const aggregateChanges = [...protocolChanges, ...changes].sort((left, right) =>
    judgeDemoInvocationIntegrityEvidencePathCompare(left.path, right.path)
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
    firstParentChainHash: await canonicalSha256([
      predecessorCommit,
      protocolCommit,
      successorCommit
    ]),
    gitTreeProjectionHash: await canonicalSha256(aggregateChanges),
    criticalProjectionHash: "6".repeat(64),
    dependencyProjectionHash: "7".repeat(64),
    providerCallsPerformed: 0 as const,
    storeWritesPerformed: 0 as const,
    replayOnly: true as const,
    protocolExtension: {
      commit: protocolCommit,
      tree: "7".repeat(40),
      changedPaths: [...JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_PROTOCOL_PATHS],
      treeChanges: protocolChanges,
      gitTreeProjectionHash: await canonicalSha256(protocolChanges)
    },
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

async function invocationIntegrityEvidenceCheckoutFixture(
  options: { readonly terminalFinalization?: boolean } = {}
) {
  const cwd = await mkdtemp(join(tmpdir(), "toolproof-invocation-evidence-"));
  temporaryRoots.push(cwd);
  git(cwd, ["init", "-q"]);

  for (const path of JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_PROTOCOL_PATHS) {
    await write(cwd, path, `protocol predecessor: ${path}\n`);
  }
  const evidencePaths = [
    "PLAN.md",
    "README.md",
    "docs/demo-script.md",
    ...JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_REQUIRED_PATHS,
    "submission/devpost.md"
  ].sort(judgeDemoInvocationIntegrityEvidencePathCompare);
  if (
    evidencePaths.some(
      (path) => !JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_ALLOWED_PATHS.includes(path)
    )
  ) {
    throw new Error("test_invocation_evidence_path_not_allowed");
  }
  for (const path of evidencePaths) {
    if (path.startsWith("evidence/")) continue;
    await write(cwd, path, `evidence predecessor: ${path}\n`);
  }
  for (const path of JUDGE_DEMO_GATE9_PROTOCOL_FINALIZATION_PATHS) {
    if (
      !JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_PROTOCOL_PATHS.includes(path) &&
      !evidencePaths.includes(path)
    ) {
      await write(cwd, path, `gate9 protocol predecessor: ${path}\n`);
    }
  }
  for (const path of JUDGE_DEMO_GATE9_COLLATERAL_PREPARATION_PATHS) {
    if (path !== "public/thurstone-devpost-thumbnail.jpg" && !evidencePaths.includes(path)) {
      await write(cwd, path, `gate9 collateral predecessor: ${path}\n`);
    }
  }
  await write(
    cwd,
    "lib/results/invocation-integrity-measured.ts",
    "export const MEASURED_INVOCATION_INTEGRITY_EVIDENCE = null;\n"
  );
  const predecessorPaths = [
    ...JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_PROTOCOL_PATHS,
    ...evidencePaths.filter((path) => !path.startsWith("evidence/")),
    ...JUDGE_DEMO_GATE9_PROTOCOL_FINALIZATION_PATHS,
    ...JUDGE_DEMO_GATE9_COLLATERAL_PREPARATION_PATHS.filter(
      (path) => path !== "public/thurstone-devpost-thumbnail.jpg"
    )
  ].sort(judgeDemoInvocationIntegrityEvidencePathCompare);
  git(cwd, ["add", "--", ...new Set(predecessorPaths)]);
  git(cwd, ["commit", "-q", "-m", "invocation evidence execution build"]);
  const predecessorCommit = git(cwd, ["rev-parse", "HEAD"]);

  for (const path of JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_PROTOCOL_PATHS) {
    await write(cwd, path, `protocol successor: ${path}\n`);
  }
  git(cwd, ["add", "--", ...JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_PROTOCOL_PATHS]);
  git(cwd, ["commit", "-q", "-m", "freeze invocation evidence transport"]);
  const protocolCommit = git(cwd, ["rev-parse", "HEAD"]);

  const supplementalPackageDigest = "9".repeat(64);
  const evidenceDocument = `${JSON.stringify({
    evidenceClass: "supplemental-invocation-integrity",
    modelCallCount: 0,
    includedInSemanticDenominator: false,
    packageDigest: supplementalPackageDigest,
    score: { earned: 3, possible: 3 }
  })}\n`;
  const successorContents = new Map<string, Buffer>([
    ["PLAN.md", Buffer.from("Gate 8.5 complete; Gate 9 human gate.\n")],
    ["README.md", Buffer.from("Invocation Integrity is separately scored 3/3.\n")],
    ["docs/demo-script.md", Buffer.from("Show the separate Invocation Integrity Matrix.\n")],
    ["evidence/thurstone-invocation-integrity.json", Buffer.from(evidenceDocument)],
    [
      "evidence/thurstone-invocation-integrity.md",
      Buffer.from("# Invocation Integrity\n\nSeparate score: 3/3.\n")
    ],
    [
      "lib/results/invocation-integrity-measured.ts",
      Buffer.from("export const MEASURED_INVOCATION_INTEGRITY_EVIDENCE = Object.freeze({});\n")
    ],
    ["submission/devpost.md", Buffer.from("Invocation Integrity is separately scored 3/3.\n")]
  ]);
  for (const [path, bytes] of successorContents) {
    await mkdir(dirname(join(cwd, path)), { recursive: true });
    await writeFile(join(cwd, path), bytes);
  }
  git(cwd, ["add", "--", ...evidencePaths]);
  git(cwd, ["commit", "-q", "-m", "seal invocation integrity evidence"]);
  const evidenceMaterialCommit = git(cwd, ["rev-parse", "HEAD"]);

  let protocolFinalizationCommit: string | null = null;
  let successorCommit = evidenceMaterialCommit;
  if (options.terminalFinalization === true) {
    for (const path of JUDGE_DEMO_GATE9_PROTOCOL_FINALIZATION_PATHS) {
      await write(cwd, path, `gate9 protocol finalized: ${path}\n`);
    }
    git(cwd, ["add", "--", ...JUDGE_DEMO_GATE9_PROTOCOL_FINALIZATION_PATHS]);
    git(cwd, ["commit", "-q", "-m", "finalize gate9 proof transport"]);
    protocolFinalizationCommit = git(cwd, ["rev-parse", "HEAD"]);

    const preparedLinkDocument = [
      "Live app: https://toolproof-rust.vercel.app",
      "Public repository: reserved for the verified Gate 9 link-only release commit",
      "Release: reserved for the verified Gate 9 link-only release commit",
      "Demo video: reserved for the verified Gate 9 link-only release commit",
      ""
    ].join("\n");
    for (const path of JUDGE_DEMO_GATE9_COLLATERAL_PREPARATION_PATHS) {
      if (path === "public/thurstone-devpost-thumbnail.jpg") {
        await mkdir(dirname(join(cwd, path)), { recursive: true });
        await writeFile(join(cwd, path), Buffer.from("synthetic thumbnail bytes\n"));
      } else if (path === "README.md" || path === "submission/devpost.md") {
        await write(cwd, path, preparedLinkDocument);
      } else {
        await write(cwd, path, `gate9 collateral prepared: ${path}\n`);
      }
    }
    git(cwd, ["add", "--", ...JUDGE_DEMO_GATE9_COLLATERAL_PREPARATION_PATHS]);
    git(cwd, ["commit", "-q", "-m", "prepare gate9 collateral"]);
    successorCommit = git(cwd, ["rev-parse", "HEAD"]);
  }

  const protocolChanges = evidenceTreeChanges(cwd, predecessorCommit, protocolCommit);
  const evidenceChanges = evidenceTreeChanges(cwd, protocolCommit, evidenceMaterialCommit);
  const finalizationChanges =
    protocolFinalizationCommit === null
      ? []
      : evidenceTreeChanges(cwd, evidenceMaterialCommit, protocolFinalizationCommit);
  const preparationChanges =
    protocolFinalizationCommit === null
      ? []
      : evidenceTreeChanges(cwd, protocolFinalizationCommit, successorCommit);
  const aggregateChanges = evidenceTreeChanges(cwd, predecessorCommit, successorCommit);
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
    firstParentChainHash: await canonicalSha256(
      protocolFinalizationCommit === null
        ? [predecessorCommit, protocolCommit, successorCommit]
        : [
            predecessorCommit,
            protocolCommit,
            JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_COMMIT,
            protocolFinalizationCommit,
            successorCommit
          ]
    ),
    gitTreeProjectionHash: await canonicalSha256(aggregateChanges),
    criticalProjectionHash: "6".repeat(64),
    dependencyProjectionHash: "7".repeat(64),
    providerCallsPerformed: 0 as const,
    storeWritesPerformed: 0 as const,
    replayOnly: true as const,
    protocolExtension: {
      commit: protocolCommit,
      tree: git(cwd, ["rev-parse", `${protocolCommit}^{tree}`]),
      changedPaths: [...JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_PROTOCOL_PATHS],
      treeChanges: protocolChanges,
      gitTreeProjectionHash: await canonicalSha256(protocolChanges)
    },
    evidence: {
      executionBuildCommit: predecessorCommit,
      tree:
        protocolFinalizationCommit === null
          ? git(cwd, ["rev-parse", `${evidenceMaterialCommit}^{tree}`])
          : JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_TREE,
      changedPaths: evidenceChanges.map(({ path }) => path),
      treeChanges: evidenceChanges,
      requiredPathsHash: await canonicalSha256(
        JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_REQUIRED_PATHS
      ),
      gitTreeProjectionHash: await canonicalSha256(evidenceChanges),
      supplementalPackageDigest,
      jsonExportSha256: sha256(
        successorContents.get("evidence/thurstone-invocation-integrity.json")!
      ),
      markdownExportSha256: sha256(
        successorContents.get("evidence/thurstone-invocation-integrity.md")!
      ),
      measuredSourceSha256: sha256(
        successorContents.get("lib/results/invocation-integrity-measured.ts")!
      ),
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
    ...(protocolFinalizationCommit === null
      ? {}
      : {
          terminalFinalization: {
            predecessorBinding: {
              activeCommit: JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_COMMIT,
              activeTree: JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_TREE,
              bindingHash: JUDGE_DEMO_GATE9_EVIDENCE_BINDING_HASH,
              evidenceTransitionProofHash: JUDGE_DEMO_GATE9_EVIDENCE_TRANSITION_PROOF_HASH
            },
            evidenceMaterialCommit: JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_COMMIT,
            evidenceMaterialTree: JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_TREE,
            protocolFinalization: {
              version: JUDGE_DEMO_GATE9_PROTOCOL_FINALIZATION_VERSION,
              predecessorCommit: JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_COMMIT,
              successorCommit: protocolFinalizationCommit,
              successorTree: git(cwd, ["rev-parse", `${protocolFinalizationCommit}^{tree}`]),
              changedPaths: [...JUDGE_DEMO_GATE9_PROTOCOL_FINALIZATION_PATHS],
              treeChanges: finalizationChanges,
              gitTreeProjectionHash: await canonicalSha256(finalizationChanges),
              gitPackTransport: JUDGE_DEMO_GATE9_GIT_PACK_TRANSPORT,
              providerCallsPerformed: 0 as const,
              modelCallsPerformed: 0 as const,
              scoredCallsPerformed: 0 as const,
              storeWritesPerformed: 0 as const
            },
            collateralPreparation: {
              version: JUDGE_DEMO_GATE9_COLLATERAL_PREPARATION_VERSION,
              predecessorCommit: protocolFinalizationCommit,
              successorCommit,
              successorTree: git(cwd, ["rev-parse", `${successorCommit}^{tree}`]),
              changedPaths: [...JUDGE_DEMO_GATE9_COLLATERAL_PREPARATION_PATHS],
              treeChanges: preparationChanges,
              gitTreeProjectionHash: await canonicalSha256(preparationChanges),
              linkFieldsStatus: "reserved-for-final-link-only-release" as const,
              providerCallsPerformed: 0 as const,
              modelCallsPerformed: 0 as const,
              scoredCallsPerformed: 0 as const,
              storeWritesPerformed: 0 as const
            }
          }
        }),
    gate6PresentationProofHash: "e".repeat(64),
    gate6CriticalProjectionHash: "f".repeat(64),
    modelCallsPerformed: 0 as const,
    scoredCallsPerformed: 0 as const
  };
  const transition = await verifyJudgeDemoPresentationTransition({
    ...payload,
    proofHash: await canonicalSha256(payload)
  });
  if (transition.kind !== "invocation-integrity-evidence") {
    throw new Error("test_invocation_evidence_transition_kind_invalid");
  }
  return {
    cwd,
    predecessorCommit,
    protocolCommit,
    evidenceMaterialCommit,
    protocolFinalizationCommit,
    successorCommit,
    successorContents,
    transition
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("judge provider-free presentation lineage", () => {
  it("keeps the production presentation verifier inside the prospective protocol boundary", () => {
    expect(JUDGE_DEMO_INVOCATION_INTEGRITY_PROTOCOL_PATHS).toContain(
      "scripts/verify-judge-presentation.ts"
    );
  });

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

  it("uses deterministic codepoint order for mixed-case evidence paths", async () => {
    const transition = structuredClone(await invocationIntegrityEvidenceTransitionFixture());
    if (transition.kind !== "invocation-integrity-evidence") {
      throw new Error("test_transition_kind_mismatch");
    }
    expect(transition.evidence.changedPaths.slice(0, 2)).toEqual(["PLAN.md", "README.md"]);
    transition.evidence.changedPaths.sort((left, right) => left.localeCompare(right));
    transition.evidence.treeChanges.sort((left, right) => left.path.localeCompare(right.path));
    transition.evidence.gitTreeProjectionHash = await canonicalSha256(
      transition.evidence.treeChanges
    );
    const payload: Record<string, unknown> = { ...transition };
    delete payload.proofHash;
    await expect(
      verifyJudgeDemoPresentationTransition({
        ...payload,
        proofHash: await canonicalSha256(payload)
      })
    ).rejects.toThrow(/judge_demo_invocation_integrity_evidence_transition_invalid/u);
  });

  it("binds evidence checkout bytes without transporting their Git blobs", async () => {
    const value = await invocationIntegrityEvidenceCheckoutFixture();
    const firstParentChain = [value.predecessorCommit, value.protocolCommit, value.successorCommit];
    const verify = (
      transition: JudgeDemoInvocationIntegrityEvidenceTransition = value.transition,
      chain: readonly string[] = firstParentChain
    ) =>
      verifyInvocationIntegrityEvidenceCheckout({
        cwd: value.cwd,
        transition,
        firstParentChain: chain
      });

    for (const path of JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_REQUIRED_PATHS) {
      const oid = git(value.cwd, ["rev-parse", `${value.successorCommit}:${path}`]);
      await unlink(join(value.cwd, ".git", "objects", oid.slice(0, 2), oid.slice(2)));
    }
    await expect(verify()).resolves.toBeUndefined();

    const jsonPath = "evidence/thurstone-invocation-integrity.json";
    const jsonBytes = value.successorContents.get(jsonPath)!;
    await rm(join(value.cwd, jsonPath));
    await expect(verify()).rejects.toThrow(/active_checkout_mismatch/u);
    await writeFile(join(value.cwd, jsonPath), jsonBytes);

    await writeFile(join(value.cwd, jsonPath), "modified evidence\n");
    await expect(verify()).rejects.toThrow(/active_checkout_mismatch/u);
    await writeFile(join(value.cwd, jsonPath), jsonBytes);

    await chmod(join(value.cwd, jsonPath), 0o755);
    await expect(verify()).rejects.toThrow(/active_checkout_mismatch/u);
    await chmod(join(value.cwd, jsonPath), 0o644);

    await rm(join(value.cwd, jsonPath));
    await symlink("thurstone-invocation-integrity.md", join(value.cwd, jsonPath));
    await expect(verify()).rejects.toThrow(/active_checkout_type/u);
    await rm(join(value.cwd, jsonPath));
    await writeFile(join(value.cwd, jsonPath), jsonBytes);

    await expect(
      verify({
        ...value.transition,
        evidence: { ...value.transition.evidence, tree: value.transition.protocolExtension.tree }
      })
    ).rejects.toThrow(/invocation_evidence_chain_invalid/u);
    await expect(
      verify({
        ...value.transition,
        evidence: { ...value.transition.evidence, jsonExportSha256: "0".repeat(64) }
      })
    ).rejects.toThrow(/invocation_evidence_file_digest_invalid/u);
    await expect(verify(value.transition, firstParentChain.slice(0, 2))).rejects.toThrow(
      /invocation_evidence_chain_invalid/u
    );
  });

  it("binds the exact E-to-F-to-C terminal evidence finalization", async () => {
    const value = await invocationIntegrityEvidenceCheckoutFixture({ terminalFinalization: true });
    if (value.protocolFinalizationCommit === null) {
      throw new Error("test_gate9_protocol_finalization_missing");
    }
    expect(value.transition.terminalFinalization).toMatchObject({
      predecessorBinding: {
        activeCommit: JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_COMMIT,
        activeTree: JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_TREE,
        bindingHash: JUDGE_DEMO_GATE9_EVIDENCE_BINDING_HASH,
        evidenceTransitionProofHash: JUDGE_DEMO_GATE9_EVIDENCE_TRANSITION_PROOF_HASH
      },
      evidenceMaterialCommit: JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_COMMIT,
      protocolFinalization: {
        predecessorCommit: JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_COMMIT,
        successorCommit: value.protocolFinalizationCommit,
        gitPackTransport: JUDGE_DEMO_GATE9_GIT_PACK_TRANSPORT
      },
      collateralPreparation: {
        predecessorCommit: value.protocolFinalizationCommit,
        successorCommit: value.successorCommit,
        linkFieldsStatus: "reserved-for-final-link-only-release"
      }
    });
    expect(gate6PresentationPathAllowed("public/thurstone-devpost-thumbnail.jpg")).toBe(true);

    const tampered = structuredClone(value.transition);
    if (!tampered.terminalFinalization) {
      throw new Error("test_gate9_protocol_finalization_missing");
    }
    tampered.terminalFinalization.collateralPreparation.changedPaths =
      tampered.terminalFinalization.collateralPreparation.changedPaths.slice(1);
    await expect(
      verifyJudgeDemoPresentationTransition({
        ...tampered,
        proofHash: await canonicalSha256(
          Object.fromEntries(Object.entries(tampered).filter(([key]) => key !== "proofHash"))
        )
      })
    ).rejects.toThrow();
    await expect(
      verifyJudgeDemoPresentationTransition({
        ...value.transition,
        firstParentChainHash: await canonicalSha256([
          value.predecessorCommit,
          value.protocolCommit,
          JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_COMMIT,
          value.successorCommit,
          value.protocolFinalizationCommit
        ]),
        proofHash: value.transition.proofHash
      })
    ).rejects.toThrow();
  });

  it("binds the optional C-to-P10 CI finalization without changing prior terminal evidence", async () => {
    const value = await invocationIntegrityEvidenceCheckoutFixture({ terminalFinalization: true });
    const terminal = structuredClone(value.transition.terminalFinalization);
    if (!terminal || value.protocolFinalizationCommit === null) {
      throw new Error("test_gate9_protocol_finalization_missing");
    }
    const successorCommit = "9".repeat(40);
    const successorTree = "8".repeat(40);
    const ciChanges = JUDGE_DEMO_GATE9_CI_FINALIZATION_PATHS.map((path) => boundedTreeChange(path));
    terminal.collateralPreparation.successorCommit = JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_COMMIT;
    terminal.collateralPreparation.successorTree = JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_TREE;
    terminal.ciFinalization = {
      version: JUDGE_DEMO_GATE9_CI_FINALIZATION_VERSION,
      predecessorBinding: {
        activeCommit: JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_COMMIT,
        activeTree: JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_TREE,
        bindingHash: JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_BINDING_HASH,
        evidenceTransitionProofHash: JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_TRANSITION_PROOF_HASH
      },
      predecessorCommit: JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_COMMIT,
      predecessorTree: JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_TREE,
      successorCommit,
      successorTree,
      changedPaths: [...JUDGE_DEMO_GATE9_CI_FINALIZATION_PATHS],
      treeChanges: ciChanges,
      gitTreeProjectionHash: await canonicalSha256(ciChanges),
      dedupeInvariant: "unique-predecessor-blob-oids-unlinked-once",
      providerCallsPerformed: 0,
      modelCallsPerformed: 0,
      scoredCallsPerformed: 0,
      storeWritesPerformed: 0
    };
    const unsigned = {
      ...value.transition,
      successorCommit,
      terminalFinalization: terminal,
      firstParentChainHash: await canonicalSha256([
        value.predecessorCommit,
        value.protocolCommit,
        JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_COMMIT,
        value.protocolFinalizationCommit,
        JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_COMMIT,
        successorCommit
      ])
    };
    delete (unsigned as Partial<typeof value.transition>).proofHash;
    const verified = await verifyJudgeDemoPresentationTransition({
      ...unsigned,
      proofHash: await canonicalSha256(unsigned)
    });
    expect(verified).toMatchObject({
      successorCommit,
      terminalFinalization: {
        ciFinalization: {
          predecessorCommit: JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_COMMIT,
          successorCommit,
          dedupeInvariant: "unique-predecessor-blob-oids-unlinked-once"
        }
      }
    });

    const tampered = structuredClone(verified);
    if (tampered.kind !== "invocation-integrity-evidence" || !tampered.terminalFinalization) {
      throw new Error("test_gate9_ci_finalization_missing");
    }
    tampered.terminalFinalization.ciFinalization!.dedupeInvariant =
      "unique-predecessor-blob-oids-unlinked-once";
    tampered.terminalFinalization.ciFinalization!.treeChanges =
      tampered.terminalFinalization.ciFinalization!.treeChanges.slice(1);
    const tamperedPayload = { ...tampered } as Record<string, unknown>;
    delete tamperedPayload.proofHash;
    await expect(
      verifyJudgeDemoPresentationTransition({
        ...tamperedPayload,
        proofHash: await canonicalSha256(tamperedPayload)
      })
    ).rejects.toThrow();
  });

  it("binds one exact P10-to-Q packed-object portability repair", async () => {
    const value = await invocationIntegrityEvidenceCheckoutFixture({ terminalFinalization: true });
    const terminal = structuredClone(value.transition.terminalFinalization);
    if (!terminal || value.protocolFinalizationCommit === null) {
      throw new Error("test_gate9_protocol_finalization_missing");
    }
    const successorCommit = "7".repeat(40);
    const successorTree = "6".repeat(40);
    const ciChanges = JUDGE_DEMO_GATE9_CI_FINALIZATION_PATHS.map((path) => boundedTreeChange(path));
    const repairChanges = JUDGE_DEMO_GATE9_CI_PORTABILITY_REPAIR_PATHS.map((path) =>
      boundedTreeChange(path)
    );
    terminal.collateralPreparation.successorCommit = JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_COMMIT;
    terminal.collateralPreparation.successorTree = JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_TREE;
    terminal.ciFinalization = {
      version: JUDGE_DEMO_GATE9_CI_FINALIZATION_VERSION,
      predecessorBinding: {
        activeCommit: JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_COMMIT,
        activeTree: JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_TREE,
        bindingHash: JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_BINDING_HASH,
        evidenceTransitionProofHash: JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_TRANSITION_PROOF_HASH
      },
      predecessorCommit: JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_COMMIT,
      predecessorTree: JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_TREE,
      successorCommit: JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_COMMIT,
      successorTree: JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_TREE,
      changedPaths: [...JUDGE_DEMO_GATE9_CI_FINALIZATION_PATHS],
      treeChanges: ciChanges,
      gitTreeProjectionHash: await canonicalSha256(ciChanges),
      dedupeInvariant: "unique-predecessor-blob-oids-unlinked-once",
      providerCallsPerformed: 0,
      modelCallsPerformed: 0,
      scoredCallsPerformed: 0,
      storeWritesPerformed: 0
    };
    terminal.ciPortabilityRepair = {
      version: JUDGE_DEMO_GATE9_CI_PORTABILITY_REPAIR_VERSION,
      predecessorBinding: {
        activeCommit: JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_COMMIT,
        activeTree: JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_TREE,
        proofHash: JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_PROOF_HASH,
        bindingHash: JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_BINDING_HASH,
        evidenceTransitionProofHash:
          JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_TRANSITION_PROOF_HASH
      },
      predecessorCommit: JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_COMMIT,
      predecessorTree: JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_TREE,
      successorCommit,
      successorTree,
      changedPaths: [...JUDGE_DEMO_GATE9_CI_PORTABILITY_REPAIR_PATHS],
      treeChanges: repairChanges,
      gitTreeProjectionHash: await canonicalSha256(repairChanges),
      failureClass: JUDGE_DEMO_GATE9_CI_PORTABILITY_FAILURE_CLASS,
      portabilityInvariant: JUDGE_DEMO_GATE9_CI_PORTABILITY_INVARIANT,
      providerCallsPerformed: 0,
      modelCallsPerformed: 0,
      scoredCallsPerformed: 0,
      storeWritesPerformed: 0
    };
    const unsigned = {
      ...value.transition,
      successorCommit,
      terminalFinalization: terminal,
      firstParentChainHash: await canonicalSha256([
        value.predecessorCommit,
        value.protocolCommit,
        JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_COMMIT,
        value.protocolFinalizationCommit,
        JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_COMMIT,
        JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_COMMIT,
        successorCommit
      ])
    };
    delete (unsigned as Partial<typeof value.transition>).proofHash;
    const verified = await verifyJudgeDemoPresentationTransition({
      ...unsigned,
      proofHash: await canonicalSha256(unsigned)
    });
    expect(verified).toMatchObject({
      successorCommit,
      terminalFinalization: {
        ciPortabilityRepair: {
          predecessorCommit: JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_COMMIT,
          successorCommit,
          failureClass: JUDGE_DEMO_GATE9_CI_PORTABILITY_FAILURE_CLASS,
          portabilityInvariant: JUDGE_DEMO_GATE9_CI_PORTABILITY_INVARIANT
        }
      }
    });
    const omittedP10ChainHash = await canonicalSha256([
      value.predecessorCommit,
      value.protocolCommit,
      JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_COMMIT,
      value.protocolFinalizationCommit,
      JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_COMMIT,
      successorCommit
    ]);

    const expectInvalid = async (mutate: (candidate: Record<string, unknown>) => void) => {
      const candidate = structuredClone(verified) as unknown as Record<string, unknown>;
      mutate(candidate);
      delete candidate.proofHash;
      await expect(
        verifyJudgeDemoPresentationTransition({
          ...candidate,
          proofHash: await canonicalSha256(candidate)
        })
      ).rejects.toThrow();
    };
    await expectInvalid((candidate) => {
      const finalization = candidate.terminalFinalization as Record<string, unknown>;
      delete finalization.ciFinalization;
    });
    await expectInvalid((candidate) => {
      const finalization = candidate.terminalFinalization as Record<string, unknown>;
      const repair = finalization.ciPortabilityRepair as Record<string, unknown>;
      repair.changedPaths = (repair.changedPaths as unknown[]).slice(1);
    });
    await expectInvalid((candidate) => {
      const finalization = candidate.terminalFinalization as Record<string, unknown>;
      const repair = finalization.ciPortabilityRepair as Record<string, unknown>;
      const predecessor = repair.predecessorBinding as Record<string, unknown>;
      predecessor.bindingHash = "0".repeat(64);
    });
    await expectInvalid((candidate) => {
      const finalization = candidate.terminalFinalization as Record<string, unknown>;
      const repair = finalization.ciPortabilityRepair as Record<string, unknown>;
      const changes = repair.treeChanges as Array<Record<string, unknown>>;
      changes[0]!.successorMode = "100755";
    });
    await expectInvalid((candidate) => {
      const finalization = candidate.terminalFinalization as Record<string, unknown>;
      const repair = finalization.ciPortabilityRepair as Record<string, unknown>;
      repair.providerCallsPerformed = 1;
    });
    await expectInvalid((candidate) => {
      candidate.firstParentChainHash = omittedP10ChainHash;
    });

    const impactProtocolCommit = "5".repeat(40);
    const impactProtocolTree = "4".repeat(40);
    const impactSuccessorCommit = "3".repeat(40);
    const impactSuccessorTree = "2".repeat(40);
    if (verified.kind !== "invocation-integrity-evidence") {
      throw new Error("test_impact_execution_transition_kind_invalid");
    }
    const impactCandidate = structuredClone(verified);
    if (!impactCandidate.terminalFinalization?.ciPortabilityRepair) {
      throw new Error("test_impact_execution_predecessor_missing");
    }
    impactCandidate.successorCommit = impactSuccessorCommit;
    impactCandidate.terminalFinalization.ciPortabilityRepair.successorCommit =
      JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_COMMIT;
    impactCandidate.terminalFinalization.ciPortabilityRepair.successorTree =
      JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_TREE;
    impactCandidate.terminalFinalization.impactExecutionFinalization = {
      version: JUDGE_DEMO_IMPACT_EXECUTION_FINALIZATION_VERSION,
      predecessorBinding: {
        activeCommit: JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_COMMIT,
        activeTree: JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_TREE,
        gate6ProofHash: JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_GATE6_PROOF_HASH,
        bindingHash: JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_BINDING_HASH,
        evidenceTransitionProofHash: JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_TRANSITION_PROOF_HASH,
        activeEnvelopeHash: JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_ENVELOPE_HASH,
        rootImmutableProjectionHash: JUDGE_DEMO_IMPACT_EXECUTION_ROOT_IMMUTABLE_PROJECTION_HASH,
        activeImmutableProjectionHash: JUDGE_DEMO_IMPACT_EXECUTION_ACTIVE_IMMUTABLE_PROJECTION_HASH,
        dependencyProjectionHash: JUDGE_DEMO_IMPACT_EXECUTION_DEPENDENCY_PROJECTION_HASH
      },
      protocol: {
        predecessorCommit: JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_COMMIT,
        predecessorTree: JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_TREE,
        successorCommit: impactProtocolCommit,
        successorTree: impactProtocolTree,
        changedPathCount: JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS.length,
        changedPathsHash: JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS_HASH,
        gitTreeProjectionHash: "1".repeat(64),
        providerCallsPerformed: 0,
        modelCallsPerformed: 0,
        scoredCallsPerformed: 0,
        calibrationCallsPerformed: 0,
        directObservationCallsPerformed: 0,
        storeWritesPerformed: 0
      },
      presentation: {
        predecessorCommit: impactProtocolCommit,
        predecessorTree: impactProtocolTree,
        successorCommit: impactSuccessorCommit,
        successorTree: impactSuccessorTree,
        changedPathCount: JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS.length,
        changedPathsHash: JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS_HASH,
        gitTreeProjectionHash: "0".repeat(64),
        frozenLabClientPath: JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH,
        frozenLabClientBlobOid: JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_BLOB_OID,
        frozenLabClientSha256: JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_SHA256,
        providerCallsPerformed: 0,
        modelCallsPerformed: 0,
        scoredCallsPerformed: 0,
        calibrationCallsPerformed: 0,
        directObservationCallsPerformed: 0,
        storeWritesPerformed: 0
      }
    };
    impactCandidate.firstParentChainHash = await canonicalSha256([
      value.predecessorCommit,
      value.protocolCommit,
      JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_COMMIT,
      value.protocolFinalizationCommit,
      JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_COMMIT,
      JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_COMMIT,
      JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_COMMIT,
      impactProtocolCommit,
      impactSuccessorCommit
    ]);
    const impactPayload = { ...impactCandidate } as Record<string, unknown>;
    delete impactPayload.proofHash;
    const impactVerified = await verifyJudgeDemoPresentationTransition({
      ...impactPayload,
      proofHash: await canonicalSha256(impactPayload)
    });
    expect(impactVerified).toMatchObject({
      successorCommit: impactSuccessorCommit,
      terminalFinalization: {
        impactExecutionFinalization: {
          protocol: { predecessorCommit: JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_COMMIT },
          presentation: { successorCommit: impactSuccessorCommit }
        }
      }
    });
    const incompleteImpact = structuredClone(impactVerified) as unknown as Record<string, unknown>;
    const incompleteTerminal = incompleteImpact.terminalFinalization as Record<string, unknown>;
    delete incompleteTerminal.ciPortabilityRepair;
    delete incompleteImpact.proofHash;
    await expect(
      verifyJudgeDemoPresentationTransition({
        ...incompleteImpact,
        proofHash: await canonicalSha256(incompleteImpact)
      })
    ).rejects.toThrow();
    const halfPresentImpact = structuredClone(impactVerified) as unknown as Record<string, unknown>;
    const halfPresentTerminal = halfPresentImpact.terminalFinalization as Record<string, unknown>;
    const halfPresentFinalization = halfPresentTerminal.impactExecutionFinalization as Record<
      string,
      unknown
    >;
    delete halfPresentFinalization.presentation;
    delete halfPresentImpact.proofHash;
    await expect(
      verifyJudgeDemoPresentationTransition({
        ...halfPresentImpact,
        proofHash: await canonicalSha256(halfPresentImpact)
      })
    ).rejects.toThrow();
    const repeatedImpact = structuredClone(impactVerified) as unknown as Record<string, unknown>;
    const repeatedTerminal = repeatedImpact.terminalFinalization as Record<string, unknown>;
    repeatedTerminal.impactExecutionFinalization = [
      repeatedTerminal.impactExecutionFinalization,
      repeatedTerminal.impactExecutionFinalization
    ];
    delete repeatedImpact.proofHash;
    await expect(
      verifyJudgeDemoPresentationTransition({
        ...repeatedImpact,
        proofHash: await canonicalSha256(repeatedImpact)
      })
    ).rejects.toThrow();
    const nonzeroImpact = structuredClone(impactVerified) as unknown as Record<string, unknown>;
    const nonzeroTerminal = nonzeroImpact.terminalFinalization as Record<string, unknown>;
    const nonzeroFinalization = nonzeroTerminal.impactExecutionFinalization as Record<
      string,
      unknown
    >;
    const nonzeroProtocol = nonzeroFinalization.protocol as Record<string, unknown>;
    nonzeroProtocol.storeWritesPerformed = 1;
    delete nonzeroImpact.proofHash;
    await expect(
      verifyJudgeDemoPresentationTransition({
        ...nonzeroImpact,
        proofHash: await canonicalSha256(nonzeroImpact)
      })
    ).rejects.toThrow();
  });

  it("verifies the exact Q-to-P-to-U Impact/Execution checkout boundary", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "thurstone-impact-execution-"));
    temporaryRoots.push(cwd);
    git(cwd, ["clone", "-q", "--no-hardlinks", resolve("."), "."]);
    git(cwd, ["checkout", "-q", JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_COMMIT]);

    for (const path of JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS) {
      await writeFile(join(cwd, path), await readFile(resolve(path)));
    }
    git(cwd, ["add", "--", ...JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS]);
    git(cwd, ["commit", "-q", "-m", "bind impact execution presentation boundary"]);
    const protocolCommit = git(cwd, ["rev-parse", "HEAD"]);
    const protocolTree = git(cwd, ["rev-parse", `${protocolCommit}^{tree}`]);

    const compressedPatch = Buffer.from(
      JUDGE_DEMO_IMPACT_EXECUTION_U_PATCH_BROTLI_BASE64URL,
      "base64url"
    );
    expect(sha256(compressedPatch)).toBe(JUDGE_DEMO_IMPACT_EXECUTION_U_PATCH_BROTLI_SHA256);
    const prospectivePatch = brotliDecompressSync(compressedPatch);
    expect(prospectivePatch).toHaveLength(JUDGE_DEMO_IMPACT_EXECUTION_U_PATCH_RAW_BYTES);
    expect(sha256(prospectivePatch)).toBe(JUDGE_DEMO_IMPACT_EXECUTION_U_PATCH_SHA256);
    const patchApply = spawnSync("git", ["apply", "--binary", "-"], {
      cwd,
      input: prospectivePatch,
      encoding: null,
      maxBuffer: 4_194_304
    });
    expect(
      {
        status: patchApply.status,
        stderr: Buffer.isBuffer(patchApply.stderr) ? patchApply.stderr.toString("utf8") : ""
      },
      "exact prospective U patch"
    ).toEqual({ status: 0, stderr: "" });

    for (const path of JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS) {
      const source = await readFile(join(cwd, path), "utf8");
      const exactIdentity = JUDGE_DEMO_IMPACT_EXECUTION_FINAL_U_FILE_IDENTITIES.find(
        ({ path: candidate }) => candidate === path
      );
      let successorSource: string;
      if (
        exactIdentity !== undefined &&
        Buffer.byteLength(source, "utf8") === exactIdentity.length &&
        sha256(source) === exactIdentity.sha256
      ) {
        successorSource = source;
      } else if (path === "components/lab/judge-demo-panel.tsx") {
        successorSource = source
          .replace(
            JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_REACT_IMPORT_Q,
            `${JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_REACT_IMPORT_U}${JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_PORTAL_IMPORT}`
          )
          .replace(
            JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_MOUNT_ANCHOR,
            JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_MOUNT_SNIPPET
          );
        const returnIndex = successorSource.lastIndexOf(
          JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_RETURN_START_Q
        );
        if (returnIndex < 0) throw new Error("test_judge_return_missing");
        successorSource = `${successorSource.slice(0, returnIndex)}${JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_RETURN_START_U}${successorSource.slice(returnIndex + JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_RETURN_START_Q.length)}`;
        if (!successorSource.endsWith(JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_RETURN_END_Q)) {
          throw new Error("test_judge_return_end_missing");
        }
        successorSource = `${successorSource.slice(0, -JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_RETURN_END_Q.length)}${JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_RETURN_END_U}`;
        successorSource = applyImpactExecutionJudgeDiagnosticsPresentation(successorSource);
      } else if (path === "components/invocation-integrity/invocation-integrity-client.tsx") {
        successorSource = source
          .replace(
            JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_STATUS_Q,
            JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_STATUS_U
          )
          .replace(
            JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_BANNER_Q,
            JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_BANNER_U
          );
      } else if (path === "components/results/invocation-integrity-results.tsx") {
        successorSource = source.replace(
          JUDGE_DEMO_IMPACT_EXECUTION_INVOCATION_HEADING_Q,
          JUDGE_DEMO_IMPACT_EXECUTION_INVOCATION_HEADING_U
        );
      } else if (path === "components/results/semantic-paired-results.tsx") {
        successorSource = source
          .replace(
            JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_IMPORT_Q,
            JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_IMPORT_U
          )
          .replace(
            "export function SemanticPairedResults(",
            `${JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_TEMPLATE}export function SemanticPairedResults(`
          );
      } else if (path === "lib/results/meta-tools.ts") {
        successorSource = source.replace(
          "export function createPairedResultsMetaTool(",
          `${JUDGE_DEMO_IMPACT_EXECUTION_LAZY_HELPER_TEMPLATE}export function createPairedResultsMetaTool(`
        );
      } else if (path === "app/results/page.tsx") {
        successorSource = source
          .replace(
            'import { SemanticPairedResults } from "@/components/results/semantic-paired-results";',
            JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_COMPONENT_IMPORT_U
          )
          .replace(
            'import type { Metadata } from "next";',
            `import type { Metadata } from "next";\n${JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_SEMANTIC_ARTIFACT_IMPORT}\n${JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_INVOCATION_ARTIFACT_IMPORT}`
          )
          .replace(
            "export default async function ResultsPage() {",
            `${JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_SUMMARY_TEMPLATE}${JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_FUNCTION_U}`
          )
          .replace(
            "  const terminalEvidence = cookieStore.has(PROBE_RESULTS_COOKIE);",
            `  const terminalEvidence = cookieStore.has(PROBE_RESULTS_COOKIE);\n${JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_COMPACT_BLOCK_TEMPLATE}`
          );
      } else if (path === "app/lab/page.tsx") {
        successorSource = source.replace(
          JUDGE_DEMO_IMPACT_EXECUTION_LAB_RETURN_Q,
          JUDGE_DEMO_IMPACT_EXECUTION_LAB_RETURN_U
        );
      } else if (path === "app/studio/page.tsx") {
        successorSource = source.replace(
          JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_RETURN_Q,
          JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_RETURN_U
        );
      } else if (path === "app/invocation-integrity/page.tsx") {
        successorSource = source.replace(
          JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_RETURN_Q,
          JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_RETURN_U
        );
      } else if (
        JUDGE_DEMO_IMPACT_EXECUTION_Q_TEST_FILE_IDENTITIES.some(
          ({ path: candidate }) => candidate === path
        )
      ) {
        successorSource = source;
        for (const replacement of JUDGE_DEMO_IMPACT_EXECUTION_TEST_REPLACEMENTS) {
          if (replacement.path !== path) continue;
          expect(successorSource.split(replacement.predecessor), replacement.label).toHaveLength(
            replacement.expectedOccurrenceCount + 1
          );
          successorSource = successorSource
            .split(replacement.predecessor)
            .join(replacement.successor);
          expect(successorSource.split(replacement.successor), replacement.label).toHaveLength(
            replacement.expectedOccurrenceCount + 1
          );
        }
        if (path === "tests/browser/lab-sandbox.spec.ts") {
          expect(
            successorSource.split(JUDGE_DEMO_IMPACT_EXECUTION_LAB_RECEIPT_SELECTOR_U)
          ).toHaveLength(JUDGE_DEMO_IMPACT_EXECUTION_LAB_RECEIPT_SELECTOR_COUNT + 1);
        }
        if (
          path === "tests/browser/results.spec.ts" ||
          path === "tests/browser/invocation-integrity-results.spec.ts"
        ) {
          successorSource = successorSource.replace(
            'page.goto("/results")',
            `page.goto("${JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_FULL_QUERY}")`
          );
        }
        const acceptanceAssertion =
          path === "tests/unit/results-meta-tools.test.ts"
            ? 'it("preserves the Impact/Execution acceptance boundary", () => {\n  expect(true).toBe(true);\n});'
            : 'test("preserves the Impact/Execution acceptance boundary", () => {\n  expect(true).toBe(true);\n});';
        successorSource = `${successorSource}\n${JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_START}\n${acceptanceAssertion}\n${JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_END}\n`;
      } else {
        const suffix = path.endsWith(".css")
          ? "\n/* impact execution presentation fixture */\n"
          : "\n// impact execution presentation fixture\n";
        successorSource = `${source.replace(/\n*$/u, "")}\n${suffix}`;
      }
      if (
        JUDGE_DEMO_IMPACT_EXECUTION_Q_MIXED_FILE_IDENTITIES.some(
          ({ path: candidate }) => candidate === path
        ) ||
        JUDGE_DEMO_IMPACT_EXECUTION_Q_ROUTE_IDENTITIES.some(
          ({ path: candidate }) => candidate === path
        ) ||
        JUDGE_DEMO_IMPACT_EXECUTION_Q_TEST_FILE_IDENTITIES.some(
          ({ path: candidate }) => candidate === path
        )
      ) {
        expect(
          await prettierCheck(successorSource, {
            ...(await resolvePrettierConfig(resolve(path))),
            filepath: path
          }),
          path
        ).toBe(true);
      }
      if (path === "components/lab/judge-demo-panel.tsx") {
        expect(successorSource).toContain("useSyncExternalStore");
        expect(successorSource).not.toContain("setPortalTarget");
        expect(Buffer.byteLength(successorSource, "utf8")).toBe(
          JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_FULL_U_LENGTH
        );
        expect(sha256(successorSource)).toBe(JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_FULL_U_SHA256);
        expect(
          successorSource.split(JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_DIAGNOSTICS_MARKER)
        ).toHaveLength(2);
        expect(
          successorSource.split(JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_DIAGNOSTICS_SUMMARY)
        ).toHaveLength(2);
        expect(successorSource.indexOf('className="button button-primary"')).toBeLessThan(
          successorSource.indexOf('<details className="judge-diagnostics">')
        );
        expect(successorSource.indexOf("Refresh judge status")).toBeGreaterThan(
          successorSource.indexOf('<details className="judge-diagnostics">')
        );
        const [lintResult] = await new ESLint({ cwd: resolve(".") }).lintText(successorSource, {
          filePath: resolve(path)
        });
        expect(
          lintResult?.messages
            .filter(({ severity }) => severity === 2)
            .map(({ message, ruleId }) => ({ message, ruleId })),
          path
        ).toEqual([]);
      }
      if (path === "app/lab/page.tsx") {
        expect(successorSource).toContain("page&apos;s real tool catalog");
        const [lintResult] = await new ESLint({ cwd: resolve(".") }).lintText(successorSource, {
          filePath: resolve(path)
        });
        expect(
          lintResult?.messages
            .filter(({ severity }) => severity === 2)
            .map(({ message, ruleId }) => ({ message, ruleId })),
          path
        ).toEqual([]);
      }
      if (path === "app/results/page.tsx") {
        expect(successorSource).toContain("agent&apos;s measured behavior");
        const [lintResult] = await new ESLint({ cwd: resolve(".") }).lintText(successorSource, {
          filePath: resolve(path)
        });
        expect(
          lintResult?.messages
            .filter(({ severity }) => severity === 2)
            .map(({ message, ruleId }) => ({ message, ruleId })),
          path
        ).toEqual([]);
      }
      await writeFile(join(cwd, path), successorSource);
    }
    const syntheticNodeModules = join(cwd, "node_modules");
    await symlink(resolve("node_modules"), syntheticNodeModules, "dir");
    try {
      const syntheticTypecheck = spawnSync(
        resolve("node_modules/.bin/tsc"),
        ["--noEmit", "--incremental", "false", "-p", "tsconfig.typecheck.json"],
        { cwd, encoding: "utf8" }
      );
      expect(
        {
          status: syntheticTypecheck.status,
          stderr: syntheticTypecheck.stderr,
          stdout: syntheticTypecheck.stdout
        },
        "synthetic Impact/Execution U typecheck"
      ).toMatchObject({ status: 0, stderr: "", stdout: "" });
    } finally {
      await unlink(syntheticNodeModules);
    }
    git(cwd, ["add", "--", ...JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS]);
    git(cwd, ["commit", "-q", "-m", "improve impact execution presentation"]);
    const successorCommit = git(cwd, ["rev-parse", "HEAD"]);
    const successorTree = git(cwd, ["rev-parse", `${successorCommit}^{tree}`]);
    const protocolChanges = evidenceTreeChanges(
      cwd,
      JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_COMMIT,
      protocolCommit
    );
    const presentationChanges = evidenceTreeChanges(cwd, protocolCommit, successorCommit);
    const finalization: Parameters<
      typeof verifyImpactExecutionFinalizationCheckout
    >[0]["finalization"] = {
      version: JUDGE_DEMO_IMPACT_EXECUTION_FINALIZATION_VERSION,
      predecessorBinding: {
        activeCommit: JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_COMMIT,
        activeTree: JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_TREE,
        gate6ProofHash: JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_GATE6_PROOF_HASH,
        bindingHash: JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_BINDING_HASH,
        evidenceTransitionProofHash: JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_TRANSITION_PROOF_HASH,
        activeEnvelopeHash: JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_ENVELOPE_HASH,
        rootImmutableProjectionHash: JUDGE_DEMO_IMPACT_EXECUTION_ROOT_IMMUTABLE_PROJECTION_HASH,
        activeImmutableProjectionHash: JUDGE_DEMO_IMPACT_EXECUTION_ACTIVE_IMMUTABLE_PROJECTION_HASH,
        dependencyProjectionHash: JUDGE_DEMO_IMPACT_EXECUTION_DEPENDENCY_PROJECTION_HASH
      },
      protocol: {
        predecessorCommit: JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_COMMIT,
        predecessorTree: JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_TREE,
        successorCommit: protocolCommit,
        successorTree: protocolTree,
        changedPathCount: JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS.length,
        changedPathsHash: JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS_HASH,
        gitTreeProjectionHash: await canonicalSha256(protocolChanges),
        providerCallsPerformed: 0 as const,
        modelCallsPerformed: 0 as const,
        scoredCallsPerformed: 0 as const,
        calibrationCallsPerformed: 0 as const,
        directObservationCallsPerformed: 0 as const,
        storeWritesPerformed: 0 as const
      },
      presentation: {
        predecessorCommit: protocolCommit,
        predecessorTree: protocolTree,
        successorCommit,
        successorTree,
        changedPathCount: JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS.length,
        changedPathsHash: JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS_HASH,
        gitTreeProjectionHash: await canonicalSha256(presentationChanges),
        frozenLabClientPath: JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH,
        frozenLabClientBlobOid: JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_BLOB_OID,
        frozenLabClientSha256: JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_SHA256,
        providerCallsPerformed: 0 as const,
        modelCallsPerformed: 0 as const,
        scoredCallsPerformed: 0 as const,
        calibrationCallsPerformed: 0 as const,
        directObservationCallsPerformed: 0 as const,
        storeWritesPerformed: 0 as const
      }
    };
    await expect(
      verifyImpactExecutionFinalizationCheckout({ cwd, finalization })
    ).resolves.toMatchObject({
      protocolChanges: { length: JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS.length },
      presentationChanges: { length: JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS.length }
    });

    const operationalPaths = [
      ...new Set([
        ...JUDGE_DEMO_IMPACT_EXECUTION_Q_MIXED_FILE_IDENTITIES.map(({ path }) => path),
        "app/results/page.tsx",
        "app/lab/page.tsx",
        "app/studio/page.tsx",
        "app/invocation-integrity/page.tsx"
      ])
    ];
    for (const path of operationalPaths) {
      const source = await readFile(join(cwd, path), "utf8");
      let tampered: string;
      if (path === "components/lab/judge-demo-panel.tsx") {
        tampered = source.replace(
          "const JUDGE_STATUS_TIMEOUT_MS = 8_000;",
          "const JUDGE_STATUS_TIMEOUT_MS = 8_001;"
        );
      } else if (path === "components/results/semantic-paired-results.tsx") {
        tampered = source.replace(
          'useState<RegistryStatus>({ phase: "idle", toolNames: [] })',
          'useState<RegistryStatus>({ phase: "ready", toolNames: [] })'
        );
      } else if (path === "lib/results/meta-tools.ts") {
        tampered = source.replace(
          'title: "Inspect paired semantic evidence"',
          'title: "Inspect substituted semantic evidence"'
        );
      } else if (path === "app/results/page.tsx") {
        tampered = source.replace('redirect("/lab")', 'redirect("/results")');
      } else if (path === "app/lab/page.tsx") {
        tampered = source.replace('return "inactive"', 'return "active"');
      } else if (path === "app/studio/page.tsx") {
        tampered = source.replace(
          "<StudioClient target={LAST_VERIFIED_TARGET} reviewPackage={reviewPackage} />",
          ""
        );
      } else if (path === "app/invocation-integrity/page.tsx") {
        tampered = source.replace("<InvocationIntegrityClient />", "");
      } else {
        tampered = `// operational drift\n${source}`;
      }
      expect(tampered, path).not.toBe(source);
      await expect(
        verifyImpactExecutionOperationalSourceProjection({ path, source: tampered })
      ).rejects.toThrow(
        /impact_execution_(?:normalization|operational|route|source|presentation|judge|session|studio|integrity|lab|results)/u
      );
    }
    for (const { path } of JUDGE_DEMO_IMPACT_EXECUTION_Q_TEST_FILE_IDENTITIES) {
      const source = await readFile(join(cwd, path), "utf8");
      await expect(
        verifyImpactExecutionOperationalSourceProjection({
          path,
          source: `${source}\ntest.only("forbidden weakened test", () => {});\n`
        })
      ).rejects.toThrow(/impact_execution_test_(?:projection|block)_invalid/u);
    }
    for (const replacement of JUDGE_DEMO_IMPACT_EXECUTION_TEST_REPLACEMENTS) {
      const source = await readFile(join(cwd, replacement.path), "utf8");
      expect(source.split(replacement.successor), replacement.label).toHaveLength(
        replacement.expectedOccurrenceCount + 1
      );
      expect(source, replacement.label).not.toContain(replacement.predecessor);
      if (replacement.path === "tests/browser/lab-sandbox.spec.ts") {
        expect(source.split(JUDGE_DEMO_IMPACT_EXECUTION_LAB_RECEIPT_SELECTOR_U)).toHaveLength(
          JUDGE_DEMO_IMPACT_EXECUTION_LAB_RECEIPT_SELECTOR_COUNT + 1
        );
      }
      const broadenedSuccessor = replacement.successor.includes('getByRole("heading"')
        ? replacement.successor.replace(
            /page\.getByRole\("heading", \{[\s\S]*?\}\)/u,
            'page.getByRole("heading")'
          )
        : replacement.successor.includes("exact: true")
          ? replacement.successor.replace("exact: true", "exact: false")
          : replacement.successor.replace(".capability-panel ", "");
      expect(broadenedSuccessor, replacement.label).not.toBe(replacement.successor);
      const reflowedSuccessor = replacement.label.startsWith("lab-sandbox-capability-receipt-")
        ? replacement.predecessor.replace(
            'page.locator(".runtime-receipt").first()',
            JUDGE_DEMO_IMPACT_EXECUTION_LAB_RECEIPT_SELECTOR_U
          )
        : null;
      for (const tampered of [
        source.replace(replacement.successor, ""),
        source.replace(
          `\n\n${JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_START}`,
          `\n${replacement.successor}\n\n${JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_START}`
        ),
        source.replace(replacement.successor, broadenedSuccessor),
        ...(reflowedSuccessor === null
          ? []
          : [source.replace(replacement.successor, reflowedSuccessor)])
      ]) {
        await expect(
          verifyImpactExecutionOperationalSourceProjection({
            path: replacement.path,
            source: tampered
          })
        ).rejects.toThrow(
          replacement.label.startsWith("lab-sandbox-capability-receipt-")
            ? /normalization_invalid:(?:lab-receipt-selector-count|test-replacement:lab-sandbox-capability-receipt-)/u
            : new RegExp(`normalization_invalid:test-replacement:${replacement.label}`)
        );
      }
    }
    for (const [path, template] of [
      [
        "components/results/semantic-paired-results.tsx",
        JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_TEMPLATE
      ],
      ["lib/results/meta-tools.ts", JUDGE_DEMO_IMPACT_EXECUTION_LAZY_HELPER_TEMPLATE],
      ["app/results/page.tsx", JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_SUMMARY_TEMPLATE]
    ] as const) {
      const source = await readFile(join(cwd, path), "utf8");
      await expect(
        verifyImpactExecutionOperationalSourceProjection({ path, source: `${source}${template}` })
      ).rejects.toThrow();
    }
    const judgeSource = await readFile(join(cwd, "components/lab/judge-demo-panel.tsx"), "utf8");
    await expect(
      verifyImpactExecutionOperationalSourceProjection({
        path: "components/lab/judge-demo-panel.tsx",
        source: judgeSource.replace(JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_PORTAL_IMPORT, "")
      })
    ).rejects.toThrow(/operational_projection_invalid/u);
    for (const tampered of [
      judgeSource.replace(JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_REACT_IMPORT_U, ""),
      judgeSource.replace(
        JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_REACT_IMPORT_U,
        `${JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_REACT_IMPORT_U}${JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_REACT_IMPORT_U}`
      ),
      judgeSource.replace("useSyncExternalStore(", "useState("),
      judgeSource.replace(JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_DIAGNOSTICS_MARKER, ""),
      judgeSource.replace(JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_DIAGNOSTICS_SUMMARY, "Diagnostics"),
      judgeSource.replace('<details className="judge-diagnostics">', ""),
      judgeSource.replace("judge-status-summary", "judge-status-hidden"),
      judgeSource.replace("Refresh judge status", "Refresh hidden status")
    ]) {
      await expect(
        verifyImpactExecutionOperationalSourceProjection({
          path: "components/lab/judge-demo-panel.tsx",
          source: tampered
        })
      ).rejects.toThrow(/operational_projection_invalid/u);
    }
    const resultsTestSource = await readFile(join(cwd, "tests/browser/results.spec.ts"), "utf8");
    await expect(
      verifyImpactExecutionOperationalSourceProjection({
        path: "tests/browser/results.spec.ts",
        source: resultsTestSource.replace(
          JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_FULL_QUERY,
          "/results?view=other"
        )
      })
    ).rejects.toThrow(/normalization_invalid:results-query/u);
    await expect(
      verifyImpactExecutionOperationalSourceProjection({
        path: "tests/browser/results.spec.ts",
        source: `${resultsTestSource}\n${JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_START}\n// duplicate\n${JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_END}`
      })
    ).rejects.toThrow(/test_marker_invalid/u);
    for (const tampered of [
      resultsTestSource.replace(
        `\n\n${JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_START}`,
        `\n${JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_START}`
      ),
      resultsTestSource.replace(
        `\n\n${JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_START}`,
        `\n\n\n${JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_START}`
      )
    ]) {
      await expect(
        verifyImpactExecutionOperationalSourceProjection({
          path: "tests/browser/results.spec.ts",
          source: tampered
        })
      ).rejects.toThrow(/test_marker_invalid/u);
    }
    const blockStart = resultsTestSource.indexOf(JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_START);
    const blockEnd =
      resultsTestSource.indexOf(JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_END) +
      JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_END.length;
    const acceptanceBlock = resultsTestSource.slice(blockStart, blockEnd);
    const withoutBlock = `${resultsTestSource.slice(0, blockStart)}${resultsTestSource.slice(blockEnd)}`;
    await expect(
      verifyImpactExecutionOperationalSourceProjection({
        path: "tests/browser/results.spec.ts",
        source: `${acceptanceBlock}\n${withoutBlock}`
      })
    ).rejects.toThrow();
    await expect(
      verifyImpactExecutionOperationalSourceProjection({
        path: "tests/browser/results.spec.ts",
        source: `${resultsTestSource.slice(0, blockStart)}${JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_START}\ntest.beforeEach(async () => {});\n${JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_END}${resultsTestSource.slice(blockEnd)}`
      })
    ).rejects.toThrow(/test_block_invalid/u);
    await expect(
      verifyImpactExecutionOperationalSourceProjection({
        path: "tests/browser/results.spec.ts",
        source: `${resultsTestSource.slice(0, blockStart)}${JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_START}\n// comment-only acceptance block\n${JUDGE_DEMO_IMPACT_EXECUTION_TEST_BLOCK_END}${resultsTestSource.slice(blockEnd)}`
      })
    ).rejects.toThrow(/test_block_invalid/u);
    await expect(
      verifyImpactExecutionOperationalSourceProjection({
        path: "tests/browser/results.spec.ts",
        source: resultsTestSource.replace(
          'await expect(page.getByRole("heading", { name: "Baseline versus revised" })).toBeVisible();',
          'await expect(page.getByRole("heading", { name: "Baseline versus revised" })).toBeHidden();'
        )
      })
    ).rejects.toThrow(/test_projection_invalid/u);
    const resultsPageSource = await readFile(join(cwd, "app/results/page.tsx"), "utf8");
    const resultsProductTokens = [
      "The human question",
      "Did the clearer checkout description improve the agent&apos;s measured behavior?",
      "Thurstone is a pre-release test: did the agent choose the action and page effect a",
      "WebMCP lets the agent discover and invoke tools registered by this",
      "Meaning Matrix all-or-nothing case passes",
      "A case passes only when its",
      "complete approved decision, arguments, and effect pass.",
      "Residual:",
      "with state changed:",
      "The description looked better, but it did not fix the measured behavior. Thurstone caught that before anyone claimed success.",
      "impactExecutionSummary.semantic.summary.baselinePassed",
      "impactExecutionSummary.semantic.summary.revisedPassed",
      'record.relationship.id === "pair_commitment_holdout"',
      'record.version === "baseline"',
      "baselineTentative.observedAction",
      "impactExecutionSummary.semantic.boundary.tentative.request",
      "impactExecutionSummary.semantic.boundary.tentative.expectedAction",
      "impactExecutionSummary.semantic.boundary.tentative.observedAction",
      "impactExecutionSummary.semantic.boundary.tentative.stateBefore.revision",
      "impactExecutionSummary.semantic.boundary.tentative.stateAfter.revision",
      "impactExecutionSummary.semantic.boundary.tentative.effect.stateChanged",
      "impactExecutionSummary.semantic.boundary.tentative.descriptionComparison.baseline",
      "Same case across the description change:",
      "impactExecutionSummary.semantic.boundary.explicit.request",
      "impactExecutionSummary.semantic.boundary.explicit.expectedAction",
      "impactExecutionSummary.semantic.boundary.explicit.observedAction",
      "impactExecutionSummary.semantic.boundary.explicit.canonicalArguments",
      "impactExecutionSummary.semantic.boundary.explicit.lifecycle",
      "impactExecutionSummary.semantic.boundary.explicit.traceEventId",
      "impactExecutionSummary.semantic.boundary.explicit.stateBefore.revision",
      "impactExecutionSummary.semantic.boundary.explicit.stateAfter.revision",
      "impactExecutionSummary.semantic.boundary.explicit.effect.stateChanged",
      "impactExecutionSummary.semantic.boundary.explicit.liveCatalog.toolNames.join",
      "Inspect exact canonical arguments",
      "Inspect trace, manifest, and argument mode",
      'className="evidence-identity"',
      "Human controls and native Site Tools execute against the same serialized checkout store.",
      "Thurstone independently verifies tool choice, canonical arguments, handler lifecycle,",
      "impactExecutionSummary.semantic.metrics.revised.map",
      "Product, QA, safety, and release teams use Thurstone before releasing or changing a",
      "Untested applications:",
      "account support, travel booking, content",
      "Restrained roadmap:",
      "bring-your-own human-approved contracts, CI gating,",
      "impactExecutionSummary.integrity.score.earned",
      "impactExecutionSummary.integrity.score.possible",
      "impactExecutionSummary.integrity.modelCallCount",
      "impactExecutionSummary.integrity.includedInSemanticDenominator",
      "impactExecutionSummary.integrity.limitations.map",
      'href="/results?view=full"'
    ] as const;
    for (const token of resultsProductTokens) {
      expect(resultsPageSource, token).toContain(token);
    }
    const firstFoldOrder = [
      "Did the clearer checkout description improve the agent&apos;s measured behavior?",
      "Meaning Matrix all-or-nothing case passes",
      "The description looked better, but it did not fix the measured behavior.",
      "<strong>Residual:</strong>",
      "Thurstone is a pre-release test:",
      "complete approved decision, arguments, and effect pass."
    ].map((token) => resultsPageSource.indexOf(token));
    expect(firstFoldOrder.every((index) => index >= 0)).toBe(true);
    expect(firstFoldOrder).toEqual([...firstFoldOrder].sort((left, right) => left - right));
    expect(resultsPageSource.split(JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_RENDER)).toHaveLength(
      2
    );
    for (const tampered of [
      ...resultsProductTokens.map((token) => resultsPageSource.replace(token, "")),
      resultsPageSource.replace("agent&apos;s measured behavior", "agent's measured behavior"),
      resultsPageSource.replace(JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_RENDER, ""),
      resultsPageSource.replace(
        JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_RENDER,
        `${JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_RENDER}\n${JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_RENDER}`
      ),
      resultsPageSource.replace(
        "fb272a4a68d9c1d3d4542a668b86b23f293cd55e714c1b826af32c7fcac0be26",
        "0".repeat(64)
      ),
      resultsPageSource.replace(
        "{impactExecutionSummary.semantic.summary.disclosure}",
        '"23/24 → 23/24; no measured improvement"'
      ),
      resultsPageSource.replace(
        "{impactExecutionSummary.semantic.summary.disclosure}",
        "{impactExecutionSummary.semantic.summary.disclosure}{/* readSemanticResults */}"
      ),
      resultsPageSource.replace(
        '  const fullEvidenceView = (await searchParams)?.view === "full" || calibrationEvidenceAvailable;',
        ""
      ),
      `${resultsPageSource}\nimport { SemanticPairedResults as OtherSemanticResults } from "@/components/results/semantic-paired-results";\n`,
      `${resultsPageSource}\nconst OtherBridge = PairedResultsToolBridge;\n`,
      resultsPageSource
        .replace(JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_RENDER, "{compactBridge}")
        .replace(
          `${JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_SUMMARY_CALL}\n    return (`,
          `${JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_SUMMARY_CALL}\n    const compactBridge = (${JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_RENDER});\n    return (`
        ),
      `${resultsPageSource}\nconst OtherSemanticResults = SemanticPairedResults;\n`,
      `${resultsPageSource}\nconst OtherIntegrityResults = InvocationIntegrityResults;\n`,
      `${resultsPageSource}\nconst hiddenResults = React.createElement(SemanticPairedResults);\n`,
      resultsPageSource.replace(
        JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_RENDER,
        `${JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_RENDER}\n<\n  PairedResultsToolBridge\n/>`
      )
    ]) {
      await expect(
        verifyImpactExecutionOperationalSourceProjection({
          path: "app/results/page.tsx",
          source: tampered
        })
      ).rejects.toThrow(
        /impact_execution_(?:normalization_invalid|route_projection_invalid|results_(?:composition|summary)_invalid)/u
      );
    }
    const labPageSource = await readFile(join(cwd, "app/lab/page.tsx"), "utf8");
    const webMcpSetupTokens = [
      "official ChatGPT in-app browser",
      "Chrome 149+",
      "chrome://flags/#enable-webmcp-testing",
      "choose Enabled, and relaunch Chrome.",
      "consumer-mismatch",
      "close other same-origin Thurstone",
      "tabs, then reload this tab.",
      'href="/results"',
      "WebMCP unavailable? Inspect sealed Results"
    ] as const;
    for (const token of webMcpSetupTokens) {
      expect(labPageSource, `lab:${token}`).toContain(token);
    }
    expect(labPageSource).toContain("page&apos;s real tool catalog");
    for (const tampered of [
      ...webMcpSetupTokens.map((token) => labPageSource.replace(token, "")),
      labPageSource.replace("page&apos;s real tool catalog", "page's real tool catalog"),
      labPageSource.replace(
        '      <div id="impact-execution-judge-action" aria-label="Primary live WebMCP judge action" />\n',
        ""
      ),
      labPageSource.replace(
        "      <LabClient />",
        '      <LabClient />\n      <div id="impact-execution-judge-action" aria-label="Primary live WebMCP judge action" />'
      ),
      `${labPageSource}\nimport { LabClient as OtherLabClient } from "@/components/lab/lab-client";\n`,
      `${labPageSource}\nconst OtherLabClient = LabClient;\n`,
      labPageSource.replace(
        JUDGE_DEMO_IMPACT_EXECUTION_LAB_RETURN_U,
        `  const labClientElement = <LabClient />;\n${JUDGE_DEMO_IMPACT_EXECUTION_LAB_RETURN_U.replace(
          "      <LabClient />",
          "      {labClientElement}"
        )}`
      ),
      `${labPageSource}\nconst hiddenLabClient = React.createElement(LabClient);\n`,
      labPageSource.replace(
        "      <LabClient />",
        "      <LabClient />\n      <\n        LabClient\n      />"
      )
    ]) {
      await expect(
        verifyImpactExecutionOperationalSourceProjection({
          path: "app/lab/page.tsx",
          source: tampered
        })
      ).rejects.toThrow(
        /impact_execution_(?:normalization_invalid|route_projection_invalid|lab_composition_invalid)/u
      );
    }
    const studioPageSource = await readFile(join(cwd, "app/studio/page.tsx"), "utf8");
    for (const replacement of [
      "",
      "<><StudioClient target={LAST_VERIFIED_TARGET} reviewPackage={reviewPackage} /><StudioClient target={LAST_VERIFIED_TARGET} reviewPackage={reviewPackage} /></>",
      "<><StudioClient target={LAST_VERIFIED_TARGET} reviewPackage={reviewPackage} /><\nStudioClient target={LAST_VERIFIED_TARGET} reviewPackage={reviewPackage} /></>"
    ]) {
      await expect(
        verifyImpactExecutionOperationalSourceProjection({
          path: "app/studio/page.tsx",
          source: studioPageSource.replace(
            "<StudioClient target={LAST_VERIFIED_TARGET} reviewPackage={reviewPackage} />",
            replacement
          )
        })
      ).rejects.toThrow(
        /impact_execution_(?:normalization_invalid|route_projection_invalid|studio_composition_invalid)/u
      );
    }
    await expect(
      verifyImpactExecutionOperationalSourceProjection({
        path: "app/studio/page.tsx",
        source: `${studioPageSource}\nimport { StudioClient as OtherStudioClient } from "@/components/studio/studio-client";\n`
      })
    ).rejects.toThrow(
      /impact_execution_(?:normalization_invalid|route_projection_invalid|studio_composition_invalid)/u
    );
    await expect(
      verifyImpactExecutionOperationalSourceProjection({
        path: "app/studio/page.tsx",
        source: `${studioPageSource}\nconst OtherStudioClient = StudioClient;\n`
      })
    ).rejects.toThrow(
      /impact_execution_(?:normalization_invalid|route_projection_invalid|studio_composition_invalid)/u
    );
    await expect(
      verifyImpactExecutionOperationalSourceProjection({
        path: "app/studio/page.tsx",
        source: studioPageSource.replace(
          JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_RETURN_U,
          `  const studioClientElement = (\n    <StudioClient target={LAST_VERIFIED_TARGET} reviewPackage={reviewPackage} />\n  );\n${JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_RETURN_U.replace(
            "      <StudioClient target={LAST_VERIFIED_TARGET} reviewPackage={reviewPackage} />",
            "      {studioClientElement}"
          )}`
        )
      })
    ).rejects.toThrow(
      /impact_execution_(?:normalization_invalid|route_projection_invalid|studio_composition_invalid)/u
    );
    for (const tampered of [
      studioPageSource.replace(JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_PRESENTATION_MARKER, ""),
      `${JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_PRESENTATION_MARKER}${studioPageSource.replace(
        JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_PRESENTATION_MARKER,
        ""
      )}`,
      studioPageSource.replace(
        "configuredGate3ReviewPackage(),",
        'configuredGate3ReviewPackage().then(() => ({ status: "missing" } as never)),'
      )
    ]) {
      await expect(
        verifyImpactExecutionOperationalSourceProjection({
          path: "app/studio/page.tsx",
          source: tampered
        })
      ).rejects.toThrow(
        /impact_execution_(?:normalization_invalid|route_projection_invalid|studio_composition_invalid)/u
      );
    }
    const integrityPageSource = await readFile(
      join(cwd, "app/invocation-integrity/page.tsx"),
      "utf8"
    );
    for (const token of webMcpSetupTokens) {
      expect(integrityPageSource, `integrity:${token}`).toContain(token);
    }
    const integrityScopeTokens = [
      "three frozen synthetic checkout cases on the exact tested build",
      "testing/audit system—not runtime enforcement, certification, guaranteed security, or",
      "arbitrary-site verification"
    ] as const;
    for (const token of integrityScopeTokens) {
      expect(integrityPageSource, `integrity-scope:${token}`).toContain(token);
    }
    for (const tampered of [...webMcpSetupTokens, ...integrityScopeTokens].map((token) =>
      integrityPageSource.replace(token, "")
    )) {
      await expect(
        verifyImpactExecutionOperationalSourceProjection({
          path: "app/invocation-integrity/page.tsx",
          source: tampered
        })
      ).rejects.toThrow(
        /impact_execution_(?:normalization_invalid|route_projection_invalid|integrity_composition_invalid)/u
      );
    }
    for (const replacement of [
      "",
      "<><InvocationIntegrityClient /><InvocationIntegrityClient /></>",
      "<><InvocationIntegrityClient /><\nInvocationIntegrityClient /></>"
    ]) {
      await expect(
        verifyImpactExecutionOperationalSourceProjection({
          path: "app/invocation-integrity/page.tsx",
          source: integrityPageSource.replace("<InvocationIntegrityClient />", replacement)
        })
      ).rejects.toThrow(
        /impact_execution_(?:normalization_invalid|route_projection_invalid|integrity_composition_invalid)/u
      );
    }
    await expect(
      verifyImpactExecutionOperationalSourceProjection({
        path: "app/invocation-integrity/page.tsx",
        source: `${integrityPageSource}\nimport { InvocationIntegrityClient as OtherIntegrityClient } from "@/components/invocation-integrity/invocation-integrity-client";\n`
      })
    ).rejects.toThrow(
      /impact_execution_(?:normalization_invalid|route_projection_invalid|integrity_composition_invalid)/u
    );
    await expect(
      verifyImpactExecutionOperationalSourceProjection({
        path: "app/invocation-integrity/page.tsx",
        source: `${integrityPageSource}\nconst OtherIntegrityClient = InvocationIntegrityClient;\n`
      })
    ).rejects.toThrow(
      /impact_execution_(?:normalization_invalid|route_projection_invalid|integrity_composition_invalid)/u
    );
    await expect(
      verifyImpactExecutionOperationalSourceProjection({
        path: "app/invocation-integrity/page.tsx",
        source: integrityPageSource.replace(
          JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_RETURN_U,
          `  const integrityClientElement = <InvocationIntegrityClient />;\n${JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_RETURN_U.replace(
            "      <InvocationIntegrityClient />",
            "      {integrityClientElement}"
          )}`
        )
      })
    ).rejects.toThrow(
      /impact_execution_(?:normalization_invalid|route_projection_invalid|integrity_composition_invalid)/u
    );
    await expect(
      verifyImpactExecutionFinalizationCheckout({
        cwd,
        finalization: {
          ...finalization,
          presentation: { ...finalization.presentation, successorTree: "0".repeat(40) }
        }
      })
    ).rejects.toThrow(/impact_execution_chain_invalid/u);
    await expect(
      verifyImpactExecutionFinalizationCheckout({
        cwd,
        finalization: {
          ...finalization,
          presentation: {
            ...finalization.presentation,
            gitTreeProjectionHash: "0".repeat(64)
          }
        }
      })
    ).rejects.toThrow(/impact_execution_projection_invalid/u);
    await expect(
      verifyImpactExecutionFinalizationCheckout({
        cwd,
        finalization: {
          ...finalization,
          presentation: {
            ...finalization.presentation,
            predecessorCommit: JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_COMMIT,
            predecessorTree: JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_TREE
          }
        }
      })
    ).rejects.toThrow(/impact_execution_chain_invalid/u);

    const activeDriftPaths = [
      "app/page.tsx",
      "lib/judge/collateral-proof.ts",
      JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH
    ] as const;
    for (const path of activeDriftPaths) {
      const original = await readFile(join(cwd, path));
      await writeFile(join(cwd, path), Buffer.concat([original, Buffer.from("\nactive drift\n")]));
      await expect(
        verifyImpactExecutionFinalizationCheckout({ cwd, finalization })
      ).rejects.toThrow(/(?:active_checkout_mismatch|protocol_checkout_drift)/u);
      await writeFile(join(cwd, path), original);
    }
    const modePath = "app/page.tsx";
    await chmod(join(cwd, modePath), 0o755);
    await expect(verifyImpactExecutionFinalizationCheckout({ cwd, finalization })).rejects.toThrow(
      /active_checkout_mismatch/u
    );
    await chmod(join(cwd, modePath), 0o644);

    git(cwd, ["checkout", "-q", protocolCommit]);
    const missingPresentationPaths = JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS.slice(1);
    for (const path of missingPresentationPaths) {
      const bytes = gitFile(cwd, successorCommit, path);
      if (bytes === null) throw new Error(`test_missing_u_source:${path}`);
      await writeFile(join(cwd, path), bytes);
    }
    git(cwd, ["add", "--", ...missingPresentationPaths]);
    git(cwd, ["commit", "-q", "-m", "invalid missing U path"]);
    const missingUCommit = git(cwd, ["rev-parse", "HEAD"]);
    await expect(
      verifyImpactExecutionFinalizationCheckout({
        cwd,
        finalization: {
          ...finalization,
          presentation: {
            ...finalization.presentation,
            successorCommit: missingUCommit,
            successorTree: git(cwd, ["rev-parse", `${missingUCommit}^{tree}`]),
            gitTreeProjectionHash: await canonicalSha256(
              evidenceTreeChanges(cwd, protocolCommit, missingUCommit)
            )
          }
        }
      })
    ).rejects.toThrow(/impact_execution_projection_invalid/u);

    git(cwd, ["checkout", "-q", protocolCommit]);
    for (const path of JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS) {
      const bytes = gitFile(cwd, successorCommit, path);
      if (bytes === null) throw new Error(`test_mode_u_source:${path}`);
      await writeFile(join(cwd, path), bytes);
    }
    await chmod(join(cwd, "app/page.tsx"), 0o755);
    git(cwd, ["add", "--", ...JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS]);
    git(cwd, ["commit", "-q", "-m", "invalid executable U path"]);
    const executableUCommit = git(cwd, ["rev-parse", "HEAD"]);
    await expect(
      verifyImpactExecutionFinalizationCheckout({
        cwd,
        finalization: {
          ...finalization,
          presentation: {
            ...finalization.presentation,
            successorCommit: executableUCommit,
            successorTree: git(cwd, ["rev-parse", `${executableUCommit}^{tree}`]),
            gitTreeProjectionHash: await canonicalSha256(
              evidenceTreeChanges(cwd, protocolCommit, executableUCommit)
            )
          }
        }
      })
    ).rejects.toThrow(/impact_execution_projection_invalid/u);

    const mergeUCommit = git(cwd, [
      "commit-tree",
      successorTree,
      "-p",
      protocolCommit,
      "-p",
      JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_COMMIT,
      "-m",
      "invalid merge U"
    ]);
    git(cwd, ["checkout", "-q", mergeUCommit]);
    await expect(
      verifyImpactExecutionFinalizationCheckout({
        cwd,
        finalization: {
          ...finalization,
          presentation: {
            ...finalization.presentation,
            successorCommit: mergeUCommit,
            successorTree
          }
        }
      })
    ).rejects.toThrow(/presentation_non_linear_ancestry/u);

    git(cwd, ["checkout", "-q", JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_COMMIT]);
    const missingProtocolPaths = JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS.slice(1);
    for (const path of missingProtocolPaths) {
      const bytes = gitFile(cwd, protocolCommit, path);
      if (bytes === null) throw new Error(`test_missing_p_source:${path}`);
      await writeFile(join(cwd, path), bytes);
    }
    git(cwd, ["add", "--", ...missingProtocolPaths]);
    git(cwd, ["commit", "-q", "-m", "invalid missing P path"]);
    const missingPCommit = git(cwd, ["rev-parse", "HEAD"]);
    for (const path of JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS) {
      const bytes = gitFile(cwd, successorCommit, path);
      if (bytes === null) throw new Error(`test_missing_p_u_source:${path}`);
      await writeFile(join(cwd, path), bytes);
    }
    git(cwd, ["add", "--", ...JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS]);
    git(cwd, ["commit", "-q", "-m", "invalid U after missing P path"]);
    const missingPUCommit = git(cwd, ["rev-parse", "HEAD"]);
    const missingPTree = git(cwd, ["rev-parse", `${missingPCommit}^{tree}`]);
    await expect(
      verifyImpactExecutionFinalizationCheckout({
        cwd,
        finalization: {
          ...finalization,
          protocol: {
            ...finalization.protocol,
            successorCommit: missingPCommit,
            successorTree: missingPTree,
            gitTreeProjectionHash: await canonicalSha256(
              evidenceTreeChanges(
                cwd,
                JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_COMMIT,
                missingPCommit
              )
            )
          },
          presentation: {
            ...finalization.presentation,
            predecessorCommit: missingPCommit,
            predecessorTree: missingPTree,
            successorCommit: missingPUCommit,
            successorTree: git(cwd, ["rev-parse", `${missingPUCommit}^{tree}`]),
            gitTreeProjectionHash: await canonicalSha256(
              evidenceTreeChanges(cwd, missingPCommit, missingPUCommit)
            )
          }
        }
      })
    ).rejects.toThrow(/impact_execution_projection_invalid/u);

    git(cwd, ["checkout", "-q", successorCommit]);

    const releaseValues = {
      demo_video: "https://youtu.be/ABCDEFGHIJK",
      public_repository: JUDGE_DEMO_GATE9_PUBLIC_REPOSITORY_URL,
      release: JUDGE_DEMO_GATE9_RELEASE_URL
    } as const;
    const releaseChanges: JudgeDemoCollateralTransition["collateralChanges"] = [
      "README.md",
      "submission/devpost.md"
    ].flatMap((path) =>
      (["demo_video", "public_repository", "release"] as const).map((field) => ({
        path: path as "README.md" | "submission/devpost.md",
        field,
        predecessorValue: JUDGE_DEMO_GATE9_COLLATERAL_PREDECESSOR_VALUE,
        successorValue: releaseValues[field]
      }))
    );
    for (const path of ["README.md", "submission/devpost.md"] as const) {
      let source = await readFile(join(cwd, path), "utf8");
      for (const change of releaseChanges.filter(({ path: candidate }) => candidate === path)) {
        source = source.replace(
          `${JUDGE_DEMO_COLLATERAL_FIELD_PREFIXES[change.field]}${JUDGE_DEMO_GATE9_COLLATERAL_PREDECESSOR_VALUE}`,
          `${JUDGE_DEMO_COLLATERAL_FIELD_PREFIXES[change.field]}${change.successorValue}`
        );
      }
      await writeFile(join(cwd, path), source);
    }
    git(cwd, ["add", "--", "README.md", "submission/devpost.md"]);
    git(cwd, ["commit", "-q", "-m", "add final impact execution release links"]);
    const releaseCommit = git(cwd, ["rev-parse", "HEAD"]);
    const release = await collateralTransition({
      cwd,
      rootCommit: rootEvidenceCommit,
      recoveryCommit: successorCommit,
      releaseCommit,
      collateralChanges: releaseChanges,
      ordinal: 4,
      version: JUDGE_DEMO_INVOCATION_INTEGRITY_TRANSITION_VERSION
    });
    await expect(verifyJudgeDemoCollateralCheckout({ cwd, proof: release })).resolves.toMatchObject(
      {
        changedPathCount: 2
      }
    );
    const seventhChange = [
      ...releaseChanges,
      {
        path: "README.md" as const,
        field: "live_app" as const,
        predecessorValue: "https://toolproof-rust.vercel.app",
        successorValue: "https://toolproof-rust.vercel.app/results"
      }
    ].sort((left, right) =>
      left.path === right.path
        ? left.field.localeCompare(right.field)
        : left.path.localeCompare(right.path)
    );
    const invalidReleasePayload: Record<string, unknown> = {
      ...release,
      collateralChanges: seventhChange,
      collateralChangesHash: await canonicalSha256(seventhChange)
    };
    delete invalidReleasePayload.proofHash;
    await expect(
      verifyJudgeDemoPresentationTransition({
        ...invalidReleasePayload,
        proofHash: await canonicalSha256(invalidReleasePayload)
      })
    ).rejects.toThrow(/judge_demo_collateral_transition_invalid/u);

    git(cwd, ["checkout", "-q", protocolCommit]);
    for (const path of JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS) {
      const source = await readFile(join(cwd, path), "utf8");
      await writeFile(join(cwd, path), `${source.replace(/\n*$/u, "")}\n// invalid fixture\n`);
    }
    await write(cwd, "README.md", "unexpected nineteenth path\n");
    git(cwd, ["add", "--", ...JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS, "README.md"]);
    git(cwd, ["commit", "-q", "-m", "invalid impact execution presentation"]);
    const invalidCommit = git(cwd, ["rev-parse", "HEAD"]);
    const invalidChanges = evidenceTreeChanges(cwd, protocolCommit, invalidCommit);
    await expect(
      verifyImpactExecutionFinalizationCheckout({
        cwd,
        finalization: {
          ...finalization,
          presentation: {
            ...finalization.presentation,
            successorCommit: invalidCommit,
            successorTree: git(cwd, ["rev-parse", `${invalidCommit}^{tree}`]),
            gitTreeProjectionHash: await canonicalSha256(invalidChanges)
          }
        }
      })
    ).rejects.toThrow(/impact_execution_projection_invalid/u);
  }, 45_000);

  it("checks the exact P10-to-Q repair through the real checkout verifier", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "toolproof-gate9-ci-portability-"));
    temporaryRoots.push(cwd);
    git(cwd, ["clone", "-q", "--no-hardlinks", resolve("."), "."]);
    git(cwd, ["checkout", "-q", JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_COMMIT]);
    for (const path of JUDGE_DEMO_GATE9_CI_PORTABILITY_REPAIR_PATHS) {
      await writeFile(join(cwd, path), await readFile(resolve(path)));
    }
    git(cwd, ["add", "--", ...JUDGE_DEMO_GATE9_CI_PORTABILITY_REPAIR_PATHS]);
    git(cwd, ["commit", "-q", "-m", "repair packed object portability"]);
    const successorCommit = git(cwd, ["rev-parse", "HEAD"]);
    const successorTree = git(cwd, ["rev-parse", `${successorCommit}^{tree}`]);
    const executionBuildCommit = "0b6f907a07c09d193e26f5e35dc5a5b3ad1b9786";
    const protocolCommit = "4122a6608c33c1464e26a10b1ad52b11892128cc";
    const protocolFinalizationCommit = "843863876a823c22557f6fcfe185125b76555587";
    const firstParentChain = [
      executionBuildCommit,
      protocolCommit,
      JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_COMMIT,
      protocolFinalizationCommit,
      JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_COMMIT,
      JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_COMMIT,
      successorCommit
    ];
    const protocolChanges = evidenceTreeChanges(cwd, executionBuildCommit, protocolCommit);
    const evidenceChanges = evidenceTreeChanges(
      cwd,
      protocolCommit,
      JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_COMMIT
    );
    const finalizationChanges = evidenceTreeChanges(
      cwd,
      JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_COMMIT,
      protocolFinalizationCommit
    );
    const preparationChanges = evidenceTreeChanges(
      cwd,
      protocolFinalizationCommit,
      JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_COMMIT
    );
    const ciChanges = evidenceTreeChanges(
      cwd,
      JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_COMMIT,
      JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_COMMIT
    );
    const repairChanges = evidenceTreeChanges(
      cwd,
      JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_COMMIT,
      successorCommit
    );
    const jsonBytes = gitFile(cwd, successorCommit, "evidence/thurstone-invocation-integrity.json");
    const markdownBytes = gitFile(
      cwd,
      successorCommit,
      "evidence/thurstone-invocation-integrity.md"
    );
    const measuredBytes = gitFile(
      cwd,
      successorCommit,
      "lib/results/invocation-integrity-measured.ts"
    );
    if (jsonBytes === null || markdownBytes === null || measuredBytes === null) {
      throw new Error("test_gate9_ci_portability_evidence_missing");
    }
    const evidenceDocument = JSON.parse(jsonBytes.toString("utf8")) as Record<string, unknown>;
    const payload = {
      version: JUDGE_DEMO_INVOCATION_INTEGRITY_TRANSITION_VERSION,
      kind: "invocation-integrity-evidence" as const,
      ordinal: 3,
      predecessorCommit: executionBuildCommit,
      successorCommit,
      predecessorEnvelopeHash: "1".repeat(64),
      successorEnvelopeHash: "2".repeat(64),
      rootEvidenceCommit,
      rootEnvelopeHash: "3".repeat(64),
      rootReceiptDigest,
      rootArtifactDigest,
      rootStoredProjectionDigest,
      rootCapturedAt,
      immutableProjectionHash: "4".repeat(64),
      firstParentChainHash: await canonicalSha256(firstParentChain),
      gitTreeProjectionHash: await canonicalSha256(
        evidenceTreeChanges(cwd, executionBuildCommit, successorCommit)
      ),
      criticalProjectionHash: "5".repeat(64),
      dependencyProjectionHash: await dependencyHashAt(cwd, executionBuildCommit),
      providerCallsPerformed: 0 as const,
      storeWritesPerformed: 0 as const,
      replayOnly: true as const,
      protocolExtension: {
        commit: protocolCommit,
        tree: git(cwd, ["rev-parse", `${protocolCommit}^{tree}`]),
        changedPaths: [...JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_PROTOCOL_PATHS],
        treeChanges: protocolChanges,
        gitTreeProjectionHash: await canonicalSha256(protocolChanges)
      },
      evidence: {
        executionBuildCommit,
        tree: JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_TREE,
        changedPaths: evidenceChanges.map(({ path }) => path),
        treeChanges: evidenceChanges,
        requiredPathsHash: await canonicalSha256(
          JUDGE_DEMO_INVOCATION_INTEGRITY_EVIDENCE_REQUIRED_PATHS
        ),
        gitTreeProjectionHash: await canonicalSha256(evidenceChanges),
        supplementalPackageDigest: String(evidenceDocument.packageDigest),
        jsonExportSha256: sha256(jsonBytes),
        markdownExportSha256: sha256(markdownBytes),
        measuredSourceSha256: sha256(measuredBytes),
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
        immutableProjectionHash: "6".repeat(64)
      },
      terminalFinalization: {
        predecessorBinding: {
          activeCommit: JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_COMMIT,
          activeTree: JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_TREE,
          bindingHash: JUDGE_DEMO_GATE9_EVIDENCE_BINDING_HASH,
          evidenceTransitionProofHash: JUDGE_DEMO_GATE9_EVIDENCE_TRANSITION_PROOF_HASH
        },
        evidenceMaterialCommit: JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_COMMIT,
        evidenceMaterialTree: JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_TREE,
        protocolFinalization: {
          version: JUDGE_DEMO_GATE9_PROTOCOL_FINALIZATION_VERSION,
          predecessorCommit: JUDGE_DEMO_GATE9_EVIDENCE_MATERIAL_COMMIT,
          successorCommit: protocolFinalizationCommit,
          successorTree: git(cwd, ["rev-parse", `${protocolFinalizationCommit}^{tree}`]),
          changedPaths: [...JUDGE_DEMO_GATE9_PROTOCOL_FINALIZATION_PATHS],
          treeChanges: finalizationChanges,
          gitTreeProjectionHash: await canonicalSha256(finalizationChanges),
          gitPackTransport: JUDGE_DEMO_GATE9_GIT_PACK_TRANSPORT,
          providerCallsPerformed: 0 as const,
          modelCallsPerformed: 0 as const,
          scoredCallsPerformed: 0 as const,
          storeWritesPerformed: 0 as const
        },
        collateralPreparation: {
          version: JUDGE_DEMO_GATE9_COLLATERAL_PREPARATION_VERSION,
          predecessorCommit: protocolFinalizationCommit,
          successorCommit: JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_COMMIT,
          successorTree: JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_TREE,
          changedPaths: [...JUDGE_DEMO_GATE9_COLLATERAL_PREPARATION_PATHS],
          treeChanges: preparationChanges,
          gitTreeProjectionHash: await canonicalSha256(preparationChanges),
          linkFieldsStatus: "reserved-for-final-link-only-release" as const,
          providerCallsPerformed: 0 as const,
          modelCallsPerformed: 0 as const,
          scoredCallsPerformed: 0 as const,
          storeWritesPerformed: 0 as const
        },
        ciFinalization: {
          version: JUDGE_DEMO_GATE9_CI_FINALIZATION_VERSION,
          predecessorBinding: {
            activeCommit: JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_COMMIT,
            activeTree: JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_TREE,
            bindingHash: JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_BINDING_HASH,
            evidenceTransitionProofHash: JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_TRANSITION_PROOF_HASH
          },
          predecessorCommit: JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_COMMIT,
          predecessorTree: JUDGE_DEMO_GATE9_COLLATERAL_CANDIDATE_TREE,
          successorCommit: JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_COMMIT,
          successorTree: JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_TREE,
          changedPaths: [...JUDGE_DEMO_GATE9_CI_FINALIZATION_PATHS],
          treeChanges: ciChanges,
          gitTreeProjectionHash: await canonicalSha256(ciChanges),
          dedupeInvariant: "unique-predecessor-blob-oids-unlinked-once" as const,
          providerCallsPerformed: 0 as const,
          modelCallsPerformed: 0 as const,
          scoredCallsPerformed: 0 as const,
          storeWritesPerformed: 0 as const
        },
        ciPortabilityRepair: {
          version: JUDGE_DEMO_GATE9_CI_PORTABILITY_REPAIR_VERSION,
          predecessorBinding: {
            activeCommit: JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_COMMIT,
            activeTree: JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_TREE,
            proofHash: JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_PROOF_HASH,
            bindingHash: JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_BINDING_HASH,
            evidenceTransitionProofHash:
              JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_TRANSITION_PROOF_HASH
          },
          predecessorCommit: JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_COMMIT,
          predecessorTree: JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_TREE,
          successorCommit,
          successorTree,
          changedPaths: [...JUDGE_DEMO_GATE9_CI_PORTABILITY_REPAIR_PATHS],
          treeChanges: repairChanges,
          gitTreeProjectionHash: await canonicalSha256(repairChanges),
          failureClass: JUDGE_DEMO_GATE9_CI_PORTABILITY_FAILURE_CLASS,
          portabilityInvariant: JUDGE_DEMO_GATE9_CI_PORTABILITY_INVARIANT,
          providerCallsPerformed: 0 as const,
          modelCallsPerformed: 0 as const,
          scoredCallsPerformed: 0 as const,
          storeWritesPerformed: 0 as const
        }
      },
      gate6PresentationProofHash: JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_PROOF_HASH,
      gate6CriticalProjectionHash: "7".repeat(64),
      modelCallsPerformed: 0 as const,
      scoredCallsPerformed: 0 as const
    };
    const unsigned = { ...payload } as Record<string, unknown>;
    const transition = await verifyJudgeDemoPresentationTransition({
      ...unsigned,
      proofHash: await canonicalSha256(unsigned)
    });
    if (transition.kind !== "invocation-integrity-evidence") {
      throw new Error("test_gate9_ci_portability_transition_kind_invalid");
    }
    await expect(
      verifyInvocationIntegrityEvidenceCheckout({ cwd, transition, firstParentChain })
    ).resolves.toBeUndefined();

    git(cwd, ["checkout", "-q", JUDGE_DEMO_GATE9_CI_FINALIZATION_CANDIDATE_COMMIT]);
    for (const path of JUDGE_DEMO_GATE9_CI_PORTABILITY_REPAIR_PATHS) {
      await writeFile(join(cwd, path), await readFile(resolve(path)));
    }
    await write(cwd, "README.md", "unexpected fourth repair path\n");
    git(cwd, ["add", "--", ...JUDGE_DEMO_GATE9_CI_PORTABILITY_REPAIR_PATHS, "README.md"]);
    git(cwd, ["commit", "-q", "-m", "invalid extra repair path"]);
    const invalidCommit = git(cwd, ["rev-parse", "HEAD"]);
    const invalid = structuredClone(transition);
    invalid.successorCommit = invalidCommit;
    invalid.terminalFinalization!.ciPortabilityRepair!.successorCommit = invalidCommit;
    invalid.terminalFinalization!.ciPortabilityRepair!.successorTree = git(cwd, [
      "rev-parse",
      `${invalidCommit}^{tree}`
    ]);
    await expect(
      verifyInvocationIntegrityEvidenceCheckout({
        cwd,
        transition: invalid,
        firstParentChain: [...firstParentChain.slice(0, -1), invalidCommit]
      })
    ).rejects.toThrow(/judge_demo_invocation_evidence_projection_invalid/u);
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

    const objectIds = git(value.cwd, ["rev-list", "--objects", "--all"])
      .split(/\r?\n/u)
      .map((line) => line.split(" ", 1)[0])
      .filter((oid): oid is string => typeof oid === "string" && oid.length === 40);
    const packed = spawnSync(
      "git",
      ["pack-objects", "--stdout", "--no-reuse-delta", "--no-reuse-object", "--compression=0"],
      {
        cwd: value.cwd,
        input: Buffer.from(`${objectIds.join("\n")}\n`),
        maxBuffer: 8_388_608
      }
    );
    expect(packed.status, String(packed.stderr)).toBe(0);
    const rawPack = Buffer.from(packed.stdout);
    const packHash = sha256(rawPack);
    const transportBinding = await bindingFor({
      rootCommit: value.rootCommit,
      activeCommit: value.recoveryCommit,
      transitions: [value.recovery],
      gitProofPackSha256: packHash
    });
    const runPackTransport = (packValue: string) =>
      spawnSync(
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
              Buffer.from(canonicalJson(transportBinding))
            ).toString("base64url"),
            [JUDGE_DEMO_PRESENTATION_BINDING_HASH_ENV]: transportBinding.bindingHash,
            [JUDGE_DEMO_SHARED_GIT_PACK_ENV]: packValue,
            [JUDGE_DEMO_GIT_PACK_ENV]: ""
          },
          encoding: "utf8",
          maxBuffer: 8_388_608
        }
      );
    const rawTransport = runPackTransport(rawPack.toString("base64url"));
    expect(rawTransport.status, rawTransport.stderr).toBe(0);
    expect(rawTransport.stdout).toContain('"gitProofPackEncoding":"raw"');
    const wrappedPack = brotliCompressSync(rawPack);
    const brotliTransport = runPackTransport(wrappedPack.toString("base64url"));
    expect(brotliTransport.status, brotliTransport.stderr).toBe(0);
    expect(brotliTransport.stdout).toContain('"gitProofPackEncoding":"brotli"');

    const wrongHashPack = Buffer.from(rawPack);
    wrongHashPack[wrongHashPack.length - 1] = wrongHashPack.at(-1)! ^ 1;
    const corruptWrapper = Buffer.from(wrappedPack);
    const corruptIndex = Math.floor(corruptWrapper.length / 2);
    corruptWrapper[corruptIndex] = corruptWrapper[corruptIndex]! ^ 1;
    for (const invalid of [
      wrongHashPack.toString("base64url"),
      corruptWrapper.toString("base64url"),
      Buffer.from("not-a-git-pack").toString("base64url"),
      "A".repeat(60_001)
    ]) {
      const rejected = runPackTransport(invalid);
      expect(rejected.status).not.toBe(0);
    }

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
    git(value.cwd, ["repack", "-a", "-d"]);
    git(value.cwd, ["prune-packed"]);
    const predecessorBlobOids = new Set(
      (["README.md", "submission/devpost.md"] as const).map((path) =>
        git(value.cwd, ["rev-parse", `${value.activeCommit}:${path}`])
      )
    );
    for (const predecessorBlobOid of predecessorBlobOids) {
      try {
        await unlink(
          join(
            value.cwd,
            ".git",
            "objects",
            predecessorBlobOid.slice(0, 2),
            predecessorBlobOid.slice(2)
          )
        );
      } catch (error) {
        // A full-history clone can serve this legacy fixture blob from a pack, with no loose
        // object to remove. The ordinal-four case below separately proves genuinely missing
        // predecessor blobs; this case remains responsible for ordered-chain/critical-byte truth.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      expect(() => git(value.cwd, ["cat-file", "-e", predecessorBlobOid])).not.toThrow();
    }
    await expect(
      verifyJudgeDemoPresentationCheckout({ cwd: value.cwd, binding })
    ).resolves.toMatchObject({ transitionCount: 2 });

    await write(value.cwd, "lib/judge/service.server.ts", "tampered active checkout\n");
    await expect(verifyJudgeDemoPresentationCheckout({ cwd: value.cwd, binding })).rejects.toThrow(
      /judge_demo_presentation_active_checkout_mismatch/u
    );
  }, 20_000);

  it("verifies the ordinal-four six-row release without predecessor document blobs", async () => {
    const value = await truthStatusFinalizationFixture();
    const placeholder = JUDGE_DEMO_GATE9_COLLATERAL_PREDECESSOR_VALUE;
    const preparedLines = [
      "Live app: https://toolproof-rust.vercel.app",
      `Public repository: ${placeholder}`,
      `Release: ${placeholder}`,
      `Demo video: ${placeholder}`
    ];
    for (const path of ["README.md", "submission/devpost.md"] as const) {
      const source = await readFile(join(value.cwd, path), "utf8");
      const retained = source
        .split("\n")
        .filter((line) => !/^(?:Live app|Public repository|Release|Demo video): /u.test(line))
        .join("\n")
        .replace(/\n*$/u, "\n");
      await write(value.cwd, path, `${retained}${preparedLines.join("\n")}\n`);
    }
    git(value.cwd, ["add", "--", "README.md", "submission/devpost.md"]);
    git(value.cwd, ["commit", "-q", "-m", "prepare final collateral links"]);
    const preparedCommit = git(value.cwd, ["rev-parse", "HEAD"]);

    const successorValues = {
      demo_video: "https://youtu.be/ABCDEFGHIJK",
      public_repository: JUDGE_DEMO_GATE9_PUBLIC_REPOSITORY_URL,
      release: JUDGE_DEMO_GATE9_RELEASE_URL
    } as const;
    const collateralChanges: JudgeDemoCollateralTransition["collateralChanges"] = [
      "README.md",
      "submission/devpost.md"
    ].flatMap((path) =>
      (["demo_video", "public_repository", "release"] as const).map((field) => ({
        path: path as "README.md" | "submission/devpost.md",
        field,
        predecessorValue: placeholder,
        successorValue: successorValues[field]
      }))
    );
    for (const path of ["README.md", "submission/devpost.md"] as const) {
      let source = await readFile(join(value.cwd, path), "utf8");
      for (const change of collateralChanges.filter(({ path: candidate }) => candidate === path)) {
        source = source.replace(
          `${JUDGE_DEMO_COLLATERAL_FIELD_PREFIXES[change.field]}${placeholder}`,
          `${JUDGE_DEMO_COLLATERAL_FIELD_PREFIXES[change.field]}${change.successorValue}`
        );
      }
      await write(value.cwd, path, source);
    }
    git(value.cwd, ["add", "--", "README.md", "submission/devpost.md"]);
    git(value.cwd, ["commit", "-q", "-m", "add final release links"]);
    const releaseCommit = git(value.cwd, ["rev-parse", "HEAD"]);
    const collateral = await collateralTransition({
      cwd: value.cwd,
      rootCommit: value.rootCommit,
      recoveryCommit: preparedCommit,
      releaseCommit,
      collateralChanges,
      ordinal: 4,
      version: JUDGE_DEMO_INVOCATION_INTEGRITY_TRANSITION_VERSION
    });
    const predecessorBlobOids = new Set(
      (["README.md", "submission/devpost.md"] as const).map((path) =>
        git(value.cwd, ["rev-parse", `${preparedCommit}:${path}`])
      )
    );
    for (const predecessorBlobOid of predecessorBlobOids) {
      await unlink(
        join(
          value.cwd,
          ".git",
          "objects",
          predecessorBlobOid.slice(0, 2),
          predecessorBlobOid.slice(2)
        )
      );
      expect(() => git(value.cwd, ["cat-file", "-e", predecessorBlobOid])).toThrow();
    }
    await expect(
      verifyJudgeDemoCollateralCheckout({ cwd: value.cwd, proof: collateral })
    ).resolves.toMatchObject({ changedPathCount: 2 });

    const expectInvalidGate9Changes = async (
      changes: JudgeDemoCollateralTransition["collateralChanges"]
    ) => {
      const ordered = [...changes].sort((left, right) =>
        left.path === right.path
          ? left.field.localeCompare(right.field)
          : left.path.localeCompare(right.path)
      );
      const payload: Record<string, unknown> = {
        ...collateral,
        collateralChanges: ordered,
        collateralChangesHash: await canonicalSha256(ordered)
      };
      delete payload.proofHash;
      await expect(
        verifyJudgeDemoPresentationTransition({
          ...payload,
          proofHash: await canonicalSha256(payload)
        })
      ).rejects.toThrow(/judge_demo_collateral_transition_invalid/u);
    };
    await expectInvalidGate9Changes(collateralChanges.slice(1));
    await expectInvalidGate9Changes([
      ...collateralChanges,
      {
        path: "README.md",
        field: "live_app",
        predecessorValue: "https://toolproof-rust.vercel.app",
        successorValue: "https://toolproof-rust.vercel.app/results"
      }
    ]);
    await expectInvalidGate9Changes(
      collateralChanges.map((change, index) =>
        index === 0 ? { ...change, predecessorValue: "wrong placeholder" } : change
      )
    );
    await expectInvalidGate9Changes(
      collateralChanges.map((change) =>
        change.field === "public_repository"
          ? { ...change, successorValue: "https://github.com/serg337/not-toolproof" }
          : change
      )
    );
    await expectInvalidGate9Changes(
      collateralChanges.map((change) =>
        change.field === "demo_video"
          ? { ...change, successorValue: "https://example.com/video" }
          : change
      )
    );
  }, 19_000);

  it("rejects collateral mode, newline, relocation, and whitespace drift", async () => {
    const predecessorValue = "reserved for the verified Gate 9 link-only release commit";
    const successorValue = "https://github.com/serg337/toolproof";
    const predecessorLine = `Public repository: ${predecessorValue}`;
    const successorLine = `Public repository: ${successorValue}`;
    for (const scenario of ["mode", "crlf", "relocation", "whitespace", "duplicate"] as const) {
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
      if (scenario === "duplicate") successor = `${successor}${successorLine}\n`;
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
  }, 45_000);

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
      createJudgeDemoEnvelope(value.rootCommit, { historicalPresentation: true }),
      createJudgeDemoEnvelope(value.rebrandCommit, { historicalPresentation: true })
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
  }, 45_000);
});
