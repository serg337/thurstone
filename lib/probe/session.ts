import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { decodeProbeSigningSecret } from "@/lib/probe/signing-secret";
import { signProbeArtifact, verifyProbeArtifact } from "@/lib/probe/server-artifact";
import { z } from "zod";

export const PROBE_SESSION_COOKIE = "toolproof_probe_session";
export const PROBE_RESULTS_COOKIE = "toolproof_probe_results";
export const PROBE_RECOVERY_COOKIE = "toolproof_probe_recovery";
export const PROBE_OPERATOR_COOKIE = "toolproof_probe_operator";
export const PROBE_SESSION_VERSION = 1;
export const PROBE_SESSION_TTL_SECONDS = 20 * 60;
export const PROBE_RECOVERY_VERSION = 1;
export const PROBE_RECOVERY_TTL_SECONDS = 4 * 60 * 60;
export const PROBE_OPERATOR_VERSION = 1;
export const PROBE_OPERATOR_TTL_SECONDS = PROBE_RECOVERY_TTL_SECONDS + 30 * 60;
export const PROBE_OPERATOR_LAUNCH_RETRY_MARGIN_SECONDS = 5 * 60;

const opaqueId = z.string().regex(/^[A-Za-z0-9_-]{16,96}$/u);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const gitSha = z.string().regex(/^[a-f0-9]{40}$/u);

export const probeSessionClaimsSchema = z
  .object({
    version: z.literal(PROBE_SESSION_VERSION),
    purpose: z.literal("calibration"),
    activationHash: sha256,
    buildCommit: gitSha,
    sessionId: opaqueId,
    runId: opaqueId,
    csrfHash: sha256,
    actorHash: sha256,
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive()
  })
  .strict();

export type ProbeSessionClaims = z.infer<typeof probeSessionClaimsSchema>;

export const probeRecoveryClaimsSchema = z
  .object({
    version: z.literal(PROBE_RECOVERY_VERSION),
    purpose: z.literal("calibration"),
    activationHash: sha256,
    buildCommit: gitSha,
    launchHash: sha256,
    recoveryId: opaqueId,
    sessionId: opaqueId,
    runId: opaqueId,
    actorHash: sha256,
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive()
  })
  .strict();

export type ProbeRecoveryClaims = z.infer<typeof probeRecoveryClaimsSchema>;

export const probeOperatorClaimsSchema = z
  .object({
    version: z.literal(PROBE_OPERATOR_VERSION),
    activationHash: sha256,
    buildCommit: gitSha,
    actorHash: sha256,
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive()
  })
  .strict();

export type ProbeOperatorClaims = z.infer<typeof probeOperatorClaimsSchema>;

export interface ProbeSessionIssue {
  readonly cookieValue: string;
  readonly csrfToken: string;
  readonly claims: ProbeSessionClaims;
}

export interface ProbeRecoveryIssue {
  readonly cookieValue: string;
  readonly claims: ProbeRecoveryClaims;
}

export class ProbeSessionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProbeSessionError";
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

export function deriveProbeActorHash(request: Request, signingSecret: string): string {
  let key: Buffer;
  try {
    key = decodeProbeSigningSecret(signingSecret);
  } catch {
    throw new ProbeSessionError("weak_signing_secret");
  }
  const forwarded = request.headers.get("x-vercel-forwarded-for") ?? "";
  const remoteAddress = (forwarded.split(",")[0] ?? "").trim().slice(0, 128);
  const userAgent = (request.headers.get("user-agent") ?? "unknown").trim().slice(0, 512);
  return createHmac("sha256", key)
    .update(`toolproof.probe.actor.v1\n${remoteAddress || "unknown"}\n${userAgent}`)
    .digest("hex");
}

export function deriveProbeLaunchHash(launchId: string, signingSecret: string): string {
  if (!/^launch_[A-Za-z0-9_-]{22,64}$/u.test(launchId)) {
    throw new ProbeSessionError("invalid_launch_id");
  }
  let key: Buffer;
  try {
    key = decodeProbeSigningSecret(signingSecret);
  } catch {
    throw new ProbeSessionError("weak_signing_secret");
  }
  return createHmac("sha256", key).update(`toolproof.probe.launch.v1.${launchId}`).digest("hex");
}

