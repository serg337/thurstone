import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { canonicalSha256 } from "@/lib/evidence/digest";
import { signProbeArtifact, verifyProbeArtifact } from "@/lib/probe/server-artifact";
import { decodeProbeSigningSecret } from "@/lib/probe/signing-secret";
import type { ScoredSessionClaims } from "@/lib/scored/session.server";
import { z } from "zod";

export const SCORED_AUTHORIZATION_VERSION = "toolproof-scored-authorization@1.0.0";
export const SCORED_AUTHORIZATION_TTL_SECONDS = 20 * 60;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

export const scoredAuthorizationClaimsSchema = z
  .object({
    version: z.literal(SCORED_AUTHORIZATION_VERSION),
    phase: z.enum(["baseline", "revised"]),
    appCommit: z.string().regex(/^[a-f0-9]{40}$/u),
    reviewPackageHash: sha256,
    frozenProtocolHash: sha256,
    freezeCandidateHash: sha256,
    phaseCallOffset: z.number().int().min(0).max(46),
    predecessorProtocolHash: sha256.nullable(),
    predecessorEvidenceDigest: sha256.nullable(),
    predecessorRunId: z
      .string()
      .regex(/^run_[A-Za-z0-9_-]{22}$/u)
      .nullable(),
    runId: z.string().regex(/^run_[A-Za-z0-9_-]{22}$/u),
    runnerCaseId: z.string().regex(/^case_[A-Za-z0-9_-]{22}$/u),
    trialId: z.string().regex(/^trial_[A-Za-z0-9_-]{22}$/u),
    ordinal: z.number().int().min(0).max(23),
    attempt: z.union([z.literal(0), z.literal(1)]),
    jti: z.string().regex(/^jti_scored_[A-Za-z0-9_-]{22}$/u),
    subjectHash: sha256,
    envelopeHash: sha256,
    actorHash: sha256,
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive()
  })
  .strict();

export type ScoredAuthorizationClaims = z.infer<typeof scoredAuthorizationClaimsSchema>;

export interface ScoredAuthorization {
  readonly token: string;
  readonly claims: ScoredAuthorizationClaims;
  readonly claimsHash: string;
}

export class ScoredAuthorizationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ScoredAuthorizationError";
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function key(secret: string): Buffer {
  try {
    return decodeProbeSigningSecret(secret);
  } catch {
    throw new ScoredAuthorizationError("weak_signing_secret");
  }
}

function deterministicJti(input: {
  readonly session: ScoredSessionClaims;
  readonly runnerCaseId: string;
  readonly ordinal: number;
  readonly attempt: 0 | 1;
  readonly secret: string;
}): string {
  return `jti_scored_${createHmac("sha256", key(input.secret))
    .update(
      `toolproof.scored.jti.v1.${input.session.frozenProtocolHash}.${input.session.phase}.${input.session.runId}.${input.runnerCaseId}.${input.ordinal}.${input.attempt}`
    )
    .digest("base64url")
    .slice(0, 22)}`;
}

export async function deriveScoredAuthorizationIdentity(input: {
  readonly session: ScoredSessionClaims;
  readonly runnerCaseId: string;
  readonly ordinal: number;
  readonly attempt: 0 | 1;
  readonly signingSecret: string;
}): Promise<{ readonly jti: string; readonly subjectHash: string }> {
  const subjectHash = await canonicalSha256({
    version: SCORED_AUTHORIZATION_VERSION,
    frozenProtocolHash: input.session.frozenProtocolHash,
    phase: input.session.phase,
    runId: input.session.runId,
    ordinal: input.ordinal,
    attempt: input.attempt,
    runnerCaseId: input.runnerCaseId
  });
  return Object.freeze({
    jti: deterministicJti({
      session: input.session,
      runnerCaseId: input.runnerCaseId,
      ordinal: input.ordinal,
      attempt: input.attempt,
      secret: input.signingSecret
    }),
    subjectHash
  });
}

export async function issueScoredAuthorization(input: {
  readonly session: ScoredSessionClaims;
  readonly runnerCaseId: string;
  readonly trialId: string;
  readonly ordinal: number;
  readonly attempt: 0 | 1;
  readonly envelopeHash: string;
  readonly signingSecret: string;
  readonly nowMs?: number;
}): Promise<ScoredAuthorization> {
  const issuedAt = Math.floor((input.nowMs ?? Date.now()) / 1_000);
  const identity = await deriveScoredAuthorizationIdentity({
    session: input.session,
    runnerCaseId: input.runnerCaseId,
    ordinal: input.ordinal,
    attempt: input.attempt,
    signingSecret: input.signingSecret
  });
  const claims = scoredAuthorizationClaimsSchema.parse({
    version: SCORED_AUTHORIZATION_VERSION,
    phase: input.session.phase,
    appCommit: input.session.appCommit,
    reviewPackageHash: input.session.reviewPackageHash,
    frozenProtocolHash: input.session.frozenProtocolHash,
    freezeCandidateHash: input.session.freezeCandidateHash,
    phaseCallOffset: input.session.phaseCallOffset,
    predecessorProtocolHash: input.session.predecessorProtocolHash,
    predecessorEvidenceDigest: input.session.predecessorEvidenceDigest,
    predecessorRunId: input.session.predecessorRunId,
    runId: input.session.runId,
    runnerCaseId: input.runnerCaseId,
    trialId: input.trialId,
    ordinal: input.ordinal,
    attempt: input.attempt,
    jti: identity.jti,
    subjectHash: identity.subjectHash,
    envelopeHash: input.envelopeHash,
    actorHash: input.session.actorHash,
    issuedAt,
    expiresAt: issuedAt + SCORED_AUTHORIZATION_TTL_SECONDS
  });
  const claimsHash = await canonicalSha256(claims);
  return Object.freeze({
    token: signProbeArtifact("scored_authorization", claims, input.signingSecret),
    claims,
    claimsHash
  });
}

export async function verifyScoredAuthorization(input: {
  readonly token: string;
  readonly expected: Omit<
    ScoredAuthorizationClaims,
    "issuedAt" | "expiresAt" | "jti" | "subjectHash"
  >;
  readonly signingSecret: string;
  readonly nowMs?: number;
}): Promise<ScoredAuthorization> {
  let claims: ScoredAuthorizationClaims;
  try {
    claims = scoredAuthorizationClaimsSchema.parse(
      verifyProbeArtifact("scored_authorization", input.token, input.signingSecret)
    );
  } catch {
    throw new ScoredAuthorizationError("invalid_scored_authorization");
  }
  const now = Math.floor((input.nowMs ?? Date.now()) / 1_000);
  if (
    claims.issuedAt > now + 5 ||
    claims.expiresAt <= now ||
    claims.expiresAt - claims.issuedAt !== SCORED_AUTHORIZATION_TTL_SECONDS
  ) {
    throw new ScoredAuthorizationError("scored_authorization_expired");
  }
  for (const [keyName, expected] of Object.entries(input.expected)) {
    const actual = claims[keyName as keyof ScoredAuthorizationClaims];
    if (
      (typeof expected === "string" &&
        (typeof actual !== "string" || !safeEqual(actual, expected))) ||
      (typeof expected === "number" && actual !== expected)
    ) {
      throw new ScoredAuthorizationError("scored_authorization_binding_mismatch");
    }
  }
  return Object.freeze({
    token: input.token,
    claims,
    claimsHash: await canonicalSha256(claims)
  });
}
