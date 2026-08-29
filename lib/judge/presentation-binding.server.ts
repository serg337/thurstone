import "server-only";

import { canonicalJson, canonicalSha256 } from "@/lib/evidence/digest";
import {
  JUDGE_DEMO_REBRAND_PREDECESSOR_BINDING_HASH,
  JUDGE_DEMO_REBRAND_PREDECESSOR_COMMIT,
  JUDGE_DEMO_REBRAND_PREDECESSOR_TRANSITION_PROOF_HASH,
  judgeDemoImmutableProjectionHash,
  verifyJudgeDemoPresentationTransition,
  type JudgeDemoPresentationTransition
} from "@/lib/judge/collateral-proof";
import { createJudgeDemoEnvelope, type JudgeDemoEnvelope } from "@/lib/judge/envelope";
import {
  GATE6_PRESENTATION_PROOF_ENV,
  decodeGate6PresentationProof
} from "@/lib/results/presentation-proof";
import { gunzipSync } from "node:zlib";
import { z } from "zod";

export const JUDGE_DEMO_PRESENTATION_BINDING_VERSION =
  "toolproof-judge-demo-presentation-lineage@2.0.0";
export const JUDGE_DEMO_PRESENTATION_REBRAND_BINDING_VERSION =
  "toolproof-judge-demo-presentation-lineage@3.0.0";
export const JUDGE_DEMO_PUBLIC_PRESENTATION_BINDING_VERSION =
  "toolproof-judge-demo-public-presentation-lineage@2.0.0";
export const JUDGE_DEMO_PUBLIC_PRESENTATION_REBRAND_BINDING_VERSION =
  "toolproof-judge-demo-public-presentation-lineage@3.0.0";
export const JUDGE_DEMO_PRESENTATION_BINDING_ENV = "TOOLPROOF_JUDGE_PRESENTATION_BINDING_B64";
export const JUDGE_DEMO_PRESENTATION_BINDING_HASH_ENV = "TOOLPROOF_JUDGE_PRESENTATION_BINDING_HASH";
export const JUDGE_DEMO_PRESENTATION_MODE_ENV = "TOOLPROOF_JUDGE_PRESENTATION_MODE";
export const JUDGE_DEMO_GIT_PACK_ENV = "TOOLPROOF_JUDGE_GIT_PACK_B64";
export const JUDGE_DEMO_SHARED_GIT_PACK_ENV = "TOOLPROOF_GATE6_GIT_PACK_B64";
export const JUDGE_DEMO_PRESENTATION_MODES = ["predecessor", "successor"] as const;
export type JudgeDemoPresentationMode = (typeof JUDGE_DEMO_PRESENTATION_MODES)[number];

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const commit = z.string().regex(/^[a-f0-9]{40}$/u);

const bindingShape = {
  rootEvidenceCommit: commit,
  activeCommit: commit,
  rootEnvelopeHash: sha256,
  activeEnvelopeHash: sha256,
  rootReceiptDigest: sha256,
  rootArtifactDigest: sha256,
  rootStoredProjectionDigest: sha256,
  rootCapturedAt: z.string().datetime({ offset: true }),
  immutableProjectionHash: sha256,
  gitProofPackSha256: sha256,
  providerCallsPerformed: z.literal(0),
  storeWritesPerformed: z.literal(0),
  replayOnly: z.literal(true),
  lineageHash: sha256,
  bindingHash: sha256
} as const;

const legacyBindingSchema = z
  .object({
    ...bindingShape,
    version: z.literal(JUDGE_DEMO_PRESENTATION_BINDING_VERSION),
    transitions: z.array(z.unknown()).min(1).max(2)
  })
  .strict();

const rebrandBindingSchema = z
  .object({
    ...bindingShape,
    version: z.literal(JUDGE_DEMO_PRESENTATION_REBRAND_BINDING_VERSION),
    transitions: z.array(z.unknown()).min(2).max(3)
  })
  .strict();

