import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import { createHash } from "node:crypto";
import {
  JUDGE_DEMO_IMPACT_EXECUTION_FINAL_U_FILE_IDENTITIES,
  JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS,
  JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS_HASH,
  JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS,
  JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS_HASH,
  JUDGE_DEMO_IMPACT_EXECUTION_LAZY_HELPER_TEMPLATE,
  JUDGE_DEMO_IMPACT_EXECUTION_LAZY_HELPER_TEMPLATE_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_LAB_RETURN_U,
  JUDGE_DEMO_IMPACT_EXECUTION_LAB_RETURN_U_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_MOUNT_SNIPPET,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_MOUNT_SNIPPET_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_FULL_U_LENGTH,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_FULL_U_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_REACT_IMPORT_U,
  JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_REACT_IMPORT_U_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_RETURN_U,
  JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_RETURN_U_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_RETURN_U,
  JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_RETURN_U_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_COMPACT_BLOCK_TEMPLATE,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_COMPACT_BLOCK_TEMPLATE_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_TEMPLATE,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_TEMPLATE_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_SUMMARY_TEMPLATE,
  JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_SUMMARY_TEMPLATE_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_TEST_REPLACEMENTS,
  JUDGE_DEMO_IMPACT_EXECUTION_TEST_REPLACEMENTS_HASH,
  JUDGE_DEMO_IMPACT_EXECUTION_U_PATCH_BROTLI_BASE64URL,
  JUDGE_DEMO_IMPACT_EXECUTION_U_PATCH_BROTLI_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_U_PATCH_RAW_BYTES,
  JUDGE_DEMO_IMPACT_EXECUTION_U_PATCH_SHA256,
  JUDGE_DEMO_IMPACT_EXECUTION_U_PRESENTATION_PROJECTION_TREE,
  JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_PATH,
  JUDGE_DEMO_INVOCATION_INTEGRITY_IMPLEMENTATION_ALLOWED_PATHS,
  JUDGE_DEMO_INVOCATION_INTEGRITY_PROTOCOL_PATHS
} from "@/lib/judge/collateral-proof";
import { brotliCompressSync, brotliDecompressSync, gzipSync } from "node:zlib";
import {
  GATE6_PRESENTATION_PROOF_VERSION,
  GATE6_PRESENTATION_CHANGED_PATH_LIMIT,
  decodeGate6PresentationProof,
  gate6PresentationPathAllowed,
  verifyGate6PresentationProof
} from "@/lib/results/presentation-proof";
import { describe, expect, it } from "vitest";

async function proof(changedPaths = ["app/results/page.tsx"]) {
  const criticalFiles = Array.from({ length: 20 }, (_, index) => ({
    path: `lib/domain/critical-${String(index).padStart(2, "0")}.ts`,
    sha256: index.toString(16).padStart(64, "0")
  }));
  const payload = {
    version: GATE6_PRESENTATION_PROOF_VERSION,
    measuredV2Commit: "a".repeat(40),
    presentationCommit: "b".repeat(40),
    changedPaths,
    criticalFiles,
    criticalProjectionHash: await canonicalSha256(criticalFiles),
    dependencyProjectionHash: "c".repeat(64),
    gitProofPackSha256: "f".repeat(64),
    baselineRawSha256: "d".repeat(64),
    revisedRawSha256: "e".repeat(64)
  };
  return { ...payload, proofHash: await canonicalSha256(payload) };
}

