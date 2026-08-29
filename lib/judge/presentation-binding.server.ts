import "server-only";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  judgeDemoImmutableProjectionHash,
  verifyJudgeDemoCollateralProof,
  type JudgeDemoCollateralProof
} from "@/lib/judge/collateral-proof";
import type { JudgeDemoEnvelope } from "@/lib/judge/envelope";
import { gunzipSync } from "node:zlib";
import { z } from "zod";

export const JUDGE_DEMO_PRESENTATION_BINDING_VERSION =
  "toolproof-judge-demo-presentation-binding@1.0.0";
export const JUDGE_DEMO_PUBLIC_PRESENTATION_BINDING_VERSION =
  "toolproof-judge-demo-public-presentation-binding@1.0.0";
export const JUDGE_DEMO_PRESENTATION_BINDING_ENV = "TOOLPROOF_JUDGE_PRESENTATION_BINDING_B64";
export const JUDGE_DEMO_PRESENTATION_BINDING_HASH_ENV = "TOOLPROOF_JUDGE_PRESENTATION_BINDING_HASH";
export const JUDGE_DEMO_PRESENTATION_MODE_ENV = "TOOLPROOF_JUDGE_PRESENTATION_MODE";
export const JUDGE_DEMO_GIT_PACK_ENV = "TOOLPROOF_JUDGE_GIT_PACK_B64";
export const JUDGE_DEMO_PRESENTATION_MODES = ["predecessor", "successor"] as const;
export type JudgeDemoPresentationMode = (typeof JUDGE_DEMO_PRESENTATION_MODES)[number];

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const commit = z.string().regex(/^[a-f0-9]{40}$/u);

export const judgeDemoPresentationBindingSchema = z
  .object({
    version: z.literal(JUDGE_DEMO_PRESENTATION_BINDING_VERSION),
    predecessorCommit: commit,
    successorCommit: commit,
    predecessorEnvelopeHash: sha256,
    successorEnvelopeHash: sha256,
    predecessorReceiptDigest: sha256,
    immutableProjectionHash: sha256,
    collateralProof: z.unknown(),
    collateralProofHash: sha256,
    providerCallsPerformed: z.literal(0),
    replayOnly: z.literal(true),
    bindingHash: sha256
  })
  .strict();

export type JudgeDemoPresentationBinding = Omit<
  z.infer<typeof judgeDemoPresentationBindingSchema>,
  "collateralProof"
> & { readonly collateralProof: JudgeDemoCollateralProof };

export async function verifyJudgeDemoPresentationBinding(input: {
  readonly value: unknown;
  readonly predecessorEnvelope: JudgeDemoEnvelope;
  readonly successorEnvelope: JudgeDemoEnvelope;
  readonly predecessorReceiptDigest: string;
}): Promise<JudgeDemoPresentationBinding> {
  const parsed = judgeDemoPresentationBindingSchema.parse(input.value);
  const collateralProof = await verifyJudgeDemoCollateralProof(parsed.collateralProof);
  const [predecessorProjectionHash, successorProjectionHash] = await Promise.all([
    judgeDemoImmutableProjectionHash(input.predecessorEnvelope),
    judgeDemoImmutableProjectionHash(input.successorEnvelope)
  ]);
  const { bindingHash, ...payload } = parsed;
  if (
    parsed.predecessorCommit === parsed.successorCommit ||
    parsed.predecessorCommit !== input.predecessorEnvelope.buildCommit ||
    parsed.successorCommit !== input.successorEnvelope.buildCommit ||
    parsed.predecessorEnvelopeHash !== input.predecessorEnvelope.envelopeHash ||
    parsed.successorEnvelopeHash !== input.successorEnvelope.envelopeHash ||
    parsed.predecessorReceiptDigest !== input.predecessorReceiptDigest ||
    predecessorProjectionHash !== successorProjectionHash ||
    parsed.immutableProjectionHash !== predecessorProjectionHash ||
    parsed.collateralProofHash !== collateralProof.proofHash ||
    collateralProof.predecessorCommit !== parsed.predecessorCommit ||
    collateralProof.successorCommit !== parsed.successorCommit ||
    collateralProof.predecessorEnvelopeHash !== parsed.predecessorEnvelopeHash ||
    collateralProof.successorEnvelopeHash !== parsed.successorEnvelopeHash ||
    collateralProof.predecessorReceiptDigest !== parsed.predecessorReceiptDigest ||
    collateralProof.immutableProjectionHash !== parsed.immutableProjectionHash ||
    (await canonicalSha256(payload)) !== bindingHash
  ) {
    throw new Error("judge_demo_presentation_binding_invalid");
  }
  return Object.freeze(
    JSON.parse(canonicalJson({ ...parsed, collateralProof })) as JudgeDemoPresentationBinding
  );
}

export async function decodeJudgeDemoPresentationBinding(encoded: string): Promise<unknown> {
  if (encoded.length < 1 || encoded.length > 131_072 || !/^[A-Za-z0-9_-]+$/u.test(encoded)) {
    throw new Error("judge_demo_presentation_binding_encoding_invalid");
  }
  const compressed = Buffer.from(encoded, "base64url");
  if (compressed.toString("base64url") !== encoded) {
    throw new Error("judge_demo_presentation_binding_encoding_invalid");
  }
  let expanded: Buffer;
  try {
    expanded = gunzipSync(compressed, { maxOutputLength: 262_144 });
  } catch {
    throw new Error("judge_demo_presentation_binding_encoding_invalid");
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(expanded);
  const value = JSON.parse(text) as unknown;
  if (text !== canonicalJson(value)) {
    throw new Error("judge_demo_presentation_binding_encoding_invalid");
  }
  return value;
}

export async function configuredJudgeDemoPresentationBinding(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly predecessorEnvelope: JudgeDemoEnvelope;
  readonly successorEnvelope: JudgeDemoEnvelope;
  readonly predecessorReceiptDigest: string;
}): Promise<JudgeDemoPresentationBinding> {
  const encoded = input.environment[JUDGE_DEMO_PRESENTATION_BINDING_ENV]?.trim() ?? "";
  const expectedHash = input.environment[JUDGE_DEMO_PRESENTATION_BINDING_HASH_ENV]?.trim() ?? "";
  const binding = await verifyJudgeDemoPresentationBinding({
    value: await decodeJudgeDemoPresentationBinding(encoded),
    predecessorEnvelope: input.predecessorEnvelope,
    successorEnvelope: input.successorEnvelope,
    predecessorReceiptDigest: input.predecessorReceiptDigest
  });
  if (binding.bindingHash !== expectedHash) {
    throw new Error("judge_demo_presentation_binding_root_mismatch");
  }
  return binding;
}

export function publicJudgeDemoPresentationBinding(binding: JudgeDemoPresentationBinding) {
  return Object.freeze({
    version: JUDGE_DEMO_PUBLIC_PRESENTATION_BINDING_VERSION,
    predecessorCommit: binding.predecessorCommit,
    successorCommit: binding.successorCommit,
    predecessorEnvelopeHash: binding.predecessorEnvelopeHash,
    successorEnvelopeHash: binding.successorEnvelopeHash,
    predecessorReceiptDigest: binding.predecessorReceiptDigest,
    immutableProjectionHash: binding.immutableProjectionHash,
    collateralProofHash: binding.collateralProofHash,
    bindingHash: binding.bindingHash,
    providerCallsPerformed: 0 as const,
    replayOnly: true as const
  });
}
