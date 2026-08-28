import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  buildGate3HumanReviewPackage,
  gate3ReviewPackageCanonicalJson
} from "@/lib/semantic/checkout-candidate.server";
import { verifyGate3HumanReviewPackage } from "@/lib/semantic/human-freeze.server";

const execFile = promisify(execFileCallback);

const GROUPS = Object.freeze({
  contract: [
    "app/globals.css",
    "app/page.tsx",
    "app/studio/page.tsx",
    "components/site-header.tsx",
    "components/studio/studio-client.tsx",
    "lib/semantic/contract.ts",
    "lib/semantic/checkout-candidate.server.ts",
    "lib/semantic/protocol-freeze.server.ts",
    "lib/semantic/human-freeze.server.ts",
    "lib/studio/meta-tools.ts",
    "scripts/prepare-gate3-review.ts"
  ],
  cases: ["lib/semantic/checkout-candidate.server.ts"],
  fixture: [
    "lib/domain/checkout.ts",
    "lib/domain/checkout-reset.ts",
    "lib/domain/checkout-schemas.ts",
    "lib/domain/checkout-session.ts"
  ],
  manifest: [
    "lib/webmcp/catalog.ts",
    "lib/webmcp/readiness.ts",
    "lib/webmcp/live-manifest.server.ts",
    "lib/webmcp/cart-get-tool.ts",
    "lib/webmcp/cart-update-tool.ts",
    "lib/webmcp/checkout-request-tool.ts",
    "lib/webmcp/checkout-cancel-tool.ts",
    "lib/webmcp/order-review-tool.ts"
  ],
  runner: [
    "package.json",
    "package-lock.json",
    "next.config.ts",
    "tsconfig.json",
    "tsconfig.operator.json",
    "app/layout.tsx",
    "app/page.tsx",
    "app/lab/page.tsx",
    "components/lab/lab-client.tsx",
    "components/lab/probe-calibration-runner.tsx",
    "components/lab/probe-launch-panel.tsx",
    "components/lab/probe-session-blocked.tsx",
    "components/lab/probe-session-cleanup-control.tsx",
    "components/results/probe-calibration-results.tsx",
    "components/simulation-notice.tsx",
    "components/site-header.tsx",
    "components/status-pill.tsx",
    "lib/evidence/checkout-trace-ledger.ts",
    "lib/evidence/gate1-proof-bundle.ts",
    "lib/evidence/gate2-attempt-lineage.ts",
    "lib/evidence/gate2-calibration-bundle.ts",
    "lib/evidence/operation-trace.ts",
    "lib/fallback/trial-runner.ts",
    "lib/fallback/calibration-envelope.ts",
    "lib/fallback/implementation-contract.ts",
    "lib/fallback/lab-page-adapter.server.ts",
    "lib/fallback/native-webmcp-bridge.ts",
    "lib/fallback/openai-tool-decision.ts",
    "lib/fallback/pinned-browser-runtime.server.ts",
    "lib/fallback/runner-contract.ts",
    "lib/scored/envelope.ts",
    "lib/scored/case-source.server.ts",
    "lib/scored/provider-decision.ts",
    "lib/scored/openai-provider.server.ts",
    "lib/scored/native-admission.ts",
    "lib/scored/ledger-record.server.ts",
    "lib/scored/local-recovery.ts",
    "lib/scored/retry-policy.ts",
    "lib/repair/development-package.server.ts",
    "lib/repair/provider.server.ts",
    "lib/repair/store.server.ts",
    "lib/repair/service.server.ts",
    "lib/results/semantic-results.server.ts",
    "lib/results/meta-tools.ts",
    "lib/semantic/revision-freeze.server.ts",
    "lib/semantic/revision-config.server.ts",
    "lib/semantic/revision-store.server.ts",
    "lib/scored/run-store.server.ts",
    "lib/scored/session.server.ts",
    "lib/scored/authorization.server.ts",
    "lib/scored/guard.server.ts",
    "lib/scored/service-contract.ts",
    "lib/scored/service.server.ts",
    "lib/scored/same-origin-server-adapter.server.ts",
    "lib/scored/route-response.ts",
    "lib/probe/activation.ts",
    "lib/probe/calibration-envelope.ts",
    "lib/probe/client-runner.ts",
    "lib/probe/client-session-cleanup.ts",
    "lib/probe/client-session.ts",
    "lib/probe/config.ts",
    "lib/probe/continuation-store.ts",
    "lib/probe/decision.ts",
    "lib/probe/http.ts",
    "lib/probe/ledger.ts",
    "lib/probe/policy-migration-contract.ts",
    "lib/probe/policy-v03-migration-contract.ts",
    "lib/probe/policy-v04-migration-contract.ts",
    "lib/probe/policy-v04-migration.server.ts",
    "lib/probe/policy-v05-migration-contract.ts",
    "lib/probe/policy-v05-migration.server.ts",
    "lib/probe/policy.ts",
    "lib/probe/run-index.ts",
    "lib/probe/runner-contract.ts",
    "lib/probe/server-artifact.ts",
    "lib/probe/service-contract.ts",
    "lib/probe/session.ts",
    "lib/probe/signing-secret.ts",
    "lib/probe/status.ts",
    "lib/semantic/frozen-config.server.ts",
    "lib/semantic/freeze-store.server.ts",
    "lib/semantic/review-package-config.server.ts",
    "app/api/scored/readiness/route.ts",
    "app/api/scored/session/route.ts",
    "app/api/scored/issue/route.ts",
    "app/api/scored/decide/route.ts",
    "app/api/scored/native/route.ts",
    "app/api/scored/complete/route.ts",
    "app/api/scored/failure/route.ts",
    "app/api/scored/reveal/route.ts",
    "app/api/repair/run/route.ts",
    "app/results/page.tsx",
    "components/results/semantic-development-results.tsx",
    "components/results/semantic-paired-results.tsx",
    "scripts/scored-run.ts",
    "scripts/scored-run-store-integration.ts",
    "scripts/check-durable-store.mjs",
    "scripts/check-openai-entitlement.mjs",
    "scripts/clean-next-dev-types.mjs",
    "scripts/gate3-freeze-bootstrap.ts",
    "scripts/gate5-revision-bootstrap.ts",
    "scripts/verify-gate5-one-variable.ts",
    "scripts/verify-probe-no-leakage.mjs",
    "scripts/gate3-leakage-sentinels.json",
    "scripts/probe-continuation-integration.ts",
    "scripts/probe-controls.ts",
    "scripts/server-only.ts",
    "lib/webmcp/capabilities.ts",
    "lib/webmcp/checkout-tools.ts",
    "lib/webmcp/manifest-normalization.ts",
    "lib/webmcp/registry-manager.ts",
    "lib/webmcp/runtime.ts",
    "lib/webmcp/tool-execution.ts"
  ],
  evaluator: [
    "lib/semantic/contract.ts",
    "lib/semantic/evaluator.server.ts",
    "lib/semantic/trace-verifier.server.ts",
    "lib/semantic/scored-evaluation.server.ts",
    "playwright.config.ts",
    "tests/browser/lab-sandbox.spec.ts",
    "tests/browser/shell.spec.ts",
    "tests/browser/studio.spec.ts",
    "tests/unit/gate3-checkout-candidate.test.ts",
    "tests/unit/gate3-freeze-store.test.ts",
    "tests/unit/gate3-semantic-core.test.ts",
    "tests/unit/gate5-revision-freeze.test.ts",
    "tests/unit/probe-no-leakage-script.test.ts",
    "tests/unit/repair-ledger-recovery.test.ts",
    "tests/unit/repair-provider.test.ts",
    "tests/unit/results-meta-tools.test.ts",
    "tests/unit/scored-boundary.test.ts",
    "tests/unit/scored-crash-ordering.test.ts",
    "tests/unit/scored-evaluation-row.test.ts",
    "tests/unit/scored-guard-offset.test.ts",
    "tests/unit/scored-local-recovery.test.ts",
    "tests/unit/scored-retry-policy.test.ts",
    "tests/unit/scored-reveal-boundary.test.ts",
    "tests/unit/scored-routes-disabled.test.ts",
    "tests/unit/scored-run-store.test.ts",
    "tests/unit/scored-session.test.ts",
    "tests/unit/semantic-trace-verifier.test.ts",
    "tests/unit/studio-meta-tools.test.ts"
  ]
});

