import { canonicalJson, canonicalSha256, sha256Hex } from "@/lib/evidence/digest";
import { z } from "zod";

export const GATE5_SOURCE_DIFF_PROOF_VERSION = "toolproof-gate5-source-diff-proof@1.0.0";
export const GATE5_SOURCE_DIFF_PATH = "lib/webmcp/checkout-request-tool.ts";
export const GATE5_SOURCE_DIFF_ENV = "TOOLPROOF_GATE5_SOURCE_DIFF_PROOF_B64";

const SOURCE_LIMIT_BYTES = 8_192;
const PATCH_LIMIT_BYTES = 8_192;
const ENVELOPE_LIMIT_BYTES = 24_576;
const ENVELOPE_LIMIT_CHARACTERS = 32_768;
const MASK = "<toolproof-checkout-request-description@1>";
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const commit = z.string().regex(/^[a-f0-9]{40}$/u);
const base64Url = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/u);

export const gate5SourceDiffProofSchema = z
  .object({
    version: z.literal(GATE5_SOURCE_DIFF_PROOF_VERSION),
    sourcePath: z.literal(GATE5_SOURCE_DIFF_PATH),
    changedPaths: z.tuple([z.literal(GATE5_SOURCE_DIFF_PATH)]),
    v1AppCommit: commit,
    v2AppCommit: commit,
    oldJsonStringLiteral: z.string().min(2).max(1_024),
    newJsonStringLiteral: z.string().min(2).max(1_024),
    v1RawSourceBase64Url: base64Url.max(11_000),
    v2RawSourceBase64Url: base64Url.max(11_000),
    patchBase64Url: base64Url.max(11_000),
    v1RawSourceSha256: sha256,
    v2RawSourceSha256: sha256,
    maskedSourceSha256: sha256,
    patchSha256: sha256,
    hunkCount: z.literal(1),
    removedLineCount: z.literal(1),
    addedLineCount: z.literal(1),
    proofHash: sha256
  })
  .strict();

export type Gate5SourceDiffProof = z.infer<typeof gate5SourceDiffProofSchema>;

export interface Gate5SourceDiffExpectation {
  readonly v1AppCommit: string;
  readonly v2AppCommit: string;
  readonly oldDescription: string;
  readonly newDescription: string;
}

export class Gate5SourceDiffProofError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "Gate5SourceDiffProofError";
  }
}

function decodeBase64Url(value: string, limit: number, code: string): Buffer {
  const bytes = Buffer.from(value, "base64url");
  if (bytes.byteLength < 1 || bytes.byteLength > limit || bytes.toString("base64url") !== value) {
    throw new Gate5SourceDiffProofError(code);
  }
  return bytes;
}

function decodeUtf8(value: string, limit: number, code: string): string {
  const bytes = decodeBase64Url(value, limit, code);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Gate5SourceDiffProofError(code);
  }
}

function descriptionFromLiteral(literal: string, code: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(literal) as unknown;
  } catch {
    throw new Gate5SourceDiffProofError(code);
  }
  if (
    typeof parsed !== "string" ||
    parsed.length < 40 ||
    parsed.length > 500 ||
    parsed.trim() !== parsed ||
    JSON.stringify(parsed) !== literal
  ) {
    throw new Gate5SourceDiffProofError(code);
  }
  return parsed;
}

function replaceExactlyOnce(source: string, literal: string, code: string): string {
  const first = source.indexOf(literal);
  if (first < 0 || source.indexOf(literal, first + literal.length) >= 0) {
    throw new Gate5SourceDiffProofError(code);
  }
  const expectedBinding = `  description:\n    ${literal},`;
  if (!source.includes(expectedBinding)) {
    throw new Gate5SourceDiffProofError(code);
  }
  return `${source.slice(0, first)}${MASK}${source.slice(first + literal.length)}`;
}

