import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { canonicalJson } from "@/lib/evidence/digest";
import {
  PROBE_MODEL,
  PROBE_POLICY_VERSION,
  PROBE_PRODUCTION_ORIGIN,
  PROBE_PURPOSES,
  PROBE_TOKEN_TTL_SECONDS,
  type ProbePurpose
} from "@/lib/probe/policy";
import { decodeProbeSigningSecret } from "@/lib/probe/signing-secret";
import { z } from "zod";

const opaqueId = z.string().regex(/^[A-Za-z0-9_-]{16,96}$/u);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const gitSha = z.string().regex(/^[a-f0-9]{40}$/u);

export const probeTokenClaimsSchema = z
  .object({
    version: z.literal(1),
    policyVersion: z.literal(PROBE_POLICY_VERSION),
    policyHash: sha256,
    guardInstanceId: opaqueId,
    audience: z.literal(PROBE_PRODUCTION_ORIGIN),
    origin: z.literal(PROBE_PRODUCTION_ORIGIN),
    model: z.literal(PROBE_MODEL),
    buildCommit: gitSha,
    activationHash: sha256,
    sessionHash: sha256,
    jti: opaqueId,
    purpose: z.enum(PROBE_PURPOSES),
    runId: opaqueId,
    caseId: opaqueId,
    trialId: opaqueId,
    fixtureHash: sha256,
    requestHash: sha256,
    manifestHash: sha256,
    settingsHash: sha256,
    envelopeHash: sha256,
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive()
  })
  .strict();

export type ProbeTokenClaims = z.infer<typeof probeTokenClaimsSchema>;

export interface CreateProbeTokenInput {
  readonly policyHash: string;
  readonly guardInstanceId: string;
  readonly buildCommit: string;
  readonly activationHash: string;
  readonly sessionHash: string;
  readonly purpose: ProbePurpose;
  readonly runId: string;
  readonly caseId: string;
  readonly trialId: string;
  readonly fixtureHash: string;
  readonly requestHash: string;
  readonly manifestHash: string;
  readonly settingsHash: string;
  readonly envelopeHash: string;
  readonly jti?: string;
  readonly nowMs?: number;
}

export interface SignedProbeToken {
  readonly token: string;
  readonly claims: ProbeTokenClaims;
}

export class ProbeTokenError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProbeTokenError";
  }
}

function signingKey(secret: string): Buffer {
  try {
    return decodeProbeSigningSecret(secret);
  } catch {
    throw new ProbeTokenError("weak_signing_secret");
  }
}

function signatureFor(body: string, secret: string): Buffer {
  return createHmac("sha256", signingKey(secret)).update(`toolproof.probe.v1.${body}`).digest();
}

export function createProbeToken(input: CreateProbeTokenInput, secret: string): SignedProbeToken {
  signingKey(secret);
  const issuedAt = Math.floor((input.nowMs ?? Date.now()) / 1_000);
  const claims = probeTokenClaimsSchema.parse({
    version: 1,
    policyVersion: PROBE_POLICY_VERSION,
    policyHash: input.policyHash,
    guardInstanceId: input.guardInstanceId,
    audience: PROBE_PRODUCTION_ORIGIN,
    origin: PROBE_PRODUCTION_ORIGIN,
    model: PROBE_MODEL,
    buildCommit: input.buildCommit,
    activationHash: input.activationHash,
    sessionHash: input.sessionHash,
    jti: input.jti ?? randomBytes(16).toString("base64url"),
    purpose: input.purpose,
    runId: input.runId,
    caseId: input.caseId,
    trialId: input.trialId,
    fixtureHash: input.fixtureHash,
    requestHash: input.requestHash,
    manifestHash: input.manifestHash,
    settingsHash: input.settingsHash,
    envelopeHash: input.envelopeHash,
    issuedAt,
    expiresAt: issuedAt + PROBE_TOKEN_TTL_SECONDS
  });
  const body = Buffer.from(canonicalJson(claims), "utf8").toString("base64url");
  const signature = signatureFor(body, secret).toString("base64url");

  return { token: `${body}.${signature}`, claims };
}

export function verifyProbeToken(
  token: string,
  secret: string,
  nowMs: number = Date.now()
): ProbeTokenClaims {
  signingKey(secret);
  if (token.length > 8_192) throw new ProbeTokenError("token_too_large");

  const segments = token.split(".");
  if (segments.length !== 2 || !segments[0] || !segments[1]) {
    throw new ProbeTokenError("malformed_token");
  }

  const [body, encodedSignature] = segments;
  const receivedSignature = Buffer.from(encodedSignature, "base64url");
  const expectedSignature = signatureFor(body, secret);

  if (
    receivedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(receivedSignature, expectedSignature)
  ) {
    throw new ProbeTokenError("invalid_signature");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new ProbeTokenError("malformed_payload");
  }

  const parsed = probeTokenClaimsSchema.safeParse(decoded);
  if (!parsed.success) throw new ProbeTokenError("invalid_claims");

  const now = Math.floor(nowMs / 1_000);
  const { issuedAt, expiresAt } = parsed.data;
  if (issuedAt > now + 5) throw new ProbeTokenError("issued_in_future");
  if (expiresAt <= now) throw new ProbeTokenError("expired_token");
  if (expiresAt <= issuedAt || expiresAt - issuedAt > PROBE_TOKEN_TTL_SECONDS) {
    throw new ProbeTokenError("invalid_lifetime");
  }

  return parsed.data;
}
