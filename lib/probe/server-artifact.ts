import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

import { canonicalJson } from "@/lib/evidence/digest";
import { decodeProbeSigningSecret } from "@/lib/probe/signing-secret";

const SIGNED_ARTIFACT_VERSION = "tp1";
const SEALED_ARTIFACT_VERSION = "tpse1";
const MAX_ARTIFACT_BYTES = 2_000_000;

export class ProbeArtifactError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProbeArtifactError";
  }
}

function assertKind(kind: string): string {
  if (!/^[a-z][a-z0-9_-]{2,63}$/u.test(kind)) {
    throw new ProbeArtifactError("invalid_artifact_kind");
  }
  return kind;
}

function signingKey(secret: string): Buffer {
  try {
    return decodeProbeSigningSecret(secret);
  } catch {
    throw new ProbeArtifactError("weak_signing_secret");
  }
}

function hmac(kind: string, body: string, secret: string): Buffer {
  return createHmac("sha256", signingKey(secret))
    .update(`toolproof.probe.artifact.${SIGNED_ARTIFACT_VERSION}.${assertKind(kind)}.${body}`)
    .digest();
}

function encryptionKey(kind: string, secret: string): Buffer {
  return createHmac("sha256", signingKey(secret))
    .update(`toolproof.probe.seal.${SEALED_ARTIFACT_VERSION}.${assertKind(kind)}`)
    .digest();
}

function boundedUtf8(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) {
    throw new ProbeArtifactError("artifact_too_large");
  }
  return bytes;
}

function decodeCanonicalBase64Url(value: string, code: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new ProbeArtifactError(code);
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) throw new ProbeArtifactError(code);
  return decoded;
}

export function signProbeArtifact(kind: string, value: unknown, secret: string): string {
  const body = boundedUtf8(canonicalJson(value)).toString("base64url");
  const signature = hmac(kind, body, secret).toString("base64url");
  return `${SIGNED_ARTIFACT_VERSION}.${body}.${signature}`;
}

export function verifyProbeArtifact(kind: string, token: string, secret: string): unknown {
  if (Buffer.byteLength(token, "utf8") > MAX_ARTIFACT_BYTES * 2) {
    throw new ProbeArtifactError("artifact_too_large");
  }
  const segments = token.split(".");
  if (segments.length !== 3 || segments[0] !== SIGNED_ARTIFACT_VERSION) {
    throw new ProbeArtifactError("malformed_artifact");
  }
  const body = segments[1];
  const encodedSignature = segments[2];
  if (!body || !encodedSignature) throw new ProbeArtifactError("malformed_artifact");
  const received = decodeCanonicalBase64Url(encodedSignature, "malformed_artifact");
  const expected = hmac(kind, body, secret);
  if (received.byteLength !== expected.byteLength || !timingSafeEqual(received, expected)) {
    throw new ProbeArtifactError("invalid_artifact_signature");
  }
  let decoded: string;
  try {
    decoded = decodeCanonicalBase64Url(body, "malformed_artifact").toString("utf8");
  } catch {
    throw new ProbeArtifactError("malformed_artifact");
  }
  boundedUtf8(decoded);
  try {
    return JSON.parse(decoded) as unknown;
  } catch {
    throw new ProbeArtifactError("malformed_artifact_payload");
  }
}

export function sealProbeArtifact(kind: string, value: unknown, secret: string): string {
  const plaintext = boundedUtf8(canonicalJson(value));
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(kind, secret), nonce);
  cipher.setAAD(Buffer.from(`toolproof.probe.${SEALED_ARTIFACT_VERSION}.${assertKind(kind)}`));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const token = [
    SEALED_ARTIFACT_VERSION,
    nonce.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url")
  ].join(".");
  if (Buffer.byteLength(token, "utf8") > MAX_ARTIFACT_BYTES * 2) {
    throw new ProbeArtifactError("artifact_too_large");
  }
  return token;
}

export function openProbeArtifact(kind: string, token: string, secret: string): unknown {
  if (Buffer.byteLength(token, "utf8") > MAX_ARTIFACT_BYTES * 2) {
    throw new ProbeArtifactError("artifact_too_large");
  }
  const segments = token.split(".");
  if (segments.length !== 4 || segments[0] !== SEALED_ARTIFACT_VERSION) {
    throw new ProbeArtifactError("malformed_sealed_artifact");
  }
  const encodedNonce = segments[1];
  const encodedCiphertext = segments[2];
  const encodedTag = segments[3];
  if (!encodedNonce || !encodedCiphertext || !encodedTag) {
    throw new ProbeArtifactError("malformed_sealed_artifact");
  }
  const nonce = decodeCanonicalBase64Url(encodedNonce, "malformed_sealed_artifact");
  const ciphertext = decodeCanonicalBase64Url(encodedCiphertext, "malformed_sealed_artifact");
  const tag = decodeCanonicalBase64Url(encodedTag, "malformed_sealed_artifact");
  if (
    nonce.byteLength !== 12 ||
    tag.byteLength !== 16 ||
    ciphertext.byteLength > MAX_ARTIFACT_BYTES
  ) {
    throw new ProbeArtifactError("malformed_sealed_artifact");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(kind, secret), nonce);
    decipher.setAAD(Buffer.from(`toolproof.probe.${SEALED_ARTIFACT_VERSION}.${assertKind(kind)}`));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    boundedUtf8(plaintext.toString("utf8"));
    return JSON.parse(plaintext.toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof ProbeArtifactError) throw error;
    throw new ProbeArtifactError("invalid_sealed_artifact");
  }
}