function inspectPatch(
  patch: string,
  oldJsonStringLiteral: string,
  newJsonStringLiteral: string
): { readonly hunkCount: 1; readonly removedLineCount: 1; readonly addedLineCount: 1 } {
  const lines = patch.endsWith("\n") ? patch.slice(0, -1).split("\n") : patch.split("\n");
  const expectedHeader = [
    `diff --git a/${GATE5_SOURCE_DIFF_PATH} b/${GATE5_SOURCE_DIFF_PATH}`,
    null,
    `--- a/${GATE5_SOURCE_DIFF_PATH}`,
    `+++ b/${GATE5_SOURCE_DIFF_PATH}`
  ] as const;
  if (
    lines.length < 7 ||
    lines[0] !== expectedHeader[0] ||
    !/^index [a-f0-9]{40}\.\.[a-f0-9]{40} 100644$/u.test(lines[1] ?? "") ||
    lines[2] !== expectedHeader[2] ||
    lines[3] !== expectedHeader[3]
  ) {
    throw new Gate5SourceDiffProofError("gate5_source_diff_patch_format_invalid");
  }

  let hunkCount = 0;
  const removed: string[] = [];
  const added: string[] = [];
  for (let index = 4; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.startsWith("@@ ")) {
      hunkCount += 1;
      if (!/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(?: .*)?$/u.test(line)) {
        throw new Gate5SourceDiffProofError("gate5_source_diff_patch_format_invalid");
      }
      continue;
    }
    if (hunkCount < 1 || line.length < 1 || ![" ", "+", "-"].includes(line[0] ?? "")) {
      throw new Gate5SourceDiffProofError("gate5_source_diff_patch_format_invalid");
    }
    if (line.startsWith("-")) removed.push(line.slice(1));
    if (line.startsWith("+")) added.push(line.slice(1));
  }
  if (
    hunkCount !== 1 ||
    removed.length !== 1 ||
    added.length !== 1 ||
    removed[0] !== `    ${oldJsonStringLiteral},` ||
    added[0] !== `    ${newJsonStringLiteral},`
  ) {
    throw new Gate5SourceDiffProofError("gate5_source_diff_patch_shape_invalid");
  }
  return { hunkCount: 1, removedLineCount: 1, addedLineCount: 1 };
}

