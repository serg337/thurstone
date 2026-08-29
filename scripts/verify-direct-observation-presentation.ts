import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import { canonicalJson, canonicalSha256 } from "../lib/evidence/digest";

const observationCommit = "88deff46d4e06bb109158f7ef8a68e704f9fcc08";
const activeCommit =
  process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
  process.env.TOOLPROOF_COMMIT_SHA?.trim() ||
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
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
execFileSync("git", ["merge-base", "--is-ancestor", observationCommit, activeCommit]);

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
const evidenceBytes = await readFile("evidence/direct-site-tools-observations.json", "utf8");
const evidence = JSON.parse(evidenceBytes) as {
  readonly observationBuildCommit?: unknown;
  readonly implementationBinding?: {
    readonly criticalFiles?: unknown;
    readonly criticalProjectionHash?: unknown;
    readonly dependencyProjectionHash?: unknown;
  };
};
if (evidence.observationBuildCommit !== observationCommit) {
  throw new Error("direct_observation_evidence_commit_mismatch");
}
const implementationBinding = evidence.implementationBinding;
if (!implementationBinding) throw new Error("direct_observation_implementation_binding_missing");
const criticalFiles = await Promise.all(
  criticalPaths.map(async (path) => {
    const checkedOutBytes = await readFile(path);
    const checkedOutBlobOid = createHash("sha1")
      .update(`blob ${checkedOutBytes.byteLength}\0`)
      .update(checkedOutBytes)
      .digest("hex");
    const observationBlobOid = execFileSync("git", ["rev-parse", `${observationCommit}:${path}`], {
      encoding: "utf8"
    }).trim();
    const activeBlobOid = execFileSync("git", ["rev-parse", `${activeCommit}:${path}`], {
      encoding: "utf8"
    }).trim();
    if (checkedOutBlobOid !== observationBlobOid || checkedOutBlobOid !== activeBlobOid) {
      throw new Error(`direct_observation_critical_git_blob_mismatch:${path}`);
    }
    return {
      path,
      sha256: createHash("sha256").update(checkedOutBytes).digest("hex")
    };
  })
);
const criticalProjectionHash = await canonicalSha256(criticalFiles);
if (
  canonicalJson(implementationBinding.criticalFiles) !== canonicalJson(criticalFiles) ||
  implementationBinding.criticalProjectionHash !== criticalProjectionHash
) {
  throw new Error("direct_observation_critical_worktree_mismatch");
}
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
const currentPackageDocument = JSON.parse(
  await readFile("package.json", "utf8")
) as PackageDocument;
const observationPackageDocument = JSON.parse(
  execFileSync("git", ["show", `${observationCommit}:package.json`], { encoding: "utf8" })
) as PackageDocument;
const activePackageDocument = JSON.parse(
  execFileSync("git", ["show", `${activeCommit}:package.json`], { encoding: "utf8" })
) as PackageDocument;
const dependencyProjection = projectDependencies(currentPackageDocument);
const observationDependencyProjection = projectDependencies(observationPackageDocument);
const activeDependencyProjection = projectDependencies(activePackageDocument);
const dependencyProjectionHash = await canonicalSha256(dependencyProjection);
const observationDependencyProjectionHash = await canonicalSha256(observationDependencyProjection);
const activeDependencyProjectionHash = await canonicalSha256(activeDependencyProjection);
if (
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
    criticalFileCount: criticalFiles.length,
    criticalProjectionHash,
    dependencyProjectionHash,
    observationDependencyProjectionHash,
    activeDependencyProjectionHash,
    evidenceRawSha256: createHash("sha256").update(evidenceBytes).digest("hex"),
    providerCallsPerformed: 0
  })}\n`
);