export const judgeDemoPresentationBindingSchema = z.discriminatedUnion("version", [
  legacyBindingSchema,
  rebrandBindingSchema
]);

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
  const legacyKindsValid =
    parsed.version === JUDGE_DEMO_PRESENTATION_BINDING_VERSION &&
    transitions[0]?.kind === "sealed-reader-compatibility-recovery" &&
    (transitions.length === 1 || transitions[1]?.kind === "collateral-links");
  const rebrandKindsValid =
    parsed.version === JUDGE_DEMO_PRESENTATION_REBRAND_BINDING_VERSION &&
    transitions[0]?.kind === "sealed-reader-compatibility-recovery" &&
    transitions[0].successorCommit === JUDGE_DEMO_REBRAND_PREDECESSOR_COMMIT &&
    transitions[0].proofHash === JUDGE_DEMO_REBRAND_PREDECESSOR_TRANSITION_PROOF_HASH &&
    transitions[1]?.kind === "presentation-rebrand" &&
    transitions[1].predecessorBinding.bindingHash === JUDGE_DEMO_REBRAND_PREDECESSOR_BINDING_HASH &&
    (transitions.length === 2 || transitions[2]?.kind === "collateral-links");
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
    (!legacyKindsValid && !rebrandKindsValid) ||
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
  if (binding.version === JUDGE_DEMO_PRESENTATION_REBRAND_BINDING_VERSION) {
    const rebrand = binding.transitions[1];
    if (rebrand?.kind !== "presentation-rebrand") {
      throw new Error("judge_demo_presentation_rebrand_binding_missing");
    }
    const gate6Proof = await decodeGate6PresentationProof(
      input.environment[GATE6_PRESENTATION_PROOF_ENV]?.trim() ?? ""
    );
    const terminalAtRebrand = binding.transitions.length === 2;
    if (
      input.environment.TOOLPROOF_GATE6_PRESENTATION_PROOF_HASH?.trim() !== gate6Proof.proofHash ||
      gate6Proof.presentationCommit !== binding.activeCommit ||
      gate6Proof.criticalProjectionHash !== rebrand.gate6CriticalProjectionHash ||
      gate6Proof.dependencyProjectionHash !== rebrand.dependencyProjectionHash ||
      gate6Proof.baselineRawSha256 !== rebrand.baselineRawSha256 ||
      gate6Proof.revisedRawSha256 !== rebrand.revisedRawSha256 ||
      (terminalAtRebrand && gate6Proof.proofHash !== rebrand.gate6PresentationProofHash)
    ) {
      throw new Error("judge_demo_presentation_rebrand_gate6_mismatch");
    }
  }
  return binding;
}

export function publicJudgeDemoPresentationBinding(binding: JudgeDemoPresentationBinding) {
  return Object.freeze({
    version:
      binding.version === JUDGE_DEMO_PRESENTATION_REBRAND_BINDING_VERSION
        ? JUDGE_DEMO_PUBLIC_PRESENTATION_REBRAND_BINDING_VERSION
        : JUDGE_DEMO_PUBLIC_PRESENTATION_BINDING_VERSION,
    rootEvidenceCommit: binding.rootEvidenceCommit,
    activeCommit: binding.activeCommit,
    rootEnvelopeHash: binding.rootEnvelopeHash,
    activeEnvelopeHash: binding.activeEnvelopeHash,
    rootReceiptDigest: binding.rootReceiptDigest,
    rootArtifactDigest: binding.rootArtifactDigest,
    rootStoredProjectionDigest: binding.rootStoredProjectionDigest,
    rootCapturedAt: binding.rootCapturedAt,
    immutableProjectionHash: binding.immutableProjectionHash,
    transitions: binding.transitions.map((transition) => {
      const common = {
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
      };
      if (transition.kind === "sealed-reader-compatibility-recovery") {
        return Object.freeze({
          ...common,
          ciTimeoutValidation: transition.recoveryContract.ciTimeoutValidation ?? null
        });
      }
      if (transition.kind === "presentation-rebrand") {
        return Object.freeze({
          ...common,
          ciTimeoutValidation: null,
          rebrandVerification: Object.freeze({
            productNameBefore: transition.branding.productNameBefore,
            productNameAfter: transition.branding.productNameAfter,
            adoptedAt: transition.branding.adoptedAt,
            legacyProtocolNamespace: transition.branding.legacyProtocolNamespace,
            predecessorBindingHash: transition.predecessorBinding.bindingHash,
            predecessorBindingArtifactSha256: transition.predecessorBinding.reviewedArtifactSha256,
            protocolExtensionCommit: transition.protocolExtension.commit,
            protocolProjectionHash: transition.protocolExtension.gitTreeProjectionHash,
            brandingProjectionHash: transition.branding.filesProjectionHash,
            preservedArtifactsHash: transition.preservedArtifactsHash,
            gate6PresentationProofHash: transition.gate6PresentationProofHash,
            gate6CriticalProjectionHash: transition.gate6CriticalProjectionHash,
            scoredCallsPerformed: 0 as const
          })
        });
      }
      return Object.freeze({ ...common, ciTimeoutValidation: null });
    }),
    gitProofPackSha256: binding.gitProofPackSha256,
    lineageHash: binding.lineageHash,
    bindingHash: binding.bindingHash,
    providerCallsPerformed: 0 as const,
    storeWritesPerformed: 0 as const,
    replayOnly: true as const
  });
}
