import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import {
  JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_PATH,
  JUDGE_DEMO_INVOCATION_INTEGRITY_IMPLEMENTATION_ALLOWED_PATHS,
  JUDGE_DEMO_INVOCATION_INTEGRITY_PROTOCOL_PATHS
} from "@/lib/judge/collateral-proof";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { z } from "zod";

export const GATE6_PRESENTATION_PROOF_VERSION = "toolproof-gate6-presentation-proof@1.0.0";
export const GATE6_PRESENTATION_PROOF_ENV = "TOOLPROOF_GATE6_PRESENTATION_PROOF_B64";
export const GATE6_PRESENTATION_CHANGED_PATH_LIMIT = 192 as const;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const commit = z.string().regex(/^[a-f0-9]{40}$/u);
const sourcePath = z
  .string()
  .min(1)
  .max(240)
  .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u);

const presentationProofSchema = z
  .object({
    version: z.literal(GATE6_PRESENTATION_PROOF_VERSION),
    measuredV2Commit: commit,
    presentationCommit: commit,
    changedPaths: z.array(sourcePath).min(1).max(GATE6_PRESENTATION_CHANGED_PATH_LIMIT),
    criticalFiles: z
      .array(z.object({ path: sourcePath, sha256 }).strict())
      .min(20)
      .max(500),
    criticalProjectionHash: sha256,
    dependencyProjectionHash: sha256,
    gitProofPackSha256: sha256,
    baselineRawSha256: sha256,
    revisedRawSha256: sha256,
    proofHash: sha256
  })
  .strict();

export type Gate6PresentationProof = z.infer<typeof presentationProofSchema>;

const allowedExact = new Set([
  JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_PATH,
  ...JUDGE_DEMO_INVOCATION_INTEGRITY_PROTOCOL_PATHS,
  ...JUDGE_DEMO_INVOCATION_INTEGRITY_IMPLEMENTATION_ALLOWED_PATHS,
  ".env.example",
  ".gitattributes",
  ".github/workflows/ci.yml",
  ".prettierignore",
  ".vercelignore",
  "AGENTS.md",
  "CHALLENGE.md",
  "CONTRIBUTING.md",
  "HACKATHON_BUILD.md",
  "README.md",
  "PLAN.md",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md",
  "app/api/readiness/route.ts",
  "app/error.tsx",
  "app/global-error.tsx",
  "app/globals.css",
  "app/lab/page.tsx",
  "app/layout.tsx",
  "app/not-found.tsx",
  "app/page.tsx",
  "app/results/page.tsx",
  "app/studio/page.tsx",
  "components/lab/judge-demo-panel.tsx",
  "components/lab/lab-client.tsx",
  "components/lab/probe-launch-panel.tsx",
  "components/results/semantic-paired-results.tsx",
  "components/site-header.tsx",
  "docs/OFFICIAL_SOURCE_CHECK.md",
  "docs/architecture.md",
  "docs/demo-script.md",
  "docs/methodology.md",
  "docs/rights-review.md",
  "docs/testing.md",
  "lib/semantic/revision-config.server.ts",
  "lib/probe/status.ts",
  "lib/brand.ts",
  "package.json",
  "public/thurstone-results.jpg",
  "public/thurstone-devpost-thumbnail.jpg",
  "public/toolproof-results.jpg",
  "scripts/verify-evidence.mjs",
  "scripts/verify-evidence.ts",
  "scripts/verify-direct-site-tools-evidence.ts",
  "scripts/verify-direct-observation-presentation.ts",
  "scripts/verify-gate6-presentation.ts",
  "scripts/verify-gate7-adversarial-matrix.ts",
  "scripts/verify-gate5-one-variable.ts",
  "scripts/verify-judge-presentation.ts",
  "scripts/verify-publication.mjs",
  "scripts/verify-sample-evidence.ts",
  "scripts/verify-third-party-inventory.mjs",
  "submission/devpost.md",
  "third_party/licenses/nodejs-22.23.2-LICENSE.txt",
  "third_party/licenses/npm/LGPL-3.0-or-later.txt",
  "third_party/licenses/npm/MIT-terms.txt",
  "third_party/licenses/npm/axe-core-4.13.0-MPL-2.0.txt",
  "third_party/licenses/npm/axe-core-4.13.0-THIRD-PARTY.txt",
  "third_party/licenses/npm/caniuse-lite-1.0.30001810-CC-BY-4.0.txt",
  "third_party/licenses/npm/lightningcss-1.33.0-MPL-2.0.txt",
  "third_party/licenses/npm/sharp-0.35.4-Apache-2.0.txt",
  "third_party/licenses/npm/sharp-libvips-linux-x64-1.3.3-NOTICE.md",
  "third_party/licenses/npm/sharp-libvips-linuxmusl-x64-1.3.3-NOTICE.md",
  "third_party/licenses/npm/sharp-wasm32-0.35.4-NOTICE.md",
  "third_party/npm-transitive-inventory.json",
  "tests/browser/gate7-browser.spec.ts",
  "tests/browser/accessibility.spec.ts",
  "tests/browser/lab-sandbox.spec.ts",
  "tests/browser/probe-calibration.spec.ts",
  "tests/browser/results.spec.ts",
  "tests/browser/shell.spec.ts",
  "tests/browser/studio.spec.ts",
  "tests/unit/checkout-tool-catalog.test.ts",
  "tests/unit/gate5-revision-freeze.test.ts",
  "tests/unit/gate1-proof-bundle.test.ts",
  "tests/integration/judge-service.test.ts",
  "tests/integration/judge-presentation.test.ts",
  "tests/unit/gate7-adversarial-matrix.test.ts",
  "tests/unit/judge-envelope.test.ts",
  "tests/unit/judge-store-reader.test.ts",
  "tests/unit/repair-provider.test.ts",
  "tests/unit/results-evidence-package.test.ts",
  "tests/unit/results-meta-tools.test.ts",
  "tests/unit/results-presentation-proof.test.ts"
]);
const allowedPrefixes = [
  "app/api/evidence/",
  "app/api/judge-demo/",
  "evidence/",
  "lib/judge/",
  "lib/results/"
] as const;

