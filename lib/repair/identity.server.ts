import "server-only";

import { createHmac } from "node:crypto";

import { canonicalSha256 } from "@/lib/evidence/digest";
import { decodeProbeSigningSecret } from "@/lib/probe/signing-secret";

function key(secret: string): Buffer {
  return decodeProbeSigningSecret(secret);
}

function digest(
  secret: string,
  label: string,
  value: string,
  encoding: "hex" | "base64url"
): string {
  return createHmac("sha256", key(secret))
    .update(`toolproof.repair.${label}.v1.${value}`)
    .digest(encoding);
}

export async function deriveRepairGrantIdentity(input: {
  readonly artifactSecret: string;
  readonly developmentPackageHash: string;
}) {
  if (!/^[a-f0-9]{64}$/u.test(input.developmentPackageHash)) {
    throw new TypeError("repair_development_package_hash_invalid");
  }
  const contextId = `repair_${digest(
    input.artifactSecret,
    "context",
    input.developmentPackageHash,
    "base64url"
  ).slice(0, 22)}`;
  const jti = `jti_repair_${digest(
    input.artifactSecret,
    "jti",
    input.developmentPackageHash,
    "base64url"
  ).slice(0, 22)}`;
  const subjectHash = await canonicalSha256({
    version: "toolproof-repair-subject@1.0.0",
    developmentPackageHash: input.developmentPackageHash,
    contextId
  });
  const claimsHash = await canonicalSha256({
    version: "toolproof-repair-claims@1.0.0",
    jti,
    subjectHash,
    contextId,
    developmentPackageHash: input.developmentPackageHash
  });
  return Object.freeze({
    contextId,
    jti,
    subjectHash,
    claimsHash,
    actorHash: digest(input.artifactSecret, "actor", input.developmentPackageHash, "hex"),
    safetyIdentifier: digest(input.artifactSecret, "safety", input.developmentPackageHash, "hex")
  });
}

export function deriveRepairCapabilityBinding(input: {
  readonly artifactSecret: string;
  readonly operatorCapabilityHash: string;
  readonly developmentPackageHash: string;
}): string {
  if (
    !/^[a-f0-9]{64}$/u.test(input.operatorCapabilityHash) ||
    !/^[a-f0-9]{64}$/u.test(input.developmentPackageHash)
  ) {
    throw new TypeError("repair_capability_binding_invalid");
  }
  return digest(
    input.artifactSecret,
    "capability",
    `${input.operatorCapabilityHash}.${input.developmentPackageHash}`,
    "hex"
  );
}
