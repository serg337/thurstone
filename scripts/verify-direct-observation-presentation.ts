import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson, canonicalSha256 } from "../lib/evidence/digest";
import {
  JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_BLOB_OID,
  JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH,
  JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PREDECESSOR_COMMIT,
  JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PREDECESSOR_TREE,
  JUDGE_DEMO_IMPACT_EXECUTION_LAB_CLIENT_U_BLOB_OID,
  JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_COMMIT,
  type JudgeDemoInvocationIntegrityEvidenceTransition,
  type JudgeDemoInvocationIntegrityTransition
} from "../lib/judge/collateral-proof";
import { verifyJudgeDemoPresentationCheckout } from "../lib/judge/collateral-checkout-verifier.server";
import { createJudgeDemoEnvelope } from "../lib/judge/envelope";
import {
  JUDGE_DEMO_INVOCATION_INTEGRITY_BINDING_VERSION,
  JUDGE_DEMO_PRESENTATION_BINDING_ENV,
  JUDGE_DEMO_PRESENTATION_MODE_ENV,
  configuredJudgeDemoPresentationBinding,
  decodeJudgeDemoPresentationBinding,
  judgeDemoPresentationBindingSchema
} from "../lib/judge/presentation-binding.server";

const observationCommit = "88deff46d4e06bb109158f7ef8a68e704f9fcc08";
const observationEvidenceSha256 =
  "63ad854753f59440b11d00d327e6ce135cf5cb84c38d7b6906f2e6719e48bf41";
const byoaReleasePredecessorCommit = "b6d5de1928fbb17cc0f9f44aee606c2aae7bea3d";
const byoaLedgerPath = "lib/evidence/checkout-trace-ledger.ts";
const byoaLedgerPredecessorBlobOid = "e3dfcf8d7cae3a36ec706226238dff87d7f7020e";
const byoaLedgerSuccessorBlobOid = "f52374f5f93e039f0d28dda2ce971b3dc9739c24";
const invocationIntegrityCriticalExceptions = new Set([
  "lib/domain/checkout-schemas.ts",
  "lib/domain/checkout.ts"
]);

type ImpactExecutionFinalization = NonNullable<
  NonNullable<
    JudgeDemoInvocationIntegrityEvidenceTransition["terminalFinalization"]
  >["impactExecutionFinalization"]
>;

function assertFirstParentAncestor(ancestor: string, descendant: string): void {
  let cursor = descendant;
  for (let depth = 0; depth <= 512; depth += 1) {
    if (cursor === ancestor) return;
    const parents = execFileSync("git", ["cat-file", "-p", cursor], {
      encoding: "utf8",
      maxBuffer: 1_048_576
    })
      .split(/\r?\n/u)
      .flatMap((line) => (/^parent ([a-f0-9]{40})$/u.exec(line)?.[1] ? [line.slice(7)] : []));
    if (parents.length !== 1) throw new Error("direct_observation_non_linear_ancestry");
    cursor = parents[0]!;
  }
  throw new Error("direct_observation_ancestry_depth_exceeded");
}

export interface DirectObservationCriticalBlobInput {
  readonly path: string;
  readonly checkedOutBlobOid: string;
  readonly activeCommit?: string;
  readonly observationBlobOid: string;
  readonly activeBlobOid: string;
  readonly byoaPredecessorBlobOid?: string;
  readonly invocationIntegrityTransition: JudgeDemoInvocationIntegrityTransition | null;
  readonly impactExecutionFinalization?: ImpactExecutionFinalization | null;
}

/**
 * Keeps the historical observation blob mandatory unless the fully verified v4 transition binds
 * one of the two frozen domain changes from that exact predecessor blob to the active blob.
 */