export function gate6PresentationPathAllowed(path: string): boolean {
  return allowedExact.has(path) || allowedPrefixes.some((prefix) => path.startsWith(prefix));
}

async function verifyProjection(proof: Gate6PresentationProof): Promise<void> {
  if (
    proof.measuredV2Commit === proof.presentationCommit ||
    new Set(proof.changedPaths).size !== proof.changedPaths.length ||
    new Set(proof.criticalFiles.map(({ path }) => path)).size !== proof.criticalFiles.length ||
    proof.changedPaths.some((path) => !gate6PresentationPathAllowed(path)) ||
    canonicalJson(proof.changedPaths) !== canonicalJson([...proof.changedPaths].sort()) ||
    canonicalJson(proof.criticalFiles) !==
      canonicalJson(
        [...proof.criticalFiles].sort((left, right) =>
          left.path < right.path ? -1 : left.path > right.path ? 1 : 0
        )
      ) ||
    (await canonicalSha256(proof.criticalFiles)) !== proof.criticalProjectionHash
  ) {
    throw new Error("gate6_presentation_proof_projection_invalid");
  }
  const { proofHash, ...payload } = proof;
  if ((await canonicalSha256(payload)) !== proofHash) {
    throw new Error("gate6_presentation_proof_hash_invalid");
  }
}

export async function verifyGate6PresentationProof(
  value: unknown
): Promise<Gate6PresentationProof> {
  const proof = presentationProofSchema.parse(value);
  await verifyProjection(proof);
  return Object.freeze(JSON.parse(canonicalJson(proof)) as Gate6PresentationProof);
}

export async function decodeGate6PresentationProof(
  encoded: string
): Promise<Gate6PresentationProof> {
  if (encoded.length < 1 || encoded.length > 65_536 || !/^[A-Za-z0-9_-]+$/u.test(encoded)) {
    throw new Error("gate6_presentation_proof_encoding_invalid");
  }
  const bytes = Buffer.from(encoded, "base64url");
  if (bytes.toString("base64url") !== encoded) {
    throw new Error("gate6_presentation_proof_encoding_invalid");
  }
  let expanded: Buffer;
  try {
    expanded = gunzipSync(bytes, { maxOutputLength: 65_536 });
  } catch {
    try {
      expanded = brotliDecompressSync(bytes, { maxOutputLength: 65_536 });
    } catch {
      throw new Error("gate6_presentation_proof_encoding_invalid");
    }
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(expanded);
  const value = JSON.parse(text) as unknown;
  if (text !== canonicalJson(value)) throw new Error("gate6_presentation_proof_encoding_invalid");
  return verifyGate6PresentationProof(value);
}

export async function dependencyProjectionHash(value: {
  readonly dependencies: unknown;
  readonly devDependencies: unknown;
  readonly engines: unknown;
}): Promise<string> {
  return sha256Hex(canonicalJson(value));
}
