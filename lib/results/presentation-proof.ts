import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import { gunzipSync } from "node:zlib";
import { z } from "zod";

export const GATE6_PRESENTATION_PROOF_VERSION = "toolproof-gate6-presentation-proof@1.0.0";
export const GATE6_PRESENTATION_PROOF_ENV = "TOOLPROOF_GATE6_PRESENTATION_PROOF_B64";

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
    changedPaths: z.array(sourcePath).min(1).max(100),
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
  "README.md",
  "PLAN.md",
  "app/globals.css",
  "app/results/page.tsx",
  "components/results/semantic-paired-results.tsx",
  "docs/methodology.md",
  "docs/testing.md",
  "lib/semantic/revision-config.server.ts",
  "package.json",
  "scripts/verify-evidence.mjs",
  "scripts/verify-evidence.ts",
  "scripts/verify-gate6-presentation.ts",
  "scripts/verify-gate5-one-variable.ts",
  "tests/browser/results.spec.ts",
  "tests/browser/shell.spec.ts",
  "tests/browser/studio.spec.ts",
  "tests/unit/checkout-tool-catalog.test.ts",
  "tests/unit/gate5-revision-freeze.test.ts",
  "tests/unit/repair-provider.test.ts",
  "tests/unit/results-evidence-package.test.ts",
  "tests/unit/results-presentation-proof.test.ts"
]);
const allowedPrefixes = ["app/api/evidence/", "evidence/", "lib/results/"] as const;

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
    throw new Error("gate6_presentation_proof_encoding_invalid");
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