export function issueProbeSession(input: {
  readonly activationHash: string;
  readonly buildCommit: string;
  readonly actorHash: string;
  readonly signingSecret: string;
  readonly nowMs?: number;
}): ProbeSessionIssue {
  const issuedAt = Math.floor((input.nowMs ?? Date.now()) / 1_000);
  const csrfToken = randomBytes(32).toString("base64url");
  const claims = probeSessionClaimsSchema.parse({
    version: PROBE_SESSION_VERSION,
    purpose: "calibration",
    activationHash: input.activationHash,
    buildCommit: input.buildCommit,
    sessionId: `session_${randomBytes(16).toString("base64url")}`,
    runId: `run_${randomBytes(16).toString("base64url")}`,
    csrfHash: sha256Hex(csrfToken),
    actorHash: input.actorHash,
    issuedAt,
    expiresAt: issuedAt + PROBE_SESSION_TTL_SECONDS
  });
  return Object.freeze({
    cookieValue: signProbeArtifact("session", claims, input.signingSecret),
    csrfToken,
    claims
  });
}

export function issueProbeRecoveryCredential(input: {
  readonly session: ProbeSessionClaims;
  readonly launchHash: string;
  readonly signingSecret: string;
}): ProbeRecoveryIssue {
  const claims = probeRecoveryClaimsSchema.parse({
    version: PROBE_RECOVERY_VERSION,
    purpose: "calibration",
    activationHash: input.session.activationHash,
    buildCommit: input.session.buildCommit,
    launchHash: input.launchHash,
    recoveryId: `recovery_${randomBytes(16).toString("base64url")}`,
    sessionId: input.session.sessionId,
    runId: input.session.runId,
    actorHash: input.session.actorHash,
    issuedAt: input.session.issuedAt,
    expiresAt: input.session.issuedAt + PROBE_RECOVERY_TTL_SECONDS
  });
  return Object.freeze({
    cookieValue: signProbeArtifact("recovery_session", claims, input.signingSecret),
    claims
  });
}

export function issueProbeOperatorCredential(input: {
  readonly activationHash: string;
  readonly buildCommit: string;
  readonly actorHash: string;
  readonly signingSecret: string;
  readonly nowMs?: number;
}): { readonly cookieValue: string; readonly claims: ProbeOperatorClaims } {
  const issuedAt = Math.floor((input.nowMs ?? Date.now()) / 1_000);
  const claims = probeOperatorClaimsSchema.parse({
    version: PROBE_OPERATOR_VERSION,
    activationHash: input.activationHash,
    buildCommit: input.buildCommit,
    actorHash: input.actorHash,
    issuedAt,
    expiresAt: issuedAt + PROBE_OPERATOR_TTL_SECONDS
  });
  return Object.freeze({
    cookieValue: signProbeArtifact("operator_session", claims, input.signingSecret),
    claims
  });
}

export function verifyProbeOperatorCredential(input: {
  readonly cookieValue: string;
  readonly signingSecret: string;
  readonly activationHash: string;
  readonly buildCommit: string;
  readonly actorHash: string;
  readonly nowMs?: number;
}): ProbeOperatorClaims {
  let claims: ProbeOperatorClaims;
  try {
    claims = probeOperatorClaimsSchema.parse(
      verifyProbeArtifact("operator_session", input.cookieValue, input.signingSecret)
    );
  } catch {
    throw new ProbeSessionError("invalid_operator_credential");
  }
  const now = Math.floor((input.nowMs ?? Date.now()) / 1_000);
  if (
    claims.issuedAt > now + 5 ||
    claims.expiresAt <= now ||
    claims.expiresAt - claims.issuedAt !== PROBE_OPERATOR_TTL_SECONDS ||
    !safeEqual(claims.activationHash, input.activationHash) ||
    !safeEqual(claims.buildCommit, input.buildCommit) ||
    !safeEqual(claims.actorHash, input.actorHash)
  ) {
    throw new ProbeSessionError("operator_credential_mismatch");
  }
  return claims;
}

export function signExistingProbeRecoveryCredential(
  claims: ProbeRecoveryClaims,
  signingSecret: string
): string {
  return signProbeArtifact(
    "recovery_session",
    probeRecoveryClaimsSchema.parse(claims),
    signingSecret
  );
}

