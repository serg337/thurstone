import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { signProbeArtifact, verifyProbeArtifact } from "@/lib/probe/server-artifact";
import { z } from "zod";

export const SCORED_SESSION_COOKIE = "toolproof_scored_session";
export const SCORED_RECOVERY_COOKIE = "toolproof_scored_recovery";
export const SCORED_RESULTS_COOKIE = "toolproof_scored_results";
export const SCORED_SESSION_VERSION = "toolproof-scored-session@1.0.0";
export const SCORED_RECOVERY_VERSION = "toolproof-scored-recovery@1.0.0";
export const SCORED_SESSION_TTL_SECONDS = 20 * 60;
export const SCORED_RECOVERY_TTL_SECONDS = 4 * 60 * 60;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const gitCommit = z.string().regex(/^[a-f0-9]{40}$/u);
const opaque = z.string().regex(/^[A-Za-z0-9_-]{16,96}$/u);

export const scoredSessionClaimsSchema = z
  .object({
    version: z.literal(SCORED_SESSION_VERSION),
    phase: z.enum(["baseline", "revised"]),
    appCommit: gitCommit,
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
    sessionId: opaque,
    runId: z.string().regex(/^run_[A-Za-z0-9_-]{22}$/u),
    actorHash: sha256,
    csrfHash: sha256,
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive()
  })
  .strict();

export type ScoredSessionClaims = z.infer<typeof scoredSessionClaimsSchema>;

export const scoredRecoveryClaimsSchema = z
  .object({
    version: z.literal(SCORED_RECOVERY_VERSION),
    phase: z.enum(["baseline", "revised"]),
    appCommit: gitCommit,
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
    launchHash: sha256,
    recoveryId: opaque,
    sessionId: opaque,
    runId: z.string().regex(/^run_[A-Za-z0-9_-]{22}$/u),
    actorHash: sha256,
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive()
  })
  .strict();

export type ScoredRecoveryClaims = z.infer<typeof scoredRecoveryClaimsSchema>;

export interface ScoredSessionIssue {
  readonly cookieValue: string;
  readonly csrfToken: string;
  readonly claims: ScoredSessionClaims;
}

export interface ScoredRecoveryIssue {
  readonly cookieValue: string;
  readonly claims: ScoredRecoveryClaims;
}

export class ScoredSessionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ScoredSessionError";
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

interface FrozenSessionBinding {
  readonly phase: "baseline" | "revised";
  readonly appCommit: string;
  readonly reviewPackageHash: string;
  readonly frozenProtocolHash: string;
  readonly freezeCandidateHash: string;
  readonly phaseCallOffset: number;
  readonly predecessorProtocolHash: string | null;
  readonly predecessorEvidenceDigest: string | null;
  readonly predecessorRunId: string | null;
  readonly actorHash: string;
}

function bindingMatches(
  claims: Pick<
    ScoredSessionClaims | ScoredRecoveryClaims,
    | "phase"
    | "appCommit"
    | "reviewPackageHash"
    | "frozenProtocolHash"
    | "freezeCandidateHash"
    | "phaseCallOffset"
    | "predecessorProtocolHash"
    | "predecessorEvidenceDigest"
    | "predecessorRunId"
    | "actorHash"
  >,
  binding: FrozenSessionBinding
): boolean {
  return (
    claims.phase === binding.phase &&
    safeEqual(claims.appCommit, binding.appCommit) &&
    safeEqual(claims.reviewPackageHash, binding.reviewPackageHash) &&
    safeEqual(claims.frozenProtocolHash, binding.frozenProtocolHash) &&
    safeEqual(claims.freezeCandidateHash, binding.freezeCandidateHash) &&
    claims.phaseCallOffset === binding.phaseCallOffset &&
    ((claims.predecessorProtocolHash === null && binding.predecessorProtocolHash === null) ||
      (typeof claims.predecessorProtocolHash === "string" &&
        typeof binding.predecessorProtocolHash === "string" &&
        safeEqual(claims.predecessorProtocolHash, binding.predecessorProtocolHash))) &&
    ((claims.predecessorEvidenceDigest === null && binding.predecessorEvidenceDigest === null) ||
      (typeof claims.predecessorEvidenceDigest === "string" &&
        typeof binding.predecessorEvidenceDigest === "string" &&
        safeEqual(claims.predecessorEvidenceDigest, binding.predecessorEvidenceDigest))) &&
    ((claims.predecessorRunId === null && binding.predecessorRunId === null) ||
      (typeof claims.predecessorRunId === "string" &&
        typeof binding.predecessorRunId === "string" &&
        safeEqual(claims.predecessorRunId, binding.predecessorRunId))) &&
    safeEqual(claims.actorHash, binding.actorHash)
  );
}