export function verifyDirectObservationCriticalBlob(
  input: DirectObservationCriticalBlobInput
):
  | "unchanged-observation-blob"
  | "verified-byoa-inherited-blob"
  | "verified-byoa-successor-blob"
  | "verified-impact-execution-transition"
  | "verified-invocation-integrity-transition" {
  if (input.checkedOutBlobOid !== input.activeBlobOid) {
    throw new Error(`direct_observation_critical_git_blob_mismatch:${input.path}`);
  }
  if (input.activeBlobOid === input.observationBlobOid) return "unchanged-observation-blob";
  if (
    input.byoaPredecessorBlobOid !== undefined &&
    input.activeBlobOid === input.byoaPredecessorBlobOid
  ) {
    return "verified-byoa-inherited-blob";
  }
  if (
    input.path === byoaLedgerPath &&
    input.byoaPredecessorBlobOid === byoaLedgerPredecessorBlobOid &&
    input.activeBlobOid === byoaLedgerSuccessorBlobOid
  ) {
    return "verified-byoa-successor-blob";
  }
  const impactExecution = input.impactExecutionFinalization;
  if (
    input.path === JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH &&
    input.observationBlobOid === JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_BLOB_OID &&
    input.activeBlobOid === JUDGE_DEMO_IMPACT_EXECUTION_LAB_CLIENT_U_BLOB_OID &&
    input.activeCommit !== undefined &&
    impactExecution?.protocol.predecessorCommit ===
      JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_COMMIT &&
    impactExecution.protocol.successorCommit === impactExecution.presentation.predecessorCommit &&
    impactExecution.protocol.successorTree === impactExecution.presentation.predecessorTree &&
    (impactExecution.originAliasCommits === undefined
      ? (impactExecution.ciTimeoutRepair?.successorCommit ??
        impactExecution.presentation.successorCommit)
      : input.activeCommit) === input.activeCommit &&
    (impactExecution.ciTimeoutRepair === undefined ||
      (impactExecution.presentation.successorCommit ===
        JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PREDECESSOR_COMMIT &&
        impactExecution.presentation.successorTree ===
          JUDGE_DEMO_IMPACT_EXECUTION_CI_TIMEOUT_PREDECESSOR_TREE)) &&
    impactExecution.presentation.successorCommit !==
      impactExecution.presentation.predecessorCommit &&
    impactExecution.presentation.frozenLabClientPath ===
      JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_PATH &&
    impactExecution.presentation.frozenLabClientBlobOid ===
      JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_BLOB_OID &&
    impactExecution.presentation.frozenLabClientSha256 ===
      JUDGE_DEMO_IMPACT_EXECUTION_FROZEN_LAB_CLIENT_SHA256
  ) {
    return "verified-impact-execution-transition";
  }
  const transition = input.invocationIntegrityTransition;
  const treeChange = transition?.implementation.treeChanges.find(({ path }) => path === input.path);
  if (
    !invocationIntegrityCriticalExceptions.has(input.path) ||
    !transition ||
    !treeChange ||
    treeChange.status !== "M" ||
    treeChange.predecessorMode !== "100644" ||
    treeChange.successorMode !== "100644" ||
    treeChange.predecessorBlobOid !== input.observationBlobOid ||
    treeChange.successorBlobOid !== input.activeBlobOid
  ) {
    throw new Error(`direct_observation_critical_git_blob_mismatch:${input.path}`);
  }
  return "verified-invocation-integrity-transition";
}

