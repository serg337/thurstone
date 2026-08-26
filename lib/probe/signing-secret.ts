import "server-only";

export class ProbeSigningSecretError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProbeSigningSecretError";
  }
}

export function decodeProbeSigningSecret(secret: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/u.test(secret)) {
    throw new ProbeSigningSecretError("invalid_signing_secret_encoding");
  }
  const decoded = Buffer.from(secret, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== secret) {
    throw new ProbeSigningSecretError("invalid_signing_secret_material");
  }
  return decoded;
}

export function isValidProbeSigningSecret(secret: string | undefined): boolean {
  if (!secret) return false;
  try {
    decodeProbeSigningSecret(secret);
    return true;
  } catch {
    return false;
  }
}
