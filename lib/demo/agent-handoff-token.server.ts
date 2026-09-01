import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

import {
  BYOA_HANDOFF_ENVELOPE_VERSION,
  BYOA_HANDOFF_MAX_BYTES,
  BYOA_HANDOFF_TOKEN_MAX_BYTES,
  BYOA_HANDOFF_TTL_MS,
  parseHandoffEnvelope,
  type ByoaHandoffEnvelopeV1
} from "@/lib/demo/agent-handoff";
import type { AgentVisibleRunProjection } from "@/lib/demo/agent-projection";
import type { ByoaAgentSessionV1 } from "@/lib/demo/agent-session";
import type { RegressionRerunV1 } from "@/lib/demo/regression-rerun";
import { canonicalJson } from "@/lib/evidence/digest";

export const BYOA_HANDOFF_COOKIE = "thurstone_byoa_handoff" as const;

const TOKEN_VERSION = "tbh1";
const AAD = Buffer.from("thurstone-byoa-handoff-token@1", "utf8");

function handoffKey(environment: NodeJS.ProcessEnv = process.env): Buffer {
  const encoded = environment.TOOLPROOF_SIGNING_SECRET?.trim() ?? "";
  const secret = Buffer.from(encoded, "base64url");
  if (secret.byteLength < 32) throw new Error("BYOA handoff encryption is not configured.");
  return createHash("sha256")
    .update("thurstone-byoa-handoff-key@1\0", "utf8")
    .update(secret)
    .digest();
}

function tokenBytes(token: string): number {
  return Buffer.byteLength(token, "utf8");
}

function decodeBase64Url(value: string): Buffer {
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) throw new Error("non-canonical base64url");
  return bytes;
}

export function createByoaHandoffEnvelope(input: {
  readonly session: ByoaAgentSessionV1;
  readonly projection: AgentVisibleRunProjection;
  readonly rerun: RegressionRerunV1 | null;
  readonly now?: Date;
}): ByoaHandoffEnvelopeV1 {
  const now = input.now ?? new Date();
  const expiresAt = new Date(
    Math.min(Date.parse(input.session.expiresAt), now.getTime() + BYOA_HANDOFF_TTL_MS)
  ).toISOString();
  if (Date.parse(expiresAt) <= now.getTime() + 30_000) {
    throw new Error("The BYOA handoff lifetime is too short.");
  }
  return parseHandoffEnvelope({
    version: BYOA_HANDOFF_ENVELOPE_VERSION,
    issuedAt: now.toISOString(),
    expiresAt,
    session: { ...input.session, expiresAt },
    projection: { ...input.projection, expiresAt },
    rerun: input.rerun
  });
}

export function sealByoaHandoff(
  envelope: ByoaHandoffEnvelopeV1,
  environment: NodeJS.ProcessEnv = process.env
): string {
  const payload = Buffer.from(canonicalJson(parseHandoffEnvelope(envelope)), "utf8");
  if (payload.byteLength > BYOA_HANDOFF_MAX_BYTES) throw new Error("BYOA handoff is too large.");
  const compressed = deflateRawSync(payload, { level: 9 });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", handoffKey(environment), iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  const token = [
    TOKEN_VERSION,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url")
  ].join(".");
  if (tokenBytes(token) > BYOA_HANDOFF_TOKEN_MAX_BYTES)
    throw new Error("BYOA handoff token is too large for a cookie.");
  return token;
}

export function openByoaHandoff(
  token: string,
  input: { readonly environment?: NodeJS.ProcessEnv; readonly now?: Date } = {}
): ByoaHandoffEnvelopeV1 {
  if (tokenBytes(token) > BYOA_HANDOFF_TOKEN_MAX_BYTES)
    throw new Error("BYOA handoff token is invalid.");
  const [version, ivEncoded, ciphertextEncoded, tagEncoded, extra] = token.split(".");
  if (
    version !== TOKEN_VERSION ||
    !ivEncoded ||
    !ciphertextEncoded ||
    !tagEncoded ||
    extra !== undefined
  ) {
    throw new Error("BYOA handoff token is invalid.");
  }
  try {
    const iv = decodeBase64Url(ivEncoded);
    const ciphertext = decodeBase64Url(ciphertextEncoded);
    const tag = decodeBase64Url(tagEncoded);
    if (iv.byteLength !== 12 || tag.byteLength !== 16 || ciphertext.byteLength < 1) {
      throw new Error("invalid token dimensions");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      handoffKey(input.environment ?? process.env),
      iv
    );
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const plaintext = inflateRawSync(compressed, {
      maxOutputLength: BYOA_HANDOFF_MAX_BYTES + 1
    });
    if (plaintext.byteLength > BYOA_HANDOFF_MAX_BYTES) throw new Error("oversized payload");
    const envelope = parseHandoffEnvelope(JSON.parse(plaintext.toString("utf8")) as unknown);
    const now = input.now ?? new Date();
    if (Date.parse(envelope.expiresAt) <= now.getTime()) {
      throw new Error("expired");
    }
    return envelope;
  } catch {
    throw new Error("BYOA handoff token is invalid or expired.");
  }
}

export function byoaHandoffCookieOptions(requestUrl: string, expiresAt: string) {
  const secure = new URL(requestUrl).protocol === "https:";
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure,
    path: "/",
    expires: new Date(expiresAt)
  };
}