export function issueScoredSession(
  input: FrozenSessionBinding & {
    readonly signingSecret: string;
    readonly nowMs?: number;
    readonly sessionId?: string;
    readonly runId?: string;
  }
): ScoredSessionIssue {
  const issuedAt = Math.floor((input.nowMs ?? Date.now()) / 1_000);
  const csrfToken = randomBytes(32).toString("base64url");
  const claims = scoredSessionClaimsSchema.parse({
    version: SCORED_SESSION_VERSION,
    phase: input.phase,
    appCommit: input.appCommit,
    reviewPackageHash: input.reviewPackageHash,
    frozenProtocolHash: input.frozenProtocolHash,
    freezeCandidateHash: input.freezeCandidateHash,
    phaseCallOffset: input.phaseCallOffset,
    predecessorProtocolHash: input.predecessorProtocolHash,
    predecessorEvidenceDigest: input.predecessorEvidenceDigest,
    predecessorRunId: input.predecessorRunId,
    sessionId: input.sessionId ?? `session_${randomBytes(16).toString("base64url")}`,
    runId: input.runId ?? `run_${randomBytes(16).toString("base64url")}`,
    actorHash: input.actorHash,
    csrfHash: sha256Hex(csrfToken),
    issuedAt,
    expiresAt: issuedAt + SCORED_SESSION_TTL_SECONDS
  });
  return Object.freeze({
    cookieValue: signProbeArtifact("scored_session", claims, input.signingSecret),
    csrfToken,
    claims
  });
}

export function issueScoredRecovery(input: {
  readonly session: ScoredSessionClaims;
  readonly launchHash: string;
  readonly signingSecret: string;
}): ScoredRecoveryIssue {
  const claims = scoredRecoveryClaimsSchema.parse({
    version: SCORED_RECOVERY_VERSION,
    phase: input.session.phase,
    appCommit: input.session.appCommit,
    reviewPackageHash: input.session.reviewPackageHash,
    frozenProtocolHash: input.session.frozenProtocolHash,
    freezeCandidateHash: input.session.freezeCandidateHash,
    phaseCallOffset: input.session.phaseCallOffset,
    predecessorProtocolHash: input.session.predecessorProtocolHash,
    predecessorEvidenceDigest: input.session.predecessorEvidenceDigest,
    predecessorRunId: input.session.predecessorRunId,
    launchHash: input.launchHash,
    recoveryId: `recovery_${randomBytes(16).toString("base64url")}`,
    sessionId: input.session.sessionId,
    runId: input.session.runId,
    actorHash: input.session.actorHash,
    issuedAt: input.session.issuedAt,
    expiresAt: input.session.issuedAt + SCORED_RECOVERY_TTL_SECONDS
  });
  return Object.freeze({
    cookieValue: signProbeArtifact("scored_recovery", claims, input.signingSecret),
    claims
  });
}

