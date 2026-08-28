import "server-only";

import { createHash, createHmac } from "node:crypto";

import { canonicalSha256 } from "@/lib/evidence/digest";
import {
  beginProbeCall,
  issueProbeAuthorization,
  settleProbeCallKnown,
  settleProbeCallUncertain
} from "@/lib/probe/ledger";
import { decodeProbeSigningSecret } from "@/lib/probe/signing-secret";
import { buildRepairDevelopmentPackage } from "@/lib/repair/development-package.server";
import {
  RepairProviderError,
  runRepairBuilder,
  type RepairProviderKnownReceipt
} from "@/lib/repair/provider.server";
import { putRepairProviderReceipt, readRepairProviderReceipt } from "@/lib/repair/store.server";
import { readSemanticResults } from "@/lib/results/semantic-results.server";
import { readScoredGuardContext } from "@/lib/scored/guard.server";
import { readScoredLedgerRecord, type ScoredLedgerRecord } from "@/lib/scored/ledger-record.server";

export const REPAIR_OPERATOR_CAPABILITY_HASH_ENV = "TOOLPROOF_REPAIR_OPERATOR_CAPABILITY_HASH";

type EnvironmentLike = Readonly<Record<string, string | undefined>>;

export class RepairServiceError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly inferencePerformed = false
  ) {
    super(code);
    this.name = "RepairServiceError";
  }
}

function required(environment: EnvironmentLike, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new RepairServiceError("repair_configuration_missing", 503);
  return value;
}

function secretKey(secret: string): Buffer {
  try {
    return decodeProbeSigningSecret(secret);
  } catch {
    throw new RepairServiceError("repair_signing_secret_invalid", 503);
  }
}

function keyed(secret: string, label: string, value: string, encoding: "hex" | "base64url") {
  return createHmac("sha256", secretKey(secret))
    .update(`toolproof.repair.${label}.v1.${value}`)
    .digest(encoding);
}

function rawSha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const CONSUME_SCRIPT = `
local existing = redis.call("GET", KEYS[1])
if existing then
  if existing == ARGV[1] then return {2, "EXISTING"} end
  return {0, "CONFLICT"}
end
redis.call("SET", KEYS[1], ARGV[1])
return {1, "CONSUMED"}
`;

async function settleStoredReceipt(input: {
  readonly stored: RepairProviderKnownReceipt;
  readonly jti: string;
  readonly claimsHash: string;
  readonly guard: Awaited<ReturnType<typeof readScoredGuardContext>>;
}) {
  const record = await readScoredLedgerRecord(input.guard.redis, {
    ...input.guard.identity,
    jti: input.jti
  });
  const settlementDigest = await canonicalSha256({
    version: "toolproof-repair-known-settlement@1.0.0",
    jti: input.jti,
    providerResponseHash: input.stored.rawResponseHash,
    usageHash: input.stored.usageHash,
    actualNanoUsd: input.stored.actualNanoUsd
  });
  if (record?.state === "KNOWN") {
    if (
      record.purpose !== "repair" ||
      record.claimsHash !== input.claimsHash ||
      record.providerResponseHash !== input.stored.rawResponseHash ||
      record.usageHash !== input.stored.usageHash ||
      record.actualNanoUsd !== input.stored.actualNanoUsd ||
      record.settlementDigest !== settlementDigest
    ) {
      throw new RepairServiceError("repair_known_record_mismatch", 500);
    }
    return;
  }
  if (
    record?.purpose !== "repair" ||
    (record.state !== "IN_FLIGHT" && record.state !== "UNCERTAIN")
  ) {
    throw new RepairServiceError("repair_grant_record_mismatch", 500);
  }
  await settleProbeCallKnown(input.guard.redis, {
    ...input.guard.identity,
    jti: input.jti,
    actualNanoUsd: input.stored.actualNanoUsd,
    providerResponseHash: input.stored.rawResponseHash,
    settlementDigest,
    usageHash: input.stored.usageHash
  });
}

export function assertRepairDispatchLedgerState(
  record: ScoredLedgerRecord | null,
  claimsHash: string
): void {
  if (!record) return;
  if (record.purpose !== "repair" || record.claimsHash !== claimsHash) {
    throw new RepairServiceError("repair_grant_record_mismatch", 500);
  }
  if (record.state === "ISSUED") return;
  if (record.state === "IN_FLIGHT" || record.state === "KNOWN" || record.state === "UNCERTAIN") {
    throw new RepairServiceError("repair_provider_dispatch_already_admitted", 409, true);
  }
  throw new RepairServiceError("repair_authorization_expired", 409);
}

