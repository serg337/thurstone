import "server-only";

import { createHash } from "node:crypto";

import { canonicalSha256 } from "@/lib/evidence/digest";
import {
  beginProbeCall,
  issueProbeAuthorization,
  settleProbeCallKnown,
  settleProbeCallUncertain
} from "@/lib/probe/ledger";
import { buildRepairDevelopmentPackage } from "@/lib/repair/development-package.server";
import {
  deriveRepairCapabilityBinding,
  deriveRepairGrantIdentity
} from "@/lib/repair/identity.server";
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
export const REPAIR_PHASE_CALL_OFFSET_ENV = "TOOLPROOF_REPAIR_PHASE_CALL_OFFSET";

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

function rawSha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function configuredRepairCallOffset(environment: EnvironmentLike): 0 | 1 {
  const value = environment[REPAIR_PHASE_CALL_OFFSET_ENV]?.trim() ?? "0";
  if (value !== "0" && value !== "1") {
    throw new RepairServiceError("repair_phase_call_offset_invalid", 503);
  }
  return Number(value) as 0 | 1;
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
  const repairCallOffset = configuredRepairCallOffset(environment);
  if (
    guard.status.purposeCounts.baseline < (repairCallOffset + 1) * 24 ||
    guard.status.purposeCounts.repair < repairCallOffset ||
    guard.status.purposeCounts.repair > repairCallOffset + 1 ||
    guard.status.purposeCounts.revised !== 0
  ) {
    throw new RepairServiceError("repair_guard_not_ready", 409);
  }
  const grantIdentity = await deriveRepairGrantIdentity({
    artifactSecret,
    developmentPackageHash: developmentPackage.packageHash
  });
  const { contextId, jti, subjectHash, claimsHash } = grantIdentity;
  const capabilityBinding = deriveRepairCapabilityBinding({
    artifactSecret,
    operatorCapabilityHash: expectedCapabilityHash,
    developmentPackageHash: developmentPackage.packageHash
  });
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
    if (guard.status.purposeCounts.repair !== repairCallOffset + 1) {
      throw new RepairServiceError("repair_recovery_count_mismatch", 500, true);
    }
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
  if (guard.status.purposeCounts.repair !== repairCallOffset) {
    throw new RepairServiceError("repair_grant_without_receipt", 500, true);
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
    actorHash: grantIdentity.actorHash
  });
  let receipt: RepairProviderKnownReceipt;
  try {
    receipt = await runRepairBuilder({
      developmentPackage,
      apiKey: required(environment, "OPENAI_API_KEY"),
      contextId,
      safetyIdentifier: grantIdentity.safetyIdentifier,
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
      try {
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
      } catch {
        throw new RepairServiceError("repair_uncertain_settlement_failed", 500, true);
      }
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
    try {
      await settleProbeCallUncertain(guard.redis, {
        ...guard.identity,
        jti,
        settlementDigest: await canonicalSha256({
          version: "toolproof-repair-uncertain-settlement@1.0.0",
          jti,
          code: "repair_receipt_persistence_failed"
        }),
        reason: "repair_receipt_persistence_failed"
      });
    } catch {
      // The original persistence/settlement error remains authoritative. Inference is still true,
      // and the durable ledger stays fail-closed as IN_FLIGHT, UNCERTAIN, or already KNOWN.
    }
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