export function verifyScoredSession(
  input: FrozenSessionBinding & {
    readonly cookieValue: string;
    readonly signingSecret: string;
    readonly csrfToken?: string;
    readonly nowMs?: number;
  }
): ScoredSessionClaims {
  let claims: ScoredSessionClaims;
  try {
    claims = scoredSessionClaimsSchema.parse(
      verifyProbeArtifact("scored_session", input.cookieValue, input.signingSecret)
    );
  } catch {
    throw new ScoredSessionError("invalid_scored_session");
  }
  const now = Math.floor((input.nowMs ?? Date.now()) / 1_000);
  if (
    claims.issuedAt > now + 5 ||
    claims.expiresAt <= now ||
    claims.expiresAt <= claims.issuedAt ||
    claims.expiresAt - claims.issuedAt > SCORED_SESSION_TTL_SECONDS ||
    !bindingMatches(claims, input) ||
    (input.csrfToken !== undefined && !safeEqual(claims.csrfHash, sha256Hex(input.csrfToken)))
  ) {
    throw new ScoredSessionError("scored_session_binding_mismatch");
  }
  return claims;
}

export function verifyScoredRecovery(
  input: FrozenSessionBinding & {
    readonly cookieValue: string;
    readonly signingSecret: string;
    readonly nowMs?: number;
  }
): ScoredRecoveryClaims {
  let claims: ScoredRecoveryClaims;
  try {
    claims = scoredRecoveryClaimsSchema.parse(
      verifyProbeArtifact("scored_recovery", input.cookieValue, input.signingSecret)
    );
  } catch {
    throw new ScoredSessionError("invalid_scored_recovery");
  }
  const now = Math.floor((input.nowMs ?? Date.now()) / 1_000);
  if (
    claims.issuedAt > now + 5 ||
    claims.expiresAt <= now ||
    claims.expiresAt - claims.issuedAt !== SCORED_RECOVERY_TTL_SECONDS ||
    !bindingMatches(claims, input)
  ) {
    throw new ScoredSessionError("scored_recovery_binding_mismatch");
  }
  return claims;
}

export function issueRecoveredScoredSession(input: {
  readonly recovery: ScoredRecoveryClaims;
  readonly signingSecret: string;
  readonly nowMs?: number;
}): ScoredSessionIssue {
  const issuedAt = Math.floor((input.nowMs ?? Date.now()) / 1_000);
  if (issuedAt >= input.recovery.expiresAt) {
    throw new ScoredSessionError("scored_recovery_window_expired");
  }
  const csrfToken = randomBytes(32).toString("base64url");
  const claims = scoredSessionClaimsSchema.parse({
    version: SCORED_SESSION_VERSION,
    phase: input.recovery.phase,
    appCommit: input.recovery.appCommit,
    reviewPackageHash: input.recovery.reviewPackageHash,
    frozenProtocolHash: input.recovery.frozenProtocolHash,
    freezeCandidateHash: input.recovery.freezeCandidateHash,
    phaseCallOffset: input.recovery.phaseCallOffset,
    predecessorProtocolHash: input.recovery.predecessorProtocolHash,
    predecessorEvidenceDigest: input.recovery.predecessorEvidenceDigest,
    predecessorRunId: input.recovery.predecessorRunId,
    sessionId: input.recovery.sessionId,
    runId: input.recovery.runId,
    actorHash: input.recovery.actorHash,
    csrfHash: sha256Hex(csrfToken),
    issuedAt,
    expiresAt: Math.min(issuedAt + SCORED_SESSION_TTL_SECONDS, input.recovery.expiresAt)
  });
  return Object.freeze({
    cookieValue: signProbeArtifact("scored_session", claims, input.signingSecret),
    csrfToken,
    claims
  });
}

export function scoredSessionCookieOptions() {
  return Object.freeze({
    httpOnly: true,
    secure: true,
    sameSite: "strict" as const,
    path: "/",
    maxAge: SCORED_SESSION_TTL_SECONDS
  });
}

export function scoredRecoveryCookieOptions() {
  return Object.freeze({
    httpOnly: true,
    secure: true,
    sameSite: "strict" as const,
    path: "/",
    maxAge: SCORED_RECOVERY_TTL_SECONDS
  });
}