async function verifiedPresentationTransitions(activeCommit: string): Promise<{
  readonly invocationIntegrityTransition: JudgeDemoInvocationIntegrityTransition | null;
  readonly impactExecutionFinalization: ImpactExecutionFinalization | null;
}> {
  const encoded = process.env[JUDGE_DEMO_PRESENTATION_BINDING_ENV]?.trim() ?? "";
  if (!encoded) {
    return Object.freeze({
      invocationIntegrityTransition: null,
      impactExecutionFinalization: null
    });
  }
  const parsed = judgeDemoPresentationBindingSchema.parse(
    await decodeJudgeDemoPresentationBinding(encoded)
  );
  if (parsed.version !== JUDGE_DEMO_INVOCATION_INTEGRITY_BINDING_VERSION) {
    return Object.freeze({
      invocationIntegrityTransition: null,
      impactExecutionFinalization: null
    });
  }
  const [rootEnvelope, activeEnvelope] = await Promise.all([
    createJudgeDemoEnvelope(parsed.rootEvidenceCommit),
    createJudgeDemoEnvelope(parsed.activeCommit)
  ]);
  const binding = await configuredJudgeDemoPresentationBinding({
    environment: process.env,
    rootEnvelope,
    activeEnvelope,
    rootReceiptDigest: parsed.rootReceiptDigest,
    rootArtifactDigest: parsed.rootArtifactDigest,
    rootStoredProjectionDigest: parsed.rootStoredProjectionDigest,
    rootCapturedAt: parsed.rootCapturedAt
  });
  await verifyJudgeDemoPresentationCheckout({ binding, cwd: process.cwd() });
  const transition = binding.transitions.find(
    (candidate): candidate is JudgeDemoInvocationIntegrityTransition =>
      candidate.kind === "invocation-integrity"
  );
  const evidenceTransition = binding.transitions.find(
    (candidate): candidate is JudgeDemoInvocationIntegrityEvidenceTransition =>
      candidate.kind === "invocation-integrity-evidence"
  );
  const impactExecutionFinalization =
    evidenceTransition?.terminalFinalization?.impactExecutionFinalization ?? null;
  if (
    process.env[JUDGE_DEMO_PRESENTATION_MODE_ENV]?.trim() !== "successor" ||
    binding.activeCommit !== activeCommit ||
    !transition ||
    transition.semanticEvidence.sealedEvidenceBuildCommit !==
      "768af2539ca20c29928a897644ad22ba897c580d" ||
    transition.semanticEvidence.baselinePassed !== 23 ||
    transition.semanticEvidence.revisedPassed !== 23 ||
    transition.semanticEvidence.possible !== 24 ||
    transition.semanticEvidence.noMeasuredImprovement !== true ||
    transition.semanticEvidence.meaningMatrixCaseCount !== 24 ||
    transition.semanticEvidence.meaningMatrixModified !== false ||
    (await canonicalSha256(transition.semanticEvidence.artifacts)) !==
      transition.semanticEvidence.artifactsProjectionHash ||
    (await canonicalSha256(transition.implementation.treeChanges)) !==
      transition.implementation.gitTreeProjectionHash ||
    (impactExecutionFinalization !== null &&
      ((impactExecutionFinalization.originAliasCommits === undefined
        ? (impactExecutionFinalization.ciTimeoutRepair?.successorCommit ??
          impactExecutionFinalization.presentation.successorCommit)
        : activeCommit) !== activeCommit ||
        impactExecutionFinalization.protocol.predecessorCommit !==
          JUDGE_DEMO_IMPACT_EXECUTION_PREDECESSOR_COMMIT))
  ) {
    throw new Error("direct_observation_invocation_integrity_binding_invalid");
  }
  return Object.freeze({ invocationIntegrityTransition: transition, impactExecutionFinalization });
}

function gitText(arguments_: readonly string[]): string {
  return execFileSync("git", [...arguments_], { encoding: "utf8" }).trim();
}

function gitBlobOid(bytes: Buffer): string {
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}

const criticalPaths = [
  "components/lab/lab-client.tsx",
  "lib/domain/checkout-reset.ts",
  "lib/domain/checkout-schemas.ts",
  "lib/domain/checkout-session.ts",
  "lib/domain/checkout.ts",
  "lib/evidence/checkout-trace-ledger.ts",
  "lib/evidence/digest.ts",
  "lib/evidence/operation-trace.ts",
  "lib/webmcp/capabilities.ts",
  "lib/webmcp/cart-get-tool.ts",
  "lib/webmcp/cart-update-tool.ts",
  "lib/webmcp/catalog.ts",
  "lib/webmcp/checkout-cancel-tool.ts",
  "lib/webmcp/checkout-request-tool.ts",
  "lib/webmcp/checkout-tools.ts",
  "lib/webmcp/live-manifest.server.ts",
  "lib/webmcp/manifest-normalization.ts",
  "lib/webmcp/order-review-tool.ts",
  "lib/webmcp/readiness.ts",
  "lib/webmcp/registry-manager.ts",
  "lib/webmcp/runtime.ts",
  "lib/webmcp/tool-execution.ts"
] as const;