describe("Gate 6 terminal presentation proof", () => {
  it("accepts only sorted allowlisted presentation changes bound to unchanged critical files", async () => {
    await expect(verifyGate6PresentationProof(await proof())).resolves.toMatchObject({
      measuredV2Commit: "a".repeat(40),
      presentationCommit: "b".repeat(40)
    });
    await expect(
      verifyGate6PresentationProof(await proof(["lib/domain/unrelated.ts"]))
    ).rejects.toThrow(/gate6_presentation_proof_projection_invalid/u);
    expect(gate6PresentationPathAllowed("lib/results/evidence-package.ts")).toBe(true);
    expect(gate6PresentationPathAllowed("lib/judge/service.server.ts")).toBe(true);
    expect(gate6PresentationPathAllowed("app/api/judge-demo/route.ts")).toBe(true);
    for (const rebrandPath of [
      "AGENTS.md",
      "CONTRIBUTING.md",
      "app/error.tsx",
      "app/global-error.tsx",
      "app/layout.tsx",
      "app/not-found.tsx",
      "app/studio/page.tsx",
      "components/site-header.tsx",
      "lib/brand.ts",
      "public/thurstone-results.jpg"
    ]) {
      expect(gate6PresentationPathAllowed(rebrandPath), rebrandPath).toBe(true);
    }
    for (const invocationIntegrityPath of [
      JUDGE_DEMO_INVOCATION_INTEGRITY_AMENDMENT_PATH,
      ...JUDGE_DEMO_INVOCATION_INTEGRITY_PROTOCOL_PATHS,
      ...JUDGE_DEMO_INVOCATION_INTEGRITY_IMPLEMENTATION_ALLOWED_PATHS
    ]) {
      expect(gate6PresentationPathAllowed(invocationIntegrityPath), invocationIntegrityPath).toBe(
        true
      );
    }
    for (const impactExecutionPath of [
      ...JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS,
      ...JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS
    ]) {
      expect(gate6PresentationPathAllowed(impactExecutionPath), impactExecutionPath).toBe(true);
    }
    expect(await canonicalSha256(JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS)).toBe(
      JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS_HASH
    );
    expect(await canonicalSha256(JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS)).toBe(
      JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS_HASH
    );
    expect(JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS).toHaveLength(22);
    expect(JUDGE_DEMO_IMPACT_EXECUTION_FINAL_U_FILE_IDENTITIES.map(({ path }) => path)).toEqual(
      JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS
    );
    const compressedImpactPatch = Buffer.from(
      JUDGE_DEMO_IMPACT_EXECUTION_U_PATCH_BROTLI_BASE64URL,
      "base64url"
    );
    expect(createHash("sha256").update(compressedImpactPatch).digest("hex")).toBe(
      JUDGE_DEMO_IMPACT_EXECUTION_U_PATCH_BROTLI_SHA256
    );
    const impactPatch = brotliDecompressSync(compressedImpactPatch);
    expect(impactPatch).toHaveLength(JUDGE_DEMO_IMPACT_EXECUTION_U_PATCH_RAW_BYTES);
    expect(createHash("sha256").update(impactPatch).digest("hex")).toBe(
      JUDGE_DEMO_IMPACT_EXECUTION_U_PATCH_SHA256
    );
    expect(JUDGE_DEMO_IMPACT_EXECUTION_U_PRESENTATION_PROJECTION_TREE).toMatch(/^[a-f0-9]{40}$/u);
    expect(
      await canonicalSha256([...JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS].reverse())
    ).not.toBe(JUDGE_DEMO_IMPACT_EXECUTION_PROTOCOL_PATHS_HASH);
    expect(
      await canonicalSha256([...JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS].slice(1))
    ).not.toBe(JUDGE_DEMO_IMPACT_EXECUTION_PRESENTATION_PATHS_HASH);
    expect(await sha256Hex(JUDGE_DEMO_IMPACT_EXECUTION_LAZY_HELPER_TEMPLATE)).toBe(
      JUDGE_DEMO_IMPACT_EXECUTION_LAZY_HELPER_TEMPLATE_SHA256
    );
    expect(await sha256Hex(JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_TEMPLATE)).toBe(
      JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_BRIDGE_TEMPLATE_SHA256
    );
    expect(await sha256Hex(JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_SUMMARY_TEMPLATE)).toBe(
      JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_SUMMARY_TEMPLATE_SHA256
    );
    expect(await sha256Hex(JUDGE_DEMO_IMPACT_EXECUTION_LAB_RETURN_U)).toBe(
      JUDGE_DEMO_IMPACT_EXECUTION_LAB_RETURN_U_SHA256
    );
    expect(await sha256Hex(JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_REACT_IMPORT_U)).toBe(
      JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_REACT_IMPORT_U_SHA256
    );
    expect(await sha256Hex(JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_MOUNT_SNIPPET)).toBe(
      JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_MOUNT_SNIPPET_SHA256
    );
    expect(JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_FULL_U_LENGTH).toBe(16_770);
    expect(JUDGE_DEMO_IMPACT_EXECUTION_JUDGE_FULL_U_SHA256).toMatch(/^[a-f0-9]{64}$/u);
    expect(await sha256Hex(JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_RETURN_U)).toBe(
      JUDGE_DEMO_IMPACT_EXECUTION_STUDIO_RETURN_U_SHA256
    );
    expect(await sha256Hex(JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_RETURN_U)).toBe(
      JUDGE_DEMO_IMPACT_EXECUTION_INTEGRITY_RETURN_U_SHA256
    );
    expect(await sha256Hex(JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_COMPACT_BLOCK_TEMPLATE)).toBe(
      JUDGE_DEMO_IMPACT_EXECUTION_RESULTS_COMPACT_BLOCK_TEMPLATE_SHA256
    );
    expect(await canonicalSha256(JUDGE_DEMO_IMPACT_EXECUTION_TEST_REPLACEMENTS)).toBe(
      JUDGE_DEMO_IMPACT_EXECUTION_TEST_REPLACEMENTS_HASH
    );
    expect(gate6PresentationPathAllowed("lib/scored/service.server.ts")).toBe(false);
    expect(gate6PresentationPathAllowed("lib/webmcp/checkout-request-tool.ts")).toBe(false);
    expect(gate6PresentationPathAllowed("lib/semantic/evaluator.server.ts")).toBe(false);
    expect(gate6PresentationPathAllowed("package-lock.json")).toBe(false);
    expect(GATE6_PRESENTATION_CHANGED_PATH_LIMIT).toBe(192);
    const atPathLimit = Array.from(
      { length: GATE6_PRESENTATION_CHANGED_PATH_LIMIT },
      (_, index) => `lib/results/rebrand-${String(index).padStart(3, "0")}.ts`
    );
    await expect(verifyGate6PresentationProof(await proof(atPathLimit))).resolves.toMatchObject({
      changedPaths: atPathLimit
    });
    await expect(
      verifyGate6PresentationProof(
        await proof([...atPathLimit, "lib/results/rebrand-overflow.ts"].sort())
      )
    ).rejects.toThrow(/192|too_big/u);
    expect(atPathLimit).toHaveLength(192);
    expect([...atPathLimit, "lib/results/rebrand-overflow.ts"]).toHaveLength(193);
    expect(canonicalJson((await proof()).changedPaths)).toBe('["app/results/page.tsx"]');
    const canonicalProof = Buffer.from(canonicalJson(await proof()));
    for (const encoded of [gzipSync(canonicalProof), brotliCompressSync(canonicalProof)].map(
      (bytes) => bytes.toString("base64url")
    )) {
      await expect(decodeGate6PresentationProof(encoded)).resolves.toMatchObject({
        presentationCommit: "b".repeat(40)
      });
    }
  });
});
