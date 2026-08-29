import "server-only";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  judgeDemoImmutableProjectionHash,
  verifyJudgeDemoPresentationTransition,
  type JudgeDemoPresentationTransition
} from "@/lib/judge/collateral-proof";
import { createJudgeDemoEnvelope, type JudgeDemoEnvelope } from "@/lib/judge/envelope";
import { gunzipSync } from "node:zlib";
import { z } from "zod";

export const JUDGE_DEMO_PRESENTATION_BINDING_VERSION =
  "toolproof-judge-demo-presentation-lineage@2.0.0";
export const JUDGE_DEMO_PUBLIC_PRESENTATION_BINDING_VERSION =
  "toolproof-judge-demo-public-presentation-lineage@2.0.0";
export const JUDGE_DEMO_PRESENTATION_BINDING_ENV = "TOOLPROOF_JUDGE_PRESENTATION_BINDING_B64";
export const JUDGE_DEMO_PRESENTATION_BINDING_HASH_ENV = "TOOLPROOF_JUDGE_PRESENTATION_BINDING_HASH";
export const JUDGE_DEMO_PRESENTATION_MODE_ENV = "TOOLPROOF_JUDGE_PRESENTATION_MODE";
export const JUDGE_DEMO_GIT_PACK_ENV = "TOOLPROOF_JUDGE_GIT_PACK_B64";
export const JUDGE_DEMO_SHARED_GIT_PACK_ENV = "TOOLPROOF_GATE6_GIT_PACK_B64";
export const JUDGE_DEMO_PRESENTATION_MODES = ["predecessor", "successor"] as const;
export type JudgeDemoPresentationMode = (typeof JUDGE_DEMO_PRESENTATION_MODES)[number];

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const commit = z.string().regex(/^[a-f0-9]{40}$/u);

export const judgeDemoPresentationBindingSchema = z
  .object({
    version: z.literal(JUDGE_DEMO_PRESENTATION_BINDING_VERSION),
    rootEvidenceCommit: commit,
    activeCommit: commit,
    rootEnvelopeHash: sha256,
    activeEnvelopeHash: sha256,
    rootReceiptDigest: sha256,
    rootArtifactDigest: sha256,
    rootStoredProjectionDigest: sha256,
    rootCapturedAt: z.string().datetime({ offset: true }),
    immutableProjectionHash: sha256,
    transitions: z.array(z.unknown()).min(1).max(2),
    gitProofPackSha256: sha256,
    providerCallsPerformed: z.literal(0),
    storeWritesPerformed: z.literal(0),
    replayOnly: z.literal(true),
    lineageHash: sha256,
    bindingHash: sha256
  })
  .strict();

export type JudgeDemoPresentationBinding = Omit<
  z.infer<typeof judgeDemoPresentationBindingSchema>,
  "transitions"
> & { readonly transitions: readonly JudgeDemoPresentationTransition[] };

async function envelopeFor(
  commitValue: string,
  input: {
    readonly rootEnvelope: JudgeDemoEnvelope;
    readonly activeEnvelope: JudgeDemoEnvelope;
  }
): Promise<JudgeDemoEnvelope> {
  if (commitValue === input.rootEnvelope.buildCommit) return input.rootEnvelope;
  if (commitValue === input.activeEnvelope.buildCommit) return input.activeEnvelope;
  return createJudgeDemoEnvelope(commitValue);
}