export function verifyProbeRecoveryCredential(input: {
  readonly cookieValue: string;
  readonly signingSecret: string;
  readonly activationHash: string;
  readonly buildCommit: string;
  readonly actorHash?: string;
  readonly nowMs?: number;
}): ProbeRecoveryClaims {
  let claims: ProbeRecoveryClaims;
  try {
    claims = probeRecoveryClaimsSchema.parse(
      verifyProbeArtifact("recovery_session", input.cookieValue, input.signingSecret)
    );
  } catch {
    throw new ProbeSessionError("invalid_recovery_credential");
  }
  const now = Math.floor((input.nowMs ?? Date.now()) / 1_000);
  if (claims.issuedAt > now + 5) {
    throw new ProbeSessionError("recovery_credential_issued_in_future");
  }
  if (
    claims.expiresAt <= now ||
    claims.expiresAt <= claims.issuedAt ||
    claims.expiresAt - claims.issuedAt !== PROBE_RECOVERY_TTL_SECONDS
  ) {
    throw new ProbeSessionError("recovery_credential_expired");
  }
  if (
    !safeEqual(claims.activationHash, input.activationHash) ||
    !safeEqual(claims.buildCommit, input.buildCommit)
  ) {
    throw new ProbeSessionError("recovery_credential_binding_mismatch");
  }
  if (input.actorHash !== undefined && !safeEqual(claims.actorHash, input.actorHash)) {
    throw new ProbeSessionError("recovery_credential_actor_mismatch");
  }
  return claims;
}

export function issueRecoveredProbeSession(input: {
  readonly recovery: ProbeRecoveryClaims;
  readonly signingSecret: string;
  readonly nowMs?: number;
}): ProbeSessionIssue {
  const issuedAt = Math.floor((input.nowMs ?? Date.now()) / 1_000);
  if (issuedAt >= input.recovery.expiresAt) throw new ProbeSessionError("recovery_window_expired");
  const expiresAt = Math.min(issuedAt + PROBE_SESSION_TTL_SECONDS, input.recovery.expiresAt);
  const csrfToken = randomBytes(32).toString("base64url");
  const claims = probeSessionClaimsSchema.parse({
    version: PROBE_SESSION_VERSION,
    purpose: "calibration",
    activationHash: input.recovery.activationHash,
    buildCommit: input.recovery.buildCommit,
    sessionId: input.recovery.sessionId,
    runId: input.recovery.runId,
    csrfHash: sha256Hex(csrfToken),
    actorHash: input.recovery.actorHash,
    issuedAt,
    expiresAt
  });
  return Object.freeze({
    cookieValue: signProbeArtifact("session", claims, input.signingSecret),
    csrfToken,
    claims
  });
}

export function verifyProbeSession(input: {
  readonly cookieValue: string;
  readonly signingSecret: string;
  readonly activationHash: string;
  readonly buildCommit: string;
  readonly actorHash?: string;
  readonly csrfToken?: string;
  readonly nowMs?: number;
}): ProbeSessionClaims {
  let claims: ProbeSessionClaims;
  try {
    claims = probeSessionClaimsSchema.parse(
      verifyProbeArtifact("session", input.cookieValue, input.signingSecret)
    );
  } catch {
    throw new ProbeSessionError("invalid_session");
  }
  const now = Math.floor((input.nowMs ?? Date.now()) / 1_000);
  if (claims.issuedAt > now + 5) throw new ProbeSessionError("session_issued_in_future");
  if (
    claims.expiresAt <= now ||
    claims.expiresAt <= claims.issuedAt ||
    claims.expiresAt - claims.issuedAt > PROBE_SESSION_TTL_SECONDS
  ) {
    throw new ProbeSessionError("session_expired");
  }
  if (
    !safeEqual(claims.activationHash, input.activationHash) ||
    !safeEqual(claims.buildCommit, input.buildCommit)
  ) {
    throw new ProbeSessionError("session_binding_mismatch");
  }
  if (input.actorHash !== undefined && !safeEqual(claims.actorHash, input.actorHash)) {
    throw new ProbeSessionError("session_actor_mismatch");
  }
  if (input.csrfToken !== undefined && !safeEqual(claims.csrfHash, sha256Hex(input.csrfToken))) {
    throw new ProbeSessionError("csrf_mismatch");
  }
  return claims;
}

export function probeSessionCookieOptions() {
  return Object.freeze({
    httpOnly: true,
    secure: true,
    sameSite: "strict" as const,
    path: "/",
    maxAge: PROBE_SESSION_TTL_SECONDS
  });
}

export function probeRecoveryCookieOptions() {
  return Object.freeze({
    httpOnly: true,
    secure: true,
    sameSite: "strict" as const,
    path: "/",
    maxAge: PROBE_RECOVERY_TTL_SECONDS
  });
}

export function probeOperatorCookieOptions() {
  return Object.freeze({
    httpOnly: true,
    secure: true,
    sameSite: "strict" as const,
    path: "/",
    maxAge: PROBE_OPERATOR_TTL_SECONDS
  });
}
