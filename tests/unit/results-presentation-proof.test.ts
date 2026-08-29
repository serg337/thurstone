import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import { gzipSync } from "node:zlib";
import {
  GATE6_PRESENTATION_PROOF_VERSION,
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
      verifyGate6PresentationProof(await proof(["lib/domain/checkout.ts"]))
    ).rejects.toThrow(/gate6_presentation_proof_projection_invalid/u);
    expect(gate6PresentationPathAllowed("lib/results/evidence-package.ts")).toBe(true);
    expect(gate6PresentationPathAllowed("lib/judge/service.server.ts")).toBe(true);
    expect(gate6PresentationPathAllowed("app/api/judge-demo/route.ts")).toBe(true);
    expect(gate6PresentationPathAllowed("lib/scored/service.server.ts")).toBe(false);
    expect(canonicalJson((await proof()).changedPaths)).toBe('["app/results/page.tsx"]');
    const encoded = gzipSync(Buffer.from(canonicalJson(await proof()))).toString("base64url");
    await expect(decodeGate6PresentationProof(encoded)).resolves.toMatchObject({
      presentationCommit: "b".repeat(40)
    });
  });
});