export async function verifyJudgeDemoPresentationBinding(input: {
  readonly value: unknown;
  readonly rootEnvelope: JudgeDemoEnvelope;
  readonly activeEnvelope: JudgeDemoEnvelope;
  readonly rootReceiptDigest: string;
  readonly rootArtifactDigest: string;
  readonly rootStoredProjectionDigest: string;
  readonly rootCapturedAt: string;
}): Promise<JudgeDemoPresentationBinding> {
  const parsed = judgeDemoPresentationBindingSchema.parse(input.value);
  const transitions: JudgeDemoPresentationTransition[] = [];
  for (const transition of parsed.transitions) {
    transitions.push(await verifyJudgeDemoPresentationTransition(transition));
  }
  const rootProjectionHash = await judgeDemoImmutableProjectionHash(input.rootEnvelope);
  const activeProjectionHash = await judgeDemoImmutableProjectionHash(input.activeEnvelope);
  const { bindingHash, lineageHash, ...payload } = parsed;
  const expectedLineageHash = await canonicalSha256(payload);
  if (
    parsed.rootEvidenceCommit === parsed.activeCommit ||
    parsed.rootEvidenceCommit !== input.rootEnvelope.buildCommit ||
    parsed.activeCommit !== input.activeEnvelope.buildCommit ||
    parsed.rootEnvelopeHash !== input.rootEnvelope.envelopeHash ||
    parsed.activeEnvelopeHash !== input.activeEnvelope.envelopeHash ||
    parsed.rootReceiptDigest !== input.rootReceiptDigest ||
    parsed.rootArtifactDigest !== input.rootArtifactDigest ||
    parsed.rootStoredProjectionDigest !== input.rootStoredProjectionDigest ||
    parsed.rootCapturedAt !== input.rootCapturedAt ||
    rootProjectionHash !== activeProjectionHash ||
    parsed.immutableProjectionHash !== rootProjectionHash ||
    transitions[0]?.kind !== "sealed-reader-compatibility-recovery" ||
    (transitions.length === 2 && transitions[1]?.kind !== "collateral-links") ||
    expectedLineageHash !== lineageHash ||
    bindingHash !== lineageHash
  ) {
    throw new Error("judge_demo_presentation_lineage_invalid");
  }

  let priorCommit = parsed.rootEvidenceCommit;
  for (const [ordinal, transition] of transitions.entries()) {
    const [predecessorEnvelope, successorEnvelope] = await Promise.all([
      envelopeFor(transition.predecessorCommit, input),
      envelopeFor(transition.successorCommit, input)
    ]);
    const [predecessorProjectionHash, successorProjectionHash] = await Promise.all([
      judgeDemoImmutableProjectionHash(predecessorEnvelope),
      judgeDemoImmutableProjectionHash(successorEnvelope)
    ]);
    if (
      transition.ordinal !== ordinal ||
      transition.predecessorCommit !== priorCommit ||
      transition.predecessorEnvelopeHash !== predecessorEnvelope.envelopeHash ||
      transition.successorEnvelopeHash !== successorEnvelope.envelopeHash ||
      transition.rootEvidenceCommit !== parsed.rootEvidenceCommit ||
      transition.rootEnvelopeHash !== parsed.rootEnvelopeHash ||
      transition.rootReceiptDigest !== parsed.rootReceiptDigest ||
      transition.rootArtifactDigest !== parsed.rootArtifactDigest ||
      transition.rootStoredProjectionDigest !== parsed.rootStoredProjectionDigest ||
      transition.rootCapturedAt !== parsed.rootCapturedAt ||
      transition.immutableProjectionHash !== parsed.immutableProjectionHash ||
      predecessorProjectionHash !== parsed.immutableProjectionHash ||
      successorProjectionHash !== parsed.immutableProjectionHash
    ) {
      throw new Error("judge_demo_presentation_transition_continuity_invalid");
    }
    priorCommit = transition.successorCommit;
  }
  if (priorCommit !== parsed.activeCommit) {
    throw new Error("judge_demo_presentation_transition_terminal_invalid");
  }

  return Object.freeze(
    JSON.parse(canonicalJson({ ...parsed, transitions })) as JudgeDemoPresentationBinding
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
  readonly rootEnvelope: JudgeDemoEnvelope;
  readonly activeEnvelope: JudgeDemoEnvelope;
  readonly rootReceiptDigest: string;
  readonly rootArtifactDigest: string;
  readonly rootStoredProjectionDigest: string;
  readonly rootCapturedAt: string;
}): Promise<JudgeDemoPresentationBinding> {
  const encoded = input.environment[JUDGE_DEMO_PRESENTATION_BINDING_ENV]?.trim() ?? "";
  const expectedHash = input.environment[JUDGE_DEMO_PRESENTATION_BINDING_HASH_ENV]?.trim() ?? "";
  const binding = await verifyJudgeDemoPresentationBinding({
    value: await decodeJudgeDemoPresentationBinding(encoded),
    rootEnvelope: input.rootEnvelope,
    activeEnvelope: input.activeEnvelope,
    rootReceiptDigest: input.rootReceiptDigest,
    rootArtifactDigest: input.rootArtifactDigest,
    rootStoredProjectionDigest: input.rootStoredProjectionDigest,
    rootCapturedAt: input.rootCapturedAt
  });
  if (binding.bindingHash !== expectedHash) {
    throw new Error("judge_demo_presentation_binding_root_mismatch");
  }
  return binding;
}

export function publicJudgeDemoPresentationBinding(binding: JudgeDemoPresentationBinding) {
  return Object.freeze({
    version: JUDGE_DEMO_PUBLIC_PRESENTATION_BINDING_VERSION,
    rootEvidenceCommit: binding.rootEvidenceCommit,
    activeCommit: binding.activeCommit,
    rootEnvelopeHash: binding.rootEnvelopeHash,
    activeEnvelopeHash: binding.activeEnvelopeHash,
    rootReceiptDigest: binding.rootReceiptDigest,
    rootArtifactDigest: binding.rootArtifactDigest,
    rootStoredProjectionDigest: binding.rootStoredProjectionDigest,
    rootCapturedAt: binding.rootCapturedAt,
    immutableProjectionHash: binding.immutableProjectionHash,
    transitions: binding.transitions.map((transition) =>
      Object.freeze({
        kind: transition.kind,
        ordinal: transition.ordinal,
        predecessorCommit: transition.predecessorCommit,
        successorCommit: transition.successorCommit,
        predecessorEnvelopeHash: transition.predecessorEnvelopeHash,
        successorEnvelopeHash: transition.successorEnvelopeHash,
        firstParentChainHash: transition.firstParentChainHash,
        gitTreeProjectionHash: transition.gitTreeProjectionHash,
        criticalProjectionHash: transition.criticalProjectionHash,
        dependencyProjectionHash: transition.dependencyProjectionHash,
        proofHash: transition.proofHash,
        providerCallsPerformed: 0 as const,
        storeWritesPerformed: 0 as const,
        replayOnly: true as const
      })
    ),
    gitProofPackSha256: binding.gitProofPackSha256,
    lineageHash: binding.lineageHash,
    bindingHash: binding.bindingHash,
    providerCallsPerformed: 0 as const,
    storeWritesPerformed: 0 as const,
    replayOnly: true as const
  });
}