type PackageDocument = {
  readonly dependencies?: unknown;
  readonly devDependencies?: unknown;
  readonly engines?: unknown;
};

const projectDependencies = (document: PackageDocument) => ({
  dependencies: document.dependencies ?? null,
  devDependencies: document.devDependencies ?? null,
  engines: document.engines ?? null
});

async function main(): Promise<void> {
  const activeCommit =
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.TOOLPROOF_COMMIT_SHA?.trim() ||
    gitText(["rev-parse", "HEAD"]);
  if (!/^[a-f0-9]{40}$/u.test(activeCommit)) {
    throw new Error("direct_observation_active_commit_invalid");
  }
  try {
    execFileSync("git", ["cat-file", "-e", `${observationCommit}^{commit}`]);
    execFileSync("git", ["cat-file", "-e", `${activeCommit}^{commit}`]);
  } catch {
    throw new Error(
      "direct_observation_verified_git_objects_missing:run_gate6_presentation_verify_first"
    );
  }
  assertFirstParentAncestor(observationCommit, activeCommit);
  assertFirstParentAncestor(observationCommit, byoaReleasePredecessorCommit);
  assertFirstParentAncestor(byoaReleasePredecessorCommit, activeCommit);
  const { invocationIntegrityTransition, impactExecutionFinalization } =
    await verifiedPresentationTransitions(activeCommit);

  const evidenceBytes = await readFile("evidence/direct-site-tools-observations.json", "utf8");
  const evidence = JSON.parse(evidenceBytes) as {
    readonly observationBuildCommit?: unknown;
    readonly implementationBinding?: {
      readonly criticalFiles?: unknown;
      readonly criticalProjectionHash?: unknown;
      readonly dependencyProjectionHash?: unknown;
    };
  };
  if (
    createHash("sha256").update(evidenceBytes).digest("hex") !== observationEvidenceSha256 ||
    evidence.observationBuildCommit !== observationCommit
  ) {
    throw new Error("direct_observation_evidence_commit_mismatch");
  }
  const implementationBinding = evidence.implementationBinding;
  if (!implementationBinding) throw new Error("direct_observation_implementation_binding_missing");
  const declaredCriticalFiles = implementationBinding.criticalFiles;
  if (
    !Array.isArray(declaredCriticalFiles) ||
    declaredCriticalFiles.some(
      (file) =>
        typeof file !== "object" ||
        file === null ||
        typeof (file as { readonly path?: unknown }).path !== "string" ||
        typeof (file as { readonly sha256?: unknown }).sha256 !== "string"
    )
  ) {
    throw new Error("direct_observation_critical_projection_invalid");
  }
  const declaredObservationSha = new Map(
    (declaredCriticalFiles as readonly { readonly path: string; readonly sha256: string }[]).map(
      ({ path, sha256 }) => [path, sha256]
    )
  );

  const authorizedInvocationIntegrityChanges: string[] = [];
  const authorizedImpactExecutionChanges: string[] = [];
  const authorizedByoaChanges: string[] = [];
  const criticalProjections = await Promise.all(
    criticalPaths.map(async (path) => {
      const checkedOutBytes = await readFile(path);
      const checkedOutBlobOid = gitBlobOid(checkedOutBytes);
      const observationBlobOid = gitText(["rev-parse", `${observationCommit}:${path}`]);
      const byoaPredecessorBlobOid = gitText([
        "rev-parse",
        `${byoaReleasePredecessorCommit}:${path}`
      ]);
      const activeBlobOid = gitText(["rev-parse", `${activeCommit}:${path}`]);
      const disposition = verifyDirectObservationCriticalBlob({
        path,
        checkedOutBlobOid,
        activeCommit,
        observationBlobOid,
        activeBlobOid,
        byoaPredecessorBlobOid,
        invocationIntegrityTransition,
        impactExecutionFinalization
      });
      if (disposition === "verified-invocation-integrity-transition") {
        authorizedInvocationIntegrityChanges.push(path);
      } else if (disposition === "verified-impact-execution-transition") {
        authorizedImpactExecutionChanges.push(path);
      } else if (disposition === "verified-byoa-successor-blob") {
        authorizedByoaChanges.push(path);
      }
      const observationSha256 =
        observationBlobOid === activeBlobOid
          ? createHash("sha256").update(checkedOutBytes).digest("hex")
          : declaredObservationSha.get(path);
      if (!observationSha256) {
        throw new Error(`direct_observation_historical_digest_missing:${path}`);
      }
      return {
        observation: {
          path,
          sha256: observationSha256
        },
        active: {
          path,
          sha256: createHash("sha256").update(checkedOutBytes).digest("hex")
        }
      };
    })
  );
  const observationCriticalFiles = criticalProjections.map(({ observation }) => observation);
  const activeCriticalFiles = criticalProjections.map(({ active }) => active);
  const criticalProjectionHash = await canonicalSha256(observationCriticalFiles);
  const activeCriticalProjectionHash = await canonicalSha256(activeCriticalFiles);
  if (
    canonicalJson(authorizedInvocationIntegrityChanges.sort()) !== canonicalJson([]) ||
    canonicalJson(authorizedImpactExecutionChanges.sort()) !== canonicalJson([]) ||
    canonicalJson(authorizedByoaChanges.sort()) !== canonicalJson([byoaLedgerPath])
  ) {
    throw new Error("direct_observation_authorized_changes_invalid");
  }
  if (
    canonicalJson(declaredCriticalFiles) !== canonicalJson(observationCriticalFiles) ||
    implementationBinding.criticalProjectionHash !== criticalProjectionHash
  ) {
    throw new Error("direct_observation_critical_worktree_mismatch");
  }

  const currentPackageDocument = JSON.parse(
    await readFile("package.json", "utf8")
  ) as PackageDocument;
  const checkedOutPackageBytes = await readFile("package.json");
  if (
    gitBlobOid(checkedOutPackageBytes) !== gitText(["rev-parse", `${activeCommit}:package.json`])
  ) {
    throw new Error("direct_observation_active_package_blob_mismatch");
  }
  const activePackageDocument = JSON.parse(
    checkedOutPackageBytes.toString("utf8")
  ) as PackageDocument;
  const dependencyProjection = projectDependencies(currentPackageDocument);
  const activeDependencyProjection = projectDependencies(activePackageDocument);
  const dependencyProjectionHash = await canonicalSha256(dependencyProjection);
  const observationDependencyProjectionHash = implementationBinding.dependencyProjectionHash;
  const activeDependencyProjectionHash = await canonicalSha256(activeDependencyProjection);
  if (
    typeof observationDependencyProjectionHash !== "string" ||
    dependencyProjectionHash !== implementationBinding.dependencyProjectionHash ||
    observationDependencyProjectionHash !== implementationBinding.dependencyProjectionHash ||
    activeDependencyProjectionHash !== implementationBinding.dependencyProjectionHash
  ) {
    throw new Error("direct_observation_dependency_hash_mismatch");
  }
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      mode: "direct-observation-presentation",
      observationCommit,
      activeCommit,
      criticalFileCount: observationCriticalFiles.length,
      criticalProjectionHash,
      activeCriticalProjectionHash,
      dependencyProjectionHash,
      observationDependencyProjectionHash,
      activeDependencyProjectionHash,
      invocationIntegrityBindingUsed: invocationIntegrityTransition !== null,
      impactExecutionBindingUsed: impactExecutionFinalization !== null,
      byoaPredecessorCommit: byoaReleasePredecessorCommit,
      authorizedInvocationIntegrityChanges: authorizedInvocationIntegrityChanges.sort(),
      authorizedImpactExecutionChanges: authorizedImpactExecutionChanges.sort(),
      authorizedByoaChanges: authorizedByoaChanges.sort(),
      semanticArtifactsProjectionHash:
        invocationIntegrityTransition?.semanticEvidence.artifactsProjectionHash ?? null,
      evidenceRawSha256: createHash("sha256").update(evidenceBytes).digest("hex"),
      providerCallsPerformed: 0,
      storeWritesPerformed: 0
    })}\n`
  );
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPath === fileURLToPath(import.meta.url)) await main();
