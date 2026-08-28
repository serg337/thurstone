import { canonicalJson } from "@/lib/evidence/digest";
import {
  GATE5_SOURCE_DIFF_PATH,
  buildGate5SourceDiffProof,
  decodeGate5SourceDiffProofBase64Url,
  verifyGate5SourceDiffProof
} from "@/lib/semantic/gate5-source-diff-proof";
import { describe, expect, it } from "vitest";

const oldDescription =
  "Finalize the current cart by opening a simulated checkout request that remains pending for human approval when the user is ready to proceed.";
const newDescription =
  "Open a simulated checkout request only when the user explicitly instructs you to start checkout. The request remains pending for human approval and does not complete a purchase.";
const v1AppCommit = "a".repeat(40);
const v2AppCommit = "b".repeat(40);

function source(description: string, schema = "CHECKOUT_OPERATION_JSON_SCHEMA"): string {
  return `export const CHECKOUT_REQUEST_METADATA = {\n  description:\n    ${JSON.stringify(description)},\n  inputSchema: ${schema}\n} as const;\n`;
}

function patch(extra = ""): string {
  return `diff --git a/${GATE5_SOURCE_DIFF_PATH} b/${GATE5_SOURCE_DIFF_PATH}\nindex ${"1".repeat(40)}..${"2".repeat(40)} 100644\n--- a/${GATE5_SOURCE_DIFF_PATH}\n+++ b/${GATE5_SOURCE_DIFF_PATH}\n@@ -1,5 +1,5 @@\n export const CHECKOUT_REQUEST_METADATA = {\n   description:\n-    ${JSON.stringify(oldDescription)},\n+    ${JSON.stringify(newDescription)},\n   inputSchema: CHECKOUT_OPERATION_JSON_SCHEMA\n } as const;\n${extra}`;
}

function build(overrides: Partial<Parameters<typeof buildGate5SourceDiffProof>[0]> = {}) {
  return buildGate5SourceDiffProof({
    changedPaths: [GATE5_SOURCE_DIFF_PATH],
    v1AppCommit,
    v2AppCommit,
    oldJsonStringLiteral: JSON.stringify(oldDescription),
    newJsonStringLiteral: JSON.stringify(newDescription),
    v1RawSource: source(oldDescription),
    v2RawSource: source(newDescription),
    patch: patch(),
    ...overrides
  });
}

describe("Gate 5 exact source-diff proof", () => {
  it("round-trips an exact one-description proof through the bounded environment envelope", async () => {
    const proof = await build();
    const encoded = Buffer.from(canonicalJson(proof), "utf8").toString("base64url");
    await expect(decodeGate5SourceDiffProofBase64Url(encoded)).resolves.toEqual(proof);
    expect(proof).toMatchObject({
      sourcePath: GATE5_SOURCE_DIFF_PATH,
      changedPaths: [GATE5_SOURCE_DIFF_PATH],
      hunkCount: 1,
      removedLineCount: 1,
      addedLineCount: 1
    });
  });

  it("rejects a same-file handler or schema edit after masking the description", async () => {
    await expect(
      build({ v2RawSource: source(newDescription, "CHANGED_CHECKOUT_SCHEMA") })
    ).rejects.toThrow(/gate5_source_diff_masked_source_mismatch/u);
  });

  it("rejects an extra patch hunk even when it contains no second add or removal", async () => {
    await expect(build({ patch: patch("@@ -20,1 +20,1 @@\n context\n") })).rejects.toThrow(
      /gate5_source_diff_patch_shape_invalid/u
    );
  });

  it("rejects a literal that is not the exact JSON string in the source", async () => {
    await expect(
      build({ oldJsonStringLiteral: JSON.stringify(`${oldDescription} altered`) })
    ).rejects.toThrow(/gate5_source_diff_old_literal_binding_invalid/u);
  });

  it("rejects a proof bound to the wrong source commit", async () => {
    const proof = await build();
    await expect(
      verifyGate5SourceDiffProof(proof, {
        v1AppCommit: "c".repeat(40),
        v2AppCommit,
        oldDescription,
        newDescription
      })
    ).rejects.toThrow(/gate5_source_diff_expected_binding_mismatch/u);
  });
});