export async function runFrozenRepairBuilder(
  input: { readonly capability: string },
  environment: EnvironmentLike = process.env
) {
  const expectedCapabilityHash = required(environment, REPAIR_OPERATOR_CAPABILITY_HASH_ENV);
  if (
    !/^[a-f0-9]{64}$/u.test(expectedCapabilityHash) ||
    rawSha256(input.capability) !== expectedCapabilityHash
  ) {
    throw new RepairServiceError("invalid_repair_operator_capability", 403);
  }
  const artifactSecret = required(environment, "TOOLPROOF_SIGNING_SECRET");
  const results = await readSemanticResults(environment);
  const developmentPackage = await buildRepairDevelopmentPackage(results);
  const guard = await readScoredGuardContext(environment);
  if (
    guard.status.purposeCounts.baseline < 24 ||
    guard.status.purposeCounts.repair > 1 ||
    guard.status.purposeCounts.revised !== 0
  ) {
    throw new RepairServiceError("repair_guard_not_ready", 409);
  }
  const contextId = `repair_${keyed(
    artifactSecret,
    "context",
    developmentPackage.packageHash,
    "base64url"
  ).slice(0, 22)}`;
  const jti = `jti_repair_${keyed(
    artifactSecret,
    "jti",
    developmentPackage.packageHash,
    "base64url"
  ).slice(0, 22)}`;
  const subjectHash = await canonicalSha256({
    version: "toolproof-repair-subject@1.0.0",
    developmentPackageHash: developmentPackage.packageHash,
    contextId
  });
  const claimsHash = await canonicalSha256({
    version: "toolproof-repair-claims@1.0.0",
    jti,
    subjectHash,
    contextId,
    developmentPackageHash: developmentPackage.packageHash
  });
  const capabilityBinding = keyed(
    artifactSecret,
    "capability",
    `${expectedCapabilityHash}.${developmentPackage.packageHash}`,
    "hex"
  );
  const consumed = await guard.redis.eval<string[], unknown>(
    CONSUME_SCRIPT,
    [`tp:{webmcp26}:repair-capability:${developmentPackage.packageHash}`],
    [capabilityBinding]
  );
  if (!Array.isArray(consumed) || (Number(consumed[0]) !== 1 && Number(consumed[0]) !== 2)) {
    throw new RepairServiceError("repair_capability_conflict", 409);
  }
  const stored = await readRepairProviderReceipt(guard.redis, {
    baselineEvidenceDigest: developmentPackage.baselineEvidenceDigest,
    artifactSecret
  });
  if (stored) {
    try {
      await settleStoredReceipt({ stored, jti, claimsHash, guard });
    } catch (error) {
      throw new RepairServiceError(
        error instanceof Error ? error.message : "repair_recovery_failed",
        500,
        true
      );
    }
    return Object.freeze({
      status: "proposal-ready" as const,
      repairBuilderReceipt: stored.repairBuilderReceipt,
      inferencePerformed: true,
      recovered: true
    });
  }
  assertRepairDispatchLedgerState(
    await readScoredLedgerRecord(guard.redis, {
      ...guard.identity,
      jti
    }),
    claimsHash
  );
  await issueProbeAuthorization(guard.redis, {
    ...guard.identity,
    jti,
    claimsHash,
    purpose: "repair",
    subjectHash,
    actorHash: keyed(artifactSecret, "actor", developmentPackage.packageHash, "hex")
  });
  let receipt: RepairProviderKnownReceipt;
  try {
    receipt = await runRepairBuilder({
      developmentPackage,
      apiKey: required(environment, "OPENAI_API_KEY"),
      contextId,
      safetyIdentifier: keyed(artifactSecret, "safety", developmentPackage.packageHash, "hex"),
      beforeDispatch: async () => {
        await beginProbeCall(guard.redis, {
          ...guard.identity,
          jti,
          claimsHash,
          purpose: "repair"
        });
      }
    });
  } catch (error) {
    if (error instanceof RepairProviderError && error.dispatch === "after_dispatch_uncertain") {
      await settleProbeCallUncertain(guard.redis, {
        ...guard.identity,
        jti,
        settlementDigest: await canonicalSha256({
          version: "toolproof-repair-uncertain-settlement@1.0.0",
          jti,
          code: error.code
        }),
        reason: error.code
      });
      throw new RepairServiceError(error.code, 502, true);
    }
    throw new RepairServiceError(
      error instanceof Error ? error.message : "repair_provider_failed",
      503,
      false
    );
  }
  try {
    await putRepairProviderReceipt(guard.redis, {
      baselineEvidenceDigest: developmentPackage.baselineEvidenceDigest,
      receipt,
      artifactSecret
    });
    await settleStoredReceipt({ stored: receipt, jti, claimsHash, guard });
  } catch (error) {
    throw new RepairServiceError(
      error instanceof Error ? error.message : "repair_receipt_persistence_failed",
      500,
      true
    );
  }
  return Object.freeze({
    status: "proposal-ready" as const,
    repairBuilderReceipt: receipt.repairBuilderReceipt,
    inferencePerformed: true,
    recovered: false
  });
}