export function extractGate5DescriptionJsonLiteral(source: string): string {
  const matches = [...source.matchAll(/^  description:\n    ("(?:[^"\\]|\\.)*"),$/gmu)];
  if (matches.length !== 1 || !matches[0]?.[1]) {
    throw new Gate5SourceDiffProofError("gate5_source_diff_description_literal_missing");
  }
  descriptionFromLiteral(matches[0][1], "gate5_source_diff_description_literal_invalid");
  return matches[0][1];
}

export async function buildGate5SourceDiffProof(input: {
  readonly changedPaths: readonly string[];
  readonly v1AppCommit: string;
  readonly v2AppCommit: string;
  readonly oldJsonStringLiteral: string;
  readonly newJsonStringLiteral: string;
  readonly v1RawSource: string;
  readonly v2RawSource: string;
  readonly patch: string;
}): Promise<Gate5SourceDiffProof> {
  if (
    input.changedPaths.length !== 1 ||
    input.changedPaths[0] !== GATE5_SOURCE_DIFF_PATH ||
    !/^[a-f0-9]{40}$/u.test(input.v1AppCommit) ||
    !/^[a-f0-9]{40}$/u.test(input.v2AppCommit) ||
    input.v1AppCommit === input.v2AppCommit
  ) {
    throw new Gate5SourceDiffProofError("gate5_source_diff_lineage_invalid");
  }
  const oldDescription = descriptionFromLiteral(
    input.oldJsonStringLiteral,
    "gate5_source_diff_old_literal_invalid"
  );
  const newDescription = descriptionFromLiteral(
    input.newJsonStringLiteral,
    "gate5_source_diff_new_literal_invalid"
  );
  if (oldDescription === newDescription) {
    throw new Gate5SourceDiffProofError("gate5_source_diff_literal_unchanged");
  }

  const v1Bytes = Buffer.from(input.v1RawSource, "utf8");
  const v2Bytes = Buffer.from(input.v2RawSource, "utf8");
  const patchBytes = Buffer.from(input.patch, "utf8");
  if (
    v1Bytes.byteLength < 1 ||
    v1Bytes.byteLength > SOURCE_LIMIT_BYTES ||
    v2Bytes.byteLength < 1 ||
    v2Bytes.byteLength > SOURCE_LIMIT_BYTES ||
    patchBytes.byteLength < 1 ||
    patchBytes.byteLength > PATCH_LIMIT_BYTES
  ) {
    throw new Gate5SourceDiffProofError("gate5_source_diff_material_size_invalid");
  }
  if (
    v1Bytes.toString("utf8") !== input.v1RawSource ||
    v2Bytes.toString("utf8") !== input.v2RawSource ||
    patchBytes.toString("utf8") !== input.patch
  ) {
    throw new Gate5SourceDiffProofError("gate5_source_diff_material_encoding_invalid");
  }

  const maskedV1 = replaceExactlyOnce(
    input.v1RawSource,
    input.oldJsonStringLiteral,
    "gate5_source_diff_old_literal_binding_invalid"
  );
  const maskedV2 = replaceExactlyOnce(
    input.v2RawSource,
    input.newJsonStringLiteral,
    "gate5_source_diff_new_literal_binding_invalid"
  );
  if (maskedV1 !== maskedV2) {
    throw new Gate5SourceDiffProofError("gate5_source_diff_masked_source_mismatch");
  }
  const patchShape = inspectPatch(
    input.patch,
    input.oldJsonStringLiteral,
    input.newJsonStringLiteral
  );
  const payload = {
    version: GATE5_SOURCE_DIFF_PROOF_VERSION,
    sourcePath: GATE5_SOURCE_DIFF_PATH,
    changedPaths: [GATE5_SOURCE_DIFF_PATH] as [typeof GATE5_SOURCE_DIFF_PATH],
    v1AppCommit: input.v1AppCommit,
    v2AppCommit: input.v2AppCommit,
    oldJsonStringLiteral: input.oldJsonStringLiteral,
    newJsonStringLiteral: input.newJsonStringLiteral,
    v1RawSourceBase64Url: v1Bytes.toString("base64url"),
    v2RawSourceBase64Url: v2Bytes.toString("base64url"),
    patchBase64Url: patchBytes.toString("base64url"),
    v1RawSourceSha256: await sha256Hex(input.v1RawSource),
    v2RawSourceSha256: await sha256Hex(input.v2RawSource),
    maskedSourceSha256: await sha256Hex(maskedV1),
    patchSha256: await sha256Hex(input.patch),
    ...patchShape
  } satisfies Omit<Gate5SourceDiffProof, "proofHash">;
  return Object.freeze({
    ...payload,
    proofHash: await canonicalSha256(payload)
  });
}

export async function verifyGate5SourceDiffProof(
  value: unknown,
  expected?: Gate5SourceDiffExpectation
): Promise<Gate5SourceDiffProof> {
  let proof: Gate5SourceDiffProof;
  try {
    proof = gate5SourceDiffProofSchema.parse(value);
  } catch {
    throw new Gate5SourceDiffProofError("gate5_source_diff_proof_invalid");
  }
  const rebuilt = await buildGate5SourceDiffProof({
    changedPaths: proof.changedPaths,
    v1AppCommit: proof.v1AppCommit,
    v2AppCommit: proof.v2AppCommit,
    oldJsonStringLiteral: proof.oldJsonStringLiteral,
    newJsonStringLiteral: proof.newJsonStringLiteral,
    v1RawSource: decodeUtf8(
      proof.v1RawSourceBase64Url,
      SOURCE_LIMIT_BYTES,
      "gate5_source_diff_v1_source_invalid"
    ),
    v2RawSource: decodeUtf8(
      proof.v2RawSourceBase64Url,
      SOURCE_LIMIT_BYTES,
      "gate5_source_diff_v2_source_invalid"
    ),
    patch: decodeUtf8(proof.patchBase64Url, PATCH_LIMIT_BYTES, "gate5_source_diff_patch_invalid")
  });
  if (canonicalJson(rebuilt) !== canonicalJson(proof)) {
    throw new Gate5SourceDiffProofError("gate5_source_diff_proof_hash_mismatch");
  }
  if (
    expected &&
    (proof.v1AppCommit !== expected.v1AppCommit ||
      proof.v2AppCommit !== expected.v2AppCommit ||
      proof.oldJsonStringLiteral !== JSON.stringify(expected.oldDescription) ||
      proof.newJsonStringLiteral !== JSON.stringify(expected.newDescription))
  ) {
    throw new Gate5SourceDiffProofError("gate5_source_diff_expected_binding_mismatch");
  }
  return rebuilt;
}

export async function decodeGate5SourceDiffProofBase64Url(
  encoded: string
): Promise<Gate5SourceDiffProof> {
  if (
    encoded.length < 1 ||
    encoded.length > ENVELOPE_LIMIT_CHARACTERS ||
    !/^[A-Za-z0-9_-]+$/u.test(encoded)
  ) {
    throw new Gate5SourceDiffProofError("gate5_source_diff_encoding_invalid");
  }
  const bytes = decodeBase64Url(
    encoded,
    ENVELOPE_LIMIT_BYTES,
    "gate5_source_diff_encoding_invalid"
  );
  let value: unknown;
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(decoded) as unknown;
  } catch {
    throw new Gate5SourceDiffProofError("gate5_source_diff_encoding_invalid");
  }
  if (decoded !== canonicalJson(value)) {
    throw new Gate5SourceDiffProofError("gate5_source_diff_encoding_invalid");
  }
  return verifyGate5SourceDiffProof(value);
}