const CANONICALIZER_SOURCE = "lib/evidence/digest.ts";

async function git(...args: string[]): Promise<string> {
  const result = await execFile("git", args, { cwd: process.cwd(), encoding: "utf8" });
  return result.stdout.trim();
}

function rawSha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function inventory(paths: readonly string[]) {
  return Promise.all(
    [...new Set(paths)].sort().map(async (sourcePath) => {
      const bytes = await readFile(path.resolve(process.cwd(), sourcePath));
      return Object.freeze({ path: sourcePath, bytes: bytes.byteLength, sha256: rawSha256(bytes) });
    })
  );
}

async function groupHash(label: string, paths: readonly string[]) {
  const files = await inventory(paths);
  return Object.freeze({
    label,
    files,
    hash: await canonicalSha256({
      version: "toolproof-gate3-source-group@1.0.0",
      label,
      files
    })
  });
}

async function writeExclusive(filePath: string, bytes: string): Promise<void> {
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function main(): Promise<void> {
  const [status, commit] = await Promise.all([
    git("status", "--porcelain"),
    git("rev-parse", "HEAD")
  ]);
  if (status !== "") throw new Error("gate3_review_requires_clean_worktree");
  if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error("gate3_review_commit_invalid");
  const [contract, cases, fixture, manifest, runner, evaluator, canonicalizer] = await Promise.all([
    groupHash("contract", GROUPS.contract),
    groupHash("cases", GROUPS.cases),
    groupHash("fixture", GROUPS.fixture),
    groupHash("manifest", GROUPS.manifest),
    groupHash("runner", GROUPS.runner),
    groupHash("evaluator", GROUPS.evaluator),
    groupHash("canonicalizer", [CANONICALIZER_SOURCE])
  ]);
  const bindings = {
    source: {
      repositoryCommit: commit,
      contractSourceSha256: contract.hash,
      casesSourceSha256: cases.hash,
      fixtureSourceSha256: fixture.hash,
      manifestSourceSha256: manifest.hash,
      runnerSourceSha256: runner.hash,
      evaluatorSourceSha256: evaluator.hash
    },
    canonicalizerSourceSha256: canonicalizer.hash
  };
  const review = await buildGate3HumanReviewPackage(bindings);
  await verifyGate3HumanReviewPackage(review);
  const directory = path.resolve(process.cwd(), ".toolproof-local/evidence/gate3");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const reviewPath = path.join(
    directory,
    `toolproof-gate3-review-${commit.slice(0, 12)}-${review.packageHash.slice(0, 12)}.json`
  );
  const sourceBindingPath = path.join(directory, `source-binding-${commit.slice(0, 12)}.b64`);
  const inventoryPath = path.join(directory, `source-inventory-${commit.slice(0, 12)}.json`);
  const reviewBytes = gate3ReviewPackageCanonicalJson(review);
  const sourceBinding = Buffer.from(canonicalJson(bindings), "utf8").toString("base64url");
  const inventoryReceipt = {
    version: "toolproof-gate3-source-inventory@1.0.0",
    commit,
    groups: { contract, cases, fixture, manifest, runner, evaluator, canonicalizer },
    sourceBindingHash: await canonicalSha256(bindings),
    reviewPackageHash: review.packageHash,
    freezeHash: review.freezeHash
  };
  await Promise.all([
    writeExclusive(reviewPath, reviewBytes),
    writeExclusive(sourceBindingPath, `${sourceBinding}\n`),
    writeExclusive(inventoryPath, `${canonicalJson(inventoryReceipt)}\n`)
  ]);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      commit,
      reviewPath,
      reviewBytes: Buffer.byteLength(reviewBytes),
      reviewRawSha256: rawSha256(reviewBytes),
      reviewPackageHash: review.packageHash,
      freezeHash: review.freezeHash,
      sourceBindingPath,
      inventoryPath
    })}\n`
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ error: error instanceof Error ? error.message : "gate3_review_failed" })}\n`
  );
  process.exitCode = 1;
});
